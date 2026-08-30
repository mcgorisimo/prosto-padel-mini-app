import { QueryResult, QueryResultRow } from 'pg';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { MatchReservationLinkId } from '../matches/match-reservation.types';
import { MatchId } from '../matches/match.types';
import { CourtReservation } from '../reservations/reservation.types';
import { PostgresMatchReservationRepository } from './postgres-match-reservation.repository';
import { PostgresTransaction } from './postgres-transaction';

const OWNER = deterministicUuid('d3-repository-owner') as AccountId;
const PARTICIPANT = deterministicUuid('d3-repository-participant') as AccountId;
const MATCH_ID = deterministicUuid('d3-repository-match') as MatchId;
const RESERVATION_ID = deterministicUuid(
  'd3-repository-reservation',
) as CourtReservation['reservationId'];
const LINK_ID = deterministicUuid(
  'd3-repository-link',
) as MatchReservationLinkId;
const NOW = unixEpochSeconds(1_800_000_000);

function reservation(
  overrides: Partial<CourtReservation> = {},
): CourtReservation {
  return Object.freeze({
    reservationId: RESERVATION_ID,
    ownerAccountId: OWNER,
    status: 'confirmed',
    target: Object.freeze({
      serviceId: 11,
      courtId: 22,
      startsAt: '2027-01-17T10:00:00+03:00',
      endsAt: '2027-01-17T11:30:00+03:00',
    }),
    providerBinding: Object.freeze({
      provider: 'yclients',
      appointmentId: 33,
      recordId: 44,
      recordHash: 'private-hash',
    }),
    createdAt: NOW,
    updatedAt: NOW,
    version: 3,
    ...overrides,
  });
}

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    link_id: LINK_ID,
    match_id: MATCH_ID,
    reservation_id: RESERVATION_ID,
    owner_account_id: OWNER,
    state: 'active',
    provider_appointment_id: '33',
    provider_record_id: '44',
    target_service_id: '11',
    target_resource_id: '22',
    target_datetime_text: '2027-01-17T10:00:00+03:00',
    target_end_datetime_text: '2027-01-17T11:30:00+03:00',
    observed_reservation_version: '3',
    created_at: String(NOW),
    updated_at: String(NOW),
    version: '1',
    ...overrides,
  };
}

function result<Row extends QueryResultRow>(
  rows: readonly Row[],
  rowCount: number | null = rows.length,
): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

class FakeTransaction implements PostgresTransaction {
  readonly calls: { text: string; values: readonly unknown[] }[] = [];

  constructor(private readonly queued: readonly QueryResult<QueryResultRow>[]) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    const next = this.queued[this.calls.length - 1];
    if (next === undefined) throw new Error('Unexpected D3 query');
    return next as QueryResult<Row>;
  }
}

function matchRow() {
  return {
    id: MATCH_ID,
    owner_account_id: OWNER,
    starts_at: String(Number(NOW) + 7_200),
    updated_at: String(NOW),
    status: 'searching',
    version: '1',
  };
}

