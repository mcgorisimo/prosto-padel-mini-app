import { QueryResultRow } from 'pg';
import {
  ACCOUNT_RESOLUTION_CONFLICT_REASONS,
} from '../auth/account-resolution.types';
import {
  UnixEpochSeconds,
  isAuthenticationOperationId,
  isUnixEpochSeconds,
} from '../auth/auth.types';
import {
  createSecurityAuditEvent,
  createSecurityAuditMetadata,
} from '../auth/security-audit.types';
import {
  createActiveSession,
} from '../auth/session.state-machine';
import {
  CreateActiveSessionBinding,
  SessionCredentialDigest,
  SessionId,
  isSessionAccountId,
  isSessionCommandId,
  isSessionCredentialGeneration,
  isSessionId,
} from '../auth/session.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  CreateInitialSessionInput,
  CreateInitialSessionResult,
  InitialSessionPersistenceError,
  InitialSessionPersistenceFailure,
  InitialSessionRepository,
} from './initial-session.repository';
import {
  decodePostgresBigint,
  decodePostgresByteaDigest,
  decodePostgresNonNegativeBigint,
  encodePostgresByteaDigest,
} from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import { SecurityAuditRepository } from './security-audit.repository';

const SELECT_OPERATION_FOR_UPDATE_SQL = `
  SELECT
    id,
    status,
    resolution_type,
    resolution_account_id,
    resolution_account_status,
    resolution_initial_role,
    resolution_reason
  FROM backend_auth.authentication_operations
  WHERE id = $1
  FOR UPDATE
`;

const SELECT_ACCOUNT_FOR_UPDATE_SQL = `
  SELECT
    id,
    status
  FROM backend_auth.accounts
  WHERE id = $1
  FOR UPDATE
`;

const SELECT_EXISTING_SESSION_SQL = `
  SELECT
    f.id AS family_id,
    f.account_id,
    f.authentication_operation_id,
    f.status,
    f.current_credential_generation,
    f.created_at,
    f.expires_at,
    f.terminal_command_id,
    f.terminal_reason,
    f.terminal_at,
    f.terminal_reuse_generation,
    f.terminal_reuse_digest,
    c.family_id AS credential_family_id,
    c.generation AS credential_generation,
    c.digest AS credential_digest,
    c.issued_at AS credential_issued_at,
    c.consumed_at AS credential_consumed_at,
    c.consumed_by_command_id,
    (
      SELECT pg_catalog.count(*)::bigint
      FROM backend_auth.auth_session_commands command
      WHERE command.family_id = f.id
    ) AS command_count
  FROM backend_auth.auth_session_families f
  LEFT JOIN backend_auth.auth_session_credentials c
    ON c.family_id = f.id
  WHERE f.id = $1
     OR f.authentication_operation_id = $2
  ORDER BY f.id, c.generation
  FOR UPDATE OF f
`;

const INSERT_SESSION_FAMILY_SQL = `
  INSERT INTO backend_auth.auth_session_families (
    id,
    account_id,
    authentication_operation_id,
    current_credential_generation,
    created_at,
    expires_at
  )
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING id
`;

const INSERT_SESSION_CREDENTIAL_SQL = `
  INSERT INTO backend_auth.auth_session_credentials (
    family_id,
    generation,
    digest,
    issued_at
  )
  VALUES ($1, $2, $3, $4)
  RETURNING
    family_id,
    generation,
    digest,
    issued_at,
    consumed_at,
    consumed_by_command_id
`;

const ACCOUNT_STATUSES = Object.freeze([
  'active',
  'blocked',
  'pending_deletion',
  'anonymized',
] as const);

const SESSION_STATUSES = Object.freeze([
  'active',
  'revoked',
  'expired',
  'reuse_detected',
] as const);

const SESSION_REVOKE_REASONS = Object.freeze([
  'user_sign_out',
  'administrator',
  'account_blocked',
  'security_event',
  'superseded',
] as const);

