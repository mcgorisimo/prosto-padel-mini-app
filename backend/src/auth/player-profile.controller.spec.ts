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
import {
  ReadOwnPlayerProfileResult,
  UpdateOwnPlayerProfileResult,
} from './player-profile.types';
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
  readonly updateOwnProfile: jest.Mock<
    Promise<UpdateOwnPlayerProfileResult>,
    [{
      readonly accountId: AccountId;
      readonly role: 'player' | 'club_admin';
      readonly changes: Record<string, unknown>;
    }]
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
      phone: '+79990000000',
      sidePreference: 'Right',
      rating: 3,
      isVerified: false,
      capabilities: [],
    },
  });
  const nowEpochSeconds = jest.fn<
    ReturnType<SessionAuthenticationClock['nowEpochSeconds']>,
    []
  >(() => NOW);
  const updateOwnProfile = jest.fn<
    Promise<UpdateOwnPlayerProfileResult>,
    [{
      readonly accountId: AccountId;
      readonly role: 'player' | 'club_admin';
      readonly changes: Record<string, unknown>;
    }]
  >().mockResolvedValue({
    outcome: 'updated',
    profile: {
      accountId: ACCOUNT_ID,
      role: 'player',
      firstName: 'Updated',
      lastName: null,
      username: 'synthetic_player',
      photoUrl: 'https://example.test/avatar.svg',
      languageCode: 'ru',
      phone: '+79991112233',
      sidePreference: 'Left',
      rating: 3,
      isVerified: false,
      capabilities: [],
    },
  });
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
        useValue: { readOwnProfile, updateOwnProfile },
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
    readOwnProfile,
    updateOwnProfile,
    logs,
  };
}

function inject(
  harness: Harness,
  authorization?: string,
  suffix = '',
  cookie?: string,
  method: 'GET' | 'PATCH' = 'GET',
  body?: unknown,
) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }
  if (cookie !== undefined) {
    headers.cookie = cookie;
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  return harness.app.inject({
    method,
    url: `${ROUTE}${suffix}`,
    headers,
    ...(body === undefined
      ? {}
      : { payload: JSON.stringify(body) }),
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
      phone: '+79990000000',
      sidePreference: 'Right',
      rating: 3,
      isVerified: false,
      capabilities: [],
    });
    expect(Object.keys(response.json()).sort()).toEqual(
      [
        'accountId',
        'capabilities',
        'firstName',
        'languageCode',
        'lastName',
        'photoUrl',
        'phone',
        'rating',
        'role',
        'sidePreference',
        'username',
        'isVerified',
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
        phone: null,
        sidePreference: null,
        rating: 3,
        isVerified: false,
        capabilities: [],
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

  it('updates only the authenticated profile from an exact body', async () => {
    const body = {
      firstName: 'Updated',
      lastName: null,
      phone: '+79991112233',
      sidePreference: 'Left',
    };
    const response = await inject(
      harness,
      `Bearer ${CREDENTIAL}`,
      '',
      undefined,
      'PATCH',
      body,
    );

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({
      accountId: ACCOUNT_ID,
      role: 'player',
      firstName: 'Updated',
      lastName: null,
      username: 'synthetic_player',
      photoUrl: 'https://example.test/avatar.svg',
      languageCode: 'ru',
      phone: '+79991112233',
      sidePreference: 'Left',
      rating: 3,
      isVerified: false,
      capabilities: [],
    });
    expect(harness.updateOwnProfile).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      changes: body,
    });
    expect(JSON.stringify(response.json())).not.toContain(CREDENTIAL);
  });

  it('maps rejected profile text to a fixed safe response', async () => {
    harness.updateOwnProfile.mockResolvedValueOnce({
      outcome: 'rejected',
      reason: 'content_not_allowed',
    });
    const privateText = 'fuck PRIVATE_PROFILE_MARKER';

    const response = await inject(
      harness,
      `Bearer ${CREDENTIAL}`,
      '',
      undefined,
      'PATCH',
      { firstName: privateText },
    );

    expect(response.statusCode).toBe(422);
    expectNoStore(response);
    expect(response.json()).toEqual({
      statusCode: 422,
      code: 'profile_content_not_allowed',
      message: 'Profile contains disallowed language',
    });
    expect(response.body).not.toContain(privateText);
  });

  it.each([
    null,
    {},
    { firstName: '' },
    { phone: '79991112233' },
    { sidePreference: 'Center' },
    { firstName: 'Updated', accountId: ACCOUNT_ID },
    { username: PRIVATE_MARKER },
    { rating: 3 },
    { isVerified: false },
  ])('rejects an invalid PATCH body without calling storage %#', async (body) => {
    const response = await inject(
      harness,
      `Bearer ${CREDENTIAL}`,
      '',
      undefined,
      'PATCH',
      body,
    );

    expect(response.statusCode).toBe(400);
    expectNoStore(response);
    expect(response.json()).toEqual({
      statusCode: 400,
      code: 'profile_invalid_request',
      message: 'Profile update is invalid',
    });
    expect(harness.updateOwnProfile).not.toHaveBeenCalled();
    expect(JSON.stringify(response.json())).not.toContain(PRIVATE_MARKER);
  });

  it('does not accept an account ID or credential outside the bearer boundary', async () => {
    const response = await inject(
      harness,
      undefined,
      `?accountId=${ACCOUNT_ID}&credential=${CREDENTIAL}`,
      `credential=${CREDENTIAL}`,
      'PATCH',
      { firstName: 'Updated' },
    );

    expect(response.statusCode).toBe(401);
    expect(harness.authenticate).not.toHaveBeenCalled();
    expect(harness.updateOwnProfile).not.toHaveBeenCalled();
  });
});
