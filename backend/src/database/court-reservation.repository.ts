import { AccountId } from '../accounts/account.types';
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

export type CourtReservationPersistenceStage =
  | 'unspecified'
  | 'reservation_lock'
  | 'reservation_hydration'
  | 'operation_lock'
  | 'operation_hydration'
  | 'operation_control_validation'
  | 'domain_transition'
  | 'record_hash_encryption'
  | 'reservation_update'
  | 'operation_update'
  | 'slot_hold_release';

export type CourtReservationPersistenceCause =
  | 'non_postgres_error'
  | 'operation_time_constraint'
  | 'operation_terminal_shape_constraint'
  | 'operation_provider_binding_shape_constraint'
  | 'check_violation'
  | 'not_null_violation'
  | 'invalid_text_representation'
  | 'object_not_in_prerequisite_state'
  | 'unknown_postgres_error';

export class CourtReservationPersistenceError extends Error {
  readonly name = 'CourtReservationPersistenceError';

  constructor(
    readonly reason: CourtReservationPersistenceFailure,
    readonly stage: CourtReservationPersistenceStage = 'unspecified',
    readonly cause?: CourtReservationPersistenceCause,
  ) {
    super('Court reservation persistence failed');
  }
}

/**
 * Implementations must serialize reservation updates and atomically enforce
 * one immutable request digest per (ownerAccountId, idempotencyKey) scope.
 */
export interface CourtReservationRepository {
  create(
    transaction: PostgresTransaction,
    reservation: CourtReservation,
  ): Promise<CreateCourtReservationPersistenceResult>;

  findById(
    transaction: PostgresTransaction,
    ownerAccountId: AccountId,
    reservationId: CourtReservationId,
  ): Promise<CourtReservation | null>;

  findOperationById(
    transaction: PostgresTransaction,
    ownerAccountId: AccountId,
    operationId: ReservationOperationId,
  ): Promise<ReservationOperation | null>;

  findOperationByIdempotencyKey(
    transaction: PostgresTransaction,
    ownerAccountId: AccountId,
    idempotencyKey: ReservationIdempotencyKey,
  ): Promise<ReservationOperation | null>;

  startOperation(
    transaction: PostgresTransaction,
    actorAccountId: AccountId,
    reservationId: CourtReservationId,
    input: StartReservationOperationInput,
  ): Promise<StartReservationOperationResult>;

  transitionOperation(
    transaction: PostgresTransaction,
    actorAccountId: AccountId,
    reservationId: CourtReservationId,
    operationId: ReservationOperationId,
    command: ReservationOperationTransitionCommand,
  ): Promise<ReservationOperationTransitionResult>;
}
