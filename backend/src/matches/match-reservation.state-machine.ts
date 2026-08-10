import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  CourtReservation,
  ReservationTarget,
  isCourtReservationId,
  isReservationStatus,
  isReservationTarget,
  isYclientsReservationBinding,
} from '../reservations/reservation.types';
import {
  ActiveMatchReservationLink,
  MatchCourtBookingProjection,
  MatchReservationLifecycleEventSeed,
  MatchReservationLinkId,
  MatchReservationMatchSnapshot,
  ReleasedMatchReservationLink,
  isMatchReservationLinkId,
} from './match-reservation.types';
import { isMatchId } from './match.types';

const MATCH_STATUSES = new Set([
  'open',
  'searching',
  'confirmed',
  'upcoming',
  'completed',
  'cancelled',
]);
const TERMINAL_MATCH_STATUSES = new Set(['completed', 'cancelled']);
const UNCERTAIN_RESERVATION_STATUSES = new Set([
  'pending_confirmation',
  'reschedule_pending',
  'cancel_pending',
  'unknown',
]);

export interface ActivateConfirmedMatchReservationInput {
  readonly linkId: MatchReservationLinkId;
  readonly match: MatchReservationMatchSnapshot;
  readonly reservation: CourtReservation;
  readonly expectedMatchVersion: number;
  readonly expectedReservationVersion: number;
  readonly now: CourtReservation['updatedAt'];
  readonly activeMatchLink?: ActiveMatchReservationLink;
  readonly activeReservationLink?: ActiveMatchReservationLink;
}

export interface ApplyCanonicalMatchReservationRefreshInput {
  readonly type: 'apply_canonical_refresh';
  readonly match: MatchReservationMatchSnapshot;
  readonly reservation: CourtReservation;
  readonly expectedMatchVersion: number;
  readonly expectedLinkVersion: number;
  readonly now: CourtReservation['updatedAt'];
}

export interface ObserveUncertainMatchReservationRefreshInput {
  readonly type: 'observe_uncertain_refresh';
  readonly match: MatchReservationMatchSnapshot;
  readonly expectedMatchVersion: number;
  readonly expectedLinkVersion: number;
  readonly reason:
    | 'provider_unknown'
    | 'stale_read'
    | 'refresh_unavailable';
  readonly now: CourtReservation['updatedAt'];
}

export type MatchReservationRefreshInput =
  | ApplyCanonicalMatchReservationRefreshInput
  | ObserveUncertainMatchReservationRefreshInput;

export type MatchReservationTransitionRejection =
  | 'invalid_input'
  | 'ownership_conflict'
  | 'match_terminal'
  | 'match_version_conflict'
  | 'reservation_version_conflict'
  | 'link_version_conflict'
  | 'match_already_linked'
  | 'reservation_already_linked'
  | 'reservation_not_confirmed'
  | 'provider_binding_missing'
  | 'provider_binding_conflict'
  | 'reservation_binding_conflict'
  | 'noncanonical_reservation_state';

export type ActivateConfirmedMatchReservationResult =
  | Readonly<{
      outcome: 'activated';
      link: ActiveMatchReservationLink;
      matchVersion: number;
      event: MatchReservationLifecycleEventSeed;
    }>
  | Readonly<{
      outcome: 'idempotent_retry';
      link: ActiveMatchReservationLink;
      matchVersion: number;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason: MatchReservationTransitionRejection;
    }>;

export type MatchReservationRefreshResult =
  | Readonly<{
      outcome: 'refreshed';
      effect: 'none' | 'court_moved';
      link: ActiveMatchReservationLink;
      matchVersion: number;
      event?: MatchReservationLifecycleEventSeed;
    }>
  | Readonly<{
      outcome: 'released';
      effect: 'court_cancelled';
      link: ReleasedMatchReservationLink;
      matchVersion: number;
      event: MatchReservationLifecycleEventSeed;
    }>
  | Readonly<{
      outcome: 'preserved_uncertain';
      link: ActiveMatchReservationLink;
      matchVersion: number;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason: MatchReservationTransitionRejection;
    }>;

function isPlainRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    required.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function positiveVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function immutableTarget(target: ReservationTarget): ReservationTarget {
  return Object.freeze({
    serviceId: target.serviceId,
    courtId: target.courtId,
    startsAt: target.startsAt,
    endsAt: target.endsAt,
  });
}

export function sameReservationTarget(
  left: ReservationTarget,
  right: ReservationTarget,
): boolean {
  return (
    left.serviceId === right.serviceId &&
    left.courtId === right.courtId &&
    left.startsAt === right.startsAt &&
    left.endsAt === right.endsAt
  );
}

function isMatchSnapshot(
  value: unknown,
): value is MatchReservationMatchSnapshot {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, [
      'matchId',
      'ownerAccountId',
      'startsAt',
      'updatedAt',
      'status',
      'version',
    ])
  ) {
    return false;
  }
  return (
    isMatchId(value.matchId) &&
    isAccountId(value.ownerAccountId) &&
    isUnixEpochSeconds(value.startsAt) &&
    isUnixEpochSeconds(value.updatedAt) &&
    value.updatedAt <= value.startsAt &&
    typeof value.status === 'string' &&
    MATCH_STATUSES.has(value.status) &&
    positiveVersion(value.version)
  );
}

function isCourtReservation(
  value: unknown,
): value is CourtReservation {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(
      value,
      [
        'reservationId',
        'ownerAccountId',
        'status',
        'target',
        'createdAt',
        'updatedAt',
        'version',
      ],
      ['providerBinding'],
    )
  ) {
    return false;
  }
  return (
    isCourtReservationId(value.reservationId) &&
    isAccountId(value.ownerAccountId) &&
    isReservationStatus(value.status) &&
    isReservationTarget(value.target) &&
    isUnixEpochSeconds(value.createdAt) &&
    isUnixEpochSeconds(value.updatedAt) &&
    value.updatedAt >= value.createdAt &&
    positiveVersion(value.version) &&
    (value.providerBinding === undefined ||
      isYclientsReservationBinding(value.providerBinding))
  );
}

function isActiveLink(value: unknown): value is ActiveMatchReservationLink {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, [
      'linkId',
      'matchId',
      'reservationId',
      'ownerAccountId',
      'state',
      'providerAppointmentId',
      'providerRecordId',
      'target',
      'observedReservationVersion',
      'createdAt',
      'updatedAt',
      'version',
    ])
  ) {
    return false;
  }
  return (
    isMatchReservationLinkId(value.linkId) &&
    isMatchId(value.matchId) &&
    isCourtReservationId(value.reservationId) &&
    isAccountId(value.ownerAccountId) &&
    value.state === 'active' &&
    Number.isSafeInteger(value.providerAppointmentId) &&
    Number(value.providerAppointmentId) > 0 &&
    Number.isSafeInteger(value.providerRecordId) &&
    Number(value.providerRecordId) > 0 &&
    isReservationTarget(value.target) &&
    positiveVersion(value.observedReservationVersion) &&
    isUnixEpochSeconds(value.createdAt) &&
    isUnixEpochSeconds(value.updatedAt) &&
    value.updatedAt >= value.createdAt &&
    positiveVersion(value.version)
  );
}

function rejected(
  reason: MatchReservationTransitionRejection,
): Readonly<{
  outcome: 'rejected';
  reason: MatchReservationTransitionRejection;
}> {
  return Object.freeze({ outcome: 'rejected', reason });
}

function sameLinkIdentity(
  link: ActiveMatchReservationLink,
  input: ActivateConfirmedMatchReservationInput,
): boolean {
  return (
    link.matchId === input.match.matchId &&
    link.reservationId === input.reservation.reservationId &&
    link.ownerAccountId === input.match.ownerAccountId
  );
}

