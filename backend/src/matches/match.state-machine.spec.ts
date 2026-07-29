import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { transitionMatch } from './match.state-machine';
import {
  CreateMatchCommand,
  JoinMatchCommand,
  LeaveMatchCommand,
  MatchCommandId,
  MatchId,
  MatchParticipantId,
  MatchRequestDigest,
  MatchState,
} from './match.types';

const OWNER_ID = deterministicUuid('match-owner') as AccountId;
const PLAYER_ID = deterministicUuid('match-player') as AccountId;
const OTHER_PLAYER_ID = deterministicUuid('match-other-player') as AccountId;
const MATCH_ID = deterministicUuid('match') as MatchId;
const CREATE_COMMAND_ID = deterministicUuid(
  'match-create-command',
) as MatchCommandId;
const JOIN_COMMAND_ID = deterministicUuid(
  'match-join-command',
) as MatchCommandId;
const LEAVE_COMMAND_ID = deterministicUuid(
  'match-leave-command',
) as MatchCommandId;
const PARTICIPANT_ID = deterministicUuid(
  'match-participant',
) as MatchParticipantId;
const REQUEST_DIGEST = '1'.repeat(64) as MatchRequestDigest;

function createCommand(
  overrides: Partial<CreateMatchCommand> = {},
): CreateMatchCommand {
  return {
    type: 'create_match',
    matchId: MATCH_ID,
    commandId: CREATE_COMMAND_ID,
    actorAccountId: OWNER_ID,
    requestDigest: REQUEST_DIGEST,
    now: unixEpochSeconds(1_800_000_000),
    startsAt: unixEpochSeconds(1_800_003_600),
    durationMinutes: 90,
    courtId: 'court-1',
    courtName: 'Synthetic court',
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
    actorIsVerified: true,
    ...overrides,
  };
}

function createdState(): MatchState {
  const result = transitionMatch(null, createCommand());
  if (result.outcome !== 'transitioned') {
    throw new Error('Synthetic create failed');
  }
  return result.state;
}

function joinCommand(
  overrides: Partial<JoinMatchCommand> = {},
): JoinMatchCommand {
  return {
    type: 'join_match',
    matchId: MATCH_ID,
    commandId: JOIN_COMMAND_ID,
    actorAccountId: PLAYER_ID,
    requestDigest: '2'.repeat(64) as MatchRequestDigest,
    now: unixEpochSeconds(1_800_000_100),
    participantId: PARTICIPANT_ID,
    actorRatingLevel: 3,
    actorIsVerified: true,
    ...overrides,
  };
}

function joinedState(): MatchState {
  const result = transitionMatch(createdState(), joinCommand());
  if (result.outcome !== 'transitioned') {
    throw new Error('Synthetic join failed');
  }
  return result.state;
}

