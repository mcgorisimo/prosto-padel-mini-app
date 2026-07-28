import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { classifyPostgresError } from './postgres-error-classifier';
import {
  PlayerProfileReadPersistenceError,
  PlayerProfileReadPersistenceFailure,
  PlayerProfileReader,
  PlayerProfileRecord,
  ReadPlayerProfileInput,
  ReadPlayerProfileResult,
} from './player-profile-reader';
import { PostgresTransaction } from './postgres-transaction';

const MAX_NAME_CODE_POINTS = 256;
const MAX_SHORT_TEXT_CODE_POINTS = 64;
const MAX_PHOTO_URL_CODE_POINTS = 2_048;
const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const SIDE_PREFERENCES = Object.freeze([
  'Left',
  'Both',
  'Right',
] as const);

const FIND_PLAYER_PROFILE_SQL = `
  SELECT
    account_id,
    first_name,
    last_name,
    username,
    photo_url,
    language_code,
    phone,
    side_preference
  FROM backend_auth.player_profile_details
  WHERE account_id = $1
`;

interface PlayerProfileRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly first_name: unknown;
  readonly last_name: unknown;
  readonly username: unknown;
  readonly photo_url: unknown;
  readonly language_code: unknown;
  readonly phone: unknown;
  readonly side_preference: unknown;
}

function failure(
  reason: PlayerProfileReadPersistenceFailure,
): PlayerProfileReadPersistenceError {
  return new PlayerProfileReadPersistenceError(reason);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validateInput(value: unknown): ReadPlayerProfileInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(value, 'accountId') ||
    !isAccountId(value.accountId)
  ) {
    throw failure('invalid_input');
  }
  return Object.freeze({ accountId: value.accountId });
}

function isBoundedString(
  value: unknown,
  maxCodePoints: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= maxCodePoints
  );
}

function readOptionalString(
  value: unknown,
  maxCodePoints: number,
): string | undefined {
  if (value === null) {
    return undefined;
  }
  if (!isBoundedString(value, maxCodePoints)) {
    throw failure('invalid_persisted_state');
  }
  return value;
}

function readPhotoUrl(value: unknown): string | undefined {
  const photoUrl = readOptionalString(
    value,
    MAX_PHOTO_URL_CODE_POINTS,
  );
  if (photoUrl === undefined) {
    return undefined;
  }
  try {
    if (new URL(photoUrl).protocol !== 'https:') {
      throw failure('invalid_persisted_state');
    }
  } catch (error) {
    if (error instanceof PlayerProfileReadPersistenceError) {
      throw error;
    }
    throw failure('invalid_persisted_state');
  }
  return photoUrl;
}

function readPhone(value: unknown): string | undefined {
  if (value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || !PHONE_PATTERN.test(value)) {
    throw failure('invalid_persisted_state');
  }
  return value;
}

function readSidePreference(
  value: unknown,
): PlayerProfileRecord['sidePreference'] | undefined {
  if (value === null) {
    return undefined;
  }
  if (
    typeof value !== 'string' ||
    !SIDE_PREFERENCES.includes(
      value as (typeof SIDE_PREFERENCES)[number],
    )
  ) {
    throw failure('invalid_persisted_state');
  }
  return value as (typeof SIDE_PREFERENCES)[number];
}

function hydrateProfile(
  row: PlayerProfileRow,
  expectedAccountId: ReadPlayerProfileInput['accountId'],
): PlayerProfileRecord {
  if (
    !isAccountId(row.account_id) ||
    row.account_id !== expectedAccountId ||
    !isBoundedString(row.first_name, MAX_NAME_CODE_POINTS)
  ) {
    throw failure('invalid_persisted_state');
  }

  const lastName = readOptionalString(
    row.last_name,
    MAX_NAME_CODE_POINTS,
  );
  const username = readOptionalString(
    row.username,
    MAX_SHORT_TEXT_CODE_POINTS,
  );
  const languageCode = readOptionalString(
    row.language_code,
    MAX_SHORT_TEXT_CODE_POINTS,
  );
  const photoUrl = readPhotoUrl(row.photo_url);
  const phone = readPhone(row.phone);
  const sidePreference = readSidePreference(row.side_preference);

  return Object.freeze({
    accountId: row.account_id,
    firstName: row.first_name,
    ...(lastName === undefined ? {} : { lastName }),
    ...(username === undefined ? {} : { username }),
    ...(photoUrl === undefined ? {} : { photoUrl }),
    ...(languageCode === undefined ? {} : { languageCode }),
    ...(phone === undefined ? {} : { phone }),
    ...(sidePreference === undefined ? {} : { sidePreference }),
  });
}

function mapPersistenceError(
  error: unknown,
): PlayerProfileReadPersistenceError {
  if (error instanceof PlayerProfileReadPersistenceError) {
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

const NOT_FOUND: ReadPlayerProfileResult = Object.freeze({
  outcome: 'not_found',
});

export class PostgresPlayerProfileReader implements PlayerProfileReader {
  async findByAccountId(
    transaction: PostgresTransaction,
    input: ReadPlayerProfileInput,
  ): Promise<ReadPlayerProfileResult> {
    try {
      const validated = validateInput(input);
      const selected = await transaction.query<PlayerProfileRow>(
        FIND_PLAYER_PROFILE_SQL,
        [validated.accountId],
      );

      if (selected.rowCount === 0 && selected.rows.length === 0) {
        return NOT_FOUND;
      }
      if (selected.rowCount !== 1 || selected.rows.length !== 1) {
        throw failure('invalid_persisted_state');
      }

      return Object.freeze({
        outcome: 'found',
        profile: hydrateProfile(
          selected.rows[0],
          validated.accountId,
        ),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
