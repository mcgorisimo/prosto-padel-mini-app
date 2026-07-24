import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import {
  EXTERNAL_IDENTITY_PROVIDERS,
  ExternalIdentityKey,
  ExternalIdentityLookupDigest,
  ExternalIdentityNamespace,
  ExternalIdentityProvider,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
} from '../accounts/external-identity.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  ACCOUNT_RESOLUTION_CONFLICT_REASONS,
  AccountResolutionOutcome,
  BlockedAccountResolution,
  ConflictAccountResolution,
  ExistingAccountResolution,
  NewAccountRequiredResolution,
  isValidAccountResolutionOutcome,
  isValidExternalIdentityKey,
} from '../auth/account-resolution.types';
import {
  AUTHENTICATION_OPERATION_FAILURE_REASONS,
  AuthenticationOperationCommand,
  AuthenticationOperationFailureReason,
  AuthenticationOperationState,
  CompletedAuthenticationOperation,
  ExpiredAuthenticationOperation,
  FailedAuthenticationOperation,
  PendingAuthenticationOperation,
  transitionAuthenticationOperation,
} from '../auth/authentication-operation.state-machine';
import {
  AUTHENTICATION_INTENTS,
  AuthenticationCommandId,
  AuthenticationIdempotencyKey,
  AuthenticationIntent,
  AuthenticationOperationId,
  AuthenticationProofFingerprint,
  AuthenticationProofReference,
  AuthenticationRequestDigest,
  UnixEpochSeconds,
  isAuthenticationCommandId,
  isAuthenticationIdempotencyKey,
  isAuthenticationIntent,
  isAuthenticationOperationId,
  isAuthenticationProofFingerprint,
  isAuthenticationProofReference,
  isAuthenticationRequestDigest,
  isUnixEpochSeconds,
  otpAuthenticationProofReference,
  telegramAuthenticationProofReference,
  unixEpochSeconds,
} from '../auth/auth.types';
import { isOtpChallengeId } from '../auth/otp.types';
import {
  SecurityAuditOutcome,
  createSecurityAuditEvent,
  createSecurityAuditMetadata,
} from '../auth/security-audit.types';
import {
  ApplyAuthenticationOperationTerminalInput,
  AuthenticationOperationTerminalRepository,
  AuthenticationOperationTerminalPersistenceError,
  AuthenticationOperationTerminalRejectionReason,
  AuthenticationOperationTerminalResult,
} from './authentication-operation-terminal.repository';
import {
  decodePostgresByteaDigest,
  decodePostgresNonNegativeBigint,
} from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import { SecurityAuditRepository } from './security-audit.repository';

const OPERATION_COLUMNS = `
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
`;

const SELECT_OPERATION_FOR_UPDATE_SQL = `
  SELECT
    ${OPERATION_COLUMNS}
  FROM backend_auth.authentication_operations
  WHERE id = $1
  FOR UPDATE
`;

const UPDATE_OPERATION_TERMINAL_SQL = `
  UPDATE backend_auth.authentication_operations
  SET
    status = $2,
    resolution_type = $3,
    resolution_account_id = $4,
    resolution_account_status = $5,
    resolution_initial_role = $6,
    resolution_reason = $7,
    failure_reason = $8,
    terminal_command_id = $9,
    terminal_command_type = $10,
    terminal_applied_at = $11
  WHERE id = $1
    AND status = 'pending'
  RETURNING
    ${OPERATION_COLUMNS}
`;

const TERMINAL_STATUSES = Object.freeze([
  'completed',
  'failed',
  'expired',
] as const);

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

interface TerminalColumns {
  readonly status: 'completed' | 'failed' | 'expired';
  readonly resolutionType: AccountResolutionOutcome['type'] | null;
  readonly resolutionAccountId: string | null;
  readonly resolutionAccountStatus:
    | 'active'
    | 'blocked'
    | 'pending_deletion'
    | null;
  readonly resolutionInitialRole: 'player' | null;
  readonly resolutionReason: string | null;
  readonly failureReason: AuthenticationOperationFailureReason | null;
  readonly commandId: AuthenticationCommandId;
  readonly commandType: 'complete' | 'fail' | 'expire';
  readonly appliedAt: UnixEpochSeconds;
}

