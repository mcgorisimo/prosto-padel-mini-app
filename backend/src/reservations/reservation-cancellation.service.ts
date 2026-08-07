import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds, UnixEpochSeconds } from '../auth/auth.types';
import { CourtReservationRepository } from '../database/court-reservation.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  ReservationOperationTransitionResult,
  StartReservationOperationResult,
  reservationOperationMatchesReservation,
} from './reservation.state-machine';
import {
  isCanonicalReservationDeletedProof,
  ReservationCancellationDeleteCommand,
  ReservationCancellationDeleteResult,
  ReservationCancellationExactReadResult,
  ReservationCancellationProviderPort,
  reservationCancellationDeleteCommand,
} from './reservation-cancellation.port';
import { digestReservationOperationRequest } from './reservation-request-digest';
import {
  CancelReservationRequest,
  CourtReservation,
  PendingReservationOperation,
  ReservationIdempotencyKey,
  ReservationOperation,
  ReservationOperationId,
  isCourtReservationId,
  isReservationIdempotencyKey,
  isReservationOperationId,
  isReservationOperationRequest,
  reservationProviderRejectionReason,
} from './reservation.types';

export interface ReservationCancellationTransactionRunner {
  runInTransaction<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export type RequestReservationCancellationInput = Readonly<{
  ownerAccountId: CourtReservation['ownerAccountId'];
  reservationId: CourtReservation['reservationId'];
  operationId: ReservationOperationId;
  idempotencyKey: ReservationIdempotencyKey;
  request: CancelReservationRequest;
  cancellationRequestedAt: UnixEpochSeconds;
}>;

type SafeCancellationState = Readonly<{
  reservationId: CourtReservation['reservationId'];
  operationId: ReservationOperation['operationId'];
  reservationStatus: CourtReservation['status'];
  operationStatus: ReservationOperation['status'];
}>;

export type ReservationCancellationWorkflowResult =
  | Readonly<{
      outcome: 'cancelled';
      proof: 'exact_deleted';
      deleteOutcome: 'accepted' | 'unknown';
      state: SafeCancellationState;
    }>
  | Readonly<{
      outcome: 'cancelled';
      proof: 'persisted_cancelled_state';
      deleteOutcome: 'not_reissued';
      state: SafeCancellationState;
    }>
  | Readonly<{
      outcome: 'rejected';
      state: SafeCancellationState;
    }>
  | Readonly<{
      outcome: 'in_progress';
      state: SafeCancellationState;
    }>
  | Readonly<{
      outcome: 'unknown';
      reason:
        | 'delete_outcome_unknown'
        | 'exact_deleted_proof_missing'
        | 'persistence_unconfirmed';
      state: SafeCancellationState;
    }>
  | Readonly<{
      outcome: 'blocked';
      reason:
        | 'invalid_input'
        | 'ownership_conflict'
        | 'operation_binding_conflict'
        | 'idempotency_lookup_mismatch'
        | 'idempotency_key_conflict'
        | 'forbidden_transition'
        | 'persistence_unavailable';
    }>;

export interface ReservationCancellationServiceDependencies {
  readonly transactions: ReservationCancellationTransactionRunner;
  readonly repository: CourtReservationRepository;
  readonly provider: ReservationCancellationProviderPort;
  readonly now: () => UnixEpochSeconds;
}

function validInput(
  input: RequestReservationCancellationInput,
): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    isAccountId(input.ownerAccountId) &&
    isCourtReservationId(input.reservationId) &&
    isReservationOperationId(input.operationId) &&
    isReservationIdempotencyKey(input.idempotencyKey) &&
    isReservationOperationRequest(input.request) &&
    input.request.type === 'cancel' &&
    input.request.ownerAccountId === input.ownerAccountId &&
    input.request.reservationId === input.reservationId &&
    isUnixEpochSeconds(input.cancellationRequestedAt)
  );
}

function safeState(
  reservation: CourtReservation,
  operation: ReservationOperation,
): SafeCancellationState {
  return Object.freeze({
    reservationId: reservation.reservationId,
    operationId: operation.operationId,
    reservationStatus: reservation.status,
    operationStatus: operation.status,
  });
}

function operationBoundToInput(
  input: RequestReservationCancellationInput,
  reservation: CourtReservation,
  operation: ReservationOperation,
): boolean {
  return (
    reservation.ownerAccountId === input.ownerAccountId &&
    reservation.reservationId === input.reservationId &&
    operation.ownerAccountId === input.ownerAccountId &&
    operation.reservationId === input.reservationId &&
    operation.idempotencyKey === input.idempotencyKey &&
    operation.type === 'cancel' &&
    operation.createdAt === input.cancellationRequestedAt &&
    operation.requestDigest ===
      digestReservationOperationRequest(input.request) &&
    reservationOperationMatchesReservation(reservation, operation)
  );
}

