import { reservationOperationMatchesReservation } from './reservation.state-machine';
import {
  CourtReservation,
  PendingReservationOperation,
  ReservationClientSnapshot,
  ReservationOperation,
  ReservationProviderRejectionReason,
  UnknownReservationOperation,
  YclientsReservationBinding,
} from './reservation.types';

type ReservationProviderCommandMode = 'write' | 'reconciliation';

interface ReservationProviderCommandBase<
  Mode extends ReservationProviderCommandMode,
> {
  readonly mode: Mode;
  readonly operationId: ReservationOperation['operationId'];
  readonly reservationId: ReservationOperation['reservationId'];
  readonly ownerAccountId: ReservationOperation['ownerAccountId'];
  readonly requestDigest: ReservationOperation['requestDigest'];
  readonly apiId: number;
  readonly client: ReservationClientSnapshot;
}

type ReservationProviderCommand<
  Mode extends ReservationProviderCommandMode,
> =
  | Readonly<
      ReservationProviderCommandBase<Mode> & {
        type: 'create';
        serviceId: number;
        courtId: number;
        datetime: string;
      }
    >
  | Readonly<
      ReservationProviderCommandBase<Mode> & {
        type: 'reschedule';
        serviceId: number;
        courtId: number;
        datetime: string;
        currentProviderBinding: YclientsReservationBinding;
      }
    >
  | Readonly<
      ReservationProviderCommandBase<Mode> & {
        type: 'cancel';
        currentProviderBinding: YclientsReservationBinding;
      }
    >;

export type ReservationProviderWriteCommand =
  ReservationProviderCommand<'write'>;

export type ReservationProviderReconciliationCommand =
  ReservationProviderCommand<'reconciliation'>;

export type ReservationProviderWriteResult =
  | Readonly<{
      outcome: 'confirmed';
      providerBinding?: YclientsReservationBinding;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason: ReservationProviderRejectionReason;
    }>
  | Readonly<{ outcome: 'unknown' }>;

export type ReservationProviderReconciliationResult =
  | Readonly<{
      outcome: 'confirmed';
      providerBinding?: YclientsReservationBinding;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason: ReservationProviderRejectionReason;
    }>
  | Readonly<{ outcome: 'still_unknown' }>;

function immutableClient(
  client: ReservationClientSnapshot,
): ReservationClientSnapshot {
  return Object.freeze({
    phone: client.phone,
    fullName: client.fullName,
    email: client.email,
  });
}

function immutableProviderBinding(
  binding: YclientsReservationBinding,
): YclientsReservationBinding {
  return Object.freeze({
    provider: 'yclients',
    appointmentId: binding.appointmentId,
    recordId: binding.recordId,
    recordHash: binding.recordHash,
  });
}

function providerCommand<Mode extends ReservationProviderCommandMode>(
  reservation: CourtReservation,
  operation: PendingReservationOperation | UnknownReservationOperation,
  mode: Mode,
): ReservationProviderCommand<Mode> {
  if (!reservationOperationMatchesReservation(reservation, operation)) {
    throw new TypeError('Reservation provider command binding is invalid');
  }

  const request = operation.request;
  const common = Object.freeze({
    mode,
    operationId: operation.operationId,
    reservationId: operation.reservationId,
    ownerAccountId: operation.ownerAccountId,
    requestDigest: operation.requestDigest,
    apiId: request.externalReference.apiId,
    client: immutableClient(request.client),
  });

  if (request.type === 'create') {
    return Object.freeze({
      ...common,
      type: request.type,
      serviceId: request.target.serviceId,
      courtId: request.target.courtId,
      datetime: request.target.startsAt,
    });
  }

  if (reservation.providerBinding === undefined) {
    throw new TypeError('Reservation provider binding is missing');
  }
  const currentProviderBinding = immutableProviderBinding(
    reservation.providerBinding,
  );
  return request.type === 'reschedule'
    ? Object.freeze({
        ...common,
        type: request.type,
        serviceId: request.target.serviceId,
        courtId: request.target.courtId,
        datetime: request.target.startsAt,
        currentProviderBinding,
      })
    : Object.freeze({
        ...common,
        type: request.type,
        currentProviderBinding,
      });
}

export function reservationProviderWriteCommand(
  reservation: CourtReservation,
  operation: PendingReservationOperation,
): ReservationProviderWriteCommand {
  return providerCommand(reservation, operation, 'write');
}

export function reservationProviderReconciliationCommand(
  reservation: CourtReservation,
  operation: UnknownReservationOperation,
): ReservationProviderReconciliationCommand {
  return providerCommand(reservation, operation, 'reconciliation');
}

/** Unknown operations have no API that can construct an initial write. */
export interface ReservationProviderPort {
  executeWrite(
    command: ReservationProviderWriteCommand,
  ): Promise<ReservationProviderWriteResult>;

  reconcile(
    command: ReservationProviderReconciliationCommand,
  ): Promise<ReservationProviderReconciliationResult>;
}
