import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isInternalUuid } from '../common/internal-uuid';
import { PlayerProfilePhotoUrlResolver } from '../config/player-profile-photo.config';
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
const RATING_PATTERN = /^(?:[0-9]\.[0-9]{2}|10\.00)$/u;
const SIDE_PREFERENCES = Object.freeze([
  'Left',
  'Both',
  'Right',
] as const);

const FIND_PLAYER_PROFILE_SQL = `
  SELECT
    details.account_id,
    details.first_name,
    details.last_name,
    details.username,
    details.photo_url,
    photo_states.account_id AS photo_state_account_id,
    photo_states.active_asset_id AS photo_state_active_asset_id,
    photo_states.version AS photo_state_version,
    photo_assets.account_id AS photo_asset_account_id,
    photo_assets.asset_id AS photo_asset_id,
    photo_assets.generation AS photo_asset_generation,
    photo_assets.storage_prefix AS photo_storage_prefix,
    details.language_code,
    details.phone,
    details.side_preference,
    rating_states.rating,
    rating_states.is_verified,
    COALESCE((
      SELECT capability_events.event_type = 'granted'
      FROM backend_auth.admin_capability_events AS capability_events
      WHERE capability_events.account_id = details.account_id
        AND capability_events.capability = 'club_admin'
      ORDER BY capability_events.event_order DESC
      LIMIT 1
    ), false) AS has_club_admin_capability
  FROM backend_auth.player_profile_details AS details
  LEFT JOIN backend_auth.player_rating_states AS rating_states
    ON rating_states.account_id = details.account_id
  LEFT JOIN backend_auth.player_profile_photo_states AS photo_states
    ON photo_states.account_id = details.account_id
  LEFT JOIN backend_auth.player_profile_photo_assets AS photo_assets
    ON photo_assets.account_id = photo_states.account_id
   AND photo_assets.generation = photo_states.version
   AND photo_assets.asset_id = photo_states.active_asset_id
  WHERE details.account_id = $1
`;

interface PlayerProfileRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly first_name: unknown;
  readonly last_name: unknown;
  readonly username: unknown;
  readonly photo_url: unknown;
  readonly photo_state_account_id: unknown;
  readonly photo_state_active_asset_id: unknown;
  readonly photo_state_version: unknown;
  readonly photo_asset_account_id: unknown;
  readonly photo_asset_id: unknown;
  readonly photo_asset_generation: unknown;
  readonly photo_storage_prefix: unknown;
  readonly language_code: unknown;
  readonly phone: unknown;
  readonly side_preference: unknown;
  readonly rating: unknown;
  readonly is_verified: unknown;
  readonly has_club_admin_capability: unknown;
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

function readPositiveSafeInteger(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]*$/u.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw failure('invalid_persisted_state');
  }
  return Number(value);
}

function readEffectivePhotoUrls(
  row: PlayerProfileRow,
  expectedAccountId: ReadPlayerProfileInput['accountId'],
  urls: PlayerProfilePhotoUrlResolver,
): Readonly<{ photoUrl?: string; fullPhotoUrl?: string }> {
  if (row.photo_state_account_id === null) {
    if (
      row.photo_state_active_asset_id !== null ||
      row.photo_state_version !== null ||
      row.photo_asset_account_id !== null ||
      row.photo_asset_id !== null ||
      row.photo_asset_generation !== null ||
      row.photo_storage_prefix !== null
    ) {
      throw failure('invalid_persisted_state');
    }
    const photoUrl = readPhotoUrl(row.photo_url);
    return Object.freeze(
      photoUrl === undefined ? {} : { photoUrl },
    );
  }
  if (
    !isAccountId(row.photo_state_account_id) ||
    row.photo_state_account_id !== expectedAccountId
  ) {
    throw failure('invalid_persisted_state');
  }
  const stateVersion = readPositiveSafeInteger(
    row.photo_state_version,
  );
  if (row.photo_state_active_asset_id === null) {
    if (
      row.photo_asset_account_id !== null ||
      row.photo_asset_id !== null ||
      row.photo_asset_generation !== null ||
      row.photo_storage_prefix !== null
    ) {
      throw failure('invalid_persisted_state');
    }
    return Object.freeze({});
  }
  if (
    !isInternalUuid(row.photo_state_active_asset_id) ||
    !isAccountId(row.photo_asset_account_id) ||
    row.photo_asset_account_id !== expectedAccountId ||
    !isInternalUuid(row.photo_asset_id) ||
    row.photo_asset_id !== row.photo_state_active_asset_id ||
    readPositiveSafeInteger(row.photo_asset_generation) !== stateVersion ||
    typeof row.photo_storage_prefix !== 'string' ||
    row.photo_storage_prefix !==
      `profile-photos/${expectedAccountId}/${stateVersion}/${row.photo_asset_id}`
  ) {
    throw failure('invalid_persisted_state');
  }
  const photoUrl = urls.avatar(row.photo_storage_prefix);
  const fullPhotoUrl = urls.full(row.photo_storage_prefix);
  if (photoUrl === undefined || fullPhotoUrl === undefined) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({
    photoUrl: readPhotoUrl(photoUrl),
    fullPhotoUrl: readPhotoUrl(fullPhotoUrl),
  });
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

function readRating(value: unknown): number {
  if (typeof value !== 'string' || !RATING_PATTERN.test(value)) {
    throw failure('invalid_persisted_state');
  }
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
    throw failure('invalid_persisted_state');
  }
  return rating;
}

function readVerification(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw failure('invalid_persisted_state');
  }
  return value;
}

function hydrateProfile(
  row: PlayerProfileRow,
  expectedAccountId: ReadPlayerProfileInput['accountId'],
  urls: PlayerProfilePhotoUrlResolver,
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
  const photoUrls = readEffectivePhotoUrls(row, expectedAccountId, urls);
  const phone = readPhone(row.phone);
  const sidePreference = readSidePreference(row.side_preference);
  const rating = readRating(row.rating);
  const isVerified = readVerification(row.is_verified);
  const hasClubAdminCapability = readVerification(
    row.has_club_admin_capability,
  );
  const capabilities: PlayerProfileRecord['capabilities'] =
    hasClubAdminCapability
      ? Object.freeze(['club_admin'] as const)
      : Object.freeze([]);

  return Object.freeze({
    accountId: row.account_id,
    firstName: row.first_name,
    ...(lastName === undefined ? {} : { lastName }),
    ...(username === undefined ? {} : { username }),
    ...photoUrls,
    ...(languageCode === undefined ? {} : { languageCode }),
    ...(phone === undefined ? {} : { phone }),
    ...(sidePreference === undefined ? {} : { sidePreference }),
    rating,
    isVerified,
    capabilities,
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
  constructor(
    private readonly photoUrls = new PlayerProfilePhotoUrlResolver(''),
  ) {}

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
          this.photoUrls,
        ),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
