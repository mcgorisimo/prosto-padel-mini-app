import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import {
  EXTERNAL_IDENTITY_PROVIDERS,
  ExternalIdentityLookupDigest,
  ExternalIdentityNamespace,
  ExternalIdentityProvider,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
} from '../accounts/external-identity.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  AuthenticationIdempotencyKey,
  AuthenticationIntent,
  AuthenticationOperationId,
  AuthenticationProofFingerprint,
  AuthenticationRequestDigest,
  UnixEpochSeconds,
  isAuthenticationIdempotencyKey,
  isAuthenticationIntent,
  isAuthenticationOperationId,
  isAuthenticationProofFingerprint,
  isAuthenticationRequestDigest,
  isUnixEpochSeconds,
  unixEpochSeconds,
} from '../auth/auth.types';
import {
  AUTHENTICATION_OPERATION_FAILURE_REASONS,
  createAuthenticationOperation,
} from '../auth/authentication-operation.state-machine';
import {
  SecurityAuditEvent,
  SecurityAuditEventId,
  createSecurityAuditEvent,
  createSecurityAuditMetadata,
} from '../auth/security-audit.types';
import { consumeTelegramProof } from '../auth/telegram-proof-consumption.state-machine';
import {
  SecurityAuditPersistenceError,
  SecurityAuditRepository,
} from './security-audit.repository';
import {
  PostgresCodecError,
  decodePostgresByteaDigest,
  decodePostgresNonNegativeBigint,
  encodePostgresByteaDigest,
} from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import {
  PendingTelegramAuthenticationOperation,
  PersistPendingTelegramAuthenticationInput,
  TelegramAuthenticationOperationPersistenceError,
  TelegramAuthenticationOperationPersistenceFailure,
  TelegramAuthenticationOperationRepository,
  TelegramAuthenticationOperationResult,
} from './telegram-authentication-operation.repository';

const INSERT_OPERATION_SQL = `
  INSERT INTO backend_auth.authentication_operations (
    id,
    intent,
    identity_provider,
    identity_namespace,
    identity_lookup_digest,
    proof_type,
    telegram_proof_fingerprint,
    otp_challenge_id,
    created_at,
    expires_at,
    idempotency_key,
    request_digest
  )
  VALUES (
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9,
    $10,
    $11,
    $12
  )
  ON CONFLICT DO NOTHING
  RETURNING id
`;

const SELECT_MATCHING_OPERATIONS_SQL = `
  SELECT
    id,
    intent,
    identity_provider,
    identity_namespace,
    identity_lookup_digest,
    proof_type,
    telegram_proof_fingerprint,
    otp_challenge_id,
    created_at,
    expires_at,
    idempotency_key,
    request_digest,
    status,
    resolution_type,
    resolution_account_id,
    resolution_account_status,
    resolution_initial_role,
    resolution_reason,
    failure_reason,
    terminal_command_id,
    terminal_command_type,
    terminal_applied_at
  FROM backend_auth.authentication_operations
  WHERE id = $1
     OR idempotency_key = $2
     OR telegram_proof_fingerprint = $3
  ORDER BY id
`;

const SELECT_MATCHING_CONSUMPTIONS_SQL = `
  SELECT
    proof_fingerprint,
    proof_expires_at,
    intent,
    idempotency_key,
    request_digest,
    operation_id,
    consumed_at
  FROM backend_auth.telegram_proof_consumptions
  WHERE operation_id = $1
     OR idempotency_key = $2
     OR proof_fingerprint = $3
  ORDER BY operation_id, proof_fingerprint
`;

const INSERT_CONSUMPTION_SQL = `
  INSERT INTO backend_auth.telegram_proof_consumptions (
    proof_fingerprint,
    proof_expires_at,
    intent,
    idempotency_key,
    request_digest,
    operation_id,
    consumed_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7)
`;

const AUTHENTICATION_OPERATION_STATUSES = Object.freeze([
  'pending',
  'completed',
  'failed',
  'expired',
] as const);
const RESOLUTION_TYPES = Object.freeze([
  'existing_account',
  'new_account_required',
  'blocked',
  'conflict',
] as const);
const CONFLICT_RESOLUTION_REASONS = Object.freeze([
  'identity_already_linked_incompatibly',
  'ambiguous_account_resolution',
  'account_anonymized',
  'intent_incompatible_with_current_binding',
] as const);
const EPOCH_ZERO = unixEpochSeconds(0);

