import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import {
  PlayerProfileReadPersistenceError,
  PlayerProfileReader,
  ReadPlayerProfileResult,
} from '../database/player-profile-reader';
import {
  PlayerProfileWritePersistenceError,
  PlayerProfileWriter,
  UpdatePlayerProfileResult,
} from '../database/player-profile-writer';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  PlayerProfileService,
  PlayerProfileTransactionExecutor,
} from './player-profile.service';
import { ReadOwnPlayerProfileInput } from './player-profile.types';

const ACCOUNT_ID = deterministicUuid(
  'player-profile-service-account',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-profile-service-other',
) as AccountId;
const PRIVATE_MARKER = 'SYNTHETIC_PLAYER_PROFILE_SERVICE_PRIVATE';
const NOW = unixEpochSeconds(1_800_000_000);

const TRANSACTION = Object.freeze({
  query: jest.fn(),
}) as unknown as PostgresTransaction;

class FakeTransactions implements PlayerProfileTransactionExecutor {
  calls = 0;

  async run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    this.calls += 1;
    return operation(TRANSACTION);
  }
}

interface Harness {
  readonly transactions: FakeTransactions;
  readonly findByAccountId: jest.Mock<
    Promise<ReadPlayerProfileResult>,
    Parameters<PlayerProfileReader['findByAccountId']>
  >;
  readonly service: PlayerProfileService;
  readonly updateByAccountId: jest.Mock<
    Promise<UpdatePlayerProfileResult>,
    Parameters<PlayerProfileWriter['updateByAccountId']>
  >;
}

function createHarness(): Harness {
  const transactions = new FakeTransactions();
  const findByAccountId = jest.fn<
    Promise<ReadPlayerProfileResult>,
    Parameters<PlayerProfileReader['findByAccountId']>
  >().mockResolvedValue({
    outcome: 'found',
    profile: {
      accountId: ACCOUNT_ID,
      firstName: 'Synthetic',
      lastName: 'Player',
      username: 'synthetic_player',
      photoUrl: 'https://example.test/avatar.svg',
      languageCode: 'ru',
      phone: '+79990000000',
      sidePreference: 'Right',
      rating: 3,
      isVerified: false,
    },
  });
  const updateByAccountId = jest.fn<
    Promise<UpdatePlayerProfileResult>,
    Parameters<PlayerProfileWriter['updateByAccountId']>
  >().mockResolvedValue({ outcome: 'updated' });
  return {
    transactions,
    findByAccountId,
    updateByAccountId,
    service: new PlayerProfileService({
      transactions,
      profiles: { findByAccountId },
      profileWriter: { updateByAccountId },
      clock: { nowEpochSeconds: () => NOW },
    }),
  };
}

function input(
  overrides: Partial<ReadOwnPlayerProfileInput> = {},
): ReadOwnPlayerProfileInput {
  return {
    accountId: ACCOUNT_ID,
    role: 'player',
    ...overrides,
  };
}

