import { AccountId, UserRole } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  MatchDetailRecord,
  MatchFeedRecord,
} from '../database/match.repository';
import {
  MatchDurationMinutes,
  MatchId,
  MatchScenario,
  MatchSlotNumber,
} from './match.types';

export interface CreateMatchRequest {
  readonly requestKey: string;
  readonly startsAt: UnixEpochSeconds;
  readonly durationMinutes: MatchDurationMinutes;
  readonly courtId?: string;
  readonly scenario: MatchScenario;
  readonly title?: string;
  readonly description: string;
  readonly ratingMin?: number;
  readonly ratingMax?: number;
  readonly isRatingMatch: boolean;
}

export interface MatchActionRequest {
  readonly requestKey: string;
}

export interface MatchFeedRequest {
  readonly limit: number;
}

export interface MatchApiActor {
  readonly accountId: AccountId;
  readonly role: UserRole;
}

export interface CreateMatchInput extends MatchApiActor {
  readonly request: CreateMatchRequest;
}

export interface ListMatchFeedInput extends MatchApiActor {
  readonly request: MatchFeedRequest;
}

export interface ReadMatchDetailInput extends MatchApiActor {
  readonly matchId: MatchId;
}

export interface MutateMatchParticipationInput extends MatchApiActor {
  readonly matchId: MatchId;
  readonly request: MatchActionRequest;
}

export interface MatchParticipationResponse {
  readonly matchId: MatchId;
  readonly playerId: AccountId;
  readonly slotNumber: MatchSlotNumber;
  readonly status: 'active' | 'left';
  readonly matchVersion: number;
}

export type MatchApiRejection =
  | 'invalid_request'
  | 'forbidden'
  | 'match_not_found'
  | 'match_closed'
  | 'match_not_joinable'
  | 'match_started'
  | 'rating_verification_required'
  | 'rating_out_of_range'
  | 'owner_cannot_join'
  | 'already_joined'
  | 'match_full'
  | 'participant_not_active'
  | 'request_conflict'
  | 'match_conflict'
  | 'temporary_unavailable'
  | 'internal_failure';

export type CreateMatchApiResult =
  | {
      readonly outcome: 'created';
      readonly match: MatchDetailRecord;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchApiRejection;
    };

export type ListMatchFeedApiResult =
  | {
      readonly outcome: 'found';
      readonly matches: readonly MatchFeedRecord[];
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchApiRejection;
    };

export type ReadMatchDetailApiResult =
  | {
      readonly outcome: 'found';
      readonly match: MatchDetailRecord;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchApiRejection;
    };

export type MutateMatchParticipationApiResult =
  | {
      readonly outcome: 'updated';
      readonly participant: MatchParticipationResponse;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchApiRejection;
    };
