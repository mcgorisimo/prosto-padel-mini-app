import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { CourtReservationId } from '../reservations/reservation.types';
import {
  createPaymentOrder,
  paymentOrderHasUnresolvedAttempt,
  startPaymentAttempt,
  transitionPaymentAttempt,
} from './payment.state-machine';
import {
  AcquiringPaymentBinding,
  AcquiringRouteId,
  PaymentAttempt,
  PaymentAttemptId,
  PaymentAttemptRequest,
  PaymentIdempotencyKey,
  PaymentOrder,
  PaymentOrderId,
  PaymentSnapshotDigest,
  paymentAttemptFailureReason,
  paymentContractVersion,
  paymentSnapshotDigest,
} from './payment.types';

const OWNER = deterministicUuid('d4-payment-owner') as AccountId;
const OTHER_OWNER = deterministicUuid('d4-payment-other-owner') as AccountId;
const RESERVATION = deterministicUuid(
  'd4-payment-reservation',
) as CourtReservationId;
const ORDER = deterministicUuid('d4-payment-order') as PaymentOrderId;
const ATTEMPT = deterministicUuid('d4-payment-attempt') as PaymentAttemptId;
const OTHER_ATTEMPT = deterministicUuid(
  'd4-payment-other-attempt',
) as PaymentAttemptId;
const IDEMPOTENCY_KEY = deterministicUuid(
  'd4-payment-idempotency',
) as PaymentIdempotencyKey;
const ROUTE = deterministicUuid('d4-acquiring-route') as AcquiringRouteId;
const OTHER_ROUTE = deterministicUuid(
  'd4-other-acquiring-route',
) as AcquiringRouteId;
const CREATED_AT = unixEpochSeconds(1_800_000_000);
const ATTEMPTED_AT = unixEpochSeconds(1_800_000_010);
const TERMINAL_AT = unixEpochSeconds(1_800_000_020);
const PRICING_DIGEST = paymentSnapshotDigest('1'.repeat(64));
const CONTACT_DIGEST = paymentSnapshotDigest('2'.repeat(64));
const PRICING_VERSION = paymentContractVersion('court-pricing-v1');
const RECEIPT_VERSION = paymentContractVersion('court-receipt-v1');
const POLICY_VERSION = paymentContractVersion('court-cancellation-v1');
const BINDING: AcquiringPaymentBinding = Object.freeze({
  acquiringRouteId: ROUTE,
  paymentReference: 'payment-reference-1',
});

function order(overrides: Partial<PaymentOrder> = {}): PaymentOrder {
  return createPaymentOrder({
    orderId: ORDER,
    ownerAccountId: OWNER,
    reservationId: RESERVATION,
    amount: Object.freeze({ amountMinor: 150_000, currency: 'RUB' }),
    pricingContractVersion: PRICING_VERSION,
    pricingSnapshotDigest: PRICING_DIGEST,
    receiptContractVersion: RECEIPT_VERSION,
    receiptContactSnapshotDigest: CONTACT_DIGEST,
    cancellationPolicyVersion: POLICY_VERSION,
    now: CREATED_AT,
    ...overrides,
  });
}

function request(
  overrides: Partial<PaymentAttemptRequest> = {},
): PaymentAttemptRequest {
  return Object.freeze({
    type: 'initiate',
    orderId: ORDER,
    ownerAccountId: OWNER,
    acquiringRouteId: ROUTE,
    ...overrides,
  });
}

function start(
  currentOrder: PaymentOrder = order(),
  currentRequest: PaymentAttemptRequest = request(),
  overrides: Partial<Parameters<typeof startPaymentAttempt>[1]> = {},
): Extract<ReturnType<typeof startPaymentAttempt>, { outcome: 'started' }> {
  const result = startPaymentAttempt(currentOrder, {
    attemptId: ATTEMPT,
    actorAccountId: OWNER,
    idempotencyKey: IDEMPOTENCY_KEY,
    request: currentRequest,
    now: ATTEMPTED_AT,
    ...overrides,
  });
  if (result.outcome !== 'started') {
    throw new Error(`Expected started, received ${result.outcome}`);
  }
  return result;
}

