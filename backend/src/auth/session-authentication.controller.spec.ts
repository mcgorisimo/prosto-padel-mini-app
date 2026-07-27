import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import { SessionAuthenticationController } from './session-authentication.controller';
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

const ROUTE = '/api/v1/auth/session/me';
const CREDENTIAL = Buffer.alloc(32, 0x41).toString('base64url');
const ACCOUNT_ID = deterministicUuid(
  'session-authentication-controller-account',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_HTTP_AUTH_MARKER';

type LogEntry = readonly unknown[];

interface HttpHarness {
  readonly app: NestFastifyApplication;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [SessionAuthenticationInput]
  >;
  readonly nowEpochSeconds: jest.Mock<
    ReturnType<SessionAuthenticationClock['nowEpochSeconds']>,
    []
  >;
  readonly logEntries: LogEntry[];
}

function captureLogger(logEntries: LogEntry[]) {
  const capture = (...values: unknown[]): void => {
    logEntries.push(values);
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

async function createHarness(): Promise<HttpHarness> {
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
  const nowEpochSeconds = jest.fn<
    ReturnType<SessionAuthenticationClock['nowEpochSeconds']>,
    []
  >(() => NOW);
  const moduleRef = await Test.createTestingModule({
    controllers: [SessionAuthenticationController],
    providers: [
      SessionBearerGuard,
      {
        provide: SessionAuthenticationService,
        useValue: { authenticate },
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
  const logEntries: LogEntry[] = [];
  app.useLogger(captureLogger(logEntries));
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, authenticate, nowEpochSeconds, logEntries };
}

function inject(
  harness: HttpHarness,
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

describe('SessionAuthenticationController HTTP boundary', () => {
  let harness: HttpHarness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
    jest.restoreAllMocks();
  });

  it('returns the safe principal for an exact Bearer credential', async () => {
    const response = await inject(harness, `Bearer ${CREDENTIAL}`);
    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({
      accountId: ACCOUNT_ID,
      role: 'player',
      expiresAt: EXPIRES_AT,
    });
    expect(harness.authenticate).toHaveBeenCalledTimes(1);
    expect(harness.authenticate).toHaveBeenCalledWith({
      credential: CREDENTIAL,
      now: NOW,
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
    expect(harness.authenticate).not.toHaveBeenCalled();
  });

  it('does not accept credentials from query strings or cookies', async () => {
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
  });

  it.each([
    ['invalid_request', 401, 'session_invalid'],
    ['session_invalid', 401, 'session_invalid'],
    ['temporary_unavailable', 503, 'session_service_unavailable'],
    ['internal_failure', 500, 'session_internal_error'],
  ] as const)('maps %s to safe HTTP %d', async (reason, statusCode, code) => {
    harness.authenticate.mockResolvedValue({
      outcome: 'rejected',
      reason,
    });
    const response = await inject(harness, `Bearer ${CREDENTIAL}`);
    expect(response.statusCode).toBe(statusCode);
    expectNoStore(response);
    expect(response.json()).toMatchObject({ statusCode, code });
    expect(JSON.stringify(response.json())).not.toContain(CREDENTIAL);
  });

  it('fails closed on an invalid clock or malformed service principal', async () => {
    harness.nowEpochSeconds.mockReturnValueOnce(
      -1 as ReturnType<SessionAuthenticationClock['nowEpochSeconds']>,
    );
    const clockResponse = await inject(harness, `Bearer ${CREDENTIAL}`);
    expect(clockResponse.statusCode).toBe(500);
    expect(harness.authenticate).not.toHaveBeenCalled();

    harness.authenticate.mockResolvedValue({
      outcome: 'authenticated',
      principal: {
        accountId: ACCOUNT_ID,
        role: 'player',
        expiresAt: NOW,
      },
    });
    const principalResponse = await inject(
      harness,
      `Bearer ${CREDENTIAL}`,
    );
    expect(principalResponse.statusCode).toBe(500);
    expectNoStore(principalResponse);
  });

  it('hides thrown service details and never logs authentication material', async () => {
    harness.authenticate.mockRejectedValue(
      new Error(`${PRIVATE_MARKER}:${CREDENTIAL}`),
    );
    const response = await inject(harness, `Bearer ${CREDENTIAL}`);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      statusCode: 500,
      code: 'session_internal_error',
      message: 'Session request failed',
    });

    const output = JSON.stringify({
      response: response.json(),
      logs: harness.logEntries,
    });
    expect(output).not.toContain(CREDENTIAL);
    expect(output).not.toContain(PRIVATE_MARKER);
  });
});