interface InsertedOperationRow extends QueryResultRow {
  readonly id: unknown;
}

interface AuthenticationOperationRow extends QueryResultRow {
  readonly id: unknown;
  readonly intent: unknown;
  readonly identity_provider: unknown;
  readonly identity_namespace: unknown;
  readonly identity_lookup_digest: unknown;
  readonly proof_type: unknown;
  readonly telegram_proof_fingerprint: unknown;
  readonly otp_challenge_id: unknown;
  readonly created_at: unknown;
  readonly expires_at: unknown;
  readonly idempotency_key: unknown;
  readonly request_digest: unknown;
  readonly status: unknown;
  readonly resolution_type: unknown;
  readonly resolution_account_id: unknown;
  readonly resolution_account_status: unknown;
  readonly resolution_initial_role: unknown;
  readonly resolution_reason: unknown;
  readonly failure_reason: unknown;
  readonly terminal_command_id: unknown;
  readonly terminal_command_type: unknown;
  readonly terminal_applied_at: unknown;
}

interface TelegramProofConsumptionRow extends QueryResultRow {
  readonly proof_fingerprint: unknown;
  readonly proof_expires_at: unknown;
  readonly intent: unknown;
  readonly idempotency_key: unknown;
  readonly request_digest: unknown;
  readonly operation_id: unknown;
  readonly consumed_at: unknown;
}

type AuthenticationOperationStatus =
  (typeof AUTHENTICATION_OPERATION_STATUSES)[number];

interface PersistedOperation {
  readonly operationId: AuthenticationOperationId;
  readonly intent: AuthenticationIntent;
  readonly identityProvider: ExternalIdentityProvider;
  readonly identityNamespace: ExternalIdentityNamespace;
  readonly identityLookupDigest: ExternalIdentityLookupDigest;
  readonly proofType: 'telegram_proof' | 'otp_challenge';
  readonly telegramProofFingerprint: AuthenticationProofFingerprint | null;
  readonly otpChallengeId: string | null;
  readonly createdAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
  readonly idempotencyKey: AuthenticationIdempotencyKey;
  readonly requestDigest: AuthenticationRequestDigest;
  readonly status: AuthenticationOperationStatus;
}

interface PersistedConsumption {
  readonly outcome: 'first_use';
  readonly proofFingerprint: AuthenticationProofFingerprint;
  readonly proofExpiresAt: UnixEpochSeconds;
  readonly intent: AuthenticationIntent;
  readonly idempotencyKey: AuthenticationIdempotencyKey;
  readonly requestDigest: AuthenticationRequestDigest;
  readonly operationId: AuthenticationOperationId;
  readonly consumedAt: UnixEpochSeconds;
}

interface ValidatedInput {
  readonly operation: PendingTelegramAuthenticationOperation;
  readonly consumption: PersistPendingTelegramAuthenticationInput['consumption'];
  readonly audit: PersistPendingTelegramAuthenticationInput['audit'];
}

function persistenceFailure(
  reason: TelegramAuthenticationOperationPersistenceFailure,
): TelegramAuthenticationOperationPersistenceError {
  return new TelegramAuthenticationOperationPersistenceError(reason);
}

function invalidInput(): TelegramAuthenticationOperationPersistenceError {
  return persistenceFailure('invalid_input');
}

function invalidPersistedState(): TelegramAuthenticationOperationPersistenceError {
  return persistenceFailure('invalid_persisted_state');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function isClosedString<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === 'string' && values.includes(value);
}

function readInputAuditEventId(value: unknown): SecurityAuditEventId {
  if (!isInternalUuid(value)) {
    throw invalidInput();
  }
  return value as SecurityAuditEventId;
}

function readInputNamespace(value: unknown): ExternalIdentityNamespace {
  if (typeof value !== 'string') {
    throw invalidInput();
  }
  try {
    return externalIdentityNamespace(value);
  } catch {
    throw invalidInput();
  }
}

function readInputLookupDigest(value: unknown): ExternalIdentityLookupDigest {
  if (typeof value !== 'string') {
    throw invalidInput();
  }
  try {
    return externalIdentityLookupDigest(value);
  } catch {
    throw invalidInput();
  }
}

