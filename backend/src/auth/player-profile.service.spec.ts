import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  PlayerProfileReadPersistenceError,
  PlayerProfileReader,
  ReadPlayerProfileResult,
} from '../database/player-profile-reader';
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
    },
  });
  return {
    transactions,
    findByAccountId,
    service: new PlayerProfileService({
      transactions,
      profiles: { findByAccountId },
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
    ['extra field', { privateValue: PRIVATE_MARKER }],
  ])('rejects a malformed repository profile: %s', async (_label, patch) => {
    const harness = createHarness();
    harness.findByAccountId.mockResolvedValue({
      outcome: 'found',
      profile: {
        accountId: ACCOUNT_ID,
        firstName: 'Synthetic',
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
});