function idempotentResult(
  input: RequestReservationCancellationInput,
  result: Extract<StartReservationOperationResult, { outcome: 'idempotent_retry' }>,
): ReservationCancellationWorkflowResult {
  const { reservation, operation } = result;
  if (!operationBoundToInput(input, reservation, operation)) {
    return Object.freeze({
      outcome: 'blocked' as const,
      reason: 'idempotency_lookup_mismatch' as const,
    });
  }
  const state = safeState(reservation, operation);
  if (
    reservation.status === 'cancelled' &&
    (operation.status === 'confirmed' ||
      (operation.status === 'reconciled' &&
        operation.result.outcome === 'confirmed'))
  ) {
    return Object.freeze({
      outcome: 'cancelled' as const,
      proof: 'persisted_cancelled_state' as const,
      deleteOutcome: 'not_reissued' as const,
      state,
    });
  }
  if (
    reservation.status === 'confirmed' &&
    (operation.status === 'rejected' ||
      (operation.status === 'reconciled' &&
        operation.result.outcome === 'rejected'))
  ) {
    return Object.freeze({ outcome: 'rejected' as const, state });
  }
  if (operation.status === 'pending') {
    return Object.freeze({ outcome: 'in_progress' as const, state });
  }
  return Object.freeze({
    outcome: 'unknown' as const,
    reason: 'delete_outcome_unknown' as const,
    state,
  });
}

function classifyDeleteResult(
  value: unknown,
): ReservationCancellationDeleteResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return Object.freeze({ outcome: 'unknown' as const });
  }
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length === 1 && result.outcome === 'accepted') {
    return Object.freeze({ outcome: 'accepted' as const });
  }
  if (Object.keys(result).length === 1 && result.outcome === 'unknown') {
    return Object.freeze({ outcome: 'unknown' as const });
  }
  if (
    Object.keys(result).length === 2 &&
    result.outcome === 'rejected' &&
    typeof result.reason === 'string' &&
    /^[a-z][a-z0-9_]{0,127}$/u.test(result.reason)
  ) {
    let reason: Extract<
      ReservationCancellationDeleteResult,
      { outcome: 'rejected' }
    >['reason'];
    try {
      reason = reservationProviderRejectionReason(result.reason);
    } catch {
      return Object.freeze({ outcome: 'unknown' as const });
    }
    return Object.freeze({
      outcome: 'rejected' as const,
      reason,
    });
  }
  return Object.freeze({ outcome: 'unknown' as const });
}

function hasCanonicalDeletedProof(
  value: unknown,
  command: ReservationCancellationDeleteCommand,
): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const result = value as Partial<ReservationCancellationExactReadResult>;
  return (
    result.outcome === 'found' &&
    isCanonicalReservationDeletedProof(result.record, command)
  );
}

export class ReservationCancellationService {
  constructor(
    private readonly dependencies: ReservationCancellationServiceDependencies,
  ) {}