interface AuthenticationOperationEligibilityRow extends QueryResultRow {
  readonly id: unknown;
  readonly status: unknown;
  readonly resolution_type: unknown;
  readonly resolution_account_id: unknown;
  readonly resolution_account_status: unknown;
  readonly resolution_initial_role: unknown;
  readonly resolution_reason: unknown;
}

interface AccountRow extends QueryResultRow {
  readonly id: unknown;
  readonly status: unknown;
}

interface ExistingSessionRow extends QueryResultRow {
  readonly family_id: unknown;
  readonly account_id: unknown;
  readonly authentication_operation_id: unknown;
  readonly status: unknown;
  readonly current_credential_generation: unknown;
  readonly created_at: unknown;
  readonly expires_at: unknown;
  readonly terminal_command_id: unknown;
  readonly terminal_reason: unknown;
  readonly terminal_at: unknown;
  readonly terminal_reuse_generation: unknown;
  readonly terminal_reuse_digest: unknown;
  readonly credential_family_id: unknown;
  readonly credential_generation: unknown;
  readonly credential_digest: unknown;
  readonly credential_issued_at: unknown;
  readonly credential_consumed_at: unknown;
  readonly consumed_by_command_id: unknown;
  readonly command_count: unknown;
}

interface InsertedSessionFamilyRow extends QueryResultRow {
  readonly id: unknown;
}

interface InsertedSessionCredentialRow extends QueryResultRow {
  readonly family_id: unknown;
  readonly generation: unknown;
  readonly digest: unknown;
  readonly issued_at: unknown;
  readonly consumed_at: unknown;
  readonly consumed_by_command_id: unknown;
}

type EligibleOperationResolution =
  | {
      readonly type: 'existing_account';
      readonly accountId: string;
    }
  | { readonly type: 'new_account_required' };

interface PersistedSessionFamily {
  readonly sessionId: SessionId;
  readonly accountId: string;
  readonly authenticationOperationId: string;
  readonly status: (typeof SESSION_STATUSES)[number];
  readonly currentCredentialGeneration: number;
  readonly createdAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
  readonly terminalCommandId: string | null;
  readonly terminalReason: string | null;
  readonly terminalAt: UnixEpochSeconds | null;
  readonly terminalReuseGeneration: number | null;
  readonly terminalReuseDigest: string | null;
  readonly commandCount: number;
}

interface PersistedSessionCredential {
  readonly familyId: SessionId;
  readonly generation: number;
  readonly digest: SessionCredentialDigest;
  readonly issuedAt: UnixEpochSeconds;
  readonly consumedAt: UnixEpochSeconds | null;
  readonly consumedByCommandId: string | null;
}

interface ExistingSessionAggregate {
  readonly family: PersistedSessionFamily;
  readonly credentials: readonly PersistedSessionCredential[];
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

function isClosedString<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === 'string' && values.includes(value);
}

function invalidInput(): InitialSessionPersistenceError {
  return new InitialSessionPersistenceError('invalid_input');
}

function invalidPersistedState(): InitialSessionPersistenceError {
  return new InitialSessionPersistenceError('invalid_persisted_state');
}

function validateInput(value: unknown): {
  readonly binding: CreateActiveSessionBinding;
  readonly audit: CreateInitialSessionInput['audit'];
} {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ['binding', 'audit']) ||
    !isRecord(value.binding) ||
    !hasExactlyKeys(value.binding, [
      'sessionId',
      'authenticationOperationId',
      'accountId',
      'createdAt',
      'expiresAt',
      'currentCredential',
    ]) ||
    !isRecord(value.binding.currentCredential) ||
    !hasExactlyKeys(value.binding.currentCredential, [
      'digest',
      'generation',
      'issuedAt',
    ]) ||
    !isRecord(value.audit) ||
    !hasExactlyKeys(value.audit, ['eventId', 'occurredAt']) ||
    !isInternalUuid(value.audit.eventId) ||
    !isUnixEpochSeconds(value.audit.occurredAt)
  ) {
    throw invalidInput();
  }

  const created = createActiveSession(
    value.binding as unknown as CreateActiveSessionBinding,
  );
  if (created.outcome !== 'created') {
    throw invalidInput();
  }

  return Object.freeze({
    binding: Object.freeze({
      sessionId: created.state.sessionId,
      authenticationOperationId:
        created.state.authenticationOperationId,
      accountId: created.state.accountId,
      createdAt: created.state.createdAt,
      expiresAt: created.state.expiresAt,
      currentCredential: Object.freeze({
        digest: created.state.currentCredential.digest,
        generation: created.state.currentCredential.generation,
        issuedAt: created.state.currentCredential.issuedAt,
      }),
    }),
    audit: Object.freeze({
      eventId:
        value.audit.eventId as CreateInitialSessionInput['audit']['eventId'],
      occurredAt: value.audit.occurredAt,
    }),
  });
}

