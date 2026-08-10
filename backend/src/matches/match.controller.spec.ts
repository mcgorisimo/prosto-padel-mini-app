import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  SESSION_AUTHENTICATION_CLOCK,
  SessionBearerGuard,
} from '../auth/session-authentication.guard';
import { SessionAuthenticationService } from '../auth/session-authentication.service';
import { SessionAuthenticationResult } from '../auth/session-authentication.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { MatchApiService } from './match-api.service';
import {
  CreateMatchApiResult,
  ListMatchFeedApiResult,
  MutateMatchParticipationApiResult,
  ReadMatchDetailApiResult,
  UpdateMatchDescriptionApiResult,
} from './match-api.types';
import { MatchController } from './match.controller';
import { MatchId } from './match.types';

const CREDENTIAL = Buffer.alloc(32, 0x71).toString('base64url');
const ACCOUNT_ID = deterministicUuid(
  'match-controller-account',
) as AccountId;
const MATCH_ID = deterministicUuid(
  'match-controller-match',
) as MatchId;
const REQUEST_KEY = deterministicUuid('match-controller-request');
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_MATCH_CONTROLLER_PRIVATE';

function match() {
  return {
    matchId: MATCH_ID,
    ownerAccountId: ACCOUNT_ID,
    createdAt: NOW,
    updatedAt: NOW,
    startsAt: unixEpochSeconds(NOW + 3_600),
    durationMinutes: 90 as const,
    courtId: 'court-1',
    courtName: 'Court 1',
    courtType: 'indoor',
    kind: 'match' as const,
    visibility: 'public' as const,
    scenario: 'social' as const,
    status: 'open' as const,
    description: '',
    ratingMin: 2,
    ratingMax: 4,
    isRatingMatch: true,
    version: 1,
    courtBookingStatus: 'unbooked' as const,
    courtBookingStale: false as const,
    owner: {
      playerId: ACCOUNT_ID,
      firstName: 'Synthetic',
      rating: 3,
      isVerified: false,
    },
    participants: [],
  };
}

interface Harness {
  readonly app: NestFastifyApplication;
  readonly create: jest.Mock<Promise<CreateMatchApiResult>, [unknown]>;
  readonly list: jest.Mock<Promise<ListMatchFeedApiResult>, [unknown]>;
  readonly listMine: jest.Mock<
    Promise<ListMatchFeedApiResult>,
    [unknown]
  >;
  readonly detail: jest.Mock<Promise<ReadMatchDetailApiResult>, [unknown]>;
  readonly join: jest.Mock<
    Promise<MutateMatchParticipationApiResult>,
    [unknown]
  >;
  readonly leave: jest.Mock<
    Promise<MutateMatchParticipationApiResult>,
    [unknown]
  >;
  readonly updateDescription: jest.Mock<
    Promise<UpdateMatchDescriptionApiResult>,
    [unknown]
  >;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [unknown]
  >;
  readonly logs: readonly unknown[][];
}

function captureLogger(logs: unknown[][]) {
  const capture = (...values: unknown[]): void => {
    logs.push(values);
  };
  return {
    log: capture,
    error: capture,
    warn: capture,
    debug: capture,
    verbose: capture,
    fatal: capture,
  };
}

