import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
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
  ListMatchWaitlistApiResult,
  MutateMatchWaitlistApiResult,
} from './match-waitlist-api.types';
import { MatchWaitlistController } from './match-waitlist.controller';
import { MatchWaitlistService } from './match-waitlist.service';
import { MatchWaitlistEntryId } from './match-waitlist.types';
import { MatchId } from './match.types';

const CREDENTIAL = Buffer.alloc(32, 0x77).toString('base64url');
const ACCOUNT_ID = deterministicUuid('waitlist-controller-account') as AccountId;
const MATCH_ID = deterministicUuid('waitlist-controller-match') as MatchId;
const ENTRY_ID = deterministicUuid('waitlist-controller-entry') as MatchWaitlistEntryId;
const REQUEST_KEY = deterministicUuid('waitlist-controller-request');
const NOW = unixEpochSeconds(1_800_000_000);

interface Harness {
  readonly app: NestFastifyApplication;
  readonly list: jest.Mock<Promise<ListMatchWaitlistApiResult>, [unknown]>;
  readonly join: jest.Mock<Promise<MutateMatchWaitlistApiResult>, [unknown]>;
  readonly leave: jest.Mock<Promise<MutateMatchWaitlistApiResult>, [unknown]>;
}

async function harness(): Promise<Harness> {
  const list = jest.fn<Promise<ListMatchWaitlistApiResult>, [unknown]>().mockResolvedValue({
    outcome: 'found',
    entries: [{
      entryId: ENTRY_ID,
      player: { playerId: ACCOUNT_ID, firstName: 'Player', rating: 3, isVerified: true },
      queuePosition: 1,
      joinedAt: NOW,
      isCurrentPlayer: true,
    }],
    count: 1,
  });
  const mutation = {
    outcome: 'waitlist_joined' as const,
    entry: { entryId: ENTRY_ID, matchId: MATCH_ID, status: 'waiting' as const, appliedAt: NOW, version: 1 as const },
  };
  const join = jest.fn<Promise<MutateMatchWaitlistApiResult>, [unknown]>().mockResolvedValue(mutation);
  const leave = jest.fn<Promise<MutateMatchWaitlistApiResult>, [unknown]>().mockResolvedValue({
    outcome: 'waitlist_left',
    entry: { ...mutation.entry, status: 'left', version: 2 },
  });
  const authenticate = jest.fn<Promise<SessionAuthenticationResult>, [unknown]>().mockResolvedValue({
    outcome: 'authenticated',
    principal: { accountId: ACCOUNT_ID, role: 'player', expiresAt: unixEpochSeconds(Number(NOW) + 3_600) },
  });
  const moduleRef = await Test.createTestingModule({
    controllers: [MatchWaitlistController],
    providers: [
      SessionBearerGuard,
      { provide: MatchWaitlistService, useValue: { list, join, leave } },
      { provide: SessionAuthenticationService, useValue: { authenticate } },
      { provide: SESSION_AUTHENTICATION_CLOCK, useValue: { nowEpochSeconds: () => NOW } },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useLogger(false);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, list, join, leave };
}

function headers() {
  return { authorization: `Bearer ${CREDENTIAL}` };
}

describe('MatchWaitlistController', () => {
  let test: Harness;
  beforeEach(async () => { test = await harness(); });
  afterEach(async () => { await test.app.close(); });

  it('serves bearer-protected list/join/leave contracts with no-store headers', async () => {
    const listed = await test.app.inject({ method: 'GET', url: `/matches/${MATCH_ID}/waitlist?limit=20`, headers: headers() });
    const joined = await test.app.inject({ method: 'POST', url: `/matches/${MATCH_ID}/waitlist/join`, headers: headers(), payload: { requestKey: REQUEST_KEY } });
    const left = await test.app.inject({ method: 'POST', url: `/matches/${MATCH_ID}/waitlist/leave`, headers: headers(), payload: { requestKey: REQUEST_KEY } });
    expect(listed.statusCode).toBe(200);
    expect(joined.statusCode).toBe(201);
    expect(left.statusCode).toBe(201);
    for (const response of [listed, joined, left]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
    }
    expect(test.list).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, role: 'player', matchId: MATCH_ID, request: { limit: 20 } });
    expect(test.join).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, role: 'player', matchId: MATCH_ID, request: { requestKey: REQUEST_KEY } });
    expect(JSON.stringify(joined.json())).not.toContain('credential');
  });

  it('rejects missing/unknown bearers before the service and malformed public input safely', async () => {
    const missing = await test.app.inject({ method: 'GET', url: `/matches/${MATCH_ID}/waitlist` });
    const malformed = await test.app.inject({ method: 'POST', url: `/matches/${MATCH_ID}/waitlist/join`, headers: headers(), payload: { requestKey: 'bad', extra: true } });
    expect(missing.statusCode).toBe(401);
    expect(malformed.statusCode).toBe(400);
    expect(test.join).not.toHaveBeenCalled();
  });

  it('maps domain conflicts to stable public errors', async () => {
    test.join.mockResolvedValue({ outcome: 'rejected', reason: 'match_not_full' });
    const response = await test.app.inject({ method: 'POST', url: `/matches/${MATCH_ID}/waitlist/join`, headers: headers(), payload: { requestKey: REQUEST_KEY } });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      statusCode: 409,
      code: 'match_waitlist_not_full',
      message: 'Match still has an available slot',
    });
  });
});
