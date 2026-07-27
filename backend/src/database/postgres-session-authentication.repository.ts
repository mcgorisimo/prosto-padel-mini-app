import { QueryResultRow } from 'pg';
import {
  ACCOUNT_STATUSES,
  AccountId,
  AccountStatus,
  USER_ROLES,
  UserRole,
  isAccountId,
} from '../accounts/account.types';
import {
  UnixEpochSeconds,
  isUnixEpochSeconds,
} from '../auth/auth.types';
import {
  SessionCredentialDigest,
  SessionId,
  isSessionCredentialDigest,
  isSessionCredentialGeneration,
  isSessionId,
} from '../auth/session.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  PostgresCodecError,
  decodePostgresByteaDigest,
  decodePostgresNonNegativeBigint,
  encodePostgresByteaDigest,
} from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import {
  AuthenticateSessionCredentialInput,
  AuthenticateSessionCredentialResult,
  SessionAuthenticationPersistenceError,
  SessionAuthenticationPersistenceFailure,
  SessionAuthenticationRepository,
} from './session-authentication.repository';

const FIND_SESSION_FAMILY_SQL = `
  SELECT family_id
  FROM backend_auth.auth_session_credentials
  WHERE digest = $1
  ORDER BY family_id
`;

const LOCK_SESSION_FAMILY_AND_ACCOUNT_SQL = `
  SELECT
    f.id AS family_id,
    f.account_id,
    f.status AS session_status,
    f.current_credential_generation,
    f.created_at AS session_created_at,
    f.expires_at,
    a.role AS account_role,
    a.status AS account_status,
    a.created_at AS account_created_at,
    a.updated_at AS account_updated_at
  FROM backend_auth.auth_session_families f
  JOIN backend_auth.accounts a
    ON a.id = f.account_id
  WHERE f.id = $1
  FOR SHARE OF f, a
`;

const LOCK_PRESENTED_CREDENTIAL_SQL = `
  SELECT
    family_id,
    generation,
    digest,
    issued_at,
    consumed_at,
    consumed_by_command_id
  FROM backend_auth.auth_session_credentials
  WHERE family_id = $1
    AND digest = $2
  FOR SHARE
`;

const SESSION_STATUSES = Object.freeze([
  'active',
  'revoked',
  'expired',
  'reuse_detected',
] as const);

interface FamilyLookupRow extends QueryResultRow {
  readonly family_id: unknown;
}

interface LockedSessionFamilyRow extends QueryResultRow {
  readonly family_id: unknown;
  readonly account_id: unknown;
  readonly session_status: unknown;
  readonly current_credential_generation: unknown;
  readonly session_created_at: unknown;
  readonly expires_at: unknown;
  readonly account_role: unknown;
  readonly account_status: unknown;
  readonly account_created_at: unknown;
  readonly account_updated_at: unknown;
}

interface LockedCredentialRow extends QueryResultRow {
  readonly family_id: unknown;
  readonly generation: unknown;
  readonly digest: unknown;
  readonly issued_at: unknown;
  readonly consumed_at: unknown;
  readonly consumed_by_command_id: unknown;
}

interface HydratedFamily {
  readonly sessionId: SessionId;
  readonly accountId: AccountId;
  readonly sessionStatus: (typeof SESSION_STATUSES)[number];
  readonly currentGeneration: number;
  readonly createdAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
  readonly accountRole: UserRole;
  readonly accountStatus: AccountStatus;
}

interface HydratedCredential {
  readonly familyId: SessionId;
  readonly generation: number;
  readonly digest: SessionCredentialDigest;
  readonly issuedAt: UnixEpochSeconds;
  readonly consumedAt: UnixEpochSeconds | null;
  readonly consumedByCommandId: string | null;
}

const REJECTED: AuthenticateSessionCredentialResult = Object.freeze({
  outcome: 'rejected',
});

function failure(
  reason: SessionAuthenticationPersistenceFailure,
): SessionAuthenticationPersistenceError {
  return new SessionAuthenticationPersistenceError(reason);
}

function isClosedValue<const Value extends string>(
  value: unknown,
  allowed: readonly Value[],
): value is Value {
  return (
    typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
  );
}

function decodeEpochSeconds(value: unknown): UnixEpochSeconds {
  const decoded = decodePostgresNonNegativeBigint(value);
  if (!isUnixEpochSeconds(decoded)) {
    throw failure('invalid_persisted_state');
  }
  return decoded;
}

function hydrateFamily(row: LockedSessionFamilyRow): HydratedFamily {
  if (
    !isSessionId(row.family_id) ||
    !isAccountId(row.account_id) ||
    !isClosedValue(row.session_status, SESSION_STATUSES) ||
    !isClosedValue(row.account_role, USER_ROLES) ||
    !isClosedValue(row.account_status, ACCOUNT_STATUSES)
  ) {
    throw failure('invalid_persisted_state');
  }

  const currentGeneration = decodePostgresNonNegativeBigint(
    row.current_credential_generation,
  );
  const createdAt = decodeEpochSeconds(row.session_created_at);
  const expiresAt = decodeEpochSeconds(row.expires_at);
  const accountCreatedAt = decodeEpochSeconds(row.account_created_at);
  const accountUpdatedAt = decodeEpochSeconds(row.account_updated_at);
  if (
    !isSessionCredentialGeneration(currentGeneration) ||
    createdAt >= expiresAt ||
    accountUpdatedAt < accountCreatedAt
  ) {
    throw failure('invalid_persisted_state');
  }

  return Object.freeze({
    sessionId: row.family_id,
    accountId: row.account_id,
    sessionStatus: row.session_status,
    currentGeneration,
    createdAt,
    expiresAt,
    accountRole: row.account_role,
    accountStatus: row.account_status,
  });
}

