import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import { digestReservationOperationRequest } from './reservation-request-digest';
import {
  CourtReservation,
  PendingReservationOperation,
  ReservationIdempotencyKey,
  ReservationOperation,
  ReservationOperationId,
  ReservationOperationRequest,
  ReservationProviderRejectionReason,
  ReservationStatus,
  UnknownReservationOperation,
  YclientsReservationBinding,
  isCourtReservationId,
  isReservationIdempotencyKey,
  isReservationOperationId,
  isReservationOperationRequest,
  isReservationRequestDigest,
  isReservationTarget,
  isYclientsReservationBinding,
} from './reservation.types';

export interface CreateCourtReservationInput {
  readonly reservationId: CourtReservation['reservationId'];
  readonly ownerAccountId: CourtReservation['ownerAccountId'];
  readonly target: CourtReservation['target'];
  readonly now: CourtReservation['createdAt'];
}

export interface StartReservationOperationInput {
  readonly operationId: ReservationOperationId;
  readonly actorAccountId: CourtReservation['ownerAccountId'];
  readonly idempotencyKey: ReservationIdempotencyKey;
  readonly request: ReservationOperationRequest;
  readonly now: CourtReservation['updatedAt'];
}

export type StartReservationOperationResult =
  | Readonly<{
      outcome: 'started';
      reservation: CourtReservation;
      operation: PendingReservationOperation;
    }>
  | Readonly<{
      outcome: 'idempotent_retry';
      reservation: CourtReservation;
      operation: ReservationOperation;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason:
        | 'invalid_input'
        | 'ownership_conflict'
        | 'operation_binding_conflict'
        | 'idempotency_lookup_mismatch'
        | 'idempotency_key_conflict'
        | 'forbidden_transition';
      reservation: CourtReservation;
    }>;

export type ReservationOperationTransitionCommand =
  | Readonly<{
      type: 'confirm';
      actorAccountId: CourtReservation['ownerAccountId'];
      now: CourtReservation['updatedAt'];
      providerBinding?: YclientsReservationBinding;
    }>
  | Readonly<{
      type: 'reject';
      actorAccountId: CourtReservation['ownerAccountId'];
      now: CourtReservation['updatedAt'];
      reason: ReservationProviderRejectionReason;
    }>
  | Readonly<{
      type: 'mark_unknown';
      actorAccountId: CourtReservation['ownerAccountId'];
      now: CourtReservation['updatedAt'];
    }>
  | Readonly<{
      type: 'reconcile';
      actorAccountId: CourtReservation['ownerAccountId'];
      now: CourtReservation['updatedAt'];
      result:
        | Readonly<{
            outcome: 'confirmed';
            providerBinding?: YclientsReservationBinding;
          }>
        | Readonly<{
            outcome: 'rejected';
            reason: ReservationProviderRejectionReason;
          }>;
    }>;

export type ReservationOperationTransitionResult =
  | Readonly<{
      outcome: 'transitioned';
      reservation: CourtReservation;
      operation: ReservationOperation;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason:
        | 'invalid_command'
        | 'ownership_conflict'
        | 'operation_binding_conflict'
        | 'forbidden_transition';
      reservation: CourtReservation;
      operation: ReservationOperation;
    }>;

