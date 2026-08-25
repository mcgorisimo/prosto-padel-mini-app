import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { BackendDomainEventLogger } from '../common/logging/backend-domain-event.logger';
import { unixEpochSeconds } from './auth.types';
import {
  SESSION_LIFECYCLE_HTTP_CLOCK,
  SessionLifecycleHttpClock,
} from './session-lifecycle.http';
import { SessionLifecycleController } from './session-lifecycle.controller';
import { SessionLifecycleService } from './session-lifecycle.service';
import {
  SessionLifecycleRequestInput,
  SessionLogoutResult,
  SessionRefreshResult,
} from './session-lifecycle.types';

const REFRESH_ROUTE = '/api/v1/auth/session/refresh';
const LOGOUT_ROUTE = '/api/v1/auth/session/logout';
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);
const REQUEST_KEY = '12345678-1234-4abc-9234-567812345678';
const PRESENTED_CREDENTIAL = Buffer.alloc(32, 0x41).toString('base64url');
const NEXT_CREDENTIAL = Buffer.alloc(32, 0x42).toString('base64url');
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_DATABASE_DETAIL';

type LogEntry = readonly unknown[];

interface HttpHarness {
  readonly app: NestFastifyApplication;
  readonly refresh: jest.Mock<
    Promise<SessionRefreshResult>,
    [SessionLifecycleRequestInput]
  >;
  readonly logout: jest.Mock<
    Promise<SessionLogoutResult>,
    [SessionLifecycleRequestInput]
  >;
  readonly nowEpochSeconds: jest.Mock<
    ReturnType<SessionLifecycleHttpClock['nowEpochSeconds']>,
    []
  >;
  readonly domainEvents: jest.Mock;
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
  const refresh = jest.fn<
    Promise<SessionRefreshResult>,
    [SessionLifecycleRequestInput]
  >();
  refresh.mockResolvedValue({
    outcome: 'refreshed',
    credential: NEXT_CREDENTIAL,
    expiresAt: EXPIRES_AT,
  });
  const logout = jest.fn<
    Promise<SessionLogoutResult>,
    [SessionLifecycleRequestInput]
  >();
  logout.mockResolvedValue({ outcome: 'logged_out' });
  const nowEpochSeconds = jest.fn<
    ReturnType<SessionLifecycleHttpClock['nowEpochSeconds']>,
    []
  >(() => NOW);
  const domainEvents = jest.fn();

