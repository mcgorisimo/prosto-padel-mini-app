import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { MatchPublicPlayerResponse } from './match-api.types';
import {
  MatchMessageCursor,
  MatchMessageId,
} from './match-chat.types';
import { MatchId } from './match.types';

export interface ListMatchMessagesRequest {
  readonly limit: number;
  readonly before?: MatchMessageCursor;
}

export interface SendMatchMessageRequest {
  readonly requestKey: string;
  readonly body: string;
}

export interface MatchChatApiActor {
  readonly accountId: AccountId;
  readonly role: 'player' | 'club_admin';
}

export interface ListMatchMessagesApiInput extends MatchChatApiActor {
  readonly matchId: MatchId;
  readonly request: ListMatchMessagesRequest;
}

export interface SendMatchMessageApiInput extends MatchChatApiActor {
  readonly matchId: MatchId;
  readonly request: SendMatchMessageRequest;
}

export interface UnavailableMatchMessageSenderResponse {
  readonly unavailable: true;
}

export type MatchMessageSenderResponse =
  | MatchPublicPlayerResponse
  | UnavailableMatchMessageSenderResponse;

export interface MatchMessageResponse {
  readonly messageId: MatchMessageId;
  readonly matchId: MatchId;
  readonly sender: MatchMessageSenderResponse;
  readonly body: string;
  readonly createdAt: UnixEpochSeconds;
}

export type MatchChatApiRejection =
  | 'invalid_request'
  | 'content_not_allowed'
  | 'match_not_found'
  | 'match_closed'
  | 'request_conflict'
  | 'temporary_unavailable'
  | 'internal_failure';

export type ListMatchMessagesApiResult =
  | {
      readonly outcome: 'found';
      readonly messages: readonly MatchMessageResponse[];
      readonly nextCursor?: MatchMessageCursor;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchChatApiRejection;
    };

export type SendMatchMessageApiResult =
  | {
      readonly outcome: 'message_sent';
      readonly message: MatchMessageResponse;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchChatApiRejection;
    };
