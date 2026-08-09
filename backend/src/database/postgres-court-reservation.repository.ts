import { Injectable } from '@nestjs/common';
import { QueryResultRow } from 'pg';
import { AccountId, accountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { newInternalUuid } from '../common/internal-uuid';
import {
  ReservationOperationTransitionCommand,
  ReservationOperationTransitionResult,
  StartReservationOperationInput,
  StartReservationOperationResult,
  startReservationOperation,
  transitionReservationOperation,
} from '../reservations/reservation.state-machine';
import { ReservationSnapshotCrypto } from '../reservations/reservation-snapshot.crypto';
import {
  CourtReservation,
  CourtReservationId,
  ReservationIdempotencyKey,
  ReservationOperation,
  ReservationOperationId,
  ReservationOperationRequest,
  YclientsReservationBinding,
  courtReservationId,
  isReservationClientSnapshot,
  isReservationOperationType,
  isReservationOperationRequest,
  isReservationStatus,
  isReservationTarget,
  isYclientsReservationBinding,
  reservationIdempotencyKey,
  reservationOperationId,
  reservationProviderRejectionReason,
  reservationRequestDigest,
} from '../reservations/reservation.types';
import { classifyPostgresError } from './postgres-error-classifier';
import {
  CourtReservationPersistenceCause,
  CourtReservationPersistenceError,
  CourtReservationPersistenceStage,
  CourtReservationRepository,
  CreateCourtReservationPersistenceResult,
} from './court-reservation.repository';
import {
  decodePostgresBigint,
  decodePostgresPositiveInteger,
} from './postgres-codecs';
import { PostgresTransaction } from './postgres-transaction';

export type ReservationProviderAttempt = Readonly<{
  operationId: ReservationOperationId;
  status: ReservationOperation['status'];
  startedAt?: number;
  finishedAt?: number;
  createdAt: number;
  apiId: number;
}>;

export type ReservationRefreshPersistenceResult =
  | Readonly<{ outcome: 'updated'; reservation: CourtReservation }>
  | Readonly<{ outcome: 'not_found' | 'binding_mismatch' }>;

export type ReservationRefreshBindingProof =
  | Readonly<{ kind: 'external_api_id'; apiId: number }>
  | Readonly<{ kind: 'exact_active_record' }>
  | Readonly<{ kind: 'exact_deleted_record' }>;

export type ReservationRefreshInput = Readonly<{
  expectedVersion: number;
  companyId: number;
  recordId: number;
  proof: ReservationRefreshBindingProof;
  serviceId: number;
  courtId: number;
  startsAt: string;
  endsAt: string;
  deleted: boolean;
  now: number;
}>;

interface ReservationRow extends QueryResultRow {
  reservation_id: unknown;
  owner_account_id: unknown;
  status: unknown;
  target_service_id: unknown;
  target_resource_id: unknown;
  target_datetime_text: unknown;
  target_end_datetime_text: unknown;
  yclients_appointment_id: unknown;
  yclients_record_id: unknown;
  yclients_record_hash_ciphertext: unknown;
  yclients_record_hash_nonce: unknown;
  yclients_record_hash_auth_tag: unknown;
  yclients_record_hash_algorithm: unknown;
  yclients_record_hash_encryption_key_version: unknown;
  yclients_record_hash_digest: unknown;
  yclients_record_hash_digest_key_version: unknown;
  version: unknown;
  created_at: unknown;
  updated_at: unknown;
}

interface OperationRow extends QueryResultRow {
  operation_id: unknown;
  reservation_id: unknown;
  owner_account_id: unknown;
  actor_account_id: unknown;
  operation_type: unknown;
  status: unknown;
  idempotency_key: unknown;
  request_digest: unknown;
  external_api_id: unknown;
  target_service_id: unknown;
  target_resource_id: unknown;
  target_datetime_text: unknown;
  target_end_datetime_text: unknown;
  provider_appointment_id: unknown;
  provider_record_id: unknown;
  provider_record_hash_ciphertext: unknown;
  provider_record_hash_nonce: unknown;
  provider_record_hash_auth_tag: unknown;
  provider_record_hash_algorithm: unknown;
  provider_record_hash_encryption_key_version: unknown;
  provider_record_hash_digest: unknown;
  provider_record_hash_digest_key_version: unknown;
  previous_reservation_status: unknown;
  provider_attempt_started_at: unknown;
  provider_attempt_finished_at: unknown;
  unknown_at: unknown;
  terminal_at: unknown;
  reconciled_at: unknown;
  reconciliation_outcome: unknown;
  rejection_reason: unknown;
  created_at: unknown;
  ciphertext: unknown;
  nonce: unknown;
  auth_tag: unknown;
  algorithm: unknown;
  wrapped_data_key_ciphertext: unknown;
  wrapped_data_key_nonce: unknown;
  wrapped_data_key_auth_tag: unknown;
  wrapping_algorithm: unknown;
  wrapping_key_version: unknown;
  client_snapshot_digest: unknown;
  client_snapshot_digest_key_version: unknown;
  aad_version: unknown;
}

interface StartedCreateOperationControlRow extends QueryResultRow {
  operation_id: unknown;
  reservation_id: unknown;
  owner_account_id: unknown;
  actor_account_id: unknown;
  operation_type: unknown;
  status: unknown;
  idempotency_key: unknown;
  request_digest: unknown;
  external_api_id: unknown;
  target_service_id: unknown;
  target_resource_id: unknown;
  target_datetime_text: unknown;
  target_end_datetime_text: unknown;
  provider_appointment_id: unknown;
  provider_record_id: unknown;
  previous_reservation_status: unknown;
  provider_attempt_started_at: unknown;
  provider_attempt_finished_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

const RESERVATION_COLUMNS = `
  reservation_id, owner_account_id, status, target_service_id,
  target_resource_id, target_datetime_text, target_end_datetime_text,
  yclients_appointment_id, yclients_record_id,
  yclients_record_hash_ciphertext, yclients_record_hash_nonce,
  yclients_record_hash_auth_tag, yclients_record_hash_algorithm,
  yclients_record_hash_encryption_key_version, yclients_record_hash_digest,
  yclients_record_hash_digest_key_version, version, created_at, updated_at
`;

const OPERATION_COLUMNS = `
  o.operation_id, o.reservation_id, o.owner_account_id, o.actor_account_id,
  o.operation_type, o.status, o.idempotency_key, o.request_digest,
  o.external_api_id, o.target_service_id, o.target_resource_id,
  o.target_datetime_text, o.target_end_datetime_text,
  o.provider_appointment_id, o.provider_record_id,
  o.provider_record_hash_ciphertext, o.provider_record_hash_nonce,
  o.provider_record_hash_auth_tag, o.provider_record_hash_algorithm,
  o.provider_record_hash_encryption_key_version, o.provider_record_hash_digest,
  o.provider_record_hash_digest_key_version, o.previous_reservation_status,
  o.provider_attempt_started_at, o.provider_attempt_finished_at,
  o.unknown_at, o.terminal_at, o.reconciled_at, o.reconciliation_outcome,
  o.rejection_reason, o.created_at, o.client_snapshot_digest,
  o.client_snapshot_digest_key_version,
  s.ciphertext, s.nonce, s.auth_tag, s.algorithm,
  s.wrapped_data_key_ciphertext, s.wrapped_data_key_nonce,
  s.wrapped_data_key_auth_tag, s.wrapping_algorithm, s.wrapping_key_version,
  s.aad_version
`;

const STARTED_CREATE_OPERATION_CONTROL_COLUMNS = `
  operation_id, reservation_id, owner_account_id, actor_account_id,
  operation_type, status, idempotency_key, request_digest, external_api_id,
  target_service_id, target_resource_id, target_datetime_text,
  target_end_datetime_text, provider_appointment_id, provider_record_id,
  previous_reservation_status, provider_attempt_started_at,
  provider_attempt_finished_at, created_at, updated_at
`;

function persistenceCause(
  classified: ReturnType<typeof classifyPostgresError>,
): CourtReservationPersistenceCause {
  if (classified.kind === 'non_postgres_error') return 'non_postgres_error';
  if (classified.metadata.code === '42804') return 'datatype_mismatch';
  if (classified.category === 'check_violation') {
    switch (classified.metadata.constraint) {
      case 'reservation_operations_time_check':
        return 'operation_time_constraint';
      case 'reservation_operations_terminal_shape_check':
        return 'operation_terminal_shape_constraint';
      case 'reservation_operations_provider_binding_shape_check':
        return 'operation_provider_binding_shape_constraint';
      default:
        return 'check_violation';
    }
  }
  switch (classified.category) {
    case 'not_null_violation': return 'not_null_violation';
    case 'invalid_text_representation': return 'invalid_text_representation';
    case 'object_not_in_prerequisite_state':
      return 'object_not_in_prerequisite_state';
    default: return 'unknown_postgres_error';
  }
}

function persistenceError(
  error: unknown,
  stage: CourtReservationPersistenceStage = 'unspecified',
): CourtReservationPersistenceError {
  if (error instanceof CourtReservationPersistenceError) {
    return error.stage === 'unspecified' && stage !== 'unspecified'
      ? new CourtReservationPersistenceError(error.reason, stage, error.cause)
      : error;
  }
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return new CourtReservationPersistenceError(
      'storage_failure',
      stage,
      persistenceCause(classified),
    );
  }
  if (classified.metadata.code === '23P01') {
    return new CourtReservationPersistenceError('transaction_conflict', stage);
  }
  switch (classified.category) {
    case 'foreign_key_violation': return new CourtReservationPersistenceError('referential_integrity', stage);
    case 'insufficient_privilege': return new CourtReservationPersistenceError('permission_denied', stage);
    case 'serialization_failure':
    case 'deadlock_detected':
    case 'unique_violation': return new CourtReservationPersistenceError('transaction_conflict', stage);
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled': return new CourtReservationPersistenceError('database_unavailable', stage);
    default: return new CourtReservationPersistenceError(
      'storage_failure',
      stage,
      persistenceCause(classified),
    );
  }
}

function readPositive(value: unknown): number {
  const result = decodePostgresBigint(value);
  if (result < 1) throw new Error('invalid persisted positive integer');
  return result;
}

function readEpoch(value: unknown) {
  const result = decodePostgresBigint(value);
  if (result < 0) throw new Error('invalid persisted epoch');
  return unixEpochSeconds(result);
}

function readBuffer(value: unknown): Buffer {
  if (!Buffer.isBuffer(value) || value.length === 0) throw new Error('invalid persisted bytes');
  return value;
}

function readAlgorithm(value: unknown): 'aes_256_gcm' {
  if (value !== 'aes_256_gcm') throw new Error('invalid persisted algorithm');
  return value;
}

function readOperationStatus(value: unknown): ReservationOperation['status'] {
  switch (value) {
    case 'pending':
    case 'unknown':
    case 'confirmed':
    case 'rejected':
    case 'reconciled':
      return value;
    default:
      throw new Error('invalid persisted operation status');
  }
}

function operationProviderRecordId(
  operation: ReservationOperation,
): number | undefined {
  if (operation.status === 'confirmed') {
    return operation.providerBinding?.recordId;
  }
  if (
    operation.status === 'reconciled' &&
    operation.result.outcome === 'confirmed'
  ) {
    return operation.result.providerBinding?.recordId;
  }
  return undefined;
}

function matchesRefreshBindingProof(
  proof: unknown,
  deleted: boolean,
  recordId: number,
  operation: ReservationOperation,
): boolean {
  if (typeof proof !== 'object' || proof === null || Array.isArray(proof)) {
    return false;
  }
  const candidate = proof as Record<string, unknown>;
  if (operationProviderRecordId(operation) !== recordId) return false;
  if (candidate.kind === 'external_api_id') {
    return (
      Object.keys(candidate).length === 2 &&
      Number.isSafeInteger(candidate.apiId) &&
      Number(candidate.apiId) > 0 &&
      candidate.apiId === operation.request.externalReference.apiId
    );
  }
  if (candidate.kind === 'exact_active_record') {
    return Object.keys(candidate).length === 1 && !deleted;
  }
  return (
    candidate.kind === 'exact_deleted_record' &&
    Object.keys(candidate).length === 1 &&
    deleted
  );
}

function recordBinding(row: ReservationRow | OperationRow, crypto: ReservationSnapshotCrypto): YclientsReservationBinding | undefined {
  if (row.yclients_record_id === undefined) {
    const operation = row as OperationRow;
    if (operation.provider_record_id === null) return undefined;
    const binding = Object.freeze({
      provider: 'yclients',
      appointmentId: readPositive(operation.provider_appointment_id),
      recordId: readPositive(operation.provider_record_id),
      recordHash: crypto.decryptRecordHash({
        ciphertext: readBuffer(operation.provider_record_hash_ciphertext),
        nonce: readBuffer(operation.provider_record_hash_nonce),
        authTag: readBuffer(operation.provider_record_hash_auth_tag),
        algorithm: readAlgorithm(operation.provider_record_hash_algorithm),
        keyVersion: decodePostgresPositiveInteger(
          operation.provider_record_hash_encryption_key_version,
        ),
        digest: readBuffer(operation.provider_record_hash_digest),
        digestKeyVersion: decodePostgresPositiveInteger(
          operation.provider_record_hash_digest_key_version,
        ),
      }),
    });
    if (!isYclientsReservationBinding(binding)) throw new Error('invalid persisted provider binding');
    return binding;
  }
  const reservation = row as ReservationRow;
  if (reservation.yclients_record_id === null) return undefined;
  const binding = Object.freeze({
    provider: 'yclients',
    appointmentId: readPositive(reservation.yclients_appointment_id),
    recordId: readPositive(reservation.yclients_record_id),
    recordHash: crypto.decryptRecordHash({
      ciphertext: readBuffer(reservation.yclients_record_hash_ciphertext),
      nonce: readBuffer(reservation.yclients_record_hash_nonce),
      authTag: readBuffer(reservation.yclients_record_hash_auth_tag),
      algorithm: readAlgorithm(reservation.yclients_record_hash_algorithm),
      keyVersion: decodePostgresPositiveInteger(
        reservation.yclients_record_hash_encryption_key_version,
      ),
      digest: readBuffer(reservation.yclients_record_hash_digest),
      digestKeyVersion: decodePostgresPositiveInteger(
        reservation.yclients_record_hash_digest_key_version,
      ),
    }),
  });
  if (!isYclientsReservationBinding(binding)) throw new Error('invalid persisted provider binding');
  return binding;
}

function hydrateReservation(row: ReservationRow, crypto: ReservationSnapshotCrypto): CourtReservation {
  const binding = recordBinding(row, crypto);
  if (!isReservationStatus(row.status)) throw new Error('invalid persisted reservation status');
  if (['confirmed', 'reschedule_pending', 'cancel_pending', 'cancelled'].includes(row.status) && binding === undefined) {
    throw new Error('invalid persisted reservation binding');
  }
  const target = Object.freeze({
    serviceId: readPositive(row.target_service_id),
    courtId: readPositive(row.target_resource_id),
    startsAt: String(row.target_datetime_text),
    endsAt: String(row.target_end_datetime_text),
  });
  if (!isReservationTarget(target)) throw new Error('invalid persisted reservation target');
  return Object.freeze({
    reservationId: courtReservationId(String(row.reservation_id)),
    ownerAccountId: accountId(String(row.owner_account_id)),
    status: row.status,
    target,
    ...(binding === undefined ? {} : { providerBinding: binding }),
    createdAt: readEpoch(row.created_at),
    updatedAt: readEpoch(row.updated_at),
    version: readPositive(row.version),
  });
}

function hydrateOperation(row: OperationRow, crypto: ReservationSnapshotCrypto): ReservationOperation {
  const operationId = reservationOperationId(String(row.operation_id));
  const ownerAccountId = accountId(String(row.owner_account_id));
  const snapshotJson = crypto.decryptClientSnapshot(operationId, ownerAccountId, {
    ciphertext: readBuffer(row.ciphertext), nonce: readBuffer(row.nonce),
    authTag: readBuffer(row.auth_tag), algorithm: readAlgorithm(row.algorithm),
    wrappedDataKeyCiphertext: readBuffer(row.wrapped_data_key_ciphertext),
    wrappedDataKeyNonce: readBuffer(row.wrapped_data_key_nonce),
    wrappedDataKeyAuthTag: readBuffer(row.wrapped_data_key_auth_tag),
    wrappingAlgorithm: readAlgorithm(row.wrapping_algorithm),
    wrappingKeyVersion: decodePostgresPositiveInteger(
      row.wrapping_key_version,
    ),
    digest: readBuffer(row.client_snapshot_digest),
    digestKeyVersion: decodePostgresPositiveInteger(
      row.client_snapshot_digest_key_version,
    ),
    aadVersion: decodePostgresPositiveInteger(row.aad_version) as 1,
  });
  const client: unknown = JSON.parse(snapshotJson);
  if (!isReservationClientSnapshot(client)) throw new Error('invalid persisted client snapshot');
  if (!isReservationOperationType(row.operation_type)) throw new Error('invalid persisted operation type');
  if (!isReservationStatus(row.previous_reservation_status)) throw new Error('invalid persisted previous status');
  const type = row.operation_type;
  const request: ReservationOperationRequest = type === 'cancel'
    ? { type, reservationId: courtReservationId(String(row.reservation_id)), ownerAccountId,
        externalReference: { apiId: readPositive(row.external_api_id) }, client }
    : { type, reservationId: courtReservationId(String(row.reservation_id)), ownerAccountId,
        externalReference: { apiId: readPositive(row.external_api_id) }, client,
        target: { serviceId: readPositive(row.target_service_id), courtId: readPositive(row.target_resource_id),
          startsAt: String(row.target_datetime_text), endsAt: String(row.target_end_datetime_text) } };
  if (!isReservationOperationRequest(request)) throw new Error('invalid persisted operation request');
  const base = {
    operationId, reservationId: request.reservationId, ownerAccountId,
    actorAccountId: accountId(String(row.actor_account_id)), type,
    idempotencyKey: reservationIdempotencyKey(String(row.idempotency_key)),
    requestDigest: reservationRequestDigest(String(row.request_digest)), request,
    previousReservationStatus: row.previous_reservation_status,
    createdAt: readEpoch(row.created_at),
  };
  const binding = recordBinding(row, crypto);
  const status = readOperationStatus(row.status);
  if (
    type !== 'cancel' &&
    (status === 'confirmed' ||
      (status === 'reconciled' && row.reconciliation_outcome === 'confirmed')) &&
    binding === undefined
  ) {
    throw new Error('invalid persisted operation binding');
  }
  switch (status) {
    case 'pending': return Object.freeze({ ...base, status: 'pending' as const });
    case 'unknown': return Object.freeze({ ...base, status: 'unknown' as const, uncertainAt: readEpoch(row.unknown_at) });
    case 'confirmed': return Object.freeze({ ...base, status: 'confirmed' as const, terminalAt: readEpoch(row.terminal_at), ...(binding ? { providerBinding: binding } : {}) });
    case 'rejected': return Object.freeze({ ...base, status: 'rejected' as const, terminalAt: readEpoch(row.terminal_at), reason: reservationProviderRejectionReason(String(row.rejection_reason)) });
    case 'reconciled': return Object.freeze({ ...base, status: 'reconciled' as const, uncertainAt: readEpoch(row.unknown_at), terminalAt: readEpoch(row.terminal_at), result: row.reconciliation_outcome === 'confirmed' ? { outcome: 'confirmed' as const, ...(binding ? { providerBinding: binding } : {}) } : { outcome: 'rejected' as const, reason: reservationProviderRejectionReason(String(row.rejection_reason)) } });
    default: throw new Error('invalid persisted operation status');
  }
}

function assertStartedCreateOperationControl(
  row: StartedCreateOperationControlRow,
  expected: ReservationOperation,
): Readonly<{ providerAttemptStartedAt: ReturnType<typeof unixEpochSeconds>; operationUpdatedAt: ReturnType<typeof unixEpochSeconds> }> {
  const providerAttemptStartedAt = row.provider_attempt_started_at === null
    ? undefined
    : readEpoch(row.provider_attempt_started_at);
  const operationUpdatedAt = readEpoch(row.updated_at);
  if (
    expected.status !== 'pending' ||
    expected.type !== 'create' ||
    expected.request.type !== 'create' ||
    String(row.operation_id) !== expected.operationId ||
    String(row.reservation_id) !== expected.reservationId ||
    String(row.owner_account_id) !== expected.ownerAccountId ||
    String(row.actor_account_id) !== expected.actorAccountId ||
    row.operation_type !== 'create' ||
    row.status !== 'pending' ||
    String(row.idempotency_key) !== expected.idempotencyKey ||
    String(row.request_digest) !== expected.requestDigest ||
    readPositive(row.external_api_id) !==
      expected.request.externalReference.apiId ||
    readPositive(row.target_service_id) !== expected.request.target.serviceId ||
    readPositive(row.target_resource_id) !== expected.request.target.courtId ||
    String(row.target_datetime_text) !== expected.request.target.startsAt ||
    String(row.target_end_datetime_text) !== expected.request.target.endsAt ||
    row.provider_appointment_id !== null ||
    row.provider_record_id !== null ||
    row.previous_reservation_status !== expected.previousReservationStatus ||
    providerAttemptStartedAt === undefined ||
    Number(providerAttemptStartedAt) <
      Number(expected.createdAt) ||
    row.provider_attempt_finished_at !== null ||
    Number(readEpoch(row.created_at)) !== Number(expected.createdAt) ||
    Number(operationUpdatedAt) < Number(providerAttemptStartedAt)
  ) {
    throw new CourtReservationPersistenceError(
      'invalid_persisted_state',
      'operation_control_validation',
    );
  }
  return Object.freeze({ providerAttemptStartedAt, operationUpdatedAt });
}

@Injectable()
export class PostgresCourtReservationRepository implements CourtReservationRepository {
  constructor(private readonly crypto: ReservationSnapshotCrypto, private readonly companyId: number) {}

  async lockIdempotencyKey(
    transaction: PostgresTransaction,
    ownerAccountId: AccountId,
    idempotencyKey: ReservationIdempotencyKey,
  ): Promise<void> {
    try {
      await transaction.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reservation:'||$1::text||':'||$2::text,0))`,
        [ownerAccountId, idempotencyKey],
      );
    } catch (error) { throw persistenceError(error); }
  }

  async create(transaction: PostgresTransaction, reservation: CourtReservation): Promise<CreateCourtReservationPersistenceResult> {
    try {
      const result = await transaction.query<ReservationRow>(`
        INSERT INTO backend_reservation.court_reservations (
          reservation_id, owner_account_id, status, target_service_id, target_resource_id,
          target_datetime, target_datetime_text, target_end_datetime, target_end_datetime_text,
          yclients_company_id, version, created_at, updated_at, status_changed_at
        ) VALUES ($1,$2,$3,$4,$5,$6::text::timestamptz,$6::text,$7::text::timestamptz,$7::text,$8,$9,$10,$10,$10)
        ON CONFLICT (reservation_id) DO NOTHING RETURNING ${RESERVATION_COLUMNS}
      `, [reservation.reservationId, reservation.ownerAccountId, reservation.status,
        reservation.target.serviceId, reservation.target.courtId, reservation.target.startsAt,
        reservation.target.endsAt, this.companyId, reservation.version, reservation.createdAt]);
      if (result.rowCount === 1) return Object.freeze({ outcome: 'created', reservation: hydrateReservation(result.rows[0], this.crypto) });
      const existing = await this.findById(transaction, reservation.ownerAccountId, reservation.reservationId);
      return existing === null
        ? Object.freeze({ outcome: 'rejected', reason: 'reservation_binding_conflict' })
        : Object.freeze({ outcome: 'idempotent_retry', reservation: existing });
    } catch (error) { throw persistenceError(error); }
  }

  async findById(transaction: PostgresTransaction, ownerAccountId: AccountId, reservationId: CourtReservationId): Promise<CourtReservation | null> {
    try {
      const result = await transaction.query<ReservationRow>(`SELECT ${RESERVATION_COLUMNS} FROM backend_reservation.court_reservations WHERE owner_account_id=$1 AND reservation_id=$2`, [ownerAccountId, reservationId]);
      if (result.rowCount === 0) return null;
      if (result.rowCount !== 1) throw new Error('invalid reservation cardinality');
      return hydrateReservation(result.rows[0], this.crypto);
    } catch (error) { throw persistenceError(error); }
  }

  async listByOwner(
    transaction: PostgresTransaction,
    ownerAccountId: AccountId,
    limit: number,
  ): Promise<ReadonlyArray<CourtReservation>> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      throw new CourtReservationPersistenceError('invalid_input');
    }
    try {
      const result = await transaction.query<ReservationRow>(`
        SELECT ${RESERVATION_COLUMNS}
        FROM backend_reservation.court_reservations
        WHERE owner_account_id=$1
        ORDER BY updated_at DESC,reservation_id DESC
        LIMIT $2
      `, [ownerAccountId, limit]);
      if (result.rows.length > limit || result.rowCount !== result.rows.length) {
        throw new Error('invalid reservation list cardinality');
      }
      return Object.freeze(result.rows.map((row) => hydrateReservation(row, this.crypto)));
    } catch (error) { throw persistenceError(error); }
  }

  private async findOperation(transaction: PostgresTransaction, clause: string, values: readonly unknown[]): Promise<ReservationOperation | null> {
    const result = await transaction.query<OperationRow>(`
      SELECT ${OPERATION_COLUMNS} FROM backend_reservation.reservation_operations o
      JOIN backend_reservation.reservation_operation_client_snapshots s
        ON s.operation_id=o.operation_id AND s.owner_account_id=o.owner_account_id
      WHERE ${clause}
    `, values);
    if (result.rowCount === 0) return null;
    if (result.rowCount !== 1) throw new Error('invalid operation cardinality');
    return hydrateOperation(result.rows[0], this.crypto);
  }

  async findOperationById(transaction: PostgresTransaction, ownerAccountId: AccountId, operationId: ReservationOperationId) {
    try { return await this.findOperation(transaction, 'o.owner_account_id=$1 AND o.operation_id=$2', [ownerAccountId, operationId]); }
    catch (error) { throw persistenceError(error); }
  }

  async findOperationByIdempotencyKey(transaction: PostgresTransaction, ownerAccountId: AccountId, idempotencyKey: ReservationIdempotencyKey) {
    try { return await this.findOperation(transaction, 'o.owner_account_id=$1 AND o.idempotency_key=$2', [ownerAccountId, idempotencyKey]); }
    catch (error) { throw persistenceError(error); }
  }

  async startOperation(transaction: PostgresTransaction, actorAccountId: AccountId, reservationId: CourtReservationId, input: StartReservationOperationInput): Promise<StartReservationOperationResult> {
    try {
      await this.lockIdempotencyKey(transaction, actorAccountId, input.idempotencyKey);
      const selected = await transaction.query<ReservationRow>(`SELECT ${RESERVATION_COLUMNS} FROM backend_reservation.court_reservations WHERE owner_account_id=$1 AND reservation_id=$2 FOR UPDATE`, [actorAccountId, reservationId]);
      if (selected.rowCount !== 1) throw new CourtReservationPersistenceError('invalid_input');
      const reservation = hydrateReservation(selected.rows[0], this.crypto);
      const existing = await this.findOperationByIdempotencyKey(transaction, actorAccountId, input.idempotencyKey);
      const transition = startReservationOperation(reservation, input, existing ?? undefined);
      if (transition.outcome !== 'started') return transition;
      if (transition.operation.request.type !== 'create') {
        throw new CourtReservationPersistenceError('invalid_input');
      }
      const snapshotJson = JSON.stringify(transition.operation.request.client);
      const encrypted = this.crypto.encryptClientSnapshot(transition.operation.operationId, actorAccountId, snapshotJson);
      const updated = await transaction.query(`UPDATE backend_reservation.court_reservations SET status=$3,target_service_id=$4,target_resource_id=$5,target_datetime=$6::text::timestamptz,target_datetime_text=$6::text,target_end_datetime=$7::text::timestamptz,target_end_datetime_text=$7::text,version=$8,updated_at=$9,status_changed_at=$9 WHERE owner_account_id=$1 AND reservation_id=$2 AND version=$10`, [actorAccountId,reservationId,transition.reservation.status,transition.reservation.target.serviceId,transition.reservation.target.courtId,transition.reservation.target.startsAt,transition.reservation.target.endsAt,transition.reservation.version,transition.reservation.updatedAt,reservation.version]);
      if (updated.rowCount !== 1) throw new CourtReservationPersistenceError('transaction_conflict');
      await transaction.query(`INSERT INTO backend_reservation.reservation_operations (operation_id,reservation_id,owner_account_id,actor_account_id,operation_type,status,idempotency_key,request_digest,request_digest_version,yclients_company_id,external_api_id,target_service_id,target_resource_id,target_datetime,target_datetime_text,target_end_datetime,target_end_datetime_text,client_snapshot_digest,client_snapshot_digest_key_version,previous_reservation_status,version,created_at,updated_at) VALUES ($1,$2,$3,$3,'create','pending',$4,$5,1,$6,$7,$8,$9,$10::text::timestamptz,$10::text,$11::text::timestamptz,$11::text,$12,$13,$14,1,$15,$15)`, [transition.operation.operationId,reservationId,actorAccountId,transition.operation.idempotencyKey,transition.operation.requestDigest,this.companyId,transition.operation.request.externalReference.apiId,transition.operation.request.target.serviceId,transition.operation.request.target.courtId,transition.operation.request.target.startsAt,transition.operation.request.target.endsAt,encrypted.digest,encrypted.digestKeyVersion,transition.operation.previousReservationStatus,transition.operation.createdAt]);
      await transaction.query(`INSERT INTO backend_reservation.reservation_operation_client_snapshots (operation_id,owner_account_id,ciphertext,nonce,auth_tag,algorithm,wrapped_data_key_ciphertext,wrapped_data_key_nonce,wrapped_data_key_auth_tag,wrapping_algorithm,wrapping_key_version,digest_key_version,aad_version,version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,$14)`, [transition.operation.operationId,actorAccountId,encrypted.ciphertext,encrypted.nonce,encrypted.authTag,encrypted.algorithm,encrypted.wrappedDataKeyCiphertext,encrypted.wrappedDataKeyNonce,encrypted.wrappedDataKeyAuthTag,encrypted.wrappingAlgorithm,encrypted.wrappingKeyVersion,encrypted.digestKeyVersion,encrypted.aadVersion,transition.operation.createdAt]);
      await transaction.query(`INSERT INTO backend_reservation.reservation_slot_holds (hold_id,reservation_id,owner_account_id,hold_kind,yclients_company_id,target_service_id,target_resource_id,starts_at,ends_at,version,created_at,updated_at) VALUES ($1,$2,$3,'reservation',$4,$5,$6,$7::timestamptz,$8::timestamptz,1,$9,$9)`, [newInternalUuid(),reservationId,actorAccountId,this.companyId,transition.operation.request.target.serviceId,transition.operation.request.target.courtId,transition.operation.request.target.startsAt,transition.operation.request.target.endsAt,transition.operation.createdAt]);
      return transition;
    } catch (error) { throw persistenceError(error); }
  }

  private async persistTransition(
    transaction: PostgresTransaction,
    actorAccountId: AccountId,
    reservationId: CourtReservationId,
    operationId: ReservationOperationId,
    previousReservation: CourtReservation,
    previousOperation: ReservationOperation,
    command: ReservationOperationTransitionCommand,
    transition: Extract<ReservationOperationTransitionResult, { outcome: 'transitioned' }>,
  ): Promise<ReservationOperationTransitionResult> {
    let stage: CourtReservationPersistenceStage = 'record_hash_encryption';
    try {
      const binding = transition.reservation.providerBinding;
      const encrypted = binding === undefined
        ? undefined
        : this.crypto.encryptRecordHash(binding.recordHash);
      stage = 'reservation_update';
      const updated = await transaction.query(`UPDATE backend_reservation.court_reservations SET status=$3,target_service_id=$4,target_resource_id=$5,target_datetime=$6::text::timestamptz,target_datetime_text=$6::text,target_end_datetime=$7::text::timestamptz,target_end_datetime_text=$7::text,yclients_appointment_id=$8,yclients_record_id=$9,yclients_record_hash_ciphertext=$10,yclients_record_hash_nonce=$11,yclients_record_hash_auth_tag=$12,yclients_record_hash_algorithm=$13,yclients_record_hash_encryption_key_version=$14,yclients_record_hash_digest=$15,yclients_record_hash_digest_key_version=$16,version=$17,updated_at=$18,status_changed_at=$18,terminal_at=$19 WHERE owner_account_id=$1 AND reservation_id=$2 AND version=$20`, [actorAccountId,reservationId,transition.reservation.status,transition.reservation.target.serviceId,transition.reservation.target.courtId,transition.reservation.target.startsAt,transition.reservation.target.endsAt,binding?.appointmentId??null,binding?.recordId??null,encrypted?.ciphertext??null,encrypted?.nonce??null,encrypted?.authTag??null,encrypted?.algorithm??null,encrypted?.keyVersion??null,encrypted?.digest??null,encrypted?.digestKeyVersion??null,transition.reservation.version,transition.reservation.updatedAt,['cancelled','rejected'].includes(transition.reservation.status)?transition.reservation.updatedAt:null,previousReservation.version]);
      if (updated.rowCount !== 1) throw new CourtReservationPersistenceError('transaction_conflict', stage);
      const opBinding = 'providerBinding' in transition.operation ? transition.operation.providerBinding : undefined;
      stage = 'record_hash_encryption';
      const opEncrypted = opBinding === undefined ? undefined : this.crypto.encryptRecordHash(opBinding.recordHash);
      const result = 'result' in transition.operation ? transition.operation.result : undefined;
      const reason = 'reason' in transition.operation ? transition.operation.reason : result?.outcome === 'rejected' ? result.reason : null;
      stage = 'operation_update';
      const operationUpdated = await transaction.query(`UPDATE backend_reservation.reservation_operations SET status=$4,provider_appointment_id=$5,provider_record_id=$6,provider_record_hash_ciphertext=$7,provider_record_hash_nonce=$8,provider_record_hash_auth_tag=$9,provider_record_hash_algorithm=$10,provider_record_hash_encryption_key_version=$11,provider_record_hash_digest=$12,provider_record_hash_digest_key_version=$13,provider_attempt_finished_at=CASE WHEN provider_attempt_started_at IS NULL THEN NULL::bigint ELSE $14::bigint END,unknown_at=$15,terminal_at=$16,reconciled_at=$17,reconciliation_outcome=$18,rejection_reason=$19,version=version+1,updated_at=$14 WHERE owner_account_id=$1 AND reservation_id=$2 AND operation_id=$3 AND status=$20`, [actorAccountId,reservationId,operationId,transition.operation.status,opBinding?.appointmentId??null,opBinding?.recordId??null,opEncrypted?.ciphertext??null,opEncrypted?.nonce??null,opEncrypted?.authTag??null,opEncrypted?.algorithm??null,opEncrypted?.keyVersion??null,opEncrypted?.digest??null,opEncrypted?.digestKeyVersion??null,command.now,transition.operation.status==='unknown' ? command.now : 'uncertainAt' in transition.operation ? transition.operation.uncertainAt : null,'terminalAt' in transition.operation?transition.operation.terminalAt:null,transition.operation.status==='reconciled'?transition.operation.terminalAt:null,result?.outcome??null,reason,previousOperation.status]);
      if (operationUpdated.rowCount !== 1) throw new CourtReservationPersistenceError('transaction_conflict', stage);
      if (transition.reservation.status === 'rejected' || transition.reservation.status === 'cancelled') {
        stage = 'slot_hold_release';
        const released = await transaction.query(`UPDATE backend_reservation.reservation_slot_holds SET released_at=$3,updated_at=$3,version=version+1 WHERE owner_account_id=$1 AND reservation_id=$2 AND released_at IS NULL`, [actorAccountId,reservationId,command.now]);
        if (released.rowCount !== 1) throw new CourtReservationPersistenceError('invalid_persisted_state', stage);
      }
      return transition;
    } catch (error) {
      throw persistenceError(error, stage);
    }
  }

  async transitionOperation(transaction: PostgresTransaction, actorAccountId: AccountId, reservationId: CourtReservationId, operationId: ReservationOperationId, command: ReservationOperationTransitionCommand): Promise<ReservationOperationTransitionResult> {
    let stage: CourtReservationPersistenceStage = 'reservation_lock';
    try {
      const selected = await transaction.query<ReservationRow>(`SELECT ${RESERVATION_COLUMNS} FROM backend_reservation.court_reservations WHERE owner_account_id=$1 AND reservation_id=$2 FOR UPDATE`, [actorAccountId,reservationId]);
      if (selected.rowCount !== 1) throw new CourtReservationPersistenceError('invalid_input', stage);
      stage = 'reservation_hydration';
      const reservation = hydrateReservation(selected.rows[0], this.crypto);
      stage = 'operation_hydration';
      const operation = await this.findOperationById(transaction, actorAccountId, operationId);
      if (operation === null) throw new CourtReservationPersistenceError('invalid_input', stage);
      stage = 'domain_transition';
      const transition = transitionReservationOperation(reservation, operation, command);
      if (transition.outcome !== 'transitioned') return transition;
      return this.persistTransition(transaction, actorAccountId, reservationId, operationId, reservation, operation, command, transition);
    } catch (error) { throw persistenceError(error, stage); }
  }

  async finalizeStartedCreateOperation(
    transaction: PostgresTransaction,
    actorAccountId: AccountId,
    reservationId: CourtReservationId,
    expectedOperation: ReservationOperation,
    command:
      | Extract<ReservationOperationTransitionCommand, { type: 'confirm' }>
      | Extract<ReservationOperationTransitionCommand, { type: 'mark_unknown' }>,
  ): Promise<ReservationOperationTransitionResult> {
    let stage: CourtReservationPersistenceStage = 'reservation_lock';
    try {
      if (
        expectedOperation.status !== 'pending' ||
        expectedOperation.type !== 'create' ||
        expectedOperation.request.type !== 'create' ||
        (command.type !== 'confirm' && command.type !== 'mark_unknown')
      ) {
        throw new CourtReservationPersistenceError(
          'invalid_input',
          'operation_control_validation',
        );
      }
      const selected = await transaction.query<ReservationRow>(`SELECT ${RESERVATION_COLUMNS} FROM backend_reservation.court_reservations WHERE owner_account_id=$1 AND reservation_id=$2 FOR UPDATE`, [actorAccountId,reservationId]);
      if (selected.rowCount !== 1) throw new CourtReservationPersistenceError('invalid_input', stage);
      stage = 'reservation_hydration';
      const reservation = hydrateReservation(selected.rows[0], this.crypto);
      stage = 'operation_lock';
      const operationResult = await transaction.query<StartedCreateOperationControlRow>(`SELECT ${STARTED_CREATE_OPERATION_CONTROL_COLUMNS} FROM backend_reservation.reservation_operations WHERE owner_account_id=$1 AND reservation_id=$2 AND operation_id=$3 FOR UPDATE`, [actorAccountId,reservationId,expectedOperation.operationId]);
      if (operationResult.rowCount !== 1) throw new CourtReservationPersistenceError('invalid_input', stage);
      stage = 'operation_control_validation';
      const control = assertStartedCreateOperationControl(
        operationResult.rows[0],
        expectedOperation,
      );
      const effectiveNow = unixEpochSeconds(Math.max(
        Number(command.now),
        Number(reservation.updatedAt),
        Number(expectedOperation.createdAt),
        Number(control.providerAttemptStartedAt),
        Number(control.operationUpdatedAt),
      ));
      const effectiveCommand = Object.freeze({ ...command, now: effectiveNow });
      stage = 'domain_transition';
      const transition = transitionReservationOperation(
        reservation,
        expectedOperation,
        effectiveCommand,
      );
      if (transition.outcome !== 'transitioned') return transition;
      return this.persistTransition(transaction, actorAccountId, reservationId, expectedOperation.operationId, reservation, expectedOperation, effectiveCommand, transition);
    } catch (error) {
      throw persistenceError(error, stage);
    }
  }

  async claimProviderAttempt(transaction: PostgresTransaction, ownerAccountId: AccountId, operationId: ReservationOperationId, now: number): Promise<'claimed'|'already_started'|'not_pending'> {
    try {
      const updated = await transaction.query(`UPDATE backend_reservation.reservation_operations SET provider_attempt_started_at=$3,updated_at=$3,version=version+1 WHERE owner_account_id=$1 AND operation_id=$2 AND status='pending' AND provider_attempt_started_at IS NULL RETURNING operation_id`, [ownerAccountId,operationId,now]);
      if (updated.rowCount === 1) return 'claimed';
      const selected = await transaction.query<OperationRow>(`SELECT status,provider_attempt_started_at FROM backend_reservation.reservation_operations WHERE owner_account_id=$1 AND operation_id=$2`, [ownerAccountId,operationId]);
      if (selected.rowCount !== 1) return 'not_pending';
      return selected.rows[0].status === 'pending' && selected.rows[0].provider_attempt_started_at !== null ? 'already_started' : 'not_pending';
    } catch (error) { throw persistenceError(error); }
  }

  async readProviderAttempt(transaction: PostgresTransaction, ownerAccountId: AccountId, operationId: ReservationOperationId): Promise<ReservationProviderAttempt | null> {
    try {
      const selected = await transaction.query<OperationRow>(`SELECT status,external_api_id,provider_attempt_started_at,provider_attempt_finished_at,created_at FROM backend_reservation.reservation_operations WHERE owner_account_id=$1 AND operation_id=$2`, [ownerAccountId,operationId]);
      if (selected.rowCount !== 1) return null;
      const row=selected.rows[0];
      return Object.freeze({ operationId, status: readOperationStatus(row.status), apiId: readPositive(row.external_api_id), createdAt:Number(readEpoch(row.created_at)), ...(row.provider_attempt_started_at===null?{}:{startedAt:Number(readEpoch(row.provider_attempt_started_at))}), ...(row.provider_attempt_finished_at===null?{}:{finishedAt:Number(readEpoch(row.provider_attempt_finished_at))}) });
    } catch (error) { throw persistenceError(error); }
  }

  async readLatestCreateAttempt(
    transaction: PostgresTransaction,
    ownerAccountId: AccountId,
    reservationId: CourtReservationId,
  ): Promise<ReservationProviderAttempt | null> {
    try {
      const reservationLock = await transaction.query<{ reservation_id: unknown }>(`
        SELECT reservation_id
        FROM backend_reservation.court_reservations
        WHERE owner_account_id=$1 AND reservation_id=$2
        FOR UPDATE
      `, [ownerAccountId, reservationId]);
      if (reservationLock.rowCount !== 1) return null;
      const selected = await transaction.query<OperationRow>(`
        SELECT operation_id,status,external_api_id,
               provider_attempt_started_at,provider_attempt_finished_at,created_at
        FROM backend_reservation.reservation_operations
        WHERE owner_account_id=$1 AND reservation_id=$2 AND operation_type='create'
        ORDER BY created_at DESC,operation_id DESC LIMIT 1
        FOR UPDATE
      `, [ownerAccountId,reservationId]);
      if(selected.rowCount!==1) return null;
      const row=selected.rows[0];
      return Object.freeze({operationId:reservationOperationId(String(row.operation_id)),status:readOperationStatus(row.status),apiId:readPositive(row.external_api_id),createdAt:Number(readEpoch(row.created_at)),...(row.provider_attempt_started_at===null?{}:{startedAt:Number(readEpoch(row.provider_attempt_started_at))}),...(row.provider_attempt_finished_at===null?{}:{finishedAt:Number(readEpoch(row.provider_attempt_finished_at))})});
    } catch(error){throw persistenceError(error);}
  }

  async claimUnknownCreateReconciliation(
    transaction: PostgresTransaction,
    ownerAccountId: AccountId,
    reservationId: CourtReservationId,
    now: number,
  ): Promise<ReservationProviderAttempt | null> {
    try {
      const claimed = await transaction.query<OperationRow>(`
        UPDATE backend_reservation.reservation_operations
        SET reconciliation_attempts=reconciliation_attempts+1,
            last_reconciliation_at=$3, updated_at=$3, version=version+1
        WHERE owner_account_id=$1
          AND operation_id=(
            SELECT operation_id
            FROM backend_reservation.reservation_operations
            WHERE owner_account_id=$1 AND reservation_id=$2
              AND operation_type='create'
            ORDER BY created_at DESC, operation_id DESC LIMIT 1
          )
          AND status='unknown'
          AND reconciliation_attempts=0
          AND last_reconciliation_at IS NULL
        RETURNING operation_id,status,external_api_id,
                  provider_attempt_started_at,provider_attempt_finished_at,
                  created_at
      `, [ownerAccountId, reservationId, now]);
      if (claimed.rowCount !== 1) return null;
      const row = claimed.rows[0];
      return Object.freeze({
        operationId: reservationOperationId(String(row.operation_id)),
        status: readOperationStatus(row.status),
        apiId: readPositive(row.external_api_id),
        createdAt: Number(readEpoch(row.created_at)),
        ...(row.provider_attempt_started_at === null
          ? {}
          : { startedAt: Number(readEpoch(row.provider_attempt_started_at)) }),
        ...(row.provider_attempt_finished_at === null
          ? {}
          : { finishedAt: Number(readEpoch(row.provider_attempt_finished_at)) }),
      });
    } catch (error) {
      throw persistenceError(error);
    }
  }

  async applyExactRefresh(transaction: PostgresTransaction, ownerAccountId: AccountId, reservationId: CourtReservationId, input: ReservationRefreshInput): Promise<ReservationRefreshPersistenceResult> {
    try {
      const selected = await transaction.query<ReservationRow>(`SELECT ${RESERVATION_COLUMNS} FROM backend_reservation.court_reservations WHERE owner_account_id=$1 AND reservation_id=$2 FOR UPDATE`, [ownerAccountId,reservationId]);
      if (selected.rowCount !== 1) return Object.freeze({ outcome:'not_found' });
      const reservation=hydrateReservation(selected.rows[0],this.crypto);
      if (
        input.companyId!==this.companyId ||
        (reservation.status!=='confirmed' && reservation.status!=='cancelled') ||
        reservation.providerBinding?.recordId!==input.recordId
      ) return Object.freeze({outcome:'binding_mismatch'});
      const operation=await this.findOperation(transaction,`o.owner_account_id=$1 AND o.reservation_id=$2 AND o.operation_type='create' ORDER BY o.created_at DESC LIMIT 1`,[ownerAccountId,reservationId]);
      if (
        operation===null ||
        !matchesRefreshBindingProof(
          input.proof,
          input.deleted,
          input.recordId,
          operation,
        )
      ) return Object.freeze({outcome:'binding_mismatch'});
      if (!isReservationTarget({ serviceId: input.serviceId, courtId: input.courtId, startsAt: input.startsAt, endsAt: input.endsAt })) return Object.freeze({outcome:'binding_mismatch'});
      const targetAlreadyCurrent =
        reservation.target.serviceId===input.serviceId &&
        reservation.target.courtId===input.courtId &&
        Date.parse(reservation.target.startsAt)===Date.parse(input.startsAt) &&
        Date.parse(reservation.target.endsAt)===Date.parse(input.endsAt);
      const effectAlreadyCurrent = targetAlreadyCurrent && (
        (!input.deleted && reservation.status==='confirmed') ||
        (input.deleted && reservation.status==='cancelled')
      );
      if (effectAlreadyCurrent) {
        const activeHolds=await transaction.query<{active_count:string;matching_count:string}>(`SELECT COUNT(*)::text AS active_count,COUNT(*) FILTER (WHERE yclients_company_id=$3 AND target_service_id=$4 AND target_resource_id=$5 AND starts_at=$6::text::timestamptz AND ends_at=$7::text::timestamptz)::text AS matching_count FROM backend_reservation.reservation_slot_holds WHERE owner_account_id=$1 AND reservation_id=$2 AND hold_kind='reservation' AND released_at IS NULL`,[ownerAccountId,reservationId,this.companyId,input.serviceId,input.courtId,input.startsAt,input.endsAt]);
        if(activeHolds.rowCount!==1) throw new CourtReservationPersistenceError('invalid_persisted_state');
        const activeCount=Number(activeHolds.rows[0].active_count);
        const matchingCount=Number(activeHolds.rows[0].matching_count);
        const holdAlreadyCurrent=input.deleted
          ? activeCount===0 && matchingCount===0
          : activeCount===1 && matchingCount===1;
        if(!holdAlreadyCurrent) return Object.freeze({outcome:'binding_mismatch'});
        const reconciled=await transaction.query(`UPDATE backend_reservation.reservation_operations SET reconciliation_attempts=reconciliation_attempts+1,last_reconciliation_at=$3,updated_at=$3,version=version+1 WHERE owner_account_id=$1 AND operation_id=$2`,[ownerAccountId,operation.operationId,input.now]);
        if(reconciled.rowCount!==1) throw new CourtReservationPersistenceError('transaction_conflict');
        return Object.freeze({outcome:'updated',reservation});
      }
      if (
        reservation.status!=='confirmed' ||
        reservation.version!==input.expectedVersion
      ) return Object.freeze({outcome:'binding_mismatch'});
      const nextStatus=input.deleted?'cancelled':'confirmed';
      const updated=await transaction.query(`UPDATE backend_reservation.court_reservations SET status=$3,target_service_id=$4,target_resource_id=$5,target_datetime=$6::text::timestamptz,target_datetime_text=$6::text,target_end_datetime=$7::text::timestamptz,target_end_datetime_text=$7::text,version=version+1,updated_at=$8,status_changed_at=CASE WHEN status<>$3 THEN $8 ELSE status_changed_at END,terminal_at=CASE WHEN $3='cancelled' THEN $8 ELSE NULL END WHERE owner_account_id=$1 AND reservation_id=$2`,[ownerAccountId,reservationId,nextStatus,input.serviceId,input.courtId,input.startsAt,input.endsAt,input.now]);
      if(updated.rowCount!==1) throw new CourtReservationPersistenceError('transaction_conflict');
      if(input.deleted){const released=await transaction.query(`UPDATE backend_reservation.reservation_slot_holds SET released_at=$3,updated_at=$3,version=version+1 WHERE owner_account_id=$1 AND reservation_id=$2 AND released_at IS NULL`,[ownerAccountId,reservationId,input.now]);if(released.rowCount!==1) throw new CourtReservationPersistenceError('invalid_persisted_state');}
      else {
        const released = await transaction.query(`UPDATE backend_reservation.reservation_slot_holds SET released_at=$3,updated_at=$3,version=version+1 WHERE owner_account_id=$1 AND reservation_id=$2 AND hold_kind='reservation' AND released_at IS NULL`,[ownerAccountId,reservationId,input.now]);
        if (released.rowCount !== 1) throw new CourtReservationPersistenceError('invalid_persisted_state');
        await transaction.query(`INSERT INTO backend_reservation.reservation_slot_holds (hold_id,reservation_id,owner_account_id,hold_kind,yclients_company_id,target_service_id,target_resource_id,starts_at,ends_at,version,created_at,updated_at) VALUES ($1,$2,$3,'reservation',$4,$5,$6,$7::timestamptz,$8::timestamptz,1,$9,$9)`,[newInternalUuid(),reservationId,ownerAccountId,this.companyId,input.serviceId,input.courtId,input.startsAt,input.endsAt,input.now]);
      }
      await transaction.query(`UPDATE backend_reservation.reservation_operations SET reconciliation_attempts=reconciliation_attempts+1,last_reconciliation_at=$3,updated_at=$3,version=version+1 WHERE owner_account_id=$1 AND operation_id=$2`,[ownerAccountId,operation.operationId,input.now]);
      const refreshed=await this.findById(transaction,ownerAccountId,reservationId);
      if(refreshed===null) throw new CourtReservationPersistenceError('invalid_persisted_state');
      return Object.freeze({outcome:'updated',reservation:refreshed});
    } catch(error){throw persistenceError(error);}
  }

  async noteReconciliationAttempt(
    transaction: PostgresTransaction,
    ownerAccountId: AccountId,
    reservationId: CourtReservationId,
    now: number,
  ): Promise<void> {
    try {
      await transaction.query(`
        UPDATE backend_reservation.reservation_operations
        SET reconciliation_attempts=reconciliation_attempts+1,
            last_reconciliation_at=$3, updated_at=$3, version=version+1
        WHERE operation_id=(
          SELECT operation_id FROM backend_reservation.reservation_operations
          WHERE owner_account_id=$1 AND reservation_id=$2 AND operation_type='create'
          ORDER BY created_at DESC, operation_id DESC LIMIT 1
        )
      `, [ownerAccountId, reservationId, now]);
    } catch (error) { throw persistenceError(error); }
  }
}
