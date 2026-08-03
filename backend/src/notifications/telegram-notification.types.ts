import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { InternalUuid, isInternalUuid } from '../common/internal-uuid';
import { MatchNotificationId } from '../matches/match-notification.types';
import { MatchId, MatchInvitationId } from '../matches/match.types';

declare const telegramNotificationOutboxIdBrand: unique symbol;

export type TelegramNotificationOutboxId = InternalUuid & {
  readonly [telegramNotificationOutboxIdBrand]:
    'TelegramNotificationOutboxId';
};

export type TelegramNotificationSource =
  | {
      readonly sourceType: 'match_notification';
      readonly matchNotificationId: MatchNotificationId;
    }
  | {
      readonly sourceType: 'match_invitation';
      readonly invitationId: MatchInvitationId;
    };

export interface ClaimedTelegramNotification {
  readonly outboxId: TelegramNotificationOutboxId;
  readonly claimVersion: number;
  readonly attemptCount: number;
  readonly recipientAccountId: AccountId;
  readonly telegramChatId?: string;
  readonly destinationVersion?: number;
  readonly matchId: MatchId;
  readonly matchStartsAt: UnixEpochSeconds;
  readonly courtName: string;
  readonly sourceType: TelegramNotificationSource['sourceType'];
}

export type TelegramNotificationRetryFailure =
  | 'telegram_rate_limited'
  | 'telegram_unavailable'
  | 'network_error'
  | 'invalid_response';

export type TelegramNotificationTerminalFailure =
  | 'destination_unavailable'
  | 'telegram_forbidden'
  | 'telegram_bad_request';

export type TelegramDestinationDisableReason =
  | 'telegram_forbidden'
  | 'invalid_destination';

export function isTelegramNotificationOutboxId(
  value: unknown,
): value is TelegramNotificationOutboxId {
  return isInternalUuid(value);
}
