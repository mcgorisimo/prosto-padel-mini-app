import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isInternalUuid } from '../common/internal-uuid';
import { PlayerProfilePhotoUrlResolver } from '../config/player-profile-photo.config';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import {
  PublicPlayerProfileRecord,
  PublicPlayerProfileSearchPersistenceError,
  PublicPlayerProfileSearchPersistenceFailure,
  PublicPlayerProfileSearchRepository,
  PublicPlayerVisibilityPolicy,
  publicPlayerVisibilityParameters,
  ReadPublicPlayerProfilesInput,
  ReadPublicPlayerProfilesResult,
  SearchPublicPlayerProfilesInput,
  SearchPublicPlayerProfilesResult,
} from './public-player-profile-search.repository';

const MIN_QUERY_CODE_POINTS = 2;
const MAX_QUERY_CODE_POINTS = 64;
const MAX_RESULTS = 20;
const MAX_BATCH_RESULTS = 200;
const MAX_NAME_CODE_POINTS = 256;
const MAX_USERNAME_CODE_POINTS = 64;
const MAX_PHOTO_URL_CODE_POINTS = 2_048;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const RATING_PATTERN = /^(?:[0-9]\.[0-9]{2}|10\.00)$/u;

const SEARCH_PUBLIC_PLAYER_PROFILES_SQL = `
  SELECT
    details.account_id,
    details.first_name,
    details.last_name,
    details.username,
    photo_states.account_id AS photo_state_account_id,
    photo_states.active_asset_id AS photo_state_active_asset_id,
    photo_states.version AS photo_state_version,
    photo_assets.account_id AS photo_asset_account_id,
    photo_assets.asset_id AS photo_asset_id,
    photo_assets.generation AS photo_asset_generation,
    photo_assets.storage_prefix AS photo_storage_prefix,
    rating_states.rating,
    rating_states.is_verified
  FROM backend_auth.accounts AS accounts
  JOIN backend_auth.player_profiles AS profiles
    ON profiles.account_id = accounts.id
  JOIN backend_auth.player_profile_details AS details
    ON details.account_id = profiles.account_id
  JOIN backend_auth.player_rating_states AS rating_states
    ON rating_states.account_id = profiles.account_id
  LEFT JOIN backend_auth.player_profile_photo_states AS photo_states
    ON photo_states.account_id = profiles.account_id
  LEFT JOIN backend_auth.player_profile_photo_assets AS photo_assets
    ON photo_assets.account_id = photo_states.account_id
   AND photo_assets.generation = photo_states.version
   AND photo_assets.asset_id = photo_states.active_asset_id
  WHERE accounts.role = 'player'
    AND accounts.status = 'active'
    AND $3::boolean
    AND EXISTS (
      SELECT 1
      FROM backend_auth.player_onboarding_states AS onboarding
      WHERE onboarding.account_id = accounts.id
        AND onboarding.status = 'completed'
        AND onboarding.current_step = 'completed'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest($4::text[], $5::text[])
        AS required_consents(consent_kind, document_version)
      WHERE NOT EXISTS (
        SELECT 1
        FROM backend_auth.account_consent_acceptances AS acceptances
        WHERE acceptances.account_id = accounts.id
          AND acceptances.consent_kind = required_consents.consent_kind
          AND acceptances.document_version = required_consents.document_version
      )
    )
    AND (
      details.first_name ILIKE $1 ESCAPE E'\\\\'
      OR details.last_name ILIKE $1 ESCAPE E'\\\\'
      OR details.username ILIKE $1 ESCAPE E'\\\\'
      OR pg_catalog.concat_ws(
        ' ',
        details.first_name,
        details.last_name
      ) ILIKE $1 ESCAPE E'\\\\'
    )
  ORDER BY
    pg_catalog.lower(details.first_name),
    pg_catalog.lower(COALESCE(details.last_name, '')),
    details.account_id
  LIMIT $2::integer
`;