function allNull(values: readonly unknown[]): boolean {
  return values.every((value) => value === null);
}

function hydrateEligibleOperation(
  row: AuthenticationOperationEligibilityRow,
  expectedOperationId: string,
):
  | EligibleOperationResolution
  | { readonly rejection: 'operation_not_completed' }
  | { readonly rejection: 'operation_resolution_ineligible' } {
  if (
    !isAuthenticationOperationId(row.id) ||
    row.id !== expectedOperationId ||
    !isClosedString(row.status, [
      'pending',
      'completed',
      'failed',
      'expired',
    ])
  ) {
    throw invalidPersistedState();
  }

  const resolutionFields = [
    row.resolution_type,
    row.resolution_account_id,
    row.resolution_account_status,
    row.resolution_initial_role,
    row.resolution_reason,
  ];
  if (row.status !== 'completed') {
    if (!allNull(resolutionFields)) {
      throw invalidPersistedState();
    }
    return { rejection: 'operation_not_completed' };
  }

  switch (row.resolution_type) {
    case 'existing_account':
      if (
        !isSessionAccountId(row.resolution_account_id) ||
        row.resolution_account_status !== 'active' ||
        row.resolution_initial_role !== null ||
        row.resolution_reason !== null
      ) {
        throw invalidPersistedState();
      }
      return {
        type: 'existing_account',
        accountId: row.resolution_account_id,
      };
    case 'new_account_required':
      if (
        row.resolution_account_id !== null ||
        row.resolution_account_status !== null ||
        row.resolution_initial_role !== 'player' ||
        row.resolution_reason !== null
      ) {
        throw invalidPersistedState();
      }
      return { type: 'new_account_required' };
    case 'blocked':
      if (
        !isSessionAccountId(row.resolution_account_id) ||
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
      return { rejection: 'operation_resolution_ineligible' };
    case 'conflict':
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
      return { rejection: 'operation_resolution_ineligible' };
    default:
      throw invalidPersistedState();
  }
}

function readEpoch(value: unknown): UnixEpochSeconds {
  try {
    const decoded = decodePostgresNonNegativeBigint(value);
    if (!isUnixEpochSeconds(decoded)) {
      throw invalidPersistedState();
    }
    return decoded;
  } catch {
    throw invalidPersistedState();
  }
}

function readPositiveBigint(value: unknown): number {
  try {
    const decoded = decodePostgresBigint(value);
    if (!isSessionCredentialGeneration(decoded)) {
      throw invalidPersistedState();
    }
    return decoded;
  } catch {
    throw invalidPersistedState();
  }
}

function readNullableEpoch(value: unknown): UnixEpochSeconds | null {
  return value === null ? null : readEpoch(value);
}

function readNullablePositiveBigint(value: unknown): number | null {
  return value === null ? null : readPositiveBigint(value);
}

function readNullableDigest(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  try {
    return decodePostgresByteaDigest(value);
  } catch {
    throw invalidPersistedState();
  }
}

function hydrateFamily(row: ExistingSessionRow): PersistedSessionFamily {
  if (
    !isSessionId(row.family_id) ||
    !isSessionAccountId(row.account_id) ||
    !isAuthenticationOperationId(row.authentication_operation_id) ||
    !isClosedString(row.status, SESSION_STATUSES)
  ) {
    throw invalidPersistedState();
  }

  const currentCredentialGeneration = readPositiveBigint(
    row.current_credential_generation,
  );
  const createdAt = readEpoch(row.created_at);
  const expiresAt = readEpoch(row.expires_at);
  if (createdAt >= expiresAt) {
    throw invalidPersistedState();
  }

  const terminalCommandId =
    row.terminal_command_id === null
      ? null
      : isSessionCommandId(row.terminal_command_id)
        ? row.terminal_command_id
        : (() => {
            throw invalidPersistedState();
          })();
  const terminalAt = readNullableEpoch(row.terminal_at);
  const terminalReuseGeneration = readNullablePositiveBigint(
    row.terminal_reuse_generation,
  );
  const terminalReuseDigest = readNullableDigest(
    row.terminal_reuse_digest,
  );

  if (
    row.status === 'active' &&
    !allNull([
      terminalCommandId,
      row.terminal_reason,
      terminalAt,
      terminalReuseGeneration,
      terminalReuseDigest,
    ])
  ) {
    throw invalidPersistedState();
  }
  if (
    row.status === 'revoked' &&
    (!isSessionCommandId(terminalCommandId) ||
      !isClosedString(row.terminal_reason, SESSION_REVOKE_REASONS) ||
      terminalAt === null ||
      terminalAt < createdAt ||
      terminalAt >= expiresAt ||
      terminalReuseGeneration !== null ||
      terminalReuseDigest !== null)
  ) {
    throw invalidPersistedState();
  }
  if (
    row.status === 'expired' &&
    (!isSessionCommandId(terminalCommandId) ||
      row.terminal_reason !== null ||
      terminalAt === null ||
      terminalAt < expiresAt ||
      terminalReuseGeneration !== null ||
      terminalReuseDigest !== null)
  ) {
    throw invalidPersistedState();
  }
  if (
    row.status === 'reuse_detected' &&
    (!isSessionCommandId(terminalCommandId) ||
      row.terminal_reason !== null ||
      terminalAt === null ||
      terminalAt < createdAt ||
      terminalReuseGeneration === null ||
      terminalReuseDigest === null)
  ) {
    throw invalidPersistedState();
  }

  const commandCount = readEpoch(row.command_count);
  return Object.freeze({
    sessionId: row.family_id,
    accountId: row.account_id,
    authenticationOperationId: row.authentication_operation_id,
    status: row.status,
    currentCredentialGeneration,
    createdAt,
    expiresAt,
    terminalCommandId,
    terminalReason:
      typeof row.terminal_reason === 'string'
        ? row.terminal_reason
        : null,
    terminalAt,
    terminalReuseGeneration,
    terminalReuseDigest,
    commandCount,
  });
}

function credentialColumnsAreAllNull(row: ExistingSessionRow): boolean {
  return allNull([
    row.credential_family_id,
    row.credential_generation,
    row.credential_digest,
    row.credential_issued_at,
    row.credential_consumed_at,
    row.consumed_by_command_id,
  ]);
}

function hydrateCredential(
  row: {
    readonly credential_family_id: unknown;
    readonly credential_generation: unknown;
    readonly credential_digest: unknown;
    readonly credential_issued_at: unknown;
    readonly credential_consumed_at: unknown;
    readonly consumed_by_command_id: unknown;
  },
): PersistedSessionCredential {
  if (!isSessionId(row.credential_family_id)) {
    throw invalidPersistedState();
  }
  let digest: SessionCredentialDigest;
  try {
    digest = decodePostgresByteaDigest(
      row.credential_digest,
    ) as SessionCredentialDigest;
  } catch {
    throw invalidPersistedState();
  }
  const consumedAt = readNullableEpoch(row.credential_consumed_at);
  const consumedByCommandId =
    row.consumed_by_command_id === null
      ? null
      : isSessionCommandId(row.consumed_by_command_id)
        ? row.consumed_by_command_id
        : (() => {
            throw invalidPersistedState();
          })();
  if (
    (consumedAt === null) !== (consumedByCommandId === null)
  ) {
    throw invalidPersistedState();
  }

  return Object.freeze({
    familyId: row.credential_family_id,
    generation: readPositiveBigint(row.credential_generation),
    digest,
    issuedAt: readEpoch(row.credential_issued_at),
    consumedAt,
    consumedByCommandId,
  });
}

function familyEqual(
  left: PersistedSessionFamily,
  right: PersistedSessionFamily,
): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.accountId === right.accountId &&
    left.authenticationOperationId ===
      right.authenticationOperationId &&
    left.status === right.status &&
    left.currentCredentialGeneration ===
      right.currentCredentialGeneration &&
    left.createdAt === right.createdAt &&
    left.expiresAt === right.expiresAt &&
    left.terminalCommandId === right.terminalCommandId &&
    left.terminalReason === right.terminalReason &&
    left.terminalAt === right.terminalAt &&
    left.terminalReuseGeneration === right.terminalReuseGeneration &&
    left.terminalReuseDigest === right.terminalReuseDigest &&
    left.commandCount === right.commandCount
  );
}