function invalidInput(): AuthenticationOperationTerminalPersistenceError {
  return new AuthenticationOperationTerminalPersistenceError('invalid_input');
}

function invalidPersistedState(): AuthenticationOperationTerminalPersistenceError {
  return new AuthenticationOperationTerminalPersistenceError(
    'invalid_persisted_state',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function isClosedString<const Value extends string>(
  value: unknown,
  values: readonly Value[],
): value is Value {
  return (
    typeof value === 'string' &&
    (values as readonly string[]).includes(value)
  );
}

function isValidCommandBinding(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, [
      'operationId',
      'intent',
      'identityKey',
      'proofReference',
      'idempotencyKey',
      'requestDigest',
    ]) &&
    isAuthenticationOperationId(value.operationId) &&
    isAuthenticationIntent(value.intent) &&
    isValidExternalIdentityKey(value.identityKey) &&
    isAuthenticationProofReference(value.proofReference) &&
    isAuthenticationIdempotencyKey(value.idempotencyKey) &&
    isAuthenticationRequestDigest(value.requestDigest)
  );
}

function isValidCommand(value: unknown): value is AuthenticationOperationCommand {
  if (
    !isRecord(value) ||
    !isAuthenticationCommandId(value.commandId) ||
    !isValidCommandBinding(value.binding) ||
    !isUnixEpochSeconds(value.now)
  ) {
    return false;
  }

  if (value.type === 'complete') {
    return (
      hasExactlyKeys(value, [
        'commandId',
        'type',
        'binding',
        'now',
        'resolution',
      ]) && isValidAccountResolutionOutcome(value.resolution)
    );
  }

  if (value.type === 'fail') {
    return (
      hasExactlyKeys(value, [
        'commandId',
        'type',
        'binding',
        'now',
        'reason',
      ]) &&
      isClosedString(
        value.reason,
        AUTHENTICATION_OPERATION_FAILURE_REASONS,
      )
    );
  }

  return (
    value.type === 'expire' &&
    hasExactlyKeys(value, ['commandId', 'type', 'binding', 'now'])
  );
}

function assertValidInput(
  value: unknown,
): asserts value is ApplyAuthenticationOperationTerminalInput {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ['command', 'audit']) ||
    !isValidCommand(value.command) ||
    !isRecord(value.audit) ||
    !hasExactlyKeys(value.audit, ['eventId', 'occurredAt']) ||
    !isInternalUuid(value.audit.eventId) ||
    !isUnixEpochSeconds(value.audit.occurredAt)
  ) {
    throw invalidInput();
  }
}

function readNamespace(value: unknown): ExternalIdentityNamespace {
  if (typeof value !== 'string') {
    throw invalidPersistedState();
  }
  try {
    return externalIdentityNamespace(value);
  } catch {
    throw invalidPersistedState();
  }
}

function readLookupDigest(value: unknown): ExternalIdentityLookupDigest {
  try {
    return externalIdentityLookupDigest(decodePostgresByteaDigest(value));
  } catch {
    throw invalidPersistedState();
  }
}

function readEpoch(value: unknown): UnixEpochSeconds {
  try {
    return unixEpochSeconds(decodePostgresNonNegativeBigint(value));
  } catch {
    throw invalidPersistedState();
  }
}

function readFingerprint(
  value: unknown,
): AuthenticationProofFingerprint {
  try {
    const fingerprint = decodePostgresByteaDigest(value);
    if (!isAuthenticationProofFingerprint(fingerprint)) {
      throw invalidPersistedState();
    }
    return fingerprint;
  } catch {
    throw invalidPersistedState();
  }
}

