import { accountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  CourtReservationRepository,
  CreateCourtReservationPersistenceResult,
} from '../database/court-reservation.repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  ReservationCancellationDeleteResult,
  ReservationCancellationExactReadResult,
  ReservationCancellationProviderPort,
} from './reservation-cancellation.port';
import {
  ReservationCancellationService,
  ReservationCancellationTransactionRunner,
  RequestReservationCancellationInput,
} from './reservation-cancellation.service';
import {
  createCourtReservation,
  reservationHoldsCourtSlot,
  startReservationOperation,
  transitionReservationOperation,
} from './reservation.state-machine';
import {
  CancelReservationRequest,
  CourtReservation,
  ReservationClientSnapshot,
  ReservationOperation,
  courtReservationId,
  reservationIdempotencyKey,
  reservationOperationId,
} from './reservation.types';

const CREATED_AT = unixEpochSeconds(1_786_000_000);
const CONFIRMED_AT = unixEpochSeconds(1_786_000_010);
const CANCELLATION_REQUESTED_AT = unixEpochSeconds(1_786_000_020);
const TERMINAL_AT = unixEpochSeconds(1_786_000_030);
const OWNER_ACCOUNT_ID = accountId(
  deterministicUuid('d2-cancellation-owner'),
);
const OTHER_ACCOUNT_ID = accountId(
  deterministicUuid('d2-cancellation-other-owner'),
);
const RESERVATION_ID = courtReservationId(
  deterministicUuid('d2-cancellation-reservation'),
);
const CREATE_OPERATION_ID = reservationOperationId(
  deterministicUuid('d2-cancellation-create-operation'),
);
const CANCEL_OPERATION_ID = reservationOperationId(
  deterministicUuid('d2-cancellation-operation'),
);
const CREATE_KEY = reservationIdempotencyKey(
  deterministicUuid('d2-cancellation-create-key'),
);
const CANCEL_KEY = reservationIdempotencyKey(
  deterministicUuid('d2-cancellation-key'),
);
const API_ID = 7_710_001;
const RECORD_ID = 2_910_001;
const CLIENT: ReservationClientSnapshot = Object.freeze({
  phone: '+79000000000',
  fullName: 'Diagnostic Client Marker',
  email: 'diagnostic-marker@example.test',
});
const TARGET = Object.freeze({
  serviceId: 30_539_679,
  courtId: 5_730_531,
  startsAt: '2026-08-09T16:30:00+03:00',
  endsAt: '2026-08-09T17:30:00+03:00',
});
const BINDING = Object.freeze({
  provider: 'yclients' as const,
  appointmentId: 1,
  recordId: RECORD_ID,
  recordHash: 'record-hash-must-not-leak',
});
function cancellationRequest(
  ownerAccountId = OWNER_ACCOUNT_ID,
  client = CLIENT,
): CancelReservationRequest {
  return Object.freeze({
    type: 'cancel',
    reservationId: RESERVATION_ID,
    ownerAccountId,
    externalReference: Object.freeze({ apiId: API_ID }),
    client,
  });
}

function confirmedReservation(): CourtReservation {
  const initial = createCourtReservation({
    reservationId: RESERVATION_ID,
    ownerAccountId: OWNER_ACCOUNT_ID,
    target: TARGET,
    now: CREATED_AT,
  });
  const create = startReservationOperation(initial, {
    operationId: CREATE_OPERATION_ID,
    actorAccountId: OWNER_ACCOUNT_ID,
    idempotencyKey: CREATE_KEY,
    request: Object.freeze({
      type: 'create',
      reservationId: RESERVATION_ID,
      ownerAccountId: OWNER_ACCOUNT_ID,
      externalReference: Object.freeze({ apiId: API_ID }),
      client: CLIENT,
      target: TARGET,
    }),
    now: CREATED_AT,
  });
  if (create.outcome !== 'started') {
    throw new Error('Create operation did not start');
  }
  const confirmed = transitionReservationOperation(
    create.reservation,
    create.operation,
    {
      type: 'confirm',
      actorAccountId: OWNER_ACCOUNT_ID,
      now: CONFIRMED_AT,
      providerBinding: BINDING,
    },
  );
  if (confirmed.outcome !== 'transitioned') {
    throw new Error('Create operation did not confirm');
  }
  return confirmed.reservation;
}

