import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { CourtReservationId } from '../reservations/reservation.types';
import {
  acquiringPaymentReconciliationCommand,
  acquiringPaymentWriteCommand,
} from './acquiring-payment.port';
import {
  createPaymentOrder,
  startPaymentAttempt,
  transitionPaymentAttempt,
} from './payment.state-machine';
import {
  AcquiringRouteId,
  PaymentAttemptId,
  PaymentIdempotencyKey,
  PaymentOrderId,
  paymentContractVersion,
  paymentSnapshotDigest,
} from './payment.types';

const OWNER = deterministicUuid('d4-port-owner') as AccountId;
const RESERVATION = deterministicUuid(
  'd4-port-reservation',
) as CourtReservationId;
const ORDER = deterministicUuid('d4-port-order') as PaymentOrderId;
const ATTEMPT = deterministicUuid('d4-port-attempt') as PaymentAttemptId;
const IDEMPOTENCY_KEY = deterministicUuid(
  'd4-port-idempotency',
) as PaymentIdempotencyKey;
const ROUTE = deterministicUuid('d4-port-route') as AcquiringRouteId;
const NOW = unixEpochSeconds(1_800_100_000);

function pendingAttempt() {
  const order = createPaymentOrder({
    orderId: ORDER,
    ownerAccountId: OWNER,
    reservationId: RESERVATION,
    amount: Object.freeze({ amountMinor: 150_000, currency: 'RUB' }),
    pricingContractVersion: paymentContractVersion('court-pricing-v1'),
    pricingSnapshotDigest: paymentSnapshotDigest('3'.repeat(64)),
    receiptContractVersion: paymentContractVersion('court-receipt-v1'),
    receiptContactSnapshotDigest: paymentSnapshotDigest('4'.repeat(64)),
    cancellationPolicyVersion: paymentContractVersion('court-cancellation-v1'),
    now: NOW,
  });
  const started = startPaymentAttempt(order, {
    attemptId: ATTEMPT,
    actorAccountId: OWNER,
    idempotencyKey: IDEMPOTENCY_KEY,
    request: Object.freeze({
      orderId: ORDER,
      ownerAccountId: OWNER,
      type: 'initiate',
      acquiringRouteId: ROUTE,
    }),
    now: unixEpochSeconds(NOW + 1),
  });
  if (started.outcome !== 'started') {
    throw new Error(`Expected started, received ${started.outcome}`);
  }
  return started;
}

describe('acquiring payment port commands', () => {
  it('builds an exact provider-neutral write command without fiscal data', () => {
    const started = pendingAttempt();

    expect(
      acquiringPaymentWriteCommand(started.order, started.attempt),
    ).toEqual({
      mode: 'write',
      attemptId: ATTEMPT,
      orderId: ORDER,
      reservationId: RESERVATION,
      ownerAccountId: OWNER,
      type: 'initiate',
      acquiringRouteId: ROUTE,
      providerIdempotencyKey: ATTEMPT,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestDigest: started.attempt.requestDigest,
      amount: { amountMinor: 150_000, currency: 'RUB' },
    });
  });

  it('builds reconciliation only from the retained unknown attempt', () => {
    const started = pendingAttempt();
    const uncertain = transitionPaymentAttempt(started.order, started.attempt, {
      type: 'mark_unknown',
      actorAccountId: OWNER,
      now: unixEpochSeconds(NOW + 2),
    });
    if (
      uncertain.outcome !== 'transitioned' ||
      uncertain.attempt.status !== 'unknown'
    ) {
      throw new Error('Expected unknown acquiring attempt');
    }

    expect(
      acquiringPaymentReconciliationCommand(uncertain.order, uncertain.attempt),
    ).toEqual({
      mode: 'reconciliation',
      attemptId: ATTEMPT,
      orderId: ORDER,
      reservationId: RESERVATION,
      ownerAccountId: OWNER,
      type: 'initiate',
      acquiringRouteId: ROUTE,
      providerIdempotencyKey: ATTEMPT,
      idempotencyKey: IDEMPOTENCY_KEY,
      requestDigest: uncertain.attempt.requestDigest,
      amount: { amountMinor: 150_000, currency: 'RUB' },
    });
  });

  it('rejects an initial write command for an unknown attempt', () => {
    const started = pendingAttempt();
    const uncertain = transitionPaymentAttempt(started.order, started.attempt, {
      type: 'mark_unknown',
      actorAccountId: OWNER,
      now: unixEpochSeconds(NOW + 2),
    });
    if (
      uncertain.outcome !== 'transitioned' ||
      uncertain.attempt.status !== 'unknown'
    ) {
      throw new Error('Expected unknown acquiring attempt');
    }

    expect(() =>
      acquiringPaymentWriteCommand(uncertain.order, uncertain.attempt as never),
    ).toThrow('Acquiring write command requires a pending attempt');
  });
});