function hydrateIdentityKey(
  row: AuthenticationOperationRow,
): ExternalIdentityKey {
  if (
    !isClosedString(row.identity_provider, EXTERNAL_IDENTITY_PROVIDERS)
  ) {
    throw invalidPersistedState();
  }

  return Object.freeze({
    provider: row.identity_provider as ExternalIdentityProvider,
    namespace: readNamespace(row.identity_namespace),
    lookup: Object.freeze({
      kind: 'lookup_digest' as const,
      digest: readLookupDigest(row.identity_lookup_digest),
    }),
  });
}

function hydrateProofReference(
  row: AuthenticationOperationRow,
): AuthenticationProofReference {
  if (
    row.proof_type === 'telegram_proof' &&
    row.otp_challenge_id === null
  ) {
    return telegramAuthenticationProofReference(
      readFingerprint(row.telegram_proof_fingerprint),
    );
  }
  if (
    row.proof_type === 'otp_challenge' &&
    row.telegram_proof_fingerprint === null &&
    isOtpChallengeId(row.otp_challenge_id)
  ) {
    return otpAuthenticationProofReference(row.otp_challenge_id);
  }
  throw invalidPersistedState();
}

function hydrateResolution(
  row: AuthenticationOperationRow,
  identityKey: ExternalIdentityKey,
): AccountResolutionOutcome {
  let resolution: AccountResolutionOutcome;
  switch (row.resolution_type) {
    case 'existing_account': {
      if (
        !isAccountId(row.resolution_account_id) ||
        row.resolution_account_status !== 'active' ||
        row.resolution_initial_role !== null ||
        row.resolution_reason !== null
      ) {
        throw invalidPersistedState();
      }
      const existing: ExistingAccountResolution = {
        type: 'existing_account',
        accountId: row.resolution_account_id,
        accountStatus: 'active',
        identityKey,
      };
      resolution = existing;
      break;
    }
    case 'new_account_required': {
      if (
        row.resolution_account_id !== null ||
        row.resolution_account_status !== null ||
        row.resolution_initial_role !== 'player' ||
        row.resolution_reason !== null
      ) {
        throw invalidPersistedState();
      }
      const required: NewAccountRequiredResolution = {
        type: 'new_account_required',
        identityKey,
        accountDraft: Object.freeze({ initialRole: 'player' }),
      };
      resolution = required;
      break;
    }
    case 'blocked': {
      if (
        !isAccountId(row.resolution_account_id) ||
        row.resolution_initial_role !== null ||
        !(
          (row.resolution_account_status === 'blocked' &&
            row.resolution_reason === 'account_blocked') ||
          (row.resolution_account_status === 'pending_deletion' &&
            row.resolution_reason === 'account_pending_deletion')
        )
      ) {
        throw invalidPersistedState();
      }
      const blocked = {
        type: 'blocked',
        reason: row.resolution_reason,
        accountId: row.resolution_account_id,
        accountStatus: row.resolution_account_status,
        identityKey,
      } as BlockedAccountResolution;
      resolution = blocked;
      break;
    }
    case 'conflict': {
      if (
        row.resolution_account_id !== null ||
        row.resolution_account_status !== null ||
        row.resolution_initial_role !== null ||
        !isClosedString(
          row.resolution_reason,
          ACCOUNT_RESOLUTION_CONFLICT_REASONS,
        )
      ) {
        throw invalidPersistedState();
      }
      const conflict: ConflictAccountResolution = {
        type: 'conflict',
        reason: row.resolution_reason,
        identityKey,
      };
      resolution = conflict;
      break;
    }
    default:
      throw invalidPersistedState();
  }

  if (!isValidAccountResolutionOutcome(resolution)) {
    throw invalidPersistedState();
  }
  return Object.freeze(resolution);
}

function allNull(values: readonly unknown[]): boolean {
  return values.every((value) => value === null);
}

