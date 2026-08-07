import { accountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { digestReservationOperationRequest } from './reservation-request-digest';
import {
  reservationProviderReconciliationCommand,
  reservationProviderWriteCommand,
} from './reservation-provider.port';
import {
  CourtReservation,
  ReservationClientSnapshot,
  ReservationOperationRequest,
  ReservationTarget,
  YclientsReservationExternalReference,
  YclientsReservationBinding,
  courtReservationId,
  isReservationTarget,
  reservationIdempotencyKey,
  reservationOperationId,
  reservationProviderRejectionReason,
  reservationRequestDigest,
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
const OTHER_RESERVATION_ID = courtReservationId(
  deterministicUuid('d2-other-reservation'),
);
const OWNER_ACCOUNT_ID = accountId(deterministicUuid('d2-owner-account'));
const OTHER_ACCOUNT_ID = accountId(deterministicUuid('d2-other-account'));
const OPERATION_ID = reservationOperationId(
  deterministicUuid('d2-reservation-operation'),
);
const IDEMPOTENCY_KEY = reservationIdempotencyKey(
  deterministicUuid('d2-reservation-idempotency'),
);
const PROVIDER_REJECTED = reservationProviderRejectionReason(
  'provider_rejected',
);
const EXTERNAL_REFERENCE = Object.freeze({ apiId: 7_770_001 });
const CLIENT: ReservationClientSnapshot = Object.freeze({
  phone: '+79000000000',
  fullName: 'Тест Просто Падел',
  email: 'test@example.test',
});

const ORIGINAL_TARGET: ReservationTarget = Object.freeze({
  serviceId: 30_539_679,
  courtId: 5_730_531,
  startsAt: '2026-08-08T16:30:00+03:00',
  endsAt: '2026-08-08T17:30:00+03:00',
});
const RESCHEDULED_TARGET: ReservationTarget = Object.freeze({
  serviceId: 30_539_679,
  courtId: 5_730_532,
  startsAt: '2026-08-08T18:00:00+03:00',
  endsAt: '2026-08-08T19:00:00+03:00',
});
const PROVIDER_BINDING: YclientsReservationBinding = Object.freeze({
  provider: 'yclients',
  appointmentId: 1,
  recordId: 2_820_023,
  recordHash: '567df655304da9b98487769426d4e76e',
});

function unbookedReservation(
  ownerAccountId = OWNER_ACCOUNT_ID,
  reservationId = RESERVATION_ID,
): CourtReservation {
  return createCourtReservation({
    reservationId,
    ownerAccountId,
    target: ORIGINAL_TARGET,
    now: CREATED_AT,
  });
}

function request(
  type: ReservationOperationRequest['type'],
  target: ReservationTarget = ORIGINAL_TARGET,
  overrides: Partial<{
    reservationId: typeof RESERVATION_ID;
    ownerAccountId: typeof OWNER_ACCOUNT_ID;
    externalReference: YclientsReservationExternalReference;
    client: ReservationClientSnapshot;
  }> = {},
): ReservationOperationRequest {
  const binding = {
    reservationId: RESERVATION_ID,
    ownerAccountId: OWNER_ACCOUNT_ID,
    externalReference: EXTERNAL_REFERENCE,
    client: CLIENT,
    ...overrides,
  };
  return type === 'cancel'
    ? Object.freeze({ type, ...binding })
    : Object.freeze({ type, ...binding, target });
}

function start(
  reservation: CourtReservation,
  operationRequest: ReservationOperationRequest = request('create'),
  overrides: Partial<Parameters<typeof startReservationOperation>[1]> = {},
) {
  const result = startReservationOperation(reservation, {
    operationId: OPERATION_ID,
    actorAccountId: reservation.ownerAccountId,
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
      actorAccountId: OWNER_ACCOUNT_ID,
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
        ownerAccountId: OWNER_ACCOUNT_ID,
        externalReference: Object.freeze({ ...EXTERNAL_REFERENCE }),
        client: Object.freeze({ ...CLIENT }),
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

  it.each([
    ['client snapshot', request('create', ORIGINAL_TARGET, {
      client: Object.freeze({
        ...CLIENT,
        email: 'other@example.test',
      }),
    })],
    ['external reference', request('create', ORIGINAL_TARGET, {
      externalReference: Object.freeze({
        apiId: EXTERNAL_REFERENCE.apiId + 1,
      }),
    })],
  ])('covers the immutable %s', (_field, changedRequest) => {
    expect(digestReservationOperationRequest(changedRequest)).not.toBe(
      digestReservationOperationRequest(request('create')),
    );
  });
});

describe('reservation target validation', () => {
  it.each([
    '2026-02-30T16:30:00+03:00',
    '2025-02-29T16:30:00+03:00',
    '2026-04-31T16:30:00+03:00',
  ])('rejects the impossible calendar datetime %s', (startsAt) => {
    const target = { ...ORIGINAL_TARGET, startsAt };
    expect(isReservationTarget(target)).toBe(false);
    expect(() =>
      createCourtReservation({
        reservationId: RESERVATION_ID,
        ownerAccountId: OWNER_ACCOUNT_ID,
        target,
        now: CREATED_AT,
      }),
    ).toThrow('Court reservation binding is invalid');
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
        actorAccountId: OWNER_ACCOUNT_ID,
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
      {
        type: 'mark_unknown',
        actorAccountId: OWNER_ACCOUNT_ID,
        now: TERMINAL_AT,
      },
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
        actorAccountId: OWNER_ACCOUNT_ID,
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
        actorAccountId: OWNER_ACCOUNT_ID,
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

  it.each([
    ['client snapshot', request('create', ORIGINAL_TARGET, {
      client: Object.freeze({
        ...CLIENT,
        phone: '+79000000001',
      }),
    })],
    ['external reference', request('create', ORIGINAL_TARGET, {
      externalReference: Object.freeze({
        apiId: EXTERNAL_REFERENCE.apiId + 1,
      }),
    })],
  ])(
    'rejects the same key with a different %s',
    (_field, changedRequest) => {
      const started = start(unbookedReservation());
      const retry = startReservationOperation(
        started.reservation,
        {
          operationId: reservationOperationId(
            deterministicUuid(`d2-conflicting-${_field}`),
          ),
          actorAccountId: OWNER_ACCOUNT_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
          request: changedRequest,
          now: unixEpochSeconds(STARTED_AT + 1),
        },
        started.operation,
      );

      expect(retry).toMatchObject({
        outcome: 'rejected',
        reason: 'idempotency_key_conflict',
      });
    },
  );

  it('rejects another account before starting or returning an operation', () => {
    const reservation = unbookedReservation();
    const result = startReservationOperation(reservation, {
      operationId: OPERATION_ID,
      actorAccountId: OTHER_ACCOUNT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      request: request('create'),
      now: STARTED_AT,
    });

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'ownership_conflict',
      reservation,
    });
    expect(result).not.toHaveProperty('operation');
  });

  it('rejects an existing operation returned from another owner scope', () => {
    const foreignReservation = unbookedReservation(OTHER_ACCOUNT_ID);
    const foreign = start(
      foreignReservation,
      request('create', ORIGINAL_TARGET, {
        ownerAccountId: OTHER_ACCOUNT_ID,
      }),
      { actorAccountId: OTHER_ACCOUNT_ID },
    );
    const localReservation = unbookedReservation();
    const result = startReservationOperation(
      localReservation,
      {
        operationId: OPERATION_ID,
        actorAccountId: OWNER_ACCOUNT_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        request: request('create'),
        now: STARTED_AT,
      },
      foreign.operation,
    );

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'operation_binding_conflict',
    });
    expect(result).not.toHaveProperty('operation');
  });

  it('rejects an existing operation from another reservation', () => {
    const otherReservation = unbookedReservation(
      OWNER_ACCOUNT_ID,
      OTHER_RESERVATION_ID,
    );
    const other = start(
      otherReservation,
      request('create', ORIGINAL_TARGET, {
        reservationId: OTHER_RESERVATION_ID,
      }),
    );
    const result = startReservationOperation(
      unbookedReservation(),
      {
        operationId: OPERATION_ID,
        actorAccountId: OWNER_ACCOUNT_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        request: request('create'),
        now: STARTED_AT,
      },
      other.operation,
    );

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'operation_binding_conflict',
    });
    expect(result).not.toHaveProperty('operation');
  });

  it('rejects an existing operation with a mismatched operation type', () => {
    const started = start(unbookedReservation());
    const mismatched = Object.freeze({
      ...started.operation,
      type: 'cancel' as const,
    });
    const result = startReservationOperation(
      started.reservation,
      {
        operationId: OPERATION_ID,
        actorAccountId: OWNER_ACCOUNT_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        request: request('create'),
        now: unixEpochSeconds(STARTED_AT + 1),
      },
      mismatched,
    );

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'operation_binding_conflict',
    });
  });

  it('validates the looked-up key and persisted request digest before retry', () => {
    const started = start(unbookedReservation());
    const retryInput = {
      operationId: OPERATION_ID,
      actorAccountId: OWNER_ACCOUNT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      request: request('create'),
      now: unixEpochSeconds(STARTED_AT + 1),
    } as const;

    expect(
      startReservationOperation(
        started.reservation,
        retryInput,
        Object.freeze({
          ...started.operation,
          idempotencyKey: reservationIdempotencyKey(
            deterministicUuid('d2-wrong-looked-up-key'),
          ),
        }),
      ),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'idempotency_lookup_mismatch',
    });
    expect(
      startReservationOperation(
        started.reservation,
        retryInput,
        Object.freeze({
          ...started.operation,
          requestDigest: reservationRequestDigest('0'.repeat(64)),
        }),
      ),
    ).toMatchObject({
      outcome: 'rejected',
      reason: 'operation_binding_conflict',
    });
  });

  it('rejects a transition from another account without changing state', () => {
    const started = start(unbookedReservation());
    const result = transitionReservationOperation(
      started.reservation,
      started.operation,
      {
        type: 'mark_unknown',
        actorAccountId: OTHER_ACCOUNT_ID,
        now: TERMINAL_AT,
      },
    );

    expect(result).toMatchObject({
      outcome: 'rejected',
      reason: 'ownership_conflict',
    });
    expect(result.reservation).toBe(started.reservation);
    expect(result.operation).toBe(started.operation);
  });

  it('moves an uncertain write to unknown and forbids a blind create retry', () => {
    const started = start(unbookedReservation());
    const uncertain = transitionReservationOperation(
      started.reservation,
      started.operation,
      {
        type: 'mark_unknown',
        actorAccountId: OWNER_ACCOUNT_ID,
        now: TERMINAL_AT,
      },
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
        actorAccountId: OWNER_ACCOUNT_ID,
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
      {
        type: 'reject',
        actorAccountId: OWNER_ACCOUNT_ID,
        now: TERMINAL_AT,
        reason: PROVIDER_REJECTED,
      },
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
        {
          type: 'mark_unknown',
          actorAccountId: OWNER_ACCOUNT_ID,
          now: TERMINAL_AT,
        },
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
              actorAccountId: OWNER_ACCOUNT_ID,
              now: unixEpochSeconds(TERMINAL_AT + 1),
              result: {
                outcome: 'confirmed',
                providerBinding: PROVIDER_BINDING,
              },
            }
          : {
              type: 'reconcile',
              actorAccountId: OWNER_ACCOUNT_ID,
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
      {
        type: 'mark_unknown',
        actorAccountId: OWNER_ACCOUNT_ID,
        now: unixEpochSeconds(TERMINAL_AT + 2),
      },
    );
    expect(uncertain.outcome).toBe('transitioned');
    if (uncertain.outcome !== 'transitioned') {
      throw new Error('Expected an unknown cancellation');
    }
    expect(uncertain.reservation.status).toBe('unknown');
    expect(reservationHoldsCourtSlot(uncertain.reservation)).toBe(true);
  });

  it('rejects a direct cancel confirmation without exact deleted proof', () => {
    const confirmed = confirmedReservation();
    const cancelling = start(confirmed, request('cancel'), {
      operationId: reservationOperationId(
        deterministicUuid('d2-proof-cancel-operation'),
      ),
      idempotencyKey: reservationIdempotencyKey(
        deterministicUuid('d2-proof-cancel-idempotency'),
      ),
      now: unixEpochSeconds(TERMINAL_AT + 1),
    });

    expect(
      transitionReservationOperation(
        cancelling.reservation,
        cancelling.operation,
        {
          type: 'confirm',
          actorAccountId: OWNER_ACCOUNT_ID,
          now: unixEpochSeconds(TERMINAL_AT + 2),
        },
      ),
    ).toMatchObject({ outcome: 'rejected', reason: 'invalid_command' });
    expect(reservationHoldsCourtSlot(cancelling.reservation)).toBe(true);

    const proved = transitionReservationOperation(
      cancelling.reservation,
      cancelling.operation,
      {
        type: 'confirm',
        actorAccountId: OWNER_ACCOUNT_ID,
        now: unixEpochSeconds(TERMINAL_AT + 2),
        cancellationProof: Object.freeze({
          recordId: PROVIDER_BINDING.recordId,
          apiId: EXTERNAL_REFERENCE.apiId,
          deleted: true,
        }),
      },
    );
    expect(proved.outcome).toBe('transitioned');
    if (proved.outcome === 'transitioned') {
      expect(proved.reservation.status).toBe('cancelled');
      expect(reservationHoldsCourtSlot(proved.reservation)).toBe(false);
    }
  });

  it('rejects cancel reconciliation without exact deleted proof or with a mismatched proof', () => {
    const confirmed = confirmedReservation();
    const cancelling = start(confirmed, request('cancel'), {
      operationId: reservationOperationId(
        deterministicUuid('d2-proof-reconcile-operation'),
      ),
      idempotencyKey: reservationIdempotencyKey(
        deterministicUuid('d2-proof-reconcile-idempotency'),
      ),
      now: unixEpochSeconds(TERMINAL_AT + 1),
    });
    const uncertain = transitionReservationOperation(
      cancelling.reservation,
      cancelling.operation,
      {
        type: 'mark_unknown',
        actorAccountId: OWNER_ACCOUNT_ID,
        now: unixEpochSeconds(TERMINAL_AT + 2),
      },
    );
    expect(uncertain.outcome).toBe('transitioned');
    if (uncertain.outcome !== 'transitioned') {
      throw new Error('Expected an unknown cancellation');
    }

    for (const result of [
      { outcome: 'confirmed' as const },
      {
        outcome: 'confirmed' as const,
        cancellationProof: Object.freeze({
          recordId: PROVIDER_BINDING.recordId + 1,
          apiId: EXTERNAL_REFERENCE.apiId,
          deleted: true as const,
        }),
      },
    ]) {
      expect(
        transitionReservationOperation(
          uncertain.reservation,
          uncertain.operation,
          {
            type: 'reconcile',
            actorAccountId: OWNER_ACCOUNT_ID,
            now: unixEpochSeconds(TERMINAL_AT + 3),
            result,
          },
        ),
      ).toMatchObject({ outcome: 'rejected', reason: 'invalid_command' });
    }
    expect(reservationHoldsCourtSlot(uncertain.reservation)).toBe(true);

    const proved = transitionReservationOperation(
      uncertain.reservation,
      uncertain.operation,
      {
        type: 'reconcile',
        actorAccountId: OWNER_ACCOUNT_ID,
        now: unixEpochSeconds(TERMINAL_AT + 3),
        result: {
          outcome: 'confirmed',
          cancellationProof: Object.freeze({
            recordId: PROVIDER_BINDING.recordId,
            apiId: EXTERNAL_REFERENCE.apiId,
            deleted: true,
          }),
        },
      },
    );
    expect(proved.outcome).toBe('transitioned');
    if (proved.outcome === 'transitioned') {
      expect(proved.reservation.status).toBe('cancelled');
      expect(reservationHoldsCourtSlot(proved.reservation)).toBe(false);
    }
  });

  it('rejects transitions after an operation reaches a terminal state', () => {
    const started = start(unbookedReservation());
    const confirmed = transitionReservationOperation(
      started.reservation,
      started.operation,
      {
        type: 'confirm',
        actorAccountId: OWNER_ACCOUNT_ID,
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
          actorAccountId: OWNER_ACCOUNT_ID,
          now: unixEpochSeconds(TERMINAL_AT + 1),
        },
      ),
    ).toMatchObject({ outcome: 'rejected', reason: 'forbidden_transition' });
  });
});