function validateInput(value: unknown): ValidatedInput {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ['operation', 'consumption', 'audit']) ||
    !isRecord(value.operation) ||
    !hasExactlyKeys(value.operation, [
      'operationId',
      'intent',
      'identityKey',
      'proofReference',
      'createdAt',
      'expiresAt',
      'idempotencyKey',
      'requestDigest',
      'status',
    ]) ||
    !isRecord(value.operation.identityKey) ||
    !hasExactlyKeys(value.operation.identityKey, [
      'provider',
      'namespace',
      'lookup',
    ]) ||
    value.operation.identityKey.provider !== 'telegram' ||
    !isRecord(value.operation.identityKey.lookup) ||
    !hasExactlyKeys(value.operation.identityKey.lookup, ['kind', 'digest']) ||
    value.operation.identityKey.lookup.kind !== 'lookup_digest' ||
    !isRecord(value.operation.proofReference) ||
    !hasExactlyKeys(value.operation.proofReference, [
      'type',
      'proofFingerprint',
    ]) ||
    value.operation.proofReference.type !== 'telegram_proof' ||
    value.operation.status !== 'pending' ||
    !isAuthenticationOperationId(value.operation.operationId) ||
    !isAuthenticationIntent(value.operation.intent) ||
    !isAuthenticationProofFingerprint(
      value.operation.proofReference.proofFingerprint,
    ) ||
    !isUnixEpochSeconds(value.operation.createdAt) ||
    !isUnixEpochSeconds(value.operation.expiresAt) ||
    value.operation.createdAt >= value.operation.expiresAt ||
    !isAuthenticationIdempotencyKey(value.operation.idempotencyKey) ||
    !isAuthenticationRequestDigest(value.operation.requestDigest) ||
    !isRecord(value.consumption) ||
    !hasExactlyKeys(value.consumption, [
      'outcome',
      'proofFingerprint',
      'proofExpiresAt',
      'intent',
      'idempotencyKey',
      'requestDigest',
      'operationId',
      'consumedAt',
    ]) ||
    value.consumption.outcome !== 'first_use' ||
    !isAuthenticationProofFingerprint(value.consumption.proofFingerprint) ||
    !isUnixEpochSeconds(value.consumption.proofExpiresAt) ||
    !isAuthenticationIntent(value.consumption.intent) ||
    !isAuthenticationIdempotencyKey(value.consumption.idempotencyKey) ||
    !isAuthenticationRequestDigest(value.consumption.requestDigest) ||
    !isAuthenticationOperationId(value.consumption.operationId) ||
    !isUnixEpochSeconds(value.consumption.consumedAt) ||
    value.consumption.consumedAt >= value.consumption.proofExpiresAt ||
    !isRecord(value.audit) ||
    !hasExactlyKeys(value.audit, ['eventId', 'occurredAt']) ||
    !isInternalUuid(value.audit.eventId) ||
    !isUnixEpochSeconds(value.audit.occurredAt)
  ) {
    throw invalidInput();
  }

  const namespace = readInputNamespace(value.operation.identityKey.namespace);
  const lookupDigest = readInputLookupDigest(
    value.operation.identityKey.lookup.digest,
  );

  if (
    value.operation.operationId !== value.consumption.operationId ||
    value.operation.intent !== value.consumption.intent ||
    value.operation.proofReference.proofFingerprint !==
      value.consumption.proofFingerprint ||
    value.operation.idempotencyKey !== value.consumption.idempotencyKey ||
    value.operation.requestDigest !== value.consumption.requestDigest
  ) {
    throw invalidInput();
  }

  const operationResult = createAuthenticationOperation({
    operationId: value.operation.operationId,
    intent: value.operation.intent,
    identityKey: {
      provider: 'telegram',
      namespace,
      lookup: {
        kind: 'lookup_digest',
        digest: lookupDigest,
      },
    },
    proofReference: {
      type: 'telegram_proof',
      proofFingerprint: value.operation.proofReference.proofFingerprint,
    },
    createdAt: value.operation.createdAt,
    expiresAt: value.operation.expiresAt,
    idempotencyKey: value.operation.idempotencyKey,
    requestDigest: value.operation.requestDigest,
  });
  if (operationResult.outcome !== 'created') {
    throw invalidInput();
  }

  return Object.freeze({
    operation: operationResult.state as PendingTelegramAuthenticationOperation,
    consumption: Object.freeze({
      outcome: 'first_use' as const,
      proofFingerprint: value.consumption.proofFingerprint,
      proofExpiresAt: value.consumption.proofExpiresAt,
      intent: value.consumption.intent,
      idempotencyKey: value.consumption.idempotencyKey,
      requestDigest: value.consumption.requestDigest,
      operationId: value.consumption.operationId,
      consumedAt: value.consumption.consumedAt,
    }),
    audit: Object.freeze({
      eventId: readInputAuditEventId(value.audit.eventId),
      occurredAt: value.audit.occurredAt,
    }),
  });
}

