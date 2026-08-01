import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  SESSION_AUTHENTICATION_CLOCK,
  SessionBearerGuard,
} from '../auth/session-authentication.guard';
import { SessionAuthenticationService } from '../auth/session-authentication.service';
import { SessionAuthenticationResult } from '../auth/session-authentication.types';
import {
  MutateMatchResultApiResult,
  ReadMatchResultApiResult,
} from './match-result-api.types';
import { MatchResultController } from './match-result.controller';
import { MatchResultService } from './match-result.service';
import { MatchResultId } from './match-result.types';
import { MatchId } from './match.types';

const CREDENTIAL = Buffer.alloc(32, 0x78).toString('base64url');
const ACCOUNT_ID = deterministicUuid('result-controller-account') as AccountId;
const OTHER_ID = deterministicUuid('result-controller-other') as AccountId;
const THIRD_ID = deterministicUuid('result-controller-third') as AccountId;
const FOURTH_ID = deterministicUuid('result-controller-fourth') as AccountId;
const MATCH_ID = deterministicUuid('result-controller-match') as MatchId;
const RESULT_ID = deterministicUuid('result-controller-result') as MatchResultId;
const REQUEST_KEY = deterministicUuid('result-controller-request');
const NOW = unixEpochSeconds(1_800_000_000);

interface Harness {
  readonly app: NestFastifyApplication;
  readonly read: jest.Mock<Promise<ReadMatchResultApiResult>, [unknown]>;
  readonly submit: jest.Mock<Promise<MutateMatchResultApiResult>, [unknown]>;
  readonly confirm: jest.Mock<Promise<MutateMatchResultApiResult>, [unknown]>;
  readonly dispute: jest.Mock<Promise<MutateMatchResultApiResult>, [unknown]>;
}

async function harness(): Promise<Harness> {
  const response = {
    resultId: RESULT_ID,
    matchId: MATCH_ID,
    lineupVersion: 4,
    teams: [[ACCOUNT_ID, OTHER_ID], [THIRD_ID, FOURTH_ID]] as const,
    sets: [{ team1Games: 6, team2Games: 4 }, { team1Games: 6, team2Games: 3 }],
    winningTeam: 1 as const,
    status: 'submitted' as const,
    submittedByAccountId: ACCOUNT_ID,
    submittedAt: NOW,
    version: 1,
  };
  const read = jest.fn<Promise<ReadMatchResultApiResult>, [unknown]>().mockResolvedValue({
    outcome: 'found',
    result: response,
  });
  const mutation = {
    resultId: RESULT_ID,
    matchId: MATCH_ID,
    status: 'submitted' as const,
    appliedAt: NOW,
    resultVersion: 1,
  };
  const submit = jest.fn<Promise<MutateMatchResultApiResult>, [unknown]>().mockResolvedValue({
    outcome: 'result_submitted',
    result: mutation,
  });
  const confirm = jest.fn<Promise<MutateMatchResultApiResult>, [unknown]>().mockResolvedValue({
    outcome: 'result_confirmed',
    result: { ...mutation, status: 'confirmed', resultVersion: 2 },
  });
  const dispute = jest.fn<Promise<MutateMatchResultApiResult>, [unknown]>().mockResolvedValue({
    outcome: 'result_disputed',
    result: { ...mutation, status: 'disputed', resultVersion: 2 },
  });
  const authenticate = jest.fn<Promise<SessionAuthenticationResult>, [unknown]>().mockResolvedValue({
    outcome: 'authenticated',
    principal: {
      accountId: ACCOUNT_ID,
      role: 'player',
      expiresAt: unixEpochSeconds(Number(NOW) + 3_600),
    },
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [MatchResultController],
    providers: [
      SessionBearerGuard,
      { provide: MatchResultService, useValue: { read, submit, confirm, dispute } },
      { provide: SessionAuthenticationService, useValue: { authenticate } },
      { provide: SESSION_AUTHENTICATION_CLOCK, useValue: { nowEpochSeconds: () => NOW } },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useLogger(false);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, read, submit, confirm, dispute };
}

function headers() {
  return { authorization: `Bearer ${CREDENTIAL}` };
}

describe('MatchResultController', () => {
  let test: Harness;
  beforeEach(async () => { test = await harness(); });
  afterEach(async () => { await test.app.close(); });

  it('serves bearer-protected read/submit/confirm/dispute contracts with no-store', async () => {
    const responses = await Promise.all([
      test.app.inject({ method: 'GET', url: `/matches/${MATCH_ID}/result`, headers: headers() }),
      test.app.inject({
        method: 'POST',
        url: `/matches/${MATCH_ID}/result/submit`,
        headers: headers(),
        payload: {
          requestKey: REQUEST_KEY,
          sets: [{ team1Games: 6, team2Games: 4 }, { team1Games: 6, team2Games: 3 }],
        },
      }),
      test.app.inject({
        method: 'POST',
        url: `/matches/${MATCH_ID}/result/confirm`,
        headers: headers(),
        payload: { requestKey: REQUEST_KEY },
      }),
      test.app.inject({
        method: 'POST',
        url: `/matches/${MATCH_ID}/result/dispute`,
        headers: headers(),
        payload: { requestKey: REQUEST_KEY },
      }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 201, 201, 201]);
    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
      expect(JSON.stringify(response.json())).not.toContain('credential');
    }
    expect(test.submit).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: {
        requestKey: REQUEST_KEY,
        sets: [{ team1Games: 6, team2Games: 4 }, { team1Games: 6, team2Games: 3 }],
      },
    });
  });

  it('rejects missing bearer and client-controlled identity before the service', async () => {
    const missing = await test.app.inject({
      method: 'GET',
      url: `/matches/${MATCH_ID}/result`,
    });
    const malformed = await test.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/result/confirm`,
      headers: headers(),
      payload: { requestKey: REQUEST_KEY, accountId: ACCOUNT_ID },
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.headers['cache-control']).toBe('no-store');
    expect(malformed.statusCode).toBe(400);
    expect(test.confirm).not.toHaveBeenCalled();
  });

  it('maps domain rejections to stable public errors', async () => {
    test.confirm.mockResolvedValue({ outcome: 'rejected', reason: 'same_team_confirmation' });
    const response = await test.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/result/confirm`,
      headers: headers(),
      payload: { requestKey: REQUEST_KEY },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'match_result_opponent_confirmation_required' });
  });
});
