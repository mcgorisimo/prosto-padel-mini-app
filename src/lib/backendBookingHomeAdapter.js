const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const MAX_COURT_CATALOG_SERVICE_REQUESTS = 8;

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

function readCourtName(courtNamesById, courtId) {
  const value = courtNamesById?.[courtId];
  if (typeof value !== 'string') return 'Корт';
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 128
    ? normalized
    : 'Корт';
}

export function selectMissingBookingCourtServiceIds(
  reservations,
  courtNamesById,
  attemptedServiceIds,
) {
  if (
    !Array.isArray(reservations) ||
    !(attemptedServiceIds instanceof Set) ||
    attemptedServiceIds.size >= MAX_COURT_CATALOG_SERVICE_REQUESTS
  ) return Object.freeze([]);

  const selected = [];
  const selectedIds = new Set();
  const remaining =
    MAX_COURT_CATALOG_SERVICE_REQUESTS - attemptedServiceIds.size;
  for (const reservation of reservations) {
    if (
      readCourtName(courtNamesById, reservation?.courtId) !== 'Корт' ||
      !Number.isSafeInteger(reservation?.serviceId) ||
      reservation.serviceId < 1 ||
      attemptedServiceIds.has(reservation.serviceId) ||
      selectedIds.has(reservation.serviceId)
    ) continue;
    selectedIds.add(reservation.serviceId);
    selected.push(reservation.serviceId);
    if (selected.length === remaining) break;
  }
  return Object.freeze(selected);
}

export function mapBackendReservationToHomeEvent(
  reservation,
  courtNamesById = {},
) {
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
    courtName: readCourtName(courtNamesById, reservation.courtId),
  });
}

export function selectBackendReservationsForHome(
  reservations,
  nowMilliseconds = Date.now(),
  courtNamesById = {},
) {
  if (!Array.isArray(reservations) || !Number.isFinite(nowMilliseconds)) {
    return Object.freeze([]);
  }

  return Object.freeze(
    reservations
      .map((reservation) => mapBackendReservationToHomeEvent(
        reservation,
        courtNamesById,
      ))
      .filter((event) => (
        event !== null &&
        Date.parse(event.endsAt) > nowMilliseconds
      )),
  );
}