function operationInsertValues(input: ValidatedInput): readonly unknown[] {
  return [
    input.operation.operationId,
    input.operation.intent,
    input.operation.identityKey.provider,
    input.operation.identityKey.namespace,
    encodePostgresByteaDigest(input.operation.identityKey.lookup.digest),
    input.operation.proofReference.type,
    encodePostgresByteaDigest(
      input.operation.proofReference.proofFingerprint,
    ),
    null,
    input.operation.createdAt.toString(10),
    input.operation.expiresAt.toString(10),
    input.operation.idempotencyKey,
    input.operation.requestDigest,
  ];
}

function consumptionInsertValues(input: ValidatedInput): readonly unknown[] {
  return [
    encodePostgresByteaDigest(input.consumption.proofFingerprint),
    input.consumption.proofExpiresAt.toString(10),
    input.consumption.intent,
    input.consumption.idempotencyKey,
    input.consumption.requestDigest,
    input.consumption.operationId,
    input.consumption.consumedAt.toString(10),
  ];
}

function rereadValues(input: ValidatedInput): readonly unknown[] {
  return [
    input.operation.operationId,
    input.operation.idempotencyKey,
    encodePostgresByteaDigest(
      input.operation.proofReference.proofFingerprint,
    ),
  ];
}

function readPersistedNamespace(value: unknown): ExternalIdentityNamespace {
  if (typeof value !== 'string') {
    throw invalidPersistedState();
  }
  try {
    return externalIdentityNamespace(value);
  } catch {
    throw invalidPersistedState();
  }
}

function readPersistedLookupDigest(
  value: unknown,
): ExternalIdentityLookupDigest {
  try {
    return externalIdentityLookupDigest(decodePostgresByteaDigest(value));
  } catch {
    throw invalidPersistedState();
  }
}

function readPersistedFingerprint(
  value: unknown,
): AuthenticationProofFingerprint {
  try {
    const decoded = decodePostgresByteaDigest(value);
    if (!isAuthenticationProofFingerprint(decoded)) {
      throw invalidPersistedState();
    }
    return decoded;
  } catch {
    throw invalidPersistedState();
  }
}

function readPersistedEpoch(value: unknown): UnixEpochSeconds {
  try {
    return unixEpochSeconds(decodePostgresNonNegativeBigint(value));
  } catch {
    throw invalidPersistedState();
  }
}

function allNull(values: readonly unknown[]): boolean {
  return values.every((value) => value === null);
}

function hasValidResolutionShape(
  row: AuthenticationOperationRow,
  intent: AuthenticationIntent,
): boolean {
  if (!isClosedString(row.resolution_type, RESOLUTION_TYPES)) {
    return false;
  }

  switch (row.resolution_type) {
    case 'existing_account':
      return (
        isAccountId(row.resolution_account_id) &&
        row.resolution_account_status === 'active' &&
        row.resolution_initial_role === null &&
        row.resolution_reason === null
      );
    case 'new_account_required':
      return (
        intent === 'sign_up' &&
        row.resolution_account_id === null &&
        row.resolution_account_status === null &&
        row.resolution_initial_role === 'player' &&
        row.resolution_reason === null
      );
    case 'blocked':
      return (
        isAccountId(row.resolution_account_id) &&
        row.resolution_initial_role === null &&
        ((row.resolution_account_status === 'blocked' &&
          row.resolution_reason === 'account_blocked') ||
          (row.resolution_account_status === 'pending_deletion' &&
            row.resolution_reason === 'account_pending_deletion'))
      );
    case 'conflict':
      return (
        row.resolution_account_id === null &&
        row.resolution_account_status === null &&
        row.resolution_initial_role === null &&
        isClosedString(
          row.resolution_reason,
          CONFLICT_RESOLUTION_REASONS,
        )
      );
  }
}

