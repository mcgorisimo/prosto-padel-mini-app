import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  MatchNotificationCursor,
  MatchNotificationId,
  MatchNotificationType,
} from './match-notification.types';
import { MatchId } from './match.types';
import { ReservationTarget } from '../reservations/reservation.types';

export interface ListMatchNotificationsRequest {
  readonly limit: number;
  readonly before?: MatchNotificationCursor;
}

export interface MatchNotificationApiActor {
  readonly accountId: AccountId;
  readonly role: 'player' | 'club_admin';
}

export interface ListMatchNotificationsApiInput
  extends MatchNotificationApiActor {
  readonly request: ListMatchNotificationsRequest;
}

export interface MarkMatchNotificationReadApiInput
  extends MatchNotificationApiActor {
  readonly notificationId: MatchNotificationId;
}

export interface MatchNotificationResponse {
  readonly notificationId: MatchNotificationId;
  readonly matchId: MatchId;
  readonly notificationType: MatchNotificationType;
  readonly createdAt: UnixEpochSeconds;
  readonly readAt?: UnixEpochSeconds;
  readonly previousTarget?: ReservationTarget;
  readonly currentTarget?: ReservationTarget;
}

export type MatchNotificationApiRejection =
  | 'invalid_request'
  | 'notification_not_found'
  | 'temporary_unavailable'
  | 'internal_failure';

export type ListMatchNotificationsApiResult =
  | {
      readonly outcome: 'found';
      readonly notifications: readonly MatchNotificationResponse[];
      readonly unreadCount: number;
      readonly nextCursor?: MatchNotificationCursor;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchNotificationApiRejection;
    };

export type MarkMatchNotificationReadApiResult =
  | {
      readonly outcome: 'notification_read';
      readonly notification: MatchNotificationResponse;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchNotificationApiRejection;
    };
