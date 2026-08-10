import { QueryResultRow } from 'pg';
import { AccountId, isAccountId } from '../accounts/account.types';
import { uuidV5FromParts } from '../auth/crypto-encoding';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  ActiveMatchReservationLink,
  MatchCourtBookingProjection,
  MatchReservationLifecycleEventSeed,
  MatchReservationLinkId,
  MatchReservationMatchSnapshot,
  isMatchReservationLinkId,
} from '../matches/match-reservation.types';
import {
  activateConfirmedMatchReservation,
  projectMatchCourtBooking,
  transitionMatchReservationRefresh,
} from '../matches/match-reservation.state-machine';
import {
  MATCH_STATUSES,
  MatchId,
  MatchStatus,
  isMatchId,
} from '../matches/match.types';
import {
  CourtReservation,
  CourtReservationId,
  ReservationTarget,
  isCourtReservationId,
  isReservationStatus,
  isReservationTarget,
} from '../reservations/reservation.types';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresCourtReservationRepository } from './postgres-court-reservation.repository';
import {
  LinkConfirmedMatchReservationResult,
  MatchReservationPersistenceError,
  MatchReservationPersistenceFailure,
  MatchReservationRepository,
  SynchronizeMatchReservationResult,
} from './match-reservation.repository';
import { PostgresTransaction } from './postgres-transaction';

const UUID_URL_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const MAX_PROJECTION_MATCHES = 50;
const SUPPORTED_DURATIONS = new Set([60, 90, 120, 150]);

interface MatchSnapshotRow extends QueryResultRow {
  readonly id: unknown;
  readonly owner_account_id: unknown;
  readonly starts_at: unknown;
  readonly updated_at: unknown;
  readonly status: unknown;
  readonly version: unknown;
}

interface LinkRow extends QueryResultRow {
  readonly link_id: unknown;
  readonly match_id: unknown;
  readonly reservation_id: unknown;
  readonly owner_account_id: unknown;
  readonly state: unknown;
  readonly provider_appointment_id: unknown;
  readonly provider_record_id: unknown;
  readonly target_service_id: unknown;
  readonly target_resource_id: unknown;
  readonly target_datetime_text: unknown;
  readonly target_end_datetime_text: unknown;
  readonly observed_reservation_version: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly version: unknown;
}

interface ProjectionRow extends LinkRow {
  readonly reservation_owner_account_id: unknown;
  readonly reservation_status: unknown;
  readonly reservation_target_service_id: unknown;
  readonly reservation_target_resource_id: unknown;
  readonly reservation_target_datetime_text: unknown;
  readonly reservation_target_end_datetime_text: unknown;
  readonly reservation_provider_appointment_id: unknown;
  readonly reservation_provider_record_id: unknown;
  readonly reservation_version: unknown;
}

const LINK_COLUMNS = `
  link_id, match_id, reservation_id, owner_account_id, state,
  provider_appointment_id, provider_record_id, target_service_id,
  target_resource_id, target_datetime_text, target_end_datetime_text,
  observed_reservation_version, created_at, updated_at, version
`;

const QUALIFIED_LINK_COLUMNS = `
  links.link_id, links.match_id, links.reservation_id,
  links.owner_account_id, links.state, links.provider_appointment_id,
  links.provider_record_id, links.target_service_id,
  links.target_resource_id, links.target_datetime_text,
  links.target_end_datetime_text, links.observed_reservation_version,
  links.created_at, links.updated_at, links.version
`;

function failure(
  reason: MatchReservationPersistenceFailure,
): MatchReservationPersistenceError {
  return new MatchReservationPersistenceError(reason);
}

function mapPersistenceError(error: unknown): MatchReservationPersistenceError {
  if (error instanceof MatchReservationPersistenceError) return error;
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') return failure('storage_failure');
  switch (classified.category) {
    case 'foreign_key_violation':
      return failure('referential_integrity');
    case 'insufficient_privilege':
      return failure('permission_denied');
    case 'serialization_failure':
    case 'deadlock_detected':
    case 'unique_violation':
      return failure('transaction_conflict');
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled':
      return failure('database_unavailable');
    default:
      return failure('storage_failure');
  }
}

