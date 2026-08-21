import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import { PlayerOnboardingController } from './player-onboarding.controller';
import { PlayerOnboardingService } from './player-onboarding.service';
import {
  OwnPlayerOnboarding,
  ReadOwnPlayerOnboardingResult,
} from './player-onboarding.types';
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

const ROUTE = '/api/v1/onboarding/me';
const CREDENTIAL = Buffer.alloc(32, 0x62).toString('base64url');
const ACCOUNT_ID = deterministicUuid(
  'player-onboarding-controller',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-onboarding-controller-other',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);
const PHONE_MARKER = '+79991112233';
const EMAIL_MARKER = 'private.owner@example.test';
const PRIVATE_MARKER = 'SYNTHETIC_ONBOARDING_HTTP_PRIVATE';

interface Harness {
  readonly app: NestFastifyApplication;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [SessionAuthenticationInput]
  >;
  readonly readOwnOnboarding: jest.Mock<
    Promise<ReadOwnPlayerOnboardingResult>,
    [{ readonly accountId: AccountId; readonly role: 'player' | 'club_admin' }]
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

function foundOnboarding(): OwnPlayerOnboarding {
  return {
    status: 'in_progress',
    flowVersion: 'tma_v1',
    currentStep: 'contacts',
    surveyVersion: 'initial_level_v1',
    revision: 2,
    profile: { firstName: 'Private', lastName: 'Owner' },
    contacts: {
      phone: PHONE_MARKER,
      normalizedEmail: EMAIL_MARKER,
      assurance: 'declared',
    },
    consents: [{ kind: 'terms', documentVersion: '2026-08-01' }],
    surveyAnswers: {},
  };
}

function foundResult(): ReadOwnPlayerOnboardingResult {
  return { outcome: 'found', onboarding: foundOnboarding() };
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
  const readOwnOnboarding = jest
    .fn<
      Promise<ReadOwnPlayerOnboardingResult>,
      [
        {
          readonly accountId: AccountId;
          readonly role: 'player' | 'club_admin';
        },
      ]
    >()
    .mockResolvedValue(foundResult());
  const nowEpochSeconds = jest.fn<
    ReturnType<SessionAuthenticationClock['nowEpochSeconds']>,
    []
  >(() => NOW);
  const moduleRef = await Test.createTestingModule({
    controllers: [PlayerOnboardingController],
    providers: [
      SessionBearerGuard,
      {
        provide: SessionAuthenticationService,
        useValue: { authenticate },
      },
      {
        provide: PlayerOnboardingService,
        useValue: { readOwnOnboarding },
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
  return { app, authenticate, readOwnOnboarding, logs };
}

function inject(
  harness: Harness,
  authorization?: string,
  suffix = '',
  cookie?: string,
) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }
  if (cookie !== undefined) {
    headers.cookie = cookie;
  }
  return harness.app.inject({
    method: 'GET',
    url: `${ROUTE}${suffix}`,
    headers,
  });
}

function expectNoStore(response: {
  readonly headers: Record<string, string | string[] | number | undefined>;
}): void {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers.pragma).toBe('no-cache');
}

describe('PlayerOnboardingController HTTP boundary', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
    jest.restoreAllMocks();
  });

  it('returns the owner-only resumable allowlist with declared contacts', async () => {
    const response = await inject(harness, `Bearer ${CREDENTIAL}`);

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual(foundOnboarding());
    expect(harness.authenticate).toHaveBeenCalledWith({
      credential: CREDENTIAL,
      now: NOW,
    });
    expect(harness.readOwnOnboarding).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
    });
    const responseBody = JSON.stringify(response.json());
    expect(responseBody).toContain(PHONE_MARKER);
    expect(responseBody).toContain(EMAIL_MARKER);
    for (const forbidden of [
      ACCOUNT_ID,
      CREDENTIAL,
      'rating',
      'isVerified',
      'phoneVerified',
      'emailVerified',
    ]) {
      expect(responseBody).not.toContain(forbidden);
    }
    const logs = JSON.stringify(harness.logs);
    expect(logs).not.toContain(PHONE_MARKER);
    expect(logs).not.toContain(EMAIL_MARKER);
  });

  it.each([
    undefined,
    CREDENTIAL,
    `bearer ${CREDENTIAL}`,
    `Bearer  ${CREDENTIAL}`,
    `Bearer ${CREDENTIAL} `,
    'Bearer invalid',
  ])(
    'rejects non-canonical authorization %p before service',
    async (authorization) => {
      const response = await inject(harness, authorization);
      expect(response.statusCode).toBe(401);
      expectNoStore(response);
      expect(response.json()).toEqual({
        statusCode: 401,
        code: 'session_invalid',
        message: 'Session is invalid',
      });
      expect(harness.readOwnOnboarding).not.toHaveBeenCalled();
    },
  );

  it('never accepts account or credential overrides from query/cookie', async () => {
    const response = await inject(
      harness,
      `Bearer ${CREDENTIAL}`,
      `?accountId=${OTHER_ACCOUNT_ID}&credential=override`,
      'credential=override',
    );
    expect(response.statusCode).toBe(200);
    expect(harness.readOwnOnboarding).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
    });
    expect(JSON.stringify(response.json())).not.toContain(OTHER_ACCOUNT_ID);
  });

  it.each([
    ['onboarding_not_found', 404, 'onboarding_not_found'],
    ['temporary_unavailable', 503, 'onboarding_service_unavailable'],
    ['invalid_request', 500, 'onboarding_internal_error'],
    ['internal_failure', 500, 'onboarding_internal_error'],
  ] as const)('maps %s to safe HTTP %d', async (reason, statusCode, code) => {
    harness.readOwnOnboarding.mockResolvedValueOnce({
      outcome: 'rejected',
      reason,
    });
    const response = await inject(harness, `Bearer ${CREDENTIAL}`);
    expect(response.statusCode).toBe(statusCode);
    expectNoStore(response);
    expect(response.json()).toMatchObject({ statusCode, code });
    expect(response.body).not.toContain(PHONE_MARKER);
    expect(response.body).not.toContain(EMAIL_MARKER);
  });

  it.each([
    null,
    {},
    { outcome: 'found' },
    {
      outcome: 'found',
      onboarding: {
        ...foundOnboarding(),
        accountId: OTHER_ACCOUNT_ID,
      },
    },
    { outcome: 'rejected', reason: PRIVATE_MARKER },
  ])('fails closed on malformed service result %#', async (result) => {
    harness.readOwnOnboarding.mockResolvedValueOnce(result as never);
    const response = await inject(harness, `Bearer ${CREDENTIAL}`);
    expect(response.statusCode).toBe(500);
    expectNoStore(response);
    expect(response.json()).toEqual({
      statusCode: 500,
      code: 'onboarding_internal_error',
      message: 'Onboarding request failed',
    });
    expect(
      JSON.stringify({ response: response.json(), logs: harness.logs }),
    ).not.toContain(PRIVATE_MARKER);
  });

  it('hides thrown PII and credential details from response and logs', async () => {
    harness.readOwnOnboarding.mockRejectedValueOnce(
      new Error(
        `${PRIVATE_MARKER}:${PHONE_MARKER}:${EMAIL_MARKER}:${CREDENTIAL}`,
      ),
    );
    const response = await inject(harness, `Bearer ${CREDENTIAL}`);
    expect(response.statusCode).toBe(500);
    const output = JSON.stringify({
      response: response.json(),
      logs: harness.logs,
    });
    for (const marker of [
      PRIVATE_MARKER,
      PHONE_MARKER,
      EMAIL_MARKER,
      CREDENTIAL,
    ]) {
      expect(output).not.toContain(marker);
    }
  });
});
