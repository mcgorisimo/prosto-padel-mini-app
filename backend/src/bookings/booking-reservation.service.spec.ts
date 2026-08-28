import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { CourtReservationPersistenceError } from '../database/court-reservation.repository';
import { createCourtReservation, startReservationOperation, transitionReservationOperation } from '../reservations/reservation.state-machine';
import {
  CourtReservation,
  ReservationOperation,
  newReservationOperationId,
} from '../reservations/reservation.types';
import { BookingReservationService } from './booking-reservation.service';

const OWNER = deterministicUuid('booking-reservation-owner') as AccountId;
const REQUEST_KEY = deterministicUuid('booking-reservation-request');
const NOW = 1_800_000_000;
const PRIVATE_EMAIL = 'private.owner@example.test';

function confirmedReservation(overrides: Partial<CourtReservation> = {}): CourtReservation {
  return Object.freeze({
    reservationId: deterministicUuid('booking-reservation') as CourtReservation['reservationId'],
    ownerAccountId: OWNER,
    status: 'confirmed',
    target: { serviceId: 11, courtId: 22, startsAt: '2027-01-15T10:00:00+03:00', endsAt: '2027-01-15T11:00:00+03:00' },
    providerBinding: { provider: 'yclients' as const, appointmentId: 33, recordId: 44, recordHash: 'private-hash' },
    createdAt: unixEpochSeconds(NOW), updatedAt: unixEpochSeconds(NOW), version: 3,
    ...overrides,
  });
}

function confirmedCreateOperation(
  reservation: CourtReservation,
): ReservationOperation {
  const initial = createCourtReservation({
    reservationId: reservation.reservationId,
    ownerAccountId: OWNER,
    target: reservation.target,
    now: unixEpochSeconds(NOW),
  });
  const pending = startReservationOperation(initial, {
    operationId: newReservationOperationId(),
    actorAccountId: OWNER,
    idempotencyKey: REQUEST_KEY as never,
    now: unixEpochSeconds(NOW),
    request: {
      type: 'create',
      reservationId: reservation.reservationId,
      ownerAccountId: OWNER,
      externalReference: { apiId: 77 },
      client: {
        phone: '+79804440505',
        fullName: 'Andrey Player',
        email: PRIVATE_EMAIL,
      },
      target: reservation.target,
    },
  });
  if (pending.outcome !== 'started') throw new Error('invalid confirmed fixture');
  const confirmed = transitionReservationOperation(
    pending.reservation,
    pending.operation,
    {
      type: 'confirm',
      actorAccountId: OWNER,
      now: unixEpochSeconds(NOW + 1),
      providerBinding: reservation.providerBinding,
    },
  );
  if (confirmed.outcome !== 'transitioned') {
    throw new Error('invalid confirmed fixture');
  }
  return confirmed.operation;
}

