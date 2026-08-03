import { UnixEpochSeconds } from '../auth/auth.types';
import { MatchNotificationId } from '../matches/match-notification.types';
import { MatchInvitationId } from '../matches/match.types';
import {
  ClaimedTelegramNotification,
  TelegramDestinationDisableReason,
  TelegramNotificationOutboxId,
  TelegramNotificationRetryFailure,
  TelegramNotificationTerminalFailure,
} from '../notifications/telegram-notification.types';
import { PostgresTransaction } from './postgres-transaction';

export interface EnqueueMatchNotificationDeliveryInput {
  readonly outboxId: TelegramNotificationOutboxId;
  readonly matchNotificationId: MatchNotificationId;
  readonly now: UnixEpochSeconds;
}

export interface EnqueueInvitationDeliveryInput {
  readonly outboxId: TelegramNotificationOutboxId;
  readonly invitationId: MatchInvitationId;
  readonly now: UnixEpochSeconds;
}

export interface ClaimTelegramNotificationInput {
  readonly now: UnixEpochSeconds;
  readonly leaseUntil: UnixEpochSeconds;
}

export interface FinalizeTelegramNotificationInput {
  readonly outboxId: TelegramNotificationOutboxId;
  readonly claimVersion: number;
  readonly now: UnixEpochSeconds;
}

export type TelegramNotificationClaimResult =
  | { readonly outcome: 'none_available' }
  | { readonly outcome: 'retry_exhausted' }
  | {
      readonly outcome: 'claimed';
      readonly notification: ClaimedTelegramNotification;
    };

export type TelegramNotificationFinalizeResult = {
  readonly outcome: 'applied' | 'stale_claim';
};

export type TelegramNotificationOutboxPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'source_conflict'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class TelegramNotificationOutboxPersistenceError extends Error {
  readonly name = 'TelegramNotificationOutboxPersistenceError';

  constructor(
    readonly reason: TelegramNotificationOutboxPersistenceFailure,
  ) {
    super('Telegram notification outbox persistence failed');
  }
}

export interface TelegramNotificationOutboxRepository {
  enqueueMatchNotification(
    transaction: PostgresTransaction,
    input: EnqueueMatchNotificationDeliveryInput,
  ): Promise<void>;

  enqueueInvitation(
    transaction: PostgresTransaction,
    input: EnqueueInvitationDeliveryInput,
  ): Promise<void>;

  claimNext(
    transaction: PostgresTransaction,
    input: ClaimTelegramNotificationInput,
  ): Promise<TelegramNotificationClaimResult>;

  markSent(
    transaction: PostgresTransaction,
    input: FinalizeTelegramNotificationInput & {
      readonly telegramMessageId: string;
    },
  ): Promise<TelegramNotificationFinalizeResult>;

  scheduleRetry(
    transaction: PostgresTransaction,
    input: FinalizeTelegramNotificationInput & {
      readonly availableAt: UnixEpochSeconds;
      readonly failure: TelegramNotificationRetryFailure;
    },
  ): Promise<TelegramNotificationFinalizeResult>;

  abandon(
    transaction: PostgresTransaction,
    input: FinalizeTelegramNotificationInput & {
      readonly failure: TelegramNotificationTerminalFailure;
      readonly disableDestination?: TelegramDestinationDisableReason;
      readonly destinationVersion?: number;
    },
  ): Promise<TelegramNotificationFinalizeResult>;
}