function hasValidStateShape(
  row: AuthenticationOperationRow,
  intent: AuthenticationIntent,
  status: AuthenticationOperationStatus,
  createdAt: UnixEpochSeconds,
  expiresAt: UnixEpochSeconds,
): boolean {
  const resolutionFields = [
    row.resolution_type,
    row.resolution_account_id,
    row.resolution_account_status,
    row.resolution_initial_role,
    row.resolution_reason,
  ];
  const terminalCommandIdValid = isInternalUuid(row.terminal_command_id);
  const terminalAppliedAt =
    row.terminal_applied_at === null
      ? null
      : readPersistedEpoch(row.terminal_applied_at);

  switch (status) {
    case 'pending':
      return (
        allNull(resolutionFields) &&
        row.failure_reason === null &&
        row.terminal_command_id === null &&
        row.terminal_command_type === null &&
        terminalAppliedAt === null
      );
    case 'completed':
      return (
        hasValidResolutionShape(row, intent) &&
        row.failure_reason === null &&
        terminalCommandIdValid &&
        row.terminal_command_type === 'complete' &&
        terminalAppliedAt !== null &&
        terminalAppliedAt >= createdAt &&
        terminalAppliedAt < expiresAt
      );
    case 'failed':
      return (
        allNull(resolutionFields) &&
        isClosedString(
          row.failure_reason,
          AUTHENTICATION_OPERATION_FAILURE_REASONS,
        ) &&
        terminalCommandIdValid &&
        row.terminal_command_type === 'fail' &&
        terminalAppliedAt !== null &&
        terminalAppliedAt >= createdAt &&
        terminalAppliedAt < expiresAt
      );
    case 'expired':
      return (
        allNull(resolutionFields) &&
        row.failure_reason === null &&
        terminalCommandIdValid &&
        row.terminal_command_type === 'expire' &&
        terminalAppliedAt !== null &&
        terminalAppliedAt >= expiresAt
      );
  }
}

function hydrateOperation(row: AuthenticationOperationRow): PersistedOperation {
  try {
    if (
      !isAuthenticationOperationId(row.id) ||
      !isAuthenticationIntent(row.intent) ||
      !isClosedString(
        row.identity_provider,
        EXTERNAL_IDENTITY_PROVIDERS,
      ) ||
      !isAuthenticationIdempotencyKey(row.idempotency_key) ||
      !isAuthenticationRequestDigest(row.request_digest) ||
      !isClosedString(row.status, AUTHENTICATION_OPERATION_STATUSES)
    ) {
      throw invalidPersistedState();
    }

    const identityNamespace = readPersistedNamespace(
      row.identity_namespace,
    );
    const identityLookupDigest = readPersistedLookupDigest(
      row.identity_lookup_digest,
    );
    const createdAt = readPersistedEpoch(row.created_at);
    const expiresAt = readPersistedEpoch(row.expires_at);
    if (createdAt >= expiresAt) {
      throw invalidPersistedState();
    }

    let proofType: PersistedOperation['proofType'];
    let telegramProofFingerprint: AuthenticationProofFingerprint | null;
    let otpChallengeId: string | null;
    if (
      row.proof_type === 'telegram_proof' &&
      row.otp_challenge_id === null
    ) {
      proofType = 'telegram_proof';
      telegramProofFingerprint = readPersistedFingerprint(
        row.telegram_proof_fingerprint,
      );
      otpChallengeId = null;
    } else if (
      row.proof_type === 'otp_challenge' &&
      row.telegram_proof_fingerprint === null &&
      isInternalUuid(row.otp_challenge_id)
    ) {
      proofType = 'otp_challenge';
      telegramProofFingerprint = null;
      otpChallengeId = row.otp_challenge_id;
    } else {
      throw invalidPersistedState();
    }

    if (
      !hasValidStateShape(
        row,
        row.intent,
        row.status,
        createdAt,
        expiresAt,
      )
    ) {
      throw invalidPersistedState();
    }

    return Object.freeze({
      operationId: row.id,
      intent: row.intent,
      identityProvider: row.identity_provider,
      identityNamespace,
      identityLookupDigest,
      proofType,
      telegramProofFingerprint,
      otpChallengeId,
      createdAt,
      expiresAt,
      idempotencyKey: row.idempotency_key,
      requestDigest: row.request_digest,
      status: row.status,
    });
  } catch {
    throw invalidPersistedState();
  }
}