function harness() {
  const tx = {};
  const transactions = { runInTransaction: jest.fn(async (operation: (value: unknown) => unknown) => operation(tx)) };
  let storedReservation: CourtReservation | null = null;
  let storedOperation: ReservationOperation | null = null;
  let currentNow = NOW;
  let providerClaimed = false;
  let reconciliationClaimed = false;
  let attemptStartedAt: number | undefined;
  let providerDispatches = 0;
  const reservations = {
    lockIdempotencyKey: jest.fn(),
    findOperationByIdempotencyKey: jest.fn(async () => storedOperation),
    findById: jest.fn(async () => storedReservation),
    listByOwner: jest.fn(async () => storedReservation === null ? [] : [storedReservation]),
    create: jest.fn(async (_tx: unknown, reservation: CourtReservation) => {
      storedReservation = reservation;
      return { outcome: 'created', reservation };
    }),
    startOperation: jest.fn(async (_tx: unknown, _actor: AccountId, _reservationId: string, input: Parameters<typeof startReservationOperation>[1]) => {
      const result = startReservationOperation(storedReservation!, input, storedOperation ?? undefined);
      if (result.outcome !== 'rejected') {
        storedReservation = result.reservation;
        storedOperation = result.operation;
      }
      return result;
    }),
    claimProviderAttempt: jest.fn(async () => {
      if (providerClaimed) return 'already_started' as const;
      providerClaimed = true;
      attemptStartedAt = currentNow;
      return 'claimed' as const;
    }),
    readProviderAttempt: jest.fn(async () => storedOperation === null ? null : ({ operationId: storedOperation.operationId, status: storedOperation.status, apiId: storedOperation.request.externalReference.apiId, createdAt: Number(storedOperation.createdAt), ...(attemptStartedAt === undefined ? {} : { startedAt: attemptStartedAt }) })),
    readLatestCreateAttempt: jest.fn(async () => storedOperation === null ? null : ({ operationId: storedOperation.operationId, status: storedOperation.status, apiId: storedOperation.request.externalReference.apiId, createdAt: Number(storedOperation.createdAt), ...(attemptStartedAt === undefined ? {} : { startedAt: attemptStartedAt }) })),
    claimUnknownCreateReconciliation: jest.fn(async () => {
      if (storedOperation === null || storedOperation.status !== 'unknown' || reconciliationClaimed) return null;
      reconciliationClaimed = true;
      return { operationId: storedOperation.operationId, status: storedOperation.status, apiId: storedOperation.request.externalReference.apiId, createdAt: Number(storedOperation.createdAt), ...(attemptStartedAt === undefined ? {} : { startedAt: attemptStartedAt }) };
    }),
    transitionOperation: jest.fn(async (_tx: unknown, _actor: AccountId, _reservationId: string, _operationId: string, command: Parameters<typeof transitionReservationOperation>[2]) => {
      const result = transitionReservationOperation(storedReservation!, storedOperation!, command);
      if (result.outcome === 'transitioned') {
        storedReservation = result.reservation;
        storedOperation = result.operation;
      }
      return result;
    }),
    finalizeStartedCreateOperation: jest.fn(async (_tx: unknown, _actor: AccountId, _reservationId: string, operation: ReservationOperation, command: Parameters<typeof transitionReservationOperation>[2]) => {
      const result = transitionReservationOperation(storedReservation!, operation, command);
      if (result.outcome === 'transitioned') {
        storedReservation = result.reservation;
        storedOperation = result.operation;
      }
      return result;
    }),
    noteReconciliationAttempt: jest.fn(),
    applyExactRefresh: jest.fn(),
  };
  const profiles = { findByAccountId: jest.fn(async () => ({ outcome: 'found', profile: { accountId: OWNER, firstName: 'Andrey', lastName: 'Player', phone: '+79804440505', normalizedEmail: PRIVATE_EMAIL, rating: 3, isVerified: false, capabilities: [] } })) };
  const availability = { listAvailableTimes: jest.fn(async () => ({ outcome: 'loaded', times: [{ datetime: '2027-01-15T10:00:00+03:00', time: '10:00', durationSeconds: 3600 }] })) };
  const booking = { createBooking: jest.fn(async (_command: unknown, guard?: () => Promise<boolean>) => {
    if (guard !== undefined && !(await guard())) return { outcome: 'not_dispatched' as const };
    providerDispatches += 1;
    return { outcome: 'created' as const, appointmentId: 33, recordId: 44, recordHash: 'private-hash' };
  }) };
  const adminRead = { getRecord: jest.fn(), listRecords: jest.fn() };
  const diagnostics = { record: jest.fn() };
  const notificationIntents = { enqueueDirect: jest.fn() };
  const matchReservations = {
    synchronizeCanonicalRefresh: jest.fn(async () => ({ outcome: 'not_linked' })),
  };
  const service = new BookingReservationService(
    transactions as never, reservations as never, matchReservations as never, profiles as never,
    availability as never, booking as never, adminRead as never,
    notificationIntents as never,
    { nowEpochSeconds: () => currentNow },
    diagnostics,
  );
  return { service, transactions, reservations, matchReservations, profiles, availability, booking, adminRead, diagnostics, notificationIntents,
    setStored(reservation: CourtReservation, operation?: ReservationOperation) { storedReservation = reservation; storedOperation = operation ?? null; },
    setNow(value: number) { currentNow = value; },
    setAttemptStartedAt(value: number | undefined) { attemptStartedAt = value; },
    providerDispatchCount() { return providerDispatches; } };
}

