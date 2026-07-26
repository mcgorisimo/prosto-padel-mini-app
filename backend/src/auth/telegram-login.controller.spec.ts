import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { unixEpochSeconds } from './auth.types';
import { TelegramLoginController } from './telegram-login.controller';
import {
  TELEGRAM_LOGIN_FEATURE,
  TelegramLoginFeature,
} from './telegram-login.feature';
import {
  TELEGRAM_LOGIN_HTTP_CLOCK,
  TELEGRAM_LOGIN_REQUEST_KEY_MAX_LENGTH,
  TelegramLoginHttpClock,
} from './telegram-login.http';
import { TelegramLoginService } from './telegram-login.service';
import {
  TelegramLoginInput,
  TelegramLoginRejectionReason,
  TelegramLoginResult,
} from './telegram-login.types';

const ROUTE = '/api/v1/auth/telegram/login';
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);
const REQUEST_KEY = 'telegram-login-request-key';
const RAW_INIT_DATA = '  query_id=test%20value&hash=fake  ';
const CREDENTIAL = Buffer.alloc(32, 0x5a).toString('base64url');

type LogEntry = readonly unknown[];

interface HttpHarness {
  readonly app: NestFastifyApplication;
  readonly authenticateWithTelegram: jest.Mock<
    Promise<TelegramLoginResult>,
    [TelegramLoginInput]
  >;
  readonly nowEpochSeconds: jest.Mock<
    ReturnType<TelegramLoginHttpClock['nowEpochSeconds']>,
    []
  >;
  readonly logEntries: LogEntry[];
}