const READ_PUBLIC_PLAYER_PROFILES_SQL = `
  SELECT
    details.account_id,
    details.first_name,
    details.last_name,
    details.username,
    photo_states.account_id AS photo_state_account_id,
    photo_states.active_asset_id AS photo_state_active_asset_id,
    photo_states.version AS photo_state_version,
    photo_assets.account_id AS photo_asset_account_id,
    photo_assets.asset_id AS photo_asset_id,
    photo_assets.generation AS photo_asset_generation,
    photo_assets.storage_prefix AS photo_storage_prefix,
    rating_states.rating,
    rating_states.is_verified
  FROM backend_auth.accounts AS accounts
  JOIN backend_auth.player_profiles AS profiles
    ON profiles.account_id = accounts.id
  JOIN backend_auth.player_profile_details AS details
    ON details.account_id = profiles.account_id
  JOIN backend_auth.player_rating_states AS rating_states
    ON rating_states.account_id = profiles.account_id
  LEFT JOIN backend_auth.player_profile_photo_states AS photo_states
    ON photo_states.account_id = profiles.account_id
  LEFT JOIN backend_auth.player_profile_photo_assets AS photo_assets
    ON photo_assets.account_id = photo_states.account_id
   AND photo_assets.generation = photo_states.version
   AND photo_assets.asset_id = photo_states.active_asset_id
  WHERE accounts.role = 'player'
    AND accounts.status = 'active'
    AND accounts.id = ANY ($1::uuid[])
    AND $2::boolean
    AND EXISTS (
      SELECT 1
      FROM backend_auth.player_onboarding_states AS onboarding
      WHERE onboarding.account_id = accounts.id
        AND onboarding.status = 'completed'
        AND onboarding.current_step = 'completed'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest($3::text[], $4::text[])
        AS required_consents(consent_kind, document_version)
      WHERE NOT EXISTS (
        SELECT 1
        FROM backend_auth.account_consent_acceptances AS acceptances
        WHERE acceptances.account_id = accounts.id
          AND acceptances.consent_kind = required_consents.consent_kind
          AND acceptances.document_version = required_consents.document_version
      )
    )
  ORDER BY details.account_id
`;

interface PublicPlayerProfileRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly first_name: unknown;
  readonly last_name: unknown;
  readonly username: unknown;
  readonly photo_state_account_id: unknown;
  readonly photo_state_active_asset_id: unknown;
  readonly photo_state_version: unknown;
  readonly photo_asset_account_id: unknown;
  readonly photo_asset_id: unknown;
  readonly photo_asset_generation: unknown;
  readonly photo_storage_prefix: unknown;
  readonly rating: unknown;
  readonly is_verified: unknown;
}

function failure(
  reason: PublicPlayerProfileSearchPersistenceFailure,
): PublicPlayerProfileSearchPersistenceError {
  return new PublicPlayerProfileSearchPersistenceError(reason);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isCanonicalQuery(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.normalize('NFKC') === value &&
    [...value].length >= MIN_QUERY_CODE_POINTS &&
    [...value].length <= MAX_QUERY_CODE_POINTS &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function validateInput(
  value: unknown,
): SearchPublicPlayerProfilesInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, 'query') ||
    !Object.prototype.hasOwnProperty.call(value, 'limit') ||
    !isCanonicalQuery(value.query) ||
    !Number.isInteger(value.limit) ||
    (value.limit as number) < 1 ||
    (value.limit as number) > MAX_RESULTS
  ) {
    throw failure('invalid_input');
  }
  return Object.freeze({
    query: value.query,
    limit: value.limit as number,
  });
}

function validateBatchInput(
  value: unknown,
): ReadPublicPlayerProfilesInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(value, 'playerIds') ||
    !Array.isArray(value.playerIds) ||
    value.playerIds.length < 1 ||
    value.playerIds.length > MAX_BATCH_RESULTS ||
    value.playerIds.some((playerId) => !isAccountId(playerId)) ||
    new Set(value.playerIds).size !== value.playerIds.length
  ) {
    throw failure('invalid_input');
  }
  return Object.freeze({
    playerIds: Object.freeze([...value.playerIds]),
  }) as ReadPublicPlayerProfilesInput;
}

function escapeLikePattern(value: string): string {
  return `%${value.replace(/[\\%_]/gu, '\\$&')}%`;
}

function isBoundedString(
  value: unknown,
  maximumCodePoints: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= maximumCodePoints
  );
}

