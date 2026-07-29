import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  MatchDetailRecord,
  MatchPersistenceError,
  MatchRepository,
} from '../database/match.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  PublicPlayerProfileSearchPersistenceError,
  PublicPlayerProfileSearchRepository,
} from '../database/public-player-profile-search.repository';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { MatchApiService } from './match-api.service';
import { CreateMatchRequest } from './match-api.types';
import {
  MatchId,
  MatchParticipantId,
  isMatchRequestDigest,
} from './match.types';

const NOW = unixEpochSeconds(1_800_000_000);
const ACCOUNT_ID = deterministicUuid('match-api-account') as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'match-api-other-account',
) as AccountId;
const REQUEST_KEY = deterministicUuid('match-api-request');
const MATCH_ID = deterministicUuid('match-api-match') as MatchId;
const PARTICIPANT_ID = deterministicUuid(
  'match-api-participant',
) as MatchParticipantId;
const PRIVATE_MARKER = 'SYNTHETIC_MATCH_API_PRIVATE';
const TRANSACTION = {} as PostgresTransaction;

interface Harness {
  readonly service: MatchApiService;
  readonly run: jest.Mock;
  readonly create: jest.MockedFunction<MatchRepository['create']>;
  readonly listPublicFeed: jest.MockedFunction<
    MatchRepository['listPublicFeed']
  >;
  readonly findVisibleById: jest.MockedFunction<
    MatchRepository['findVisibleById']
  >;
  readonly join: jest.MockedFunction<MatchRepository['join']>;
  readonly leave: jest.MockedFunction<MatchRepository['leave']>;
  readonly findByPlayerIds: jest.MockedFunction<
    PublicPlayerProfileSearchRepository['findByPlayerIds']
  >;
  readonly clockNow: jest.Mock;
}

function request(
  overrides: Partial<CreateMatchRequest> = {},
): CreateMatchRequest {
  return {
    requestKey: REQUEST_KEY,
    startsAt: unixEpochSeconds(NOW + 3_600),
    durationMinutes: 90,
    courtId: 'p1',
    scenario: 'social',
    title: 'Synthetic match',
    description: '',
    ratingMin: 2,
    ratingMax: 4,
    isRatingMatch: true,
    ...overrides,
  };
}

function detail(
  matchId: MatchId = MATCH_ID,
  ownerAccountId: AccountId = ACCOUNT_ID,
): MatchDetailRecord {
  return Object.freeze({
    matchId,
    ownerAccountId,
    createdAt: NOW,
    updatedAt: NOW,
    startsAt: unixEpochSeconds(NOW + 3_600),
    durationMinutes: 90,
    courtId: 'court-1',
    courtName: 'Court 1',
    courtType: 'indoor',
    kind: 'match',
    visibility: 'public',
    scenario: 'social',
    status: 'confirmed',
    title: 'Synthetic match',
    description: '',
    ratingMin: 2,
    ratingMax: 4,
    isRatingMatch: true,
    pricePerPersonSnapshot: 1000.5,
    version: 1,
    participants: Object.freeze([]),
  });
}

function createHarness(): Harness {
  const create = jest.fn<ReturnType<MatchRepository['create']>, Parameters<MatchRepository['create']>>();
  const listPublicFeed = jest.fn<
    ReturnType<MatchRepository['listPublicFeed']>,
    Parameters<MatchRepository['listPublicFeed']>
  >();
  const findVisibleById = jest.fn<
    ReturnType<MatchRepository['findVisibleById']>,
    Parameters<MatchRepository['findVisibleById']>
  >();
  const join = jest.fn<
    ReturnType<MatchRepository['join']>,
    Parameters<MatchRepository['join']>
  >();
  const leave = jest.fn<
    ReturnType<MatchRepository['leave']>,
    Parameters<MatchRepository['leave']>
  >();
  const findByPlayerIds = jest.fn<
    ReturnType<PublicPlayerProfileSearchRepository['findByPlayerIds']>,
    Parameters<PublicPlayerProfileSearchRepository['findByPlayerIds']>
  >().mockImplementation(async (_transaction, input) => ({
    outcome: 'found',
    players: Object.freeze(
      input.playerIds.map((playerId) =>
        Object.freeze({
          playerId,
          firstName:
            playerId === ACCOUNT_ID ? 'Synthetic' : 'Other',
          ...(playerId === ACCOUNT_ID
            ? { lastName: 'Owner', username: 'synthetic_owner' }
            : { lastName: 'Player', username: 'synthetic_player' }),
          rating: 3,
          isVerified: playerId === ACCOUNT_ID,
        }),
      ),
    ),
  }));
  const run = jest.fn(
    async (
      operation: (
        transaction: PostgresTransaction,
      ) => Promise<unknown>,
    ) => operation(TRANSACTION),
  );
  const clockNow = jest.fn(() => NOW);
  const service = new MatchApiService({
    transactions: {
      run: <T>(
        operation: (
          transaction: PostgresTransaction,
        ) => Promise<T>,
      ): Promise<T> => run(operation) as Promise<T>,
    },
    matches: {
      create,
      listPublicFeed,
      findVisibleById,
      join,
      leave,
    },
    publicProfiles: { findByPlayerIds },
    clock: { nowEpochSeconds: clockNow },
  });
  return {
    service,
    run,
    create,
    listPublicFeed,
    findVisibleById,
    join,
    leave,
    findByPlayerIds,
    clockNow,
  };
}