  const moduleRef = await Test.createTestingModule({
    controllers: [SessionLifecycleController],
    providers: [
      {
        provide: SessionLifecycleService,
        useValue: { refresh, logout },
      },
      {
        provide: SESSION_LIFECYCLE_HTTP_CLOCK,
        useValue: { nowEpochSeconds },
      },
      {
        provide: BackendDomainEventLogger,
        useValue: { record: domainEvents },
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

  return {
    app,
    refresh,
    logout,
    nowEpochSeconds,
    domainEvents,
    logEntries,
  };
}

function inject(
  subject: HttpHarness,
  route: string,
  options: {
    readonly authorization?: string;
    readonly payload?: unknown;
    readonly query?: string;
    readonly cookie?: string;
  } = {},
) {
  const headers: Record<string, string> = {};
  if (options.authorization !== undefined) {
    headers.authorization = options.authorization;
  }
  if (options.cookie !== undefined) {
    headers.cookie = options.cookie;
  }
  return subject.app.inject({
    method: 'POST',
    url: `${route}${options.query ?? ''}`,
    headers,
    payload: (options.payload ?? { requestKey: REQUEST_KEY }) as object,
  });
}

function authenticatedInject(
  subject: HttpHarness,
  route: string,
  payload: unknown = { requestKey: REQUEST_KEY },
) {
  return inject(subject, route, {
    authorization: `Bearer ${PRESENTED_CREDENTIAL}`,
    payload,
  });
}

describe('SessionLifecycleController HTTP boundary', () => {
  let subject: HttpHarness | undefined;

  afterEach(async () => {
    await subject?.app.close();
    subject = undefined;
  });

  it('returns a rotated credential with no-store headers and one service call', async () => {
    subject = await createHarness();

    const response = await authenticatedInject(subject, REFRESH_ROUTE);
    const body = response.json<Record<string, unknown>>();

    expect(response.statusCode).toBe(200);
    expect({
      keys: Object.keys(body).sort(),
      credentialMatches: body.credential === NEXT_CREDENTIAL,
      expiresAt: body.expiresAt,
    }).toEqual({
      keys: ['credential', 'expiresAt'],
      credentialMatches: true,
      expiresAt: EXPIRES_AT,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(subject.refresh).toHaveBeenCalledTimes(1);
    expect(subject.refresh).toHaveBeenCalledWith({
      credential: PRESENTED_CREDENTIAL,
      requestKey: REQUEST_KEY,
      now: NOW,
    });
    expect(subject.logout).not.toHaveBeenCalled();
    expect(subject.domainEvents).toHaveBeenCalledWith({
      domain: 'auth',
      action: 'session_refresh',
      outcome: 'refreshed',
    });
  });

  it.each(['applied', 'idempotent_retry'] as const)(
    'returns 204 for a successful logout result represented by the service (%s)',
    async () => {
      subject = await createHarness();

      const response = await authenticatedInject(subject, LOGOUT_ROUTE);

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
      expect(subject.logout).toHaveBeenCalledTimes(1);
      expect(subject.logout).toHaveBeenCalledWith({
        credential: PRESENTED_CREDENTIAL,
        requestKey: REQUEST_KEY,
        now: NOW,
      });
      expect(subject.refresh).not.toHaveBeenCalled();
      expect(subject.domainEvents).toHaveBeenCalledWith({
        domain: 'auth',
        action: 'session_logout',
        outcome: 'logged_out',
      });
    },
  );

  it.each([
    undefined,
    PRESENTED_CREDENTIAL,
    `bearer ${PRESENTED_CREDENTIAL}`,
    `Bearer  ${PRESENTED_CREDENTIAL}`,
    `Bearer ${PRESENTED_CREDENTIAL} `,
    `Basic ${PRESENTED_CREDENTIAL}`,
    'Bearer invalid',
  ])('rejects a non-canonical Authorization header', async (authorization) => {
    subject = await createHarness();

    const response = await inject(subject, REFRESH_ROUTE, { authorization });

    expect(response.statusCode).toBe(401);
    expect(response.json<Record<string, unknown>>().code).toBe(
      'session_invalid',
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(subject.refresh).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { requestKey: '' },
    { requestKey: 'not-a-uuid' },
    { requestKey: REQUEST_KEY, credential: PRESENTED_CREDENTIAL },
    { requestKey: REQUEST_KEY, commandId: REQUEST_KEY },
    { requestKey: REQUEST_KEY, requestDigest: 'digest' },
    { requestKey: REQUEST_KEY, eventId: REQUEST_KEY },
    { requestKey: REQUEST_KEY, sessionId: REQUEST_KEY },
    { requestKey: REQUEST_KEY, generation: 1 },
  ])('rejects a non-exact request body', async (payload) => {
    subject = await createHarness();

    const response = await authenticatedInject(
      subject,
      REFRESH_ROUTE,
      payload,
    );

    expect(response.statusCode).toBe(400);
    expect(response.json<Record<string, unknown>>().code).toBe(
      'session_request_invalid',
    );
    expect(subject.refresh).not.toHaveBeenCalled();
  });

  it('does not accept a credential from a query string or cookie', async () => {
    subject = await createHarness();

    const queryResponse = await inject(subject, REFRESH_ROUTE, {
      query: `?credential=${PRESENTED_CREDENTIAL}`,
    });
    const cookieResponse = await inject(subject, LOGOUT_ROUTE, {
      cookie: `credential=${PRESENTED_CREDENTIAL}`,
    });

    expect(queryResponse.statusCode).toBe(401);
    expect(cookieResponse.statusCode).toBe(401);
    expect(subject.refresh).not.toHaveBeenCalled();
    expect(subject.logout).not.toHaveBeenCalled();
  });

  it.each([
    ['session_refresh_reopen_required', 409, 'session_refresh_reopen_required'],
    ['session_expired', 401, 'session_expired'],
    ['session_invalid', 401, 'session_invalid'],
    ['session_request_conflict', 409, 'session_request_conflict'],
    ['temporary_unavailable', 503, 'session_service_unavailable'],
    ['internal_failure', 500, 'session_internal_error'],
  ] as const)(
    'maps refresh rejection %s to HTTP %s',
    async (reason, statusCode, code) => {
      subject = await createHarness();
      subject.refresh.mockResolvedValue({ outcome: 'rejected', reason });

      const response = await authenticatedInject(subject, REFRESH_ROUTE);

      expect(response.statusCode).toBe(statusCode);
      expect(response.json<Record<string, unknown>>().code).toBe(code);
      expect(response.body).not.toContain(PRESENTED_CREDENTIAL);
      expect(response.body).not.toContain(NEXT_CREDENTIAL);
    },
  );

  it.each([
    ['session_invalid', 401, 'session_invalid'],
    ['session_request_conflict', 409, 'session_request_conflict'],
    ['temporary_unavailable', 503, 'session_service_unavailable'],
    ['internal_failure', 500, 'session_internal_error'],
  ] as const)(
    'maps logout rejection %s to HTTP %s',
    async (reason, statusCode, code) => {
      subject = await createHarness();
      subject.logout.mockResolvedValue({ outcome: 'rejected', reason });

      const response = await authenticatedInject(subject, LOGOUT_ROUTE);

      expect(response.statusCode).toBe(statusCode);
      expect(response.json<Record<string, unknown>>().code).toBe(code);
    },
  );

  it('fails closed if refresh returns an invalid credential result', async () => {
    subject = await createHarness();
    subject.refresh.mockResolvedValue({
      outcome: 'refreshed',
      credential: 'invalid',
      expiresAt: EXPIRES_AT,
    });

    const response = await authenticatedInject(subject, REFRESH_ROUTE);

    expect(response.statusCode).toBe(500);
    expect(response.json<Record<string, unknown>>().code).toBe(
      'session_internal_error',
    );
    expect(response.body).not.toContain(NEXT_CREDENTIAL);
  });

  it('hides thrown persistence details and authentication material', async () => {
    subject = await createHarness();
    subject.refresh.mockRejectedValue(
      Object.assign(new Error(PRIVATE_MARKER), {
        code: '42501',
        digest: PRESENTED_CREDENTIAL,
      }),
    );

    const response = await authenticatedInject(subject, REFRESH_ROUTE);
    const observable = JSON.stringify({
      response: response.json<Record<string, unknown>>(),
      logs: subject.logEntries,
    });

    expect(response.statusCode).toBe(500);
    expect(observable).not.toContain(PRIVATE_MARKER);
    expect(observable).not.toContain(PRESENTED_CREDENTIAL);
    expect(observable).not.toContain(NEXT_CREDENTIAL);
  });
});
