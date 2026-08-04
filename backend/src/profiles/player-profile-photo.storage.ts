import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PlayerProfilePhotoStorageConfiguration } from '../config/player-profile-photo.config';

export const PLAYER_PROFILE_PHOTO_OBJECT_STORAGE = Symbol(
  'PLAYER_PROFILE_PHOTO_OBJECT_STORAGE',
);
export const PLAYER_PROFILE_PHOTO_STORAGE_REQUEST_TIMEOUT_MS = 15_000;

export class PlayerProfilePhotoStorageError extends Error {
  readonly name = 'PlayerProfilePhotoStorageError';

  constructor() {
    super('Player profile photo storage failed');
  }
}

export interface PlayerProfilePhotoObjectStorage {
  readonly enabled: boolean;
  put(key: string, body: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
}

export class DisabledPlayerProfilePhotoObjectStorage
  implements PlayerProfilePhotoObjectStorage
{
  readonly enabled = false;

  async put(): Promise<void> {
    throw new PlayerProfilePhotoStorageError();
  }

  async delete(): Promise<void> {
    // No object can exist when this adapter is disabled.
  }
}

export class S3PlayerProfilePhotoObjectStorage
  implements PlayerProfilePhotoObjectStorage
{
  readonly enabled = true;
  private readonly client: S3Client;

  constructor(
    private readonly configuration: PlayerProfilePhotoStorageConfiguration,
  ) {
    this.client = new S3Client({
      endpoint: configuration.endpoint,
      region: configuration.region,
      forcePathStyle: false,
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      },
    });
  }

  async put(key: string, body: Buffer): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.configuration.bucket,
          Key: key,
          Body: body,
          ContentType: 'image/webp',
          CacheControl: 'no-store',
        }),
        {
          abortSignal: AbortSignal.timeout(
            PLAYER_PROFILE_PHOTO_STORAGE_REQUEST_TIMEOUT_MS,
          ),
        },
      );
    } catch {
      throw new PlayerProfilePhotoStorageError();
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.configuration.bucket,
          Key: key,
        }),
        {
          abortSignal: AbortSignal.timeout(
            PLAYER_PROFILE_PHOTO_STORAGE_REQUEST_TIMEOUT_MS,
          ),
        },
      );
    } catch {
      throw new PlayerProfilePhotoStorageError();
    }
  }
}
