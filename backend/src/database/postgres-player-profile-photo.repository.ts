import { QueryResultRow } from 'pg';
import { AccountId, isAccountId } from '../accounts/account.types';
import { isInternalUuid } from '../common/internal-uuid';
import { classifyPostgresError } from './postgres-error-classifier';
import {
  ActivatePlayerProfilePhotoResult,
  ClearPlayerProfilePhotoResult,
  PlayerProfilePhotoAssetInput,
  PlayerProfilePhotoPersistenceError,
  PlayerProfilePhotoPersistenceFailure,
  PlayerProfilePhotoRepository,
  ReadPlayerProfilePhotoGenerationResult,
} from './player-profile-photo.repository';
import { PostgresTransaction } from './postgres-transaction';

const MAX_SAFE_PERSISTED_INTEGER = 9_007_199_254_740_991;
const STORAGE_PREFIX_PATTERN =
  /^profile-photos\/([0-9a-f-]{36})\/([1-9][0-9]*)\/([0-9a-f-]{36})$/u;

const READ_NEXT_GENERATION_SQL = `
  SELECT profiles.account_id, states.version
  FROM backend_auth.player_profiles AS profiles
  LEFT JOIN backend_auth.player_profile_photo_states AS states
    ON states.account_id = profiles.account_id
  WHERE profiles.account_id = $1
`;

const LOCK_PROFILE_AND_STATE_SQL = `
  SELECT
    profiles.account_id,
    states.version,
    states.active_asset_id,
    active_assets.storage_prefix AS active_storage_prefix,
    previous_assets.asset_id AS previous_asset_id,
    previous_assets.storage_prefix AS previous_storage_prefix
  FROM backend_auth.player_profiles AS profiles
  LEFT JOIN backend_auth.player_profile_photo_states AS states
    ON states.account_id = profiles.account_id
  LEFT JOIN backend_auth.player_profile_photo_assets AS active_assets
    ON active_assets.account_id = states.account_id
   AND active_assets.generation = states.version
   AND active_assets.asset_id = states.active_asset_id
  LEFT JOIN backend_auth.player_profile_photo_assets AS previous_assets
    ON states.active_asset_id IS NULL
   AND states.version > 1
   AND previous_assets.account_id = states.account_id
   AND previous_assets.generation = states.version - 1
  WHERE profiles.account_id = $1
  FOR UPDATE OF profiles
`;

const INSERT_ASSET_SQL = `
  INSERT INTO backend_auth.player_profile_photo_assets (
    asset_id,
    account_id,
    generation,
    storage_prefix,
    media_type,
    full_dimension,
    full_byte_size,
    content_sha256,
    created_at
  ) VALUES ($1, $2, $3, $4, 'image/webp', $5, $6, $7, $8)
`;

const INSERT_STATE_SQL = `
  INSERT INTO backend_auth.player_profile_photo_states (
    account_id,
    active_asset_id,
    version,
    created_at,
    updated_at
  ) VALUES ($1, $2, $3, $4, $4)
`;

const UPDATE_STATE_SQL = `
  UPDATE backend_auth.player_profile_photo_states
  SET active_asset_id = $2,
      version = $3,
      updated_at = $4
  WHERE account_id = $1
    AND version = $5
`;

const READ_STORAGE_PREFIXES_TO_REMOVE_SQL = `
  SELECT account_id, asset_id, generation, storage_prefix
  FROM backend_auth.player_profile_photo_assets
  WHERE account_id = $1
    AND ($2::uuid IS NULL OR asset_id <> $2::uuid)
  ORDER BY generation, asset_id
`;

interface PhotoStateRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly version: unknown;
  readonly active_asset_id: unknown;
  readonly active_storage_prefix: unknown;
  readonly previous_asset_id: unknown;
  readonly previous_storage_prefix: unknown;
}

interface PhotoAssetPrefixRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly asset_id: unknown;
  readonly generation: unknown;
  readonly storage_prefix: unknown;
}

function failure(
  reason: PlayerProfilePhotoPersistenceFailure,
): PlayerProfilePhotoPersistenceError {
  return new PlayerProfilePhotoPersistenceError(reason);
}

function readOptionalVersion(value: unknown): number | undefined {
  if (value === null) {
    return undefined;
  }
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]*$/u.test(value) ||
    !Number.isSafeInteger(Number(value))
  ) {
    throw failure('invalid_persisted_state');
  }
  return Number(value);
}

function validateSingleRow(
  rows: readonly PhotoStateRow[],
  rowCount: number,
  expectedAccountId: string,
): PhotoStateRow | undefined {
  if (rowCount === 0 && rows.length === 0) {
    return undefined;
  }
  if (
    rowCount !== 1 ||
    rows.length !== 1 ||
    !isAccountId(rows[0].account_id) ||
    rows[0].account_id !== expectedAccountId
  ) {
    throw failure('invalid_persisted_state');
  }
  return rows[0];
}

