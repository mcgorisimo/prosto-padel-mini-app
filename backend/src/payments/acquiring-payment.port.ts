import {
  PaymentAttempt,
  PaymentMoney,
  PaymentOrder,
  PaymentReconciliationResult,
  PendingPaymentAttempt,
  UnknownPaymentAttempt,
} from './payment.types';
import { paymentAttemptMatchesOrder } from './payment.state-machine';

type AcquiringPaymentCommandMode = 'write' | 'reconciliation';

interface AcquiringPaymentCommand<Mode extends AcquiringPaymentCommandMode> {
  readonly mode: Mode;
  readonly attemptId: PaymentAttempt['attemptId'];
  readonly orderId: PaymentAttempt['orderId'];
  readonly reservationId: PaymentOrder['reservationId'];
  readonly ownerAccountId: PaymentAttempt['ownerAccountId'];
  readonly type: 'initiate';
  readonly acquiringRouteId: PaymentAttempt['acquiringRouteId'];
  readonly providerIdempotencyKey: PaymentAttempt['attemptId'];
  readonly idempotencyKey: PaymentAttempt['idempotencyKey'];
  readonly requestDigest: PaymentAttempt['requestDigest'];
  readonly amount: PaymentMoney;
}

export type AcquiringPaymentWriteCommand = AcquiringPaymentCommand<'write'>;

export type AcquiringPaymentReconciliationCommand =
  AcquiringPaymentCommand<'reconciliation'>;

export type AcquiringPaymentWriteResult =
  PaymentReconciliationResult | Readonly<{ outcome: 'unknown' }>;

export type AcquiringPaymentReconciliationResult =
  PaymentReconciliationResult | Readonly<{ outcome: 'still_unknown' }>;

function command<Mode extends AcquiringPaymentCommandMode>(
  order: PaymentOrder,
  attempt: PendingPaymentAttempt | UnknownPaymentAttempt,
  mode: Mode,
): AcquiringPaymentCommand<Mode> {
  if (!paymentAttemptMatchesOrder(order, attempt)) {
    throw new TypeError('Acquiring payment command binding is invalid');
  }
  return Object.freeze({
    mode,
    attemptId: attempt.attemptId,
    orderId: attempt.orderId,
    reservationId: order.reservationId,
    ownerAccountId: attempt.ownerAccountId,
    type: 'initiate',
    acquiringRouteId: attempt.acquiringRouteId,
    providerIdempotencyKey: attempt.attemptId,
    idempotencyKey: attempt.idempotencyKey,
    requestDigest: attempt.requestDigest,
    amount: Object.freeze({
      amountMinor: order.amount.amountMinor,
      currency: order.amount.currency,
    }),
  });
}

export function acquiringPaymentWriteCommand(
  order: PaymentOrder,
  attempt: PendingPaymentAttempt,
): AcquiringPaymentWriteCommand {
  if (attempt.status !== 'pending') {
    throw new TypeError('Acquiring write command requires a pending attempt');
  }
  return command(order, attempt, 'write');
}

export function acquiringPaymentReconciliationCommand(
  order: PaymentOrder,
  attempt: UnknownPaymentAttempt,
): AcquiringPaymentReconciliationCommand {
  if (attempt.status !== 'unknown') {
    throw new TypeError(
      'Acquiring reconciliation command requires an unknown attempt',
    );
  }
  return command(order, attempt, 'reconciliation');
}

/**
 * Fiscal receipt operations intentionally use a separate future port. This
 * acquiring boundary contains no receipt contacts, tax fields or raw PII.
 */
export interface AcquiringPaymentPort {
  executeWrite(
    command: AcquiringPaymentWriteCommand,
  ): Promise<AcquiringPaymentWriteResult>;

  reconcile(
    command: AcquiringPaymentReconciliationCommand,
  ): Promise<AcquiringPaymentReconciliationResult>;
}
