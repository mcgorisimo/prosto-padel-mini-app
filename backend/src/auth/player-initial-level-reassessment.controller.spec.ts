import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import { PlayerInitialLevelReassessmentController } from './player-initial-level-reassessment.controller';
import { PlayerInitialLevelReassessmentService } from './player-initial-level-reassessment.service';
import {
  CompleteOwnPlayerInitialLevelReassessmentInput,
  CompleteOwnPlayerInitialLevelReassessmentResult,
  ReadOwnPlayerInitialLevelReassessmentInput,
  ReadOwnPlayerInitialLevelReassessmentResult,
} from './player-initial-level-reassessment.types';
import {
  SESSION_AUTHENTICATION_CLOCK,
  SessionAuthenticationClock,
  SessionBearerGuard,
} from './session-authentication.guard';
import { SessionAuthenticationService } from './session-authentication.service';
import {
  SessionAuthenticationInput,
  SessionAuthenticationResult,
} from './session-authentication.types';

const ROUTE = '/api/v1/onboarding/me/initial-level-reassessment';
const CREDENTIAL = Buffer.alloc(32, 0x73).toString('base64url');
const ACCOUNT_ID = deterministicUuid(
  'player-initial-level-reassessment-controller',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-initial-level-reassessment-controller-other',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);
const PRIVATE_MARKER = 'SYNTHETIC_REASSESSMENT_HTTP_PRIVATE';
const ANSWERS = Object.freeze({
  match_count: 'thirty_one_to_ninety_nine',
  rally_stability: 'steady_under_pressure',
  glass_play: 'confident_returns',
  serve_return_net: 'confident_patterns',
  match_experience_year: 'league_or_club',
});

interface Harness {
  readonly app: NestFastifyApplication;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [SessionAuthenticationInput]
  >;
  readonly readOwnReassessment: jest.Mock<
    Promise<ReadOwnPlayerInitialLevelReassessmentResult>,
    [ReadOwnPlayerInitialLevelReassessmentInput]
  >;
  readonly completeOwnReassessment: jest.Mock<
    Promise<CompleteOwnPlayerInitialLevelReassessmentResult>,
    [CompleteOwnPlayerInitialLevelReassessmentInput]
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

function requiredResult(): Extract<
  ReadOwnPlayerInitialLevelReassessmentResult,
  { readonly outcome: 'found' }
> {
  return {
    outcome: 'found',
    reassessment: {
      status: 'required',
      source: {
        flowVersion: 'tma_v1',
        surveyVersion: 'initial_level_v1',
        revision: 4,
      },
      surveyVersion: 'initial_level_v2',
    },
  };
}

function completedResult(): Extract<
  CompleteOwnPlayerInitialLevelReassessmentResult,
  { readonly outcome: 'completed' }
> {
  return {
    outcome: 'completed',
    reassessment: {
      status: 'completed',
      surveyVersion: 'initial_level_v2',
      initialLevelLabel: 'B+',
    },
  };
}

function completionBody() {
  return {
    source: {
      flowVersion: 'tma_v1',
      surveyVersion: 'initial_level_v1',
      revision: 4,
    },
    survey: { version: 'initial_level_v2', answers: ANSWERS },
  };
}

async function createHarness(): Promise<Harness> {
  const authenticate = jest
    .fn<Promise<SessionAuthenticationResult>, [SessionAuthenticationInput]>()
    .mockResolvedValue({
      outcome: 'authenticated',
      principal: {
        accountId: ACCOUNT_ID,
        role: 'player',
        expiresAt: EXPIRES_AT,
      },
    });
  const readOwnReassessment = jest
    .fn<
      Promise<ReadOwnPlayerInitialLevelReassessmentResult>,
      [ReadOwnPlayerInitialLevelReassessmentInput]
    >()
    .mockResolvedValue(requiredResult());
  const completeOwnReassessment = jest
    .fn<
      Promise<CompleteOwnPlayerInitialLevelReassessmentResult>,
      [CompleteOwnPlayerInitialLevelReassessmentInput]
    >()
    .mockResolvedValue(completedResult());
  const nowEpochSeconds = jest.fn<
    ReturnType<SessionAuthenticationClock['nowEpochSeconds']>,
    []
  >(() => NOW);
  const moduleRef = await Test.createTestingModule({
    controllers: [PlayerInitialLevelReassessmentController],
    providers: [
      SessionBearerGuard,
      {
        provide: SessionAuthenticationService,
        useValue: { authenticate },
      },
      {
        provide: PlayerInitialLevelReassessmentService,
        useValue: { readOwnReassessment, completeOwnReassessment },
      },
      {
        provide: SESSION_AUTHENTICATION_CLOCK,
        useValue: { nowEpochSeconds },
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
    authenticate,
    readOwnReassessment,
    completeOwnReassessment,
    logs,
  };
}

function expectNoStore(headers: Record<string, unknown>): void {
  expect(headers['cache-control']).toBe('no-store');
  expect(headers.pragma).toBe('no-cache');
}

describe('PlayerInitialLevelReassessmentController', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
  });

  it('requires the existing bearer auth for GET and POST', async () => {
    for (const request of [
      harness.app.inject({ method: 'GET', url: ROUTE }),
      harness.app.inject({
        method: 'POST',
        url: `${ROUTE}/complete`,
        payload: completionBody(),
      }),
    ]) {
      const response = await request;
      expect(response.statusCode).toBe(401);
      expectNoStore(response.headers);
    }
    expect(harness.readOwnReassessment).not.toHaveBeenCalled();
    expect(harness.completeOwnReassessment).not.toHaveBeenCalled();
  });

  it('reads only the authenticated owner reassessment state', async () => {
    const response = await harness.app.inject({
      method: 'GET',
      url: ROUTE,
      headers: { authorization: `Bearer ${CREDENTIAL}` },
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response.headers);
    expect(response.json()).toEqual(requiredResult().reassessment);
    expect(harness.readOwnReassessment).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
    });
    expect(JSON.stringify(response.json())).not.toContain(OTHER_ACCOUNT_ID);
  });

  it('completes with option IDs and returns only the server-computed label', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${ROUTE}/complete`,
      headers: { authorization: `Bearer ${CREDENTIAL}` },
      payload: completionBody(),
    });

    expect(response.statusCode).toBe(200);
    expectNoStore(response.headers);
    expect(response.json()).toEqual(completedResult().reassessment);
    expect(response.body).not.toContain('score');
    expect(response.body).not.toContain('formula');
    expect(harness.completeOwnReassessment).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      completion: completionBody(),
    });
  });

  it('rejects missing answers and extra fields before the service', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${ROUTE}/complete`,
      headers: { authorization: `Bearer ${CREDENTIAL}` },
      payload: {
        ...completionBody(),
        survey: {
          version: 'initial_level_v2',
          answers: { match_count: 'none' },
        },
        extra: true,
      },
    });
    expect(response.statusCode).toBe(400);
    expectNoStore(response.headers);
    expect(harness.completeOwnReassessment).not.toHaveBeenCalled();
  });

  it.each([
    ['reassessment_not_eligible', 'initial_level_reassessment_not_eligible'],
    [
      'reassessment_source_conflict',
      'initial_level_reassessment_source_conflict',
    ],
    ['reassessment_conflict', 'initial_level_reassessment_conflict'],
  ] as const)('maps %s to a PII-safe 409', async (reason, code) => {
    harness.completeOwnReassessment.mockResolvedValueOnce({
      outcome: 'rejected',
      reason,
    });
    const response = await harness.app.inject({
      method: 'POST',
      url: `${ROUTE}/complete`,
      headers: { authorization: `Bearer ${CREDENTIAL}` },
      payload: completionBody(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code });
    expect(response.body).not.toContain(PRIVATE_MARKER);
  });

  it('does not log request bodies, credentials, identifiers, or PII on failure', async () => {
    harness.completeOwnReassessment.mockRejectedValueOnce(
      new Error(`${PRIVATE_MARKER}:${ACCOUNT_ID}:private@example.test`),
    );
    const response = await harness.app.inject({
      method: 'POST',
      url: `${ROUTE}/complete`,
      headers: { authorization: `Bearer ${CREDENTIAL}` },
      payload: completionBody(),
    });
    expect(response.statusCode).toBe(500);
    const serializedLogs = JSON.stringify(harness.logs);
    for (const forbidden of [
      PRIVATE_MARKER,
      ACCOUNT_ID,
      CREDENTIAL,
      'private@example.test',
      'match_count',
    ]) {
      expect(serializedLogs).not.toContain(forbidden);
    }
  });
});