function authenticatedResult(
  accountKind: 'existing' | 'new' = 'existing',
  credential: unknown = CREDENTIAL,
  expiresAt: unknown = EXPIRES_AT,
): TelegramLoginResult {
  return {
    outcome: 'authenticated',
    credential: credential as string,
    expiresAt: expiresAt as typeof EXPIRES_AT,
    accountKind,
  };
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

async function createHarness(
  enabled = true,
): Promise<HttpHarness> {
  const authenticateWithTelegram = jest.fn<
    Promise<TelegramLoginResult>,
    [TelegramLoginInput]
  >();
  authenticateWithTelegram.mockResolvedValue(authenticatedResult());
  const nowEpochSeconds = jest.fn<
    ReturnType<TelegramLoginHttpClock['nowEpochSeconds']>,
    []
  >(() => NOW);
  const feature: TelegramLoginFeature = enabled
    ? {
        enabled: true,
        service: {
          authenticateWithTelegram,
        } as unknown as TelegramLoginService,
      }
    : { enabled: false };

  const moduleRef = await Test.createTestingModule({
    controllers: [TelegramLoginController],
    providers: [
      { provide: TELEGRAM_LOGIN_FEATURE, useValue: feature },
      {
        provide: TELEGRAM_LOGIN_HTTP_CLOCK,
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

  return {
    app,
    authenticateWithTelegram,
    nowEpochSeconds,
    logEntries,
  };
}

async function post(
  subject: HttpHarness,
  payload: unknown = {
    initData: RAW_INIT_DATA,
    requestKey: REQUEST_KEY,
  },
) {
  return subject.app.inject({
    method: 'POST',
    url: ROUTE,
    payload: payload as object,
  });
}

function rejected(reason: TelegramLoginRejectionReason): TelegramLoginResult {
  return { outcome: 'rejected', reason };
}

function containsSensitiveValue(
  value: unknown,
  secrets: readonly string[],
  visited = new Set<object>(),
): boolean {
  if (typeof value === 'string') {
    return secrets.some((secret) => value.includes(secret));
  }
  if (value instanceof Error) {
    return containsSensitiveValue(
      `${value.name}:${value.message}`,
      secrets,
      visited,
    );
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (visited.has(value)) {
    return false;
  }
  visited.add(value);
  return Object.values(value).some((nested) =>
    containsSensitiveValue(nested, secrets, visited),
  );
}

describe('TelegramLoginController HTTP boundary', () => {
  let subject: HttpHarness | undefined;

  afterEach(async () => {
    await subject?.app.close();
    subject = undefined;
  });

  it.each(['new', 'existing'] as const)(
    'returns the exact public response for an authenticated %s account',
    async (accountKind) => {
      subject = await createHarness();
      subject.authenticateWithTelegram.mockResolvedValue(
        authenticatedResult(accountKind),
      );

      const response = await post(subject);
      const body = response.json<Record<string, unknown>>();

      expect(response.statusCode).toBe(200);
      expect({
        keys: Object.keys(body).sort(),
        credentialMatches: body.credential === CREDENTIAL,
        expiresAt: body.expiresAt,
        accountKind: body.accountKind,
      }).toEqual({
        keys: ['accountKind', 'credential', 'expiresAt'],
        credentialMatches: true,
        expiresAt: EXPIRES_AT,
        accountKind,
      });
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
      expect(subject.authenticateWithTelegram).toHaveBeenCalledTimes(1);
      expect(subject.nowEpochSeconds).toHaveBeenCalledTimes(1);
    },
  );

  it('passes the exact body fields and one server-generated Unix time to the service', async () => {
    subject = await createHarness();

    const response = await post(subject);

    expect(response.statusCode).toBe(200);
    expect(subject.authenticateWithTelegram).toHaveBeenCalledTimes(1);
    expect(subject.authenticateWithTelegram).toHaveBeenCalledWith({
      rawInitData: RAW_INIT_DATA,
      requestKey: REQUEST_KEY,
      now: NOW,
    });
    expect(subject.nowEpochSeconds).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['non-object body', []],
    ['missing initData', { requestKey: REQUEST_KEY }],
    ['missing requestKey', { initData: RAW_INIT_DATA }],
    ['empty initData', { initData: '', requestKey: REQUEST_KEY }],
    ['empty requestKey', { initData: RAW_INIT_DATA, requestKey: '' }],
    [
      'wrong initData type',
      { initData: 123, requestKey: REQUEST_KEY },
    ],
    [
      'wrong requestKey type',
      { initData: RAW_INIT_DATA, requestKey: 123 },
    ],
    [
      'unknown field',
      {
        initData: RAW_INIT_DATA,
        requestKey: REQUEST_KEY,
        extra: true,
      },
    ],
    [
      'client-provided now',
      {
        initData: RAW_INIT_DATA,
        requestKey: REQUEST_KEY,
        now: NOW,
      },
    ],
    [
      'requestKey with surrounding whitespace',
      { initData: RAW_INIT_DATA, requestKey: ` ${REQUEST_KEY}` },
    ],
    [
      'requestKey with a control character',
      { initData: RAW_INIT_DATA, requestKey: `${REQUEST_KEY}\n` },
    ],
    [
      'oversized requestKey',
      {
        initData: RAW_INIT_DATA,
        requestKey: 'r'.repeat(
          TELEGRAM_LOGIN_REQUEST_KEY_MAX_LENGTH + 1,
        ),
      },
    ],
  ])('rejects %s before clock and service access', async (_label, payload) => {
    subject = await createHarness();

    const response = await post(subject, payload);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      statusCode: 400,
      code: 'telegram_login_request_invalid',
      message: 'Telegram login request is invalid',
    });
    expect(subject.authenticateWithTelegram).not.toHaveBeenCalled();
    expect(subject.nowEpochSeconds).not.toHaveBeenCalled();
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('rejects initData above the 16384-byte UTF-8 boundary', async () => {
    subject = await createHarness();
    const oversized = 'я'.repeat(8_193);

    const response = await post(subject, {
      initData: oversized,
      requestKey: REQUEST_KEY,
    });

    expect(response.statusCode).toBe(400);
    expect(subject.authenticateWithTelegram).not.toHaveBeenCalled();
    expect(response.body.includes(oversized)).toBe(false);
  });

  it('returns 503 without clock or service access when the feature is disabled', async () => {
    subject = await createHarness(false);

    const response = await post(subject);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      statusCode: 503,
      code: 'telegram_authentication_unavailable',
      message: 'Telegram authentication is unavailable',
    });
    expect(subject.authenticateWithTelegram).not.toHaveBeenCalled();
    expect(subject.nowEpochSeconds).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_telegram_data', 401, 'telegram_authentication_failed'],
    ['telegram_proof_expired', 401, 'telegram_authentication_failed'],
    ['account_unavailable', 403, 'telegram_account_unavailable'],
    ['proof_replayed', 409, 'telegram_proof_replayed'],
    ['request_conflict', 409, 'telegram_authentication_conflict'],
    [
      'temporary_conflict',
      503,
      'telegram_authentication_unavailable',
    ],
    [
      'dependency_unavailable',
      503,
      'telegram_authentication_unavailable',
    ],
    [
      'internal_failure',
      500,
      'telegram_authentication_internal_error',
    ],
  ] as const)(
    'maps %s to HTTP %s with a fixed public body',
    async (reason, status, code) => {
      subject = await createHarness();
      subject.authenticateWithTelegram.mockResolvedValue(rejected(reason));

      const response = await post(subject);

      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ statusCode: status, code });
      expect(response.body.includes(RAW_INIT_DATA)).toBe(false);
      expect(response.body.includes(REQUEST_KEY)).toBe(false);
      expect(response.body.includes(CREDENTIAL)).toBe(false);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(subject.authenticateWithTelegram).toHaveBeenCalledTimes(1);
    },
  );

  it('does not expose request or credential material in errors or logs', async () => {
    subject = await createHarness();
    subject.authenticateWithTelegram.mockRejectedValue(
      new Error(CREDENTIAL),
    );

    const response = await post(subject);

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      statusCode: 500,
      code: 'telegram_authentication_internal_error',
      message: 'Telegram authentication failed',
    });
    expect(
      [RAW_INIT_DATA, REQUEST_KEY, CREDENTIAL].some((secret) =>
        response.body.includes(secret),
      ),
    ).toBe(false);
    expect(
      containsSensitiveValue(subject.logEntries, [
        RAW_INIT_DATA,
        REQUEST_KEY,
        CREDENTIAL,
      ]),
    ).toBe(false);
  });

  it.each([
    ['expired result', CREDENTIAL, NOW, 'existing'],
    [
      'invalid credential',
      'unsafe;credential-secret',
      EXPIRES_AT,
      'existing',
    ],
    ['invalid account kind', CREDENTIAL, EXPIRES_AT, 'admin'],
  ] as const)(
    'fails closed for an %s without exposing service data',
    async (_label, credential, expiresAt, accountKind) => {
      subject = await createHarness();
      subject.authenticateWithTelegram.mockResolvedValue({
        outcome: 'authenticated',
        credential,
        expiresAt,
        accountKind,
      } as unknown as TelegramLoginResult);

      const response = await post(subject);

      expect(response.statusCode).toBe(500);
      expect(response.body.includes(credential)).toBe(false);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(
        containsSensitiveValue(subject.logEntries, [credential]),
      ).toBe(false);
    },
  );
});