describe('PlayerProfileService', () => {
  it('reads the authenticated player profile in one transaction', async () => {
    const harness = createHarness();

    const result = await harness.service.readOwnProfile(input());

    expect(result).toEqual({
      outcome: 'found',
      profile: {
        accountId: ACCOUNT_ID,
        role: 'player',
        firstName: 'Synthetic',
        lastName: 'Player',
        username: 'synthetic_player',
        photoUrl: 'https://example.test/avatar.svg',
        languageCode: 'ru',
        phone: '+79990000000',
        sidePreference: 'Right',
        rating: 3,
        isVerified: false,
      },
    });
    expect(harness.transactions.calls).toBe(1);
    expect(harness.findByAccountId).toHaveBeenCalledTimes(1);
    expect(harness.findByAccountId).toHaveBeenCalledWith(TRANSACTION, {
      accountId: ACCOUNT_ID,
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.outcome === 'found') {
      expect(Object.isFrozen(result.profile)).toBe(true);
    }
  });

  it('normalizes absent optional fields to explicit nulls', async () => {
    const harness = createHarness();
    harness.findByAccountId.mockResolvedValue({
      outcome: 'found',
      profile: {
        accountId: ACCOUNT_ID,
        firstName: 'Synthetic',
        rating: 3,
        isVerified: false,
      },
    });

    await expect(harness.service.readOwnProfile(input())).resolves.toEqual({
      outcome: 'found',
      profile: {
        accountId: ACCOUNT_ID,
        role: 'player',
        firstName: 'Synthetic',
        lastName: null,
        username: null,
        photoUrl: null,
        languageCode: null,
        phone: null,
        sidePreference: null,
        rating: 3,
        isVerified: false,
      },
    });
  });

  it('preserves an exact two-decimal rating affected by binary floating point', async () => {
    const harness = createHarness();
    harness.findByAccountId.mockResolvedValue({
      outcome: 'found',
      profile: {
        accountId: ACCOUNT_ID,
        firstName: 'Synthetic',
        rating: 0.29,
        isVerified: true,
      },
    });

    await expect(harness.service.readOwnProfile(input())).resolves.toEqual({
      outcome: 'found',
      profile: {
        accountId: ACCOUNT_ID,
        role: 'player',
        firstName: 'Synthetic',
        lastName: null,
        username: null,
        photoUrl: null,
        languageCode: null,
        phone: null,
        sidePreference: null,
        rating: 0.29,
        isVerified: true,
      },
    });
  });

  it('maps a missing row to a safe profile_not_found outcome', async () => {
    const harness = createHarness();
    harness.findByAccountId.mockResolvedValue({ outcome: 'not_found' });

    await expect(harness.service.readOwnProfile(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'profile_not_found',
    });
  });

  it('does not query player storage for a club admin principal', async () => {
    const harness = createHarness();

    await expect(
      harness.service.readOwnProfile(input({ role: 'club_admin' })),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'profile_not_found',
    });
    expect(harness.transactions.calls).toBe(0);
    expect(harness.findByAccountId).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { accountId: 'invalid', role: 'player' },
    { accountId: ACCOUNT_ID, role: 'unknown' },
    { accountId: ACCOUNT_ID, role: 'player', extra: true },
  ])('fails closed for invalid input %p', async (value) => {
    const harness = createHarness();
    await expect(
      harness.service.readOwnProfile(value as never),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(harness.transactions.calls).toBe(0);
  });

  it.each([
    ['wrong account', { accountId: OTHER_ACCOUNT_ID }],
    ['empty first name', { firstName: '' }],
    ['invalid optional', { username: '' }],
    ['invalid photo URL', { photoUrl: 'http://example.test/avatar' }],
    ['missing rating', { rating: undefined }],
    ['invalid rating', { rating: 10.01 }],
    ['invalid verification', { isVerified: 'false' }],
    ['extra field', { privateValue: PRIVATE_MARKER }],
  ])('rejects a malformed repository profile: %s', async (_label, patch) => {
    const harness = createHarness();
    harness.findByAccountId.mockResolvedValue({
      outcome: 'found',
      profile: {
        accountId: ACCOUNT_ID,
        firstName: 'Synthetic',
        rating: 3,
        isVerified: false,
        ...patch,
      },
    } as never);

    await expect(harness.service.readOwnProfile(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
  });

  it.each([
    ['database_unavailable', 'temporary_unavailable'],
    ['transaction_conflict', 'temporary_unavailable'],
    ['permission_denied', 'internal_failure'],
    ['invalid_persisted_state', 'internal_failure'],
    ['storage_failure', 'internal_failure'],
  ] as const)('maps %s to %s', async (failure, reason) => {
    const harness = createHarness();
    harness.findByAccountId.mockRejectedValue(
      new PlayerProfileReadPersistenceError(failure),
    );

    await expect(harness.service.readOwnProfile(input())).resolves.toEqual({
      outcome: 'rejected',
      reason,
    });
  });

  it('hides unexpected repository failures and private details', async () => {
    const harness = createHarness();
    harness.findByAccountId.mockRejectedValue(
      new Error(`${PRIVATE_MARKER}:credential:digest`),
    );

    const result = await harness.service.readOwnProfile(input());

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(PRIVATE_MARKER);
    expect(serialized).not.toContain('credential');
    expect(serialized).not.toContain('digest');
  });

  it('rejects malformed repository result envelopes', async () => {
    const harness = createHarness();
    harness.findByAccountId.mockResolvedValue({
      outcome: 'not_found',
      privateValue: PRIVATE_MARKER,
    } as never);

    await expect(harness.service.readOwnProfile(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
  });

  it('updates and re-reads the authenticated profile in one transaction', async () => {
    const harness = createHarness();

    await expect(
      harness.service.updateOwnProfile({
        ...input(),
        changes: {
          firstName: 'Updated',
          lastName: null,
          phone: '+79991112233',
          sidePreference: 'Left',
        },
      }),
    ).resolves.toEqual({
      outcome: 'updated',
      profile: {
        accountId: ACCOUNT_ID,
        role: 'player',
        firstName: 'Synthetic',
        lastName: 'Player',
        username: 'synthetic_player',
        photoUrl: 'https://example.test/avatar.svg',
        languageCode: 'ru',
        phone: '+79990000000',
        sidePreference: 'Right',
        rating: 3,
        isVerified: false,
      },
    });

    expect(harness.transactions.calls).toBe(1);
    expect(harness.updateByAccountId).toHaveBeenCalledWith(
      TRANSACTION,
      {
        accountId: ACCOUNT_ID,
        changes: {
          firstName: 'Updated',
          lastName: null,
          phone: '+79991112233',
          sidePreference: 'Left',
        },
        updatedAt: NOW,
      },
    );
    expect(harness.findByAccountId).toHaveBeenCalledWith(
      TRANSACTION,
      { accountId: ACCOUNT_ID },
    );
    expect(
      harness.updateByAccountId.mock.invocationCallOrder[0],
    ).toBeLessThan(
      harness.findByAccountId.mock.invocationCallOrder[0],
    );
  });

  it('maps an update of an absent profile to profile_not_found', async () => {
    const harness = createHarness();
    harness.updateByAccountId.mockResolvedValue({
      outcome: 'not_found',
    });

    await expect(
      harness.service.updateOwnProfile({
        ...input(),
        changes: { firstName: 'Updated' },
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'profile_not_found',
    });
    expect(harness.findByAccountId).not.toHaveBeenCalled();
  });

  it('rejects disallowed profile text before opening a transaction', async () => {
    const harness = createHarness();

    await expect(
      harness.service.updateOwnProfile({
        ...input(),
        changes: { firstName: 'fuck' },
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'content_not_allowed',
    });
    expect(harness.transactions.calls).toBe(0);
    expect(harness.updateByAccountId).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { ...input(), changes: {} },
    { ...input(), changes: { firstName: '' } },
    { ...input(), changes: { firstName: 'Unsafe\u0000name' } },
    { ...input(), changes: { phone: '79990000000' } },
    { ...input(), changes: { sidePreference: 'Center' } },
    { ...input(), changes: { username: PRIVATE_MARKER } },
    {
      accountId: ACCOUNT_ID,
      role: 'club_admin',
      changes: { firstName: 'Updated' },
    },
  ])('rejects an invalid update before transaction %#', async (value) => {
    const harness = createHarness();
    await expect(
      harness.service.updateOwnProfile(value as never),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(harness.transactions.calls).toBe(0);
    expect(harness.updateByAccountId).not.toHaveBeenCalled();
  });

  it.each([
    ['database_unavailable', 'temporary_unavailable'],
    ['transaction_conflict', 'temporary_unavailable'],
    ['permission_denied', 'internal_failure'],
    ['invalid_persisted_state', 'internal_failure'],
    ['storage_failure', 'internal_failure'],
  ] as const)('maps update %s to %s', async (failure, reason) => {
    const harness = createHarness();
    harness.updateByAccountId.mockRejectedValue(
      new PlayerProfileWritePersistenceError(failure),
    );

    await expect(
      harness.service.updateOwnProfile({
        ...input(),
        changes: { firstName: 'Updated' },
      }),
    ).resolves.toEqual({ outcome: 'rejected', reason });
  });
});
