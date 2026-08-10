import { isInternalUuid } from '../common/internal-uuid';
import { courtReservationId } from '../reservations/reservation.types';
import { LinkMatchReservationRequest } from './match-reservation-api.types';

export function readLinkMatchReservationRequest(
  value: unknown,
): LinkMatchReservationRequest | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(record, 'requestKey') ||
    !Object.prototype.hasOwnProperty.call(record, 'reservationId') ||
    !isInternalUuid(record.requestKey) ||
    typeof record.reservationId !== 'string'
  ) {
    return undefined;
  }
  try {
    return Object.freeze({
      requestKey: record.requestKey,
      reservationId: courtReservationId(record.reservationId),
    });
  } catch {
    return undefined;
  }
}