describe('reservation provider commands', () => {
  it('builds a complete YCLIENTS-compatible create command', () => {
    const started = start(unbookedReservation());

    expect(
      reservationProviderWriteCommand(
        started.reservation,
        started.operation,
      ),
    ).toEqual({
      mode: 'write',
      type: 'create',
      operationId: OPERATION_ID,
      reservationId: RESERVATION_ID,
      ownerAccountId: OWNER_ACCOUNT_ID,
      requestDigest: started.operation.requestDigest,
      apiId: EXTERNAL_REFERENCE.apiId,
      client: CLIENT,
      serviceId: ORIGINAL_TARGET.serviceId,
      courtId: ORIGINAL_TARGET.courtId,
      datetime: ORIGINAL_TARGET.startsAt,
    });
    expect(Object.isFrozen(started.operation.request.client)).toBe(true);
  });

  it('builds complete reschedule and cancel commands with current binding', () => {
    const confirmed = confirmedReservation();
    const reschedule = start(
      confirmed,
      request('reschedule', RESCHEDULED_TARGET),
      {
        operationId: reservationOperationId(
          deterministicUuid('d2-provider-reschedule-operation'),
        ),
        idempotencyKey: reservationIdempotencyKey(
          deterministicUuid('d2-provider-reschedule-idempotency'),
        ),
        now: unixEpochSeconds(TERMINAL_AT + 1),
      },
    );
    expect(
      reservationProviderWriteCommand(
        reschedule.reservation,
        reschedule.operation,
      ),
    ).toMatchObject({
      mode: 'write',
      type: 'reschedule',
      ownerAccountId: OWNER_ACCOUNT_ID,
      apiId: EXTERNAL_REFERENCE.apiId,
      client: CLIENT,
      serviceId: RESCHEDULED_TARGET.serviceId,
      courtId: RESCHEDULED_TARGET.courtId,
      datetime: RESCHEDULED_TARGET.startsAt,
      currentProviderBinding: PROVIDER_BINDING,
    });

    const cancel = start(confirmed, request('cancel'), {
      operationId: reservationOperationId(
        deterministicUuid('d2-provider-cancel-operation'),
      ),
      idempotencyKey: reservationIdempotencyKey(
        deterministicUuid('d2-provider-cancel-idempotency'),
      ),
      now: unixEpochSeconds(TERMINAL_AT + 1),
    });
    expect(
      reservationProviderWriteCommand(
        cancel.reservation,
        cancel.operation,
      ),
    ).toMatchObject({
      mode: 'write',
      type: 'cancel',
      ownerAccountId: OWNER_ACCOUNT_ID,
      apiId: EXTERNAL_REFERENCE.apiId,
      client: CLIENT,
      currentProviderBinding: PROVIDER_BINDING,
    });
  });

  it('builds reconciliation input without making unknown write-retryable', () => {
    const started = start(unbookedReservation());
    const uncertain = transitionReservationOperation(
      started.reservation,
      started.operation,
      {
        type: 'mark_unknown',
        actorAccountId: OWNER_ACCOUNT_ID,
        now: TERMINAL_AT,
      },
    );
    expect(uncertain.outcome).toBe('transitioned');
    if (
      uncertain.outcome !== 'transitioned' ||
      uncertain.operation.status !== 'unknown'
    ) {
      throw new Error('Expected an unknown reservation operation');
    }

    expect(
      reservationProviderReconciliationCommand(
        uncertain.reservation,
        uncertain.operation,
      ),
    ).toMatchObject({
      mode: 'reconciliation',
      type: 'create',
      ownerAccountId: OWNER_ACCOUNT_ID,
      apiId: EXTERNAL_REFERENCE.apiId,
      client: CLIENT,
      serviceId: ORIGINAL_TARGET.serviceId,
      courtId: ORIGINAL_TARGET.courtId,
      datetime: ORIGINAL_TARGET.startsAt,
    });
  });
});
