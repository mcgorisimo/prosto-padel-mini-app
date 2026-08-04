import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PlayerProfilePhotoStorageConfiguration } from '../config/player-profile-photo.config';
import {
  PLAYER_PROFILE_PHOTO_STORAGE_REQUEST_TIMEOUT_MS,
  S3PlayerProfilePhotoObjectStorage,
} from './player-profile-photo.storage';

const CONFIGURATION: PlayerProfilePhotoStorageConfiguration = Object.freeze({
  enabled: true,
  endpoint: 'https://s3.storage.example.test',
  region: 'ru-1',
  bucket: 'profile-photos-test',
  publicBaseUrl: 'https://photos.example.test',
  accessKeyId: 'synthetic-access-key',
  secretAccessKey: 'synthetic-secret-key',
});

describe('S3PlayerProfilePhotoObjectStorage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uploads non-cacheable WebP objects only to the configured bucket and key', async () => {
    const send = jest
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue({} as never);
    const storage = new S3PlayerProfilePhotoObjectStorage(CONFIGURATION);
    const body = Buffer.from('synthetic-webp');

    await expect(
      storage.put('profile-photos/account/1/asset/avatar.webp', body),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toEqual({
      Bucket: 'profile-photos-test',
      Key: 'profile-photos/account/1/asset/avatar.webp',
      Body: body,
      ContentType: 'image/webp',
      CacheControl: 'no-store',
    });
    const options = send.mock.calls[0][1];
    expect(options?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options?.abortSignal?.aborted).toBe(false);
  });

  it('deletes only the configured bucket and exact object key', async () => {
    const send = jest
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue({} as never);
    const storage = new S3PlayerProfilePhotoObjectStorage(CONFIGURATION);

    await expect(
      storage.delete('profile-photos/account/1/asset/full.webp'),
    ).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(DeleteObjectCommand);
    expect((command as DeleteObjectCommand).input).toEqual({
      Bucket: 'profile-photos-test',
      Key: 'profile-photos/account/1/asset/full.webp',
    });
    expect(send.mock.calls[0][1]?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it.each(['put', 'delete'] as const)(
    'maps %s failures to a fixed storage error',
    async (operation) => {
      jest
        .spyOn(S3Client.prototype, 'send')
        .mockRejectedValue(
          new Error('SYNTHETIC_S3_PRIVATE_ERROR') as never,
        );
      const storage = new S3PlayerProfilePhotoObjectStorage(CONFIGURATION);

      const request =
        operation === 'put'
          ? storage.put(
              'profile-photos/account/1/asset/avatar.webp',
              Buffer.from('x'),
            )
          : storage.delete(
              'profile-photos/account/1/asset/avatar.webp',
            );

      await expect(request).rejects.toMatchObject({
        name: 'PlayerProfilePhotoStorageError',
        message: 'Player profile photo storage failed',
      });
    },
  );

  it('uses a bounded request timeout', () => {
    expect(PLAYER_PROFILE_PHOTO_STORAGE_REQUEST_TIMEOUT_MS).toBe(15_000);
  });
});