function hydrateExistingAggregate(
  rows: readonly ExistingSessionRow[],
): ExistingSessionAggregate | 'multiple_families' | undefined {
  if (rows.length === 0) {
    return undefined;
  }

  const families = new Map<
    SessionId,
    {
      readonly family: PersistedSessionFamily;
      readonly credentials: PersistedSessionCredential[];
    }
  >();
  for (const row of rows) {
    const family = hydrateFamily(row);
    const existing = families.get(family.sessionId);
    if (existing !== undefined && !familyEqual(existing.family, family)) {
      throw invalidPersistedState();
    }
    const aggregate =
      existing ??
      {
        family,
        credentials: [],
      };
    if (existing === undefined) {
      families.set(family.sessionId, aggregate);
    }

    if (!credentialColumnsAreAllNull(row)) {
      const credential = hydrateCredential(row);
      if (
        credential.familyId !== family.sessionId ||
        credential.issuedAt < family.createdAt ||
        credential.issuedAt >= family.expiresAt ||
        (credential.consumedAt !== null &&
          credential.consumedAt < credential.issuedAt)
      ) {
        throw invalidPersistedState();
      }
      aggregate.credentials.push(credential);
    }
  }

  if (families.size !== 1) {
    return 'multiple_families';
  }
  const only = families.values().next().value as {
    readonly family: PersistedSessionFamily;
    readonly credentials: PersistedSessionCredential[];
  };
  return Object.freeze({
    family: only.family,
    credentials: Object.freeze([...only.credentials]),
  });
}

