import { AccountId, UserRole } from '../accounts/account.types';
import { CourtReservationId } from '../reservations/reservation.types';
import {
  MatchDetailRecord,
  MatchFeedRecord,
} from '../database/match.repository';
import {
  MatchId,
  MatchScenario,
  MatchSlotNumber,
} from './match.types';
import { MatchCourtBookingResponse } from './match-reservation-api.types';

export interface CreateMatchRequest {
  readonly requestKey: string;
  readonly reservationId: CourtReservationId;
  readonly scenario: MatchScenario;
  readonly description: string;
  readonly ratingMin?: number;
  readonly ratingMax?: number;
  readonly isRatingMatch: boolean;
}

export interface MatchActionRequest {
  readonly requestKey: string;
}

export interface UpdateMatchDescriptionRequest extends MatchActionRequest {
  readonly description: string;
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

export interface UpdateMatchDescriptionInput extends MatchApiActor {
  readonly matchId: MatchId;
  readonly request: UpdateMatchDescriptionRequest;
}

export interface MatchDescriptionUpdateResponse {
  readonly matchId: MatchId;
  readonly description: string;
  readonly matchVersion: number;
}

export interface MatchParticipationResponse {
  readonly matchId: MatchId;
  readonly playerId: AccountId;
  readonly slotNumber: MatchSlotNumber;
  readonly status: 'active' | 'left';
  readonly matchVersion: number;
}

export interface MatchPublicPlayerResponse {
  readonly playerId: AccountId;
  readonly firstName: string;
  readonly lastName?: string;
  readonly username?: string;
  readonly photoUrl?: string;
  readonly rating: number;
  readonly isVerified: boolean;
}

export interface MatchUnavailablePlayerResponse {
  readonly unavailable: true;
}

export type MatchPlayerProjectionResponse =
  | MatchPublicPlayerResponse
  | MatchUnavailablePlayerResponse;

export type MatchPublicParticipantResponse =
  | (MatchPublicPlayerResponse & Readonly<{
      readonly slotNumber: MatchSlotNumber;
    }>)
  | (MatchUnavailablePlayerResponse & Readonly<{
      readonly slotNumber: MatchSlotNumber;
    }>);

export type MatchFeedResponse =
  Omit<MatchFeedRecord, 'participants' | 'title'> &
  MatchCourtBookingResponse & Readonly<{
  readonly owner: MatchPlayerProjectionResponse;
  readonly participants: readonly MatchPublicParticipantResponse[];
}>;

export type MatchDetailResponse =
  Omit<MatchDetailRecord, 'participants' | 'title'> &
  MatchCourtBookingResponse & Readonly<{
  readonly owner: MatchPlayerProjectionResponse;
  readonly participants: readonly MatchPublicParticipantResponse[];
}>;

export type MatchApiRejection =
  | 'invalid_request'
  | 'forbidden'
  | 'match_not_found'
  | 'match_closed'
  | 'match_not_joinable'
  | 'match_started'
  | 'reservation_not_found'
  | 'reservation_not_confirmed'
  | 'provider_binding_missing'
  | 'unsupported_duration'
  | 'content_not_allowed'
  | 'rating_verification_required'
  | 'rating_out_of_range'
  | 'owner_cannot_join'
  | 'already_joined'
  | 'invitation_pending'
  | 'match_full'
  | 'participant_not_active'
  | 'request_conflict'
  | 'match_conflict'
  | 'temporary_unavailable'
  | 'internal_failure';

export type CreateMatchApiResult =
  | {
      readonly outcome: 'created';
      readonly persistence: 'applied' | 'idempotent_retry';
      readonly match: MatchDetailResponse;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchApiRejection;
    };

export type ListMatchFeedApiResult =
  | {
      readonly outcome: 'found';
      readonly matches: readonly MatchFeedResponse[];
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchApiRejection;
    };

export type ReadMatchDetailApiResult =
  | {
      readonly outcome: 'found';
      readonly match: MatchDetailResponse;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchApiRejection;
    };

export type MutateMatchParticipationApiResult =
  | {
      readonly outcome: 'updated';
      readonly persistence: 'applied' | 'idempotent_retry';
      readonly participant: MatchParticipationResponse;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchApiRejection;
    };

export type UpdateMatchDescriptionApiResult =
  | {
      readonly outcome: 'updated';
      readonly match: MatchDescriptionUpdateResponse;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchApiRejection;
    };
