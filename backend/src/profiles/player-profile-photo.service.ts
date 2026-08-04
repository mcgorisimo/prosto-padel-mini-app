import { AccountId, USER_ROLES, isAccountId } from '../accounts/account.types';
import { newInternalUuid } from '../common/internal-uuid';
import {
  PLAYER_PROFILE_PHOTO_MAX_UPLOAD_BYTES,
  PlayerProfilePhotoUrlResolver,
} from '../config/player-profile-photo.config';
import {
  PlayerProfilePhotoPersistenceError,
  PlayerProfilePhotoRepository,
} from '../database/player-profile-photo.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { SessionAuthenticationClock } from '../auth/session-authentication.guard';
import {
  PlayerProfilePhotoInputError,
  PlayerProfilePhotoProcessor,
} from './player-profile-photo.processor';
import {
  PlayerProfilePhotoObjectStorage,
  PlayerProfilePhotoStorageError,
} from './player-profile-photo.storage';
import {
  DeleteOwnPlayerProfilePhotoInput,
  UpdateOwnPlayerProfilePhotoResult,
  UploadOwnPlayerProfilePhotoInput,
  isAcceptedPlayerProfilePhotoMediaType,
} from './player-profile-photo.types';

export interface PlayerProfilePhotoTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PlayerProfilePhotoServiceDependencies {
  readonly transactions: PlayerProfilePhotoTransactionExecutor;
  readonly photos: PlayerProfilePhotoRepository;
  readonly processor: PlayerProfilePhotoProcessor;
  readonly storage: PlayerProfilePhotoObjectStorage;
  readonly urls: PlayerProfilePhotoUrlResolver;
  readonly clock: SessionAuthenticationClock;
}

type RejectionReason = Extract<
  UpdateOwnPlayerProfilePhotoResult,
  { readonly outcome: 'rejected' }
>['reason'];
const STORAGE_CLEANUP_ATTEMPTS = 3;

function rejected(
  reason: RejectionReason,
): Extract<
  UpdateOwnPlayerProfilePhotoResult,
  { readonly outcome: 'rejected' }
> {
  return Object.freeze({ outcome: 'rejected', reason });
}

function validPrincipal(
  input: DeleteOwnPlayerProfilePhotoInput,
): boolean {
  return (
    isAccountId(input.accountId) &&
    USER_ROLES.includes(input.role) &&
    input.role === 'player'
  );
}

function temporaryPersistenceFailure(error: unknown): boolean {
  return (
    error instanceof PlayerProfilePhotoPersistenceError &&
    (error.reason === 'database_unavailable' ||
      error.reason === 'transaction_conflict')
  );
}

function photoStoragePrefix(
  accountId: AccountId,
  generation: number,
  assetId: string,
): string {
  return `profile-photos/${accountId}/${generation}/${assetId}`;
}

export class PlayerProfilePhotoService {
  constructor(readonly dependencies: PlayerProfilePhotoServiceDependencies) {}