function hydrateConsumption(
  row: TelegramProofConsumptionRow,
): PersistedConsumption {
  try {
    if (
      !isAuthenticationIntent(row.intent) ||
      !isAuthenticationIdempotencyKey(row.idempotency_key) ||
      !isAuthenticationRequestDigest(row.request_digest) ||
      !isAuthenticationOperationId(row.operation_id)
    ) {
      throw invalidPersistedState();
    }
    const proofFingerprint = readPersistedFingerprint(
      row.proof_fingerprint,
    );
    const proofExpiresAt = readPersistedEpoch(row.proof_expires_at);
    const consumedAt = readPersistedEpoch(row.consumed_at);
    if (consumedAt >= proofExpiresAt) {
      throw invalidPersistedState();
    }
    return Object.freeze({
      outcome: 'first_use' as const,
      proofFingerprint,
      proofExpiresAt,
      intent: row.intent,
      idempotencyKey: row.idempotency_key,
      requestDigest: row.request_digest,
      operationId: row.operation_id,
      consumedAt,
    });
  } catch {
    throw invalidPersistedState();
  }
}

function validatePersistedBindings(
  operations: readonly PersistedOperation[],
  consumptions: readonly PersistedConsumption[],
): void {
  const operationById = new Map<string, PersistedOperation>();
  const operationKeys = new Set<string>();
  const operationFingerprints = new Set<string>();
  for (const operation of operations) {
    if (
      operationById.has(operation.operationId) ||
      operationKeys.has(operation.idempotencyKey) ||
      (operation.telegramProofFingerprint !== null &&
        operationFingerprints.has(operation.telegramProofFingerprint))
    ) {
      throw invalidPersistedState();
    }
    operationById.set(operation.operationId, operation);
    operationKeys.add(operation.idempotencyKey);
    if (operation.telegramProofFingerprint !== null) {
      operationFingerprints.add(operation.telegramProofFingerprint);
    }
  }

  const consumptionByOperation = new Map<string, PersistedConsumption>();
  const consumptionKeys = new Set<string>();
  const consumptionFingerprints = new Set<string>();
  for (const consumption of consumptions) {
    if (
      consumptionByOperation.has(consumption.operationId) ||
      consumptionKeys.has(consumption.idempotencyKey) ||
      consumptionFingerprints.has(consumption.proofFingerprint)
    ) {
      throw invalidPersistedState();
    }
    const operation = operationById.get(consumption.operationId);
    if (
      operation === undefined ||
      operation.proofType !== 'telegram_proof' ||
      operation.telegramProofFingerprint !==
        consumption.proofFingerprint ||
      operation.intent !== consumption.intent ||
      operation.idempotencyKey !== consumption.idempotencyKey ||
      operation.requestDigest !== consumption.requestDigest
    ) {
      throw invalidPersistedState();
    }
    consumptionByOperation.set(consumption.operationId, consumption);
    consumptionKeys.add(consumption.idempotencyKey);
    consumptionFingerprints.add(consumption.proofFingerprint);
  }

  for (const operation of operations) {
    if (
      operation.proofType === 'telegram_proof' &&
      !consumptionByOperation.has(operation.operationId)
    ) {
      throw invalidPersistedState();
    }
  }
}

function operationBindingsEqual(
  persisted: PersistedOperation,
  input: ValidatedInput,
): boolean {
  return (
    persisted.operationId === input.operation.operationId &&
    persisted.intent === input.operation.intent &&
    persisted.identityProvider === input.operation.identityKey.provider &&
    persisted.identityNamespace === input.operation.identityKey.namespace &&
    persisted.identityLookupDigest ===
      input.operation.identityKey.lookup.digest &&
    persisted.proofType === 'telegram_proof' &&
    persisted.telegramProofFingerprint ===
      input.operation.proofReference.proofFingerprint &&
    persisted.otpChallengeId === null &&
    persisted.createdAt === input.operation.createdAt &&
    persisted.expiresAt === input.operation.expiresAt &&
    persisted.idempotencyKey === input.operation.idempotencyKey &&
    persisted.requestDigest === input.operation.requestDigest
  );
}

