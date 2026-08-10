import {
  USER_ROLES,
  isAccountId,
} from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  MatchNotificationPersistenceError,
  MatchNotificationRepository,
} from '../database/match-notification.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  ListMatchNotificationsApiInput,
  ListMatchNotificationsApiResult,
  MarkMatchNotificationReadApiInput,
  MarkMatchNotificationReadApiResult,
  MatchNotificationApiActor,
  MatchNotificationApiRejection,
  MatchNotificationResponse,
} from './match-notification-api.types';
import {
  MatchNotificationRecord,
  isMatchNotificationId,
} from './match-notification.types';

export interface MatchNotificationTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface MatchNotificationServiceDependencies {
  readonly transactions: MatchNotificationTransactionExecutor;
  readonly notifications: MatchNotificationRepository;
  readonly clock: {
    nowEpochSeconds(): import('../auth/auth.types').UnixEpochSeconds;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function validActor(value: unknown): value is MatchNotificationApiActor {
  return (
    isRecord(value) &&
    isAccountId(value.accountId) &&
    typeof value.role === 'string' &&
    USER_ROLES.includes(value.role as (typeof USER_ROLES)[number])
  );
}

function rejected(reason: MatchNotificationApiRejection) {
  return Object.freeze({ outcome: 'rejected' as const, reason });
}

function mapPersistence(
  error: unknown,
): MatchNotificationApiRejection {
  if (!(error instanceof MatchNotificationPersistenceError)) {
    return 'internal_failure';
  }
  switch (error.reason) {
    case 'invalid_input':
      return 'invalid_request';
    case 'database_unavailable':
    case 'transaction_conflict':
      return 'temporary_unavailable';
    case 'invalid_persisted_state':
    case 'notification_conflict':
    case 'referential_integrity':
    case 'permission_denied':
    case 'storage_failure':
      return 'internal_failure';
  }
}

function response(
  notification: MatchNotificationRecord,
): MatchNotificationResponse {
  return Object.freeze({
    notificationId: notification.notificationId,
    matchId: notification.matchId,
    notificationType: notification.notificationType,
    createdAt: notification.createdAt,
    ...(notification.readAt === undefined
      ? {}
      : { readAt: notification.readAt }),
    ...(notification.previousTarget === undefined
      ? {}
      : { previousTarget: notification.previousTarget }),
    ...(notification.currentTarget === undefined
      ? {}
      : { currentTarget: notification.currentTarget }),
  });
}

export class MatchNotificationService {
  constructor(
    readonly dependencies: MatchNotificationServiceDependencies,
  ) {}

  async list(
    input: ListMatchNotificationsApiInput,
  ): Promise<ListMatchNotificationsApiResult> {
    const requestKeys = input?.request?.before === undefined
      ? ['limit']
      : ['limit', 'before'];
    if (
      !validActor(input) ||
      !exactKeys(input, ['accountId', 'role', 'request']) ||
      !isRecord(input.request) ||
      !exactKeys(input.request, requestKeys) ||
      !Number.isInteger(input.request.limit) ||
      input.request.limit < 1 ||
      input.request.limit > 50 ||
      (input.request.before !== undefined &&
        (!isRecord(input.request.before) ||
          !exactKeys(input.request.before, [
            'createdAt',
            'notificationId',
          ]) ||
          !isUnixEpochSeconds(input.request.before.createdAt) ||
          !isMatchNotificationId(
            input.request.before.notificationId,
          )))
    ) {
      return rejected('invalid_request');
    }
    try {
      return await this.dependencies.transactions.run(
        async (transaction) => {
          const result = await this.dependencies.notifications.list(
            transaction,
            {
              recipientAccountId: input.accountId,
              limit: input.request.limit,
              ...(input.request.before === undefined
                ? {}
                : { before: input.request.before }),
            },
          );
          return Object.freeze({
            outcome: 'found' as const,
            notifications: Object.freeze(
              result.notifications.map(response),
            ),
            unreadCount: result.unreadCount,
            ...(result.nextCursor === undefined
              ? {}
              : { nextCursor: result.nextCursor }),
          });
        },
      );
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }

  async markRead(
    input: MarkMatchNotificationReadApiInput,
  ): Promise<MarkMatchNotificationReadApiResult> {
    if (
      !validActor(input) ||
      !exactKeys(input, ['accountId', 'role', 'notificationId']) ||
      !isMatchNotificationId(input.notificationId)
    ) {
      return rejected('invalid_request');
    }
    try {
      const now = this.dependencies.clock.nowEpochSeconds();
      if (!isUnixEpochSeconds(now)) return rejected('internal_failure');
      return await this.dependencies.transactions.run(
        async (transaction) => {
          const result = await this.dependencies.notifications.markRead(
            transaction,
            {
              notificationId: input.notificationId,
              recipientAccountId: input.accountId,
              now,
            },
          );
          if (result.outcome === 'rejected') {
            return rejected(result.reason);
          }
          return Object.freeze({
            outcome: 'notification_read' as const,
            notification: response(result.notification),
          });
        },
      );
    } catch (error) {
      return rejected(mapPersistence(error));
    }
  }
}
