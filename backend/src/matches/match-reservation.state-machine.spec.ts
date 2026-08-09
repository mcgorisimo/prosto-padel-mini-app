import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  CourtReservation,
  CourtReservationId,
  ReservationTarget,
} from '../reservations/reservation.types';
import {
  activateConfirmedMatchReservation,
  projectMatchCourtBooking,
  transitionMatchReservationRefresh,
} from './match-reservation.state-machine';
import {
  ActiveMatchReservationLink,
  MatchReservationLinkId,
  MatchReservationMatchSnapshot,
} from './match-reservation.types';
import { MatchId } from './match.types';

const OWNER = deterministicUuid('d3-owner') as AccountId;
const OTHER_OWNER = deterministicUuid('d3-other-owner') as AccountId;
const MATCH = deterministicUuid('d3-match') as MatchId;
const OTHER_MATCH = deterministicUuid('d3-other-match') as MatchId;
const RESERVATION = deterministicUuid(
  'd3-reservation',
) as CourtReservationId;
const OTHER_RESERVATION = deterministicUuid(
  'd3-other-reservation',
) as CourtReservationId;
const LINK = deterministicUuid('d3-link') as MatchReservationLinkId;
const OTHER_LINK = deterministicUuid(
  'd3-other-link',
) as MatchReservationLinkId;
const NOW = unixEpochSeconds(1_799_996_000);

const TARGET_A: ReservationTarget = Object.freeze({
  serviceId: 30_539_679,
  courtId: 5_730_531,
  startsAt: '2027-01-15T10:00:00+03:00',
  endsAt: '2027-01-15T11:30:00+03:00',
});
const TARGET_B: ReservationTarget = Object.freeze({
  serviceId: 30_539_679,
  courtId: 5_762_241,
  startsAt: '2027-01-16T12:00:00+03:00',
  endsAt: '2027-01-16T13:30:00+03:00',
});
const MOVE_TARGETS = Object.freeze([
  Object.freeze({
    label: 'same date, different time',
    target: Object.freeze({
      ...TARGET_A,
      startsAt: '2027-01-15T12:00:00+03:00',
      endsAt: '2027-01-15T13:30:00+03:00',
    }),
  }),
  Object.freeze({
    label: 'different date, same time',
    target: Object.freeze({
      ...TARGET_A,
      startsAt: '2027-01-16T10:00:00+03:00',
      endsAt: '2027-01-16T11:30:00+03:00',
    }),
  }),
  Object.freeze({
    label: 'different date and time',
    target: Object.freeze({
      ...TARGET_A,
      startsAt: '2027-01-16T12:00:00+03:00',
      endsAt: '2027-01-16T13:30:00+03:00',
    }),
  }),
  Object.freeze({
    label: 'different date, time and court',
    target: TARGET_B,
  }),
]);

function match(
  overrides: Partial<MatchReservationMatchSnapshot> = {},
): MatchReservationMatchSnapshot {
  return Object.freeze({
    matchId: MATCH,
    ownerAccountId: OWNER,
    startsAt: unixEpochSeconds(1_800_090_000),
    updatedAt: unixEpochSeconds(1_799_995_900),
    status: 'searching',
    version: 7,
    ...overrides,
  });
}

function reservation(
  overrides: Partial<CourtReservation> = {},
): CourtReservation {
  return Object.freeze({
    reservationId: RESERVATION,
    ownerAccountId: OWNER,
    status: 'confirmed',
    target: TARGET_A,
    providerBinding: Object.freeze({
      provider: 'yclients',
      appointmentId: 91_001,
      recordId: 189_001,
      recordHash: 'canonical-record-hash',
    }),
    createdAt: unixEpochSeconds(1_799_995_000),
    updatedAt: unixEpochSeconds(1_799_995_900),
    version: 5,
    ...overrides,
  });
}

function activate(overrides: Record<string, unknown> = {}) {
  const currentMatch = match();
  const currentReservation = reservation();
  return activateConfirmedMatchReservation({
    linkId: LINK,
    match: currentMatch,
    reservation: currentReservation,
    expectedMatchVersion: currentMatch.version,
    expectedReservationVersion: currentReservation.version,
    now: NOW,
    ...overrides,
  });
}