function readOptionalString(
  value: unknown,
  maximumCodePoints: number,
): string | undefined {
  if (value === null) {
    return undefined;
  }
  if (!isBoundedString(value, maximumCodePoints)) {
    throw failure('invalid_persisted_state');
  }
  return value;
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

function readManagedPhotoUrl(
  row: PublicPlayerProfileRow,
  expectedAccountId: PublicPlayerProfileRecord['playerId'],
  urls: PlayerProfilePhotoUrlResolver,
): string | undefined {
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
    return undefined;
  }
  if (
    !isAccountId(row.photo_state_account_id) ||
    row.photo_state_account_id !== expectedAccountId
  ) {
    throw failure('invalid_persisted_state');
  }
  const stateVersion = readPositiveSafeInteger(row.photo_state_version);
  if (row.photo_state_active_asset_id === null) {
    if (
      row.photo_asset_account_id !== null ||
      row.photo_asset_id !== null ||
      row.photo_asset_generation !== null ||
      row.photo_storage_prefix !== null
    ) {
      throw failure('invalid_persisted_state');
    }
    return undefined;
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
  if (
    !isBoundedString(photoUrl, MAX_PHOTO_URL_CODE_POINTS)
  ) {
    throw failure('invalid_persisted_state');
  }
  try {
    if (new URL(photoUrl).protocol !== 'https:') {
      throw failure('invalid_persisted_state');
    }
  } catch (error) {
    if (error instanceof PublicPlayerProfileSearchPersistenceError) {
      throw error;
    }
    throw failure('invalid_persisted_state');
  }
  return photoUrl;
}

function hydrateProfile(
  row: PublicPlayerProfileRow,
  urls: PlayerProfilePhotoUrlResolver,
): PublicPlayerProfileRecord {
  if (
    !isAccountId(row.account_id) ||
    !isBoundedString(row.first_name, MAX_NAME_CODE_POINTS) ||
    typeof row.is_verified !== 'boolean'
  ) {
    throw failure('invalid_persisted_state');
  }
  const lastName = readOptionalString(
    row.last_name,
    MAX_NAME_CODE_POINTS,
  );
  const username = readOptionalString(
    row.username,
    MAX_USERNAME_CODE_POINTS,
  );
  const photoUrl = readManagedPhotoUrl(row, row.account_id, urls);

  return Object.freeze({
    playerId: row.account_id,
    firstName: row.first_name,
    ...(lastName === undefined ? {} : { lastName }),
    ...(username === undefined ? {} : { username }),
    ...(photoUrl === undefined ? {} : { photoUrl }),
    rating: readRating(row.rating),
    isVerified: row.is_verified,
  });
}

function mapPersistenceError(
  error: unknown,
): PublicPlayerProfileSearchPersistenceError {
  if (error instanceof PublicPlayerProfileSearchPersistenceError) {
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

export class PostgresPublicPlayerProfileSearchRepository
  implements PublicPlayerProfileSearchRepository
{
  constructor(
    private readonly photoUrls = new PlayerProfilePhotoUrlResolver(''),
    private readonly visibility: PublicPlayerVisibilityPolicy = Object.freeze({
      enabled: false,
      requiredConsents: Object.freeze([]),
    }),
  ) {}

  async search(
    transaction: PostgresTransaction,
    input: SearchPublicPlayerProfilesInput,
  ): Promise<SearchPublicPlayerProfilesResult> {
    try {
      const validated = validateInput(input);
      const visibility = publicPlayerVisibilityParameters(
        this.visibility,
      );
      const selected = await transaction.query<PublicPlayerProfileRow>(
        SEARCH_PUBLIC_PLAYER_PROFILES_SQL,
        [
          escapeLikePattern(validated.query),
          validated.limit,
          ...visibility,
        ],
      );

      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length > validated.limit
      ) {
        throw failure('invalid_persisted_state');
      }

      const players = selected.rows.map((row) =>
        hydrateProfile(row, this.photoUrls),
      );
      if (
        new Set(players.map((player) => player.playerId)).size !==
        players.length
      ) {
        throw failure('invalid_persisted_state');
      }

      return Object.freeze({
        outcome: 'found',
        players: Object.freeze(players),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async findByPlayerIds(
    transaction: PostgresTransaction,
    input: ReadPublicPlayerProfilesInput,
  ): Promise<ReadPublicPlayerProfilesResult> {
    try {
      const validated = validateBatchInput(input);
      const visibility = publicPlayerVisibilityParameters(
        this.visibility,
      );
      const selected = await transaction.query<PublicPlayerProfileRow>(
        READ_PUBLIC_PLAYER_PROFILES_SQL,
        [validated.playerIds, ...visibility],
      );

      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length > validated.playerIds.length
      ) {
        throw failure('invalid_persisted_state');
      }

      const requested = new Set(validated.playerIds);
      const players = selected.rows.map((row) =>
        hydrateProfile(row, this.photoUrls),
      );
      if (
        players.some((player) => !requested.has(player.playerId)) ||
        new Set(players.map((player) => player.playerId)).size !==
          players.length
      ) {
        throw failure('invalid_persisted_state');
      }

      return Object.freeze({
        outcome: 'found',
        players: Object.freeze(players),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
