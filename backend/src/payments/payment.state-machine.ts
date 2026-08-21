import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import { isCourtReservationId } from '../reservations/reservation.types';
import { digestPaymentAttemptRequest } from './payment-request-digest';
import {
  AcquiringPaymentBinding,
  ConfirmedPaymentResult,
  PaymentAttempt,
  PaymentAttemptFailureReason,
  PaymentAttemptId,
  PaymentAttemptRequest,
  PaymentContractVersion,
  PaymentIdempotencyKey,
  PaymentMoney,
  PaymentOrder,
  PaymentOrderId,
  PaymentReconciliationResult,
  PaymentSnapshotDigest,
  PendingPaymentAttempt,
  UnknownPaymentAttempt,
  isConfirmedPaymentResult,
  isPaymentAttempt,
  isPaymentAttemptFailureReason,
  isPaymentAttemptId,
  isPaymentAttemptRequest,
  isPaymentContractVersion,
  isPaymentIdempotencyKey,
  isPaymentMoney,
  isPaymentOrder,
  isPaymentOrderId,
  isPaymentReconciliationResult,
  isPaymentSnapshotDigest,
} from './payment.types';

export interface CreatePaymentOrderInput {
  readonly orderId: PaymentOrderId;
  readonly ownerAccountId: PaymentOrder['ownerAccountId'];
  readonly reservationId: PaymentOrder['reservationId'];
  readonly amount: PaymentMoney;
  readonly pricingContractVersion: PaymentContractVersion;
  readonly pricingSnapshotDigest: PaymentSnapshotDigest;
  readonly receiptContractVersion: PaymentContractVersion;
  readonly receiptContactSnapshotDigest: PaymentSnapshotDigest;
  readonly cancellationPolicyVersion: PaymentContractVersion;
  readonly now: PaymentOrder['createdAt'];
}

export interface StartPaymentAttemptInput {
  readonly attemptId: PaymentAttemptId;
  readonly actorAccountId: PaymentOrder['ownerAccountId'];
  readonly idempotencyKey: PaymentIdempotencyKey;
  readonly request: PaymentAttemptRequest;
  readonly now: PaymentOrder['updatedAt'];
}

export type StartPaymentAttemptResult =
  | Readonly<{
      outcome: 'started';
      order: PaymentOrder;
      attempt: PendingPaymentAttempt;
    }>
  | Readonly<{
      outcome: 'idempotent_retry';
      order: PaymentOrder;
      attempt: PaymentAttempt;
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
      order: PaymentOrder;
    }>;

export type PaymentAttemptTransitionCommand =
  | Readonly<{
      type: 'confirm';
      actorAccountId: PaymentOrder['ownerAccountId'];
      now: PaymentOrder['updatedAt'];
      result: ConfirmedPaymentResult;
    }>
  | Readonly<{
      type: 'reject';
      actorAccountId: PaymentOrder['ownerAccountId'];
      now: PaymentOrder['updatedAt'];
      reason: PaymentAttemptFailureReason;
    }>
  | Readonly<{
      type: 'mark_unknown';
      actorAccountId: PaymentOrder['ownerAccountId'];
      now: PaymentOrder['updatedAt'];
    }>
  | Readonly<{
      type: 'reconcile';
      actorAccountId: PaymentOrder['ownerAccountId'];
      now: PaymentOrder['updatedAt'];
      result: PaymentReconciliationResult;
    }>;

export type PaymentAttemptTransitionResult =
  | Readonly<{
      outcome: 'transitioned';
      order: PaymentOrder;
      attempt: PaymentAttempt;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason:
        | 'invalid_command'
        | 'ownership_conflict'
        | 'operation_binding_conflict'
        | 'forbidden_transition';
      order: PaymentOrder;
      attempt: PaymentAttempt;
    }>;

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isCreatePaymentOrderInput(
  value: unknown,
): value is CreatePaymentOrderInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    hasExactKeys(candidate, [
      'orderId',
      'ownerAccountId',
      'reservationId',
      'amount',
      'pricingContractVersion',
      'pricingSnapshotDigest',
      'receiptContractVersion',
      'receiptContactSnapshotDigest',
      'cancellationPolicyVersion',
      'now',
    ]) &&
    isPaymentOrderId(candidate.orderId) &&
    isAccountId(candidate.ownerAccountId) &&
    isCourtReservationId(candidate.reservationId) &&
    isPaymentMoney(candidate.amount) &&
    isPaymentContractVersion(candidate.pricingContractVersion) &&
    isPaymentSnapshotDigest(candidate.pricingSnapshotDigest) &&
    isPaymentContractVersion(candidate.receiptContractVersion) &&
    isPaymentSnapshotDigest(candidate.receiptContactSnapshotDigest) &&
    isPaymentContractVersion(candidate.cancellationPolicyVersion) &&
    isUnixEpochSeconds(candidate.now)
  );
}