function lifecycleEvent(
  input: Readonly<{
    eventType: MatchReservationLifecycleEventSeed['eventType'];
    link: ActiveMatchReservationLink;
    reservationVersion: number;
    previousTarget?: ReservationTarget;
    currentTarget?: ReservationTarget;
    now: CourtReservation['updatedAt'];
  }>,
): MatchReservationLifecycleEventSeed {
  return Object.freeze({
    eventType: input.eventType,
    linkId: input.link.linkId,
    matchId: input.link.matchId,
    reservationId: input.link.reservationId,
    ownerAccountId: input.link.ownerAccountId,
    reservationVersion: input.reservationVersion,
    ...(input.previousTarget === undefined
      ? {}
      : { previousTarget: immutableTarget(input.previousTarget) }),
    ...(input.currentTarget === undefined
      ? {}
      : { currentTarget: immutableTarget(input.currentTarget) }),
    occurredAt: input.now,
  });
}

export function activateConfirmedMatchReservation(
  input: ActivateConfirmedMatchReservationInput,
): ActivateConfirmedMatchReservationResult {
  if (
    !isPlainRecord(input) ||
    !hasOnlyKeys(
      input,
      [
        'linkId',
        'match',
        'reservation',
        'expectedMatchVersion',
        'expectedReservationVersion',
        'now',
      ],
      ['activeMatchLink', 'activeReservationLink'],
    ) ||
    !isMatchReservationLinkId(input.linkId) ||
    !isMatchSnapshot(input.match) ||
    !isCourtReservation(input.reservation) ||
    !positiveVersion(input.expectedMatchVersion) ||
    !positiveVersion(input.expectedReservationVersion) ||
    !isUnixEpochSeconds(input.now) ||
    input.now < input.match.updatedAt ||
    input.now < input.reservation.updatedAt ||
    (input.activeMatchLink !== undefined &&
      !isActiveLink(input.activeMatchLink)) ||
    (input.activeReservationLink !== undefined &&
      !isActiveLink(input.activeReservationLink))
  ) {
    return rejected('invalid_input');
  }
  if (
    input.match.ownerAccountId !== input.reservation.ownerAccountId
  ) {
    return rejected('ownership_conflict');
  }
  if (TERMINAL_MATCH_STATUSES.has(input.match.status)) {
    return rejected('match_terminal');
  }
  if (input.match.version !== input.expectedMatchVersion) {
    return rejected('match_version_conflict');
  }
  if (input.reservation.version !== input.expectedReservationVersion) {
    return rejected('reservation_version_conflict');
  }
  if (input.reservation.status !== 'confirmed') {
    return rejected('reservation_not_confirmed');
  }
  if (
    input.now >= input.match.startsAt ||
    Date.parse(input.reservation.target.startsAt) <= input.now * 1_000
  ) {
    return rejected('invalid_input');
  }
  if (
    input.reservation.providerBinding === undefined ||
    !isYclientsReservationBinding(input.reservation.providerBinding)
  ) {
    return rejected('provider_binding_missing');
  }
  if (input.activeMatchLink !== undefined) {
    if (!sameLinkIdentity(input.activeMatchLink, input)) {
      return rejected('match_already_linked');
    }
    if (
      input.activeReservationLink !== undefined &&
      input.activeReservationLink.linkId !== input.activeMatchLink.linkId
    ) {
      return rejected('reservation_already_linked');
    }
    if (
      input.activeMatchLink.providerRecordId !==
        input.reservation.providerBinding.recordId ||
      input.activeMatchLink.providerAppointmentId !==
        input.reservation.providerBinding.appointmentId
    ) {
      return rejected('provider_binding_conflict');
    }
    return Object.freeze({
      outcome: 'idempotent_retry',
      link: input.activeMatchLink,
      matchVersion: input.match.version,
    });
  }
  if (input.activeReservationLink !== undefined) {
    return rejected('reservation_already_linked');
  }

  const link: ActiveMatchReservationLink = Object.freeze({
    linkId: input.linkId,
    matchId: input.match.matchId,
    reservationId: input.reservation.reservationId,
    ownerAccountId: input.match.ownerAccountId,
    state: 'active',
    providerAppointmentId: input.reservation.providerBinding.appointmentId,
    providerRecordId: input.reservation.providerBinding.recordId,
    target: immutableTarget(input.reservation.target),
    observedReservationVersion: input.reservation.version,
    createdAt: input.now,
    updatedAt: input.now,
    version: 1,
  });
  return Object.freeze({
    outcome: 'activated',
    link,
    matchVersion: input.match.version + 1,
    event: lifecycleEvent({
      eventType: 'court_confirmed',
      link,
      reservationVersion: input.reservation.version,
      currentTarget: input.reservation.target,
      now: input.now,
    }),
  });
}

