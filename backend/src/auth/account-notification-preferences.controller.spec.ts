import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from './auth.types';
import { AccountNotificationPreferencesController } from './account-notification-preferences.controller';
import { AccountNotificationPreferencesService } from './account-notification-preferences.service';
import {
  ReadOwnAccountNotificationPreferencesResult,
  UpdateOwnAccountNotificationPreferencesResult,
} from './account-notification-preferences.types';
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

const ROUTE = '/api/v1/notification-preferences/me';
const CREDENTIAL = Buffer.alloc(32, 0x61).toString('base64url');
const ACCOUNT_ID = deterministicUuid(
  'notification-preferences-controller-account',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const EXPIRES_AT = unixEpochSeconds(NOW + 3_600);
const PRIVATE_MARKER = 'SYNTHETIC_NOTIFICATION_PREFERENCES_HTTP_PRIVATE';

interface Harness {
  readonly app: NestFastifyApplication;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [SessionAuthenticationInput]
  >;
  readonly readOwnPreferences: jest.Mock<
    Promise<ReadOwnAccountNotificationPreferencesResult>,
    [
      {
        readonly accountId: AccountId;
        readonly role: 'player' | 'club_admin';
      },
    ]
  >;
  readonly updateOwnPreferences: jest.Mock<
    Promise<UpdateOwnAccountNotificationPreferencesResult>,
    [
      {
        readonly accountId: AccountId;
        readonly role: 'player' | 'club_admin';
        readonly patch: {
          readonly telegramMatchNotificationsEnabled: boolean;
          readonly expectedVersion: number | null;
        };
      },
    ]
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
  const readOwnPreferences = jest
    .fn<
      Promise<ReadOwnAccountNotificationPreferencesResult>,
      [
        {
          readonly accountId: AccountId;
          readonly role: 'player' | 'club_admin';
        },
      ]
    >()
    .mockResolvedValue({
      outcome: 'found',
      preferences: {
        telegramMatchNotificationsEnabled: true,
        version: null,
      },
    });
  const updateOwnPreferences = jest
    .fn<
      Promise<UpdateOwnAccountNotificationPreferencesResult>,
      [
        {
          readonly accountId: AccountId;
          readonly role: 'player' | 'club_admin';
          readonly patch: {
            readonly telegramMatchNotificationsEnabled: boolean;
            readonly expectedVersion: number | null;
          };
        },
      ]
    >()
    .mockResolvedValue({
      outcome: 'updated',
      preferences: {
        telegramMatchNotificationsEnabled: false,
        version: 1,
      },
    });
  const moduleRef = await Test.createTestingModule({
    controllers: [AccountNotificationPreferencesController],
    providers: [
      SessionBearerGuard,
      {
        provide: SessionAuthenticationService,
        useValue: { authenticate },
      },
      {
        provide: AccountNotificationPreferencesService,
        useValue: { readOwnPreferences, updateOwnPreferences },
      },
      {
        provide: SESSION_AUTHENTICATION_CLOCK,
        useValue: {
          nowEpochSeconds: () => NOW,
        } satisfies SessionAuthenticationClock,
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
    readOwnPreferences,
    updateOwnPreferences,
    logs,
  };
}

function inject(
  harness: Harness,
  method: 'GET' | 'PATCH',
  authorization?: string,
  payload?: unknown,
  suffix = '',
  cookie?: string,
) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }
  if (payload !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (cookie !== undefined) {
    headers.cookie = cookie;
  }
  return harness.app.inject({
    method,
    url: `${ROUTE}${suffix}`,
    headers,
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}

function expectNoStore(response: {
  readonly headers: Record<string, string | string[] | number | undefined>;
}): void {
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers.pragma).toBe('no-cache');
}

describe('AccountNotificationPreferencesController HTTP boundary', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
    jest.restoreAllMocks();
  });

  it('returns the own-account effective default through bearer auth only', async () => {
    const response = await inject(harness, 'GET', `Bearer ${CREDENTIAL}`);

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({
      telegramMatchNotificationsEnabled: true,
      version: null,
    });
    expect(harness.authenticate).toHaveBeenCalledWith({
      credential: CREDENTIAL,
      now: NOW,
    });
    expect(harness.readOwnPreferences).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
    });
    expect(response.body).not.toContain(CREDENTIAL);
  });

  it.each([
    undefined,
    CREDENTIAL,
    `bearer ${CREDENTIAL}`,
    `Bearer  ${CREDENTIAL}`,
    `Basic ${CREDENTIAL}`,
  ])('rejects non-canonical bearer auth %p', async (authorization) => {
    const response = await inject(harness, 'GET', authorization);
    expect(response.statusCode).toBe(401);
    expectNoStore(response);
    expect(response.json()).toMatchObject({ code: 'session_invalid' });
    expect(harness.readOwnPreferences).not.toHaveBeenCalled();
  });

  it('does not accept account or credential selectors outside the bearer principal', async () => {
    const response = await inject(
      harness,
      'PATCH',
      undefined,
      {
        telegramMatchNotificationsEnabled: false,
        expectedVersion: null,
      },
      `?accountId=${ACCOUNT_ID}&credential=${CREDENTIAL}`,
      `credential=${CREDENTIAL}`,
    );
    expect(response.statusCode).toBe(401);
    expect(harness.authenticate).not.toHaveBeenCalled();
    expect(harness.updateOwnPreferences).not.toHaveBeenCalled();
  });

  it('patches only the bearer account with an exact optimistic body', async () => {
    const body = {
      telegramMatchNotificationsEnabled: false,
      expectedVersion: null,
    };
    const response = await inject(
      harness,
      'PATCH',
      `Bearer ${CREDENTIAL}`,
      body,
    );

    expect(response.statusCode).toBe(200);
    expectNoStore(response);
    expect(response.json()).toEqual({
      telegramMatchNotificationsEnabled: false,
      version: 1,
    });
    expect(harness.updateOwnPreferences).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      patch: body,
    });
  });

  it.each([
    null,
    {},
    { telegramMatchNotificationsEnabled: false },
    {
      telegramMatchNotificationsEnabled: false,
      expectedVersion: 0,
    },
    {
      telegramMatchNotificationsEnabled: false,
      expectedVersion: 1.5,
    },
    {
      telegramMatchNotificationsEnabled: false,
      expectedVersion: null,
      accountId: ACCOUNT_ID,
    },
  ])(
    'rejects invalid PATCH body without preference storage: %p',
    async (body) => {
      const response = await inject(
        harness,
        'PATCH',
        `Bearer ${CREDENTIAL}`,
        body,
      );
      expect(response.statusCode).toBe(400);
      expectNoStore(response);
      expect(response.json()).toEqual({
        statusCode: 400,
        code: 'notification_preferences_invalid_request',
        message: 'Notification preferences update is invalid',
      });
      expect(harness.updateOwnPreferences).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['version_conflict', 409, 'notification_preferences_version_conflict'],
    [
      'temporary_unavailable',
      503,
      'notification_preferences_service_unavailable',
    ],
    ['invalid_request', 500, 'notification_preferences_internal_error'],
    ['internal_failure', 500, 'notification_preferences_internal_error'],
  ] as const)(
    'maps PATCH rejection %s to safe HTTP %d',
    async (reason, statusCode, code) => {
      harness.updateOwnPreferences.mockResolvedValue({
        outcome: 'rejected',
        reason,
      });
      const response = await inject(harness, 'PATCH', `Bearer ${CREDENTIAL}`, {
        telegramMatchNotificationsEnabled: true,
        expectedVersion: 4,
      });
      expect(response.statusCode).toBe(statusCode);
      expectNoStore(response);
      expect(response.json()).toMatchObject({ statusCode, code });
    },
  );

  it('fails closed without exposing thrown service details', async () => {
    harness.readOwnPreferences.mockRejectedValue(
      new Error(`${PRIVATE_MARKER}:${CREDENTIAL}:telegram-chat-id`),
    );
    const response = await inject(harness, 'GET', `Bearer ${CREDENTIAL}`);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      statusCode: 500,
      code: 'notification_preferences_internal_error',
      message: 'Notification preferences request failed',
    });
    const output = JSON.stringify({
      response: response.json(),
      logs: harness.logs,
    });
    expect(output).not.toContain(PRIVATE_MARKER);
    expect(output).not.toContain(CREDENTIAL);
    expect(output).not.toContain('telegram-chat-id');
  });
});
