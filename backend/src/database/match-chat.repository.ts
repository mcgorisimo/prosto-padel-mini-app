import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  MatchMessageCommandId,
  MatchMessageCursor,
  MatchMessageId,
  MatchMessageRecord,
  MatchMessageRequestDigest,
} from '../matches/match-chat.types';
import { MatchId } from '../matches/match.types';
import { PostgresTransaction } from './postgres-transaction';

export interface ListMatchMessagesInput {
  readonly matchId: MatchId;
  readonly actorAccountId: AccountId;
  readonly limit: number;
  readonly before?: MatchMessageCursor;
}

export type ListMatchMessagesResult =
  | {
      readonly outcome: 'found';
      readonly messages: readonly MatchMessageRecord[];
      readonly nextCursor?: MatchMessageCursor;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'match_not_found';
    };

export type MatchChatSenderRecord =
  | {
      readonly senderAccountId: AccountId;
      readonly availability: 'available';
      readonly firstName: string;
      readonly lastName?: string;
      readonly username?: string;
      readonly rating: number;
      readonly isVerified: boolean;
    }
  | {
      readonly senderAccountId: AccountId;
      readonly availability: 'unavailable';
    };

export interface ReadMatchChatSendersInput {
  readonly senderAccountIds: readonly AccountId[];
}

export interface ReadMatchChatSendersResult {
  readonly outcome: 'found';
  readonly senders: readonly MatchChatSenderRecord[];
}

export interface SendMatchMessageInput {
  readonly commandId: MatchMessageCommandId;
  readonly messageId: MatchMessageId;
  readonly matchId: MatchId;
  readonly actorAccountId: AccountId;
  readonly requestDigest: MatchMessageRequestDigest;
  readonly body: string;
  readonly now: UnixEpochSeconds;
}

export type SendMatchMessageResult =
  | {
      readonly outcome: 'message_sent';
      readonly persistence: 'applied' | 'idempotent_retry';
      readonly message: MatchMessageRecord;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'match_not_found'
        | 'match_closed'
        | 'command_reuse_conflict';
    };

export type MatchChatPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'command_conflict'
  | 'message_conflict'
  | 'referential_integrity'
  | 'storage_failure';

export class MatchChatPersistenceError extends Error {
  readonly name = 'MatchChatPersistenceError';

  constructor(readonly reason: MatchChatPersistenceFailure) {
    super('Match chat persistence failed');
  }
}

export interface MatchChatRepository {
  list(
    transaction: PostgresTransaction,
    input: ListMatchMessagesInput,
  ): Promise<ListMatchMessagesResult>;

  readSenders(
    transaction: PostgresTransaction,
    input: ReadMatchChatSendersInput,
  ): Promise<ReadMatchChatSendersResult>;

  send(
    transaction: PostgresTransaction,
    input: SendMatchMessageInput,
  ): Promise<SendMatchMessageResult>;
}