function isStartPaymentAttemptInput(
  value: unknown,
): value is StartPaymentAttemptInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    hasExactKeys(candidate, [
      'attemptId',
      'actorAccountId',
      'idempotencyKey',
      'request',
      'now',
    ]) &&
    isPaymentAttemptId(candidate.attemptId) &&
    isAccountId(candidate.actorAccountId) &&
    isPaymentIdempotencyKey(candidate.idempotencyKey) &&
    isPaymentAttemptRequest(candidate.request) &&
    isUnixEpochSeconds(candidate.now)
  );
}

function immutableMoney(amount: PaymentMoney): PaymentMoney {
  return Object.freeze({
    amountMinor: amount.amountMinor,
    currency: amount.currency,
  });
}

function immutableRequest(
  request: PaymentAttemptRequest,
): PaymentAttemptRequest {
  return Object.freeze({
    type: 'initiate',
    orderId: request.orderId,
    ownerAccountId: request.ownerAccountId,
    acquiringRouteId: request.acquiringRouteId,
  });
}

function immutableBinding(
  binding: AcquiringPaymentBinding,
): AcquiringPaymentBinding {
  return Object.freeze({
    acquiringRouteId: binding.acquiringRouteId,
    paymentReference: binding.paymentReference,
  });
}

function immutableConfirmedResult(
  result: ConfirmedPaymentResult,
): ConfirmedPaymentResult {
  return Object.freeze({
    outcome: result.outcome,
    paymentBinding: immutableBinding(result.paymentBinding),
  });
}

function immutableReconciliationResult(
  result: PaymentReconciliationResult,
): PaymentReconciliationResult {
  return result.outcome === 'rejected'
    ? Object.freeze({ outcome: 'rejected', reason: result.reason })
    : immutableConfirmedResult(result);
}

export function createPaymentOrder(
  input: CreatePaymentOrderInput,
): PaymentOrder {
  if (!isCreatePaymentOrderInput(input)) {
    throw new TypeError('Payment order input is invalid');
  }
  return Object.freeze({
    orderId: input.orderId,
    ownerAccountId: input.ownerAccountId,
    reservationId: input.reservationId,
    status: 'pending',
    amount: immutableMoney(input.amount),
    pricingContractVersion: input.pricingContractVersion,
    pricingSnapshotDigest: input.pricingSnapshotDigest,
    receiptContractVersion: input.receiptContractVersion,
    receiptContactSnapshotDigest: input.receiptContactSnapshotDigest,
    cancellationPolicyVersion: input.cancellationPolicyVersion,
    createdAt: input.now,
    updatedAt: input.now,
    version: 1,
  });
}

function nextOrder(
  order: PaymentOrder,
  input: Readonly<{
    status: PaymentOrder['status'];
    now: PaymentOrder['updatedAt'];
    activeAttemptId?: PaymentAttemptId;
    paymentBinding?: AcquiringPaymentBinding;
  }>,
): PaymentOrder {
  const common = {
    orderId: order.orderId,
    ownerAccountId: order.ownerAccountId,
    reservationId: order.reservationId,
    status: input.status,
    amount: immutableMoney(order.amount),
    pricingContractVersion: order.pricingContractVersion,
    pricingSnapshotDigest: order.pricingSnapshotDigest,
    receiptContractVersion: order.receiptContractVersion,
    receiptContactSnapshotDigest: order.receiptContactSnapshotDigest,
    cancellationPolicyVersion: order.cancellationPolicyVersion,
    createdAt: order.createdAt,
    updatedAt: input.now,
    version: order.version + 1,
  } as const;
  if (input.activeAttemptId !== undefined) {
    return Object.freeze({
      ...common,
      activeAttemptId: input.activeAttemptId,
    });
  }
  if (input.paymentBinding !== undefined) {
    return Object.freeze({
      ...common,
      paymentBinding: immutableBinding(input.paymentBinding),
    });
  }
  return Object.freeze(common);
}

function bindingEquals(
  left: AcquiringPaymentBinding | undefined,
  right: AcquiringPaymentBinding | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.acquiringRouteId === right.acquiringRouteId &&
    left.paymentReference === right.paymentReference
  );
}

function attemptMatchesOrderState(
  order: PaymentOrder,
  attempt: PaymentAttempt,
): boolean {
  if (attempt.status === 'pending') {
    return (
      order.status === 'pending' && order.activeAttemptId === attempt.attemptId
    );
  }
  if (attempt.status === 'unknown') {
    return (
      order.status === 'unknown' && order.activeAttemptId === attempt.attemptId
    );
  }
  if (attempt.status === 'confirmed') {
    return (
      order.status === attempt.result.outcome &&
      order.activeAttemptId === undefined &&
      bindingEquals(order.paymentBinding, attempt.result.paymentBinding)
    );
  }
  if (attempt.status === 'rejected') {
    return order.status === 'pending' && order.activeAttemptId === undefined;
  }
  return attempt.result.outcome === 'rejected'
    ? order.status === 'pending' && order.activeAttemptId === undefined
    : order.status === attempt.result.outcome &&
        order.activeAttemptId === undefined &&
        bindingEquals(order.paymentBinding, attempt.result.paymentBinding);
}