function safeInteger(value: unknown, minimum = 0): number {
  const parsed =
    typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < minimum) {
    throw failure('invalid_persisted_state');
  }
  return Number(parsed);
}

function epoch(value: unknown) {
  const parsed = safeInteger(value);
  if (!isUnixEpochSeconds(parsed)) throw failure('invalid_persisted_state');
  return parsed;
}

function targetFromRow(row: LinkRow): ReservationTarget {
  const target = Object.freeze({
    serviceId: safeInteger(row.target_service_id, 1),
    courtId: safeInteger(row.target_resource_id, 1),
    startsAt: row.target_datetime_text,
    endsAt: row.target_end_datetime_text,
  });
  if (!isReservationTarget(target)) throw failure('invalid_persisted_state');
  return target;
}

function activeLink(row: LinkRow): ActiveMatchReservationLink {
  if (
    !isMatchReservationLinkId(row.link_id) ||
    !isMatchId(row.match_id) ||
    !isCourtReservationId(row.reservation_id) ||
    !isAccountId(row.owner_account_id) ||
    row.state !== 'active'
  ) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({
    linkId: row.link_id,
    matchId: row.match_id,
    reservationId: row.reservation_id,
    ownerAccountId: row.owner_account_id,
    state: 'active',
    providerAppointmentId: safeInteger(row.provider_appointment_id, 1),
    providerRecordId: safeInteger(row.provider_record_id, 1),
    target: targetFromRow(row),
    observedReservationVersion: safeInteger(
      row.observed_reservation_version,
      1,
    ),
    createdAt: epoch(row.created_at),
    updatedAt: epoch(row.updated_at),
    version: safeInteger(row.version, 1),
  });
}

function matchSnapshot(row: MatchSnapshotRow): MatchReservationMatchSnapshot {
  if (
    !isMatchId(row.id) ||
    !isAccountId(row.owner_account_id) ||
    typeof row.status !== 'string' ||
    !MATCH_STATUSES.includes(row.status as MatchStatus)
  ) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({
    matchId: row.id,
    ownerAccountId: row.owner_account_id,
    startsAt: epoch(row.starts_at),
    updatedAt: epoch(row.updated_at),
    status: row.status as MatchStatus,
    version: safeInteger(row.version, 1),
  });
}

function durationSupported(target: ReservationTarget): boolean {
  const duration =
    (Date.parse(target.endsAt) - Date.parse(target.startsAt)) / 60_000;
  return Number.isInteger(duration) && SUPPORTED_DURATIONS.has(duration);
}

function sameTarget(left: ReservationTarget, right: ReservationTarget) {
  return left.serviceId === right.serviceId &&
    left.courtId === right.courtId &&
    left.startsAt === right.startsAt &&
    left.endsAt === right.endsAt;
}

function projectionFromRow(row: ProjectionRow): MatchCourtBookingProjection {
  const link = activeLink(row);
  if (
    row.reservation_owner_account_id !== link.ownerAccountId ||
    !isReservationStatus(row.reservation_status)
  ) {
    throw failure('invalid_persisted_state');
  }
  const reservationTarget = Object.freeze({
    serviceId: safeInteger(row.reservation_target_service_id, 1),
    courtId: safeInteger(row.reservation_target_resource_id, 1),
    startsAt: row.reservation_target_datetime_text,
    endsAt: row.reservation_target_end_datetime_text,
  });
  if (!isReservationTarget(reservationTarget)) {
    throw failure('invalid_persisted_state');
  }
  const reservationVersion = safeInteger(row.reservation_version, 1);
  if (row.reservation_status !== 'confirmed') {
    return Object.freeze({ status: 'unbooked', stale: false });
  }
  if (
    safeInteger(row.reservation_provider_appointment_id, 1) !==
      link.providerAppointmentId ||
    safeInteger(row.reservation_provider_record_id, 1) !==
      link.providerRecordId ||
    reservationVersion < link.observedReservationVersion ||
    (reservationVersion === link.observedReservationVersion &&
      !sameTarget(reservationTarget, link.target))
  ) {
    return Object.freeze({ status: 'unbooked', stale: false });
  }
  return Object.freeze({
    status: 'confirmed',
    stale:
      reservationVersion !== link.observedReservationVersion ||
      !sameTarget(reservationTarget, link.target),
    reservationId: link.reservationId,
    target: link.target,
  });
}