async function createHarness(): Promise<Harness> {
  const create = jest.fn<
    Promise<CreateMatchApiResult>,
    [unknown]
  >().mockResolvedValue({
    outcome: 'created',
    match: match(),
  });
  const list = jest.fn<
    Promise<ListMatchFeedApiResult>,
    [unknown]
  >().mockResolvedValue({
    outcome: 'found',
    matches: [],
  });
  const listMine = jest.fn<
    Promise<ListMatchFeedApiResult>,
    [unknown]
  >().mockResolvedValue({
    outcome: 'found',
    matches: [{ ...match(), occupiedSlots: 1 }],
  });
  const detail = jest.fn<
    Promise<ReadMatchDetailApiResult>,
    [unknown]
  >().mockResolvedValue({
    outcome: 'found',
    match: match(),
  });
  const join = jest.fn<
    Promise<MutateMatchParticipationApiResult>,
    [unknown]
  >().mockResolvedValue({
    outcome: 'updated',
    participant: {
      matchId: MATCH_ID,
      playerId: ACCOUNT_ID,
      slotNumber: 2,
      status: 'active',
      matchVersion: 2,
    },
  });
  const leave = jest.fn<
    Promise<MutateMatchParticipationApiResult>,
    [unknown]
  >().mockResolvedValue({
    outcome: 'updated',
    participant: {
      matchId: MATCH_ID,
      playerId: ACCOUNT_ID,
      slotNumber: 2,
      status: 'left',
      matchVersion: 3,
    },
  });
  const updateDescription = jest.fn<
    Promise<UpdateMatchDescriptionApiResult>,
    [unknown]
  >().mockResolvedValue({
    outcome: 'updated',
    match: {
      matchId: MATCH_ID,
      description: 'Updated match comment',
      matchVersion: 2,
    },
  });
  const authenticate = jest
    .fn<Promise<SessionAuthenticationResult>, [unknown]>()
    .mockResolvedValue({
      outcome: 'authenticated',
      principal: {
        accountId: ACCOUNT_ID,
        role: 'player',
        expiresAt: unixEpochSeconds(NOW + 3_600),
      },
    });
  const moduleRef = await Test.createTestingModule({
    controllers: [MatchController],
    providers: [
      SessionBearerGuard,
      {
        provide: MatchApiService,
        useValue: {
          create,
          list,
          listMine,
          detail,
          join,
          leave,
          updateDescription,
        },
      },
      {
        provide: SessionAuthenticationService,
        useValue: { authenticate },
      },
      {
        provide: SESSION_AUTHENTICATION_CLOCK,
        useValue: { nowEpochSeconds: () => NOW },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  const logs: unknown[][] = [];
  app.useLogger(captureLogger(logs));
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return {
    app,
    create,
    list,
    listMine,
    detail,
    join,
    leave,
    updateDescription,
    authenticate,
    logs,
  };
}

function headers(authorization = `Bearer ${CREDENTIAL}`) {
  return {
    authorization,
    'content-type': 'application/json',
  };
}

function expectNoStore(response: {
  readonly headers: Record<
    string,
    string | string[] | number | undefined
  >;
}): void {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers.pragma).toBe('no-cache');
}

describe('MatchController HTTP boundary', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
    jest.restoreAllMocks();
  });

  it('exposes create/feed/account-feed/detail/update/join/leave behind the same bearer boundary', async () => {
    const createResponse = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/matches',
      headers: headers(),
      payload: {
        requestKey: REQUEST_KEY,
        startsAt: NOW + 3_600,
        durationMinutes: 90,
        courtId: 'p1',
        scenario: 'social',
        description: '',
        ratingMin: 2,
        ratingMax: 4,
        isRatingMatch: true,
      },
    });
    const feedResponse = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/matches?limit=10',
      headers: { authorization: `Bearer ${CREDENTIAL}` },
    });
    const accountFeedResponse = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/matches/mine?limit=50',
      headers: { authorization: `Bearer ${CREDENTIAL}` },
    });
    const detailResponse = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/matches/${MATCH_ID}`,
      headers: { authorization: `Bearer ${CREDENTIAL}` },
    });
    const joinResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/matches/${MATCH_ID}/join`,
      headers: headers(),
      payload: { requestKey: REQUEST_KEY },
    });
    const updateResponse = await harness.app.inject({
      method: 'PATCH',
      url: `/api/v1/matches/${MATCH_ID}`,
      headers: headers(),
      payload: {
        requestKey: REQUEST_KEY,
        description: 'Updated match comment',
      },
    });
    const leaveResponse = await harness.app.inject({
      method: 'POST',
      url: `/api/v1/matches/${MATCH_ID}/leave`,
      headers: headers(),
      payload: { requestKey: REQUEST_KEY },
    });

    expect(createResponse.statusCode).toBe(201);
    expect({
      statusCode: feedResponse.statusCode,
      body: feedResponse.json(),
    }).toEqual({ statusCode: 200, body: { matches: [] } });
    expect({
      statusCode: accountFeedResponse.statusCode,
      body: accountFeedResponse.json(),
    }).toEqual({
      statusCode: 200,
      body: { matches: [{ ...match(), occupiedSlots: 1 }] },
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(updateResponse.statusCode).toBe(200);
    expect(joinResponse.statusCode).toBe(200);
    expect(leaveResponse.statusCode).toBe(200);
    for (const response of [
      createResponse,
      feedResponse,
      accountFeedResponse,
      detailResponse,
      updateResponse,
      joinResponse,
      leaveResponse,
    ]) {
      expectNoStore(response);
      expect(JSON.stringify(response.json())).not.toContain(CREDENTIAL);
    }
    expect(harness.create).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        role: 'player',
        request: expect.objectContaining({ requestKey: REQUEST_KEY }),
      }),
    );
    expect(harness.list).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      request: { limit: 10 },
    });
    expect(harness.listMine).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      request: { limit: 50 },
    });
    expect(harness.detail).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      matchId: MATCH_ID,
    });
    expect(harness.updateDescription).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      matchId: MATCH_ID,
      request: {
        requestKey: REQUEST_KEY,
        description: 'Updated match comment',
      },
    });
    expect(harness.join).toHaveBeenCalledTimes(1);
    expect(harness.leave).toHaveBeenCalledTimes(1);
    expect(harness.authenticate).toHaveBeenCalledTimes(7);
  });

  it.each([
    undefined,
    CREDENTIAL,
    `bearer ${CREDENTIAL}`,
    'Bearer not-canonical',
  ])('rejects a non-canonical bearer without reaching the service', async (authorization) => {
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/matches',
      headers:
        authorization === undefined ? {} : { authorization },
    });

    expect(response.statusCode).toBe(401);
    expectNoStore(response);
    expect(response.json()).toMatchObject({ code: 'session_invalid' });
    expect(harness.list).not.toHaveBeenCalled();
  });

  it('rejects unknown body/query/path fields before service calls', async () => {
    const invalidCreate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/matches',
      headers: headers(),
      payload: {
        requestKey: REQUEST_KEY,
        startsAt: NOW + 3_600,
        durationMinutes: 90,
        courtId: 'p1',
        courtName: 'Forged court',
        scenario: 'social',
        description: '',
        ratingMin: 2,
        ratingMax: 4,
        isRatingMatch: true,
      },
    });
    const invalidFeed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/matches?cursor=secret',
      headers: { authorization: `Bearer ${CREDENTIAL}` },
    });
    const retiredTitleCreate = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/matches',
      headers: headers(),
      payload: {
        requestKey: REQUEST_KEY,
        startsAt: NOW + 3_600,
        durationMinutes: 90,
        courtId: 'p1',
        scenario: 'social',
        title: 'Retired title',
        description: '',
        ratingMin: 2,
        ratingMax: 4,
        isRatingMatch: true,
      },
    });
    const invalidAccountFeed = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/matches/mine?accountId=forged',
      headers: { authorization: `Bearer ${CREDENTIAL}` },
    });
    const invalidJoin = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/matches/not-a-uuid/join',
      headers: headers(),
      payload: { requestKey: REQUEST_KEY, participantId: MATCH_ID },
    });

    for (const response of [
      invalidCreate,
      retiredTitleCreate,
      invalidFeed,
      invalidAccountFeed,
      invalidJoin,
    ]) {
      expect(response.statusCode).toBe(400);
      expectNoStore(response);
      expect(response.json()).toMatchObject({
        code: 'match_invalid_request',
      });
    }
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.list).not.toHaveBeenCalled();
    expect(harness.listMine).not.toHaveBeenCalled();
    expect(harness.join).not.toHaveBeenCalled();
  });

  it.each([
    ['match_not_found', 404, 'match_not_found'],
    [
      'rating_verification_required',
      403,
      'match_rating_verification_required',
    ],
    ['rating_out_of_range', 409, 'match_rating_out_of_range'],
    ['request_conflict', 409, 'match_request_conflict'],
    ['temporary_unavailable', 503, 'match_service_unavailable'],
    ['internal_failure', 500, 'match_internal_error'],
  ] as const)('maps %s to a fixed public error', async (reason, status, code) => {
    harness.detail.mockResolvedValue({ outcome: 'rejected', reason });
    const response = await harness.app.inject({
      method: 'GET',
      url: `/api/v1/matches/${MATCH_ID}`,
      headers: { authorization: `Bearer ${CREDENTIAL}` },
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ statusCode: status, code });
    const observed = JSON.stringify({
      body: response.json(),
      logs: harness.logs,
    });
    expect(observed).not.toContain(CREDENTIAL);
    expect(observed).not.toContain(PRIVATE_MARKER);
    expect(observed).not.toContain('requestDigest');
  });

  it('hides thrown service details behind the fixed internal error', async () => {
    harness.list.mockRejectedValue(
      new Error(`${PRIVATE_MARKER}:${CREDENTIAL}`),
    );
    const response = await harness.app.inject({
      method: 'GET',
      url: '/api/v1/matches',
      headers: { authorization: `Bearer ${CREDENTIAL}` },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      code: 'match_internal_error',
    });
    expect(JSON.stringify(response.json())).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(response.json())).not.toContain(CREDENTIAL);
  });

  it('maps disallowed match text to a safe no-store 422 response', async () => {
    harness.create.mockResolvedValueOnce({
      outcome: 'rejected',
      reason: 'content_not_allowed',
    });
    const privateText = `${PRIVATE_MARKER} forbidden`;

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/v1/matches',
      headers: headers(),
      payload: {
        requestKey: REQUEST_KEY,
        startsAt: NOW + 3_600,
        durationMinutes: 90,
        courtId: 'p1',
        scenario: 'social',
        description: privateText,
        ratingMin: 2,
        ratingMax: 4,
        isRatingMatch: true,
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      statusCode: 422,
      code: 'match_content_not_allowed',
      message: 'Match comment contains disallowed language',
    });
    expectNoStore(response);
    expect(response.body).not.toContain(privateText);
    expect(JSON.stringify(harness.logs)).not.toContain(privateText);
  });
});