function hydrateOperation(
  row: AuthenticationOperationRow,
): AuthenticationOperationState {
  try {
    if (
      !isAuthenticationOperationId(row.id) ||
      !isClosedString(row.intent, AUTHENTICATION_INTENTS) ||
      !isAuthenticationIdempotencyKey(row.idempotency_key) ||
      !isAuthenticationRequestDigest(row.request_digest)
    ) {
      throw invalidPersistedState();
    }

    const identityKey = hydrateIdentityKey(row);
    const proofReference = hydrateProofReference(row);
    const createdAt = readEpoch(row.created_at);
    const expiresAt = readEpoch(row.expires_at);
    if (createdAt >= expiresAt) {
      throw invalidPersistedState();
    }

    const base = {
      operationId: row.id,
      intent: row.intent as AuthenticationIntent,
      identityKey,
      proofReference,
      createdAt,
      expiresAt,
      idempotencyKey: row.idempotency_key,
      requestDigest: row.request_digest,
    };
    const resolutionFields = [
      row.resolution_type,
      row.resolution_account_id,
      row.resolution_account_status,
      row.resolution_initial_role,
      row.resolution_reason,
    ];

    if (row.status === 'pending') {
      if (
        !allNull(resolutionFields) ||
        row.failure_reason !== null ||
        row.terminal_command_id !== null ||
        row.terminal_command_type !== null ||
        row.terminal_applied_at !== null
      ) {
        throw invalidPersistedState();
      }
      const state: PendingAuthenticationOperation = {
        ...base,
        status: 'pending',
      };
      return Object.freeze(state);
    }

    if (
      !isAuthenticationCommandId(row.terminal_command_id) ||
      row.terminal_applied_at === null
    ) {
      throw invalidPersistedState();
    }
    const appliedAt = readEpoch(row.terminal_applied_at);
    const appliedBase = {
      operationId: row.id,
      commandId: row.terminal_command_id,
      appliedAt,
    };

    if (row.status === 'completed') {
      if (
        row.failure_reason !== null ||
        row.terminal_command_type !== 'complete' ||
        appliedAt < createdAt ||
        appliedAt >= expiresAt
      ) {
        throw invalidPersistedState();
      }
      const state: CompletedAuthenticationOperation = {
        ...base,
        status: 'completed',
        resolution: hydrateResolution(row, identityKey),
        appliedCommand: {
          ...appliedBase,
          commandType: 'complete',
        },
      };
      return Object.freeze(state);
    }

    if (row.status === 'failed') {
      if (
        !allNull(resolutionFields) ||
        !isClosedString(
          row.failure_reason,
          AUTHENTICATION_OPERATION_FAILURE_REASONS,
        ) ||
        row.terminal_command_type !== 'fail' ||
        appliedAt < createdAt ||
        appliedAt >= expiresAt
      ) {
        throw invalidPersistedState();
      }
      const state: FailedAuthenticationOperation = {
        ...base,
        status: 'failed',
        failureReason: row.failure_reason,
        appliedCommand: { ...appliedBase, commandType: 'fail' },
      };
      return Object.freeze(state);
    }

    if (row.status === 'expired') {
      if (
        !allNull(resolutionFields) ||
        row.failure_reason !== null ||
        row.terminal_command_type !== 'expire' ||
        appliedAt < expiresAt
      ) {
        throw invalidPersistedState();
      }
      const state: ExpiredAuthenticationOperation = {
        ...base,
        status: 'expired',
        appliedCommand: { ...appliedBase, commandType: 'expire' },
      };
      return Object.freeze(state);
    }

    throw invalidPersistedState();
  } catch (error) {
    if (
      error instanceof AuthenticationOperationTerminalPersistenceError
    ) {
      throw error;
    }
    throw invalidPersistedState();
  }
}

function identityKeysEqual(
  left: ExternalIdentityKey,
  right: ExternalIdentityKey,
): boolean {
  return (
    left.provider === right.provider &&
    left.namespace === right.namespace &&
    left.lookup.kind === right.lookup.kind &&
    (left.lookup.kind === 'lookup_digest' &&
    right.lookup.kind === 'lookup_digest'
      ? left.lookup.digest === right.lookup.digest
      : left.lookup.kind === 'canonical_subject' &&
        right.lookup.kind === 'canonical_subject' &&
        left.lookup.subject === right.lookup.subject)
  );
}