function eventId(event: MatchReservationLifecycleEventSeed): string {
  return uuidV5FromParts(UUID_URL_NAMESPACE, [
    'prosto-padel.match-reservation.event.v1',
    event.linkId,
    event.eventType,
    String(event.reservationVersion),
  ]);
}

function eventTargetValues(target: ReservationTarget | undefined) {
  return target === undefined
    ? [null, null, null, null]
    : [target.serviceId, target.courtId, target.startsAt, target.endsAt];
}

function mapActivationRejection(
  reason: string,
): LinkConfirmedMatchReservationResult {
  const mappings = Object.freeze({
    ownership_conflict: 'forbidden',
    match_terminal: 'match_terminal',
    reservation_not_confirmed: 'reservation_not_confirmed',
    provider_binding_missing: 'provider_binding_missing',
    match_already_linked: 'match_already_linked',
    reservation_already_linked: 'reservation_already_linked',
    match_version_conflict: 'conflict',
    reservation_version_conflict: 'conflict',
    provider_binding_conflict: 'conflict',
    reservation_binding_conflict: 'conflict',
  } as const);
  return Object.freeze({
    outcome: 'rejected',
    reason: mappings[reason as keyof typeof mappings] ?? 'conflict',
  });
}

export class PostgresMatchReservationRepository
  implements MatchReservationRepository
{
  constructor(
    private readonly reservations: PostgresCourtReservationRepository,
  ) {}

  private async lockReservationScope(
    transaction: PostgresTransaction,
    reservationId: CourtReservationId,
  ): Promise<void> {
    await transaction.query(
      `SELECT pg_catalog.pg_advisory_xact_lock(
         pg_catalog.hashtextextended(
           'backend_match:reservation-link:'::text || $1::text,
           0::bigint
         )
       ) AS locked`,
      [reservationId],
    );
  }

  private async lockReservation(
    transaction: PostgresTransaction,
    ownerAccountId: AccountId,
    reservationId: CourtReservationId,
  ): Promise<CourtReservation | null> {
    const locked = await transaction.query<{ reservation_id: unknown }>(
      `SELECT reservation_id
       FROM backend_reservation.court_reservations
       WHERE owner_account_id = $1 AND reservation_id = $2
       FOR UPDATE`,
      [ownerAccountId, reservationId],
    );
    if (locked.rowCount === 0) return null;
    if (locked.rowCount !== 1 || locked.rows.length !== 1) {
      throw failure('invalid_persisted_state');
    }
    return this.reservations.findById(
      transaction,
      ownerAccountId,
      reservationId,
    );
  }

  private async lockMatch(
    transaction: PostgresTransaction,
    matchId: MatchId,
  ): Promise<MatchReservationMatchSnapshot | null> {
    const selected = await transaction.query<MatchSnapshotRow>(
      `SELECT id, owner_account_id, starts_at, updated_at, status, version
       FROM backend_match.matches
       WHERE id = $1
       FOR UPDATE`,
      [matchId],
    );
    if (selected.rowCount === 0) return null;
    if (selected.rowCount !== 1 || selected.rows.length !== 1) {
      throw failure('invalid_persisted_state');
    }
    return matchSnapshot(selected.rows[0]);
  }

  private async recipients(
    transaction: PostgresTransaction,
    match: MatchReservationMatchSnapshot,
  ): Promise<readonly AccountId[]> {
    const selected = await transaction.query<{ account_id: unknown }>(
      `SELECT account_id
       FROM backend_match.match_participants
       WHERE match_id = $1 AND status = 'active'
       ORDER BY slot_number, account_id
       FOR UPDATE`,
      [match.matchId],
    );
    if (selected.rowCount !== selected.rows.length || selected.rows.length > 3) {
      throw failure('invalid_persisted_state');
    }
    const recipients: AccountId[] = [match.ownerAccountId];
    for (const row of selected.rows) {
      if (!isAccountId(row.account_id)) throw failure('invalid_persisted_state');
      recipients.push(row.account_id);
    }
    if (new Set(recipients).size !== recipients.length) {
      throw failure('invalid_persisted_state');
    }
    return Object.freeze(recipients);
  }

  private async activeLinksForBinding(
    transaction: PostgresTransaction,
    matchId: MatchId,
    reservationId: CourtReservationId,
  ): Promise<readonly ActiveMatchReservationLink[]> {
    const selected = await transaction.query<LinkRow>(
      `SELECT ${LINK_COLUMNS}
       FROM backend_match.match_reservation_links
       WHERE state = 'active'
         AND (match_id = $1 OR reservation_id = $2)
       ORDER BY link_id
       FOR UPDATE`,
      [matchId, reservationId],
    );
    if (selected.rowCount !== selected.rows.length || selected.rows.length > 2) {
      throw failure('invalid_persisted_state');
    }
    return Object.freeze(selected.rows.map(activeLink));
  }

  private async appendEvent(
    transaction: PostgresTransaction,
    event: MatchReservationLifecycleEventSeed,
    recipients: readonly AccountId[],
  ): Promise<void> {
    const previous = eventTargetValues(event.previousTarget);
    const current = eventTargetValues(event.currentTarget);
    const inserted = await transaction.query(
      `INSERT INTO backend_match.match_reservation_events (
         event_id, link_id, match_id, reservation_id, owner_account_id,
         event_type, reservation_version, expected_recipient_count,
         previous_service_id, previous_resource_id,
         previous_datetime, previous_datetime_text,
         previous_end_datetime, previous_end_datetime_text,
         current_service_id, current_resource_id,
         current_datetime, current_datetime_text,
         current_end_datetime, current_end_datetime_text, occurred_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,
         $9,$10,$11::text::timestamptz,$11::text,
         $12::text::timestamptz,$12::text,
         $13,$14,$15::text::timestamptz,$15::text,
         $16::text::timestamptz,$16::text,$17
       )`,
      [
        eventId(event),
        event.linkId,
        event.matchId,
        event.reservationId,
        event.ownerAccountId,
        event.eventType,
        event.reservationVersion,
        recipients.length,
        ...previous,
        ...current,
        event.occurredAt,
      ],
    );
    if (inserted.rowCount !== 1) throw failure('invalid_persisted_state');
    const insertedRecipients = await transaction.query(
      `INSERT INTO backend_match.match_reservation_event_recipients (
         event_id, recipient_account_id, created_at, version
       )
       SELECT $1::uuid, recipient_id, $2::bigint, 1::bigint
       FROM pg_catalog.unnest($3::uuid[]) AS recipient_id`,
      [eventId(event), event.occurredAt, recipients],
    );
    if (insertedRecipients.rowCount !== recipients.length) {
      throw failure('invalid_persisted_state');
    }
  }

  async linkConfirmed(
    transaction: PostgresTransaction,
    input: Readonly<{
      linkId: MatchReservationLinkId;
      matchId: MatchId;
      reservationId: CourtReservationId;
      ownerAccountId: AccountId;
      now: import('../auth/auth.types').UnixEpochSeconds;
    }>,
  ): Promise<LinkConfirmedMatchReservationResult> {
    try {
      if (
        !isMatchReservationLinkId(input.linkId) ||
        !isMatchId(input.matchId) ||
        !isCourtReservationId(input.reservationId) ||
        !isAccountId(input.ownerAccountId) ||
        !isUnixEpochSeconds(input.now)
      ) {
        throw failure('invalid_input');
      }
      await this.lockReservationScope(transaction, input.reservationId);
      const reservation = await this.lockReservation(
        transaction,
        input.ownerAccountId,
        input.reservationId,
      );
      if (reservation === null) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'reservation_not_found',
        });
      }
      const match = await this.lockMatch(transaction, input.matchId);
      if (match === null) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_not_found' });
      }
      if (match.ownerAccountId !== input.ownerAccountId) {
        return Object.freeze({ outcome: 'rejected', reason: 'forbidden' });
      }
      if (!durationSupported(reservation.target)) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'unsupported_duration',
        });
      }
      const recipients = await this.recipients(transaction, match);
      const links = await this.activeLinksForBinding(
        transaction,
        input.matchId,
        input.reservationId,
      );
      const activeMatchLink = links.find((link) => link.matchId === input.matchId);
      const activeReservationLink = links.find(
        (link) => link.reservationId === input.reservationId,
      );
      const transition = activateConfirmedMatchReservation({
        linkId: input.linkId,
        match,
        reservation,
        expectedMatchVersion: match.version,
        expectedReservationVersion: reservation.version,
        now: input.now,
        ...(activeMatchLink === undefined ? {} : { activeMatchLink }),
        ...(activeReservationLink === undefined
          ? {}
          : { activeReservationLink }),
      });
      if (transition.outcome === 'rejected') {
        return mapActivationRejection(transition.reason);
      }
      if (transition.outcome === 'idempotent_retry') {
        return Object.freeze({
          outcome: 'linked',
          persistence: 'idempotent_retry',
          projection: projectMatchCourtBooking(transition.link, reservation),
        });
      }
      const link = transition.link;
      const inserted = await transaction.query(
        `INSERT INTO backend_match.match_reservation_links (
           link_id, match_id, reservation_id, owner_account_id, state,
           provider_appointment_id, provider_record_id, target_service_id,
           target_resource_id, target_datetime, target_datetime_text,
           target_end_datetime, target_end_datetime_text,
           observed_reservation_version, version, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,'active',$5,$6,$7,$8,
           $9::text::timestamptz,$9::text,
           $10::text::timestamptz,$10::text,$11,1,$12,$12
         )`,
        [
          link.linkId,
          link.matchId,
          link.reservationId,
          link.ownerAccountId,
          link.providerAppointmentId,
          link.providerRecordId,
          link.target.serviceId,
          link.target.courtId,
          link.target.startsAt,
          link.target.endsAt,
          link.observedReservationVersion,
          link.createdAt,
        ],
      );
      if (inserted.rowCount !== 1) throw failure('invalid_persisted_state');
      await this.appendEvent(transaction, transition.event, recipients);
      return Object.freeze({
        outcome: 'linked',
        persistence: 'applied',
        projection: projectMatchCourtBooking(link, reservation),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async synchronizeCanonicalRefresh(
    transaction: PostgresTransaction,
    reservation: CourtReservation,
  ): Promise<SynchronizeMatchReservationResult> {
    try {
      if (
        !isCourtReservationId(reservation?.reservationId) ||
        !isAccountId(reservation?.ownerAccountId)
      ) {
        throw failure('invalid_input');
      }
      // The D2 repository already holds the reservation row lock while applying
      // the exact refresh. Taking the link advisory lock here would invert the
      // link flow order (advisory -> reservation) and allow a deadlock.
      const candidate = await transaction.query<LinkRow>(
        `SELECT ${LINK_COLUMNS}
         FROM backend_match.match_reservation_links
         WHERE reservation_id = $1 AND state = 'active'`,
        [reservation.reservationId],
      );
      if (candidate.rowCount === 0) {
        return Object.freeze({ outcome: 'not_linked' });
      }
      if (candidate.rowCount !== 1 || candidate.rows.length !== 1) {
        throw failure('invalid_persisted_state');
      }
      const candidateLink = activeLink(candidate.rows[0]);
      const match = await this.lockMatch(transaction, candidateLink.matchId);
      if (match === null || match.ownerAccountId !== reservation.ownerAccountId) {
        throw failure('invalid_persisted_state');
      }
      const recipients = await this.recipients(transaction, match);
      const selected = await transaction.query<LinkRow>(
        `SELECT ${LINK_COLUMNS}
         FROM backend_match.match_reservation_links
         WHERE link_id = $1 AND reservation_id = $2 AND state = 'active'
         FOR UPDATE`,
        [candidateLink.linkId, reservation.reservationId],
      );
      if (selected.rowCount !== 1 || selected.rows.length !== 1) {
        throw failure('transaction_conflict');
      }
      const link = activeLink(selected.rows[0]);
      const transition = transitionMatchReservationRefresh(link, {
        type: 'apply_canonical_refresh',
        match,
        reservation,
        expectedMatchVersion: match.version,
        expectedLinkVersion: link.version,
        now: reservation.updatedAt,
      });
      if (transition.outcome === 'rejected') {
        throw failure('invalid_persisted_state');
      }
      if (transition.outcome === 'preserved_uncertain') {
        throw failure('invalid_persisted_state');
      }
      if (
        transition.outcome === 'refreshed' &&
        transition.link === link
      ) {
        return Object.freeze({ outcome: 'unchanged', matchId: link.matchId });
      }
      const updated = await transaction.query(
        transition.outcome === 'released'
          ? `UPDATE backend_match.match_reservation_links
             SET state = 'released',
                 observed_reservation_version = $2,
                 updated_at = $3,
                 version = $4,
                 released_at = $3,
                 release_reason = 'canonical_reservation_cancelled'
             WHERE link_id = $1 AND state = 'active' AND version = $5`
          : `UPDATE backend_match.match_reservation_links
             SET target_service_id = $2,
                 target_resource_id = $3,
                 target_datetime = $4::text::timestamptz,
                 target_datetime_text = $4::text,
                 target_end_datetime = $5::text::timestamptz,
                 target_end_datetime_text = $5::text,
                 observed_reservation_version = $6,
                 updated_at = $7,
                 version = $8
             WHERE link_id = $1 AND state = 'active' AND version = $9`,
        transition.outcome === 'released'
          ? [
              link.linkId,
              transition.link.observedReservationVersion,
              transition.link.updatedAt,
              transition.link.version,
              link.version,
            ]
          : [
              link.linkId,
              transition.link.target.serviceId,
              transition.link.target.courtId,
              transition.link.target.startsAt,
              transition.link.target.endsAt,
              transition.link.observedReservationVersion,
              transition.link.updatedAt,
              transition.link.version,
              link.version,
            ],
      );
      if (updated.rowCount !== 1) throw failure('transaction_conflict');
      if (transition.event !== undefined) {
        await this.appendEvent(transaction, transition.event, recipients);
      }
      return Object.freeze({
        outcome:
          transition.outcome === 'released'
            ? 'cancelled'
            : transition.effect === 'court_moved'
              ? 'moved'
              : 'unchanged',
        matchId: link.matchId,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async readCourtBookings(
    transaction: PostgresTransaction,
    matchIds: readonly MatchId[],
  ): Promise<ReadonlyMap<MatchId, MatchCourtBookingProjection>> {
    try {
      if (
        !Array.isArray(matchIds) ||
        matchIds.length > MAX_PROJECTION_MATCHES ||
        matchIds.some((matchId) => !isMatchId(matchId)) ||
        new Set(matchIds).size !== matchIds.length
      ) {
        throw failure('invalid_input');
      }
      const projections = new Map<MatchId, MatchCourtBookingProjection>();
      if (matchIds.length === 0) return projections;
      const selected = await transaction.query<ProjectionRow>(
        `SELECT ${QUALIFIED_LINK_COLUMNS},
           reservations.owner_account_id AS reservation_owner_account_id,
           reservations.status AS reservation_status,
           reservations.target_service_id AS reservation_target_service_id,
           reservations.target_resource_id AS reservation_target_resource_id,
           reservations.target_datetime_text AS reservation_target_datetime_text,
           reservations.target_end_datetime_text AS reservation_target_end_datetime_text,
           reservations.yclients_appointment_id AS reservation_provider_appointment_id,
           reservations.yclients_record_id AS reservation_provider_record_id,
           reservations.version AS reservation_version
         FROM backend_match.match_reservation_links AS links
         JOIN backend_reservation.court_reservations AS reservations
           ON reservations.reservation_id = links.reservation_id
          AND reservations.owner_account_id = links.owner_account_id
         WHERE links.state = 'active' AND links.match_id = ANY($1::uuid[])
         ORDER BY links.match_id`,
        [matchIds],
      );
      if (selected.rowCount !== selected.rows.length || selected.rows.length > matchIds.length) {
        throw failure('invalid_persisted_state');
      }
      for (const row of selected.rows) {
        const link = activeLink(row);
        projections.set(link.matchId, projectionFromRow(row));
      }
      return projections;
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