function classifyExistingAggregate(
  aggregate: ExistingSessionAggregate | 'multiple_families',
  binding: CreateActiveSessionBinding,
):
  | { readonly outcome: 'idempotent_retry' }
  | {
      readonly outcome: 'conflict';
      readonly reason:
        | 'session_binding_conflict'
        | 'credential_conflict';
    } {
  if (aggregate === 'multiple_families') {
    return {
      outcome: 'conflict',
      reason: 'session_binding_conflict',
    };
  }

  const family = aggregate.family;
  if (
    family.sessionId !== binding.sessionId ||
    family.accountId !== binding.accountId ||
    family.authenticationOperationId !==
      binding.authenticationOperationId ||
    family.status !== 'active' ||
    family.currentCredentialGeneration !== 1 ||
    family.createdAt !== binding.createdAt ||
    family.expiresAt !== binding.expiresAt ||
    family.terminalCommandId !== null ||
    family.terminalReason !== null ||
    family.terminalAt !== null ||
    family.terminalReuseGeneration !== null ||
    family.terminalReuseDigest !== null ||
    family.commandCount !== 0
  ) {
    return {
      outcome: 'conflict',
      reason: 'session_binding_conflict',
    };
  }

  if (aggregate.credentials.length !== 1) {
    return { outcome: 'conflict', reason: 'credential_conflict' };
  }
  const credential = aggregate.credentials[0];
  if (
    credential.familyId !== binding.sessionId ||
    credential.generation !== 1 ||
    credential.digest !== binding.currentCredential.digest ||
    credential.issuedAt !== binding.currentCredential.issuedAt ||
    credential.consumedAt !== null ||
    credential.consumedByCommandId !== null
  ) {
    return { outcome: 'conflict', reason: 'credential_conflict' };
  }

  return { outcome: 'idempotent_retry' };
}