function proofReferencesEqual(
  left: AuthenticationProofReference,
  right: AuthenticationProofReference,
): boolean {
  return left.type === 'telegram_proof' &&
    right.type === 'telegram_proof'
    ? left.proofFingerprint === right.proofFingerprint
    : left.type === 'otp_challenge' &&
        right.type === 'otp_challenge' &&
        left.challengeId === right.challengeId;
}

function resolutionsEqual(
  left: AccountResolutionOutcome,
  right: AccountResolutionOutcome,
): boolean {
  if (
    left.type !== right.type ||
    !identityKeysEqual(left.identityKey, right.identityKey)
  ) {
    return false;
  }
  if (left.type === 'existing_account' && right.type === 'existing_account') {
    return (
      left.accountId === right.accountId &&
      left.accountStatus === right.accountStatus
    );
  }
  if (
    left.type === 'new_account_required' &&
    right.type === 'new_account_required'
  ) {
    return left.accountDraft.initialRole === right.accountDraft.initialRole;
  }
  if (left.type === 'blocked' && right.type === 'blocked') {
    return (
      left.accountId === right.accountId &&
      left.accountStatus === right.accountStatus &&
      left.reason === right.reason
    );
  }
  return (
    left.type === 'conflict' &&
    right.type === 'conflict' &&
    left.reason === right.reason
  );
}

function statesEqual(
  left: AuthenticationOperationState,
  right: AuthenticationOperationState,
): boolean {
  if (
    left.operationId !== right.operationId ||
    left.intent !== right.intent ||
    !identityKeysEqual(left.identityKey, right.identityKey) ||
    !proofReferencesEqual(left.proofReference, right.proofReference) ||
    left.createdAt !== right.createdAt ||
    left.expiresAt !== right.expiresAt ||
    left.idempotencyKey !== right.idempotencyKey ||
    left.requestDigest !== right.requestDigest ||
    left.status !== right.status
  ) {
    return false;
  }
  if (left.status === 'pending' && right.status === 'pending') {
    return true;
  }
  if (left.status === 'completed' && right.status === 'completed') {
    return (
      resolutionsEqual(left.resolution, right.resolution) &&
      left.appliedCommand.commandId === right.appliedCommand.commandId &&
      left.appliedCommand.commandType ===
        right.appliedCommand.commandType &&
      left.appliedCommand.appliedAt === right.appliedCommand.appliedAt
    );
  }
  if (left.status === 'failed' && right.status === 'failed') {
    return (
      left.failureReason === right.failureReason &&
      left.appliedCommand.commandId === right.appliedCommand.commandId &&
      left.appliedCommand.commandType ===
        right.appliedCommand.commandType &&
      left.appliedCommand.appliedAt === right.appliedCommand.appliedAt
    );
  }
  return (
    left.status === 'expired' &&
    right.status === 'expired' &&
    left.appliedCommand.commandId === right.appliedCommand.commandId &&
    left.appliedCommand.commandType === right.appliedCommand.commandType &&
    left.appliedCommand.appliedAt === right.appliedCommand.appliedAt
  );
}

