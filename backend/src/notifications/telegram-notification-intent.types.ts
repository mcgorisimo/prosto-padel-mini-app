import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { MatchId } from '../matches/match.types';
import { CourtReservationId } from '../reservations/reservation.types';

export const TELEGRAM_NOTIFICATION_EVENT_TYPES = Object.freeze([
  'match_invited',
  'waitlist_slot_available',
  'match_schedule_changed',
  'match_cancelled',
  'participant_joined',
  'participant_left',
  'chat_message_created',
  'match_reminder_24h',
  'match_reminder_2h',
  'reservation_confirmed',
  'reservation_rescheduled',
  'reservation_cancelled',
] as const);

export type TelegramNotificationEventType =
  (typeof TELEGRAM_NOTIFICATION_EVENT_TYPES)[number];

export const TELEGRAM_NOTIFICATION_CATEGORIES = Object.freeze([
  'match_activity',
  'chat_messages',
  'match_reminders',
  'booking_updates',
] as const);

export type TelegramNotificationCategory =
  (typeof TELEGRAM_NOTIFICATION_CATEGORIES)[number];

export type TelegramNotificationDeepLink =
  | Readonly<{ screen: 'match'; matchId: MatchId }>
  | Readonly<{
      screen: 'booking';
      reservationId: CourtReservationId;
    }>;

export interface ClaimedTelegramNotificationIntent {
  readonly eventKey: string;
  readonly eventType: TelegramNotificationEventType;
  readonly category: TelegramNotificationCategory;
  readonly sourceVersion: number;
  readonly recipientAccountId: AccountId;
  readonly claimVersion: number;
  readonly attemptCount: number;
  readonly occurredAt: UnixEpochSeconds;
  readonly telegramChatId?: string;
  readonly destinationVersion?: number;
  readonly terminalReason?:
    'destination_unavailable' | 'preference_disabled' | 'stale_event';
  readonly deepLink: TelegramNotificationDeepLink;
}

export type TelegramNotificationRetryFailure = 'telegram_rate_limited';

export type TelegramNotificationTerminalFailure =
  | 'destination_unavailable'
  | 'preference_disabled'
  | 'stale_event'
  | 'telegram_forbidden'
  | 'telegram_bad_request'
  | 'telegram_unauthorized'
  | 'delivery_unknown'
  | 'retry_exhausted';

export type TelegramDestinationDisableReason =
  'telegram_forbidden' | 'invalid_destination';