function mapPostgresFailure(error: unknown): InitialSessionPersistenceFailure {
  const classification = classifyPostgresError(error);
  if (classification.kind !== 'postgres_error') {
    return 'storage_failure';
  }

  const { category, metadata } = classification;
  if (category === 'unique_violation') {
    switch (metadata.constraint) {
      case 'auth_session_families_pkey':
      case 'auth_session_families_operation_id_key':
      case 'auth_session_families_id_account_key':
        return 'session_binding_conflict';
      case 'auth_session_credentials_pkey':
      case 'auth_session_credentials_family_digest_key':
      case 'auth_session_credentials_one_unconsumed_uidx':
        return 'credential_conflict';
      default:
        return 'storage_failure';
    }
  }
  switch (category) {
    case 'foreign_key_violation':
      return 'referential_integrity';
    case 'check_violation':
    case 'not_null_violation':
    case 'invalid_text_representation':
    case 'object_not_in_prerequisite_state':
      return 'invalid_persisted_state';
    case 'insufficient_privilege':
      return 'permission_denied';
    case 'serialization_failure':
    case 'deadlock_detected':
      return 'transaction_conflict';
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled':
      return 'database_unavailable';
    case 'unknown_postgres_error':
      return 'storage_failure';
  }
}

function successResult(
  outcome: 'created' | 'idempotent_retry',
  binding: CreateActiveSessionBinding,
): CreateInitialSessionResult {
  return Object.freeze({
    outcome,
    sessionId: binding.sessionId,
    generation: 1 as const,
    expiresAt: binding.expiresAt,
  });
}

