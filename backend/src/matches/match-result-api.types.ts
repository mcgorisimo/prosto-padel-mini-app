import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  MatchResultId,
  MatchResultMutationRecord,
  MatchResultSetRecord,
  MatchResultStatus,
  MatchResultTeamNumber,
} from './match-result.types';
import { MatchId } from './match.types';

export interface MatchResultApiActor {
  readonly accountId: AccountId;
  readonly role: 'player' | 'club_admin';
}

export interface SubmitMatchResultRequest {
  readonly requestKey: string;
  readonly sets: readonly MatchResultSetRecord[];
}

export interface ResolveMatchResultRequest {
  readonly requestKey: string;
}

export interface ReadMatchResultApiInput extends MatchResultApiActor {
  readonly matchId: MatchId;
}

export interface SubmitMatchResultApiInput extends MatchResultApiActor {
  readonly matchId: MatchId;
  readonly request: SubmitMatchResultRequest;
}

export interface ResolveMatchResultApiInput extends MatchResultApiActor {
  readonly matchId: MatchId;
  readonly request: ResolveMatchResultRequest;
}

export interface MatchResultResponse {
  readonly resultId: MatchResultId;
  readonly matchId: MatchId;
  readonly lineupVersion: number;
  readonly teams: readonly [
    readonly [AccountId, AccountId],
    readonly [AccountId, AccountId],
  ];
  readonly sets: readonly MatchResultSetRecord[];
  readonly winningTeam: MatchResultTeamNumber;
  readonly status: MatchResultStatus;
  readonly submittedByAccountId: AccountId;
  readonly submittedAt: UnixEpochSeconds;
  readonly confirmedByAccountId?: AccountId;
  readonly confirmedAt?: UnixEpochSeconds;
  readonly disputedByAccountId?: AccountId;
  readonly disputedAt?: UnixEpochSeconds;
  readonly version: number;
}

export type MatchResultApiRejection =
  | 'invalid_request'
  | 'forbidden'
  | 'match_not_found'
  | 'result_not_found'
  | 'result_exists'
  | 'match_not_finished'
  | 'match_closed'
  | 'participant_not_active'
  | 'lineup_incomplete'
  | 'result_not_pending'
  | 'same_team_confirmation'
  | 'submitter_cannot_dispute'
  | 'request_conflict'
  | 'temporary_unavailable'
  | 'internal_failure';

export type ReadMatchResultApiResult =
  | { readonly outcome: 'found'; readonly result: MatchResultResponse }
  | { readonly outcome: 'rejected'; readonly reason: MatchResultApiRejection };

export type MutateMatchResultApiResult =
  | {
      readonly outcome:
        | 'result_submitted'
        | 'result_confirmed'
        | 'result_disputed';
      readonly result: MatchResultMutationRecord;
    }
  | { readonly outcome: 'rejected'; readonly reason: MatchResultApiRejection };
