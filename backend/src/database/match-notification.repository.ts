import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  MatchNotificationCursor,
  MatchNotificationId,
  MatchNotificationRecord,
} from '../matches/match-notification.types';
import { MatchWaitlistEntryId } from '../matches/match-waitlist.types';
import { MatchId } from '../matches/match.types';
import { PostgresTransaction } from './postgres-transaction';

export interface ListMatchNotificationsInput {
  readonly recipientAccountId: AccountId;
  readonly limit: number;
  readonly before?: MatchNotificationCursor;
}

export interface ListMatchNotificationsResult {
  readonly outcome: 'found';
  readonly notifications: readonly MatchNotificationRecord[];
  readonly unreadCount: number;
  readonly nextCursor?: MatchNotificationCursor;
}

export interface MarkMatchNotificationReadInput {
  readonly notificationId: MatchNotificationId;
  readonly recipientAccountId: AccountId;
  readonly now: UnixEpochSeconds;
}

export type MarkMatchNotificationReadResult =
  | {
      readonly outcome: 'notification_read';
      readonly persistence: 'applied' | 'idempotent_retry';
      readonly notification: MatchNotificationRecord;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'notification_not_found';
    };

export interface CreateWaitlistPromotionNotificationInput {
  readonly notificationId: MatchNotificationId;
  readonly waitlistEntryId: MatchWaitlistEntryId;
  readonly matchId: MatchId;
  readonly recipientAccountId: AccountId;
  readonly now: UnixEpochSeconds;
}

export interface CreateWaitlistPromotionNotificationResult {
  readonly outcome: 'notification_created';
  readonly persistence: 'applied' | 'idempotent_retry';
  readonly notification: MatchNotificationRecord;
}

export type MatchNotificationPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'notification_conflict'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class MatchNotificationPersistenceError extends Error {
  readonly name = 'MatchNotificationPersistenceError';

  constructor(readonly reason: MatchNotificationPersistenceFailure) {
    super('Match notification persistence failed');
  }
}

export interface MatchNotificationRepository {
  list(
    transaction: PostgresTransaction,
    input: ListMatchNotificationsInput,
  ): Promise<ListMatchNotificationsResult>;

  markRead(
    transaction: PostgresTransaction,
    input: MarkMatchNotificationReadInput,
  ): Promise<MarkMatchNotificationReadResult>;

  createWaitlistPromotion(
    transaction: PostgresTransaction,
    input: CreateWaitlistPromotionNotificationInput,
  ): Promise<CreateWaitlistPromotionNotificationResult>;
}