function validateRefreshBase(
  link: ActiveMatchReservationLink,
  input: MatchReservationRefreshInput,
): MatchReservationTransitionRejection | undefined {
  if (
    !isActiveLink(link) ||
    !isPlainRecord(input) ||
    !isMatchSnapshot(input.match) ||
    !positiveVersion(input.expectedMatchVersion) ||
    !positiveVersion(input.expectedLinkVersion) ||
    !isUnixEpochSeconds(input.now) ||
    input.now < input.match.updatedAt ||
    input.now < link.updatedAt
  ) {
    return 'invalid_input';
  }
  if (
    input.match.matchId !== link.matchId ||
    input.match.ownerAccountId !== link.ownerAccountId
  ) {
    return 'reservation_binding_conflict';
  }
  if (TERMINAL_MATCH_STATUSES.has(input.match.status)) {
    return 'match_terminal';
  }
  if (input.match.version !== input.expectedMatchVersion) {
    return 'match_version_conflict';
  }
  if (link.version !== input.expectedLinkVersion) {
    return 'link_version_conflict';
  }
  return undefined;
}

export function transitionMatchReservationRefresh(
  link: ActiveMatchReservationLink,
  input: MatchReservationRefreshInput,
): MatchReservationRefreshResult {
  const baseRejection = validateRefreshBase(link, input);
  if (baseRejection !== undefined) return rejected(baseRejection);

  if (input.type === 'observe_uncertain_refresh') {
    if (
      !hasOnlyKeys(input, [
        'type',
        'match',
        'expectedMatchVersion',
        'expectedLinkVersion',
        'reason',
        'now',
      ]) ||
      ![
        'provider_unknown',
        'stale_read',
        'refresh_unavailable',
      ].includes(input.reason)
    ) {
      return rejected('invalid_input');
    }
    return Object.freeze({
      outcome: 'preserved_uncertain',
      link,
      matchVersion: input.match.version,
    });
  }

  if (
    !hasOnlyKeys(input, [
      'type',
      'match',
      'reservation',
      'expectedMatchVersion',
      'expectedLinkVersion',
      'now',
    ]) ||
    !isCourtReservation(input.reservation) ||
    input.now < input.reservation.updatedAt
  ) {
    return rejected('invalid_input');
  }
  const reservation = input.reservation;
  if (
    reservation.reservationId !== link.reservationId ||
    reservation.ownerAccountId !== link.ownerAccountId
  ) {
    return rejected('reservation_binding_conflict');
  }
  if (reservation.version < link.observedReservationVersion) {
    return rejected('reservation_version_conflict');
  }
  if (
    reservation.status !== 'confirmed' &&
    reservation.status !== 'cancelled'
  ) {
    return UNCERTAIN_RESERVATION_STATUSES.has(reservation.status)
      ? rejected('noncanonical_reservation_state')
      : rejected('reservation_not_confirmed');
  }
  if (
    reservation.providerBinding === undefined ||
    !isYclientsReservationBinding(reservation.providerBinding)
  ) {
    return rejected('provider_binding_missing');
  }
  if (
    reservation.providerBinding.recordId !== link.providerRecordId ||
    reservation.providerBinding.appointmentId !==
      link.providerAppointmentId
  ) {
    return rejected('provider_binding_conflict');
  }

  if (reservation.status === 'cancelled') {
    if (reservation.version === link.observedReservationVersion) {
      return rejected('reservation_version_conflict');
    }
    const released: ReleasedMatchReservationLink = Object.freeze({
      ...link,
      state: 'released',
      observedReservationVersion: reservation.version,
      updatedAt: input.now,
      version: link.version + 1,
      releasedAt: input.now,
      releaseReason: 'canonical_reservation_cancelled',
    });
    return Object.freeze({
      outcome: 'released',
      effect: 'court_cancelled',
      link: released,
      matchVersion: input.match.version + 1,
      event: lifecycleEvent({
        eventType: 'court_cancelled',
        link,
        reservationVersion: reservation.version,
        previousTarget: link.target,
        now: input.now,
      }),
    });
  }

  const targetChanged = !sameReservationTarget(
    link.target,
    reservation.target,
  );
  if (
    reservation.version === link.observedReservationVersion &&
    targetChanged
  ) {
    return rejected('reservation_version_conflict');
  }
  if (
    reservation.version === link.observedReservationVersion &&
    !targetChanged
  ) {
    return Object.freeze({
      outcome: 'refreshed',
      effect: 'none',
      link,
      matchVersion: input.match.version,
    });
  }

  const refreshed: ActiveMatchReservationLink = Object.freeze({
    ...link,
    target: immutableTarget(reservation.target),
    observedReservationVersion: reservation.version,
    updatedAt: input.now,
    version: link.version + 1,
  });
  if (!targetChanged) {
    return Object.freeze({
      outcome: 'refreshed',
      effect: 'none',
      link: refreshed,
      matchVersion: input.match.version,
    });
  }
  return Object.freeze({
    outcome: 'refreshed',
    effect: 'court_moved',
    link: refreshed,
    matchVersion: input.match.version + 1,
    event: lifecycleEvent({
      eventType: 'court_moved',
      link,
      reservationVersion: reservation.version,
      previousTarget: link.target,
      currentTarget: reservation.target,
      now: input.now,
    }),
  });
}

