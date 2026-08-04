import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from '../auth/auth.types';
import { PlayerProfilePhotoUrlResolver } from '../config/player-profile-photo.config';
import { PlayerProfilePhotoPersistenceError } from '../database/player-profile-photo.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { PlayerProfilePhotoService } from './player-profile-photo.service';

const ACCOUNT_ID = deterministicUuid(
  'player-profile-photo-service-account',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-profile-photo-service-other-account',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const TRANSACTION = {} as PostgresTransaction;
const ACTIVE_STORAGE_PREFIX =
  `profile-photos/${ACCOUNT_ID}/3/` +
  deterministicUuid('player-profile-photo-active-asset');
const OLDER_STORAGE_PREFIX =
  `profile-photos/${ACCOUNT_ID}/2/` +
  deterministicUuid('player-profile-photo-older-asset');

function createHarness() {
  const readNextGeneration = jest.fn().mockResolvedValue({
    outcome: 'found',
    nextGeneration: 4,
  });
  const activate = jest.fn().mockResolvedValue({
    outcome: 'activated',
    storagePrefixesToRemove: [ACTIVE_STORAGE_PREFIX],
  });
  const clear = jest.fn().mockResolvedValue({
    outcome: 'cleared',
    changed: true,
    storagePrefixesToRemove: [ACTIVE_STORAGE_PREFIX],
  });
  const process = jest.fn().mockResolvedValue({
    avatar: Buffer.from('avatar'),
    full: Buffer.from('full'),
    fullDimension: 900,
    fullSha256: Buffer.alloc(32, 0x51),
  });
  const put = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn().mockResolvedValue(undefined);
  const service = new PlayerProfilePhotoService({
    transactions: {
      run: async <T>(
        operation: (transaction: PostgresTransaction) => Promise<T>,
      ): Promise<T> => operation(TRANSACTION),
    },
    photos: { readNextGeneration, activate, clear },
    processor: { process } as never,
    storage: { enabled: true, put, delete: remove },
    urls: new PlayerProfilePhotoUrlResolver(
      'https://photos.example.test',
    ),
    clock: { nowEpochSeconds: () => NOW },
  });
  return {
    service,
    readNextGeneration,
    activate,
    clear,
    process,
    put,
    remove,
  };
}

describe('PlayerProfilePhotoService', () => {
  it('binds every uploaded object and persistence write to the session account', async () => {
    const harness = createHarness();

    const result = await harness.service.uploadOwnPhoto({
      accountId: ACCOUNT_ID,
      role: 'player',
      mediaType: 'image/jpeg',
      body: Buffer.from('valid-image'),
    });

    expect(result).toMatchObject({ outcome: 'updated' });
    expect(harness.readNextGeneration).toHaveBeenCalledWith(
      TRANSACTION,
      ACCOUNT_ID,
    );
    expect(harness.activate).toHaveBeenCalledTimes(1);
    const activation = harness.activate.mock.calls[0][1];
    expect(activation).toMatchObject({
      accountId: ACCOUNT_ID,
      generation: 4,
      createdAt: NOW,
    });
    expect(activation.storagePrefix).toBe(
      `profile-photos/${ACCOUNT_ID}/4/${activation.assetId}`,
    );
    expect(activation.storagePrefix).not.toContain(OTHER_ACCOUNT_ID);
    expect(harness.put).toHaveBeenCalledTimes(2);
    for (const [key] of harness.put.mock.calls) {
      expect(key).toMatch(
        new RegExp(`^profile-photos/${ACCOUNT_ID}/4/`),
      );
      expect(key).not.toContain(OTHER_ACCOUNT_ID);
    }
    expect(harness.remove.mock.calls.map(([key]) => key).sort()).toEqual([
      `${ACTIVE_STORAGE_PREFIX}/avatar.webp`,
      `${ACTIVE_STORAGE_PREFIX}/full.webp`,
    ]);
  });

  it('retries every stale rendition after a transient cleanup failure', async () => {
    const harness = createHarness();
    harness.activate.mockResolvedValueOnce({
      outcome: 'activated',
      storagePrefixesToRemove: [
        OLDER_STORAGE_PREFIX,
        ACTIVE_STORAGE_PREFIX,
      ],
    });
    harness.remove.mockRejectedValueOnce(
      new Error('storage temporarily unavailable'),
    );

    await expect(harness.service.uploadOwnPhoto({
      accountId: ACCOUNT_ID,
      role: 'player',
      mediaType: 'image/jpeg',
      body: Buffer.from('valid-image'),
    })).resolves.toMatchObject({ outcome: 'updated' });
    expect(harness.remove).toHaveBeenCalledTimes(5);
    expect(new Set(harness.remove.mock.calls.map(([key]) => key))).toEqual(
      new Set([
      `${ACTIVE_STORAGE_PREFIX}/avatar.webp`,
      `${ACTIVE_STORAGE_PREFIX}/full.webp`,
      `${OLDER_STORAGE_PREFIX}/avatar.webp`,
      `${OLDER_STORAGE_PREFIX}/full.webp`,
      ]),
    );
  });

  it('reports a temporary failure when stale renditions remain after retries', async () => {
    const harness = createHarness();
    harness.remove.mockRejectedValue(
      new Error('storage persistently unavailable'),
    );

    await expect(harness.service.uploadOwnPhoto({
      accountId: ACCOUNT_ID,
      role: 'player',
      mediaType: 'image/jpeg',
      body: Buffer.from('valid-image'),
    })).resolves.toEqual({
      outcome: 'rejected',
      reason: 'temporary_unavailable',
    });
    expect(harness.remove).toHaveBeenCalledTimes(6);
  });

  it('removes both newly uploaded objects when activation loses a race', async () => {
    const harness = createHarness();
    harness.activate.mockResolvedValueOnce({ outcome: 'conflict' });

    await expect(
      harness.service.uploadOwnPhoto({
        accountId: ACCOUNT_ID,
        role: 'player',
        mediaType: 'image/png',
        body: Buffer.from('valid-image'),
      }),
    ).resolves.toEqual({ outcome: 'rejected', reason: 'conflict' });

    expect(harness.remove).toHaveBeenCalledTimes(2);
    expect(harness.remove.mock.calls.map(([key]) => key).sort()).toEqual(
      harness.put.mock.calls.map(([key]) => key).sort(),
    );
  });

  it('removes uploaded objects when the activation transaction aborts', async () => {
    const harness = createHarness();
    harness.activate.mockRejectedValueOnce(
      new PlayerProfilePhotoPersistenceError('transaction_conflict'),
    );

    await expect(
      harness.service.uploadOwnPhoto({
        accountId: ACCOUNT_ID,
        role: 'player',
        mediaType: 'image/png',
        body: Buffer.from('valid-image'),
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'temporary_unavailable',
    });
    expect(harness.remove).toHaveBeenCalledTimes(2);
  });

  it('does not access storage for an invalid image', async () => {
    const harness = createHarness();
    const { PlayerProfilePhotoInputError } = await import(
      './player-profile-photo.processor'
    );
    harness.process.mockRejectedValueOnce(
      new PlayerProfilePhotoInputError(),
    );

    await expect(
      harness.service.uploadOwnPhoto({
        accountId: ACCOUNT_ID,
        role: 'player',
        mediaType: 'image/webp',
        body: Buffer.from('invalid-image'),
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_image',
    });
    expect(harness.put).not.toHaveBeenCalled();
    expect(harness.activate).not.toHaveBeenCalled();
  });

  it('clears only the authenticated account photo state', async () => {
    const harness = createHarness();

    await expect(
      harness.service.deleteOwnPhoto({
        accountId: ACCOUNT_ID,
        role: 'player',
      }),
    ).resolves.toEqual({
      outcome: 'deleted',
      photoUrl: null,
      fullPhotoUrl: null,
    });
    expect(harness.clear).toHaveBeenCalledWith(
      TRANSACTION,
      ACCOUNT_ID,
      NOW,
    );
    expect(harness.clear).not.toHaveBeenCalledWith(
      TRANSACTION,
      OTHER_ACCOUNT_ID,
      NOW,
    );
    expect(harness.remove).toHaveBeenCalledTimes(2);
    expect(harness.remove.mock.calls.map(([key]) => key).sort()).toEqual([
      expect.stringMatching(
        new RegExp(`^profile-photos/${ACCOUNT_ID}/3/.+/avatar\\.webp$`),
      ),
      expect.stringMatching(
        new RegExp(`^profile-photos/${ACCOUNT_ID}/3/.+/full\\.webp$`),
      ),
    ]);
  });

  it('reports a temporary failure when a cleared photo cannot be fully removed', async () => {
    const harness = createHarness();
    harness.remove.mockRejectedValue(new Error('storage unavailable'));

    await expect(
      harness.service.deleteOwnPhoto({
        accountId: ACCOUNT_ID,
        role: 'player',
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'temporary_unavailable',
    });
    expect(harness.clear).toHaveBeenCalledTimes(1);
    expect(harness.remove).toHaveBeenCalledTimes(6);
  });

  it('fails closed while object storage is disabled', async () => {
    const harness = createHarness();
    Object.defineProperty(
      harness.service.dependencies.storage,
      'enabled',
      { value: false },
    );

    await expect(
      harness.service.uploadOwnPhoto({
        accountId: ACCOUNT_ID,
        role: 'player',
        mediaType: 'image/jpeg',
        body: Buffer.from('valid-image'),
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'feature_unavailable',
    });
    expect(harness.process).not.toHaveBeenCalled();
    expect(harness.put).not.toHaveBeenCalled();
  });
});
