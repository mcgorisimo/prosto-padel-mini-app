import { isUnixEpochSeconds } from '../auth/auth.types';
import { ListMatchNotificationsRequest } from './match-notification-api.types';
import { isMatchNotificationId } from './match-notification.types';

const INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function readEpoch(value: unknown) {
  if (typeof value !== 'string' || !INTEGER_PATTERN.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return isUnixEpochSeconds(parsed) ? parsed : undefined;
}

export function readMatchNotificationsRequest(
  value: unknown,
): ListMatchNotificationsRequest | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) =>
        ![
          'limit',
          'beforeCreatedAt',
          'beforeNotificationId',
        ].includes(key),
    )
  ) {
    return undefined;
  }

  const rawLimit = value.limit ?? '50';
  if (
    typeof rawLimit !== 'string' ||
    !/^(?:[1-9]|[1-4][0-9]|50)$/u.test(rawLimit)
  ) {
    return undefined;
  }

  const hasCreatedAt = value.beforeCreatedAt !== undefined;
  const hasNotificationId = value.beforeNotificationId !== undefined;
  if (hasCreatedAt !== hasNotificationId) return undefined;
  if (!hasCreatedAt) {
    return Object.freeze({ limit: Number(rawLimit) });
  }

  const createdAt = readEpoch(value.beforeCreatedAt);
  if (
    createdAt === undefined ||
    !isMatchNotificationId(value.beforeNotificationId)
  ) {
    return undefined;
  }
  return Object.freeze({
    limit: Number(rawLimit),
    before: Object.freeze({
      createdAt,
      notificationId: value.beforeNotificationId,
    }),
  });
}

export function readMatchNotificationId(value: unknown) {
  return isMatchNotificationId(value) ? value : undefined;
}

export function readMarkMatchNotificationRequest(
  value: unknown,
): Readonly<Record<string, never>> | undefined {
  if (value === undefined) return Object.freeze({});
  if (!isRecord(value) || Object.keys(value).length !== 0) {
    return undefined;
  }
  return Object.freeze({});
}
