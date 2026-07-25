import fastifyCookie from '@fastify/cookie';
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
  TELEGRAM_SESSION_COOKIE_NAME,
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
const REQUEST_KEY = '12345678-1234-4678-9234-5678123456ab';
const OTHER_REQUEST_KEY = '22345678-1234-4678-9234-5678123456ab';
const RAW_INIT_DATA = '  query_id=test%20value&hash=fake  ';
const CREDENTIAL = Buffer.alloc(32, 0x5a).toString('base64url');

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
}

function authenticatedResult(
  credential = CREDENTIAL,
  expiresAt: unknown = EXPIRES_AT,
): TelegramLoginResult {
  return {
    outcome: 'authenticated',
    credential,
    expiresAt: expiresAt as typeof EXPIRES_AT,
    accountKind: 'existing',
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
  await app.register(fastifyCookie);
  app.setGlobalPrefix('api/v1');
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, authenticateWithTelegram, nowEpochSeconds };
}

async function post(
  subject: HttpHarness,
  payload: unknown = { initData: RAW_INIT_DATA },
  idempotencyKey: string | string[] | null = REQUEST_KEY,
) {
  const headers =
    idempotencyKey === null
      ? undefined
      : { 'idempotency-key': idempotencyKey };
  return subject.app.inject({
    method: 'POST',
    url: ROUTE,
    headers,
    payload: payload as object,
  });
}

function expectNoCookie(response: Awaited<ReturnType<typeof post>>): void {
  expect(response.headers['set-cookie']).toBeUndefined();
}

function rejected(reason: TelegramLoginRejectionReason): TelegramLoginResult {
  return { outcome: 'rejected', reason };
}

describe('TelegramLoginController HTTP boundary', () => {
  let subject: HttpHarness | undefined;

  afterEach(async () => {
    await subject?.app.close();
    subject = undefined;
  });

  it('accepts the exact body and passes one controlled now to the service', async () => {
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
    ['missing initData', {}],
    ['empty initData', { initData: '' }],
    ['null initData', { initData: null }],
    ['numeric initData', { initData: 123 }],
    ['object initData', { initData: { raw: 'secret' } }],
    ['array initData', { initData: ['secret'] }],
    ['unknown body field', { initData: RAW_INIT_DATA, extra: true }],
  ])('rejects %s before calling the service', async (_label, payload) => {
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
    expectNoCookie(response);
  });

  it('rejects initData above the 16384-byte UTF-8 boundary', async () => {
    subject = await createHarness();
    const oversized = 'я'.repeat(8_193);

    const response = await post(subject, { initData: oversized });

    expect(response.statusCode).toBe(400);
    expect(subject.authenticateWithTelegram).not.toHaveBeenCalled();
    expect(response.body).not.toContain(oversized);
    expectNoCookie(response);
  });

  it.each([
    ['missing', null],
    ['uppercase', REQUEST_KEY.toUpperCase()],
    ['malformed', 'not-a-uuid'],
  ])(
    'rejects a %s idempotency key',
    async (_label, idempotencyKey) => {
      subject = await createHarness();

      const response = await post(
        subject,
        { initData: RAW_INIT_DATA },
        idempotencyKey,
      );

      expect(response.statusCode).toBe(400);
      expect(subject.authenticateWithTelegram).not.toHaveBeenCalled();
      expect(response.body).not.toContain(idempotencyKey ?? RAW_INIT_DATA);
      expectNoCookie(response);
    },
  );

  it('rejects repeated idempotency key header values', async () => {
    subject = await createHarness();

    const response = await post(
      subject,
      { initData: RAW_INIT_DATA },
      [REQUEST_KEY, OTHER_REQUEST_KEY],
    );

    expect(response.statusCode).toBe(400);
    expect(subject.authenticateWithTelegram).not.toHaveBeenCalled();
    expectNoCookie(response);
  });

  it('returns 503 without service access or cookie when the feature is disabled', async () => {
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
    expectNoCookie(response);
  });

  it('sets the host-only secure session cookie and returns only safe data', async () => {
    subject = await createHarness();

    const response = await post(subject);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      authenticated: true,
      sessionExpiresAt: EXPIRES_AT,
    });
    expect(Object.keys(response.json()).sort()).toEqual(
      ['authenticated', 'sessionExpiresAt'].sort(),
    );
    expect(response.body).not.toContain(CREDENTIAL);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');

    const cookie = response.headers['set-cookie'];
    expect(typeof cookie).toBe('string');
    const serialized = String(cookie);
    expect(serialized).toContain(
      `${TELEGRAM_SESSION_COOKIE_NAME}=${CREDENTIAL}`,
    );
    expect(serialized).toContain('HttpOnly');
    expect(serialized).toContain('Secure');
    expect(serialized).toContain('SameSite=Lax');
    expect(serialized).toContain('Path=/');
    expect(serialized).toContain('Max-Age=3600');
    expect(serialized).toContain(
      `Expires=${new Date(EXPIRES_AT * 1_000).toUTCString()}`,
    );
    expect(serialized).not.toContain('Domain=');
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
    'maps %s to HTTP %s without sensitive response data',
    async (reason, status, code) => {
      subject = await createHarness();
      subject.authenticateWithTelegram.mockResolvedValue(rejected(reason));

      const response = await post(subject);

      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ statusCode: status, code });
      expect(response.body).not.toContain(RAW_INIT_DATA);
      expect(response.body).not.toContain(REQUEST_KEY);
      expect(response.body).not.toContain(CREDENTIAL);
      expectNoCookie(response);
    },
  );

  it('maps an unexpected service exception to a fixed internal error', async () => {
    subject = await createHarness();
    const secretMarker = 'raw-service-error-secret';
    subject.authenticateWithTelegram.mockRejectedValue(
      new Error(secretMarker),
    );

    const response = await post(subject);

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      statusCode: 500,
      code: 'telegram_authentication_internal_error',
      message: 'Telegram authentication failed',
    });
    expect(response.body).not.toContain(secretMarker);
    expectNoCookie(response);
  });

  it.each([
    ['expired', CREDENTIAL, NOW],
    ['unsafe expiry overflow', CREDENTIAL, Number.MAX_SAFE_INTEGER],
    ['invalid credential', 'unsafe;credential-secret', EXPIRES_AT],
  ])(
    'rejects %s without setting a cookie',
    async (_label, credential, expiresAt) => {
      subject = await createHarness();
      subject.authenticateWithTelegram.mockResolvedValue(
        authenticatedResult(credential, expiresAt),
      );

      const response = await post(subject);

      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain(credential);
      expectNoCookie(response);
    },
  );
});
