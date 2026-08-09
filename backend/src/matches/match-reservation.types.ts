import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  InternalUuid,
  isInternalUuid,
  newInternalUuid,
} from '../common/internal-uuid';
import {
  CourtReservationId,
  ReservationTarget,
} from '../reservations/reservation.types';
import { MatchId, MatchStatus } from './match.types';

declare const matchReservationLinkIdBrand: unique symbol;

export type MatchReservationLinkId = InternalUuid & {
  readonly [matchReservationLinkIdBrand]: 'MatchReservationLinkId';
};

export type MatchReservationLinkReleaseReason =
  | 'canonical_reservation_cancelled';

export interface MatchReservationMatchSnapshot {
  readonly matchId: MatchId;
  readonly ownerAccountId: AccountId;
  readonly startsAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly status: MatchStatus;
  readonly version: number;
}

export interface ActiveMatchReservationLink {
  readonly linkId: MatchReservationLinkId;
  readonly matchId: MatchId;
  readonly reservationId: CourtReservationId;
  readonly ownerAccountId: AccountId;
  readonly state: 'active';
  readonly providerAppointmentId: number;
  readonly providerRecordId: number;
  readonly target: ReservationTarget;
  readonly observedReservationVersion: number;
  readonly createdAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly version: number;
}

export interface ReleasedMatchReservationLink
  extends Omit<ActiveMatchReservationLink, 'state'> {
  readonly state: 'released';
  readonly releasedAt: UnixEpochSeconds;
  readonly releaseReason: MatchReservationLinkReleaseReason;
}

export type MatchReservationLink =
  | ActiveMatchReservationLink
  | ReleasedMatchReservationLink;

export type MatchReservationLifecycleEventType =
  | 'court_confirmed'
  | 'court_moved'
  | 'court_cancelled';

export interface MatchReservationLifecycleEventSeed {
  readonly eventType: MatchReservationLifecycleEventType;
  readonly linkId: MatchReservationLinkId;
  readonly matchId: MatchId;
  readonly reservationId: CourtReservationId;
  readonly ownerAccountId: AccountId;
  readonly reservationVersion: number;
  readonly previousTarget?: ReservationTarget;
  readonly currentTarget?: ReservationTarget;
  readonly occurredAt: UnixEpochSeconds;
}

export type MatchCourtBookingProjection =
  | Readonly<{
      status: 'unbooked';
      stale: false;
    }>
  | Readonly<{
      status: 'confirmed';
      stale: boolean;
      reservationId: CourtReservationId;
      target: ReservationTarget;
    }>;

export function isMatchReservationLinkId(
  value: unknown,
): value is MatchReservationLinkId {
  return isInternalUuid(value);
}

export function newMatchReservationLinkId(): MatchReservationLinkId {
  return newInternalUuid() as MatchReservationLinkId;
}