describe('MatchApiService', () => {
  it('derives stable create bindings and server-owned format in one transaction', async () => {
    const harness = createHarness();
    harness.create.mockImplementation(async (_transaction, command) => ({
      outcome: 'match_created',
      persistence: 'applied',
      match: detail(command.matchId, command.actorAccountId),
    }));
    const input = {
      accountId: ACCOUNT_ID,
      role: 'player' as const,
      request: request(),
    };

    const first = await harness.service.create(input);
    const firstCommand = harness.create.mock.calls[0][1];
    const second = await harness.service.create(input);
    const secondCommand = harness.create.mock.calls[1][1];

    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('created');
    expect(harness.run).toHaveBeenCalledTimes(2);
    expect(harness.create.mock.calls[0][0]).toBe(TRANSACTION);
    expect(firstCommand).toMatchObject({
      type: 'create_match',
      actorAccountId: ACCOUNT_ID,
      scenario: 'social',
      kind: 'match',
      visibility: 'public',
      status: 'confirmed',
      now: NOW,
    });
    expect(firstCommand).not.toHaveProperty('courtName');
    expect(firstCommand).not.toHaveProperty('courtType');
    expect(firstCommand).not.toHaveProperty('pricePerPersonSnapshot');
    expect(isInternalUuid(firstCommand.matchId)).toBe(true);
    expect(isInternalUuid(firstCommand.commandId)).toBe(true);
    expect(isMatchRequestDigest(firstCommand.requestDigest)).toBe(true);
    expect(secondCommand.matchId).toBe(firstCommand.matchId);
    expect(secondCommand.commandId).toBe(firstCommand.commandId);
    expect(secondCommand.requestDigest).toBe(firstCommand.requestDigest);
    expect(JSON.stringify(firstCommand)).not.toContain(PRIVATE_MARKER);
  });

  it('passes community without a selected court through the private repository boundary', async () => {
    const harness = createHarness();
    harness.create.mockImplementation(async (_transaction, command) => ({
      outcome: 'match_created',
      persistence: 'applied',
      match: {
        ...detail(command.matchId, command.actorAccountId),
        courtId: `unassigned:${command.matchId}`,
        courtName: 'Корт не выбран',
        courtType: 'unassigned',
        scenario: 'community',
        status: 'searching',
        isRatingMatch: false,
        pricePerPersonSnapshot: undefined,
      },
    }));
    const communityRequest = request({
      courtId: undefined,
      scenario: 'community',
      isRatingMatch: false,
    });
    delete (communityRequest as { courtId?: string }).courtId;

    const result = await harness.service.create({
      accountId: ACCOUNT_ID,
      role: 'player',
      request: communityRequest,
    });

    expect(result).toMatchObject({
      outcome: 'created',
      match: {
        courtName: 'Корт не выбран',
        courtType: 'unassigned',
        scenario: 'community',
        status: 'searching',
      },
    });
    expect(harness.create.mock.calls[0][1]).toMatchObject({
      scenario: 'community',
      status: 'searching',
    });
    expect(harness.create.mock.calls[0][1]).not.toHaveProperty('courtId');
  });

  it('lets the repository resolve a durable create retry after startsAt', async () => {
    const harness = createHarness();
    harness.clockNow.mockReturnValue(unixEpochSeconds(NOW + 7_200));
    harness.create.mockImplementation(async (_transaction, command) => ({
      outcome: 'match_created',
      persistence: 'idempotent_retry',
      match: detail(command.matchId, command.actorAccountId),
    }));

    await expect(
      harness.service.create({
        accountId: ACCOUNT_ID,
        role: 'player',
        request: request(),
      }),
    ).resolves.toMatchObject({ outcome: 'created' });
    expect(harness.create).toHaveBeenCalledTimes(1);
    expect(harness.create.mock.calls[0][1].now).toBe(NOW + 7_200);
  });

  it('derives private format without public rating fields', async () => {
    const harness = createHarness();
    harness.create.mockImplementation(async (_transaction, command) => ({
      outcome: 'match_created',
      persistence: 'applied',
      match: {
        ...detail(command.matchId, command.actorAccountId),
        kind: 'private',
        visibility: 'private',
        scenario: 'private',
        status: 'upcoming',
        isRatingMatch: false,
        ratingMin: undefined,
        ratingMax: undefined,
      },
    }));
    const privateRequest = request({
      scenario: 'private',
      isRatingMatch: false,
      ratingMin: undefined,
      ratingMax: undefined,
    });
    delete (privateRequest as { ratingMin?: number }).ratingMin;
    delete (privateRequest as { ratingMax?: number }).ratingMax;

    const result = await harness.service.create({
      accountId: ACCOUNT_ID,
      role: 'player',
      request: privateRequest,
    });

    expect(result.outcome).toBe('created');
    expect(harness.create.mock.calls[0][1]).toMatchObject({
      kind: 'private',
      visibility: 'private',
      scenario: 'private',
      status: 'upcoming',
      isRatingMatch: false,
    });
    expect(harness.create.mock.calls[0][1]).not.toHaveProperty('ratingMin');
    expect(harness.create.mock.calls[0][1]).not.toHaveProperty('ratingMax');
  });

  it('lists and reads only safe repository records', async () => {
    const harness = createHarness();
    const participants = Object.freeze([
      Object.freeze({
        playerId: OTHER_ACCOUNT_ID,
        slotNumber: 2 as const,
      }),
    ]);
    harness.listPublicFeed.mockResolvedValue([
      {
        ...detail(),
        scenario: 'social',
        ratingMin: 2,
        ratingMax: 4,
        occupiedSlots: 2,
        participants,
      },
    ]);
    harness.findVisibleById.mockResolvedValue({
      ...detail(),
      participants,
    });

    const feed = await harness.service.list({
      accountId: ACCOUNT_ID,
      role: 'club_admin',
      request: { limit: 20 },
    });
    const found = await harness.service.detail({
      accountId: ACCOUNT_ID,
      role: 'player',
      matchId: MATCH_ID,
    });

    expect(feed).toMatchObject({
      outcome: 'found',
      matches: [
        {
          owner: {
            playerId: ACCOUNT_ID,
            firstName: 'Synthetic',
            lastName: 'Owner',
            username: 'synthetic_owner',
            rating: 3,
            isVerified: true,
          },
          participants: [
            {
              playerId: OTHER_ACCOUNT_ID,
              slotNumber: 2,
              firstName: 'Other',
              lastName: 'Player',
              username: 'synthetic_player',
              rating: 3,
              isVerified: false,
            },
          ],
        },
      ],
    });
    expect(found).toMatchObject({
      outcome: 'found',
      match: {
        owner: {
          playerId: ACCOUNT_ID,
          firstName: 'Synthetic',
          lastName: 'Owner',
          username: 'synthetic_owner',
          rating: 3,
          isVerified: true,
        },
        participants: [
          {
            playerId: OTHER_ACCOUNT_ID,
            slotNumber: 2,
            firstName: 'Other',
            lastName: 'Player',
            username: 'synthetic_player',
            rating: 3,
            isVerified: false,
          },
        ],
      },
    });
    expect(harness.listPublicFeed).toHaveBeenCalledWith(TRANSACTION, {
      now: NOW,
      limit: 20,
    });
    expect(harness.findVisibleById).toHaveBeenCalledWith(TRANSACTION, {
      matchId: MATCH_ID,
      viewerAccountId: ACCOUNT_ID,
    });
    expect(harness.findByPlayerIds).toHaveBeenNthCalledWith(
      1,
      TRANSACTION,
      { playerIds: [ACCOUNT_ID, OTHER_ACCOUNT_ID] },
    );
    expect(harness.findByPlayerIds).toHaveBeenNthCalledWith(
      2,
      TRANSACTION,
      { playerIds: [ACCOUNT_ID, OTHER_ACCOUNT_ID] },
    );
    expect(JSON.stringify({ feed, found })).not.toMatch(
      /phone|photoUrl|languageCode|sidePreference/iu,
    );
  });

  it('fails closed when a participant public profile is missing', async () => {
    const harness = createHarness();
    harness.findVisibleById.mockResolvedValue({
      ...detail(),
      participants: [
        {
          playerId: OTHER_ACCOUNT_ID,
          slotNumber: 2,
        },
      ],
    });
    harness.findByPlayerIds.mockResolvedValue({
      outcome: 'found',
      players: [
        {
          playerId: ACCOUNT_ID,
          firstName: 'Synthetic',
          rating: 3,
          isVerified: true,
        },
      ],
    });

    await expect(
      harness.service.detail({
        accountId: ACCOUNT_ID,
        role: 'player',
        matchId: MATCH_ID,
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
  });

  it('hides public profile persistence failures', async () => {
    const harness = createHarness();
    harness.findVisibleById.mockResolvedValue(detail());
    harness.findByPlayerIds.mockRejectedValue(
      new PublicPlayerProfileSearchPersistenceError(
        'permission_denied',
      ),
    );

    await expect(
      harness.service.detail({
        accountId: ACCOUNT_ID,
        role: 'player',
        matchId: MATCH_ID,
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
  });

  it.each([
    ['terminal status', { status: 'completed' as const }],
    ['start boundary', { startsAt: NOW }],
  ])('rejects malformed feed output with %s', async (_case, override) => {
    const harness = createHarness();
    harness.listPublicFeed.mockResolvedValue([
      {
        ...detail(),
        scenario: 'social',
        ratingMin: 2,
        ratingMax: 4,
        occupiedSlots: 1,
        ...override,
      },
    ]);

    await expect(
      harness.service.list({
        accountId: ACCOUNT_ID,
        role: 'player',
        request: { limit: 20 },
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
  });

  it('derives distinct stable join/leave commands and exposes only participant allowlist', async () => {
    const harness = createHarness();
    harness.join.mockImplementation(async (_transaction, command) => ({
      outcome: 'participant_joined',
      persistence: 'applied',
      participant: {
        participantId: command.participantId,
        accountId: command.actorAccountId,
        slotNumber: 2,
        status: 'active',
        joinedAt: NOW,
        updatedAt: NOW,
        version: 1,
      },
      matchVersion: 2,
    }));
    harness.leave.mockResolvedValue({
      outcome: 'participant_left',
      persistence: 'applied',
      participant: {
        participantId: PARTICIPANT_ID,
        accountId: ACCOUNT_ID,
        slotNumber: 2,
        status: 'left',
        joinedAt: NOW,
        updatedAt: NOW,
        leftAt: NOW,
        version: 2,
      },
      matchVersion: 3,
    });
    const input = {
      accountId: ACCOUNT_ID,
      role: 'player' as const,
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY },
    };

    const joined = await harness.service.join(input);
    const left = await harness.service.leave(input);
    const joinCommand = harness.join.mock.calls[0][1];
    const leaveCommand = harness.leave.mock.calls[0][1];

    expect(joined).toEqual({
      outcome: 'updated',
      participant: {
        matchId: MATCH_ID,
        playerId: ACCOUNT_ID,
        slotNumber: 2,
        status: 'active',
        matchVersion: 2,
      },
    });
    expect(left).toEqual({
      outcome: 'updated',
      participant: {
        matchId: MATCH_ID,
        playerId: ACCOUNT_ID,
        slotNumber: 2,
        status: 'left',
        matchVersion: 3,
      },
    });
    expect(joinCommand.commandId).not.toBe(leaveCommand.commandId);
    expect(joinCommand.requestDigest).not.toBe(
      leaveCommand.requestDigest,
    );
    expect(joined).not.toHaveProperty('participant.participantId');
    expect(joined).not.toHaveProperty('persistence');
  });

  it('returns idempotent repository results as the same public success shape', async () => {
    const harness = createHarness();
    harness.join.mockResolvedValue({
      outcome: 'participant_joined',
      persistence: 'idempotent_retry',
      participant: {
        participantId: PARTICIPANT_ID,
        accountId: ACCOUNT_ID,
        slotNumber: 3,
        status: 'active',
        joinedAt: NOW,
        updatedAt: NOW,
        version: 1,
      },
      matchVersion: 2,
    });

    await expect(
      harness.service.join({
        accountId: ACCOUNT_ID,
        role: 'player',
        matchId: MATCH_ID,
        request: { requestKey: REQUEST_KEY },
      }),
    ).resolves.toEqual({
      outcome: 'updated',
      participant: {
        matchId: MATCH_ID,
        playerId: ACCOUNT_ID,
        slotNumber: 3,
        status: 'active',
        matchVersion: 2,
      },
    });
  });

  it('maps missing or invisible detail to the same safe not-found result', async () => {
    const harness = createHarness();
    harness.findVisibleById.mockResolvedValue(null);

    await expect(
      harness.service.detail({
        accountId: ACCOUNT_ID,
        role: 'player',
        matchId: MATCH_ID,
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'match_not_found',
    });
  });

  it.each([
    ['command_reuse_conflict', 'request_conflict'],
    ['match_not_found', 'match_not_found'],
    ['match_closed', 'match_closed'],
    ['match_not_joinable', 'match_not_joinable'],
    ['match_started', 'match_started'],
    [
      'rating_verification_required',
      'rating_verification_required',
    ],
    ['rating_out_of_range', 'rating_out_of_range'],
    ['owner_cannot_join', 'owner_cannot_join'],
    ['already_joined', 'already_joined'],
    ['match_full', 'match_full'],
  ] as const)('maps repository rejection %s', async (reason, expected) => {
    const harness = createHarness();
    harness.join.mockResolvedValue({ outcome: 'rejected', reason });

    await expect(
      harness.service.join({
        accountId: ACCOUNT_ID,
        role: 'player',
        matchId: MATCH_ID,
        request: { requestKey: REQUEST_KEY },
      }),
    ).resolves.toEqual({ outcome: 'rejected', reason: expected });
  });

  it('maps an unknown trusted court to a safe invalid request', async () => {
    const harness = createHarness();
    harness.create.mockResolvedValue({
      outcome: 'rejected',
      reason: 'court_invalid',
    });

    await expect(
      harness.service.create({
        accountId: ACCOUNT_ID,
        role: 'player',
        request: request(),
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
  });

  it.each([
    ['database_unavailable', 'temporary_unavailable'],
    ['transaction_conflict', 'temporary_unavailable'],
    ['command_conflict', 'request_conflict'],
    ['match_conflict', 'match_conflict'],
    ['permission_denied', 'internal_failure'],
    ['storage_failure', 'internal_failure'],
  ] as const)('hides persistence failure %s', async (reason, expected) => {
    const harness = createHarness();
    harness.findVisibleById.mockRejectedValue(
      new MatchPersistenceError(reason),
    );

    const result = await harness.service.detail({
      accountId: ACCOUNT_ID,
      role: 'player',
      matchId: MATCH_ID,
    });

    expect(result).toEqual({ outcome: 'rejected', reason: expected });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_MARKER);
  });

  it('fails closed for admin writes, new started create and malformed repository output', async () => {
    const harness = createHarness();
    await expect(
      harness.service.create({
        accountId: ACCOUNT_ID,
        role: 'club_admin',
        request: request(),
      }),
    ).resolves.toEqual({ outcome: 'rejected', reason: 'forbidden' });
    harness.create.mockRejectedValueOnce(
      new MatchPersistenceError('invalid_input'),
    );
    await expect(
      harness.service.create({
        accountId: ACCOUNT_ID,
        role: 'player',
        request: request({ startsAt: NOW }),
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    harness.findVisibleById.mockResolvedValue({
      ...detail(),
      ownerAccountId: OTHER_ACCOUNT_ID,
      participants: [
        { playerId: ACCOUNT_ID, slotNumber: 2 },
        { playerId: ACCOUNT_ID, slotNumber: 3 },
      ],
    });
    await expect(
      harness.service.detail({
        accountId: ACCOUNT_ID,
        role: 'player',
        matchId: MATCH_ID,
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
    expect(harness.create).toHaveBeenCalledTimes(1);
  });
});
