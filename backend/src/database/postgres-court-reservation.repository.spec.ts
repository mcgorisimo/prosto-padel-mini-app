import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { ReservationSnapshotCrypto } from '../reservations/reservation-snapshot.crypto';
import { digestReservationOperationRequest } from '../reservations/reservation-request-digest';
import {
  createCourtReservation,
  startReservationOperation,
} from '../reservations/reservation.state-machine';
import {
  CourtReservation,
  ReservationIdempotencyKey,
  ReservationOperationRequest,
  ReservationOperationId,
} from '../reservations/reservation.types';
import { PostgresCourtReservationRepository } from './postgres-court-reservation.repository';

const OWNER = deterministicUuid('postgres-reservation-owner') as AccountId;
const RESERVATION_ID = deterministicUuid('postgres-reservation') as CourtReservation['reservationId'];
const OPERATION_ID = deterministicUuid('postgres-reservation-operation') as ReservationOperationId;
const REQUEST_KEY = deterministicUuid('postgres-reservation-request') as ReservationIdempotencyKey;

function result(rows: readonly Record<string, unknown>[] = []) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

describe('PostgresCourtReservationRepository SQL contract', () => {
  it('serializes each owner-scoped idempotency key with a transaction advisory lock', async () => {
    const query = jest.fn().mockResolvedValue(result([{ locked: null }]));
    const repository = new PostgresCourtReservationRepository(ReservationSnapshotCrypto.disabled(), 2_079_564);
    await repository.lockIdempotencyKey({ query } as never, OWNER, REQUEST_KEY);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(query.mock.calls[0][1]).toEqual([OWNER, REQUEST_KEY]);
  });

  it('claims a provider attempt once with a pending/status CAS and never issues provider work itself', async () => {
    const query = jest.fn().mockResolvedValueOnce(result([{ operation_id: OPERATION_ID }]));
    const repository = new PostgresCourtReservationRepository(ReservationSnapshotCrypto.disabled(), 2_079_564);
    await expect(repository.claimProviderAttempt({ query } as never, OWNER, OPERATION_ID, 1_800_000_000)).resolves.toBe('claimed');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("status='pending'");
    expect(query.mock.calls[0][0]).toContain('provider_attempt_started_at IS NULL');
    expect(query.mock.calls[0][1]).toEqual([OWNER, OPERATION_ID, 1_800_000_000]);
  });

  it('atomically caps unknown-create reconciliation to one persisted provider scan', async () => {
    const query = jest.fn().mockResolvedValueOnce(result([]));
    const repository = new PostgresCourtReservationRepository(ReservationSnapshotCrypto.disabled(), 2_079_564);
    await expect(repository.claimUnknownCreateReconciliation(
      { query } as never,
      OWNER,
      RESERVATION_ID,
      1_800_000_000,
    )).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
    const sql = String(query.mock.calls[0][0]).replace(/\s+/gu, ' ');
    expect(sql).toContain("status='unknown'");
    expect(sql).not.toContain("status IN ('pending','unknown')");
    expect(sql).toContain('reconciliation_attempts=0');
    expect(sql).toContain('last_reconciliation_at IS NULL');
    expect(sql).toContain('RETURNING operation_id,status,external_api_id');
  });

  it('locks reservation then pending create operation before classifying a missing dispatch marker', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(result([{ reservation_id: RESERVATION_ID }]))
      .mockResolvedValueOnce(result([]));
    const repository = new PostgresCourtReservationRepository(ReservationSnapshotCrypto.disabled(), 2_079_564);

    await expect(repository.readLatestCreateAttempt(
      { query } as never,
      OWNER,
      RESERVATION_ID,
    )).resolves.toBeNull();

    expect(query).toHaveBeenCalledTimes(2);
    const reservationLock = String(query.mock.calls[0][0]).replace(/\s+/gu, ' ');
    const operationLock = String(query.mock.calls[1][0]).replace(/\s+/gu, ' ');
    expect(reservationLock).toContain('FROM backend_reservation.court_reservations');
    expect(reservationLock).toContain('FOR UPDATE');
    expect(operationLock).toContain("operation_type='create'");
    expect(operationLock).toContain('FOR UPDATE');
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(
      query.mock.invocationCallOrder[1],
    );
  });

  it('hydrates pg int4 crypto metadata without weakening bigint decoding', async () => {
    const crypto = new ReservationSnapshotCrypto(Buffer.alloc(32, 7), 1);
    const client = Object.freeze({
      phone: '+79800000000',
      fullName: 'Test Player',
      email: 'private.owner@example.test',
    });
    const request: ReservationOperationRequest = Object.freeze({
      type: 'create',
      reservationId: RESERVATION_ID,
      ownerAccountId: OWNER,
      externalReference: Object.freeze({ apiId: 77 }),
      client,
      target: Object.freeze({
        serviceId: 11,
        courtId: 22,
        startsAt: '2027-01-15T10:00:00+03:00',
        endsAt: '2027-01-15T11:00:00+03:00',
      }),
    });
    const encrypted = crypto.encryptClientSnapshot(
      OPERATION_ID,
      OWNER,
      JSON.stringify(client),
    );
    const row = {
      operation_id: OPERATION_ID,
      reservation_id: RESERVATION_ID,
      owner_account_id: OWNER,
      actor_account_id: OWNER,
      operation_type: 'create',
      status: 'pending',
      idempotency_key: REQUEST_KEY,
      request_digest: digestReservationOperationRequest(request),
      external_api_id: '77',
      target_service_id: '11',
      target_resource_id: '22',
      target_datetime_text: request.target.startsAt,
      target_end_datetime_text: request.target.endsAt,
      provider_appointment_id: null,
      provider_record_id: null,
      provider_record_hash_ciphertext: null,
      provider_record_hash_nonce: null,
      provider_record_hash_auth_tag: null,
      provider_record_hash_algorithm: null,
      provider_record_hash_encryption_key_version: null,
      provider_record_hash_digest: null,
      provider_record_hash_digest_key_version: null,
      previous_reservation_status: 'unbooked',
      provider_attempt_started_at: '1800000001',
      provider_attempt_finished_at: null,
      unknown_at: null,
      terminal_at: null,
      reconciled_at: null,
      reconciliation_outcome: null,
      rejection_reason: null,
      created_at: '1800000000',
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      auth_tag: encrypted.authTag,
      algorithm: encrypted.algorithm,
      wrapped_data_key_ciphertext: encrypted.wrappedDataKeyCiphertext,
      wrapped_data_key_nonce: encrypted.wrappedDataKeyNonce,
      wrapped_data_key_auth_tag: encrypted.wrappedDataKeyAuthTag,
      wrapping_algorithm: encrypted.wrappingAlgorithm,
      wrapping_key_version: encrypted.wrappingKeyVersion,
      client_snapshot_digest: encrypted.digest,
      client_snapshot_digest_key_version: encrypted.digestKeyVersion,
      aad_version: encrypted.aadVersion,
    };
    const query = jest.fn().mockResolvedValue(result([row]));
    const repository = new PostgresCourtReservationRepository(
      crypto,
      2_079_564,
    );

    await expect(
      repository.findOperationById(
        { query } as never,
        OWNER,
        OPERATION_ID,
      ),
    ).resolves.toMatchObject({
      status: 'pending',
      requestDigest: row.request_digest,
      request: {
        externalReference: { apiId: 77 },
        target: request.target,
      },
    });
  });

  it('hydrates pg int4 provider-hash key versions for a confirmed reservation', async () => {
    const crypto = new ReservationSnapshotCrypto(Buffer.alloc(32, 9), 1);
    const encrypted = crypto.encryptRecordHash(
      '0123456789abcdef0123456789abcdef',
    );
    const row = {
      reservation_id: RESERVATION_ID,
      owner_account_id: OWNER,
      status: 'confirmed',
      target_service_id: '11',
      target_resource_id: '22',
      target_datetime_text: '2027-01-15T10:00:00+03:00',
      target_end_datetime_text: '2027-01-15T11:00:00+03:00',
      yclients_appointment_id: '1',
      yclients_record_id: '44',
      yclients_record_hash_ciphertext: encrypted.ciphertext,
      yclients_record_hash_nonce: encrypted.nonce,
      yclients_record_hash_auth_tag: encrypted.authTag,
      yclients_record_hash_algorithm: encrypted.algorithm,
      yclients_record_hash_encryption_key_version: encrypted.keyVersion,
      yclients_record_hash_digest: encrypted.digest,
      yclients_record_hash_digest_key_version: encrypted.digestKeyVersion,
      version: '3',
      created_at: '1800000000',
      updated_at: '1800000002',
    };
    const query = jest.fn().mockResolvedValue(result([row]));
    const repository = new PostgresCourtReservationRepository(
      crypto,
      2_079_564,
    );

    await expect(
      repository.findById({ query } as never, OWNER, RESERVATION_ID),
    ).resolves.toMatchObject({
      status: 'confirmed',
      providerBinding: {
        appointmentId: 1,
        recordId: 44,
        recordHash: '0123456789abcdef0123456789abcdef',
      },
    });
  });

  it('finalizes a claimed create from the persisted control row without decrypting client PII', async () => {
    const crypto = new ReservationSnapshotCrypto(Buffer.alloc(32, 11), 1);
    const target = Object.freeze({
      serviceId: 11,
      courtId: 22,
      startsAt: '2027-01-15T10:00:00+03:00',
      endsAt: '2027-01-15T11:00:00+03:00',
    });
    const initial = createCourtReservation({
      reservationId: RESERVATION_ID,
      ownerAccountId: OWNER,
      target,
      now: unixEpochSeconds(1_800_000_000),
    });
    const started = startReservationOperation(initial, {
      operationId: OPERATION_ID,
      actorAccountId: OWNER,
      idempotencyKey: REQUEST_KEY,
      now: unixEpochSeconds(1_800_000_000),
      request: {
        type: 'create',
        reservationId: RESERVATION_ID,
        ownerAccountId: OWNER,
        externalReference: { apiId: 77 },
        client: {
          phone: '+79800000000',
          fullName: 'Private Player',
          email: 'private.owner@example.test',
        },
        target,
      },
    });
    if (started.outcome !== 'started') throw new Error('invalid fixture');
    const reservationRow = {
      reservation_id: RESERVATION_ID,
      owner_account_id: OWNER,
      status: 'pending_confirmation',
      target_service_id: '11',
      target_resource_id: '22',
      target_datetime_text: target.startsAt,
      target_end_datetime_text: target.endsAt,
      yclients_appointment_id: null,
      yclients_record_id: null,
      yclients_record_hash_ciphertext: null,
      yclients_record_hash_nonce: null,
      yclients_record_hash_auth_tag: null,
      yclients_record_hash_algorithm: null,
      yclients_record_hash_encryption_key_version: null,
      yclients_record_hash_digest: null,
      yclients_record_hash_digest_key_version: null,
      version: '2',
      created_at: '1800000000',
      updated_at: '1800000000',
    };
    const controlRow = {
      operation_id: OPERATION_ID,
      reservation_id: RESERVATION_ID,
      owner_account_id: OWNER,
      actor_account_id: OWNER,
      operation_type: 'create',
      status: 'pending',
      idempotency_key: REQUEST_KEY,
      request_digest: started.operation.requestDigest,
      external_api_id: '77',
      target_service_id: '11',
      target_resource_id: '22',
      target_datetime_text: target.startsAt,
      target_end_datetime_text: target.endsAt,
      provider_appointment_id: null,
      provider_record_id: null,
      previous_reservation_status: 'unbooked',
      provider_attempt_started_at: '1800000001',
      provider_attempt_finished_at: null,
      created_at: '1800000000',
    };
    const query = jest.fn()
      .mockResolvedValueOnce(result([reservationRow]))
      .mockResolvedValueOnce(result([controlRow]))
      .mockResolvedValueOnce(result([{}]))
      .mockResolvedValueOnce(result([{}]));
    const repository = new PostgresCourtReservationRepository(
      crypto,
      2_079_564,
    );

    await expect(repository.finalizeStartedCreateOperation(
      { query } as never,
      OWNER,
      RESERVATION_ID,
      started.operation,
      {
        type: 'confirm',
        actorAccountId: OWNER,
        now: unixEpochSeconds(1_800_000_002),
        providerBinding: {
          provider: 'yclients',
          appointmentId: 33,
          recordId: 44,
          recordHash: 'private-hash',
        },
      },
    )).resolves.toMatchObject({
      outcome: 'transitioned',
      reservation: { status: 'confirmed' },
      operation: { status: 'confirmed' },
    });

    expect(query).toHaveBeenCalledTimes(4);
    const controlSql = String(query.mock.calls[1][0]).replace(/\s+/gu, ' ');
    expect(controlSql).toContain('reservation_operations');
    expect(controlSql).toContain('FOR UPDATE');
    expect(controlSql).not.toContain('reservation_operation_client_snapshots');
    expect(controlSql).not.toContain('ciphertext');
    const serializedQueries = JSON.stringify(query.mock.calls);
    expect(serializedQueries).not.toContain('Private Player');
    expect(serializedQueries).not.toContain('private.owner@example.test');
    expect(serializedQueries).not.toContain('+79800000000');
    expect(serializedQueries).not.toContain('private-hash');
  });

  it('fails closed before updates when the persisted control row differs from the started operation', async () => {
    const target = Object.freeze({
      serviceId: 11,
      courtId: 22,
      startsAt: '2027-01-15T10:00:00+03:00',
      endsAt: '2027-01-15T11:00:00+03:00',
    });
    const initial = createCourtReservation({
      reservationId: RESERVATION_ID,
      ownerAccountId: OWNER,
      target,
      now: unixEpochSeconds(1_800_000_000),
    });
    const started = startReservationOperation(initial, {
      operationId: OPERATION_ID,
      actorAccountId: OWNER,
      idempotencyKey: REQUEST_KEY,
      now: unixEpochSeconds(1_800_000_000),
      request: {
        type: 'create',
        reservationId: RESERVATION_ID,
        ownerAccountId: OWNER,
        externalReference: { apiId: 77 },
        client: {
          phone: '+79800000000',
          fullName: 'Private Player',
          email: 'private.owner@example.test',
        },
        target,
      },
    });
    if (started.outcome !== 'started') throw new Error('invalid fixture');
    const query = jest.fn()
      .mockResolvedValueOnce(result([{
        reservation_id: RESERVATION_ID,
        owner_account_id: OWNER,
        status: 'pending_confirmation',
        target_service_id: '11',
        target_resource_id: '22',
        target_datetime_text: target.startsAt,
        target_end_datetime_text: target.endsAt,
        yclients_appointment_id: null,
        yclients_record_id: null,
        yclients_record_hash_ciphertext: null,
        yclients_record_hash_nonce: null,
        yclients_record_hash_auth_tag: null,
        yclients_record_hash_algorithm: null,
        yclients_record_hash_encryption_key_version: null,
        yclients_record_hash_digest: null,
        yclients_record_hash_digest_key_version: null,
        version: '2',
        created_at: '1800000000',
        updated_at: '1800000000',
      }]))
      .mockResolvedValueOnce(result([{
        operation_id: OPERATION_ID,
        reservation_id: RESERVATION_ID,
        owner_account_id: OWNER,
        actor_account_id: OWNER,
        operation_type: 'create',
        status: 'pending',
        idempotency_key: REQUEST_KEY,
        request_digest: '0'.repeat(64),
        external_api_id: '77',
        target_service_id: '11',
        target_resource_id: '22',
        target_datetime_text: target.startsAt,
        target_end_datetime_text: target.endsAt,
        provider_appointment_id: null,
        provider_record_id: null,
        previous_reservation_status: 'unbooked',
        provider_attempt_started_at: '1800000001',
        provider_attempt_finished_at: null,
        created_at: '1800000000',
      }]));
    const repository = new PostgresCourtReservationRepository(
      new ReservationSnapshotCrypto(Buffer.alloc(32, 12), 1),
      2_079_564,
    );

    await expect(repository.finalizeStartedCreateOperation(
      { query } as never,
      OWNER,
      RESERVATION_ID,
      started.operation,
      {
        type: 'mark_unknown',
        actorAccountId: OWNER,
        now: unixEpochSeconds(1_800_000_002),
      },
    )).rejects.toMatchObject({
      reason: 'invalid_persisted_state',
      stage: 'operation_control_validation',
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('persists the exact interval/company binding without contact plaintext', async () => {
    const row = {
      reservation_id: RESERVATION_ID, owner_account_id: OWNER, status: 'unbooked',
      target_service_id: '11', target_resource_id: '22',
      target_datetime_text: '2027-01-15T10:00:00+03:00',
      target_end_datetime_text: '2027-01-15T11:00:00+03:00',
      yclients_appointment_id: null, yclients_record_id: null,
      yclients_record_hash_ciphertext: null, yclients_record_hash_nonce: null,
      yclients_record_hash_auth_tag: null, yclients_record_hash_algorithm: null,
      yclients_record_hash_encryption_key_version: null,
      yclients_record_hash_digest: null, yclients_record_hash_digest_key_version: null,
      version: '1', created_at: '1800000000', updated_at: '1800000000',
    };
    const query = jest.fn().mockResolvedValue(result([row]));
    const repository = new PostgresCourtReservationRepository(ReservationSnapshotCrypto.disabled(), 2_079_564);
    const reservation: CourtReservation = Object.freeze({
      reservationId: RESERVATION_ID, ownerAccountId: OWNER, status: 'unbooked',
      target: { serviceId: 11, courtId: 22, startsAt: row.target_datetime_text, endsAt: row.target_end_datetime_text },
      createdAt: unixEpochSeconds(1_800_000_000), updatedAt: unixEpochSeconds(1_800_000_000), version: 1,
    });
    await expect(repository.create({ query } as never, reservation)).resolves.toMatchObject({ outcome: 'created' });
    const insertSql = String(query.mock.calls[0][0]).replace(/\s+/gu, ' ');
    expect(insertSql).toContain('target_end_datetime');
    expect(insertSql).toContain(
      '$6::text::timestamptz,$6::text,$7::text::timestamptz,$7::text',
    );
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining([2_079_564, row.target_datetime_text, row.target_end_datetime_text]));
    expect(JSON.stringify(query.mock.calls)).not.toContain('private.owner@example.test');
  });

  it('preserves canonical ISO text before every paired timestamptz conversion', () => {
    const repositorySource = readFileSync(
      __filename.replace(/\.spec\.ts$/u, '.ts'),
      'utf8',
    );

    expect(repositorySource).not.toMatch(
      /\$(\d+)::timestamptz,\$\1(?:[,)]|\b)/u,
    );
    expect(repositorySource).not.toMatch(
      /target_(?:end_)?datetime=\$(\d+)::timestamptz,target_(?:end_)?datetime_text=\$\1/u,
    );
    expect(repositorySource.match(/::text::timestamptz/gu)).toHaveLength(10);
  });

  it('maps active interval overlap to a fail-closed transaction conflict', async () => {
    const query = jest.fn().mockRejectedValue({ code: '23P01', constraint: 'reservation_slot_holds_no_overlap' });
    const repository = new PostgresCourtReservationRepository(ReservationSnapshotCrypto.disabled(), 2_079_564);
    await expect(repository.lockIdempotencyKey({ query } as never, OWNER, REQUEST_KEY)).rejects.toMatchObject({ reason: 'transaction_conflict' });
  });

  it('replaces an immutable current hold by release plus insert during admin refresh', () => {
    const repositorySource = readFileSync(__filename.replace(/\.spec\.ts$/u, '.ts'), 'utf8')
      .replace(/\s+/gu, ' ')
      .toLowerCase();
    const migration = readFileSync(
      require.resolve('../../../docs/migrations/033_backend_reservation_persistence.sql'),
      'utf8',
    ).replace(/\s+/gu, ' ').toLowerCase();
    expect(migration).toContain('backend_reservation_slot_hold_binding_immutable');
    expect(repositorySource).not.toMatch(/update backend_reservation\.reservation_slot_holds set target_/u);
    expect(repositorySource).toContain("update backend_reservation.reservation_slot_holds set released_at=$3");
    expect(repositorySource).toContain('insert into backend_reservation.reservation_slot_holds');
  });
});
import { readFileSync } from 'node:fs';