const UNBOOKED_PROJECTION: MatchCourtBookingProjection = Object.freeze({
  status: 'unbooked',
  stale: false,
});

export function projectMatchCourtBooking(
  link: ActiveMatchReservationLink | undefined,
  reservation?: CourtReservation,
): MatchCourtBookingProjection {
  if (!isActiveLink(link)) return UNBOOKED_PROJECTION;
  if (reservation === undefined) {
    return Object.freeze({
      status: 'confirmed',
      stale: true,
      reservationId: link.reservationId,
      target: immutableTarget(link.target),
    });
  }
  if (
    !isCourtReservation(reservation) ||
    reservation.reservationId !== link.reservationId ||
    reservation.ownerAccountId !== link.ownerAccountId
  ) {
    return UNBOOKED_PROJECTION;
  }
  if (
    reservation.status === 'cancelled' ||
    reservation.status === 'rejected' ||
    reservation.status === 'unbooked'
  ) {
    return UNBOOKED_PROJECTION;
  }
  if (
    reservation.status === 'confirmed' &&
    (reservation.providerBinding === undefined ||
      !isYclientsReservationBinding(reservation.providerBinding) ||
      reservation.providerBinding.recordId !== link.providerRecordId ||
      reservation.providerBinding.appointmentId !==
        link.providerAppointmentId)
  ) {
    return UNBOOKED_PROJECTION;
  }
  if (
    reservation.status === 'confirmed' &&
    (reservation.version < link.observedReservationVersion ||
      (reservation.version === link.observedReservationVersion &&
        !sameReservationTarget(reservation.target, link.target)))
  ) {
    return UNBOOKED_PROJECTION;
  }
  const fresh =
    reservation.status === 'confirmed' &&
    reservation.providerBinding !== undefined &&
    isYclientsReservationBinding(reservation.providerBinding) &&
    reservation.providerBinding.recordId === link.providerRecordId &&
    reservation.providerBinding.appointmentId ===
      link.providerAppointmentId &&
    reservation.version === link.observedReservationVersion &&
    sameReservationTarget(reservation.target, link.target);
  return Object.freeze({
    status: 'confirmed',
    stale: !fresh,
    reservationId: link.reservationId,
    target: immutableTarget(link.target),
  });
}