function immutableTarget(
  target: CourtReservation['target'],
): CourtReservation['target'] {
  return Object.freeze({
    serviceId: target.serviceId,
    courtId: target.courtId,
    startsAt: target.startsAt,
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

function immutableClient(
  client: ReservationOperationRequest['client'],
): ReservationOperationRequest['client'] {
  return Object.freeze({
    phone: client.phone,
    fullName: client.fullName,
    email: client.email,
  });
}

function immutableExternalReference(
  reference: ReservationOperationRequest['externalReference'],
): ReservationOperationRequest['externalReference'] {
  return Object.freeze({ apiId: reference.apiId });
}

function immutableRequest(
  request: ReservationOperationRequest,
): ReservationOperationRequest {
  return request.type === 'cancel'
    ? Object.freeze({
        type: request.type,
        reservationId: request.reservationId,
        ownerAccountId: request.ownerAccountId,
        externalReference: immutableExternalReference(
          request.externalReference,
        ),
        client: immutableClient(request.client),
      })
    : Object.freeze({
        type: request.type,
        reservationId: request.reservationId,
        ownerAccountId: request.ownerAccountId,
        externalReference: immutableExternalReference(
          request.externalReference,
        ),
        client: immutableClient(request.client),
        target: immutableTarget(request.target),
      });
}

function withReservationState(
  reservation: CourtReservation,
  input: Readonly<{
    status: ReservationStatus;
    now: CourtReservation['updatedAt'];
    target?: CourtReservation['target'];
    providerBinding?: YclientsReservationBinding;
    preserveProviderBinding?: boolean;
  }>,
): CourtReservation {
  const providerBinding =
    input.providerBinding === undefined
      ? input.preserveProviderBinding === true
        ? reservation.providerBinding
        : undefined
      : immutableProviderBinding(input.providerBinding);

  return Object.freeze({
    reservationId: reservation.reservationId,
    ownerAccountId: reservation.ownerAccountId,
    status: input.status,
    target:
      input.target === undefined
        ? reservation.target
        : immutableTarget(input.target),
    ...(providerBinding === undefined ? {} : { providerBinding }),
    createdAt: reservation.createdAt,
    updatedAt: input.now,
    version: reservation.version + 1,
  });
}

export function createCourtReservation(
  input: CreateCourtReservationInput,
): CourtReservation {
  if (
    !isCourtReservationId(input?.reservationId) ||
    !isAccountId(input?.ownerAccountId) ||
    !isReservationTarget(input?.target) ||
    !isUnixEpochSeconds(input?.now)
  ) {
    throw new TypeError('Court reservation binding is invalid');
  }

  return Object.freeze({
    reservationId: input.reservationId,
    ownerAccountId: input.ownerAccountId,
    status: 'unbooked',
    target: immutableTarget(input.target),
    createdAt: input.now,
    updatedAt: input.now,
    version: 1,
  });
}

function pendingReservationStatus(
  request: ReservationOperationRequest,
): ReservationStatus {
  switch (request.type) {
    case 'create':
      return 'pending_confirmation';
    case 'reschedule':
      return 'reschedule_pending';
    case 'cancel':
      return 'cancel_pending';
  }
}

function canStartOperation(
  reservation: CourtReservation,
  request: ReservationOperationRequest,
): boolean {
  return request.type === 'create'
    ? reservation.status === 'unbooked' || reservation.status === 'rejected'
    : reservation.status === 'confirmed';
}

export function startReservationOperation(
  reservation: CourtReservation,
  input: StartReservationOperationInput,
  existingOperation?: ReservationOperation,
): StartReservationOperationResult {
  if (
    !isReservationOperationId(input?.operationId) ||
    !isAccountId(input?.actorAccountId) ||
    !isReservationIdempotencyKey(input?.idempotencyKey) ||
    !isReservationOperationRequest(input?.request) ||
    input.request.reservationId !== reservation.reservationId ||
    !isUnixEpochSeconds(input?.now) ||
    input.now < reservation.updatedAt
  ) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'invalid_input',
      reservation,
    });
  }

  if (
    input.actorAccountId !== reservation.ownerAccountId ||
    input.request.ownerAccountId !== reservation.ownerAccountId
  ) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'ownership_conflict',
      reservation,
    });
  }

  const requestDigest = digestReservationOperationRequest(input.request);
  if (existingOperation !== undefined) {
    if (
      !isReservationOperationRequest(existingOperation.request) ||
      existingOperation.ownerAccountId !== reservation.ownerAccountId ||
      existingOperation.actorAccountId !== reservation.ownerAccountId ||
      existingOperation.reservationId !== reservation.reservationId ||
      existingOperation.type !== input.request.type ||
      existingOperation.type !== existingOperation.request.type ||
      existingOperation.request.ownerAccountId !==
        reservation.ownerAccountId ||
      existingOperation.request.reservationId !== reservation.reservationId
    ) {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'operation_binding_conflict',
        reservation,
      });
    }
    if (existingOperation.idempotencyKey !== input.idempotencyKey) {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'idempotency_lookup_mismatch',
        reservation,
      });
    }
    if (
      !isReservationRequestDigest(existingOperation.requestDigest) ||
      digestReservationOperationRequest(existingOperation.request) !==
        existingOperation.requestDigest
    ) {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'operation_binding_conflict',
        reservation,
      });
    }
    if (existingOperation.requestDigest !== requestDigest) {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'idempotency_key_conflict',
        reservation,
      });
    }
    return Object.freeze({
      outcome: 'idempotent_retry',
      reservation,
      operation: existingOperation,
    });
  }

  if (!canStartOperation(reservation, input.request)) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'forbidden_transition',
      reservation,
    });
  }

  const nextReservation = withReservationState(reservation, {
    status: pendingReservationStatus(input.request),
    now: input.now,
    ...(input.request.type === 'create'
      ? { target: input.request.target }
      : {}),
    preserveProviderBinding: true,
  });
  const operation: PendingReservationOperation = Object.freeze({
    operationId: input.operationId,
    reservationId: reservation.reservationId,
    ownerAccountId: reservation.ownerAccountId,
    actorAccountId: input.actorAccountId,
    type: input.request.type,
    idempotencyKey: input.idempotencyKey,
    requestDigest,
    request: immutableRequest(input.request),
    previousReservationStatus: reservation.status,
    createdAt: input.now,
    status: 'pending',
  });

  return Object.freeze({
    outcome: 'started',
    reservation: nextReservation,
    operation,
  });
}

