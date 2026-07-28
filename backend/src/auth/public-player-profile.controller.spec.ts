import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import { PublicPlayerProfileController } from './public-player-profile.controller';
import { PublicPlayerProfileService } from './public-player-profile.service';
import {
  SearchPublicPlayerProfilesInput,
  SearchPublicPlayerProfilesResult,
} from './public-player-profile.types';
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

const ROUTE = '/api/v1/players/search';
const CREDENTIAL = Buffer.alloc(32, 0x61).toString('base64url');
const ACCOUNT_ID = deterministicUuid(
  'public-player-profile-controller-account',
) as AccountId;
const PLAYER_ID = deterministicUuid(
  'public-player-profile-controller-player',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);
const PRIVATE_MARKER =
  'SYNTHETIC_PUBLIC_PLAYER_PROFILE_HTTP_PRIVATE';

interface Harness {
  readonly app: NestFastifyApplication;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [SessionAuthenticationInput]
  >;
  readonly search: jest.Mock<
    Promise<SearchPublicPlayerProfilesResult>,
    [SearchPublicPlayerProfilesInput]
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

async function createHarness(
  role: 'player' | 'club_admin' = 'player',
): Promise<Harness> {
  const authenticate = jest.fn<
    Promise<SessionAuthenticationResult>,
    [SessionAuthenticationInput]
  >().mockResolvedValue({
    outcome: 'authenticated',
    principal: {
      accountId: ACCOUNT_ID,
      role,
      expiresAt: EXPIRES_AT,
    },
  });
  const search = jest.fn<
    Promise<SearchPublicPlayerProfilesResult>,
    [SearchPublicPlayerProfilesInput]
  >().mockResolvedValue({
    outcome: 'found',
    players: [
      {
        playerId: PLAYER_ID,
        firstName: 'Synthetic',
        lastName: 'Player',
        username: 'synthetic_player',
        rating: 3,
        isVerified: false,
      },
    ],
  });
  const nowEpochSeconds = jest.fn<
    ReturnType<SessionAuthenticationClock['nowEpochSeconds']>,
    []
  >(() => NOW);
  const moduleRef = await Test.createTestingModule({
    controllers: [PublicPlayerProfileController],
    providers: [
      SessionBearerGuard,
      {
        provide: SessionAuthenticationService,
        useValue: { authenticate },
      },
      {
        provide: PublicPlayerProfileService,
        useValue: { search },
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
  return { app, authenticate, search, logs };
}

function inject(
  harness: Harness,
  query = 'Synthetic',
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
    url: `${ROUTE}?q=${encodeURIComponent(query)}${suffix}`,
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

describe('PublicPlayerProfileController HTTP boundary', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
    jest.restoreAllMocks();
  });

  it('returns only the exact backend public player allowlist', async () => {
    const response = await inject(
      harness,
      'Synthetic',
      `Bearer ${CREDENTIAL}`,
    );

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({
      players: [
        {
          playerId: PLAYER_ID,
          firstName: 'Synthetic',
          lastName: 'Player',
          username: 'synthetic_player',
          rating: 3,
          isVerified: false,
        },
      ],
    });
    expect(Object.keys(response.json())).toEqual(['players']);
    expect(Object.keys(response.json().players[0]).sort()).toEqual(
      [
        'playerId',
        'firstName',
        'lastName',
        'username',
        'rating',
        'isVerified',
      ].sort(),
    );
    expect(harness.authenticate).toHaveBeenCalledWith({
      credential: CREDENTIAL,
      now: NOW,
    });
    expect(harness.search).toHaveBeenCalledWith({
      query: 'Synthetic',
      limit: 8,
      role: 'player',
    });
    const output = JSON.stringify({
      response: response.json(),
      logs: harness.logs,
    });
    for (const forbidden of [
      CREDENTIAL,
      'phone',
      'photoUrl',
      'languageCode',
      'accountId',
    ]) {
      expect(output).not.toContain(forbidden);
    }
  });

  it('normalizes a leading username marker and accepts a canonical limit', async () => {
    const response = await inject(
      harness,
      '  @Ｓynthetic  ',
      `Bearer ${CREDENTIAL}`,
      '&limit=20',
    );

    expect(response.statusCode).toBe(200);
    expect(harness.search).toHaveBeenCalledWith({
      query: 'Synthetic',
      limit: 20,
      role: 'player',
    });
  });

  it('returns a safe empty result', async () => {
    harness.search.mockResolvedValue({
      outcome: 'found',
      players: [],
    });

    const response = await inject(
      harness,
      'Nobody',
      `Bearer ${CREDENTIAL}`,
    );
    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({ players: [] });
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
    const response = await inject(harness, 'Player', authorization);
    expect(response.statusCode).toBe(401);
    expectNoStore(response);
    expect(response.json()).toEqual({
      statusCode: 401,
      code: 'session_invalid',
      message: 'Session is invalid',
    });
    expect(harness.search).not.toHaveBeenCalled();
  });

  it('does not accept credentials from query strings or cookies', async () => {
    const queryResponse = await inject(
      harness,
      'Player',
      undefined,
      `&credential=${CREDENTIAL}`,
    );
    const cookieResponse = await inject(
      harness,
      'Player',
      undefined,
      '',
      `credential=${CREDENTIAL}`,
    );
    expect(queryResponse.statusCode).toBe(401);
    expect(cookieResponse.statusCode).toBe(401);
    expect(harness.authenticate).not.toHaveBeenCalled();
    expect(harness.search).not.toHaveBeenCalled();
  });

  it.each([
    ['', ''],
    ['A', ''],
    ['Player', '&limit=0'],
    ['Player', '&limit=01'],
    ['Player', '&limit=21'],
    ['Player', '&limit=8&extra=true'],
    ['Player', '&q=Other'],
  ])('rejects an invalid query %#', async (query, suffix) => {
    const response = await inject(
      harness,
      query,
      `Bearer ${CREDENTIAL}`,
      suffix,
    );
    expect(response.statusCode).toBe(400);
    expectNoStore(response);
    expect(response.json()).toEqual({
      statusCode: 400,
      code: 'player_search_invalid_request',
      message: 'Player search request is invalid',
    });
    expect(harness.search).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_request', 400, 'player_search_invalid_request'],
    ['temporary_unavailable', 503, 'player_search_unavailable'],
    ['internal_failure', 500, 'player_search_internal_error'],
  ] as const)('maps %s to safe HTTP %d', async (reason, statusCode, code) => {
    harness.search.mockResolvedValue({
      outcome: 'rejected',
      reason,
    });
    const response = await inject(
      harness,
      'Player',
      `Bearer ${CREDENTIAL}`,
    );
    expect(response.statusCode).toBe(statusCode);
    expectNoStore(response);
    expect(response.json()).toMatchObject({ statusCode, code });
    expect(JSON.stringify(response.json())).not.toContain(CREDENTIAL);
  });

  it('supports an authenticated club administrator without exposing its identity', async () => {
    await harness.app.close();
    harness = await createHarness('club_admin');

    const response = await inject(
      harness,
      'Player',
      `Bearer ${CREDENTIAL}`,
    );
    expect(response.statusCode).toBe(200);
    expect(harness.search).toHaveBeenCalledWith({
      query: 'Player',
      limit: 8,
      role: 'club_admin',
    });
    expect(JSON.stringify(response.json())).not.toContain(ACCOUNT_ID);
  });

  it('hides thrown details and never logs authentication material', async () => {
    harness.search.mockRejectedValue(
      new Error(`${PRIVATE_MARKER}:${CREDENTIAL}:digest`),
    );
    const response = await inject(
      harness,
      'Player',
      `Bearer ${CREDENTIAL}`,
    );

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      statusCode: 500,
      code: 'player_search_internal_error',
      message: 'Player search failed',
    });
    const output = JSON.stringify({
      response: response.json(),
      logs: harness.logs,
    });
    expect(output).not.toContain(PRIVATE_MARKER);
    expect(output).not.toContain(CREDENTIAL);
    expect(output).not.toContain('digest');
  });

  it('fails closed on a malformed service response', async () => {
    harness.search.mockResolvedValue({
      outcome: 'found',
      players: [
        {
          playerId: PLAYER_ID,
          firstName: 'Synthetic',
          lastName: null,
          username: null,
          rating: 3,
          isVerified: false,
          phone: PRIVATE_MARKER,
        },
      ],
    } as never);

    const response = await inject(
      harness,
      'Player',
      `Bearer ${CREDENTIAL}`,
    );
    expect(response.statusCode).toBe(500);
    expect(JSON.stringify(response.json())).not.toContain(PRIVATE_MARKER);
  });

  it('fails closed on duplicate player identities', async () => {
    const player = {
      playerId: PLAYER_ID,
      firstName: 'Synthetic',
      lastName: null,
      username: null,
      rating: 3,
      isVerified: false,
    };
    harness.search.mockResolvedValue({
      outcome: 'found',
      players: [player, { ...player, firstName: 'Duplicate' }],
    });

    const response = await inject(
      harness,
      'Player',
      `Bearer ${CREDENTIAL}`,
    );
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      code: 'player_search_internal_error',
    });
  });
});