function validateAssetInput(value: PlayerProfilePhotoAssetInput): void {
  const prefix = STORAGE_PREFIX_PATTERN.exec(value.storagePrefix);
  if (
    !isInternalUuid(value.assetId) ||
    !isAccountId(value.accountId) ||
    !Number.isSafeInteger(value.generation) ||
    value.generation < 1 ||
    value.generation > MAX_SAFE_PERSISTED_INTEGER ||
    prefix === null ||
    prefix[1] !== value.accountId ||
    Number(prefix[2]) !== value.generation ||
    prefix[3] !== value.assetId ||
    !Number.isSafeInteger(value.fullDimension) ||
    value.fullDimension < 256 ||
    value.fullDimension > 4_096 ||
    !Number.isSafeInteger(value.fullByteSize) ||
    value.fullByteSize < 1 ||
    value.fullByteSize > 10_485_760 ||
    !Buffer.isBuffer(value.contentSha256) ||
    value.contentSha256.length !== 32 ||
    !Number.isSafeInteger(value.createdAt) ||
    value.createdAt < 0 ||
    value.createdAt > MAX_SAFE_PERSISTED_INTEGER
  ) {
    throw failure('invalid_input');
  }
}

function readStoragePrefix(
  value: unknown,
  expectedAccountId: AccountId,
  expectedGeneration: number,
  expectedAssetId: unknown,
): string {
  if (!isInternalUuid(expectedAssetId) || typeof value !== 'string') {
    throw failure('invalid_persisted_state');
  }
  const prefix = STORAGE_PREFIX_PATTERN.exec(value);
  if (
    prefix === null ||
    prefix[1] !== expectedAccountId ||
    Number(prefix[2]) !== expectedGeneration ||
    prefix[3] !== expectedAssetId
  ) {
    throw failure('invalid_persisted_state');
  }
  return value;
}

function readRemovalStoragePrefix(
  row: PhotoStateRow,
  expectedAccountId: AccountId,
  currentVersion: number | undefined,
): string | null {
  if (currentVersion === undefined) {
    if (
      row.active_asset_id !== null ||
      row.active_storage_prefix !== null ||
      row.previous_asset_id !== null ||
      row.previous_storage_prefix !== null
    ) {
      throw failure('invalid_persisted_state');
    }
    return null;
  }
  if (row.active_asset_id !== null) {
    if (
      row.previous_asset_id !== null ||
      row.previous_storage_prefix !== null
    ) {
      throw failure('invalid_persisted_state');
    }
    return readStoragePrefix(
      row.active_storage_prefix,
      expectedAccountId,
      currentVersion,
      row.active_asset_id,
    );
  }
  if (row.active_storage_prefix !== null) {
    throw failure('invalid_persisted_state');
  }
  if (
    row.previous_asset_id === null &&
    row.previous_storage_prefix === null
  ) {
    return null;
  }
  if (currentVersion <= 1) {
    throw failure('invalid_persisted_state');
  }
  return readStoragePrefix(
    row.previous_storage_prefix,
    expectedAccountId,
    currentVersion - 1,
    row.previous_asset_id,
  );
}

function readStoragePrefixesToRemove(
  rows: readonly PhotoAssetPrefixRow[],
  rowCount: number,
  expectedAccountId: AccountId,
): readonly string[] {
  if (rowCount !== rows.length) {
    throw failure('invalid_persisted_state');
  }
  const prefixes = rows.map((row) => {
    if (
      !isAccountId(row.account_id) ||
      row.account_id !== expectedAccountId ||
      !isInternalUuid(row.asset_id)
    ) {
      throw failure('invalid_persisted_state');
    }
    const generation = readOptionalVersion(row.generation);
    if (generation === undefined) {
      throw failure('invalid_persisted_state');
    }
    return readStoragePrefix(
      row.storage_prefix,
      expectedAccountId,
      generation,
      row.asset_id,
    );
  });
  if (new Set(prefixes).size !== prefixes.length) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze(prefixes);
}