export function paymentAttemptMatchesOrder(
  order: PaymentOrder,
  attempt: PaymentAttempt,
): boolean {
  if (!isPaymentOrder(order) || !isPaymentAttempt(attempt)) {
    return false;
  }
  if (
    attempt.orderId !== order.orderId ||
    attempt.ownerAccountId !== order.ownerAccountId ||
    attempt.request.orderId !== order.orderId ||
    attempt.request.ownerAccountId !== order.ownerAccountId ||
    attempt.request.acquiringRouteId !== attempt.acquiringRouteId ||
    digestPaymentAttemptRequest(order, attempt.request) !==
      attempt.requestDigest
  ) {
    return false;
  }
  return attemptMatchesOrderState(order, attempt);
}

export function paymentOrderHasUnresolvedAttempt(order: PaymentOrder): boolean {
  return isPaymentOrder(order) && order.activeAttemptId !== undefined;
}

export function startPaymentAttempt(
  order: PaymentOrder,
  input: StartPaymentAttemptInput,
  existingAttempt?: PaymentAttempt,
): StartPaymentAttemptResult {
  if (!isPaymentOrder(order) || !isStartPaymentAttemptInput(input)) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'invalid_input',
      order,
    });
  }
  if (
    input.actorAccountId !== order.ownerAccountId ||
    input.request.ownerAccountId !== order.ownerAccountId
  ) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'ownership_conflict',
      order,
    });
  }
  if (input.request.orderId !== order.orderId) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'operation_binding_conflict',
      order,
    });
  }

  if (existingAttempt !== undefined) {
    if (!isPaymentAttempt(existingAttempt)) {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'operation_binding_conflict',
        order,
      });
    }
    if (existingAttempt.idempotencyKey !== input.idempotencyKey) {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'idempotency_lookup_mismatch',
        order,
      });
    }
    if (!paymentAttemptMatchesOrder(order, existingAttempt)) {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'operation_binding_conflict',
        order,
      });
    }
    if (
      digestPaymentAttemptRequest(order, input.request) !==
      existingAttempt.requestDigest
    ) {
      return Object.freeze({
        outcome: 'rejected',
        reason: 'idempotency_key_conflict',
        order,
      });
    }
    return Object.freeze({
      outcome: 'idempotent_retry',
      order,
      attempt: existingAttempt,
    });
  }

  if (
    order.status !== 'pending' ||
    order.activeAttemptId !== undefined ||
    input.now < order.updatedAt
  ) {
    return Object.freeze({
      outcome: 'rejected',
      reason: 'forbidden_transition',
      order,
    });
  }

  const immutableAttemptRequest = immutableRequest(input.request);
  const attempt = Object.freeze({
    attemptId: input.attemptId,
    orderId: order.orderId,
    ownerAccountId: order.ownerAccountId,
    status: 'pending',
    type: 'initiate',
    acquiringRouteId: immutableAttemptRequest.acquiringRouteId,
    idempotencyKey: input.idempotencyKey,
    requestDigest: digestPaymentAttemptRequest(order, immutableAttemptRequest),
    request: immutableAttemptRequest,
    previousOrderStatus: 'pending',
    createdAt: input.now,
  } as const satisfies PendingPaymentAttempt);
  const startedOrder = nextOrder(order, {
    status: 'pending',
    now: input.now,
    activeAttemptId: attempt.attemptId,
  });
  return Object.freeze({ outcome: 'started', order: startedOrder, attempt });
}

function isTransitionCommand(
  value: unknown,
): value is PaymentAttemptTransitionCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    !isAccountId(candidate.actorAccountId) ||
    !isUnixEpochSeconds(candidate.now)
  ) {
    return false;
  }
  if (candidate.type === 'confirm') {
    return (
      hasExactKeys(candidate, ['type', 'actorAccountId', 'now', 'result']) &&
      isConfirmedPaymentResult(candidate.result)
    );
  }
  if (candidate.type === 'reject') {
    return (
      hasExactKeys(candidate, ['type', 'actorAccountId', 'now', 'reason']) &&
      isPaymentAttemptFailureReason(candidate.reason)
    );
  }
  if (candidate.type === 'mark_unknown') {
    return hasExactKeys(candidate, ['type', 'actorAccountId', 'now']);
  }
  return (
    candidate.type === 'reconcile' &&
    hasExactKeys(candidate, ['type', 'actorAccountId', 'now', 'result']) &&
    isPaymentReconciliationResult(candidate.result)
  );
}