  private terminalAt(
    cancellationRequestedAt: UnixEpochSeconds,
  ): UnixEpochSeconds | undefined {
    try {
      const now = this.dependencies.now();
      return isUnixEpochSeconds(now) && now >= cancellationRequestedAt
        ? now
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async transition(
    reservation: CourtReservation,
    operation: PendingReservationOperation,
    command:
      | Readonly<{
          type: 'confirm' | 'mark_unknown';
          actorAccountId: CourtReservation['ownerAccountId'];
          now: UnixEpochSeconds;
        }>
      | Readonly<{
          type: 'reject';
          actorAccountId: CourtReservation['ownerAccountId'];
          now: UnixEpochSeconds;
          reason: Extract<
            ReservationCancellationDeleteResult,
            { outcome: 'rejected' }
          >['reason'];
        }>,
  ): Promise<ReservationOperationTransitionResult | undefined> {
    try {
      return await this.dependencies.transactions.runInTransaction(
        (transaction) =>
          this.dependencies.repository.transitionOperation(
            transaction,
            reservation.ownerAccountId,
            reservation.reservationId,
            operation.operationId,
            command,
          ),
      );
    } catch {
      return undefined;
    }
  }

  async request(
    input: RequestReservationCancellationInput,
  ): Promise<ReservationCancellationWorkflowResult> {
    if (!validInput(input)) {
      return Object.freeze({
        outcome: 'blocked' as const,
        reason: 'invalid_input' as const,
      });
    }

    let started: StartReservationOperationResult;
    try {
      started = await this.dependencies.transactions.runInTransaction(
        (transaction) =>
          this.dependencies.repository.startOperation(
            transaction,
            input.ownerAccountId,
            input.reservationId,
            {
              operationId: input.operationId,
              actorAccountId: input.ownerAccountId,
              idempotencyKey: input.idempotencyKey,
              request: input.request,
              now: input.cancellationRequestedAt,
            },
          ),
      );
    } catch {
      return Object.freeze({
        outcome: 'blocked' as const,
        reason: 'persistence_unavailable' as const,
      });
    }

    if (started.outcome === 'rejected') {
      return Object.freeze({
        outcome: 'blocked' as const,
        reason: started.reason,
      });
    }
    if (started.outcome === 'idempotent_retry') {
      return idempotentResult(input, started);
    }
    if (
      started.operation.operationId !== input.operationId ||
      !operationBoundToInput(input, started.reservation, started.operation)
    ) {
      return Object.freeze({
        outcome: 'blocked' as const,
        reason: 'operation_binding_conflict' as const,
      });
    }

    const { reservation, operation } = started;
    const fallbackState = safeState(reservation, operation);
    let providerCommand: ReservationCancellationDeleteCommand;
    try {
      providerCommand = reservationCancellationDeleteCommand(
        reservation,
        operation,
      );
    } catch {
      const terminalAt = this.terminalAt(input.cancellationRequestedAt);
      const transitioned =
        terminalAt === undefined
          ? undefined
          : await this.transition(reservation, operation, {
              type: 'mark_unknown',
              actorAccountId: input.ownerAccountId,
              now: terminalAt,
            });
      return Object.freeze({
        outcome: 'unknown' as const,
        reason: 'persistence_unconfirmed' as const,
        state:
          transitioned?.outcome === 'transitioned'
            ? safeState(transitioned.reservation, transitioned.operation)
            : fallbackState,
      });
    }

    let deleteResult: ReservationCancellationDeleteResult;
    try {
      deleteResult = classifyDeleteResult(
        await this.dependencies.provider.deleteOnce(providerCommand),
      );
    } catch {
      deleteResult = Object.freeze({ outcome: 'unknown' as const });
    }

    if (deleteResult.outcome === 'rejected') {
      const terminalAt = this.terminalAt(input.cancellationRequestedAt);
      if (terminalAt === undefined) {
        return Object.freeze({
          outcome: 'unknown' as const,
          reason: 'persistence_unconfirmed' as const,
          state: fallbackState,
        });
      }
      const transitioned = await this.transition(reservation, operation, {
        type: 'reject',
        actorAccountId: input.ownerAccountId,
        now: terminalAt,
        reason: deleteResult.reason,
      });
      return transitioned?.outcome === 'transitioned'
        ? Object.freeze({
            outcome: 'rejected' as const,
            state: safeState(
              transitioned.reservation,
              transitioned.operation,
            ),
          })
        : Object.freeze({
            outcome: 'unknown' as const,
            reason: 'persistence_unconfirmed' as const,
            state: fallbackState,
          });
    }

    let proof: unknown;
    try {
      proof = await this.dependencies.provider.readExact(providerCommand);
    } catch {
      proof = undefined;
    }

    const terminalAt = this.terminalAt(input.cancellationRequestedAt);
    if (terminalAt === undefined) {
      return Object.freeze({
        outcome: 'unknown' as const,
        reason: 'persistence_unconfirmed' as const,
        state: fallbackState,
      });
    }

    if (hasCanonicalDeletedProof(proof, providerCommand)) {
      const transitioned = await this.transition(reservation, operation, {
        type: 'confirm',
        actorAccountId: input.ownerAccountId,
        now: terminalAt,
      });
      return transitioned?.outcome === 'transitioned' &&
        transitioned.reservation.status === 'cancelled'
        ? Object.freeze({
            outcome: 'cancelled' as const,
            proof: 'exact_deleted' as const,
            deleteOutcome: deleteResult.outcome,
            state: safeState(
              transitioned.reservation,
              transitioned.operation,
            ),
          })
        : Object.freeze({
            outcome: 'unknown' as const,
            reason: 'persistence_unconfirmed' as const,
            state: fallbackState,
          });
    }

    const transitioned = await this.transition(reservation, operation, {
      type: 'mark_unknown',
      actorAccountId: input.ownerAccountId,
      now: terminalAt,
    });
    if (transitioned?.outcome !== 'transitioned') {
      return Object.freeze({
        outcome: 'unknown' as const,
        reason: 'persistence_unconfirmed' as const,
        state: fallbackState,
      });
    }
    return Object.freeze({
      outcome: 'unknown' as const,
      reason:
        deleteResult.outcome === 'accepted'
          ? ('exact_deleted_proof_missing' as const)
          : ('delete_outcome_unknown' as const),
      state: safeState(transitioned.reservation, transitioned.operation),
    });
  }
}
