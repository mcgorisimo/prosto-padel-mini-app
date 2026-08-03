import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  SESSION_AUTHENTICATION_CLOCK,
  SessionBearerGuard,
} from '../auth/session-authentication.guard';
import { SessionAuthenticationService } from '../auth/session-authentication.service';
import { SessionAuthenticationResult } from '../auth/session-authentication.types';
import {
  ListMatchNotificationsApiResult,
  MarkMatchNotificationReadApiResult,
} from './match-notification-api.types';
import { MatchNotificationController } from './match-notification.controller';
import { MatchNotificationService } from './match-notification.service';
import { MatchNotificationId } from './match-notification.types';
import { MatchId } from './match.types';

const CREDENTIAL = Buffer.alloc(32, 0x6e).toString('base64url');
const ACCOUNT_ID = deterministicUuid(
  'notification-controller-account',
) as AccountId;
const MATCH_ID = deterministicUuid(
  'notification-controller-match',
) as MatchId;
const NOTIFICATION_ID = deterministicUuid(
  'notification-controller-id',
) as MatchNotificationId;
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_NOTIFICATION_VALUE';

function responseNotification() {
  return {
    notificationId: NOTIFICATION_ID,
    matchId: MATCH_ID,
    notificationType: 'waitlist_promoted' as const,
    createdAt: NOW,
  };
}

interface Harness {
  readonly app: NestFastifyApplication;
  readonly list: jest.Mock<
    Promise<ListMatchNotificationsApiResult>,
    [unknown]
  >;
  readonly markRead: jest.Mock<
    Promise<MarkMatchNotificationReadApiResult>,
    [unknown]
  >;
  readonly authenticate: jest.Mock<
    Promise<SessionAuthenticationResult>,
    [unknown]
  >;
  readonly logs: readonly unknown[][];
}

async function createHarness(): Promise<Harness> {
  const list = jest
    .fn<Promise<ListMatchNotificationsApiResult>, [unknown]>()
    .mockResolvedValue({
      outcome: 'found',
      notifications: [responseNotification()],
      unreadCount: 1,
      nextCursor: {
        createdAt: NOW,
        notificationId: NOTIFICATION_ID,
      },
    });
  const markRead = jest
    .fn<Promise<MarkMatchNotificationReadApiResult>, [unknown]>()
    .mockResolvedValue({
      outcome: 'notification_read',
      notification: { ...responseNotification(), readAt: NOW },
    });
  const authenticate = jest
    .fn<Promise<SessionAuthenticationResult>, [unknown]>()
    .mockResolvedValue({
      outcome: 'authenticated',
      principal: {
        accountId: ACCOUNT_ID,
        role: 'player',
        expiresAt: unixEpochSeconds(Number(NOW) + 3_600),
      },
    });
  const moduleRef = await Test.createTestingModule({
    controllers: [MatchNotificationController],
    providers: [
      SessionBearerGuard,
      {
        provide: MatchNotificationService,
        useValue: { list, markRead },
      },
      {
        provide: SessionAuthenticationService,
        useValue: { authenticate },
      },
      {
        provide: SESSION_AUTHENTICATION_CLOCK,
        useValue: { nowEpochSeconds: () => NOW },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  const logs: unknown[][] = [];
  const capture = (...values: unknown[]) => logs.push(values);
  app.useLogger({
    log: capture,
    error: capture,
    warn: capture,
    debug: capture,
    verbose: capture,
    fatal: capture,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, list, markRead, authenticate, logs };
}

function headers() {
  return { authorization: `Bearer ${CREDENTIAL}` };
}

describe('MatchNotificationController', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
  });

  it('serves bearer-protected keyset reads and idempotent mark-read', async () => {
    const listed = await harness.app.inject({
      method: 'GET',
      url:
        `/match-notifications?limit=20&beforeCreatedAt=${NOW}` +
        `&beforeNotificationId=${NOTIFICATION_ID}`,
      headers: headers(),
    });
    const marked = await harness.app.inject({
      method: 'POST',
      url: `/match-notifications/${NOTIFICATION_ID}/read`,
      headers: headers(),
      payload: {},
    });

    expect(listed.statusCode).toBe(200);
    expect(marked.statusCode).toBe(200);
    for (const response of [listed, marked]) {
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
    }
    expect(harness.list).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      request: {
        limit: 20,
        before: {
          createdAt: NOW,
          notificationId: NOTIFICATION_ID,
        },
      },
    });
    expect(harness.markRead).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      role: 'player',
      notificationId: NOTIFICATION_ID,
    });
    expect(harness.authenticate).toHaveBeenCalledTimes(2);
  });

  it('rejects missing bearer and malformed inputs before the service', async () => {
    const missing = await harness.app.inject({
      method: 'GET',
      url: '/match-notifications',
    });
    const partialCursor = await harness.app.inject({
      method: 'GET',
      url: `/match-notifications?beforeCreatedAt=${NOW}`,
      headers: headers(),
    });
    const leaked = await harness.app.inject({
      method: 'POST',
      url: `/match-notifications/${NOTIFICATION_ID}/read`,
      headers: headers(),
      payload: { private: PRIVATE_MARKER },
    });
    expect(missing.statusCode).toBe(401);
    expect(partialCursor.statusCode).toBe(400);
    expect(leaked.statusCode).toBe(400);
    expect(harness.list).not.toHaveBeenCalled();
    expect(harness.markRead).not.toHaveBeenCalled();
    expect(JSON.stringify(leaked.json())).not.toContain(PRIVATE_MARKER);
    expect(JSON.stringify(harness.logs)).not.toContain(PRIVATE_MARKER);
  });

  it.each([
    ['notification_not_found', 404, 'match_notification_not_found'],
    [
      'temporary_unavailable',
      503,
      'match_notification_service_unavailable',
    ],
    ['internal_failure', 500, 'match_notification_internal_error'],
  ] as const)(
    'maps %s to a safe public response',
    async (reason, statusCode, code) => {
      harness.markRead.mockResolvedValueOnce({
        outcome: 'rejected',
        reason,
      });
      const response = await harness.app.inject({
        method: 'POST',
        url: `/match-notifications/${NOTIFICATION_ID}/read`,
        headers: headers(),
        payload: {},
      });
      expect(response.statusCode).toBe(statusCode);
      expect(response.json()).toMatchObject({ statusCode, code });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.pragma).toBe('no-cache');
    },
  );
});