function terminalColumns(
  state: Exclude<AuthenticationOperationState, PendingAuthenticationOperation>,
): TerminalColumns {
  if (state.status === 'completed') {
    const common = {
      status: state.status,
      failureReason: null,
      commandId: state.appliedCommand.commandId,
      commandType: state.appliedCommand.commandType,
      appliedAt: state.appliedCommand.appliedAt,
    } as const;
    switch (state.resolution.type) {
      case 'existing_account':
        return {
          ...common,
          resolutionType: state.resolution.type,
          resolutionAccountId: state.resolution.accountId,
          resolutionAccountStatus: state.resolution.accountStatus,
          resolutionInitialRole: null,
          resolutionReason: null,
        };
      case 'new_account_required':
        return {
          ...common,
          resolutionType: state.resolution.type,
          resolutionAccountId: null,
          resolutionAccountStatus: null,
          resolutionInitialRole: state.resolution.accountDraft.initialRole,
          resolutionReason: null,
        };
      case 'blocked':
        return {
          ...common,
          resolutionType: state.resolution.type,
          resolutionAccountId: state.resolution.accountId,
          resolutionAccountStatus: state.resolution.accountStatus,
          resolutionInitialRole: null,
          resolutionReason: state.resolution.reason,
        };
      case 'conflict':
        return {
          ...common,
          resolutionType: state.resolution.type,
          resolutionAccountId: null,
          resolutionAccountStatus: null,
          resolutionInitialRole: null,
          resolutionReason: state.resolution.reason,
        };
    }
  }
  if (state.status === 'failed') {
    return {
      status: state.status,
      resolutionType: null,
      resolutionAccountId: null,
      resolutionAccountStatus: null,
      resolutionInitialRole: null,
      resolutionReason: null,
      failureReason: state.failureReason,
      commandId: state.appliedCommand.commandId,
      commandType: state.appliedCommand.commandType,
      appliedAt: state.appliedCommand.appliedAt,
    };
  }
  return {
    status: state.status,
    resolutionType: null,
    resolutionAccountId: null,
    resolutionAccountStatus: null,
    resolutionInitialRole: null,
    resolutionReason: null,
    failureReason: null,
    commandId: state.appliedCommand.commandId,
    commandType: state.appliedCommand.commandType,
    appliedAt: state.appliedCommand.appliedAt,
  };
}

function attemptedStatus(
  command: AuthenticationOperationCommand,
): 'completed' | 'failed' | 'expired' {
  switch (command.type) {
    case 'complete':
      return 'completed';
    case 'fail':
      return 'failed';
    case 'expire':
      return 'expired';
  }
}

function auditOutcome(
  transition:
    | { readonly outcome: 'transitioned' }
    | { readonly outcome: 'idempotent_retry' }
    | {
        readonly outcome: 'rejected';
        readonly reason: AuthenticationOperationTerminalRejectionReason;
      },
  status: 'completed' | 'failed' | 'expired',
): SecurityAuditOutcome {
  if (transition.outcome === 'idempotent_retry') {
    return 'idempotent_retry';
  }
  if (transition.outcome === 'transitioned') {
    return status === 'expired' ? 'expired' : 'success';
  }
  if (transition.reason === 'operation_not_expired') {
    return 'denied';
  }
  if (transition.reason === 'operation_expired') {
    return 'expired';
  }
  return 'conflict';
}

function mapQueryError(
  error: unknown,
): AuthenticationOperationTerminalPersistenceError {
  if (error instanceof AuthenticationOperationTerminalPersistenceError) {
    return error;
  }
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return new AuthenticationOperationTerminalPersistenceError(
      'storage_failure',
    );
  }
  switch (classified.category) {
    case 'foreign_key_violation':
      return new AuthenticationOperationTerminalPersistenceError(
        'referential_integrity',
      );
    case 'insufficient_privilege':
      return new AuthenticationOperationTerminalPersistenceError(
        'permission_denied',
      );
    case 'serialization_failure':
    case 'deadlock_detected':
      return new AuthenticationOperationTerminalPersistenceError(
        'transaction_conflict',
      );
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled':
      return new AuthenticationOperationTerminalPersistenceError(
        'database_unavailable',
      );
    case 'check_violation':
    case 'not_null_violation':
    case 'invalid_text_representation':
    case 'object_not_in_prerequisite_state':
      return invalidPersistedState();
    case 'unknown_postgres_error':
      return classified.metadata.code === '22023'
        ? invalidPersistedState()
        : new AuthenticationOperationTerminalPersistenceError(
            'storage_failure',
          );
    case 'unique_violation':
      return new AuthenticationOperationTerminalPersistenceError(
        'storage_failure',
      );
  }
}

function isSafeRejection(
  reason: string,
): reason is Exclude<
  AuthenticationOperationTerminalRejectionReason,
  'operation_not_found'
> {
  return [
    'operation_binding_conflict',
    'resolution_identity_conflict',
    'intent_outcome_incompatible',
    'operation_not_expired',
    'operation_expired',
    'command_reuse_conflict',
    'forbidden_transition',
  ].includes(reason);
}

