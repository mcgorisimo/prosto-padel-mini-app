import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { digestReservationOperationRequest } from './reservation-request-digest';
import {
  ReservationOperationRequest,
  ReservationTarget,
  YclientsReservationBinding,
  courtReservationId,
  reservationIdempotencyKey,
  reservationOperationId,
  reservationProviderRejectionReason,
} from './reservation.types';
import {
  createCourtReservation,
  reservationHoldsCourtSlot,
  startReservationOperation,
  transitionReservationOperation,
} from './reservation.state-machine';

const CREATED_AT = unixEpochSeconds(1_786_025_000);
const STARTED_AT = unixEpochSeconds(1_786_025_010);
const TERMINAL_AT = unixEpochSeconds(1_786_025_020);
const RESERVATION_ID = courtReservationId(
  deterministicUuid('d2-reservation'),
);
const OPERATION_ID = reservationOperationId(
  deterministicUuid('d2-reservation-operation'),
);
const IDEMPOTENCY_KEY = reservationIdempotencyKey(
  deterministicUuid('d2-reservation-idempotency'),
);
const PROVIDER_REJECTED = reservationProviderRejectionReason(
  'provider_rejected',
);

const ORIGINAL_TARGET: ReservationTarget = Object.freeze({
  serviceId: 30_539_679,
  courtId: 5_730_531,
  startsAt: '2026-08-08T16:30:00+03:00',
});
const RESCHEDULED_TARGET: ReservationTarget = Object.freeze({
  serviceId: 30_539_679,
  courtId: 5_730_532,
  startsAt: '2026-08-08T18:00:00+03:00',
});
const PROVIDER_BINDING: YclientsReservationBinding = Object.freeze({
  provider: 'yclients',
  appointmentId: 1,
  recordId: 2_820_023,
  recordHash: '567df655304da9b98487769426d4e76e',
});

function unbookedReservation() {
  return createCourtReservation({
    reservationId: RESERVATION_ID,
    target: ORIGINAL_TARGET,
    now: CREATED_AT,
  });
}

function request(
  type: ReservationOperationRequest['type'],
  target: ReservationTarget = ORIGINAL_TARGET,
): ReservationOperationRequest {
  return type === 'cancel'
    ? Object.freeze({ type, reservationId: RESERVATION_ID })
    : Object.freeze({ type, reservationId: RESERVATION_ID, target });
}

function start(
  reservation: ReturnType<typeof unbookedReservation>,
  operationRequest: ReservationOperationRequest = request('create'),
  overrides: Partial<Parameters<typeof startReservationOperation>[1]> = {},
) {
  const result = startReservationOperation(reservation, {
    operationId: OPERATION_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    request: operationRequest,
    now: STARTED_AT,
    ...overrides,
  });
  expect(result.outcome).toBe('started');
  if (result.outcome !== 'started') {
    throw new Error('Expected reservation operation to start');
  }
  return result;
}

function confirmedReservation() {
  const started = start(unbookedReservation());
  const result = transitionReservationOperation(
    started.reservation,
    started.operation,
    {
      type: 'confirm',
      now: TERMINAL_AT,
      providerBinding: PROVIDER_BINDING,
    },
  );
  expect(result.outcome).toBe('transitioned');
  if (result.outcome !== 'transitioned') {
    throw new Error('Expected reservation operation to confirm');
  }
  return result.reservation;
}

describe('reservation request digest', () => {
  it('is deterministic over canonical request fields', () => {
    const first = digestReservationOperationRequest(request('create'));
    const second = digestReservationOperationRequest(
      Object.freeze({
        target: Object.freeze({ ...ORIGINAL_TARGET }),
        reservationId: RESERVATION_ID,
        type: 'create',
      }),
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      digestReservationOperationRequest(
        request('create', RESCHEDULED_TARGET),
      ),
    ).not.toBe(first);
    expect(digestReservationOperationRequest(request('cancel'))).not.toBe(
      first,
    );
  });
});