describe('PostgresMatchReservationRepository', () => {
  it('locks the reservation scope before match creation using the canonical link order', async () => {
    const stored = reservation();
    const reservations = { findById: jest.fn(async () => stored) };
    const transaction = new FakeTransaction([
      result([{ locked: null }]),
      result([{ reservation_id: RESERVATION_ID }]),
    ]);
    const repository = new PostgresMatchReservationRepository(
      reservations as never,
    );

    await expect(repository.lockReservationForMatchCreate(
      transaction,
      OWNER,
      RESERVATION_ID,
    )).resolves.toBe(stored);
    expect(transaction.calls[0].text).toContain('pg_advisory_xact_lock');
    expect(transaction.calls[1].text).toContain('FOR UPDATE');
    expect(reservations.findById).toHaveBeenCalledWith(
      transaction,
      OWNER,
      RESERVATION_ID,
    );
  });

  it('atomically links only a confirmed owner reservation and appends all recipients', async () => {
    const stored = reservation();
    const reservations = { findById: jest.fn(async () => stored) };
    const transaction = new FakeTransaction([
      result([{ locked: null }]),
      result([{ reservation_id: RESERVATION_ID }]),
      result([matchRow()]),
      result([{ account_id: PARTICIPANT }]),
      result([]),
      result([], 1),
      result([], 1),
      result([], 2),
    ]);
    const repository = new PostgresMatchReservationRepository(
      reservations as never,
    );

    await expect(repository.linkConfirmed(transaction, {
      linkId: LINK_ID,
      matchId: MATCH_ID,
      reservationId: RESERVATION_ID,
      ownerAccountId: OWNER,
      now: NOW,
    })).resolves.toMatchObject({
      outcome: 'linked',
      persistence: 'applied',
      projection: {
        status: 'confirmed',
        stale: false,
        reservationId: RESERVATION_ID,
      },
    });

    expect(transaction.calls[5].text).toContain(
      'INSERT INTO backend_match.match_reservation_links',
    );
    expect(transaction.calls[6].text).toContain(
      'INSERT INTO backend_match.match_reservation_events',
    );
    expect(transaction.calls[7].values[2]).toEqual([OWNER, PARTICIPANT]);
  });

  it('updates the active projection and appends one moved event after canonical D2 refresh', async () => {
    const moved = reservation({
      target: Object.freeze({
        serviceId: 11,
        courtId: 55,
        startsAt: '2027-01-18T12:00:00+03:00',
        endsAt: '2027-01-18T13:30:00+03:00',
      }),
      updatedAt: unixEpochSeconds(Number(NOW) + 10),
      version: 4,
    });
    const transaction = new FakeTransaction([
      result([linkRow()]),
      result([matchRow()]),
      result([{ account_id: PARTICIPANT }]),
      result([linkRow()]),
      result([], 1),
      result([], 1),
      result([], 2),
    ]);
    const repository = new PostgresMatchReservationRepository({} as never);

    await expect(
      repository.synchronizeCanonicalRefresh(transaction, moved),
    ).resolves.toEqual({ outcome: 'moved', matchId: MATCH_ID });
    expect(transaction.calls[0].text).not.toContain('pg_advisory_xact_lock');
    expect(transaction.calls[4].text).toContain(
      'UPDATE backend_match.match_reservation_links',
    );
    expect(transaction.calls[5].values).toEqual(
      expect.arrayContaining(['court_moved', 4]),
    );
  });

  it('releases the court guarantee without deleting the match after canonical cancellation', async () => {
    const cancelled = reservation({
      status: 'cancelled',
      updatedAt: unixEpochSeconds(Number(NOW) + 10),
      version: 4,
    });
    const transaction = new FakeTransaction([
      result([linkRow()]),
      result([matchRow()]),
      result([]),
      result([linkRow()]),
      result([], 1),
      result([], 1),
      result([], 1),
    ]);
    const repository = new PostgresMatchReservationRepository({} as never);

    await expect(
      repository.synchronizeCanonicalRefresh(transaction, cancelled),
    ).resolves.toEqual({ outcome: 'cancelled', matchId: MATCH_ID });
    expect(transaction.calls[0].text).not.toContain('pg_advisory_xact_lock');
    expect(transaction.calls[4].text).toContain("state = 'released'");
    expect(transaction.calls[5].values).toEqual(
      expect.arrayContaining(['court_cancelled', 4]),
    );
    expect(transaction.calls.some(({ text }) =>
      /delete\s+from\s+backend_match\.matches/iu.test(text),
    )).toBe(false);
  });

  it('reads confirmed court projections for a feed in one bounded query', async () => {
    const transaction = new FakeTransaction([
      result([{
        ...linkRow(),
        reservation_owner_account_id: OWNER,
        reservation_status: 'confirmed',
        reservation_target_service_id: '11',
        reservation_target_resource_id: '22',
        reservation_target_datetime_text: '2027-01-17T10:00:00+03:00',
        reservation_target_end_datetime_text: '2027-01-17T11:30:00+03:00',
        reservation_provider_appointment_id: '33',
        reservation_provider_record_id: '44',
        reservation_version: '3',
      }]),
    ]);
    const reservations = { findById: jest.fn() };
    const repository = new PostgresMatchReservationRepository(
      reservations as never,
    );

    await expect(repository.readCourtBookings(
      transaction,
      [MATCH_ID],
    )).resolves.toEqual(new Map([[MATCH_ID, {
      status: 'confirmed',
      stale: false,
      reservationId: RESERVATION_ID,
      target: {
        serviceId: 11,
        courtId: 22,
        startsAt: '2027-01-17T10:00:00+03:00',
        endsAt: '2027-01-17T11:30:00+03:00',
      },
    }]]));
    expect(transaction.calls).toHaveLength(1);
    expect(transaction.calls[0].text).toContain(
      'JOIN backend_reservation.court_reservations',
    );
    expect(reservations.findById).not.toHaveBeenCalled();
  });
});