class InMemoryCancellationRepository
  implements CourtReservationRepository
{
  reservation = confirmedReservation();
  operation: ReservationOperation | undefined;
  readonly startOperation = jest.fn(
    async (
      _transaction: PostgresTransaction,
      actorAccountId: typeof OWNER_ACCOUNT_ID,
      reservationId: typeof RESERVATION_ID,
      input: Parameters<CourtReservationRepository['startOperation']>[3],
    ) => {
      if (reservationId !== this.reservation.reservationId) {
        throw new Error('Unexpected reservation');
      }
      const existing =
        this.operation?.idempotencyKey === input.idempotencyKey
          ? this.operation
          : undefined;
      const result = startReservationOperation(
        this.reservation,
        { ...input, actorAccountId },
        existing,
      );
      if (result.outcome === 'started') {
        this.reservation = result.reservation;
        this.operation = result.operation;
      }
      return result;
    },
  );
  readonly transitionOperation = jest.fn(
    async (
      _transaction: PostgresTransaction,
      actorAccountId: typeof OWNER_ACCOUNT_ID,
      reservationId: typeof RESERVATION_ID,
      operationId: typeof CANCEL_OPERATION_ID,
      command: Parameters<
        CourtReservationRepository['transitionOperation']
      >[4],
    ) => {
      if (
        reservationId !== this.reservation.reservationId ||
        operationId !== this.operation?.operationId
      ) {
        throw new Error('Unexpected operation');
      }
      const result = transitionReservationOperation(
        this.reservation,
        this.operation,
        { ...command, actorAccountId },
      );
      if (result.outcome === 'transitioned') {
        this.reservation = result.reservation;
        this.operation = result.operation;
      }
      return result;
    },
  );

  async create(): Promise<CreateCourtReservationPersistenceResult> {
    throw new Error('Not used');
  }

  async findById(): Promise<null> {
    throw new Error('Not used');
  }

  async findOperationById(): Promise<null> {
    throw new Error('Not used');
  }

  async findOperationByIdempotencyKey(): Promise<null> {
    throw new Error('Not used');
  }
}

function input(
  overrides: Partial<RequestReservationCancellationInput> = {},
): RequestReservationCancellationInput {
  return Object.freeze({
    ownerAccountId: OWNER_ACCOUNT_ID,
    reservationId: RESERVATION_ID,
    operationId: CANCEL_OPERATION_ID,
    idempotencyKey: CANCEL_KEY,
    request: cancellationRequest(),
    cancellationRequestedAt: CANCELLATION_REQUESTED_AT,
    ...overrides,
  });
}

type Harness = Readonly<{
  service: ReservationCancellationService;
  repository: InMemoryCancellationRepository;
  provider: ReservationCancellationProviderPort & {
    deleteOnce: jest.Mock;
    readExact: jest.Mock;
  };
  transactions: ReservationCancellationTransactionRunner & {
    runInTransaction: jest.Mock;
  };
}>;

function harness(
  overrides: Partial<{
    deleteResult: ReservationCancellationDeleteResult;
    readResult: ReservationCancellationExactReadResult;
    deleteImplementation: () => Promise<ReservationCancellationDeleteResult>;
    readImplementation: () => Promise<ReservationCancellationExactReadResult>;
    now: () => typeof TERMINAL_AT;
  }> = {},
): Harness {
  const repository = new InMemoryCancellationRepository();
  const transaction = Object.freeze({ query: jest.fn() });
  const runInTransaction = jest.fn(
    async (operation: (value: PostgresTransaction) => Promise<unknown>) =>
      operation(transaction),
  );
  const transactions = {
    runInTransaction,
  } as unknown as ReservationCancellationTransactionRunner & {
    runInTransaction: jest.Mock;
  };
  const provider = {
    deleteOnce: jest.fn(
      overrides.deleteImplementation ??
        (async () =>
          overrides.deleteResult ??
          Object.freeze({ outcome: 'accepted' as const })),
    ),
    readExact: jest.fn(
      overrides.readImplementation ??
        (async () =>
          overrides.readResult ??
          Object.freeze({
            outcome: 'found' as const,
            record: Object.freeze({
              recordId: RECORD_ID,
              apiId: API_ID,
              deleted: true,
            }),
          })),
    ),
  };
  return Object.freeze({
    repository,
    provider,
    transactions,
    service: new ReservationCancellationService({
      repository,
      provider,
      transactions,
      now: overrides.now ?? (() => TERMINAL_AT),
    }),
  });
}

