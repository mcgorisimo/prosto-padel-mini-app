import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { InternalUuid, isInternalUuid } from '../common/internal-uuid';
import { MatchWaitlistEntryId } from './match-waitlist.types';
import { MatchId } from './match.types';

declare const matchNotificationIdBrand: unique symbol;

export const MATCH_NOTIFICATION_TYPES = [
  'waitlist_promoted',
] as const;

export type MatchNotificationType =
  (typeof MATCH_NOTIFICATION_TYPES)[number];

export type MatchNotificationId = InternalUuid & {
  readonly [matchNotificationIdBrand]: 'MatchNotificationId';
};

export interface MatchNotificationRecord {
  readonly notificationId: MatchNotificationId;
  readonly waitlistEntryId: MatchWaitlistEntryId;
  readonly matchId: MatchId;
  readonly recipientAccountId: AccountId;
  readonly notificationType: MatchNotificationType;
  readonly createdAt: UnixEpochSeconds;
  readonly readAt?: UnixEpochSeconds;
}

export interface MatchNotificationCursor {
  readonly createdAt: UnixEpochSeconds;
  readonly notificationId: MatchNotificationId;
}

export function isMatchNotificationId(
  value: unknown,
): value is MatchNotificationId {
  return isInternalUuid(value);
}

export function isMatchNotificationType(
  value: unknown,
): value is MatchNotificationType {
  return (
    typeof value === 'string' &&
    MATCH_NOTIFICATION_TYPES.includes(
      value as MatchNotificationType,
    )
  );
}