describe('match state machine', () => {
  it('creates a public match at version and command sequence one', () => {
    const result = transitionMatch(null, createCommand());

    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'match_created',
      state: {
        matchId: MATCH_ID,
        ownerAccountId: OWNER_ID,
        version: 1,
        participants: [],
      },
      command: {
        commandSequence: 1,
        matchVersion: 1,
        commandType: 'create_match',
        resultType: 'match_created',
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.outcome === 'transitioned') {
      expect(Object.isFrozen(result.state)).toBe(true);
      expect(Object.isFrozen(result.state.appliedCommands)).toBe(true);
    }
  });

  it('uses the exact product status for social and community creation', () => {
    expect(transitionMatch(null, createCommand())).toMatchObject({
      outcome: 'transitioned',
      state: { scenario: 'social', status: 'confirmed' },
    });
    expect(
      transitionMatch(
        null,
        createCommand({
          scenario: 'community',
          status: 'searching',
        }),
      ),
    ).toMatchObject({
      outcome: 'transitioned',
      state: { scenario: 'community', status: 'searching' },
    });
    expect(
      transitionMatch(
        null,
        createCommand({ scenario: 'social', status: 'open' }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'invalid_match_command',
    });
  });

  it('requires trusted verification only for rating match creation', () => {
    expect(
      transitionMatch(
        null,
        createCommand({ actorIsVerified: false }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'rating_verification_required',
    });
    expect(
      transitionMatch(
        null,
        createCommand({
          actorIsVerified: false,
          isRatingMatch: false,
        }),
      ),
    ).toMatchObject({
      outcome: 'transitioned',
      transition: 'match_created',
    });
  });

  it('accepts the exact private format and rejects mixed formats', () => {
    expect(
      transitionMatch(
        null,
        createCommand({
          kind: 'private',
          visibility: 'private',
          scenario: 'private',
          status: 'upcoming',
          ratingMin: undefined,
          ratingMax: undefined,
          isRatingMatch: false,
        }),
      ),
    ).toMatchObject({ outcome: 'transitioned' });

    expect(
      transitionMatch(
        null,
        createCommand({
          kind: 'private',
          visibility: 'public',
          scenario: 'private',
          status: 'upcoming',
          ratingMin: undefined,
          ratingMax: undefined,
          isRatingMatch: false,
        }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'invalid_match_command',
    });
  });

  it('assigns the lowest free participant slot and increments version', () => {
    const result = transitionMatch(createdState(), joinCommand());

    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'participant_joined',
      participant: {
        participantId: PARTICIPANT_ID,
        accountId: PLAYER_ID,
        slotNumber: 2,
        status: 'active',
        version: 1,
      },
      state: { version: 2, status: 'open' },
      command: {
        commandSequence: 2,
        matchVersion: 2,
        resultType: 'participant_joined',
      },
    });
  });

  it('protects reserved invitation slots and accepts the requested invited slot', () => {
    expect(
      transitionMatch(
        createdState(),
        joinCommand({ reservedSlotNumbers: [2] }),
      ),
    ).toMatchObject({
      outcome: 'transitioned',
      participant: { slotNumber: 3 },
    });

    expect(
      transitionMatch(
        createdState(),
        joinCommand({
          requestedSlotNumber: 3,
          reservedSlotNumbers: [2, 4],
        }),
      ),
    ).toMatchObject({
      outcome: 'transitioned',
      participant: { slotNumber: 3 },
    });

    expect(
      transitionMatch(
        createdState(),
        joinCommand({ reservedSlotNumbers: [2, 3, 4] }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'match_full',
    });
  });

  it('leaves an active participant without deleting its history', () => {
    const command: LeaveMatchCommand = {
      type: 'leave_match',
      matchId: MATCH_ID,
      commandId: LEAVE_COMMAND_ID,
      actorAccountId: PLAYER_ID,
      requestDigest: '3'.repeat(64) as MatchRequestDigest,
      now: unixEpochSeconds(1_800_000_200),
    };
    const result = transitionMatch(joinedState(), command);

    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'participant_left',
      participant: {
        participantId: PARTICIPANT_ID,
        status: 'left',
        leftAt: command.now,
        version: 2,
      },
      state: { version: 3 },
      command: {
        commandSequence: 3,
        resultType: 'participant_left',
      },
    });
  });

  it('rejects leave exactly at the match start boundary', () => {
    const state = joinedState();

    expect(
      transitionMatch(state, {
        type: 'leave_match',
        matchId: MATCH_ID,
        commandId: LEAVE_COMMAND_ID,
        actorAccountId: PLAYER_ID,
        requestDigest: '3'.repeat(64) as MatchRequestDigest,
        now: state.startsAt,
      }),
    ).toEqual({
      outcome: 'rejected',
      reason: 'match_started',
    });
    expect(state.participants).toHaveLength(1);
    expect(state.appliedCommands).toHaveLength(2);
    expect(state.version).toBe(2);
  });

  it('returns the original result for an exact command retry', () => {
    const state = joinedState();
    const result = transitionMatch(
      state,
      joinCommand({
        participantId: deterministicUuid(
          'retry-generated-participant',
        ) as MatchParticipantId,
      }),
    );

    expect(result).toMatchObject({
      outcome: 'idempotent_retry',
      originalCommand: {
        participantId: PARTICIPANT_ID,
        resultType: 'participant_joined',
      },
    });
  });

  it('rejects commandId reuse with a changed request digest', () => {
    expect(
      transitionMatch(
        joinedState(),
        joinCommand({
          requestDigest: '9'.repeat(64) as MatchRequestDigest,
        }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'command_reuse_conflict',
    });
  });

  it('rejects owner join, duplicate join and a fifth occupied slot', () => {
    expect(
      transitionMatch(
        createdState(),
        joinCommand({ actorAccountId: OWNER_ID }),
      ),
    ).toEqual({ outcome: 'rejected', reason: 'owner_cannot_join' });

    expect(transitionMatch(joinedState(), joinCommand())).toMatchObject({
      outcome: 'idempotent_retry',
    });
    expect(
      transitionMatch(
        joinedState(),
        joinCommand({
          commandId: deterministicUuid(
            'duplicate-player-command',
          ) as MatchCommandId,
          requestDigest: '7'.repeat(64) as MatchRequestDigest,
          participantId: deterministicUuid(
            'duplicate-player-participant',
          ) as MatchParticipantId,
        }),
      ),
    ).toEqual({ outcome: 'rejected', reason: 'already_joined' });

    const state = joinedState();
    const player3 = deterministicUuid('match-player-3') as AccountId;
    const player4 = deterministicUuid('match-player-4') as AccountId;
    const joined3 = transitionMatch(
      state,
      joinCommand({
        actorAccountId: player3,
        commandId: deterministicUuid('join-3') as MatchCommandId,
        requestDigest: '4'.repeat(64) as MatchRequestDigest,
        participantId: deterministicUuid(
          'participant-3',
        ) as MatchParticipantId,
      }),
    );
    if (joined3.outcome !== 'transitioned') {
      throw new Error('Synthetic third player join failed');
    }
    const joined4 = transitionMatch(
      joined3.state,
      joinCommand({
        actorAccountId: player4,
        commandId: deterministicUuid('join-4') as MatchCommandId,
        requestDigest: '5'.repeat(64) as MatchRequestDigest,
        participantId: deterministicUuid(
          'participant-4',
        ) as MatchParticipantId,
      }),
    );
    if (joined4.outcome !== 'transitioned') {
      throw new Error('Synthetic fourth player join failed');
    }
    expect(joined4.state.status).toBe('upcoming');
    expect(
      transitionMatch(
        joined4.state,
        joinCommand({
          actorAccountId: OTHER_PLAYER_ID,
          commandId: deterministicUuid('join-5') as MatchCommandId,
          requestDigest: '6'.repeat(64) as MatchRequestDigest,
          participantId: deterministicUuid(
            'participant-5',
          ) as MatchParticipantId,
        }),
      ),
    ).toEqual({ outcome: 'rejected', reason: 'match_full' });
  });

  it('rejects joining private/closed matches and stale command time', () => {
    const privateResult = transitionMatch(
      null,
      createCommand({
        kind: 'private',
        visibility: 'private',
        scenario: 'private',
        status: 'upcoming',
        ratingMin: undefined,
        ratingMax: undefined,
        isRatingMatch: false,
      }),
    );
    if (privateResult.outcome !== 'transitioned') {
      throw new Error('Synthetic private create failed');
    }
    expect(
      transitionMatch(privateResult.state, joinCommand()),
    ).toEqual({
      outcome: 'rejected',
      reason: 'match_not_joinable',
    });
    expect(
      transitionMatch(
        createdState(),
        joinCommand({ now: unixEpochSeconds(1_799_999_999) }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'invalid_match_command',
    });
    expect(
      transitionMatch(
        createdState(),
        joinCommand({
          now: unixEpochSeconds(1_800_003_600),
        }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'match_started',
    });
    expect(
      transitionMatch(
        createdState(),
        joinCommand({ actorIsVerified: false }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'rating_verification_required',
    });
    expect(
      transitionMatch(
        createdState(),
        joinCommand({ actorRatingLevel: 5 }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'rating_out_of_range',
    });
  });

  it('allows an unverified player to join a non-rating match', () => {
    const created = transitionMatch(
      null,
      createCommand({ isRatingMatch: false }),
    );
    if (created.outcome !== 'transitioned') {
      throw new Error('Synthetic non-rating create failed');
    }

    expect(
      transitionMatch(
        created.state,
        joinCommand({ actorIsVerified: false }),
      ),
    ).toMatchObject({
      outcome: 'transitioned',
      transition: 'participant_joined',
    });
  });

  it('reopens a full upcoming match when an active participant leaves', () => {
    let state = createdState();
    for (const [index, accountId] of [
      PLAYER_ID,
      OTHER_PLAYER_ID,
      deterministicUuid('match-player-status-4') as AccountId,
    ].entries()) {
      const result = transitionMatch(
        state,
        joinCommand({
          actorAccountId: accountId,
          commandId: deterministicUuid(
            `status-join-${index}`,
          ) as MatchCommandId,
          requestDigest: `${index + 4}`.repeat(
            64,
          ) as MatchRequestDigest,
          participantId: deterministicUuid(
            `status-participant-${index}`,
          ) as MatchParticipantId,
          now: unixEpochSeconds(1_800_000_100 + index),
        }),
      );
      if (result.outcome !== 'transitioned') {
        throw new Error('Synthetic status join failed');
      }
      state = result.state;
    }
    expect(state.status).toBe('upcoming');

    const result = transitionMatch(state, {
      type: 'leave_match',
      matchId: MATCH_ID,
      commandId: deterministicUuid(
        'status-leave',
      ) as MatchCommandId,
      actorAccountId: PLAYER_ID,
      requestDigest: '8'.repeat(64) as MatchRequestDigest,
      now: unixEpochSeconds(1_800_000_200),
    });

    expect(result).toMatchObject({
      outcome: 'transitioned',
      transition: 'participant_left',
      state: { status: 'open', version: 5 },
    });
  });

  it('rejects a price snapshot that PostgreSQL numeric(12,2) would round', () => {
    expect(
      transitionMatch(
        null,
        createCommand({ pricePerPersonSnapshot: 10.999 }),
      ),
    ).toEqual({
      outcome: 'rejected',
      reason: 'invalid_match_command',
    });
  });
});
