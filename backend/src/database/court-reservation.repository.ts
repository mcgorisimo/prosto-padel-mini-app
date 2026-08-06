import {
  ReservationOperationTransitionCommand,
  ReservationOperationTransitionResult,
  StartReservationOperationInput,
  StartReservationOperationResult,
} from '../reservations/reservation.state-machine';
import {
  CourtReservation,
  CourtReservationId,
  ReservationIdempotencyKey,
  ReservationOperation,
  ReservationOperationId,
} from '../reservations/reservation.types';
import { PostgresTransaction } from './postgres-transaction';

export type CreateCourtReservationPersistenceResult =
  | Readonly<{
      outcome: 'created';
      reservation: CourtReservation;
    }>
  | Readonly<{
      outcome: 'idempotent_retry';
      reservation: CourtReservation;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason: 'reservation_binding_conflict';
    }>;

export type CourtReservationPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class CourtReservationPersistenceError extends Error {
  readonly name = 'CourtReservationPersistenceError';

  constructor(readonly reason: CourtReservationPersistenceFailure) {
    super('Court reservation persistence failed');
  }
}

/**
 * Implementations must serialize reservation updates and atomically enforce
 * one immutable request digest per idempotency key.
 */
export interface CourtReservationRepository {
  create(
    transaction: PostgresTransaction,
    reservation: CourtReservation,
  ): Promise<CreateCourtReservationPersistenceResult>;

  findById(
    transaction: PostgresTransaction,
    reservationId: CourtReservationId,
  ): Promise<CourtReservation | null>;

  findOperationById(
    transaction: PostgresTransaction,
    operationId: ReservationOperationId,
  ): Promise<ReservationOperation | null>;

  findOperationByIdempotencyKey(
    transaction: PostgresTransaction,
    idempotencyKey: ReservationIdempotencyKey,
  ): Promise<ReservationOperation | null>;

  startOperation(
    transaction: PostgresTransaction,
    reservationId: CourtReservationId,
    input: StartReservationOperationInput,
  ): Promise<StartReservationOperationResult>;

  transitionOperation(
    transaction: PostgresTransaction,
    reservationId: CourtReservationId,
    operationId: ReservationOperationId,
    command: ReservationOperationTransitionCommand,
  ): Promise<ReservationOperationTransitionResult>;
}