  async uploadOwnPhoto(
    input: UploadOwnPlayerProfilePhotoInput,
  ): Promise<UpdateOwnPlayerProfilePhotoResult> {
    if (
      !validPrincipal(input) ||
      !isAcceptedPlayerProfilePhotoMediaType(input.mediaType) ||
      !Buffer.isBuffer(input.body) ||
      input.body.length < 1 ||
      input.body.length > PLAYER_PROFILE_PHOTO_MAX_UPLOAD_BYTES
    ) {
      return rejected('invalid_request');
    }
    if (!this.dependencies.storage.enabled) {
      return rejected('feature_unavailable');
    }

    let processed;
    try {
      processed = await this.dependencies.processor.process(
        input.body,
        input.mediaType,
      );
    } catch (error) {
      return rejected(
        error instanceof PlayerProfilePhotoInputError
          ? 'invalid_image'
          : 'internal_failure',
      );
    }

    let generationResult;
    try {
      generationResult = await this.dependencies.transactions.run(
        (transaction) =>
          this.dependencies.photos.readNextGeneration(
            transaction,
            input.accountId,
          ),
      );
    } catch (error) {
      return rejected(
        temporaryPersistenceFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }
    if (generationResult.outcome === 'not_found') {
      return rejected('profile_not_found');
    }

    const assetId = newInternalUuid();
    const storagePrefix = photoStoragePrefix(
      input.accountId,
      generationResult.nextGeneration,
      assetId,
    );
    const avatarKey = `${storagePrefix}/avatar.webp`;
    const fullKey = `${storagePrefix}/full.webp`;
    const uploadedKeys: string[] = [];
    try {
      await this.dependencies.storage.put(fullKey, processed.full);
      uploadedKeys.push(fullKey);
      await this.dependencies.storage.put(avatarKey, processed.avatar);
      uploadedKeys.push(avatarKey);

      const activated = await this.dependencies.transactions.run(
        (transaction) =>
          this.dependencies.photos.activate(transaction, {
            assetId,
            accountId: input.accountId,
            generation: generationResult.nextGeneration,
            storagePrefix,
            fullDimension: processed.fullDimension,
            fullByteSize: processed.full.length,
            contentSha256: processed.fullSha256,
            createdAt: this.dependencies.clock.nowEpochSeconds(),
          }),
      );
      if (activated.outcome !== 'activated') {
        await this.cleanup(uploadedKeys);
        return rejected(
          activated.outcome === 'not_found'
            ? 'profile_not_found'
            : 'conflict',
        );
      }
      if (
        !(await this.removeStoredRenditions(
          activated.storagePrefixesToRemove,
        ))
      ) {
        return rejected('temporary_unavailable');
      }
    } catch (error) {
      await this.cleanup(uploadedKeys);
      if (error instanceof PlayerProfilePhotoStorageError) {
        return rejected('temporary_unavailable');
      }
      return rejected(
        temporaryPersistenceFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }

    const photoUrl = this.dependencies.urls.avatar(storagePrefix);
    const fullPhotoUrl = this.dependencies.urls.full(storagePrefix);
    if (photoUrl === undefined || fullPhotoUrl === undefined) {
      return rejected('internal_failure');
    }
    return Object.freeze({
      outcome: 'updated',
      photoUrl,
      fullPhotoUrl,
    });
  }

  async deleteOwnPhoto(
    input: DeleteOwnPlayerProfilePhotoInput,
  ): Promise<UpdateOwnPlayerProfilePhotoResult> {
    if (!validPrincipal(input)) {
      return rejected('invalid_request');
    }
    if (!this.dependencies.storage.enabled) {
      return rejected('feature_unavailable');
    }
    try {
      const result = await this.dependencies.transactions.run(
        (transaction) =>
          this.dependencies.photos.clear(
            transaction,
            input.accountId,
            this.dependencies.clock.nowEpochSeconds(),
          ),
      );
      if (result.outcome === 'not_found') {
        return rejected('profile_not_found');
      }
      if (!(await this.removeStoredRenditions(result.storagePrefixesToRemove))) {
        return rejected('temporary_unavailable');
      }
      return Object.freeze({
        outcome: 'deleted',
        photoUrl: null,
        fullPhotoUrl: null,
      });
    } catch (error) {
      return rejected(
        temporaryPersistenceFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }
  }

  private async cleanup(keys: readonly string[]): Promise<void> {
    await this.removeStoredObjects(keys);
  }

  private async removeStoredRenditions(
    storagePrefixes: readonly string[],
  ): Promise<boolean> {
    return this.removeStoredObjects(
      storagePrefixes.flatMap((storagePrefix) => [
        `${storagePrefix}/avatar.webp`,
        `${storagePrefix}/full.webp`,
      ]),
    );
  }

  private async removeStoredObjects(
    keys: readonly string[],
  ): Promise<boolean> {
    const results = await Promise.all(
      keys.map((key) => this.removeStoredObjectWithRetry(key)),
    );
    return results.every(Boolean);
  }

  private async removeStoredObjectWithRetry(key: string): Promise<boolean> {
    for (let attempt = 0; attempt < STORAGE_CLEANUP_ATTEMPTS; attempt += 1) {
      try {
        await this.dependencies.storage.delete(key);
        return true;
      } catch {
        // A later attempt or profile-photo operation retries the idempotent delete.
      }
    }
    return false;
  }
}
