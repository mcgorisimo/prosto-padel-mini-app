import { createHash } from 'node:crypto';
import { encodeLengthPrefixedUtf8 } from '../auth/crypto-encoding';
import {
  ReservationOperationRequest,
  ReservationRequestDigest,
  isReservationOperationRequest,
  reservationRequestDigest,
} from './reservation.types';

const RESERVATION_REQUEST_DIGEST_DOMAIN =
  'prosto-padel.reservations.operation.request.v1';

export function digestReservationOperationRequest(
  request: ReservationOperationRequest,
): ReservationRequestDigest {
  if (!isReservationOperationRequest(request)) {
    throw new TypeError('Reservation operation request is invalid');
  }

  const parts =
    request.type === 'cancel'
      ? [
          RESERVATION_REQUEST_DIGEST_DOMAIN,
          request.type,
          request.reservationId,
          request.ownerAccountId,
          String(request.externalReference.apiId),
          request.client.phone,
          request.client.fullName,
          request.client.email,
        ]
      : [
          RESERVATION_REQUEST_DIGEST_DOMAIN,
          request.type,
          request.reservationId,
          request.ownerAccountId,
          String(request.externalReference.apiId),
          request.client.phone,
          request.client.fullName,
          request.client.email,
          String(request.target.serviceId),
          String(request.target.courtId),
          request.target.startsAt,
          request.target.endsAt,
        ];

  return reservationRequestDigest(
    createHash('sha256')
      .update(encodeLengthPrefixedUtf8(parts))
      .digest('hex'),
  );
}