function classifyPersistedConflict(
  operations: readonly PersistedOperation[],
  consumptions: readonly PersistedConsumption[],
  input: ValidatedInput,
): TelegramAuthenticationOperationResult {
  if (operations.length === 0 && consumptions.length === 0) {
    throw invalidPersistedState();
  }
  validatePersistedBindings(operations, consumptions);

  const operationByIdempotencyKey = operations.find(
    (operation) =>
      operation.idempotencyKey === input.operation.idempotencyKey,
  );
  const consumptionByIdempotencyKey = consumptions.find(
    (consumption) =>
      consumption.idempotencyKey === input.consumption.idempotencyKey,
  );
  const consumptionResult = consumeTelegramProof(
    { consumptions },
    {
      proof: {
        status: 'verified',
        proof: {
          provider: 'telegram',
          namespace: input.operation.identityKey.namespace,
          identityKey: input.operation.identityKey,
          authDate: EPOCH_ZERO,
          verifiedAt: input.consumption.consumedAt,
          expiresAt: input.consumption.proofExpiresAt,
          proofFingerprint: input.consumption.proofFingerprint,
        },
      },
      intent: input.consumption.intent,
      idempotencyKey: input.consumption.idempotencyKey,
      requestDigest: input.consumption.requestDigest,
      operationId: input.consumption.operationId,
      now: input.consumption.consumedAt,
    },
  );

  if (consumptionResult.outcome === 'idempotent_retry') {
    const operation = operations.find(
      (candidate) =>
        candidate.operationId ===
        consumptionResult.consumption.operationId,
    );
    if (operation === undefined) {
      throw invalidPersistedState();
    }
    if (operationBindingsEqual(operation, input)) {
      return Object.freeze({
        outcome: 'idempotent_retry',
        operationId: operation.operationId,
      });
    }
  }

  if (
    operationByIdempotencyKey !== undefined ||
    consumptionByIdempotencyKey !== undefined
  ) {
    return Object.freeze({
      outcome: 'conflict',
      reason: 'idempotency_key_conflict',
    });
  }

  if (consumptionResult.outcome === 'conflicting_reuse') {
    return Object.freeze({
      outcome: 'conflict',
      reason: 'idempotency_key_conflict',
    });
  }

  if (consumptionResult.outcome === 'replay') {
    return Object.freeze({
      outcome: 'replay',
      reason: 'proof_already_consumed',
    });
  }

  if (
    consumptionResult.outcome ===
      'invalid_proof_consumption_state' ||
    consumptionResult.outcome ===
      'invalid_proof_consumption_command' ||
    consumptionResult.outcome === 'invalid'
  ) {
    throw invalidPersistedState();
  }

  const operationById = operations.find(
    (operation) =>
      operation.operationId === input.operation.operationId,
  );
  if (operationById !== undefined) {
    return Object.freeze({
      outcome: 'conflict',
      reason: 'operation_binding_conflict',
    });
  }

  throw invalidPersistedState();
}

function auditEventFor(
  result: TelegramAuthenticationOperationResult,
  input: ValidatedInput,
): SecurityAuditEvent<'telegram_proof_consumption'> {
  const metadata =
    result.outcome === 'created' ||
    result.outcome === 'idempotent_retry'
      ? createSecurityAuditMetadata('telegram_proof_consumption', {
          operationId: result.operationId,
        })
      : createSecurityAuditMetadata('telegram_proof_consumption', {
          attemptedOperationId: input.operation.operationId,
        });
  const outcome =
    result.outcome === 'created'
      ? 'success'
      : result.outcome === 'idempotent_retry'
        ? 'idempotent_retry'
        : result.outcome === 'replay'
          ? 'replay_detected'
          : 'conflict';

  return createSecurityAuditEvent({
    eventId: input.audit.eventId,
    eventType: 'telegram_proof_consumption',
    outcome,
    occurredAt: input.audit.occurredAt,
    metadata,
  });
}