describe('BookingReservationService', () => {
  it('finalizes one strict provider create as confirmed with the full binding', async () => {
    const h = harness();

    await expect(h.service.create(OWNER, {
      requestKey: REQUEST_KEY,
      serviceId: 11,
      courtId: 22,
      datetime: '2027-01-15T10:00:00+03:00',
    })).resolves.toMatchObject({
      outcome: 'created',
      reservation: { status: 'confirmed', stale: false },
    });

    expect(h.providerDispatchCount()).toBe(1);
    expect(h.reservations.finalizeStartedCreateOperation).toHaveBeenCalledTimes(1);
    expect(h.reservations.finalizeStartedCreateOperation).toHaveBeenCalledWith(
      expect.anything(),
      OWNER,
      expect.any(String),
      expect.objectContaining({ status: 'pending', type: 'create' }),
      expect.objectContaining({
        type: 'confirm',
        providerBinding: {
          provider: 'yclients',
          appointmentId: 33,
          recordId: 44,
          recordHash: 'private-hash',
        },
      }),
    );
  });

  it('sources name, phone, and normalized email only from the backend profile', async () => {
    const h = harness();
    const result = await h.service.create(OWNER, { requestKey: REQUEST_KEY, serviceId: 11, courtId: 22, datetime: '2027-01-15T10:00:00+03:00' });
    expect(result.outcome).toBe('created');
    expect(h.booking.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      client: { phone: '79804440505', fullName: 'Andrey Player', email: PRIVATE_EMAIL },
    }), expect.any(Function));
    expect(JSON.stringify(result)).not.toContain(PRIVATE_EMAIL);
    expect(JSON.stringify(result)).not.toContain('79804440505');
  });

  it('fails before availability, persistence, and provider when backend profile contact is missing', async () => {
    const h = harness();
    h.profiles.findByAccountId.mockResolvedValueOnce({ outcome: 'found', profile: { accountId: OWNER, firstName: 'Andrey', rating: 3, isVerified: true, capabilities: [] } } as never);
    expect((await h.service.create(OWNER, { requestKey: REQUEST_KEY, serviceId: 11, courtId: 22, datetime: '2027-01-15T10:00:00+03:00' })).outcome).toBe('contact_incomplete');
    expect(h.booking.createBooking).not.toHaveBeenCalled();
    expect(h.availability.listAvailableTimes).not.toHaveBeenCalled();
    expect(h.reservations.create).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied email before profile or provider access', async () => {
    const h = harness();
    const result = await h.service.create(OWNER, {
      requestKey: REQUEST_KEY,
      serviceId: 11,
      courtId: 22,
      datetime: '2027-01-15T10:00:00+03:00',
      email: 'attacker@example.test',
    } as never);
    expect(result).toEqual({ outcome: 'invalid_request' });
    expect(h.profiles.findByAccountId).not.toHaveBeenCalled();
    expect(h.booking.createBooking).not.toHaveBeenCalled();
  });

  it('rejects a profile contact that cannot be rehydrated as the strict encrypted snapshot', async () => {
    const h = harness();
    h.profiles.findByAccountId.mockResolvedValueOnce({
      outcome: 'found',
      profile: {
        accountId: OWNER,
        firstName: 'Andrey',
        phone: '+79804440505\n',
        normalizedEmail: PRIVATE_EMAIL,
        rating: 3,
        isVerified: false,
        capabilities: [],
      },
    } as never);

    await expect(h.service.create(OWNER, {
      requestKey: REQUEST_KEY,
      serviceId: 11,
      courtId: 22,
      datetime: '2027-01-15T10:00:00+03:00',
    })).resolves.toEqual({ outcome: 'contact_incomplete' });
    expect(h.reservations.create).not.toHaveBeenCalled();
    expect(h.booking.createBooking).not.toHaveBeenCalled();
  });

  it('returns a terminal same-key retry without a second provider create', async () => {
    const h = harness();
    const first = await h.service.create(OWNER, { requestKey: REQUEST_KEY, serviceId: 11, courtId: 22, datetime: '2027-01-15T10:00:00+03:00' });
    const second = await h.service.create(OWNER, { requestKey: REQUEST_KEY, serviceId: 11, courtId: 22, datetime: '2027-01-15T10:00:00+03:00' });
    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('idempotent_retry');
    expect(h.booking.createBooking).toHaveBeenCalledTimes(1);
    expect(h.providerDispatchCount()).toBe(1);
    expect(h.availability.listAvailableTimes).toHaveBeenCalledTimes(1);
  });

  it('binds the idempotency contact snapshot to the backend-owned email', async () => {
    const h = harness();
    const command = { requestKey: REQUEST_KEY, serviceId: 11, courtId: 22, datetime: '2027-01-15T10:00:00+03:00' };
    expect((await h.service.create(OWNER, command)).outcome).toBe('created');
    h.profiles.findByAccountId.mockResolvedValueOnce({
      outcome: 'found',
      profile: {
        accountId: OWNER,
        firstName: 'Andrey',
        lastName: 'Player',
        phone: '+79804440505',
        normalizedEmail: 'other@example.test',
        rating: 3,
        isVerified: false,
        capabilities: [],
      },
    } as never);
    expect((await h.service.create(OWNER, command)).outcome).toBe('conflict');
    expect(h.booking.createBooking).toHaveBeenCalledTimes(1);
    expect(h.availability.listAvailableTimes).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent same-key submissions and sends one provider create', async () => {
    const h = harness();
    let release!: () => void;
    const provider = new Promise<{outcome:'created';appointmentId:number;recordId:number;recordHash:string}>((resolve) => {
      release = () => resolve({ outcome:'created', appointmentId:33, recordId:44, recordHash:'private-hash' });
    });
    h.booking.createBooking.mockImplementationOnce(async (_command, guard) => {
      if (guard !== undefined && !(await guard())) return { outcome: 'not_dispatched' as const };
      return provider;
    });
    const command = { requestKey: REQUEST_KEY, serviceId: 11, courtId: 22, datetime: '2027-01-15T10:00:00+03:00' };
    const first = h.service.create(OWNER, command);
    await new Promise((resolve) => setImmediate(resolve));
    const second = await h.service.create(OWNER, command);
    release();
    const firstResult = await first;
    expect(firstResult.outcome).toBe('created');
    expect(second.outcome).toBe('unknown');
    expect(h.booking.createBooking).toHaveBeenCalledTimes(2);
  });

  it('closes the post-dispatch crash window without a blind create retry', async () => {
    const h = harness();
    h.reservations.claimProviderAttempt.mockResolvedValueOnce('already_started' as never);
    h.setAttemptStartedAt(NOW);
    h.setNow(NOW + 121);
    const result = await h.service.create(OWNER, { requestKey: REQUEST_KEY, serviceId: 11, courtId: 22, datetime: '2027-01-15T10:00:00+03:00' });
    expect(result.outcome).toBe('unknown');
    expect(h.booking.createBooking).toHaveBeenCalledTimes(1);
    expect(h.providerDispatchCount()).toBe(0);
    expect(h.reservations.transitionOperation).toHaveBeenCalledWith(expect.anything(), OWNER, expect.any(String), expect.any(String), expect.objectContaining({ type: 'mark_unknown' }));
  });

  it('allows a safe retry when the first attempt stopped before dispatch claim', async () => {
    const h = harness();
    h.reservations.claimProviderAttempt.mockRejectedValueOnce(new Error('database unavailable'));
    const command = { requestKey: REQUEST_KEY, serviceId: 11, courtId: 22, datetime: '2027-01-15T10:00:00+03:00' };
    await expect(h.service.create(OWNER, command)).resolves.toMatchObject({ outcome: 'unavailable' });
    await expect(h.service.create(OWNER, command)).resolves.toMatchObject({ outcome: 'created' });
    expect(h.booking.createBooking).toHaveBeenCalledTimes(2);
    expect(h.providerDispatchCount()).toBe(1);
  });

  it('holds unknown after provider timeout and never retries create', async () => {
    const h = harness();
    h.booking.createBooking.mockImplementationOnce((async (_command: unknown, guard?: () => Promise<boolean>) => {
      if (guard !== undefined && !(await guard())) return { outcome: 'not_dispatched' as const };
      return { outcome: 'unknown_outcome' as const };
    }) as never);
    const result = await h.service.create(OWNER, { requestKey: REQUEST_KEY, serviceId: 11, courtId: 22, datetime: '2027-01-15T10:00:00+03:00' });
    expect(result.outcome).toBe('unknown');
    expect(h.booking.createBooking).toHaveBeenCalledTimes(1);
    expect(h.reservations.finalizeStartedCreateOperation).toHaveBeenLastCalledWith(expect.anything(), OWNER, expect.any(String), expect.objectContaining({ status: 'pending' }), expect.objectContaining({ type: 'mark_unknown' }));
  });

  it('persists unknown in a fresh transaction when post-dispatch confirm fails', async () => {
    const h = harness();
    h.reservations.finalizeStartedCreateOperation
      .mockRejectedValueOnce(new CourtReservationPersistenceError(
        'storage_failure',
        'operation_update',
        'datatype_mismatch',
      ));

    const result = await h.service.create(OWNER, {
      requestKey: REQUEST_KEY,
      serviceId: 11,
      courtId: 22,
      datetime: '2027-01-15T10:00:00+03:00',
    });

    expect(result).toMatchObject({
      outcome: 'unknown',
      reservation: { status: 'unknown', stale: true },
    });
    expect(h.booking.createBooking).toHaveBeenCalledTimes(1);
    expect(h.providerDispatchCount()).toBe(1);
    expect(h.reservations.finalizeStartedCreateOperation).toHaveBeenCalledTimes(2);
    expect(h.reservations.finalizeStartedCreateOperation).toHaveBeenLastCalledWith(
      expect.anything(),
      OWNER,
      expect.any(String),
      expect.objectContaining({ status: 'pending' }),
      expect.objectContaining({ type: 'mark_unknown' }),
    );
    expect(h.diagnostics.record).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stage: 'confirm_binding',
        outcome: 'storage_failure',
        persistenceStage: 'operation_update',
        persistenceCause: 'datatype_mismatch',
      }),
    );
    expect(h.diagnostics.record).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        stage: 'persist_unknown_fallback',
        outcome: 'unknown_persisted',
      }),
    );
  });

  it('never retries POST or leaks provider/contact data when both finalization attempts fail', async () => {
    const h = harness();
    h.reservations.finalizeStartedCreateOperation
      .mockRejectedValueOnce(new CourtReservationPersistenceError('database_unavailable', 'operation_update'))
      .mockRejectedValueOnce(new Error('private provider body private-hash 79804440505'));

    const result = await h.service.create(OWNER, {
      requestKey: REQUEST_KEY,
      serviceId: 11,
      courtId: 22,
      datetime: '2027-01-15T10:00:00+03:00',
    });

    expect(result).toMatchObject({
      outcome: 'unknown',
      reservation: { status: 'pending_confirmation', stale: true },
    });
    expect(h.booking.createBooking).toHaveBeenCalledTimes(1);
    expect(h.providerDispatchCount()).toBe(1);
    expect(h.reservations.finalizeStartedCreateOperation).toHaveBeenCalledTimes(2);
    const diagnosticJson = JSON.stringify(h.diagnostics.record.mock.calls);
    expect(diagnosticJson).toContain('database_unavailable');
    expect(diagnosticJson).toContain('unexpected_failure');
    expect(diagnosticJson).not.toContain(PRIVATE_EMAIL);
    expect(diagnosticJson).not.toContain('79804440505');
    expect(diagnosticJson).not.toContain('private-hash');
    expect(diagnosticJson).not.toContain('private provider body');
  });

  it('releases a pre-dispatch preflight failure without claiming provider effect', async () => {
    const h = harness();
    h.booking.createBooking.mockResolvedValueOnce({ outcome: 'unavailable' } as never);
    const result = await h.service.create(OWNER, { requestKey: REQUEST_KEY, serviceId: 11, courtId: 22, datetime: '2027-01-15T10:00:00+03:00' });
    expect(result.outcome).toBe('unavailable');
    expect(h.providerDispatchCount()).toBe(0);
    expect(h.reservations.claimProviderAttempt).not.toHaveBeenCalled();
    expect(h.reservations.transitionOperation).toHaveBeenLastCalledWith(expect.anything(), OWNER, expect.any(String), expect.any(String), expect.objectContaining({ type: 'reject' }));
  });

  it('keeps a dispatched provider rejection unknown because no-effect is undocumented', async () => {
    const h = harness();
    h.booking.createBooking.mockImplementationOnce((async (_command: unknown, guard?: () => Promise<boolean>) => {
      if (guard !== undefined && !(await guard())) return { outcome: 'not_dispatched' as const };
      return { outcome: 'rejected' as const };
    }) as never);
    const result = await h.service.create(OWNER, { requestKey: REQUEST_KEY, serviceId: 11, courtId: 22, datetime: '2027-01-15T10:00:00+03:00' });
    expect(result.outcome).toBe('unknown');
    expect(h.reservations.finalizeStartedCreateOperation).toHaveBeenLastCalledWith(expect.anything(), OWNER, expect.any(String), expect.objectContaining({ status: 'pending' }), expect.objectContaining({ type: 'mark_unknown' }));
  });

  it.each([
    ['admin reschedule', false, 55, '2027-01-15T12:00:00+03:00', 'confirmed'],
    ['admin cancellation', true, 22, '2027-01-15T10:00:00+03:00', 'cancelled'],
  ] as const)('applies read-only %s only after strict provider binding', async (_label, deleted, courtId, startsAt, status) => {
    const h = harness();
    const reservation = confirmedReservation();
    h.setStored(reservation, confirmedCreateOperation(reservation));
    h.adminRead.getRecord.mockResolvedValueOnce({ outcome: 'found', record: { recordId: 44, companyId: 2_079_564, resourceId: courtId, serviceIds: [11], datetime: startsAt, seanceLengthSeconds: 3600, deleted, apiId: 77 } });
    h.reservations.applyExactRefresh.mockResolvedValueOnce({ outcome: 'updated', reservation: confirmedReservation({ status, target: { ...reservation.target, courtId, startsAt, endsAt: deleted ? reservation.target.endsAt : '2027-01-15T13:00:00.000Z' } }) });
    const result = await h.service.read(OWNER, reservation.reservationId);
    expect(result).toMatchObject({ outcome: 'found', reservation: { status, courtId, stale: false } });
    expect(h.adminRead.getRecord).toHaveBeenCalledTimes(1);
    expect(h.matchReservations.synchronizeCanonicalRefresh).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reservationId: reservation.reservationId,
        status,
        target: expect.objectContaining({ courtId, startsAt }),
      }),
    );
  });

  it('accepts an exact deleted record without provider api_id after record binding', async () => {
    const h = harness();
    const reservation = confirmedReservation();
    h.setStored(reservation, confirmedCreateOperation(reservation));
    h.adminRead.getRecord.mockResolvedValueOnce({
      outcome: 'found',
      record: {
        recordId: 44,
        companyId: 2_079_564,
        resourceId: 22,
        serviceIds: [11],
        datetime: reservation.target.startsAt,
        seanceLengthSeconds: 3600,
        deleted: true,
      },
    });
    h.reservations.applyExactRefresh.mockResolvedValueOnce({
      outcome: 'updated',
      reservation: confirmedReservation({ status: 'cancelled' }),
    });

    await expect(
      h.service.read(OWNER, reservation.reservationId),
    ).resolves.toMatchObject({
      outcome: 'found',
      reservation: { status: 'cancelled', stale: false },
    });
    expect(h.reservations.applyExactRefresh).toHaveBeenCalledWith(
      expect.anything(),
      OWNER,
      reservation.reservationId,
      expect.objectContaining({
        recordId: 44,
        proof: { kind: 'exact_deleted_record' },
        deleted: true,
      }),
    );
    expect(h.matchReservations.synchronizeCanonicalRefresh).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reservationId: reservation.reservationId,
        status: 'cancelled',
      }),
    );
    expect(h.adminRead.listRecords).not.toHaveBeenCalled();
  });

  it('accepts an exact active administrator reschedule without api_id after record binding', async () => {
    const h = harness();
    const reservation = confirmedReservation();
    const startsAt = '2027-01-15T12:30:00+03:00';
    const endsAt = '2027-01-15T10:30:00.000Z';
    h.setStored(reservation, confirmedCreateOperation(reservation));
    h.adminRead.getRecord.mockResolvedValueOnce({
      outcome: 'found',
      record: {
        recordId: 44,
        companyId: 2_079_564,
        resourceId: 55,
        serviceIds: [11],
        datetime: startsAt,
        seanceLengthSeconds: 3600,
        deleted: false,
      },
    });
    h.reservations.applyExactRefresh.mockResolvedValueOnce({
      outcome: 'updated',
      reservation: confirmedReservation({
        target: {
          ...reservation.target,
          courtId: 55,
          startsAt,
          endsAt,
        },
      }),
    });

    await expect(
      h.service.read(OWNER, reservation.reservationId),
    ).resolves.toMatchObject({
      outcome: 'found',
      reservation: {
        status: 'confirmed',
        courtId: 55,
        startsAt,
        endsAt,
        stale: false,
      },
    });
    expect(h.reservations.applyExactRefresh).toHaveBeenCalledWith(
      expect.anything(),
      OWNER,
      reservation.reservationId,
      expect.objectContaining({
        expectedVersion: reservation.version,
        companyId: 2_079_564,
        recordId: 44,
        proof: { kind: 'exact_active_record' },
        courtId: 55,
        startsAt,
        endsAt,
        deleted: false,
      }),
    );
    expect(h.matchReservations.synchronizeCanonicalRefresh).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reservationId: reservation.reservationId,
        status: 'confirmed',
        target: expect.objectContaining({ courtId: 55, startsAt, endsAt }),
      }),
    );
    expect(h.adminRead.listRecords).not.toHaveBeenCalled();
  });

  it.each([
    ['different active record', false, 45],
    ['different deleted record', true, 45],
  ] as const)(
    'keeps %s without provider api_id stale',
    async (_label, deleted, recordId) => {
      const h = harness();
      const reservation = confirmedReservation();
      h.setStored(reservation, confirmedCreateOperation(reservation));
      h.adminRead.getRecord.mockResolvedValueOnce({
        outcome: 'found',
        record: {
          recordId,
          companyId: 2_079_564,
          resourceId: 22,
          serviceIds: [11],
          datetime: reservation.target.startsAt,
          seanceLengthSeconds: 3600,
          deleted,
        },
      });

      await expect(
        h.service.read(OWNER, reservation.reservationId),
      ).resolves.toMatchObject({
        outcome: 'found',
        reservation: { status: 'confirmed', stale: true },
      });
      expect(h.reservations.applyExactRefresh).not.toHaveBeenCalled();
      expect(h.reservations.noteReconciliationAttempt).toHaveBeenCalledTimes(1);
    },
  );

  it('confirms a canonical deleted record after one exact 404 and one bounded deleted list', async () => {
    const h = harness();
    const reservation = confirmedReservation();
    h.setStored(reservation, confirmedCreateOperation(reservation));
    h.adminRead.getRecord.mockResolvedValueOnce({ outcome: 'not_found' });
    h.adminRead.listRecords.mockResolvedValueOnce({
      outcome: 'loaded',
      page: 1,
      count: 50,
      totalCount: 1,
      exhaustive: true,
      records: [{
        recordId: 44,
        companyId: 2_079_564,
        resourceId: 22,
        serviceIds: [11],
        datetime: reservation.target.startsAt,
        deleted: true,
        apiId: 77,
      }],
    });
    h.reservations.applyExactRefresh.mockResolvedValueOnce({
      outcome: 'updated',
      reservation: confirmedReservation({ status: 'cancelled' }),
    });

    const result = await h.service.read(OWNER, reservation.reservationId);

    expect(result).toMatchObject({
      outcome: 'found',
      reservation: { status: 'cancelled', stale: false },
    });
    expect(h.adminRead.getRecord).toHaveBeenCalledTimes(1);
    expect(h.adminRead.listRecords).toHaveBeenCalledTimes(1);
    expect(h.adminRead.listRecords).toHaveBeenCalledWith({
      page: 1,
      count: 50,
      resourceId: 22,
      dateFrom: '2027-01-15',
      dateTo: '2027-01-15',
      withDeleted: true,
    });
    expect(h.reservations.applyExactRefresh).toHaveBeenCalledWith(
      expect.anything(),
      OWNER,
      reservation.reservationId,
      expect.objectContaining({
        recordId: 44,
        proof: { kind: 'external_api_id', apiId: 77 },
        deleted: true,
      }),
    );
    expect(h.matchReservations.synchronizeCanonicalRefresh).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reservationId: reservation.reservationId,
        status: 'cancelled',
      }),
    );
  });

  it.each([
    ['different record', 45, 1],
    ['ambiguous records', 44, 2],
  ] as const)('keeps a 404 stale for %s without false cancellation', async (_label, recordId, count) => {
    const h = harness();
    const reservation = confirmedReservation();
    h.setStored(reservation, confirmedCreateOperation(reservation));
    h.adminRead.getRecord.mockResolvedValueOnce({ outcome: 'not_found' });
    const record = {
      recordId,
      companyId: 2_079_564,
      resourceId: 22,
      serviceIds: [11],
      datetime: reservation.target.startsAt,
      deleted: true,
      apiId: 77,
    };
    h.adminRead.listRecords.mockResolvedValueOnce({
      outcome: 'loaded', page: 1, count: 50, totalCount: count,
      exhaustive: true,
      records: count === 1 ? [record] : [record, { ...record, recordId: 46 }],
    });
    const result = await h.service.read(OWNER, reservation.reservationId);
    expect(result).toMatchObject({ outcome: 'found', reservation: { status: 'confirmed', stale: true } });
    expect(h.reservations.applyExactRefresh).not.toHaveBeenCalled();
    expect(h.reservations.noteReconciliationAttempt).toHaveBeenCalledTimes(1);
    expect(h.adminRead.getRecord).toHaveBeenCalledTimes(1);
    expect(h.adminRead.listRecords).toHaveBeenCalledTimes(1);
  });

  it('does not mutate the hold when exact refresh lacks provider duration', async () => {
    const h = harness();
    const reservation = confirmedReservation();
    h.setStored(reservation);
    h.adminRead.getRecord.mockResolvedValueOnce({ outcome:'found', record:{recordId:44,companyId:2_079_564,resourceId:55,serviceIds:[11],datetime:'2027-01-15T12:00:00+03:00',deleted:false,apiId:77} });
    await expect(h.service.read(OWNER,reservation.reservationId)).resolves.toMatchObject({outcome:'found',reservation:{courtId:22,stale:true}});
    expect(h.reservations.applyExactRefresh).not.toHaveBeenCalled();
  });

  it('uses one bounded api/effect candidate scan for unknown create and never retries POST', async () => {
    const h = harness();
    const initial = createCourtReservation({ reservationId: confirmedReservation().reservationId, ownerAccountId: OWNER, target: confirmedReservation().target, now: unixEpochSeconds(NOW) });
    const pending = startReservationOperation(initial, {
      operationId: newReservationOperationId(), actorAccountId: OWNER,
      idempotencyKey: REQUEST_KEY as never, now: unixEpochSeconds(NOW),
      request: { type:'create', reservationId:initial.reservationId, ownerAccountId:OWNER, externalReference:{apiId:77}, client:{phone:'+79804440505',fullName:'Andrey Player',email:PRIVATE_EMAIL}, target:initial.target },
    });
    if (pending.outcome !== 'started') throw new Error('invalid fixture');
    const unknown = transitionReservationOperation(pending.reservation, pending.operation, {type:'mark_unknown',actorAccountId:OWNER,now:unixEpochSeconds(NOW+1)});
    if (unknown.outcome !== 'transitioned') throw new Error('invalid fixture');
    h.setStored(unknown.reservation, unknown.operation);
    h.adminRead.listRecords.mockResolvedValueOnce({outcome:'loaded',page:1,count:50,totalCount:1,exhaustive:true,records:[{recordId:44,companyId:2_079_564,resourceId:22,serviceIds:[11],datetime:initial.target.startsAt,deleted:false,apiId:77}]});
    await expect(h.service.read(OWNER,initial.reservationId)).resolves.toMatchObject({outcome:'found',reservation:{status:'unknown',stale:true}});
    expect(h.adminRead.listRecords).toHaveBeenCalledTimes(1);
    expect(h.booking.createBooking).not.toHaveBeenCalled();
    expect(h.reservations.claimUnknownCreateReconciliation).toHaveBeenCalledTimes(1);

    await expect(h.service.read(OWNER,initial.reservationId)).resolves.toMatchObject({outcome:'found',reservation:{status:'unknown',stale:true}});
    expect(h.adminRead.listRecords).toHaveBeenCalledTimes(1);
    expect(h.reservations.claimUnknownCreateReconciliation).toHaveBeenCalledTimes(2);
  });

  it('rejects and releases a stale pending create whose dispatch marker was never claimed', async () => {
    const h = harness();
    const initial = createCourtReservation({ reservationId: confirmedReservation().reservationId, ownerAccountId: OWNER, target: confirmedReservation().target, now: unixEpochSeconds(NOW) });
    const pending = startReservationOperation(initial, {
      operationId: newReservationOperationId(), actorAccountId: OWNER,
      idempotencyKey: REQUEST_KEY as never, now: unixEpochSeconds(NOW),
      request: { type:'create', reservationId:initial.reservationId, ownerAccountId:OWNER, externalReference:{apiId:77}, client:{phone:'+79804440505',fullName:'Andrey Player',email:PRIVATE_EMAIL}, target:initial.target },
    });
    if (pending.outcome !== 'started') throw new Error('invalid fixture');
    h.setStored(pending.reservation, pending.operation);
    h.setAttemptStartedAt(undefined);
    h.setNow(NOW + 121);

    await expect(h.service.read(OWNER, initial.reservationId)).resolves.toMatchObject({
      outcome: 'found',
      reservation: { status: 'rejected', stale: false },
    });
    expect(h.reservations.transitionOperation).toHaveBeenCalledWith(
      expect.anything(), OWNER, initial.reservationId, pending.operation.operationId,
      expect.objectContaining({ type:'reject', reason:'provider_not_dispatched' }),
    );
    expect(h.reservations.claimUnknownCreateReconciliation).not.toHaveBeenCalled();
    expect(h.adminRead.listRecords).not.toHaveBeenCalled();
  });

  it('moves a stale claimed pending create to unknown before one bounded scan', async () => {
    const h = harness();
    const initial = createCourtReservation({ reservationId: confirmedReservation().reservationId, ownerAccountId: OWNER, target: confirmedReservation().target, now: unixEpochSeconds(NOW) });
    const pending = startReservationOperation(initial, {
      operationId: newReservationOperationId(), actorAccountId: OWNER,
      idempotencyKey: REQUEST_KEY as never, now: unixEpochSeconds(NOW),
      request: { type:'create', reservationId:initial.reservationId, ownerAccountId:OWNER, externalReference:{apiId:77}, client:{phone:'+79804440505',fullName:'Andrey Player',email:PRIVATE_EMAIL}, target:initial.target },
    });
    if (pending.outcome !== 'started') throw new Error('invalid fixture');
    h.setStored(pending.reservation, pending.operation);
    h.setAttemptStartedAt(NOW);
    h.setNow(NOW + 121);
    h.adminRead.listRecords.mockResolvedValueOnce({outcome:'loaded',page:1,count:50,totalCount:0,exhaustive:true,records:[]});

    await expect(h.service.read(OWNER, initial.reservationId)).resolves.toMatchObject({
      outcome: 'found',
      reservation: { status: 'unknown', stale: true },
    });
    expect(h.reservations.transitionOperation).toHaveBeenCalledWith(
      expect.anything(), OWNER, initial.reservationId, pending.operation.operationId,
      expect.objectContaining({ type:'mark_unknown' }),
    );
    expect(h.reservations.claimUnknownCreateReconciliation).toHaveBeenCalledTimes(1);
    expect(h.adminRead.listRecords).toHaveBeenCalledTimes(1);
    expect(h.booking.createBooking).not.toHaveBeenCalled();
  });

  it('does not classify or scan a pending create before the bounded stale threshold', async () => {
    const h = harness();
    const initial = createCourtReservation({ reservationId: confirmedReservation().reservationId, ownerAccountId: OWNER, target: confirmedReservation().target, now: unixEpochSeconds(NOW) });
    const pending = startReservationOperation(initial, {
      operationId: newReservationOperationId(), actorAccountId: OWNER,
      idempotencyKey: REQUEST_KEY as never, now: unixEpochSeconds(NOW),
      request: { type:'create', reservationId:initial.reservationId, ownerAccountId:OWNER, externalReference:{apiId:77}, client:{phone:'+79804440505',fullName:'Andrey Player',email:PRIVATE_EMAIL}, target:initial.target },
    });
    if (pending.outcome !== 'started') throw new Error('invalid fixture');
    h.setStored(pending.reservation, pending.operation);
    h.setAttemptStartedAt(NOW);
    h.setNow(NOW + 119);

    await expect(h.service.read(OWNER, initial.reservationId)).resolves.toMatchObject({
      outcome:'found', reservation:{status:'pending_confirmation',stale:true},
    });
    expect(h.reservations.transitionOperation).not.toHaveBeenCalled();
    expect(h.reservations.claimUnknownCreateReconciliation).not.toHaveBeenCalled();
    expect(h.adminRead.listRecords).not.toHaveBeenCalled();
  });

  it('restores an owner-scoped reservation list and request-key recovery handle', async () => {
    const h = harness();
    await h.service.create(OWNER, { requestKey: REQUEST_KEY, serviceId: 11, courtId: 22, datetime: '2027-01-15T10:00:00+03:00' });
    h.adminRead.getRecord.mockResolvedValue({ outcome: 'unavailable' });
    await expect(h.service.list(OWNER)).resolves.toMatchObject({ outcome:'loaded', reservations:[{status:'confirmed'}] });
    await expect(h.service.readByRequestKey(OWNER,REQUEST_KEY)).resolves.toMatchObject({outcome:'found',reservation:{reservationId:expect.any(String)}});
    expect(h.reservations.listByOwner).toHaveBeenCalledWith(expect.anything(),OWNER,20);
  });
});
