import { reservationOperationMatchesReservation } from './reservation.state-machine';
import {
  CourtReservation,
  PendingReservationOperation,
  isYclientsReservationBinding,
} from './reservation.types';

export type ReservationCancellationDeleteCommand = Readonly<{
  operationId: PendingReservationOperation['operationId'];
  reservationId: CourtReservation['reservationId'];
  ownerAccountId: CourtReservation['ownerAccountId'];
  requestDigest: PendingReservationOperation['requestDigest'];
  recordId: number;
  apiId: number;
}>;

export type ReservationCancellationDeleteResult =
  | Readonly<{ outcome: 'accepted' }>
  | Readonly<{
      /** The adapter proved that no provider request was dispatched. */
      outcome: 'not_sent';
      reason: 'provider_disabled' | 'invalid_request';
    }>
  | Readonly<{ outcome: 'unknown' }>;

export type ReservationCancellationExactRecord = Readonly<{
  recordId: number;
  apiId: number;
  deleted: boolean;
}>;

export type ReservationCancellationExactReadResult =
  | Readonly<{
      outcome: 'found';
      record: ReservationCancellationExactRecord;
    }>
  | Readonly<{ outcome: 'not_found' }>
  | Readonly<{ outcome: 'unknown' }>;

/**
 * Cancel-only provider boundary. It deliberately exposes neither reschedule
 * nor a generic write method. Implementations must make at most one DELETE
 * for each deleteOnce invocation and must never retry it internally.
 */
export interface ReservationCancellationProviderPort {
  deleteOnce(
    command: ReservationCancellationDeleteCommand,
  ): Promise<ReservationCancellationDeleteResult>;

  /** Exactly one record-ID GET; no list fallback, write or automatic retry. */
  readExact(
    command: ReservationCancellationDeleteCommand,
  ): Promise<ReservationCancellationExactReadResult>;
}

export function reservationCancellationDeleteCommand(
  reservation: CourtReservation,
  operation: PendingReservationOperation,
): ReservationCancellationDeleteCommand {
  if (
    operation.request.type !== 'cancel' ||
    !isYclientsReservationBinding(reservation.providerBinding) ||
    !reservationOperationMatchesReservation(reservation, operation)
  ) {
    throw new TypeError('Reservation cancellation binding is invalid');
  }

  return Object.freeze({
    operationId: operation.operationId,
    reservationId: reservation.reservationId,
    ownerAccountId: reservation.ownerAccountId,
    requestDigest: operation.requestDigest,
    recordId: reservation.providerBinding.recordId,
    apiId: operation.request.externalReference.apiId,
  });
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

/**
 * A missing record is not proof. Only an exact safe projection of the same
 * provider record and external reference with deleted=true is canonical.
 */
export function isCanonicalReservationDeletedProof(
  value: unknown,
  command: ReservationCancellationDeleteCommand,
): value is ReservationCancellationExactRecord & Readonly<{ deleted: true }> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 3 &&
    positiveSafeInteger(record.recordId) &&
    record.recordId === command.recordId &&
    positiveSafeInteger(record.apiId) &&
    record.apiId === command.apiId &&
    record.deleted === true
  );
}