describe('ReservationCancellationService', () => {
  it('cancels only after one DELETE and one canonical exact deleted proof', async () => {
    const test = harness();

    const result = await test.service.request(input());

    expect(result).toMatchObject({
      outcome: 'cancelled',
      proof: 'exact_deleted',
      deleteOutcome: 'accepted',
      state: {
        reservationStatus: 'cancelled',
        operationStatus: 'confirmed',
      },
    });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    expect(test.provider.readExact).toHaveBeenCalledTimes(1);
    expect(test.provider.deleteOnce).toHaveBeenCalledWith({
      operationId: CANCEL_OPERATION_ID,
      reservationId: RESERVATION_ID,
      ownerAccountId: OWNER_ACCOUNT_ID,
      requestDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      recordId: RECORD_ID,
      apiId: API_ID,
    });
    expect(reservationHoldsCourtSlot(test.repository.reservation)).toBe(false);
    expect(test.provider).not.toHaveProperty('reschedule');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(CLIENT.phone);
    expect(serialized).not.toContain(CLIENT.fullName);
    expect(serialized).not.toContain(CLIENT.email);
    expect(serialized).not.toContain(BINDING.recordHash);
  });

  it('accepts a canonical deleted proof after an uncertain DELETE without retrying', async () => {
    const test = harness({
      deleteResult: Object.freeze({ outcome: 'unknown' }),
    });

    const result = await test.service.request(input());

    expect(result).toMatchObject({
      outcome: 'cancelled',
      proof: 'exact_deleted',
      deleteOutcome: 'unknown',
    });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    expect(test.provider.readExact).toHaveBeenCalledTimes(1);
  });

  it('uses read-only recovery after a thrown DELETE and never retries it', async () => {
    const test = harness({
      deleteImplementation: async () => {
        throw new Error('transport marker');
      },
    });

    const result = await test.service.request(input());

    expect(result.outcome).toBe('cancelled');
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    expect(test.provider.readExact).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['active record', {
      outcome: 'found' as const,
      record: { recordId: RECORD_ID, apiId: API_ID, deleted: false },
    }],
    ['wrong record', {
      outcome: 'found' as const,
      record: { recordId: RECORD_ID + 1, apiId: API_ID, deleted: true },
    }],
    ['wrong api id', {
      outcome: 'found' as const,
      record: { recordId: RECORD_ID, apiId: API_ID + 1, deleted: true },
    }],
    ['not found', { outcome: 'not_found' as const }],
    ['unknown read', { outcome: 'unknown' as const }],
  ])('holds the slot when exact proof is %s', async (_name, readResult) => {
    const test = harness({ readResult });

    const result = await test.service.request(input());

    expect(result).toMatchObject({
      outcome: 'unknown',
      reason: 'exact_deleted_proof_missing',
      state: {
        reservationStatus: 'unknown',
        operationStatus: 'unknown',
      },
    });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    expect(test.provider.readExact).toHaveBeenCalledTimes(1);
    expect(reservationHoldsCourtSlot(test.repository.reservation)).toBe(true);
  });

  it('rejects only a provider request proven not sent without exact read', async () => {
    const test = harness({
      deleteResult: Object.freeze({
        outcome: 'not_sent',
        reason: 'provider_disabled',
      }),
    });

    const result = await test.service.request(input());

    expect(result).toMatchObject({
      outcome: 'rejected',
      state: {
        reservationStatus: 'confirmed',
        operationStatus: 'rejected',
      },
    });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    expect(test.provider.readExact).not.toHaveBeenCalled();
    expect(reservationHoldsCourtSlot(test.repository.reservation)).toBe(true);
  });

  it('does not issue a second DELETE for the same key after completion', async () => {
    const test = harness();

    const first = await test.service.request(input());
    const second = await test.service.request(input());

    expect(first.outcome).toBe('cancelled');
    expect(second).toMatchObject({
      outcome: 'cancelled',
      proof: 'persisted_cancelled_state',
      deleteOutcome: 'not_reissued',
    });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    expect(test.provider.readExact).toHaveBeenCalledTimes(1);
  });

  it('does not bind a same-key retry to a different cancellationRequestedAt', async () => {
    const test = harness();

    const first = await test.service.request(input());
    const second = await test.service.request(
      input({ cancellationRequestedAt: unixEpochSeconds(1_786_000_021) }),
    );

    expect(first.outcome).toBe('cancelled');
    expect(second).toEqual({
      outcome: 'blocked',
      reason: 'idempotency_lookup_mismatch',
    });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    expect(test.provider.readExact).toHaveBeenCalledTimes(1);
  });

  it('returns in_progress for a concurrent same-key retry without another DELETE', async () => {
    let resolveDelete:
      | ((value: ReservationCancellationDeleteResult) => void)
      | undefined;
    const pendingDelete = new Promise<ReservationCancellationDeleteResult>(
      (resolve) => {
        resolveDelete = resolve;
      },
    );
    const test = harness({
      deleteImplementation: () => pendingDelete,
    });

    const first = test.service.request(input());
    await Promise.resolve();
    await Promise.resolve();
    const second = await test.service.request(input());

    expect(second).toMatchObject({ outcome: 'in_progress' });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    resolveDelete?.(Object.freeze({ outcome: 'accepted' }));
    await expect(first).resolves.toMatchObject({ outcome: 'cancelled' });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
  });

  it('rejects same-key different-client binding while the first request is pending', async () => {
    let resolveDelete:
      | ((value: ReservationCancellationDeleteResult) => void)
      | undefined;
    const pendingDelete = new Promise<ReservationCancellationDeleteResult>(
      (resolve) => {
        resolveDelete = resolve;
      },
    );
    const test = harness({ deleteImplementation: () => pendingDelete });
    const first = test.service.request(input());
    await Promise.resolve();
    await Promise.resolve();

    const second = await test.service.request(
      input({
        request: cancellationRequest(
          OWNER_ACCOUNT_ID,
          Object.freeze({ ...CLIENT, email: 'other@example.test' }),
        ),
      }),
    );

    expect(second).toEqual({
      outcome: 'blocked',
      reason: 'idempotency_key_conflict',
    });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    resolveDelete?.(Object.freeze({ outcome: 'accepted' }));
    await first;
  });

  it('blocks a different owner before provider access', async () => {
    const test = harness();

    const result = await test.service.request(
      input({
        ownerAccountId: OTHER_ACCOUNT_ID,
        request: cancellationRequest(OTHER_ACCOUNT_ID),
      }),
    );

    expect(result).toEqual({
      outcome: 'blocked',
      reason: 'ownership_conflict',
    });
    expect(test.provider.deleteOnce).not.toHaveBeenCalled();
    expect(test.provider.readExact).not.toHaveBeenCalled();
  });

  it('fails closed before provider access when persisted binding is missing', async () => {
    const test = harness();
    const { providerBinding: _providerBinding, ...withoutBinding } =
      test.repository.reservation;
    test.repository.reservation = Object.freeze(withoutBinding);

    const result = await test.service.request(input());

    expect(result).toMatchObject({
      outcome: 'unknown',
      reason: 'persistence_unconfirmed',
      state: {
        reservationStatus: 'unknown',
        operationStatus: 'unknown',
      },
    });
    expect(test.provider.deleteOnce).not.toHaveBeenCalled();
    expect(test.provider.readExact).not.toHaveBeenCalled();
    expect(reservationHoldsCourtSlot(test.repository.reservation)).toBe(true);
  });

  it('fails closed before provider access when persisted record ID is invalid', async () => {
    const test = harness();
    test.repository.reservation = Object.freeze({
      ...test.repository.reservation,
      providerBinding: Object.freeze({
        ...BINDING,
        recordId: 0,
      }),
    });

    const result = await test.service.request(input());

    expect(result).toMatchObject({
      outcome: 'unknown',
      reason: 'persistence_unconfirmed',
      state: {
        reservationStatus: 'unknown',
        operationStatus: 'unknown',
      },
    });
    expect(test.provider.deleteOnce).not.toHaveBeenCalled();
    expect(test.provider.readExact).not.toHaveBeenCalled();
  });

  it('blocks invalid request binding before transaction and provider access', async () => {
    const test = harness();
    const invalid = {
      ...input(),
      request: {
        ...cancellationRequest(),
        type: 'reschedule',
        target: TARGET,
      },
    } as unknown as RequestReservationCancellationInput;

    const result = await test.service.request(invalid);

    expect(result).toEqual({
      outcome: 'blocked',
      reason: 'invalid_input',
    });
    expect(test.transactions.runInTransaction).not.toHaveBeenCalled();
    expect(test.provider.deleteOnce).not.toHaveBeenCalled();
  });

  it('fails closed when persistence cannot start the operation', async () => {
    const test = harness();
    test.transactions.runInTransaction.mockRejectedValueOnce(
      new Error('database marker'),
    );

    const result = await test.service.request(input());

    expect(result).toEqual({
      outcome: 'blocked',
      reason: 'persistence_unavailable',
    });
    expect(test.provider.deleteOnce).not.toHaveBeenCalled();
    expect(test.provider.readExact).not.toHaveBeenCalled();
  });

  it('returns unknown without retry when terminal persistence fails', async () => {
    const test = harness();
    test.repository.transitionOperation.mockRejectedValueOnce(
      new Error('transition marker'),
    );

    const result = await test.service.request(input());

    expect(result).toMatchObject({
      outcome: 'unknown',
      reason: 'persistence_unconfirmed',
      state: {
        reservationStatus: 'cancel_pending',
        operationStatus: 'pending',
      },
    });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    expect(test.provider.readExact).toHaveBeenCalledTimes(1);
    expect(reservationHoldsCourtSlot(test.repository.reservation)).toBe(true);
  });

  it('treats an invalid provider result as unknown and performs readback only', async () => {
    const test = harness();
    test.provider.deleteOnce.mockResolvedValueOnce({
      outcome: 'accepted',
      unexpected: true,
    });
    test.provider.readExact.mockResolvedValueOnce({ outcome: 'unknown' });

    const result = await test.service.request(input());

    expect(result).toMatchObject({
      outcome: 'unknown',
      reason: 'delete_outcome_unknown',
    });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    expect(test.provider.readExact).toHaveBeenCalledTimes(1);
  });

  it('does not accept extra provider fields as canonical deleted proof', async () => {
    const test = harness();
    test.provider.readExact.mockResolvedValueOnce({
      outcome: 'found',
      record: {
        recordId: RECORD_ID,
        apiId: API_ID,
        deleted: true,
        client: CLIENT,
      },
    });

    const result = await test.service.request(input());

    expect(result).toMatchObject({
      outcome: 'unknown',
      reason: 'exact_deleted_proof_missing',
    });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    expect(test.provider.readExact).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(CLIENT.phone);
  });

  it.each([
    ['missing record', { outcome: 'found' }],
    [
      'contradictory outer field',
      {
        outcome: 'found',
        record: {
          recordId: RECORD_ID,
          apiId: API_ID,
          deleted: true,
        },
        ambiguous: true,
      },
    ],
  ])('does not accept %s around exact-read proof', async (_name, readResult) => {
    const test = harness();
    test.provider.readExact.mockResolvedValueOnce(readResult);

    const result = await test.service.request(input());

    expect(result).toMatchObject({
      outcome: 'unknown',
      reason: 'exact_deleted_proof_missing',
    });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    expect(test.provider.readExact).toHaveBeenCalledTimes(1);
    expect(reservationHoldsCourtSlot(test.repository.reservation)).toBe(true);
  });

  it.each([
    [{ outcome: 'not_sent', reason: 'provider_rejected' }],
    [{ outcome: 'not_sent', reason: 'provider_disabled', extra: true }],
    [{ outcome: 'rejected', reason: 'provider_disabled' }],
  ])('treats malformed no-send result %p as unknown and reads back', async (deleteResult) => {
    const test = harness({
      readResult: Object.freeze({ outcome: 'unknown' }),
    });
    test.provider.deleteOnce.mockResolvedValueOnce(deleteResult);

    const result = await test.service.request(input());

    expect(result).toMatchObject({
      outcome: 'unknown',
      reason: 'delete_outcome_unknown',
    });
    expect(test.provider.deleteOnce).toHaveBeenCalledTimes(1);
    expect(test.provider.readExact).toHaveBeenCalledTimes(1);
  });
});
