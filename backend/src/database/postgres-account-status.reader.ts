import {
  ACCOUNT_STATUSES,
  AccountId,
  AccountStatus,
  USER_ROLES,
  UserRole,
  isAccountId,
} from '../accounts/account.types';
import { AccountStatusReader } from '../auth/telegram-login.ports';
import {
  PostgresCodecError,
  decodePostgresNonNegativeBigint,
} from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';

const SELECT_ACCOUNT_STATUS_SQL = `
  SELECT
    id,
    role,
    status,
    created_at,
    updated_at
  FROM backend_auth.accounts
  WHERE id = $1
`;

export type PostgresAccountStatusReaderFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PostgresAccountStatusReaderError extends Error {
  readonly name = 'PostgresAccountStatusReaderError';

  constructor(readonly reason: PostgresAccountStatusReaderFailure) {
    super('Account status persistence read failed');
  }
}

interface AccountStatusRow {
  readonly id: unknown;
  readonly role: unknown;
  readonly status: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
}

type FoundAccountStatus = Extract<
  Awaited<ReturnType<AccountStatusReader['findById']>>,
  { readonly outcome: 'found' }
>;

const NOT_FOUND = Object.freeze({ outcome: 'not_found' as const });

function failure(
  reason: PostgresAccountStatusReaderFailure,
): PostgresAccountStatusReaderError {
  return new PostgresAccountStatusReaderError(reason);
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

function hydrateAccount(
  row: AccountStatusRow,
  expectedAccountId: AccountId,
): FoundAccountStatus {
  try {
    if (
      !isAccountId(row.id) ||
      row.id !== expectedAccountId ||
      !isClosedValue(row.role, USER_ROLES) ||
      !isClosedValue(row.status, ACCOUNT_STATUSES)
    ) {
      throw failure('invalid_persisted_state');
    }

    const createdAt = decodePostgresNonNegativeBigint(row.created_at);
    const updatedAt = decodePostgresNonNegativeBigint(row.updated_at);
    if (updatedAt < createdAt) {
      throw failure('invalid_persisted_state');
    }

    return Object.freeze({
      outcome: 'found',
      accountId: row.id,
      role: row.role as UserRole,
      status: row.status as AccountStatus,
    });
  } catch (error) {
    if (error instanceof PostgresAccountStatusReaderError) {
      throw error;
    }
    if (error instanceof PostgresCodecError) {
      throw failure('invalid_persisted_state');
    }
    throw failure('invalid_persisted_state');
  }
}

function mapReadError(error: unknown): PostgresAccountStatusReaderError {
  if (error instanceof PostgresAccountStatusReaderError) {
    return error;
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

export class PostgresAccountStatusReader implements AccountStatusReader {
  async findById(
    transaction: PostgresTransaction,
    accountId: AccountId,
  ): ReturnType<AccountStatusReader['findById']> {
    if (!isAccountId(accountId)) {
      throw failure('invalid_input');
    }

    try {
      const selected = await transaction.query<AccountStatusRow>(
        SELECT_ACCOUNT_STATUS_SQL,
        [accountId],
      );
      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length > 1
      ) {
        throw failure('invalid_persisted_state');
      }
      if (selected.rows.length === 0) {
        return NOT_FOUND;
      }

      return hydrateAccount(selected.rows[0], accountId);
    } catch (error) {
      throw mapReadError(error);
    }
  }
}