export function reservationOperationMatchesReservation(
  reservation: CourtReservation,
  operation: ReservationOperation,
): boolean {
  if (
    !isReservationOperationRequest(operation.request) ||
    operation.reservationId !== reservation.reservationId ||
    operation.ownerAccountId !== reservation.ownerAccountId ||
    operation.actorAccountId !== reservation.ownerAccountId ||
    operation.type !== operation.request.type ||
    operation.request.reservationId !== reservation.reservationId ||
    operation.request.ownerAccountId !== reservation.ownerAccountId ||
    digestReservationOperationRequest(operation.request) !==
      operation.requestDigest
  ) {
    return false;
  }
  if (operation.status === 'pending') {
    return reservation.status === pendingReservationStatus(operation.request);
  }
  if (operation.status === 'unknown') {
    return reservation.status === 'unknown';
  }
  return true;
}

function hasValidBindingForConfirmation(
  operation: ReservationOperation,
  binding: YclientsReservationBinding | undefined,
): boolean {
  return operation.request.type === 'cancel'
    ? binding === undefined
    : isYclientsReservationBinding(binding);
}

function terminalReservation(
  reservation: CourtReservation,
  operation: ReservationOperation,
  outcome:
    | Readonly<{
        type: 'confirmed';
        providerBinding?: YclientsReservationBinding;
      }>
    | Readonly<{ type: 'rejected' }>,
  now: CourtReservation['updatedAt'],
): CourtReservation {
  if (outcome.type === 'rejected') {
    return withReservationState(reservation, {
      status:
        operation.request.type === 'create' ? 'rejected' : 'confirmed',
      now,
      preserveProviderBinding: true,
    });
  }
  if (operation.request.type === 'cancel') {
    return withReservationState(reservation, {
      status: 'cancelled',
      now,
      preserveProviderBinding: true,
    });
  }
  return withReservationState(reservation, {
    status: 'confirmed',
    now,
    target: operation.request.target,
    providerBinding: outcome.providerBinding,
  });
}

function isValidTransitionCommand(
  command: ReservationOperationTransitionCommand,
): boolean {
  if (
    !isAccountId(command?.actorAccountId) ||
    !isUnixEpochSeconds(command?.now)
  ) {
    return false;
  }
  switch (command.type) {
    case 'confirm':
    case 'mark_unknown':
      return true;
    case 'reject':
      return typeof command.reason === 'string' && command.reason.length > 0;
    case 'reconcile':
      return command.result.outcome === 'confirmed'
        ? command.result.providerBinding === undefined ||
            isYclientsReservationBinding(command.result.providerBinding)
        : typeof command.result.reason === 'string' &&
            command.result.reason.length > 0;
    default:
      return false;
  }
}

