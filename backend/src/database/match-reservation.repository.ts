import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { CourtReservation, CourtReservationId } from '../reservations/reservation.types';
import {
  MatchCourtBookingProjection,
  MatchReservationLinkId,
} from '../matches/match-reservation.types';
import { MatchId } from '../matches/match.types';
import { PostgresTransaction } from './postgres-transaction';

export type LinkConfirmedMatchReservationResult =
  | Readonly<{
      outcome: 'linked';
      persistence: 'applied' | 'idempotent_retry';
      projection: MatchCourtBookingProjection;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason:
        | 'match_not_found'
        | 'reservation_not_found'
        | 'forbidden'
        | 'match_terminal'
        | 'reservation_not_confirmed'
        | 'provider_binding_missing'
        | 'match_already_linked'
        | 'reservation_already_linked'
        | 'unsupported_duration'
        | 'conflict';
    }>;

export type SynchronizeMatchReservationResult = Readonly<{
  outcome: 'not_linked' | 'unchanged' | 'moved' | 'cancelled';
  matchId?: MatchId;
}>;

export type MatchReservationPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class MatchReservationPersistenceError extends Error {
  readonly name = 'MatchReservationPersistenceError';

  constructor(readonly reason: MatchReservationPersistenceFailure) {
    super('Match reservation persistence failed');
  }
}

export interface MatchReservationRepository {
  linkConfirmed(
    transaction: PostgresTransaction,
    input: Readonly<{
      linkId: MatchReservationLinkId;
      matchId: MatchId;
      reservationId: CourtReservationId;
      ownerAccountId: AccountId;
      now: UnixEpochSeconds;
    }>,
  ): Promise<LinkConfirmedMatchReservationResult>;

  synchronizeCanonicalRefresh(
    transaction: PostgresTransaction,
    reservation: CourtReservation,
  ): Promise<SynchronizeMatchReservationResult>;

  readCourtBookings(
    transaction: PostgresTransaction,
    matchIds: readonly MatchId[],
  ): Promise<ReadonlyMap<MatchId, MatchCourtBookingProjection>>;
}
