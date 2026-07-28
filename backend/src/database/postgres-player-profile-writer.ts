import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import {
  PlayerProfileChanges,
  PlayerProfileWritePersistenceError,
  PlayerProfileWritePersistenceFailure,
  PlayerProfileWriter,
  UpdatePlayerProfileInput,
  UpdatePlayerProfileResult,
} from './player-profile-writer';

const MAX_NAME_CODE_POINTS = 256;
const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const SIDE_PREFERENCES = Object.freeze([
  'Left',
  'Both',
  'Right',
] as const);
const CHANGE_KEYS = Object.freeze([
  'firstName',
  'lastName',
  'phone',
  'sidePreference',
] as const);

const UPDATE_PLAYER_PROFILE_SQL = `
  UPDATE backend_auth.player_profile_details
  SET
    first_name = CASE WHEN $2::boolean THEN $3::text ELSE first_name END,
    last_name = CASE WHEN $4::boolean THEN $5::text ELSE last_name END,
    phone = CASE WHEN $6::boolean THEN $7::text ELSE phone END,
    side_preference =
      CASE WHEN $8::boolean THEN $9::text ELSE side_preference END,
    updated_at = $10::bigint
  WHERE account_id = $1::uuid
  RETURNING account_id
`;

interface UpdatedRow extends QueryResultRow {
  readonly account_id: unknown;
}

function failure(
  reason: PlayerProfileWritePersistenceFailure,
): PlayerProfileWritePersistenceError {
  return new PlayerProfileWritePersistenceError(reason);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasOwn(
  value: object,
  key: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    [...value].length <= MAX_NAME_CODE_POINTS
  );
}

function validNullableName(value: unknown): value is string | null {
  return value === null || validName(value);
}

function validPhone(value: unknown): value is string | null {
  return value === null ||
    (typeof value === 'string' && PHONE_PATTERN.test(value));
}

function validSidePreference(
  value: unknown,
): value is NonNullable<PlayerProfileChanges['sidePreference']> {
  return (
    typeof value === 'string' &&
    SIDE_PREFERENCES.includes(
      value as (typeof SIDE_PREFERENCES)[number],
    )
  );
}

function validateChanges(value: unknown): PlayerProfileChanges {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length === 0 ||
    Object.keys(value).some(
      (key) => !CHANGE_KEYS.includes(key as (typeof CHANGE_KEYS)[number]),
    ) ||
    (hasOwn(value, 'firstName') && !validName(value.firstName)) ||
    (hasOwn(value, 'lastName') && !validNullableName(value.lastName)) ||
    (hasOwn(value, 'phone') && !validPhone(value.phone)) ||
    (hasOwn(value, 'sidePreference') &&
      !validSidePreference(value.sidePreference))
  ) {
    throw failure('invalid_input');
  }

  return Object.freeze({
    ...(hasOwn(value, 'firstName')
      ? { firstName: value.firstName as string }
      : {}),
    ...(hasOwn(value, 'lastName')
      ? { lastName: value.lastName as string | null }
      : {}),
    ...(hasOwn(value, 'phone')
      ? { phone: value.phone as string | null }
      : {}),
    ...(hasOwn(value, 'sidePreference')
      ? {
          sidePreference:
            value.sidePreference as NonNullable<
              PlayerProfileChanges['sidePreference']
            >,
        }
      : {}),
  });
}

function validateInput(value: unknown): UpdatePlayerProfileInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 3 ||
    !hasOwn(value, 'accountId') ||
    !hasOwn(value, 'changes') ||
    !hasOwn(value, 'updatedAt') ||
    !isAccountId(value.accountId) ||
    !isUnixEpochSeconds(value.updatedAt)
  ) {
    throw failure('invalid_input');
  }
  return Object.freeze({
    accountId: value.accountId,
    changes: validateChanges(value.changes),
    updatedAt: value.updatedAt,
  });
}

function mapPersistenceError(
  error: unknown,
): PlayerProfileWritePersistenceError {
  if (error instanceof PlayerProfileWritePersistenceError) {
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

const NOT_FOUND: UpdatePlayerProfileResult = Object.freeze({
  outcome: 'not_found',
});
const UPDATED: UpdatePlayerProfileResult = Object.freeze({
  outcome: 'updated',
});

export class PostgresPlayerProfileWriter implements PlayerProfileWriter {
  async updateByAccountId(
    transaction: PostgresTransaction,
    input: UpdatePlayerProfileInput,
  ): Promise<UpdatePlayerProfileResult> {
    try {
      const validated = validateInput(input);
      const changes = validated.changes;
      const hasFirstName = hasOwn(changes, 'firstName');
      const hasLastName = hasOwn(changes, 'lastName');
      const hasPhone = hasOwn(changes, 'phone');
      const hasSidePreference = hasOwn(changes, 'sidePreference');
      const updated = await transaction.query<UpdatedRow>(
        UPDATE_PLAYER_PROFILE_SQL,
        [
          validated.accountId,
          hasFirstName,
          changes.firstName ?? null,
          hasLastName,
          changes.lastName ?? null,
          hasPhone,
          changes.phone ?? null,
          hasSidePreference,
          changes.sidePreference ?? null,
          validated.updatedAt,
        ],
      );

      if (updated.rowCount === 0 && updated.rows.length === 0) {
        return NOT_FOUND;
      }
      if (
        updated.rowCount !== 1 ||
        updated.rows.length !== 1 ||
        updated.rows[0].account_id !== validated.accountId
      ) {
        throw failure('invalid_persisted_state');
      }
      return UPDATED;
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