export class PostgresInitialSessionRepository
  implements InitialSessionRepository
{
  constructor(
    private readonly auditRepository: SecurityAuditRepository,
  ) {}

  async createInitialSession(
    transaction: PostgresTransaction,
    rawInput: CreateInitialSessionInput,
  ): Promise<CreateInitialSessionResult> {
    let input: ReturnType<typeof validateInput>;
    try {
      input = validateInput(rawInput);
    } catch (error) {
      if (error instanceof InitialSessionPersistenceError) {
        throw error;
      }
      throw invalidInput();
    }
    const { binding } = input;

    try {
      const operation = await transaction.query<AuthenticationOperationEligibilityRow>(
        SELECT_OPERATION_FOR_UPDATE_SQL,
        [binding.authenticationOperationId],
      );
      if (operation.rowCount !== operation.rows.length) {
        throw invalidPersistedState();
      }
      if (operation.rows.length === 0) {
        return {
          outcome: 'rejected',
          reason: 'operation_not_found',
        };
      }
      if (operation.rows.length !== 1) {
        throw invalidPersistedState();
      }
      const resolution = hydrateEligibleOperation(
        operation.rows[0],
        binding.authenticationOperationId,
      );
      if ('rejection' in resolution) {
        return { outcome: 'rejected', reason: resolution.rejection };
      }

      const account = await transaction.query<AccountRow>(
        SELECT_ACCOUNT_FOR_UPDATE_SQL,
        [binding.accountId],
      );
      if (account.rowCount !== account.rows.length) {
        throw invalidPersistedState();
      }
      if (account.rows.length === 0) {
        return { outcome: 'rejected', reason: 'account_not_found' };
      }
      if (
        account.rows.length !== 1 ||
        !isSessionAccountId(account.rows[0].id) ||
        account.rows[0].id !== binding.accountId ||
        !isClosedString(account.rows[0].status, ACCOUNT_STATUSES)
      ) {
        throw invalidPersistedState();
      }
      if (account.rows[0].status !== 'active') {
        return { outcome: 'rejected', reason: 'account_not_active' };
      }
      if (
        resolution.type === 'existing_account' &&
        resolution.accountId !== binding.accountId
      ) {
        return {
          outcome: 'rejected',
          reason: 'account_binding_conflict',
        };
      }

      const existingRows =
        await transaction.query<ExistingSessionRow>(
          SELECT_EXISTING_SESSION_SQL,
          [binding.sessionId, binding.authenticationOperationId],
        );
      if (existingRows.rowCount !== existingRows.rows.length) {
        throw invalidPersistedState();
      }
      const existing = hydrateExistingAggregate(existingRows.rows);
      if (existing !== undefined) {
        const classified = classifyExistingAggregate(existing, binding);
        if (classified.outcome === 'conflict') {
          return classified;
        }
        await this.appendAudit(
          transaction,
          input,
          'idempotent_retry',
        );
        return successResult('idempotent_retry', binding);
      }

      const insertedFamily =
        await transaction.query<InsertedSessionFamilyRow>(
          INSERT_SESSION_FAMILY_SQL,
          [
            binding.sessionId,
            binding.accountId,
            binding.authenticationOperationId,
            '1',
            binding.createdAt.toString(10),
            binding.expiresAt.toString(10),
          ],
        );
      if (
        insertedFamily.rowCount !== 1 ||
        insertedFamily.rows.length !== 1 ||
        !isSessionId(insertedFamily.rows[0].id) ||
        insertedFamily.rows[0].id !== binding.sessionId
      ) {
        throw invalidPersistedState();
      }

      const credentialDigest = encodePostgresByteaDigest(
        binding.currentCredential.digest,
      );
      const insertedCredential =
        await transaction.query<InsertedSessionCredentialRow>(
          INSERT_SESSION_CREDENTIAL_SQL,
          [
            binding.sessionId,
            '1',
            credentialDigest,
            binding.currentCredential.issuedAt.toString(10),
          ],
        );
      if (
        insertedCredential.rowCount !== 1 ||
        insertedCredential.rows.length !== 1
      ) {
        throw invalidPersistedState();
      }
      const authoritativeCredential = hydrateCredential({
        credential_family_id:
          insertedCredential.rows[0].family_id,
        credential_generation:
          insertedCredential.rows[0].generation,
        credential_digest: insertedCredential.rows[0].digest,
        credential_issued_at:
          insertedCredential.rows[0].issued_at,
        credential_consumed_at:
          insertedCredential.rows[0].consumed_at,
        consumed_by_command_id:
          insertedCredential.rows[0].consumed_by_command_id,
      });
      if (
        authoritativeCredential.familyId !== binding.sessionId ||
        authoritativeCredential.generation !== 1 ||
        authoritativeCredential.digest !==
          binding.currentCredential.digest ||
        authoritativeCredential.issuedAt !==
          binding.currentCredential.issuedAt ||
        authoritativeCredential.consumedAt !== null ||
        authoritativeCredential.consumedByCommandId !== null
      ) {
        throw invalidPersistedState();
      }

      await this.appendAudit(transaction, input, 'success');
      return successResult('created', binding);
    } catch (error) {
      if (error instanceof InitialSessionPersistenceError) {
        throw error;
      }
      throw new InitialSessionPersistenceError(
        mapPostgresFailure(error),
      );
    }
  }

  private async appendAudit(
    transaction: PostgresTransaction,
    input: ReturnType<typeof validateInput>,
    outcome: 'success' | 'idempotent_retry',
  ): Promise<void> {
    const result = await this.auditRepository.append(
      transaction,
      createSecurityAuditEvent({
        eventId: input.audit.eventId,
        eventType: 'session_family_created',
        outcome,
        occurredAt: input.audit.occurredAt,
        metadata: createSecurityAuditMetadata(
          'session_family_created',
          {
            sessionId: input.binding.sessionId,
            accountId: input.binding.accountId,
            authenticationOperationId:
              input.binding.authenticationOperationId,
          },
        ),
      }),
    );
    if (result.status === 'event_id_conflict') {
      throw new InitialSessionPersistenceError('audit_conflict');
    }
  }
}
