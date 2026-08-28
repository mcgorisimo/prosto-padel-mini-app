import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { MatchId } from '../matches/match.types';
import {
  ClaimedTelegramNotificationIntent,
  TelegramDestinationDisableReason,
  TelegramNotificationCategory,
  TelegramNotificationEventType,
  TelegramNotificationRetryFailure,
  TelegramNotificationTerminalFailure,
} from '../notifications/telegram-notification-intent.types';
import { CourtReservationId } from '../reservations/reservation.types';
import { PostgresTransaction } from './postgres-transaction';

export interface TelegramNotificationIntentBase {
  readonly eventKey: string;
  readonly eventType: TelegramNotificationEventType;
  readonly category: TelegramNotificationCategory;
  readonly sourceId: string;
  readonly sourceVersion: number;
  readonly occurredAt: UnixEpochSeconds;
  readonly matchId?: MatchId;
  readonly reservationId?: CourtReservationId;
}

export interface EnqueueDirectTelegramNotificationIntentInput extends TelegramNotificationIntentBase {
  readonly recipientAccountId: AccountId;
}

export interface EnqueueMatchAudienceTelegramNotificationIntentInput extends TelegramNotificationIntentBase {
  readonly matchId: MatchId;
  readonly excludeAccountId?: AccountId;
}

export interface ClaimTelegramNotificationIntentInput {
  readonly now: UnixEpochSeconds;
  readonly leaseUntil: UnixEpochSeconds;
}

export interface FinalizeTelegramNotificationIntentInput {
  readonly eventKey: string;
  readonly recipientAccountId: AccountId;
  readonly claimVersion: number;
  readonly now: UnixEpochSeconds;
}

export type TelegramNotificationIntentClaimResult =
  | Readonly<{ outcome: 'none_available' }>
  | Readonly<{ outcome: 'retry_exhausted' }>
  | Readonly<{
      outcome: 'claimed';
      intent: ClaimedTelegramNotificationIntent;
    }>;

export type TelegramNotificationIntentFinalizeResult = Readonly<{
  outcome: 'applied' | 'stale_claim';
}>;

export type TelegramNotificationIntentPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'event_conflict'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class TelegramNotificationIntentPersistenceError extends Error {
  readonly name = 'TelegramNotificationIntentPersistenceError';

  constructor(readonly reason: TelegramNotificationIntentPersistenceFailure) {
    super('Telegram notification intent persistence failed');
  }
}

export interface TelegramNotificationIntentRepository {
  enqueueDirect(
    transaction: PostgresTransaction,
    input: EnqueueDirectTelegramNotificationIntentInput,
  ): Promise<void>;

  enqueueMatchOwner(
    transaction: PostgresTransaction,
    input: TelegramNotificationIntentBase & { readonly matchId: MatchId },
  ): Promise<void>;

  enqueueMatchAudience(
    transaction: PostgresTransaction,
    input: EnqueueMatchAudienceTelegramNotificationIntentInput,
  ): Promise<number>;

  enqueueDueReminders(
    transaction: PostgresTransaction,
    input: Readonly<{
      now: UnixEpochSeconds;
      matchLimit: number;
    }>,
  ): Promise<number>;

  claimNext(
    transaction: PostgresTransaction,
    input: ClaimTelegramNotificationIntentInput,
  ): Promise<TelegramNotificationIntentClaimResult>;

  markSent(
    transaction: PostgresTransaction,
    input: FinalizeTelegramNotificationIntentInput & {
      readonly telegramMessageId: string;
    },
  ): Promise<TelegramNotificationIntentFinalizeResult>;

  scheduleRetry(
    transaction: PostgresTransaction,
    input: FinalizeTelegramNotificationIntentInput & {
      readonly availableAt: UnixEpochSeconds;
      readonly failure: TelegramNotificationRetryFailure;
    },
  ): Promise<TelegramNotificationIntentFinalizeResult>;

  abandon(
    transaction: PostgresTransaction,
    input: FinalizeTelegramNotificationIntentInput & {
      readonly failure: TelegramNotificationTerminalFailure;
      readonly disableDestination?: TelegramDestinationDisableReason;
      readonly destinationVersion?: number;
    },
  ): Promise<TelegramNotificationIntentFinalizeResult>;
}