function hydrateCredential(
  row: LockedCredentialRow,
  expectedFamilyId: SessionId,
  expectedDigest: SessionCredentialDigest,
): HydratedCredential {
  if (
    !isSessionId(row.family_id) ||
    row.family_id !== expectedFamilyId ||
    !isSessionCredentialGeneration(
      decodePostgresNonNegativeBigint(row.generation),
    )
  ) {
    throw failure('invalid_persisted_state');
  }
  const digest = decodePostgresByteaDigest(row.digest);
  if (!isSessionCredentialDigest(digest) || digest !== expectedDigest) {
    throw failure('invalid_persisted_state');
  }
  const issuedAt = decodeEpochSeconds(row.issued_at);
  const consumedAt =
    row.consumed_at === null ? null : decodeEpochSeconds(row.consumed_at);
  const consumedByCommandId =
    row.consumed_by_command_id === null
      ? null
      : isInternalUuid(row.consumed_by_command_id)
        ? row.consumed_by_command_id
        : undefined;
  if (
    consumedByCommandId === undefined ||
    (consumedAt === null) !== (consumedByCommandId === null) ||
    (consumedAt !== null && consumedAt < issuedAt)
  ) {
    throw failure('invalid_persisted_state');
  }

  return Object.freeze({
    familyId: row.family_id,
    generation: decodePostgresNonNegativeBigint(row.generation),
    digest,
    issuedAt,
    consumedAt,
    consumedByCommandId,
  });
}

function assertInput(input: AuthenticateSessionCredentialInput): void {
  const expectedKeys = ['presentedCredentialDigest', 'now'] as const;
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).length !== expectedKeys.length ||
    !expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(input, key),
    ) ||
    !isSessionCredentialDigest(input.presentedCredentialDigest) ||
    !isUnixEpochSeconds(input.now)
  ) {
    throw failure('invalid_input');
  }
}

function validateResultCardinality(
  rowCount: number | null,
  rowsLength: number,
  maximum: number,
): void {
  if (rowCount !== rowsLength || rowsLength > maximum) {
    throw failure('invalid_persisted_state');
  }
}

function mapPersistenceError(
  error: unknown,
): SessionAuthenticationPersistenceError {
  if (error instanceof SessionAuthenticationPersistenceError) {
    return error;
  }
  if (error instanceof PostgresCodecError) {
    return failure('invalid_persisted_state');
  }

  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return failure('storage_failure');
  }
  switch (classified.category) {
    case 'insufficient_privilege':
      return failure('permission_denied');
    case 'serialization_failure':
    case 'deadlock_detected':
      return failure('transaction_conflict');
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled':
      return failure('database_unavailable');
    default:
      return failure('storage_failure');
  }
}

export class PostgresSessionAuthenticationRepository
  implements SessionAuthenticationRepository
{
  async authenticatePresentedCredential(
    transaction: PostgresTransaction,
    input: AuthenticateSessionCredentialInput,
  ): Promise<AuthenticateSessionCredentialResult> {
    assertInput(input);

    try {
      const digest = encodePostgresByteaDigest(
        input.presentedCredentialDigest,
      );
      const familyLookup = await transaction.query<FamilyLookupRow>(
        FIND_SESSION_FAMILY_SQL,
        [digest],
      );
      validateResultCardinality(
        familyLookup.rowCount,
        familyLookup.rows.length,
        1,
      );
      if (familyLookup.rows.length === 0) {
        return REJECTED;
      }
      const familyId = familyLookup.rows[0].family_id;
      if (!isSessionId(familyId)) {
        throw failure('invalid_persisted_state');
      }

      const lockedFamily =
        await transaction.query<LockedSessionFamilyRow>(
          LOCK_SESSION_FAMILY_AND_ACCOUNT_SQL,
          [familyId],
        );
      validateResultCardinality(
        lockedFamily.rowCount,
        lockedFamily.rows.length,
        1,
      );
      if (lockedFamily.rows.length !== 1) {
        throw failure('invalid_persisted_state');
      }
      const family = hydrateFamily(lockedFamily.rows[0]);
      if (family.sessionId !== familyId) {
        throw failure('invalid_persisted_state');
      }

      const lockedCredential =
        await transaction.query<LockedCredentialRow>(
          LOCK_PRESENTED_CREDENTIAL_SQL,
          [familyId, digest],
        );
      validateResultCardinality(
        lockedCredential.rowCount,
        lockedCredential.rows.length,
        1,
      );
      if (lockedCredential.rows.length !== 1) {
        throw failure('invalid_persisted_state');
      }
      const credential = hydrateCredential(
        lockedCredential.rows[0],
        familyId,
        input.presentedCredentialDigest,
      );

      if (
        family.sessionStatus !== 'active' ||
        family.accountStatus !== 'active' ||
        input.now >= family.expiresAt ||
        credential.generation !== family.currentGeneration ||
        credential.consumedAt !== null ||
        credential.issuedAt > input.now
      ) {
        return REJECTED;
      }

      return Object.freeze({
        outcome: 'authenticated',
        accountId: family.accountId,
        role: family.accountRole,
        expiresAt: family.expiresAt,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
