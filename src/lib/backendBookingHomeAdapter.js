const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;

const VISIBLE_RESERVATION_STATUSES = new Set([
  'pending_confirmation',
  'confirmed',
  'unknown',
  'cancelled',
]);

const STATUS_PRESENTATION = Object.freeze({
  pending_confirmation: Object.freeze({
    label: 'Ожидает',
    tone: 'pending',
  }),
  confirmed: Object.freeze({
    label: 'Подтверждено',
    tone: 'confirmed',
  }),
  unknown: Object.freeze({
    label: 'Уточняется',
    tone: 'pending',
  }),
  cancelled: Object.freeze({
    label: 'Отменено',
    tone: 'cancelled',
  }),
});

export function getBackendBookingStatusPresentation(status) {
  return STATUS_PRESENTATION[status] ?? Object.freeze({
    label: 'Уточняется',
    tone: 'pending',
  });
}

export function mapBackendReservationToHomeEvent(reservation) {
  if (
    reservation === null ||
    typeof reservation !== 'object' ||
    typeof reservation.reservationId !== 'string' ||
    !UUID_PATTERN.test(reservation.reservationId) ||
    !VISIBLE_RESERVATION_STATUSES.has(reservation.status) ||
    !Number.isSafeInteger(reservation.serviceId) ||
    reservation.serviceId < 1 ||
    !Number.isSafeInteger(reservation.courtId) ||
    reservation.courtId < 1 ||
    typeof reservation.startsAt !== 'string' ||
    !ISO_DATETIME_PATTERN.test(reservation.startsAt) ||
    typeof reservation.endsAt !== 'string' ||
    !ISO_DATETIME_PATTERN.test(reservation.endsAt) ||
    typeof reservation.stale !== 'boolean' ||
    !Number.isFinite(Date.parse(reservation.startsAt)) ||
    !Number.isFinite(Date.parse(reservation.endsAt)) ||
    Date.parse(reservation.endsAt) <= Date.parse(reservation.startsAt)
  ) {
    return null;
  }

  return Object.freeze({
    id: `reservation:${reservation.reservationId}`,
    reservationId: reservation.reservationId,
    type: 'private',
    isPrivate: true,
    isTraining: false,
    isBackendReservation: true,
    reservationStatus: reservation.status,
    stale: reservation.stale,
    startsAt: reservation.startsAt,
    endsAt: reservation.endsAt,
    dateISO: reservation.startsAt.slice(0, 10),
    time: reservation.startsAt.slice(11, 16),
    duration:
      (Date.parse(reservation.endsAt) - Date.parse(reservation.startsAt)) /
      3_600_000,
    courtId: reservation.courtId,
    courtName: `Корт ${reservation.courtId}`,
  });
}

export function selectBackendReservationsForHome(
  reservations,
  nowMilliseconds = Date.now(),
) {
  if (!Array.isArray(reservations) || !Number.isFinite(nowMilliseconds)) {
    return Object.freeze([]);
  }

  return Object.freeze(
    reservations
      .map(mapBackendReservationToHomeEvent)
      .filter((event) => (
        event !== null &&
        Date.parse(event.endsAt) > nowMilliseconds
      )),
  );
}
