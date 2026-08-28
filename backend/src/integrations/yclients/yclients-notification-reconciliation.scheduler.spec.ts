import { deterministicUuid } from '../../../test/deterministic-uuid';
import { AccountId } from '../../accounts/account.types';
import { unixEpochSeconds } from '../../auth/auth.types';
import { PostgresTransaction } from '../../database/postgres-transaction';
import { CourtReservationId } from '../../reservations/reservation.types';
import { MatchId } from '../../matches/match.types';
import {
  YCLIENTS_NOTIFICATION_RECONCILIATION_BATCH_LIMIT,
  YclientsNotificationReconciliationScheduler,
} from './yclients-notification-reconciliation.scheduler';

const NOW = unixEpochSeconds(1_800_000_000);
const OWNER = deterministicUuid('yclients-notification-owner') as AccountId;
const RESERVATION = deterministicUuid(
  'yclients-notification-reservation',
) as CourtReservationId;
const MATCH = deterministicUuid('yclients-notification-match') as MatchId;
const transaction = {} as PostgresTransaction;
const target = Object.freeze({
  serviceId: 11,
  courtId: 22,
  startsAt: '2027-01-15T10:00:00+03:00',
  endsAt: '2027-01-15T11:00:00+03:00',
});
const candidate = Object.freeze({
  reservationId: RESERVATION,
  ownerAccountId: OWNER,
  reservationVersion: 1,
  companyId: 33,
  recordId: 44,
  target,
});

function exact(overrides: Record<string, unknown> = {}) {
  return Object.freeze({
    outcome: 'found' as const,
    record: Object.freeze({
      recordId: 44,
      companyId: 33,
      resourceId: 22,
      serviceIds: Object.freeze([11]),
      datetime: target.startsAt,
      seanceLengthSeconds: 3_600,
      deleted: false,
      ...overrides,
    }),
  });
}

function refreshed(status: 'confirmed' | 'cancelled' = 'confirmed') {
  return Object.freeze({
    reservationId: RESERVATION,
    ownerAccountId: OWNER,
    status,
    target,
    providerBinding: {
      provider: 'yclients' as const,
      appointmentId: 43,
      recordId: 44,
      recordHash: 'not-exposed-to-telegram',
    },
    createdAt: NOW,
    updatedAt: NOW,
    version: 2,
  });
}

function harness() {
  const claimNext = jest
    .fn()
    .mockResolvedValueOnce(candidate)
    .mockResolvedValue(null);
  const complete = jest.fn().mockResolvedValue('applied');
  const applyExactRefresh = jest.fn();
  const synchronizeCanonicalRefresh = jest.fn();
  const enqueueDirect = jest.fn();
  const enqueueMatchAudience = jest.fn();
  const getRecord = jest.fn();
  const scheduler = new YclientsNotificationReconciliationScheduler({
    enabled: false,
    transactions: { runInTransaction: (operation) => operation(transaction) },
    leases: { claimNext, complete } as never,
    reservations: { applyExactRefresh } as never,
    matchReservations: { synchronizeCanonicalRefresh } as never,
    intents: { enqueueDirect, enqueueMatchAudience } as never,
    adminRead: { getRecord },
    clock: { nowEpochSeconds: () => NOW },
  });
  return {
    scheduler,
    claimNext,
    complete,
    applyExactRefresh,
    synchronizeCanonicalRefresh,
    enqueueDirect,
    enqueueMatchAudience,
    getRecord,
  };
}

describe('YclientsNotificationReconciliationScheduler', () => {
  it('does one exact GET and makes no mutation for an unchanged binding', async () => {
    const h = harness();
    h.getRecord.mockResolvedValue(exact());
    await expect(h.scheduler.reconcileBatch()).resolves.toBe(1);
    expect(h.getRecord).toHaveBeenCalledWith(44);
    expect(h.applyExactRefresh).not.toHaveBeenCalled();
    expect(h.enqueueDirect).not.toHaveBeenCalled();
    expect(h.complete).toHaveBeenCalledTimes(1);
  });

  it('persists a moved exact record and notifies owner plus match audience', async () => {
    const h = harness();
    h.getRecord.mockResolvedValue(
      exact({
        resourceId: 23,
        datetime: '2027-01-15T12:00:00+03:00',
      }),
    );
    h.applyExactRefresh.mockResolvedValue({
      outcome: 'updated',
      reservation: refreshed(),
    });
    h.synchronizeCanonicalRefresh.mockResolvedValue({
      outcome: 'moved',
      matchId: MATCH,
    });
    await expect(h.scheduler.reconcileBatch()).resolves.toBe(1);
    expect(h.applyExactRefresh).toHaveBeenCalledTimes(1);
    expect(h.enqueueDirect).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'reservation_rescheduled',
        recipientAccountId: OWNER,
      }),
    );
    expect(h.enqueueMatchAudience).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        eventType: 'match_schedule_changed',
        matchId: MATCH,
      }),
    );
  });

  it('notifies only the owner for an exact soft-deleted reservation', async () => {
    const h = harness();
    h.getRecord.mockResolvedValue(exact({ deleted: true }));
    h.applyExactRefresh.mockResolvedValue({
      outcome: 'updated',
      reservation: refreshed('cancelled'),
    });
    h.synchronizeCanonicalRefresh.mockResolvedValue({
      outcome: 'cancelled',
      matchId: MATCH,
    });
    await h.scheduler.reconcileBatch();
    expect(h.enqueueDirect).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ eventType: 'reservation_cancelled' }),
    );
    expect(h.enqueueMatchAudience).not.toHaveBeenCalled();
  });

  it.each(['not_found', 'unknown', 'rate_limited'] as const)(
    'fails closed without list fallback or mutation for %s',
    async (outcome) => {
      const h = harness();
      h.getRecord.mockResolvedValue({ outcome });
      await h.scheduler.reconcileBatch();
      expect(h.getRecord).toHaveBeenCalledTimes(1);
      expect(h.applyExactRefresh).not.toHaveBeenCalled();
      expect(h.enqueueDirect).not.toHaveBeenCalled();
      expect(h.complete).toHaveBeenCalledTimes(1);
    },
  );

  it('enforces a hard ten-request batch budget with sequential claims', async () => {
    const h = harness();
    h.claimNext.mockReset();
    h.claimNext.mockResolvedValue(candidate);
    h.getRecord.mockResolvedValue(exact());
    await expect(h.scheduler.reconcileBatch()).resolves.toBe(
      YCLIENTS_NOTIFICATION_RECONCILIATION_BATCH_LIMIT,
    );
    expect(h.getRecord).toHaveBeenCalledTimes(10);
    expect(h.claimNext).toHaveBeenCalledTimes(10);
  });
});
