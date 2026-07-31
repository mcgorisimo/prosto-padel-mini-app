import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { MatchPublicPlayerResponse } from './match-api.types';
import {
  MatchWaitlistEntryId,
  MatchWaitlistMutationRecord,
} from './match-waitlist.types';
import { MatchId } from './match.types';

export interface MatchWaitlistApiActor {
  readonly accountId: AccountId;
  readonly role: 'player' | 'club_admin';
}

export interface MatchWaitlistActionRequest {
  readonly requestKey: string;
}

export interface ListMatchWaitlistRequest {
  readonly limit: number;
}

export interface ListMatchWaitlistApiInput extends MatchWaitlistApiActor {
  readonly matchId: MatchId;
  readonly request: ListMatchWaitlistRequest;
}

export interface MutateMatchWaitlistApiInput extends MatchWaitlistApiActor {
  readonly matchId: MatchId;
  readonly request: MatchWaitlistActionRequest;
}

export interface MatchWaitlistEntryResponse {
  readonly entryId: MatchWaitlistEntryId;
  readonly player: MatchPublicPlayerResponse | { readonly unavailable: true };
  readonly queuePosition: number;
  readonly joinedAt: UnixEpochSeconds;
  readonly isCurrentPlayer: boolean;
}

export type MatchWaitlistApiRejection =
  | 'invalid_request'
  | 'forbidden'
  | 'match_not_found'
  | 'match_closed'
  | 'match_started'
  | 'match_not_full'
  | 'owner_cannot_join'
  | 'already_joined'
  | 'invitation_pending'
  | 'already_waiting'
  | 'not_waiting'
  | 'player_not_found'
  | 'rating_verification_required'
  | 'rating_out_of_range'
  | 'request_conflict'
  | 'temporary_unavailable'
  | 'internal_failure';

export type ListMatchWaitlistApiResult =
  | {
      readonly outcome: 'found';
      readonly entries: readonly MatchWaitlistEntryResponse[];
      readonly current?: MatchWaitlistEntryResponse;
      readonly count: number;
    }
  | { readonly outcome: 'rejected'; readonly reason: MatchWaitlistApiRejection };

export type MutateMatchWaitlistApiResult =
  | {
      readonly outcome: 'waitlist_joined' | 'waitlist_left';
      readonly entry: MatchWaitlistMutationRecord;
    }
  | { readonly outcome: 'rejected'; readonly reason: MatchWaitlistApiRejection };
