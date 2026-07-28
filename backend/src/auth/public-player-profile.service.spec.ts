import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  PublicPlayerProfileSearchPersistenceError,
  PublicPlayerProfileSearchRepository,
  SearchPublicPlayerProfilesResult as RepositorySearchResult,
} from '../database/public-player-profile-search.repository';
import {
  PublicPlayerProfileService,
  PublicPlayerProfileTransactionExecutor,
} from './public-player-profile.service';
import { SearchPublicPlayerProfilesInput } from './public-player-profile.types';

const PLAYER_ID = deterministicUuid(
  'public-player-profile-service-player',
) as AccountId;
const OTHER_PLAYER_ID = deterministicUuid(
  'public-player-profile-service-other',
) as AccountId;
const PRIVATE_MARKER =
  'SYNTHETIC_PUBLIC_PLAYER_PROFILE_SERVICE_PRIVATE';

const TRANSACTION = Object.freeze({
  query: jest.fn(),
}) as unknown as PostgresTransaction;

class FakeTransactions implements PublicPlayerProfileTransactionExecutor {
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
  readonly search: jest.Mock<
    Promise<RepositorySearchResult>,
    Parameters<PublicPlayerProfileSearchRepository['search']>
  >;
  readonly service: PublicPlayerProfileService;
}

function createHarness(): Harness {
  const transactions = new FakeTransactions();
  const search = jest.fn<
    Promise<RepositorySearchResult>,
    Parameters<PublicPlayerProfileSearchRepository['search']>
  >().mockResolvedValue({
    outcome: 'found',
    players: [
      {
        playerId: PLAYER_ID,
        firstName: 'Synthetic',
        lastName: 'Player',
        username: 'synthetic_player',
        rating: 3,
        isVerified: false,
      },
    ],
  });
  return {
    transactions,
    search,
    service: new PublicPlayerProfileService({
      transactions,
      profiles: { search },
    }),
  };
}

function input(
  overrides: Partial<SearchPublicPlayerProfilesInput> = {},
): SearchPublicPlayerProfilesInput {
  return {
    query: 'Synthetic',
    limit: 8,
    role: 'player',
    ...overrides,
  };
}

describe('PublicPlayerProfileService', () => {
  it('searches public profiles in one transaction', async () => {
    const harness = createHarness();

    const result = await harness.service.search(input());

    expect(result).toEqual({
      outcome: 'found',
      players: [
        {
          playerId: PLAYER_ID,
          firstName: 'Synthetic',
          lastName: 'Player',
          username: 'synthetic_player',
          rating: 3,
          isVerified: false,
        },
      ],
    });
    expect(harness.transactions.calls).toBe(1);
    expect(harness.search).toHaveBeenCalledTimes(1);
    expect(harness.search).toHaveBeenCalledWith(TRANSACTION, {
      query: 'Synthetic',
      limit: 8,
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.outcome === 'found') {
      expect(Object.isFrozen(result.players)).toBe(true);
      expect(result.players.every(Object.isFrozen)).toBe(true);
    }
  });

  it('normalizes absent optional public fields to null and preserves rating zero', async () => {
    const harness = createHarness();
    harness.search.mockResolvedValue({
      outcome: 'found',
      players: [
        {
          playerId: PLAYER_ID,
          firstName: 'Synthetic',
          rating: 0,
          isVerified: true,
        },
      ],
    });

    await expect(harness.service.search(input())).resolves.toEqual({
      outcome: 'found',
      players: [
        {
          playerId: PLAYER_ID,
          firstName: 'Synthetic',
          lastName: null,
          username: null,
          rating: 0,
          isVerified: true,
        },
      ],
    });
  });

  it('allows an authenticated club administrator to use the public directory', async () => {
    const harness = createHarness();

    await expect(
      harness.service.search(input({ role: 'club_admin' })),
    ).resolves.toMatchObject({ outcome: 'found' });
    expect(harness.search).toHaveBeenCalledTimes(1);
  });

  it('returns an empty public directory result without treating it as not found', async () => {
    const harness = createHarness();
    harness.search.mockResolvedValue({
      outcome: 'found',
      players: [],
    });

    await expect(harness.service.search(input())).resolves.toEqual({
      outcome: 'found',
      players: [],
    });
  });

  it.each([
    null,
    {},
    { query: 'A', limit: 8, role: 'player' },
    { query: ' Synthetic', limit: 8, role: 'player' },
    { query: 'Ｓynthetic', limit: 8, role: 'player' },
    { query: 'Synthetic', limit: 0, role: 'player' },
    { query: 'Synthetic', limit: 21, role: 'player' },
    { query: 'Synthetic', limit: 8, role: 'unknown' },
    { query: 'Synthetic', limit: 8, role: 'player', extra: true },
  ])('rejects invalid input before opening a transaction %#', async (value) => {
    const harness = createHarness();

    await expect(
      harness.service.search(value as never),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(harness.transactions.calls).toBe(0);
    expect(harness.search).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong id', { playerId: 'invalid' }],
    ['empty first name', { firstName: '' }],
    ['empty optional', { username: '' }],
    ['invalid rating', { rating: 10.01 }],
    ['invalid verification', { isVerified: 'false' }],
    ['private field', { phone: PRIVATE_MARKER }],
  ])('rejects malformed repository player: %s', async (_label, patch) => {
    const harness = createHarness();
    harness.search.mockResolvedValue({
      outcome: 'found',
      players: [
        {
          playerId: PLAYER_ID,
          firstName: 'Synthetic',
          rating: 3,
          isVerified: false,
          ...patch,
        },
      ],
    } as never);

    await expect(harness.service.search(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
  });

  it('rejects duplicate identities and oversized repository responses', async () => {
    const harness = createHarness();
    harness.search.mockResolvedValue({
      outcome: 'found',
      players: [
        {
          playerId: PLAYER_ID,
          firstName: 'One',
          rating: 3,
          isVerified: false,
        },
        {
          playerId: PLAYER_ID,
          firstName: 'Two',
          rating: 3,
          isVerified: false,
        },
      ],
    });

    await expect(harness.service.search(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });

    harness.search.mockResolvedValue({
      outcome: 'found',
      players: [
        {
          playerId: PLAYER_ID,
          firstName: 'One',
          rating: 3,
          isVerified: false,
        },
        {
          playerId: OTHER_PLAYER_ID,
          firstName: 'Two',
          rating: 3,
          isVerified: false,
        },
      ],
    });
    await expect(
      harness.service.search(input({ limit: 1 })),
    ).resolves.toEqual({
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
    harness.search.mockRejectedValue(
      new PublicPlayerProfileSearchPersistenceError(failure),
    );

    await expect(harness.service.search(input())).resolves.toEqual({
      outcome: 'rejected',
      reason,
    });
  });

  it('hides unexpected persistence details from its result', async () => {
    const harness = createHarness();
    harness.search.mockRejectedValue(
      new Error(`${PRIVATE_MARKER}:credential:digest`),
    );

    const result = await harness.service.search(input());

    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(PRIVATE_MARKER);
    expect(serialized).not.toContain('credential');
    expect(serialized).not.toContain('digest');
  });

  it('rejects malformed repository envelopes', async () => {
    const harness = createHarness();
    harness.search.mockResolvedValue({
      outcome: 'found',
      players: [],
      privateValue: PRIVATE_MARKER,
    } as never);

    await expect(harness.service.search(input())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
  });
});
