import { AccountId } from '../accounts/account.types';
import { InternalUuid } from '../common/internal-uuid';
import { PostgresTransaction } from './postgres-transaction';

export type PlayerProfilePhotoGeneration = number;

export interface PlayerProfilePhotoAssetInput {
  readonly assetId: InternalUuid;
  readonly accountId: AccountId;
  readonly generation: PlayerProfilePhotoGeneration;
  readonly storagePrefix: string;
  readonly fullDimension: number;
  readonly fullByteSize: number;
  readonly contentSha256: Buffer;
  readonly createdAt: number;
}

export type ReadPlayerProfilePhotoGenerationResult =
  | Readonly<{
      outcome: 'found';
      nextGeneration: PlayerProfilePhotoGeneration;
    }>
  | Readonly<{ outcome: 'not_found' }>;

export type ActivatePlayerProfilePhotoResult =
  | Readonly<{
      outcome: 'activated';
      storagePrefixesToRemove: readonly string[];
    }>
  | Readonly<{ outcome: 'not_found' | 'conflict' }>;

export type ClearPlayerProfilePhotoResult =
  | Readonly<{
      outcome: 'cleared';
      changed: boolean;
      storagePrefixesToRemove: readonly string[];
    }>
  | Readonly<{ outcome: 'not_found' }>;

export type PlayerProfilePhotoPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PlayerProfilePhotoPersistenceError extends Error {
  readonly name = 'PlayerProfilePhotoPersistenceError';

  constructor(readonly reason: PlayerProfilePhotoPersistenceFailure) {
    super('Player profile photo persistence failed');
  }
}

export interface PlayerProfilePhotoRepository {
  readNextGeneration(
    transaction: PostgresTransaction,
    accountId: AccountId,
  ): Promise<ReadPlayerProfilePhotoGenerationResult>;
  activate(
    transaction: PostgresTransaction,
    input: PlayerProfilePhotoAssetInput,
  ): Promise<ActivatePlayerProfilePhotoResult>;
  clear(
    transaction: PostgresTransaction,
    accountId: AccountId,
    updatedAt: number,
  ): Promise<ClearPlayerProfilePhotoResult>;
}
