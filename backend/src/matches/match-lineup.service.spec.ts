import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { MatchLineupRepository } from '../database/match-lineup.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { PublicPlayerProfileSearchRepository } from '../database/public-player-profile-search.repository';
import {
  MatchLineupAssignmentId,
  MatchLineupCommandId,
} from './match-lineup.types';
import { MatchLineupService } from './match-lineup.service';
import { MatchCommandId, MatchId } from './match.types';

const MATCH_ID = deterministicUuid('lineup-service-match') as MatchId;
const ACTOR_ID = deterministicUuid('lineup-service-actor') as AccountId;
const OTHER_ID = deterministicUuid('lineup-service-other') as AccountId;
const ASSIGNMENT_ID = deterministicUuid('lineup-service-assignment') as MatchLineupAssignmentId;
const REQUEST_KEY = deterministicUuid('lineup-service-request');
const MATCH_COMMAND_ID = deterministicUuid('lineup-service-match-command') as MatchCommandId;
const NOW = unixEpochSeconds(1_800_000_000);
const TRANSACTION = {} as PostgresTransaction;

function harness() {
  const read = jest.fn<ReturnType<MatchLineupRepository['read']>, Parameters<MatchLineupRepository['read']>>();
  const assign = jest.fn<ReturnType<MatchLineupRepository['assign']>, Parameters<MatchLineupRepository['assign']>>();
  const release = jest.fn<ReturnType<MatchLineupRepository['release']>, Parameters<MatchLineupRepository['release']>>();
  const releaseForParticipantLeave = jest.fn<
    ReturnType<MatchLineupRepository['releaseForParticipantLeave']>,
    Parameters<MatchLineupRepository['releaseForParticipantLeave']>
  >();
  const findByPlayerIds = jest.fn<
    ReturnType<PublicPlayerProfileSearchRepository['findByPlayerIds']>,
    Parameters<PublicPlayerProfileSearchRepository['findByPlayerIds']>
  >().mockImplementation(async (_transaction, input) => ({
    outcome: 'found',
    players: input.playerIds.map((playerId) => ({
      playerId,
      firstName: playerId === ACTOR_ID ? 'Actor' : 'Other',
      rating: 3,
      isVerified: true,
    })),
  }));
  const run = jest.fn(async (operation: (transaction: PostgresTransaction) => Promise<unknown>) => operation(TRANSACTION));
  const service = new MatchLineupService({
    transactions: {
      run: <T>(operation: (transaction: PostgresTransaction) => Promise<T>) => run(operation) as Promise<T>,
    },
    lineups: { read, assign, release, releaseForParticipantLeave },
    publicProfiles: { findByPlayerIds },
    clock: { nowEpochSeconds: () => NOW },
  });
  return { service, read, assign, release, releaseForParticipantLeave, findByPlayerIds };
}