export function transitionReservationOperation(
  reservation: CourtReservation,
  operation: ReservationOperation,
  command: ReservationOperationTransitionCommand,
): ReservationOperationTransitionResult {
  if (
    !isValidTransitionCommand(command) ||
    command.now < reservation.updatedAt ||
    command.now < operation.createdAt
  ) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'invalid_command',
      reservation,
      operation,
    });
  }
  if (command.actorAccountId !== reservation.ownerAccountId) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'ownership_conflict',
      reservation,
      operation,
    });
  }
  if (!reservationOperationMatchesReservation(reservation, operation)) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'operation_binding_conflict',
      reservation,
      operation,
    });
  }

  if (operation.status === 'pending') {
    if (command.type === 'mark_unknown') {
      const nextReservation = withReservationState(reservation, {
        status: 'unknown',
        now: command.now,
        preserveProviderBinding: true,
      });
      const nextOperation: UnknownReservationOperation = Object.freeze({
        ...operation,
        status: 'unknown',
        uncertainAt: command.now,
      });
      return Object.freeze({
        outcome: 'transitioned',
        reservation: nextReservation,
        operation: nextOperation,
      });
    }
    if (command.type === 'confirm') {
      if (
        !hasValidBindingForConfirmation(
          operation,
          command.providerBinding,
        )
      ) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'invalid_command',
          reservation,
          operation,
        });
      }
      const nextReservation = terminalReservation(
        reservation,
        operation,
        { type: 'confirmed', providerBinding: command.providerBinding },
        command.now,
      );
      const nextOperation: ReservationOperation = Object.freeze({
        ...operation,
        status: 'confirmed',
        terminalAt: command.now,
        ...(command.providerBinding === undefined
          ? {}
          : {
              providerBinding: immutableProviderBinding(
                command.providerBinding,
              ),
            }),
      });
      return Object.freeze({
        outcome: 'transitioned',
        reservation: nextReservation,
        operation: nextOperation,
      });
    }
    if (command.type === 'reject') {
      const nextReservation = terminalReservation(
        reservation,
        operation,
        { type: 'rejected' },
        command.now,
      );
      const nextOperation: ReservationOperation = Object.freeze({
        ...operation,
        status: 'rejected',
        terminalAt: command.now,
        reason: command.reason,
      });
      return Object.freeze({
        outcome: 'transitioned',
        reservation: nextReservation,
        operation: nextOperation,
      });
    }
  }

  if (operation.status === 'unknown' && command.type === 'reconcile') {
    if (
      command.result.outcome === 'confirmed' &&
      !hasValidBindingForConfirmation(
        operation,
        command.result.providerBinding,
      )
    ) {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'invalid_command',
        reservation,
        operation,
      });
    }
    const nextReservation = terminalReservation(
      reservation,
      operation,
      command.result.outcome === 'confirmed'
        ? {
            type: 'confirmed',
            providerBinding: command.result.providerBinding,
          }
        : { type: 'rejected' },
      command.now,
    );
    const result =
      command.result.outcome === 'confirmed'
        ? Object.freeze({
            outcome: 'confirmed' as const,
            ...(command.result.providerBinding === undefined
              ? {}
              : {
                  providerBinding: immutableProviderBinding(
                    command.result.providerBinding,
                  ),
                }),
          })
        : Object.freeze({
            outcome: 'rejected' as const,
            reason: command.result.reason,
          });
    const nextOperation: ReservationOperation = Object.freeze({
      operationId: operation.operationId,
      reservationId: operation.reservationId,
      ownerAccountId: operation.ownerAccountId,
      actorAccountId: operation.actorAccountId,
      type: operation.type,
      idempotencyKey: operation.idempotencyKey,
      requestDigest: operation.requestDigest,
      request: operation.request,
      previousReservationStatus: operation.previousReservationStatus,
      createdAt: operation.createdAt,
      status: 'reconciled',
      uncertainAt: operation.uncertainAt,
      terminalAt: command.now,
      result,
    });
    return Object.freeze({
      outcome: 'transitioned',
      reservation: nextReservation,
      operation: nextOperation,
    });
  }

  return Object.freeze({
    outcome: 'rejected',
    reason: 'forbidden_transition',
    reservation,
    operation,
  });
}

export function reservationHoldsCourtSlot(
  reservation: CourtReservation,
): boolean {
  return !(
    reservation.status === 'unbooked' ||
    reservation.status === 'rejected' ||
    reservation.status === 'cancelled'
  );
}
