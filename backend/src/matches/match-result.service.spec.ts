import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { MatchResultRepository } from '../database/match-result.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { MatchResultId } from './match-result.types';
import { MatchResultService } from './match-result.service';
import { MatchId } from './match.types';

const MATCH_ID = deterministicUuid('result-service-match') as MatchId;
const RESULT_ID = deterministicUuid('result-service-result') as MatchResultId;
const ACTOR_ID = deterministicUuid('result-service-actor') as AccountId;
const OTHER_ID = deterministicUuid('result-service-other') as AccountId;
const THIRD_ID = deterministicUuid('result-service-third') as AccountId;
const FOURTH_ID = deterministicUuid('result-service-fourth') as AccountId;
const REQUEST_KEY = deterministicUuid('result-service-request');
const NOW = unixEpochSeconds(1_800_000_000);
const TRANSACTION = {} as PostgresTransaction;

function harness() {
  const read = jest.fn<ReturnType<MatchResultRepository['read']>, Parameters<MatchResultRepository['read']>>();
  const submit = jest.fn<ReturnType<MatchResultRepository['submit']>, Parameters<MatchResultRepository['submit']>>();
  const confirm = jest.fn<ReturnType<MatchResultRepository['confirm']>, Parameters<MatchResultRepository['confirm']>>();
  const dispute = jest.fn<ReturnType<MatchResultRepository['dispute']>, Parameters<MatchResultRepository['dispute']>>();
  const run = jest.fn(async (operation: (transaction: PostgresTransaction) => Promise<unknown>) => operation(TRANSACTION));
  const service = new MatchResultService({
    transactions: {
      run: <T>(operation: (transaction: PostgresTransaction) => Promise<T>) => run(operation) as Promise<T>,
    },
    results: { read, submit, confirm, dispute },
    clock: { nowEpochSeconds: () => NOW },
  });
  return { service, read, submit, confirm, dispute };
}

describe('MatchResultService', () => {
  it('returns the current participant-only result without exposing storage fields', async () => {
    const subject = harness();
    subject.read.mockResolvedValue({
      outcome: 'found',
      result: {
        resultId: RESULT_ID,
        matchId: MATCH_ID,
        lineupVersion: 3,
        team1LeftAccountId: ACTOR_ID,
        team1RightAccountId: OTHER_ID,
        team2LeftAccountId: THIRD_ID,
        team2RightAccountId: FOURTH_ID,
        sets: [{ team1Games: 6, team2Games: 4 }, { team1Games: 6, team2Games: 3 }],
        winningTeam: 1,
        status: 'submitted',
        submittedByAccountId: ACTOR_ID,
        submittedAt: NOW,
        version: 1,
      },
    });

    await expect(subject.service.read({
      accountId: ACTOR_ID,
      role: 'player',
      matchId: MATCH_ID,
    })).resolves.toEqual({
      outcome: 'found',
      result: {
        resultId: RESULT_ID,
        matchId: MATCH_ID,
        lineupVersion: 3,
        teams: [[ACTOR_ID, OTHER_ID], [THIRD_ID, FOURTH_ID]],
        sets: [{ team1Games: 6, team2Games: 4 }, { team1Games: 6, team2Games: 3 }],
        winningTeam: 1,
        status: 'submitted',
        submittedByAccountId: ACTOR_ID,
        submittedAt: NOW,
        version: 1,
      },
    });
  });

  it('derives stable submit bindings while binding changed scores to a new digest', async () => {
    const subject = harness();
    subject.submit.mockImplementation(async (_transaction, input) => ({
      outcome: 'result_submitted',
      persistence: 'applied',
      result: {
        resultId: input.resultId,
        matchId: input.matchId,
        status: 'submitted',
        appliedAt: input.now,
        resultVersion: 1,
      },
    }));
    const base = {
      accountId: ACTOR_ID,
      role: 'player' as const,
      matchId: MATCH_ID,
      request: {
        requestKey: REQUEST_KEY,
        sets: [
          { team1Games: 6, team2Games: 4 },
          { team1Games: 6, team2Games: 3 },
        ],
      },
    };
    await subject.service.submit(base);
    await subject.service.submit(base);
    await subject.service.submit({
      ...base,
      request: {
        ...base.request,
        sets: [{ team1Games: 7, team2Games: 5 }, { team1Games: 6, team2Games: 2 }],
      },
    });

    expect(subject.submit.mock.calls[0][1]).toEqual(subject.submit.mock.calls[1][1]);
    expect(subject.submit.mock.calls[2][1].commandId).toBe(subject.submit.mock.calls[0][1].commandId);
    expect(subject.submit.mock.calls[2][1].resultId).toBe(subject.submit.mock.calls[0][1].resultId);
    expect(subject.submit.mock.calls[2][1].requestDigest).not.toBe(subject.submit.mock.calls[0][1].requestDigest);
  });

  it.each([
    [[{ team1Games: 6, team2Games: 4 }]],
    [[{ team1Games: 6, team2Games: 4 }, { team1Games: 4, team2Games: 6 }]],
    [[{ team1Games: 6, team2Games: 5 }, { team1Games: 6, team2Games: 4 }]],
    [[{ team1Games: 7, team2Games: 4 }, { team1Games: 6, team2Games: 4 }]],
  ])('rejects invalid best-of-three score %# before persistence', async (sets) => {
    const subject = harness();
    await expect(subject.service.submit({
      accountId: ACTOR_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY, sets },
    })).resolves.toEqual({ outcome: 'rejected', reason: 'invalid_request' });
    expect(subject.submit).not.toHaveBeenCalled();
  });

  it('uses separate confirm/dispute commands and rejects client-controlled identity', async () => {
    const subject = harness();
    subject.confirm.mockResolvedValue({
      outcome: 'result_confirmed',
      persistence: 'applied',
      result: { resultId: RESULT_ID, matchId: MATCH_ID, status: 'confirmed', appliedAt: NOW, resultVersion: 2 },
    });
    subject.dispute.mockResolvedValue({
      outcome: 'result_disputed',
      persistence: 'applied',
      result: { resultId: RESULT_ID, matchId: MATCH_ID, status: 'disputed', appliedAt: NOW, resultVersion: 2 },
    });
    const input = {
      accountId: ACTOR_ID,
      role: 'player' as const,
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY },
    };
    await subject.service.confirm(input);
    await subject.service.dispute(input);
    expect(subject.confirm.mock.calls[0][1].commandId).not.toBe(subject.dispute.mock.calls[0][1].commandId);
    await expect(subject.service.confirm({
      ...input,
      request: { requestKey: REQUEST_KEY, accountId: OTHER_ID } as never,
    })).resolves.toEqual({ outcome: 'rejected', reason: 'invalid_request' });
  });

  it('maps repository conflicts and denies club admin mutations', async () => {
    const subject = harness();
    subject.confirm.mockResolvedValue({ outcome: 'rejected', reason: 'command_reuse_conflict' });
    await expect(subject.service.confirm({
      accountId: ACTOR_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY },
    })).resolves.toEqual({ outcome: 'rejected', reason: 'request_conflict' });
    await expect(subject.service.dispute({
      accountId: ACTOR_ID,
      role: 'club_admin',
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY },
    })).resolves.toEqual({ outcome: 'rejected', reason: 'forbidden' });
  });
});