export class PostgresAuthenticationOperationTerminalRepository
  implements AuthenticationOperationTerminalRepository
{
  constructor(private readonly auditRepository: SecurityAuditRepository) {}

  async applyTerminalCommand(
    transaction: PostgresTransaction,
    input: ApplyAuthenticationOperationTerminalInput,
  ): Promise<AuthenticationOperationTerminalResult> {
    assertValidInput(input);

    let selected;
    try {
      selected = await transaction.query<AuthenticationOperationRow>(
        SELECT_OPERATION_FOR_UPDATE_SQL,
        [input.command.binding.operationId],
      );
    } catch (error) {
      throw mapQueryError(error);
    }

    if (selected.rows.length === 0) {
      return { outcome: 'rejected', reason: 'operation_not_found' };
    }
    if (selected.rows.length !== 1) {
      throw invalidPersistedState();
    }

    const current = hydrateOperation(selected.rows[0]);
    if (current.operationId !== input.command.binding.operationId) {
      throw invalidPersistedState();
    }
    const transition = transitionAuthenticationOperation(
      current,
      input.command,
    );
    const targetStatus = attemptedStatus(input.command);

    if (transition.outcome === 'rejected') {
      if (!isSafeRejection(transition.reason)) {
        throw transition.reason === 'invalid_authentication_operation_state'
          ? invalidPersistedState()
          : invalidInput();
      }
      await this.appendAudit(
        transaction,
        input,
        current.intent,
        targetStatus,
        auditOutcome(
          { outcome: 'rejected', reason: transition.reason },
          targetStatus,
        ),
      );
      return { outcome: 'rejected', reason: transition.reason };
    }

    if (transition.state.status === 'pending') {
      throw invalidPersistedState();
    }

    if (transition.outcome === 'transitioned') {
      const columns = terminalColumns(transition.state);
      let updated;
      try {
        updated = await transaction.query<AuthenticationOperationRow>(
          UPDATE_OPERATION_TERMINAL_SQL,
          [
            transition.state.operationId,
            columns.status,
            columns.resolutionType,
            columns.resolutionAccountId,
            columns.resolutionAccountStatus,
            columns.resolutionInitialRole,
            columns.resolutionReason,
            columns.failureReason,
            columns.commandId,
            columns.commandType,
          columns.appliedAt.toString(10),
          ],
        );
      } catch (error) {
        throw mapQueryError(error);
      }
      if (updated.rowCount !== 1 || updated.rows.length !== 1) {
        throw invalidPersistedState();
      }
      const authoritative = hydrateOperation(updated.rows[0]);
      if (!statesEqual(authoritative, transition.state)) {
        throw invalidPersistedState();
      }
    }

    await this.appendAudit(
      transaction,
      input,
      current.intent,
      targetStatus,
      auditOutcome({ outcome: transition.outcome }, targetStatus),
    );

    return {
      outcome: transition.outcome,
      operationId: transition.state.operationId,
      status: transition.state.status,
    };
  }

  private async appendAudit(
    transaction: PostgresTransaction,
    input: ApplyAuthenticationOperationTerminalInput,
    intent: AuthenticationIntent,
    terminalStatus: (typeof TERMINAL_STATUSES)[number],
    outcome: SecurityAuditOutcome,
  ): Promise<void> {
    try {
      const result = await this.auditRepository.append(
        transaction,
        createSecurityAuditEvent({
          eventId: input.audit.eventId,
          eventType: 'authentication_operation_terminal',
          outcome,
          occurredAt: input.audit.occurredAt,
          metadata: createSecurityAuditMetadata(
            'authentication_operation_terminal',
            {
              operationId: input.command.binding.operationId,
              intent,
              terminalStatus,
            },
          ),
        }),
      );
      if (result.status === 'event_id_conflict') {
        throw new AuthenticationOperationTerminalPersistenceError(
          'audit_conflict',
        );
      }
    } catch (error) {
      if (
        error instanceof AuthenticationOperationTerminalPersistenceError
      ) {
        throw error;
      }
      throw new AuthenticationOperationTerminalPersistenceError(
        'storage_failure',
      );
    }
  }
}