describe('payment order and initiate-attempt state machine', () => {
  it('creates an immutable pending order with every approved snapshot boundary', () => {
    const created = order();

    expect(created).toEqual({
      orderId: ORDER,
      ownerAccountId: OWNER,
      reservationId: RESERVATION,
      status: 'pending',
      amount: { amountMinor: 150_000, currency: 'RUB' },
      pricingContractVersion: PRICING_VERSION,
      pricingSnapshotDigest: PRICING_DIGEST,
      receiptContractVersion: RECEIPT_VERSION,
      receiptContactSnapshotDigest: CONTACT_DIGEST,
      cancellationPolicyVersion: POLICY_VERSION,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      version: 1,
    });
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.amount)).toBe(true);
    expect(paymentOrderHasUnresolvedAttempt(created)).toBe(false);
  });

  it.each([
    ['zero amount', { amount: { amountMinor: 0, currency: 'RUB' } }],
    ['fractional amount', { amount: { amountMinor: 10.5, currency: 'RUB' } }],
    ['invalid currency', { amount: { amountMinor: 100, currency: 'rub' } }],
    [
      'invalid snapshot digest',
      { pricingSnapshotDigest: 'not-a-digest' as PaymentSnapshotDigest },
    ],
  ])('rejects an order with %s', (_label, invalid) => {
    expect(() => order(invalid as Partial<PaymentOrder>)).toThrow(
      'Payment order input is invalid',
    );
  });

  it('starts one owner-scoped attempt and freezes its economic request', () => {
    const started = start();

    expect(started.order).toMatchObject({
      status: 'pending',
      activeAttemptId: ATTEMPT,
      version: 2,
    });
    expect(started.attempt).toMatchObject({
      attemptId: ATTEMPT,
      orderId: ORDER,
      ownerAccountId: OWNER,
      status: 'pending',
      type: 'initiate',
      acquiringRouteId: ROUTE,
      idempotencyKey: IDEMPOTENCY_KEY,
      previousOrderStatus: 'pending',
      createdAt: ATTEMPTED_AT,
    });
    expect(Object.isFrozen(started.attempt)).toBe(true);
    expect(Object.isFrozen(started.attempt.request)).toBe(true);
    expect(paymentOrderHasUnresolvedAttempt(started.order)).toBe(true);
  });

  it('returns the exact pending attempt for the same key and digest', () => {
    const started = start();
    const retry = startPaymentAttempt(
      started.order,
      {
        attemptId: OTHER_ATTEMPT,
        actorAccountId: OWNER,
        idempotencyKey: IDEMPOTENCY_KEY,
        request: request(),
        now: unixEpochSeconds(ATTEMPTED_AT + 1),
      },
      started.attempt,
    );

    expect(retry).toEqual({
      outcome: 'idempotent_retry',
      order: started.order,
      attempt: started.attempt,
    });
  });

  it('rejects the same key when the acquiring route changes', () => {
    const started = start();
    const retry = startPaymentAttempt(
      started.order,
      {
        attemptId: OTHER_ATTEMPT,
        actorAccountId: OWNER,
        idempotencyKey: IDEMPOTENCY_KEY,
        request: request({ acquiringRouteId: OTHER_ROUTE }),
        now: unixEpochSeconds(ATTEMPTED_AT + 1),
      },
      started.attempt,
    );

    expect(retry).toMatchObject({
      outcome: 'rejected',
      reason: 'idempotency_key_conflict',
    });
  });

  it.each([
    [
      'amount',
      { amount: Object.freeze({ amountMinor: 160_000, currency: 'RUB' }) },
    ],
    [
      'pricing snapshot',
      { pricingSnapshotDigest: paymentSnapshotDigest('3'.repeat(64)) },
    ],
    [
      'receipt contact snapshot',
      { receiptContactSnapshotDigest: paymentSnapshotDigest('4'.repeat(64)) },
    ],
    [
      'cancellation policy',
      {
        cancellationPolicyVersion: paymentContractVersion(
          'court-cancellation-v2',
        ),
      },
    ],
  ])('binds idempotency to the immutable %s', (_field, changed) => {
    const started = start();
    const changedOrder = Object.freeze({ ...started.order, ...changed });

    expect(
      startPaymentAttempt(
        changedOrder,
        {
          attemptId: OTHER_ATTEMPT,
          actorAccountId: OWNER,
          idempotencyKey: IDEMPOTENCY_KEY,
          request: request(),
          now: unixEpochSeconds(ATTEMPTED_AT + 1),
        },
        started.attempt,
      ),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'operation_binding_conflict',
    });
  });

  it('rejects foreign ownership and mismatched persisted attempt binding', () => {
    expect(
      startPaymentAttempt(order(), {
        attemptId: ATTEMPT,
        actorAccountId: OTHER_OWNER,
        idempotencyKey: IDEMPOTENCY_KEY,
        request: request(),
        now: ATTEMPTED_AT,
      }),
    ).toMatchObject({ outcome: 'rejected', reason: 'ownership_conflict' });

    const started = start();
    const foreignAttempt = Object.freeze({
      ...started.attempt,
      ownerAccountId: OTHER_OWNER,
    }) as PaymentAttempt;
    expect(
      startPaymentAttempt(
        started.order,
        {
          attemptId: OTHER_ATTEMPT,
          actorAccountId: OWNER,
          idempotencyKey: IDEMPOTENCY_KEY,
          request: request(),
          now: unixEpochSeconds(ATTEMPTED_AT + 1),
        },
        foreignAttempt,
      ),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'operation_binding_conflict',
    });
  });

  it('allows only one active attempt for an order', () => {
    const started = start();
    expect(
      startPaymentAttempt(started.order, {
        attemptId: OTHER_ATTEMPT,
        actorAccountId: OWNER,
        idempotencyKey: deterministicUuid(
          'd4-second-attempt-idempotency',
        ) as PaymentIdempotencyKey,
        request: request(),
        now: unixEpochSeconds(ATTEMPTED_AT + 1),
      }),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'forbidden_transition',
    });
  });

  it.each(['authorized', 'paid'] as const)(
    'records authoritative %s outcome with exact binding',
    (outcome) => {
      const started = start();
      const confirmed = transitionPaymentAttempt(
        started.order,
        started.attempt,
        {
          type: 'confirm',
          actorAccountId: OWNER,
          now: TERMINAL_AT,
          result: { outcome, paymentBinding: BINDING },
        },
      );

      expect(confirmed.outcome).toBe('transitioned');
      if (confirmed.outcome === 'transitioned') {
        expect(confirmed.order).toMatchObject({
          status: outcome,
          paymentBinding: BINDING,
        });
        expect(confirmed.order).not.toHaveProperty('activeAttemptId');
        expect(confirmed.attempt).toMatchObject({
          status: 'confirmed',
          result: { outcome, paymentBinding: BINDING },
        });
      }
    },
  );

  it('rejects an authoritative outcome without the exact acquiring binding', () => {
    const started = start();
    for (const result of [
      { outcome: 'paid' as const },
      {
        outcome: 'paid' as const,
        paymentBinding: Object.freeze({
          ...BINDING,
          acquiringRouteId: OTHER_ROUTE,
        }),
      },
    ]) {
      expect(
        transitionPaymentAttempt(started.order, started.attempt, {
          type: 'confirm',
          actorAccountId: OWNER,
          now: TERMINAL_AT,
          result: result as never,
        }),
      ).toMatchObject({ outcome: 'rejected', reason: 'invalid_command' });
    }
  });

  it('rejects a hydrated terminal binding from another acquiring route', () => {
    const started = start();
    const confirmed = transitionPaymentAttempt(started.order, started.attempt, {
      type: 'confirm',
      actorAccountId: OWNER,
      now: TERMINAL_AT,
      result: { outcome: 'paid', paymentBinding: BINDING },
    });
    if (confirmed.outcome !== 'transitioned') {
      throw new Error('Expected confirmed payment attempt');
    }
    const foreignBinding = Object.freeze({
      ...BINDING,
      acquiringRouteId: OTHER_ROUTE,
    });
    const corruptedOrder = Object.freeze({
      ...confirmed.order,
      paymentBinding: foreignBinding,
    });
    const corruptedAttempt = Object.freeze({
      ...confirmed.attempt,
      result: Object.freeze({
        outcome: 'paid' as const,
        paymentBinding: foreignBinding,
      }),
    });

    expect(
      startPaymentAttempt(
        corruptedOrder,
        {
          attemptId: OTHER_ATTEMPT,
          actorAccountId: OWNER,
          idempotencyKey: IDEMPOTENCY_KEY,
          request: request(),
          now: unixEpochSeconds(TERMINAL_AT + 1),
        },
        corruptedAttempt,
      ),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'operation_binding_conflict',
    });
  });

  it('restores pending after a proved rejection', () => {
    const started = start();
    const rejected = transitionPaymentAttempt(started.order, started.attempt, {
      type: 'reject',
      actorAccountId: OWNER,
      now: TERMINAL_AT,
      reason: paymentAttemptFailureReason('provider_rejected'),
    });

    expect(rejected.outcome).toBe('transitioned');
    if (rejected.outcome === 'transitioned') {
      expect(rejected.order.status).toBe('pending');
      expect(rejected.order).not.toHaveProperty('activeAttemptId');
      expect(rejected.attempt).toMatchObject({
        status: 'rejected',
        reason: 'provider_rejected',
      });
    }
  });

  it('moves uncertain outcome to unknown and forbids a blind new write', () => {
    const started = start();
    const uncertain = transitionPaymentAttempt(started.order, started.attempt, {
      type: 'mark_unknown',
      actorAccountId: OWNER,
      now: TERMINAL_AT,
    });
    expect(uncertain.outcome).toBe('transitioned');
    if (uncertain.outcome !== 'transitioned') {
      throw new Error('Expected unknown payment attempt');
    }
    expect(uncertain.order).toMatchObject({
      status: 'unknown',
      activeAttemptId: ATTEMPT,
    });
    expect(uncertain.attempt.status).toBe('unknown');

    expect(
      startPaymentAttempt(uncertain.order, {
        attemptId: OTHER_ATTEMPT,
        actorAccountId: OWNER,
        idempotencyKey: deterministicUuid(
          'd4-blind-retry-idempotency',
        ) as PaymentIdempotencyKey,
        request: request(),
        now: unixEpochSeconds(TERMINAL_AT + 1),
      }),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'forbidden_transition',
    });
  });

  it.each(['authorized', 'paid', 'rejected'] as const)(
    'reconciles an unknown attempt as %s',
    (outcome) => {
      const started = start();
      const uncertain = transitionPaymentAttempt(
        started.order,
        started.attempt,
        {
          type: 'mark_unknown',
          actorAccountId: OWNER,
          now: TERMINAL_AT,
        },
      );
      if (
        uncertain.outcome !== 'transitioned' ||
        uncertain.attempt.status !== 'unknown'
      ) {
        throw new Error('Expected unknown payment attempt');
      }

      const result =
        outcome === 'rejected'
          ? {
              outcome,
              reason: paymentAttemptFailureReason('provider_rejected'),
            }
          : { outcome, paymentBinding: BINDING };
      const reconciled = transitionPaymentAttempt(
        uncertain.order,
        uncertain.attempt,
        {
          type: 'reconcile',
          actorAccountId: OWNER,
          now: unixEpochSeconds(TERMINAL_AT + 1),
          result,
        },
      );

      expect(reconciled.outcome).toBe('transitioned');
      if (reconciled.outcome === 'transitioned') {
        expect(reconciled.order.status).toBe(
          outcome === 'rejected' ? 'pending' : outcome,
        );
        expect(reconciled.order).not.toHaveProperty('activeAttemptId');
        expect(reconciled.attempt).toMatchObject({
          status: 'reconciled',
          result: { outcome },
        });
      }
    },
  );

  it('returns the same unknown or terminal attempt for an exact retry', () => {
    const started = start();
    const uncertain = transitionPaymentAttempt(started.order, started.attempt, {
      type: 'mark_unknown',
      actorAccountId: OWNER,
      now: TERMINAL_AT,
    });
    if (uncertain.outcome !== 'transitioned') {
      throw new Error('Expected unknown payment attempt');
    }
    expect(
      startPaymentAttempt(
        uncertain.order,
        {
          attemptId: OTHER_ATTEMPT,
          actorAccountId: OWNER,
          idempotencyKey: IDEMPOTENCY_KEY,
          request: request(),
          now: unixEpochSeconds(TERMINAL_AT + 1),
        },
        uncertain.attempt,
      ),
    ).toMatchObject({
      outcome: 'idempotent_retry',
      attempt: uncertain.attempt,
    });

    const reconciled = transitionPaymentAttempt(
      uncertain.order,
      uncertain.attempt as Extract<PaymentAttempt, { status: 'unknown' }>,
      {
        type: 'reconcile',
        actorAccountId: OWNER,
        now: unixEpochSeconds(TERMINAL_AT + 1),
        result: { outcome: 'paid', paymentBinding: BINDING },
      },
    );
    if (reconciled.outcome !== 'transitioned') {
      throw new Error('Expected reconciled payment attempt');
    }
    expect(
      startPaymentAttempt(
        reconciled.order,
        {
          attemptId: OTHER_ATTEMPT,
          actorAccountId: OWNER,
          idempotencyKey: IDEMPOTENCY_KEY,
          request: request(),
          now: unixEpochSeconds(TERMINAL_AT + 2),
        },
        reconciled.attempt,
      ),
    ).toMatchObject({
      outcome: 'idempotent_retry',
      attempt: reconciled.attempt,
    });
  });

  it('rejects mutation after a terminal attempt', () => {
    const started = start();
    const confirmed = transitionPaymentAttempt(started.order, started.attempt, {
      type: 'confirm',
      actorAccountId: OWNER,
      now: TERMINAL_AT,
      result: { outcome: 'paid', paymentBinding: BINDING },
    });
    if (confirmed.outcome !== 'transitioned') {
      throw new Error('Expected confirmed payment attempt');
    }

    expect(
      transitionPaymentAttempt(confirmed.order, confirmed.attempt, {
        type: 'mark_unknown',
        actorAccountId: OWNER,
        now: unixEpochSeconds(TERMINAL_AT + 1),
      }),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'forbidden_transition',
    });
  });
});