function mapPersistenceError(
  error: unknown,
): PlayerProfilePhotoPersistenceError {
  if (error instanceof PlayerProfilePhotoPersistenceError) {
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

export class PostgresPlayerProfilePhotoRepository
  implements PlayerProfilePhotoRepository
{
  async readNextGeneration(
    transaction: PostgresTransaction,
    accountId: AccountId,
  ): Promise<ReadPlayerProfilePhotoGenerationResult> {
    if (!isAccountId(accountId)) {
      throw failure('invalid_input');
    }
    try {
      const selected = await transaction.query<PhotoStateRow>(
        READ_NEXT_GENERATION_SQL,
        [accountId],
      );
      const row = validateSingleRow(
        selected.rows,
        selected.rowCount ?? selected.rows.length,
        accountId,
      );
      if (row === undefined) {
        return Object.freeze({ outcome: 'not_found' });
      }
      const currentVersion = readOptionalVersion(row.version);
      if (currentVersion === MAX_SAFE_PERSISTED_INTEGER) {
        throw failure('invalid_persisted_state');
      }
      return Object.freeze({
        outcome: 'found',
        nextGeneration: (currentVersion ?? 0) + 1,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async activate(
    transaction: PostgresTransaction,
    input: PlayerProfilePhotoAssetInput,
  ): Promise<ActivatePlayerProfilePhotoResult> {
    validateAssetInput(input);
    try {
      const selected = await transaction.query<PhotoStateRow>(
        LOCK_PROFILE_AND_STATE_SQL,
        [input.accountId],
      );
      const row = validateSingleRow(
        selected.rows,
        selected.rowCount ?? selected.rows.length,
        input.accountId,
      );
      if (row === undefined) {
        return Object.freeze({ outcome: 'not_found' });
      }
      const currentVersion = readOptionalVersion(row.version);
      readRemovalStoragePrefix(row, input.accountId, currentVersion);
      if ((currentVersion ?? 0) + 1 !== input.generation) {
        return Object.freeze({ outcome: 'conflict' });
      }

      const insertedAsset = await transaction.query(INSERT_ASSET_SQL, [
        input.assetId,
        input.accountId,
        input.generation,
        input.storagePrefix,
        input.fullDimension,
        input.fullByteSize,
        input.contentSha256,
        input.createdAt,
      ]);
      if ((insertedAsset.rowCount ?? 0) !== 1) {
        throw failure('storage_failure');
      }
      if (currentVersion === undefined) {
        const insertedState = await transaction.query(INSERT_STATE_SQL, [
          input.accountId,
          input.assetId,
          input.generation,
          input.createdAt,
        ]);
        if ((insertedState.rowCount ?? 0) !== 1) {
          throw failure('storage_failure');
        }
      } else {
        const updated = await transaction.query(UPDATE_STATE_SQL, [
          input.accountId,
          input.assetId,
          input.generation,
          input.createdAt,
          currentVersion,
        ]);
        if ((updated.rowCount ?? 0) !== 1) {
          throw failure('transaction_conflict');
        }
      }
      const removable = await transaction.query<PhotoAssetPrefixRow>(
        READ_STORAGE_PREFIXES_TO_REMOVE_SQL,
        [input.accountId, input.assetId],
      );
      return Object.freeze({
        outcome: 'activated',
        storagePrefixesToRemove: readStoragePrefixesToRemove(
          removable.rows,
          removable.rowCount ?? removable.rows.length,
          input.accountId,
        ),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async clear(
    transaction: PostgresTransaction,
    accountId: AccountId,
    updatedAt: number,
  ): Promise<ClearPlayerProfilePhotoResult> {
    if (
      !isAccountId(accountId) ||
      !Number.isSafeInteger(updatedAt) ||
      updatedAt < 0 ||
      updatedAt > MAX_SAFE_PERSISTED_INTEGER
    ) {
      throw failure('invalid_input');
    }
    try {
      const selected = await transaction.query<PhotoStateRow>(
        LOCK_PROFILE_AND_STATE_SQL,
        [accountId],
      );
      const row = validateSingleRow(
        selected.rows,
        selected.rowCount ?? selected.rows.length,
        accountId,
      );
      if (row === undefined) {
        return Object.freeze({ outcome: 'not_found' });
      }
      const currentVersion = readOptionalVersion(row.version);
      readRemovalStoragePrefix(
        row,
        accountId,
        currentVersion,
      );
      if (currentVersion === undefined) {
        const inserted = await transaction.query(INSERT_STATE_SQL, [
          accountId,
          null,
          1,
          updatedAt,
        ]);
        if ((inserted.rowCount ?? 0) !== 1) {
          throw failure('storage_failure');
        }
      } else if (row.active_asset_id !== null) {
        if (currentVersion === MAX_SAFE_PERSISTED_INTEGER) {
          throw failure('invalid_persisted_state');
        }
        if (!isInternalUuid(row.active_asset_id)) {
          throw failure('invalid_persisted_state');
        }
        const updated = await transaction.query(UPDATE_STATE_SQL, [
          accountId,
          null,
          currentVersion + 1,
          updatedAt,
          currentVersion,
        ]);
        if ((updated.rowCount ?? 0) !== 1) {
          throw failure('transaction_conflict');
        }
      }

      const removable = await transaction.query<PhotoAssetPrefixRow>(
        READ_STORAGE_PREFIXES_TO_REMOVE_SQL,
        [accountId, null],
      );
      return Object.freeze({
        outcome: 'cleared',
        changed: currentVersion === undefined || row.active_asset_id !== null,
        storagePrefixesToRemove: readStoragePrefixesToRemove(
          removable.rows,
          removable.rowCount ?? removable.rows.length,
          accountId,
        ),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