function activeLink(): ActiveMatchReservationLink {
  const result = activate();
  if (result.outcome !== 'activated') {
    throw new Error('D3 active link fixture is invalid');
  }
  return result.link;
}

describe('D3 match reservation lifecycle', () => {
  it('projects an unlinked match as unbooked without scenario or payment inputs', () => {
    expect(projectMatchCourtBooking(undefined)).toEqual({
      status: 'unbooked',
      stale: false,
    });
  });

  it('activates only a confirmed reservation with complete YCLIENTS binding', () => {
    const result = activate();
    expect(result).toMatchObject({
      outcome: 'activated',
      matchVersion: 8,
      link: {
        linkId: LINK,
        matchId: MATCH,
        reservationId: RESERVATION,
        ownerAccountId: OWNER,
        state: 'active',
        providerAppointmentId: 91_001,
        providerRecordId: 189_001,
        observedReservationVersion: 5,
        target: TARGET_A,
        version: 1,
      },
      event: {
        eventType: 'court_confirmed',
        reservationVersion: 5,
        currentTarget: TARGET_A,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.outcome === 'activated') {
      expect(Object.isFrozen(result.link)).toBe(true);
      expect(Object.isFrozen(result.link.target)).toBe(true);
      expect(Object.isFrozen(result.event)).toBe(true);
    }
  });

  it.each([
    ['unbooked', 'reservation_not_confirmed'],
    ['pending_confirmation', 'reservation_not_confirmed'],
    ['unknown', 'reservation_not_confirmed'],
    ['cancelled', 'reservation_not_confirmed'],
  ] as const)('rejects %s reservation activation', (status, reason) => {
    const value = reservation({ status });
    expect(activate({
      reservation: value,
      expectedReservationVersion: value.version,
    })).toEqual({ outcome: 'rejected', reason });
  });

  it('rejects a nominally confirmed reservation without provider proof', () => {
    const { providerBinding: _providerBinding, ...value } = reservation();
    expect(activate({ reservation: value })).toEqual({
      outcome: 'rejected',
      reason: 'provider_binding_missing',
    });
  });

  it('rejects cross-owner linking', () => {
    const value = reservation({ ownerAccountId: OTHER_OWNER });
    expect(activate({
      reservation: value,
      expectedReservationVersion: value.version,
    })).toEqual({
      outcome: 'rejected',
      reason: 'ownership_conflict',
    });
  });

  it('rejects terminal matches and stale match/reservation versions', () => {
    expect(activate({ match: match({ status: 'cancelled' }) })).toEqual({
      outcome: 'rejected',
      reason: 'match_terminal',
    });
    expect(activate({ expectedMatchVersion: 6 })).toEqual({
      outcome: 'rejected',
      reason: 'match_version_conflict',
    });
    expect(activate({ expectedReservationVersion: 4 })).toEqual({
      outcome: 'rejected',
      reason: 'reservation_version_conflict',
    });
  });

  it('rejects linking after either the match or reservation start', () => {
    expect(activate({
      match: match({ startsAt: NOW }),
    })).toEqual({ outcome: 'rejected', reason: 'invalid_input' });
    const startedTarget = Object.freeze({
      ...TARGET_A,
      startsAt: '2027-01-14T23:00:00+03:00',
      endsAt: '2027-01-15T00:30:00+03:00',
    });
    const startedReservation = reservation({ target: startedTarget });
    expect(activate({
      reservation: startedReservation,
      expectedReservationVersion: startedReservation.version,
    })).toEqual({ outcome: 'rejected', reason: 'invalid_input' });
  });

  it('enforces one active reservation per match', () => {
    const existing = activeLink();
    const otherReservation = reservation({
      reservationId: OTHER_RESERVATION,
    });
    expect(activate({
      linkId: OTHER_LINK,
      reservation: otherReservation,
      expectedReservationVersion: otherReservation.version,
      activeMatchLink: existing,
    })).toEqual({
      outcome: 'rejected',
      reason: 'match_already_linked',
    });
  });

  it('enforces one active match per reservation', () => {
    const occupied = Object.freeze({
      ...activeLink(),
      linkId: OTHER_LINK,
      matchId: OTHER_MATCH,
    });
    expect(activate({ activeReservationLink: occupied })).toEqual({
      outcome: 'rejected',
      reason: 'reservation_already_linked',
    });
  });

  it('accepts an exact same-link retry without version or event churn', () => {
    const existing = activeLink();
    expect(activate({
      activeMatchLink: existing,
      activeReservationLink: existing,
    })).toEqual({
      outcome: 'idempotent_retry',
      link: existing,
      matchVersion: 7,
    });
  });

  it('does not churn an unchanged exact confirmed refresh', () => {
    const link = activeLink();
    const result = transitionMatchReservationRefresh(link, {
      type: 'apply_canonical_refresh',
      match: match(),
      reservation: reservation(),
      expectedMatchVersion: 7,
      expectedLinkVersion: 1,
      now: unixEpochSeconds(Number(NOW) + 10),
    });
    expect(result).toEqual({
      outcome: 'refreshed',
      effect: 'none',
      link,
      matchVersion: 7,
    });
  });

  it.each(MOVE_TARGETS)(
    'records one canonical $label move and advances match projection',
    ({ target }) => {
    const link = activeLink();
    const moved = reservation({
      target,
      version: 6,
      updatedAt: unixEpochSeconds(Number(NOW) + 5),
    });
    const result = transitionMatchReservationRefresh(link, {
      type: 'apply_canonical_refresh',
      match: match(),
      reservation: moved,
      expectedMatchVersion: 7,
      expectedLinkVersion: 1,
      now: unixEpochSeconds(Number(NOW) + 10),
    });
    expect(result).toMatchObject({
      outcome: 'refreshed',
      effect: 'court_moved',
      matchVersion: 8,
      link: {
        state: 'active',
        target,
        observedReservationVersion: 6,
        version: 2,
      },
      event: {
        eventType: 'court_moved',
        reservationVersion: 6,
        previousTarget: TARGET_A,
        currentTarget: target,
      },
    });
    },
  );

  it('advances an observed reservation version without a move notification', () => {
    const link = activeLink();
    const refreshed = reservation({
      version: 6,
      updatedAt: unixEpochSeconds(Number(NOW) + 5),
    });
    expect(transitionMatchReservationRefresh(link, {
      type: 'apply_canonical_refresh',
      match: match(),
      reservation: refreshed,
      expectedMatchVersion: 7,
      expectedLinkVersion: 1,
      now: unixEpochSeconds(Number(NOW) + 10),
    })).toMatchObject({
      outcome: 'refreshed',
      effect: 'none',
      matchVersion: 7,
      link: { observedReservationVersion: 6, version: 2 },
    });
  });

  it('preserves the last confirmed link on uncertain refresh with no churn', () => {
    const link = activeLink();
    expect(transitionMatchReservationRefresh(link, {
      type: 'observe_uncertain_refresh',
      match: match(),
      expectedMatchVersion: 7,
      expectedLinkVersion: 1,
      reason: 'provider_unknown',
      now: unixEpochSeconds(Number(NOW) + 10),
    })).toEqual({
      outcome: 'preserved_uncertain',
      link,
      matchVersion: 7,
    });
    expect(projectMatchCourtBooking(link)).toEqual({
      status: 'confirmed',
      stale: true,
      reservationId: RESERVATION,
      target: TARGET_A,
    });
  });

  it('rejects uncertain local state on the canonical command path', () => {
    const link = activeLink();
    expect(transitionMatchReservationRefresh(link, {
      type: 'apply_canonical_refresh',
      match: match(),
      reservation: reservation({ status: 'unknown', version: 6 }),
      expectedMatchVersion: 7,
      expectedLinkVersion: 1,
      now: unixEpochSeconds(Number(NOW) + 10),
    })).toEqual({
      outcome: 'rejected',
      reason: 'noncanonical_reservation_state',
    });
  });

  it('releases only after canonical cancellation and keeps the match alive', () => {
    const link = activeLink();
    const cancelled = reservation({
      status: 'cancelled',
      version: 6,
      updatedAt: unixEpochSeconds(Number(NOW) + 5),
    });
    const result = transitionMatchReservationRefresh(link, {
      type: 'apply_canonical_refresh',
      match: match(),
      reservation: cancelled,
      expectedMatchVersion: 7,
      expectedLinkVersion: 1,
      now: unixEpochSeconds(Number(NOW) + 10),
    });
    expect(result).toMatchObject({
      outcome: 'released',
      effect: 'court_cancelled',
      matchVersion: 8,
      link: {
        state: 'released',
        releaseReason: 'canonical_reservation_cancelled',
        version: 2,
      },
      event: {
        eventType: 'court_cancelled',
        previousTarget: TARGET_A,
      },
    });
    expect(match().status).toBe('searching');
    expect(projectMatchCourtBooking(link, cancelled)).toEqual({
      status: 'unbooked',
      stale: false,
    });
  });

  it('rejects stale link versions, stale reservation versions and target changes without a version', () => {
    const link = activeLink();
    const base = {
      type: 'apply_canonical_refresh' as const,
      match: match(),
      expectedMatchVersion: 7,
      expectedLinkVersion: 1,
      now: unixEpochSeconds(Number(NOW) + 10),
    };
    expect(transitionMatchReservationRefresh(link, {
      ...base,
      expectedLinkVersion: 2,
      reservation: reservation(),
    })).toEqual({ outcome: 'rejected', reason: 'link_version_conflict' });
    expect(transitionMatchReservationRefresh(link, {
      ...base,
      reservation: reservation({ version: 4 }),
    })).toEqual({
      outcome: 'rejected',
      reason: 'reservation_version_conflict',
    });
    expect(transitionMatchReservationRefresh(link, {
      ...base,
      reservation: reservation({ target: TARGET_B }),
    })).toEqual({
      outcome: 'rejected',
      reason: 'reservation_version_conflict',
    });
  });

  it('rejects provider record rebinding during refresh', () => {
    const link = activeLink();
    const rebound = reservation({
      version: 6,
      providerBinding: Object.freeze({
        provider: 'yclients',
        appointmentId: 91_001,
        recordId: 189_999,
        recordHash: 'different-record',
      }),
    });
    expect(transitionMatchReservationRefresh(link, {
      type: 'apply_canonical_refresh',
      match: match(),
      reservation: rebound,
      expectedMatchVersion: 7,
      expectedLinkVersion: 1,
      now: unixEpochSeconds(Number(NOW) + 10),
    })).toEqual({
      outcome: 'rejected',
      reason: 'provider_binding_conflict',
    });
  });

  it('projects only a matching current confirmed binding as fresh', () => {
    const link = activeLink();
    expect(projectMatchCourtBooking(link, reservation())).toEqual({
      status: 'confirmed',
      stale: false,
      reservationId: RESERVATION,
      target: TARGET_A,
    });
    expect(projectMatchCourtBooking(
      link,
      reservation({ ownerAccountId: OTHER_OWNER }),
    )).toEqual({ status: 'unbooked', stale: false });
    expect(projectMatchCourtBooking(
      link,
      reservation({ status: 'unknown', version: 6 }),
    )).toEqual({
      status: 'confirmed',
      stale: true,
      reservationId: RESERVATION,
      target: TARGET_A,
    });
    expect(projectMatchCourtBooking(
      link,
      reservation({ target: TARGET_B }),
    )).toEqual({ status: 'unbooked', stale: false });
    expect(projectMatchCourtBooking(
      link,
      reservation({ version: 4 }),
    )).toEqual({ status: 'unbooked', stale: false });
    const { providerBinding: _providerBinding, ...withoutBinding } =
      reservation();
    expect(projectMatchCourtBooking(link, withoutBinding)).toEqual({
      status: 'unbooked',
      stale: false,
    });
  });
});
