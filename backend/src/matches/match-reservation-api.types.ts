import { AccountId, UserRole } from '../accounts/account.types';
import { CourtReservationId, ReservationTarget } from '../reservations/reservation.types';
import { MatchId } from './match.types';

export interface LinkMatchReservationRequest {
  readonly requestKey: string;
  readonly reservationId: CourtReservationId;
}

export interface LinkMatchReservationInput {
  readonly accountId: AccountId;
  readonly role: UserRole;
  readonly matchId: MatchId;
  readonly request: LinkMatchReservationRequest;
}

export type MatchCourtBookingResponse =
  | Readonly<{
      courtBookingStatus: 'unbooked';
      courtBookingStale: false;
    }>
  | Readonly<{
      courtBookingStatus: 'confirmed';
      courtBookingStale: boolean;
      courtReservationId: CourtReservationId;
      courtBookingTarget: ReservationTarget;
    }>;

export type LinkMatchReservationApiRejection =
  | 'invalid_request'
  | 'forbidden'
  | 'match_not_found'
  | 'reservation_not_found'
  | 'match_terminal'
  | 'reservation_not_confirmed'
  | 'provider_binding_missing'
  | 'match_already_linked'
  | 'reservation_already_linked'
  | 'unsupported_duration'
  | 'match_conflict'
  | 'temporary_unavailable'
  | 'internal_failure';

export type LinkMatchReservationApiResult =
  | Readonly<{
      outcome: 'linked';
      persistence: 'applied' | 'idempotent_retry';
      courtBooking: MatchCourtBookingResponse;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason: LinkMatchReservationApiRejection;
    }>;
