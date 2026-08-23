import { Injectable } from '@nestjs/common';
import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds, unixEpochSeconds } from '../auth/auth.types';
import {
  AccountNotificationPreferenceRecord,
  AccountNotificationPreferencesPersistenceError,
  AccountNotificationPreferencesPersistenceFailure,
  AccountNotificationPreferencesRepository,
  ReadAccountNotificationPreferenceInput,
  ReadAccountNotificationPreferenceResult,
  SaveAccountNotificationPreferenceInput,
  SaveAccountNotificationPreferenceResult,
} from './account-notification-preferences.repository';
import { decodePostgresBigint, PostgresCodecError } from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';

const FIND_SQL = `
  SELECT
    account_id,
    telegram_match_notifications_enabled,
    created_at,
    updated_at,
    version
  FROM backend_auth.account_notification_preferences
  WHERE account_id = $1
`;

const INSERT_SQL = `
  INSERT INTO backend_auth.account_notification_preferences (
    account_id,
    telegram_match_notifications_enabled,
    created_at,
    updated_at,
    version
  )
  VALUES ($1, $2, $3, $3, 1)
  ON CONFLICT ON CONSTRAINT account_notification_preferences_pkey
    DO NOTHING
  RETURNING
    account_id,
    telegram_match_notifications_enabled,
    created_at,
    updated_at,
    version
`;

const UPDATE_SQL = `
  UPDATE backend_auth.account_notification_preferences
  SET
    telegram_match_notifications_enabled = $2,
    updated_at = GREATEST(updated_at, $4),
    version = version + 1
  WHERE account_id = $1
    AND version = $3
    AND version < 9007199254740991
  RETURNING
    account_id,
    telegram_match_notifications_enabled,
    created_at,
    updated_at,
    version
`;

interface PreferenceRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly telegram_match_notifications_enabled: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly version: unknown;
}

const MISSING: ReadAccountNotificationPreferenceResult = Object.freeze({
  outcome: 'missing',
});
const CONFLICT: SaveAccountNotificationPreferenceResult = Object.freeze({
  outcome: 'conflict',
});

function failure(
  reason: AccountNotificationPreferencesPersistenceFailure,
): AccountNotificationPreferencesPersistenceError {
  return new AccountNotificationPreferencesPersistenceError(reason);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function readInput(value: unknown): ReadAccountNotificationPreferenceInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 1 ||
    !isAccountId(value.accountId)
  ) {
    throw failure('invalid_input');
  }
  return Object.freeze({ accountId: value.accountId });
}

function saveInput(value: unknown): SaveAccountNotificationPreferenceInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 4 ||
    !isAccountId(value.accountId) ||
    typeof value.telegramMatchNotificationsEnabled !== 'boolean' ||
    !(
      value.expectedVersion === null ||
      (typeof value.expectedVersion === 'number' &&
        Number.isSafeInteger(value.expectedVersion) &&
        value.expectedVersion >= 1)
    ) ||
    !isUnixEpochSeconds(value.updatedAt)
  ) {
    throw failure('invalid_input');
  }
  return Object.freeze({
    accountId: value.accountId,
    telegramMatchNotificationsEnabled: value.telegramMatchNotificationsEnabled,
    expectedVersion: value.expectedVersion,
    updatedAt: value.updatedAt,
  });
}

function hydrate(
  row: PreferenceRow,
  expectedAccountId: ReadAccountNotificationPreferenceInput['accountId'],
): AccountNotificationPreferenceRecord {
  try {
    const createdAt = decodePostgresBigint(row.created_at);
    const updatedAt = decodePostgresBigint(row.updated_at);
    const version = decodePostgresBigint(row.version);
    if (
      !isAccountId(row.account_id) ||
      row.account_id !== expectedAccountId ||
      typeof row.telegram_match_notifications_enabled !== 'boolean' ||
      !isUnixEpochSeconds(createdAt) ||
      !isUnixEpochSeconds(updatedAt) ||
      updatedAt < createdAt ||
      !Number.isSafeInteger(version) ||
      version < 1
    ) {
      throw failure('invalid_persisted_state');
    }
    return Object.freeze({
      accountId: row.account_id,
      telegramMatchNotificationsEnabled:
        row.telegram_match_notifications_enabled,
      createdAt: unixEpochSeconds(createdAt),
      updatedAt: unixEpochSeconds(updatedAt),
      version,
    });
  } catch (error) {
    if (error instanceof AccountNotificationPreferencesPersistenceError) {
      throw error;
    }
    if (error instanceof PostgresCodecError) {
      throw failure('invalid_persisted_state');
    }
    throw error;
  }
}

function mapPersistenceError(
  error: unknown,
): AccountNotificationPreferencesPersistenceError {
  if (error instanceof AccountNotificationPreferencesPersistenceError) {
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

@Injectable()
export class PostgresAccountNotificationPreferencesRepository implements AccountNotificationPreferencesRepository {
  async findByAccountId(
    transaction: PostgresTransaction,
    rawInput: ReadAccountNotificationPreferenceInput,
  ): Promise<ReadAccountNotificationPreferenceResult> {
    const input = readInput(rawInput);
    try {
      const result = await transaction.query<PreferenceRow>(FIND_SQL, [
        input.accountId,
      ]);
      if (result.rows.length === 0) {
        return MISSING;
      }
      if (result.rows.length !== 1) {
        throw failure('invalid_persisted_state');
      }
      return Object.freeze({
        outcome: 'found',
        preference: hydrate(result.rows[0], input.accountId),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async save(
    transaction: PostgresTransaction,
    rawInput: SaveAccountNotificationPreferenceInput,
  ): Promise<SaveAccountNotificationPreferenceResult> {
    const input = saveInput(rawInput);
    try {
      const result =
        input.expectedVersion === null
          ? await transaction.query<PreferenceRow>(INSERT_SQL, [
              input.accountId,
              input.telegramMatchNotificationsEnabled,
              input.updatedAt,
            ])
          : await transaction.query<PreferenceRow>(UPDATE_SQL, [
              input.accountId,
              input.telegramMatchNotificationsEnabled,
              input.expectedVersion,
              input.updatedAt,
            ]);
      if (result.rows.length === 0) {
        return CONFLICT;
      }
      if (result.rows.length !== 1) {
        throw failure('invalid_persisted_state');
      }
      return Object.freeze({
        outcome: 'saved',
        preference: hydrate(result.rows[0], input.accountId),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