describe('reservation operation state machine', () => {
  it('allows create, reschedule and cancel only from their source states', () => {
    const create = start(unbookedReservation());
    expect(create.reservation.status).toBe('pending_confirmation');

    const confirmed = confirmedReservation();
    const reschedule = start(
      confirmed,
      request('reschedule', RESCHEDULED_TARGET),
      {
        operationId: reservationOperationId(
          deterministicUuid('d2-reschedule-operation'),
        ),
        idempotencyKey: reservationIdempotencyKey(
          deterministicUuid('d2-reschedule-idempotency'),
        ),
        now: unixEpochSeconds(TERMINAL_AT + 1),
      },
    );
    expect(reschedule.reservation.status).toBe('reschedule_pending');

    const cancel = start(confirmed, request('cancel'), {
      operationId: reservationOperationId(
        deterministicUuid('d2-cancel-operation'),
      ),
      idempotencyKey: reservationIdempotencyKey(
        deterministicUuid('d2-cancel-idempotency'),
      ),
      now: unixEpochSeconds(TERMINAL_AT + 1),
    });
    expect(cancel.reservation.status).toBe('cancel_pending');

    expect(
      startReservationOperation(unbookedReservation(), {
        operationId: reservationOperationId(
          deterministicUuid('d2-forbidden-cancel-operation'),
        ),
        idempotencyKey: reservationIdempotencyKey(
          deterministicUuid('d2-forbidden-cancel-idempotency'),
        ),
        request: request('cancel'),
        now: STARTED_AT,
      }),
    ).toMatchObject({ outcome: 'rejected', reason: 'forbidden_transition' });
  });

  it('returns the previous operation for the same key and same digest', () => {
    const started = start(unbookedReservation());
    const uncertain = transitionReservationOperation(
      started.reservation,
      started.operation,
      { type: 'mark_unknown', now: TERMINAL_AT },
    );
    expect(uncertain.outcome).toBe('transitioned');
    if (uncertain.outcome !== 'transitioned') {
      throw new Error('Expected an unknown operation');
    }

    const retry = startReservationOperation(
      uncertain.reservation,
      {
        operationId: reservationOperationId(
          deterministicUuid('must-not-replace-existing-operation'),
        ),
        idempotencyKey: IDEMPOTENCY_KEY,
        request: request('create'),
        now: unixEpochSeconds(TERMINAL_AT + 1),
      },
      uncertain.operation,
    );

    expect(retry.outcome).toBe('idempotent_retry');
    if (retry.outcome !== 'idempotent_retry') {
      throw new Error('Expected an idempotent retry');
    }
    expect(retry.operation).toBe(uncertain.operation);
    expect(retry.operation.status).toBe('unknown');
  });

  it('rejects the same key when the immutable request digest differs', () => {
    const started = start(unbookedReservation());
    const retry = startReservationOperation(
      started.reservation,
      {
        operationId: reservationOperationId(
          deterministicUuid('d2-conflicting-operation'),
        ),
        idempotencyKey: IDEMPOTENCY_KEY,
        request: request('create', RESCHEDULED_TARGET),
        now: unixEpochSeconds(STARTED_AT + 1),
      },
      started.operation,
    );

    expect(retry).toMatchObject({
      outcome: 'rejected',
      reason: 'idempotency_key_conflict',
    });
  });

  it('moves an uncertain write to unknown and forbids a blind create retry', () => {
    const started = start(unbookedReservation());
    const uncertain = transitionReservationOperation(
      started.reservation,
      started.operation,
      { type: 'mark_unknown', now: TERMINAL_AT },
    );
    expect(uncertain.outcome).toBe('transitioned');
    if (uncertain.outcome !== 'transitioned') {
      throw new Error('Expected an unknown operation');
    }
    expect(uncertain.operation.status).toBe('unknown');
    expect(uncertain.reservation.status).toBe('unknown');

    expect(
      startReservationOperation(uncertain.reservation, {
        operationId: reservationOperationId(
          deterministicUuid('d2-blind-retry-operation'),
        ),
        idempotencyKey: reservationIdempotencyKey(
          deterministicUuid('d2-blind-retry-idempotency'),
        ),
        request: request('create'),
        now: unixEpochSeconds(TERMINAL_AT + 1),
      }),
    ).toMatchObject({ outcome: 'rejected', reason: 'forbidden_transition' });
  });

  it('records confirmed and rejected terminal outcomes', () => {
    const confirmed = confirmedReservation();
    expect(confirmed).toMatchObject({
      status: 'confirmed',
      providerBinding: PROVIDER_BINDING,
    });

    const started = start(unbookedReservation());
    const rejected = transitionReservationOperation(
      started.reservation,
      started.operation,
      { type: 'reject', now: TERMINAL_AT, reason: PROVIDER_REJECTED },
    );
    expect(rejected.outcome).toBe('transitioned');
    if (rejected.outcome !== 'transitioned') {
      throw new Error('Expected a rejected operation');
    }
    expect(rejected.operation).toMatchObject({
      status: 'rejected',
      reason: 'provider_rejected',
    });
    expect(rejected.reservation.status).toBe('rejected');
    expect(reservationHoldsCourtSlot(rejected.reservation)).toBe(false);
  });

  it.each([
    ['confirmed' as const, 'confirmed' as const],
    ['rejected' as const, 'rejected' as const],
  ])(
    'records a reconciled %s terminal outcome',
    (reconciliationOutcome, reservationStatus) => {
      const started = start(unbookedReservation());
      const uncertain = transitionReservationOperation(
        started.reservation,
        started.operation,
        { type: 'mark_unknown', now: TERMINAL_AT },
      );
      expect(uncertain.outcome).toBe('transitioned');
      if (uncertain.outcome !== 'transitioned') {
        throw new Error('Expected an unknown operation');
      }

      const reconciled = transitionReservationOperation(
        uncertain.reservation,
        uncertain.operation,
        reconciliationOutcome === 'confirmed'
          ? {
              type: 'reconcile',
              now: unixEpochSeconds(TERMINAL_AT + 1),
              result: {
                outcome: 'confirmed',
                providerBinding: PROVIDER_BINDING,
              },
            }
          : {
              type: 'reconcile',
              now: unixEpochSeconds(TERMINAL_AT + 1),
              result: {
                outcome: 'rejected',
                reason: PROVIDER_REJECTED,
              },
            },
      );

      expect(reconciled.outcome).toBe('transitioned');
      if (reconciled.outcome !== 'transitioned') {
        throw new Error('Expected a reconciled operation');
      }
      expect(reconciled.operation).toMatchObject({
        status: 'reconciled',
        uncertainAt: TERMINAL_AT,
        result: { outcome: reconciliationOutcome },
      });
      expect(reconciled.reservation.status).toBe(reservationStatus);
    },
  );

  it('does not release the slot while cancel is pending or unknown', () => {
    const confirmed = confirmedReservation();
    const cancelling = start(confirmed, request('cancel'), {
      operationId: reservationOperationId(
        deterministicUuid('d2-hold-cancel-operation'),
      ),
      idempotencyKey: reservationIdempotencyKey(
        deterministicUuid('d2-hold-cancel-idempotency'),
      ),
      now: unixEpochSeconds(TERMINAL_AT + 1),
    });
    expect(cancelling.reservation.status).toBe('cancel_pending');
    expect(reservationHoldsCourtSlot(cancelling.reservation)).toBe(true);

    const uncertain = transitionReservationOperation(
      cancelling.reservation,
      cancelling.operation,
      { type: 'mark_unknown', now: unixEpochSeconds(TERMINAL_AT + 2) },
    );
    expect(uncertain.outcome).toBe('transitioned');
    if (uncertain.outcome !== 'transitioned') {
      throw new Error('Expected an unknown cancellation');
    }
    expect(uncertain.reservation.status).toBe('unknown');
    expect(reservationHoldsCourtSlot(uncertain.reservation)).toBe(true);
  });

  it('rejects transitions after an operation reaches a terminal state', () => {
    const started = start(unbookedReservation());
    const confirmed = transitionReservationOperation(
      started.reservation,
      started.operation,
      {
        type: 'confirm',
        now: TERMINAL_AT,
        providerBinding: PROVIDER_BINDING,
      },
    );
    expect(confirmed.outcome).toBe('transitioned');
    if (confirmed.outcome !== 'transitioned') {
      throw new Error('Expected a confirmed operation');
    }

    expect(
      transitionReservationOperation(
        confirmed.reservation,
        confirmed.operation,
        {
          type: 'mark_unknown',
          now: unixEpochSeconds(TERMINAL_AT + 1),
        },
      ),
    ).toMatchObject({ outcome: 'rejected', reason: 'forbidden_transition' });
  });
});
