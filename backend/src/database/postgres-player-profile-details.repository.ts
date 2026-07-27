import { isAccountId } from '../accounts/account.types';
import {
  VerifiedTelegramProfileDetails,
  isUnixEpochSeconds,
} from '../auth/auth.types';
import { classifyPostgresError } from './postgres-error-classifier';
import {
  CreatePlayerProfileDetailsInput,
  CreatePlayerProfileDetailsResult,
  PlayerProfileDetailsPersistenceError,
  PlayerProfileDetailsPersistenceFailure,
  PlayerProfileDetailsRepository,
} from './player-profile-details.repository';
import { PostgresTransaction } from './postgres-transaction';

const MAX_NAME_CODE_POINTS = 256;
const MAX_SHORT_TEXT_CODE_POINTS = 64;
const MAX_PHOTO_URL_CODE_POINTS = 2_048;

const INSERT_PLAYER_PROFILE_DETAILS_SQL = `
  INSERT INTO backend_auth.player_profile_details (
    account_id,
    first_name,
    last_name,
    username,
    photo_url,
    language_code,
    created_at,
    updated_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
  ON CONFLICT (account_id) DO NOTHING
  RETURNING account_id
`;

interface InsertedPlayerProfileDetailsRow {
  readonly account_id: unknown;
}

interface ValidatedPlayerProfileDetailsInput {
  readonly accountId: CreatePlayerProfileDetailsInput['accountId'];
  readonly profile: VerifiedTelegramProfileDetails;
  readonly observedAt: CreatePlayerProfileDetailsInput['observedAt'];
}

function failure(
  reason: PlayerProfileDetailsPersistenceFailure,
): PlayerProfileDetailsPersistenceError {
  return new PlayerProfileDetailsPersistenceError(reason);
}

function invalidInput(): PlayerProfileDetailsPersistenceError {
  return failure('invalid_input');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
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
  profile: Record<string, unknown>,
  field: 'lastName' | 'username' | 'languageCode',
  maxCodePoints: number,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(profile, field)) {
    return undefined;
  }
  const value = profile[field];
  if (!isBoundedString(value, maxCodePoints)) {
    throw invalidInput();
  }
  return value;
}

function readPhotoUrl(
  profile: Record<string, unknown>,
): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(profile, 'photoUrl')) {
    return undefined;
  }
  const value = profile.photoUrl;
  if (!isBoundedString(value, MAX_PHOTO_URL_CODE_POINTS)) {
    throw invalidInput();
  }

  try {
    if (new URL(value).protocol !== 'https:') {
      throw invalidInput();
    }
  } catch (error) {
    if (error instanceof PlayerProfileDetailsPersistenceError) {
      throw error;
    }
    throw invalidInput();
  }
  return value;
}

function validateProfile(
  value: unknown,
): VerifiedTelegramProfileDetails {
  if (!isPlainRecord(value)) {
    throw invalidInput();
  }

  const allowedKeys = new Set([
    'firstName',
    'lastName',
    'username',
    'languageCode',
    'photoUrl',
  ]);
  if (
    !Object.prototype.hasOwnProperty.call(value, 'firstName') ||
    Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    !isBoundedString(value.firstName, MAX_NAME_CODE_POINTS)
  ) {
    throw invalidInput();
  }

  const lastName = readOptionalString(
    value,
    'lastName',
    MAX_NAME_CODE_POINTS,
  );
  const username = readOptionalString(
    value,
    'username',
    MAX_SHORT_TEXT_CODE_POINTS,
  );
  const languageCode = readOptionalString(
    value,
    'languageCode',
    MAX_SHORT_TEXT_CODE_POINTS,
  );
  const photoUrl = readPhotoUrl(value);

  return Object.freeze({
    firstName: value.firstName,
    ...(lastName === undefined ? {} : { lastName }),
    ...(username === undefined ? {} : { username }),
    ...(languageCode === undefined ? {} : { languageCode }),
    ...(photoUrl === undefined ? {} : { photoUrl }),
  });
}

function validateInput(
  value: unknown,
): ValidatedPlayerProfileDetailsInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 3 ||
    !Object.prototype.hasOwnProperty.call(value, 'accountId') ||
    !Object.prototype.hasOwnProperty.call(value, 'profile') ||
    !Object.prototype.hasOwnProperty.call(value, 'observedAt') ||
    !isAccountId(value.accountId) ||
    !isUnixEpochSeconds(value.observedAt)
  ) {
    throw invalidInput();
  }

  return Object.freeze({
    accountId: value.accountId,
    profile: validateProfile(value.profile),
    observedAt: value.observedAt,
  });
}

function mapPersistenceError(
  error: unknown,
): PlayerProfileDetailsPersistenceError {
  if (error instanceof PlayerProfileDetailsPersistenceError) {
    return error;
  }

  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return failure('storage_failure');
  }

  switch (classified.category) {
    case 'foreign_key_violation':
      return failure('referential_integrity');
    case 'check_violation':
    case 'not_null_violation':
    case 'invalid_text_representation':
      return failure('invalid_input');
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

function result(
  outcome: CreatePlayerProfileDetailsResult['outcome'],
  accountId: CreatePlayerProfileDetailsInput['accountId'],
): CreatePlayerProfileDetailsResult {
  return Object.freeze({ outcome, accountId });
}

export class PostgresPlayerProfileDetailsRepository
  implements PlayerProfileDetailsRepository
{
  async createIfAbsent(
    transaction: PostgresTransaction,
    input: CreatePlayerProfileDetailsInput,
  ): Promise<CreatePlayerProfileDetailsResult> {
    try {
      const validated = validateInput(input);
      const profile = validated.profile;
      const inserted =
        await transaction.query<InsertedPlayerProfileDetailsRow>(
          INSERT_PLAYER_PROFILE_DETAILS_SQL,
          [
            validated.accountId,
            profile.firstName,
            profile.lastName ?? null,
            profile.username ?? null,
            profile.photoUrl ?? null,
            profile.languageCode ?? null,
            validated.observedAt.toString(10),
          ],
        );

      if (inserted.rowCount === 0 && inserted.rows.length === 0) {
        return result('existing', validated.accountId);
      }
      if (
        inserted.rowCount !== 1 ||
        inserted.rows.length !== 1 ||
        !isAccountId(inserted.rows[0]?.account_id) ||
        inserted.rows[0].account_id !== validated.accountId
      ) {
        throw failure('invalid_persisted_state');
      }

      return result('created', validated.accountId);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
