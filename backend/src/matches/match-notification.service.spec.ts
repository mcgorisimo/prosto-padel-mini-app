import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  MatchNotificationPersistenceError,
  MatchNotificationRepository,
} from '../database/match-notification.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  MatchNotificationId,
  MatchNotificationRecord,
} from './match-notification.types';
import { MatchNotificationService } from './match-notification.service';
import { MatchWaitlistEntryId } from './match-waitlist.types';
import { MatchId } from './match.types';

const ACCOUNT_ID = deterministicUuid(
  'notification-service-account',
) as AccountId;
const MATCH_ID = deterministicUuid(
  'notification-service-match',
) as MatchId;
const ENTRY_ID = deterministicUuid(
  'notification-service-entry',
) as MatchWaitlistEntryId;
const NOTIFICATION_ID = deterministicUuid(
  'notification-service-id',
) as MatchNotificationId;
const NOW = unixEpochSeconds(1_800_000_000);
const transaction = Object.freeze({
  query: jest.fn(),
}) as unknown as PostgresTransaction;

function notification(
  overrides: Partial<MatchNotificationRecord> = {},
): MatchNotificationRecord {
  return Object.freeze({
    notificationId: NOTIFICATION_ID,
    waitlistEntryId: ENTRY_ID,
    matchId: MATCH_ID,
    recipientAccountId: ACCOUNT_ID,
    notificationType: 'waitlist_promoted',
    createdAt: NOW,
    ...overrides,
  });
}

function repository(): jest.Mocked<MatchNotificationRepository> {
  return {
    list: jest.fn(),
    markRead: jest.fn(),
    createWaitlistPromotion: jest.fn(),
  };
}

function harness(notifications = repository()) {
  return {
    notifications,
    service: new MatchNotificationService({
      transactions: {
        run: (operation) => operation(transaction),
      },
      notifications,
      clock: { nowEpochSeconds: () => NOW },
    }),
  };
}

function actor() {
  return {
    accountId: ACCOUNT_ID,
    role: 'player' as const,
  };
}

describe('MatchNotificationService', () => {
  it('lists a private keyset page without exposing storage bindings', async () => {
    const test = harness();
    test.notifications.list.mockResolvedValue({
      outcome: 'found',
      notifications: [notification()],
      unreadCount: 1,
      nextCursor: {
        createdAt: NOW,
        notificationId: NOTIFICATION_ID,
      },
    });

    await expect(test.service.list({
      ...actor(),
      request: { limit: 20 },
    })).resolves.toEqual({
      outcome: 'found',
      notifications: [{
        notificationId: NOTIFICATION_ID,
        matchId: MATCH_ID,
        notificationType: 'waitlist_promoted',
        createdAt: NOW,
      }],
      unreadCount: 1,
      nextCursor: {
        createdAt: NOW,
        notificationId: NOTIFICATION_ID,
      },
    });
    expect(test.notifications.list).toHaveBeenCalledWith(transaction, {
      recipientAccountId: ACCOUNT_ID,
      limit: 20,
    });
    expect(JSON.stringify((await test.service.list({
      ...actor(),
      request: { limit: 20 },
    })))).not.toContain(ENTRY_ID);
  });

  it('marks a notification read using server time', async () => {
    const test = harness();
    test.notifications.markRead.mockResolvedValue({
      outcome: 'notification_read',
      persistence: 'applied',
      notification: notification({ readAt: NOW }),
    });
    await expect(test.service.markRead({
      ...actor(),
      notificationId: NOTIFICATION_ID,
    })).resolves.toEqual({
      outcome: 'notification_read',
      notification: {
        notificationId: NOTIFICATION_ID,
        matchId: MATCH_ID,
        notificationType: 'waitlist_promoted',
        createdAt: NOW,
        readAt: NOW,
      },
    });
    expect(test.notifications.markRead).toHaveBeenCalledWith(
      transaction,
      {
        notificationId: NOTIFICATION_ID,
        recipientAccountId: ACCOUNT_ID,
        now: NOW,
      },
    );
  });

  it('maps a foreign notification to the same safe not-found result', async () => {
    const test = harness();
    test.notifications.markRead.mockResolvedValue({
      outcome: 'rejected',
      reason: 'notification_not_found',
    });
    await expect(test.service.markRead({
      ...actor(),
      notificationId: NOTIFICATION_ID,
    })).resolves.toEqual({
      outcome: 'rejected',
      reason: 'notification_not_found',
    });
  });

  it.each([
    ['database_unavailable', 'temporary_unavailable'],
    ['transaction_conflict', 'temporary_unavailable'],
    ['permission_denied', 'internal_failure'],
    ['invalid_persisted_state', 'internal_failure'],
  ] as const)(
    'maps persistence %s to safe %s',
    async (reason, expected) => {
      const test = harness();
      test.notifications.list.mockRejectedValue(
        new MatchNotificationPersistenceError(reason),
      );
      await expect(test.service.list({
        ...actor(),
        request: { limit: 20 },
      })).resolves.toEqual({
        outcome: 'rejected',
        reason: expected,
      });
    },
  );

  it('rejects malformed actors, cursors and notification IDs before storage', async () => {
    const test = harness();
    await expect(test.service.list({
      accountId: 'invalid' as AccountId,
      role: 'player',
      request: { limit: 20 },
    })).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    await expect(test.service.markRead({
      ...actor(),
      notificationId: 'invalid' as MatchNotificationId,
    })).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    await expect(test.service.list({
      ...actor(),
      request: { limit: 20, unexpected: true },
    } as never)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    await expect(test.service.list({
      ...actor(),
      request: {
        limit: 20,
        before: {
          createdAt: NOW,
          notificationId: NOTIFICATION_ID,
          unexpected: true,
        },
      },
    } as never)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    await expect(test.service.markRead({
      ...actor(),
      notificationId: NOTIFICATION_ID,
      unexpected: true,
    } as never)).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(test.notifications.list).not.toHaveBeenCalled();
    expect(test.notifications.markRead).not.toHaveBeenCalled();
  });
});