function rejectedTransition(
  reason: Extract<
    PaymentAttemptTransitionResult,
    { outcome: 'rejected' }
  >['reason'],
  order: PaymentOrder,
  attempt: PaymentAttempt,
): PaymentAttemptTransitionResult {
  return Object.freeze({ outcome: 'rejected', reason, order, attempt });
}

function confirmedTransition(
  order: PaymentOrder,
  attempt: PendingPaymentAttempt | UnknownPaymentAttempt,
  result: ConfirmedPaymentResult,
  now: PaymentOrder['updatedAt'],
  reconciled: boolean,
): PaymentAttemptTransitionResult {
  if (result.paymentBinding.acquiringRouteId !== attempt.acquiringRouteId) {
    return rejectedTransition('invalid_command', order, attempt);
  }
  const immutableResult = immutableConfirmedResult(result);
  const confirmedOrder = nextOrder(order, {
    status: result.outcome,
    now,
    paymentBinding: immutableResult.paymentBinding,
  });
  let confirmedAttempt: PaymentAttempt;
  if (reconciled) {
    if (attempt.status !== 'unknown') {
      return rejectedTransition('invalid_command', order, attempt);
    }
    confirmedAttempt = Object.freeze({
      ...attempt,
      status: 'reconciled' as const,
      terminalAt: now,
      result: immutableResult,
    });
  } else {
    if (attempt.status !== 'pending') {
      return rejectedTransition('invalid_command', order, attempt);
    }
    confirmedAttempt = Object.freeze({
      ...attempt,
      status: 'confirmed' as const,
      terminalAt: now,
      result: immutableResult,
    });
  }
  return Object.freeze({
    outcome: 'transitioned',
    order: confirmedOrder,
    attempt: confirmedAttempt,
  });
}

export function transitionPaymentAttempt(
  order: PaymentOrder,
  attempt: PaymentAttempt,
  command: PaymentAttemptTransitionCommand,
): PaymentAttemptTransitionResult {
  if (!isTransitionCommand(command)) {
    return rejectedTransition('invalid_command', order, attempt);
  }
  if (command.actorAccountId !== order.ownerAccountId) {
    return rejectedTransition('ownership_conflict', order, attempt);
  }
  if (!paymentAttemptMatchesOrder(order, attempt)) {
    return rejectedTransition('operation_binding_conflict', order, attempt);
  }
  if (
    command.now < order.updatedAt ||
    command.now < attempt.createdAt ||
    (attempt.status === 'unknown' && command.now < attempt.uncertainAt)
  ) {
    return rejectedTransition('invalid_command', order, attempt);
  }
  if (attempt.status !== 'pending' && attempt.status !== 'unknown') {
    return rejectedTransition('forbidden_transition', order, attempt);
  }

  if (attempt.status === 'pending') {
    if (command.type === 'confirm') {
      return confirmedTransition(
        order,
        attempt,
        command.result,
        command.now,
        false,
      );
    }
    if (command.type === 'reject') {
      const rejectedOrder = nextOrder(order, {
        status: 'pending',
        now: command.now,
      });
      const rejectedAttempt = Object.freeze({
        ...attempt,
        status: 'rejected' as const,
        terminalAt: command.now,
        reason: command.reason,
      });
      return Object.freeze({
        outcome: 'transitioned',
        order: rejectedOrder,
        attempt: rejectedAttempt,
      });
    }
    if (command.type === 'mark_unknown') {
      const unknownOrder = nextOrder(order, {
        status: 'unknown',
        now: command.now,
        activeAttemptId: attempt.attemptId,
      });
      const unknownAttempt = Object.freeze({
        ...attempt,
        status: 'unknown' as const,
        uncertainAt: command.now,
      });
      return Object.freeze({
        outcome: 'transitioned',
        order: unknownOrder,
        attempt: unknownAttempt,
      });
    }
    return rejectedTransition('forbidden_transition', order, attempt);
  }

  if (command.type !== 'reconcile') {
    return rejectedTransition('forbidden_transition', order, attempt);
  }
  if (command.result.outcome !== 'rejected') {
    return confirmedTransition(
      order,
      attempt,
      command.result,
      command.now,
      true,
    );
  }
  const rejectedOrder = nextOrder(order, {
    status: 'pending',
    now: command.now,
  });
  const rejectedAttempt = Object.freeze({
    ...attempt,
    status: 'reconciled' as const,
    terminalAt: command.now,
    result: immutableReconciliationResult(command.result),
  });
  return Object.freeze({
    outcome: 'transitioned',
    order: rejectedOrder,
    attempt: rejectedAttempt,
  });
}