describe('MatchLineupService', () => {
  it('returns exactly four ordered cells and separates unassigned participants', async () => {
    const subject = harness();
    subject.read.mockResolvedValue({
      outcome: 'found',
      lineup: {
        matchId: MATCH_ID,
        status: 'draft',
        createdAt: NOW,
        updatedAt: NOW,
        version: 2,
        eligibleAccountIds: [ACTOR_ID, OTHER_ID],
        assignments: [{
          assignmentId: ASSIGNMENT_ID,
          matchId: MATCH_ID,
          accountId: ACTOR_ID,
          teamNumber: 2,
          courtSide: 'right',
          assignedAt: NOW,
          updatedAt: NOW,
          version: 1,
        }],
      },
    });

    const response = await subject.service.read({
      accountId: ACTOR_ID,
      role: 'player',
      matchId: MATCH_ID,
    });

    expect(response.outcome).toBe('found');
    if (response.outcome !== 'found') throw new Error('Expected lineup');
    expect(response.lineup.slots.map(({ teamNumber, courtSide }) => [teamNumber, courtSide])).toEqual([
      [1, 'left'], [1, 'right'], [2, 'left'], [2, 'right'],
    ]);
    expect(response.lineup.slots[3].assignment).toMatchObject({
      assignmentId: ASSIGNMENT_ID,
      isCurrentPlayer: true,
      player: { playerId: ACTOR_ID, firstName: 'Actor' },
    });
    expect(response.lineup.unassignedPlayers).toEqual([
      expect.objectContaining({ playerId: OTHER_ID, firstName: 'Other' }),
    ]);
  });

  it('keeps lineup aggregates available when an assigned public profile is hidden', async () => {
    const subject = harness();
    subject.read.mockResolvedValue({
      outcome: 'found',
      lineup: {
        matchId: MATCH_ID,
        status: 'draft',
        createdAt: NOW,
        updatedAt: NOW,
        version: 2,
        eligibleAccountIds: [ACTOR_ID, OTHER_ID],
        assignments: [{
          assignmentId: ASSIGNMENT_ID,
          matchId: MATCH_ID,
          accountId: OTHER_ID,
          teamNumber: 1,
          courtSide: 'left',
          assignedAt: NOW,
          updatedAt: NOW,
          version: 1,
        }],
      },
    });
    subject.findByPlayerIds.mockResolvedValue({
      outcome: 'found',
      players: [{
        playerId: ACTOR_ID,
        firstName: 'Actor',
        rating: 3,
        isVerified: true,
      }],
    });

    const response = await subject.service.read({
      accountId: ACTOR_ID,
      role: 'player',
      matchId: MATCH_ID,
    });

    expect(response.outcome).toBe('found');
    if (response.outcome !== 'found') throw new Error('Expected lineup');
    expect(response.lineup.slots[0].assignment).toMatchObject({
      assignmentId: ASSIGNMENT_ID,
      isCurrentPlayer: false,
      player: { unavailable: true },
    });
    expect(response.lineup.slots[0].assignment?.player).toEqual({
      unavailable: true,
    });
    expect(response.lineup.unassignedPlayers).toEqual([
      expect.objectContaining({ playerId: ACTOR_ID, firstName: 'Actor' }),
    ]);
    expect(JSON.stringify(response.lineup.slots[0].assignment?.player)).not.toMatch(
      /playerId|firstName|phone|email/iu,
    );
  });

  it('derives stable command and assignment bindings and never accepts client account ids', async () => {
    const subject = harness();
    subject.assign.mockImplementation(async (_transaction, input) => ({
      outcome: 'lineup_slot_claimed',
      persistence: 'applied',
      assignment: {
        assignmentId: input.assignmentId,
        matchId: input.matchId,
        accountId: input.actorAccountId,
        teamNumber: input.teamNumber,
        courtSide: input.courtSide,
        appliedAt: input.now,
        lineupVersion: 2,
      },
    }));
    const input = {
      accountId: ACTOR_ID,
      role: 'player' as const,
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY, teamNumber: 1 as const, courtSide: 'left' as const },
    };

    await subject.service.assign(input);
    await subject.service.assign(input);

    expect(subject.assign.mock.calls[0][1]).toEqual(subject.assign.mock.calls[1][1]);
    expect(subject.assign.mock.calls[0][1].commandId).not.toBe(subject.assign.mock.calls[0][1].assignmentId);
    await subject.service.assign({
      ...input,
      request: { ...input.request, teamNumber: 2, courtSide: 'right' },
    });
    expect(subject.assign.mock.calls[2][1].commandId).toBe(subject.assign.mock.calls[0][1].commandId);
    expect(subject.assign.mock.calls[2][1].assignmentId).toBe(subject.assign.mock.calls[0][1].assignmentId);
    expect(subject.assign.mock.calls[2][1].requestDigest).not.toBe(subject.assign.mock.calls[0][1].requestDigest);
    await expect(subject.service.assign({
      ...input,
      request: { ...input.request, accountId: OTHER_ID } as never,
    })).resolves.toEqual({ outcome: 'rejected', reason: 'invalid_request' });
  });

  it('derives a separate idempotent release when participant leave is applied', async () => {
    const subject = harness();
    subject.releaseForParticipantLeave.mockResolvedValue(true);

    await expect(subject.service.releaseForParticipantLeave(
      TRANSACTION,
      MATCH_ID,
      ACTOR_ID,
      NOW,
      MATCH_COMMAND_ID,
    )).resolves.toBe(true);

    const input = subject.releaseForParticipantLeave.mock.calls[0][1];
    expect(input.commandId).not.toBe(MATCH_COMMAND_ID as unknown as MatchLineupCommandId);
    expect(input.matchId).toBe(MATCH_ID);
    expect(input.actorAccountId).toBe(ACTOR_ID);
    expect(input.requestDigest).toMatch(/^[0-9a-f]{64}$/u);
  });
});
