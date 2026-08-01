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
  MutateMatchLineupApiResult,
  ReadMatchLineupApiResult,
} from './match-lineup-api.types';
import { MatchLineupController } from './match-lineup.controller';
import { MatchLineupService } from './match-lineup.service';
import { MatchLineupAssignmentId } from './match-lineup.types';
import { MatchId } from './match.types';

const CREDENTIAL = Buffer.alloc(32, 0x77).toString('base64url');
const ACCOUNT_ID = deterministicUuid('lineup-controller-account') as AccountId;
const MATCH_ID = deterministicUuid('lineup-controller-match') as MatchId;
const ASSIGNMENT_ID = deterministicUuid('lineup-controller-assignment') as MatchLineupAssignmentId;
const REQUEST_KEY = deterministicUuid('lineup-controller-request');
const NOW = unixEpochSeconds(1_800_000_000);

interface Harness {
  readonly app: NestFastifyApplication;
  readonly read: jest.Mock<Promise<ReadMatchLineupApiResult>, [unknown]>;
  readonly assign: jest.Mock<Promise<MutateMatchLineupApiResult>, [unknown]>;
  readonly release: jest.Mock<Promise<MutateMatchLineupApiResult>, [unknown]>;
}

async function harness(): Promise<Harness> {
  const read = jest.fn<Promise<ReadMatchLineupApiResult>, [unknown]>().mockResolvedValue({
    outcome: 'found',
    lineup: {
      matchId: MATCH_ID,
      status: 'draft',
      version: 1,
      slots: [
        { teamNumber: 1, courtSide: 'left' },
        { teamNumber: 1, courtSide: 'right' },
        { teamNumber: 2, courtSide: 'left' },
        { teamNumber: 2, courtSide: 'right' },
      ],
      unassignedPlayers: [],
    },
  });
  const mutation = {
    outcome: 'lineup_slot_claimed' as const,
    assignment: {
      assignmentId: ASSIGNMENT_ID,
      matchId: MATCH_ID,
      accountId: ACCOUNT_ID,
      teamNumber: 1 as const,
      courtSide: 'left' as const,
      appliedAt: NOW,
      lineupVersion: 2,
    },
  };
  const assign = jest.fn<Promise<MutateMatchLineupApiResult>, [unknown]>().mockResolvedValue(mutation);
  const release = jest.fn<Promise<MutateMatchLineupApiResult>, [unknown]>().mockResolvedValue({
    ...mutation,
    outcome: 'lineup_slot_released',
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
    controllers: [MatchLineupController],
    providers: [
      SessionBearerGuard,
      { provide: MatchLineupService, useValue: { read, assign, release } },
      { provide: SessionAuthenticationService, useValue: { authenticate } },
      { provide: SESSION_AUTHENTICATION_CLOCK, useValue: { nowEpochSeconds: () => NOW } },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useLogger(false);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, read, assign, release };
}

function headers() {
  return { authorization: `Bearer ${CREDENTIAL}` };
}

describe('MatchLineupController', () => {
  let test: Harness;
  beforeEach(async () => { test = await harness(); });
  afterEach(async () => { await test.app.close(); });

  it('serves bearer-protected read/assign/release contracts with no-store headers', async () => {
    const read = await test.app.inject({
      method: 'GET',
      url: `/matches/${MATCH_ID}/lineup`,
      headers: headers(),
    });
    const assigned = await test.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/lineup/assign`,
      headers: headers(),
      payload: { requestKey: REQUEST_KEY, teamNumber: 1, courtSide: 'left' },
    });
    const released = await test.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/lineup/release`,
      headers: headers(),
      payload: { requestKey: REQUEST_KEY },
    });
    expect(read.statusCode).toBe(200);
    expect(assigned.statusCode).toBe(201);
    expect(released.statusCode).toBe(201);
    for (const response of [read, assigned, released]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
    }
    expect(test.assign).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: { requestKey: REQUEST_KEY, teamNumber: 1, courtSide: 'left' },
    });
    expect(JSON.stringify(assigned.json())).not.toContain('credential');
  });

  it('rejects missing bearer and client-controlled identity before the service', async () => {
    const missing = await test.app.inject({
      method: 'GET',
      url: `/matches/${MATCH_ID}/lineup`,
    });
    const malformed = await test.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/lineup/assign`,
      headers: headers(),
      payload: {
        requestKey: REQUEST_KEY,
        teamNumber: 1,
        courtSide: 'left',
        accountId: ACCOUNT_ID,
      },
    });
    expect(missing.statusCode).toBe(401);
    expect(malformed.statusCode).toBe(400);
    expect(test.assign).not.toHaveBeenCalled();
  });

  it('maps occupied cells to a stable conflict without swap semantics', async () => {
    test.assign.mockResolvedValue({ outcome: 'rejected', reason: 'slot_occupied' });
    const response = await test.app.inject({
      method: 'POST',
      url: `/matches/${MATCH_ID}/lineup/assign`,
      headers: headers(),
      payload: { requestKey: REQUEST_KEY, teamNumber: 2, courtSide: 'right' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      statusCode: 409,
      code: 'match_lineup_slot_occupied',
      message: 'Match lineup slot is occupied',
    });
  });
});
