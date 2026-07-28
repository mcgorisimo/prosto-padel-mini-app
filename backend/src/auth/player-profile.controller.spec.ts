import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import { PlayerProfileController } from './player-profile.controller';
import { PlayerProfileService } from './player-profile.service';
import { ReadOwnPlayerProfileResult } from './player-profile.types';
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

const ROUTE = '/api/v1/profile/me';
const CREDENTIAL = Buffer.alloc(32, 0x51).toString('base64url');
const ACCOUNT_ID = deterministicUuid(
  'player-profile-controller-account',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);
const PRIVATE_MARKER = 'SYNTHETIC_PLAYER_PROFILE_HTTP_PRIVATE';

interface Harness {
  readonly app: NestFastifyApplication;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [SessionAuthenticationInput]
  >;
  readonly readOwnProfile: jest.Mock<
    Promise<ReadOwnPlayerProfileResult>,
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

async function createHarness(): Promise<Harness> {
  const authenticate = jest.fn<
    Promise<SessionAuthenticationResult>,
    [SessionAuthenticationInput]
  >().mockResolvedValue({
    outcome: 'authenticated',
    principal: {
      accountId: ACCOUNT_ID,
      role: 'player',
      expiresAt: EXPIRES_AT,
    },
  });
  const readOwnProfile = jest.fn<
    Promise<ReadOwnPlayerProfileResult>,
    [{ readonly accountId: AccountId; readonly role: 'player' | 'club_admin' }]
  >().mockResolvedValue({
    outcome: 'found',
    profile: {
      accountId: ACCOUNT_ID,
      role: 'player',
      firstName: 'Synthetic',
      lastName: 'Player',
      username: 'synthetic_player',
      photoUrl: 'https://example.test/avatar.svg',
      languageCode: 'ru',
    },
  });
  const nowEpochSeconds = jest.fn<
    ReturnType<SessionAuthenticationClock['nowEpochSeconds']>,
    []
  >(() => NOW);
  const moduleRef = await Test.createTestingModule({
    controllers: [PlayerProfileController],
    providers: [
      SessionBearerGuard,
      {
        provide: SessionAuthenticationService,
        useValue: { authenticate },
      },
      {
        provide: PlayerProfileService,
        useValue: { readOwnProfile },
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
  return { app, authenticate, readOwnProfile, logs };
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
  readonly headers: Record<
    string,
    string | string[] | number | undefined
  >;
}): void {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers.pragma).toBe('no-cache');
}

describe('PlayerProfileController HTTP boundary', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
    jest.restoreAllMocks();
  });

  it('returns only the authenticated player profile allowlist', async () => {
    const response = await inject(harness, `Bearer ${CREDENTIAL}`);

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({
      accountId: ACCOUNT_ID,
      role: 'player',
      firstName: 'Synthetic',
      lastName: 'Player',
      username: 'synthetic_player',
      photoUrl: 'https://example.test/avatar.svg',
      languageCode: 'ru',
    });
    expect(Object.keys(response.json()).sort()).toEqual(
      [
        'accountId',
        'firstName',
        'languageCode',
        'lastName',
        'photoUrl',
        'role',
        'username',
      ].sort(),
    );
    expect(harness.authenticate).toHaveBeenCalledWith({
      credential: CREDENTIAL,
      now: NOW,
    });
    expect(harness.readOwnProfile).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
    });
    expect(JSON.stringify(response.json())).not.toContain(CREDENTIAL);
  });

  it.each([
    undefined,
    CREDENTIAL,
    `bearer ${CREDENTIAL}`,
    `Bearer  ${CREDENTIAL}`,
    `Bearer ${CREDENTIAL} `,
    'Bearer invalid',
    `Basic ${CREDENTIAL}`,
  ])('rejects a non-canonical Authorization value %p', async (authorization) => {
    const response = await inject(harness, authorization);
    expect(response.statusCode).toBe(401);
    expectNoStore(response);
    expect(response.json()).toEqual({
      statusCode: 401,
      code: 'session_invalid',
      message: 'Session is invalid',
    });
    expect(harness.readOwnProfile).not.toHaveBeenCalled();
  });

  it('never accepts a credential from query strings or cookies', async () => {
    const queryResponse = await inject(
      harness,
      undefined,
      `?credential=${CREDENTIAL}`,
    );
    const cookieResponse = await inject(
      harness,
      undefined,
      '',
      `credential=${CREDENTIAL}`,
    );
    expect(queryResponse.statusCode).toBe(401);
    expect(cookieResponse.statusCode).toBe(401);
    expect(harness.authenticate).not.toHaveBeenCalled();
    expect(harness.readOwnProfile).not.toHaveBeenCalled();
  });

  it.each([
    ['profile_not_found', 404, 'profile_not_found'],
    ['temporary_unavailable', 503, 'profile_service_unavailable'],
    ['invalid_request', 500, 'profile_internal_error'],
    ['internal_failure', 500, 'profile_internal_error'],
  ] as const)('maps %s to safe HTTP %d', async (reason, statusCode, code) => {
    harness.readOwnProfile.mockResolvedValue({
      outcome: 'rejected',
      reason,
    });

    const response = await inject(harness, `Bearer ${CREDENTIAL}`);

    expect(response.statusCode).toBe(statusCode);
    expectNoStore(response);
    expect(response.json()).toMatchObject({ statusCode, code });
    expect(JSON.stringify(response.json())).not.toContain(CREDENTIAL);
  });

  it('hides thrown profile service details from response and logs', async () => {
    harness.readOwnProfile.mockRejectedValue(
      new Error(`${PRIVATE_MARKER}:${CREDENTIAL}:digest`),
    );

    const response = await inject(harness, `Bearer ${CREDENTIAL}`);

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      statusCode: 500,
      code: 'profile_internal_error',
      message: 'Profile request failed',
    });
    const output = JSON.stringify({
      response: response.json(),
      logs: harness.logs,
    });
    expect(output).not.toContain(CREDENTIAL);
    expect(output).not.toContain(PRIVATE_MARKER);
    expect(output).not.toContain('digest');
  });

  it.each([
    null,
    {},
    { outcome: 'found' },
    {
      outcome: 'found',
      profile: {
        accountId: ACCOUNT_ID,
        role: 'player',
        firstName: 'Synthetic',
        lastName: null,
        username: null,
        photoUrl: null,
        languageCode: null,
        extra: PRIVATE_MARKER,
      },
    },
  ])('fails closed on a malformed service result %p', async (result) => {
    harness.readOwnProfile.mockResolvedValue(result as never);

    const response = await inject(harness, `Bearer ${CREDENTIAL}`);

    expect(response.statusCode).toBe(500);
    expectNoStore(response);
    expect(response.json()).toEqual({
      statusCode: 500,
      code: 'profile_internal_error',
      message: 'Profile request failed',
    });
    expect(JSON.stringify(response.json())).not.toContain(PRIVATE_MARKER);
  });

  it('preserves session guard storage error mapping', async () => {
    harness.authenticate.mockResolvedValue({
      outcome: 'rejected',
      reason: 'temporary_unavailable',
    });

    const response = await inject(harness, `Bearer ${CREDENTIAL}`);

    expect(response.statusCode).toBe(503);
    expectNoStore(response);
    expect(response.json()).toMatchObject({
      code: 'session_service_unavailable',
    });
    expect(harness.readOwnProfile).not.toHaveBeenCalled();
  });
});