async function appendAudit(
  repository: SecurityAuditRepository,
  transaction: PostgresTransaction,
  result: TelegramAuthenticationOperationResult,
  input: ValidatedInput,
): Promise<void> {
  const auditResult = await repository.append(
    transaction,
    auditEventFor(result, input),
  );
  if (
    auditResult.status !== 'appended' &&
    auditResult.status !== 'idempotent_retry'
  ) {
    throw persistenceFailure('audit_conflict');
  }
}

function mapSecurityAuditError(
  error: SecurityAuditPersistenceError,
): TelegramAuthenticationOperationPersistenceError {
  switch (error.reason) {
    case 'referential_integrity':
      return persistenceFailure('referential_integrity');
    case 'invalid_audit_event':
      return persistenceFailure('invalid_input');
    case 'permission_denied':
      return persistenceFailure('permission_denied');
    case 'transaction_conflict':
      return persistenceFailure('transaction_conflict');
    case 'database_unavailable':
      return persistenceFailure('database_unavailable');
    case 'storage_failure':
      return persistenceFailure('storage_failure');
  }
}

function mapPersistenceError(
  error: unknown,
): TelegramAuthenticationOperationPersistenceError {
  if (error instanceof TelegramAuthenticationOperationPersistenceError) {
    return error;
  }
  if (error instanceof SecurityAuditPersistenceError) {
    return mapSecurityAuditError(error);
  }
  if (error instanceof PostgresCodecError) {
    return invalidPersistedState();
  }

  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return persistenceFailure('storage_failure');
  }
  if (classified.metadata.code === '22023') {
    return invalidPersistedState();
  }

  switch (classified.category) {
    case 'foreign_key_violation':
      return persistenceFailure('referential_integrity');
    case 'check_violation':
    case 'not_null_violation':
    case 'invalid_text_representation':
    case 'object_not_in_prerequisite_state':
      return invalidPersistedState();
    case 'insufficient_privilege':
      return persistenceFailure('permission_denied');
    case 'serialization_failure':
    case 'deadlock_detected':
      return persistenceFailure('transaction_conflict');
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled':
      return persistenceFailure('database_unavailable');
    default:
      return persistenceFailure('storage_failure');
  }
}

export class PostgresTelegramAuthenticationOperationRepository
  implements TelegramAuthenticationOperationRepository
{
  constructor(private readonly securityAudit: SecurityAuditRepository) {}

  async persistPending(
    transaction: PostgresTransaction,
    input: PersistPendingTelegramAuthenticationInput,
  ): Promise<TelegramAuthenticationOperationResult> {
    try {
      const validated = validateInput(input);
      let operationValues: readonly unknown[];
      try {
        operationValues = operationInsertValues(validated);
      } catch {
        throw invalidInput();
      }

      const inserted = await transaction.query<InsertedOperationRow>(
        INSERT_OPERATION_SQL,
        operationValues,
      );
      if (inserted.rows.length > 1) {
        throw invalidPersistedState();
      }

      let result: TelegramAuthenticationOperationResult;
      if (inserted.rows.length === 1) {
        if (
          !isAuthenticationOperationId(inserted.rows[0].id) ||
          inserted.rows[0].id !== validated.operation.operationId
        ) {
          throw invalidPersistedState();
        }
        await transaction.query(
          INSERT_CONSUMPTION_SQL,
          consumptionInsertValues(validated),
        );
        result = Object.freeze({
          outcome: 'created',
          operationId: validated.operation.operationId,
        });
      } else {
        const values = rereadValues(validated);
        const operationRows =
          await transaction.query<AuthenticationOperationRow>(
            SELECT_MATCHING_OPERATIONS_SQL,
            values,
          );
        const consumptionRows =
          await transaction.query<TelegramProofConsumptionRow>(
            SELECT_MATCHING_CONSUMPTIONS_SQL,
            values,
          );
        result = classifyPersistedConflict(
          operationRows.rows.map(hydrateOperation),
          consumptionRows.rows.map(hydrateConsumption),
          validated,
        );
      }

      await appendAudit(this.securityAudit, transaction, result, validated);
      return result;
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
