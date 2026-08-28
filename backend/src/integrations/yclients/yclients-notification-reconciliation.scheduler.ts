import { randomUUID } from 'node:crypto';
import {
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../../auth/auth.types';
import { PostgresCourtReservationRepository } from '../../database/postgres-court-reservation.repository';
import { PostgresMatchReservationRepository } from '../../database/postgres-match-reservation.repository';
import { PostgresTelegramNotificationIntentRepository } from '../../database/postgres-telegram-notification-intent.repository';
import { PostgresTransactionRunner } from '../../database/postgres-transaction';
import { PostgresYclientsNotificationReconciliationRepository } from '../../database/postgres-yclients-notification-reconciliation.repository';
import { YclientsNotificationReconciliationCandidate } from '../../database/yclients-notification-reconciliation.repository';
import { YclientsAdminReadClient } from './yclients-admin-read.client';

export const YCLIENTS_NOTIFICATION_RECONCILIATION_INTERVAL_MILLISECONDS = 300_000;
export const YCLIENTS_NOTIFICATION_RECONCILIATION_BATCH_LIMIT = 10;
export const YCLIENTS_NOTIFICATION_RECONCILIATION_HORIZON_SECONDS = 604_800;
export const YCLIENTS_NOTIFICATION_RECONCILIATION_LEASE_SECONDS = 60;

type ReconcileOneResult = 'none' | 'processed' | 'stop';

export class YclientsNotificationReconciliationScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(
    YclientsNotificationReconciliationScheduler.name,
  );
  private readonly leaseOwner = randomUUID();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private active = false;

  constructor(
    private readonly dependencies: Readonly<{
      enabled: boolean;
      transactions: Pick<PostgresTransactionRunner, 'runInTransaction'>;
      leases: PostgresYclientsNotificationReconciliationRepository;
      reservations: PostgresCourtReservationRepository;
      matchReservations: PostgresMatchReservationRepository;
      intents: PostgresTelegramNotificationIntentRepository;
      adminRead: Pick<YclientsAdminReadClient, 'getRecord'>;
      clock: { nowEpochSeconds(): UnixEpochSeconds };
    }>,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.dependencies.enabled) return;
    this.active = true;
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.active = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    await this.running;
  }

  async reconcileBatch(): Promise<number> {
    let processed = 0;
    for (
      let request = 0;
      request < YCLIENTS_NOTIFICATION_RECONCILIATION_BATCH_LIMIT;
      request += 1
    ) {
      const result = await this.reconcileOne();
      if (result === 'none' || result === 'stop') break;
      processed += 1;
    }
    return processed;
  }

  private async claim(): Promise<YclientsNotificationReconciliationCandidate | null> {
    const now = this.readNow();
    const leaseUntil = now + YCLIENTS_NOTIFICATION_RECONCILIATION_LEASE_SECONDS;
    const horizonUntil =
      now + YCLIENTS_NOTIFICATION_RECONCILIATION_HORIZON_SECONDS;
    if (!isUnixEpochSeconds(leaseUntil) || !isUnixEpochSeconds(horizonUntil)) {
      throw new TypeError('YCLIENTS reconciliation time window is invalid');
    }
    return this.dependencies.transactions.runInTransaction((transaction) =>
      this.dependencies.leases.claimNext(transaction, {
        leaseOwner: this.leaseOwner,
        now,
        leaseUntil,
        horizonUntil,
        minimumIntervalSeconds:
          YCLIENTS_NOTIFICATION_RECONCILIATION_INTERVAL_MILLISECONDS / 1_000,
      }),
    );
  }

  private async reconcileOne(): Promise<ReconcileOneResult> {
    const candidate = await this.claim();
    if (candidate === null) return 'none';
    let stop = false;
    try {
      const exact = await this.dependencies.adminRead.getRecord(
        candidate.recordId,
      );
      if (exact.outcome !== 'found') {
        stop = [
          'disabled',
          'unauthorized',
          'rate_limited',
          'unavailable',
          'unknown',
        ].includes(exact.outcome);
        return stop ? 'stop' : 'processed';
      }
      const record = exact.record;
      if (
        record.recordId !== candidate.recordId ||
        record.companyId !== candidate.companyId ||
        record.serviceIds.length !== 1 ||
        record.seanceLengthSeconds === undefined
      ) {
        return 'processed';
      }
      const serviceId = record.serviceIds[0];
      if (serviceId === undefined) return 'processed';
      const endsAt = new Date(
        Date.parse(record.datetime) + record.seanceLengthSeconds * 1_000,
      ).toISOString();
      const moved =
        serviceId !== candidate.target.serviceId ||
        record.resourceId !== candidate.target.courtId ||
        Date.parse(record.datetime) !== Date.parse(candidate.target.startsAt) ||
        Date.parse(endsAt) !== Date.parse(candidate.target.endsAt);
      if (!moved && !record.deleted) return 'processed';

      const observedAt = this.readNow();
      await this.dependencies.transactions.runInTransaction(
        async (transaction) => {
          const refreshed =
            await this.dependencies.reservations.applyExactRefresh(
              transaction,
              candidate.ownerAccountId,
              candidate.reservationId,
              {
                expectedVersion: candidate.reservationVersion,
                companyId: record.companyId,
                recordId: record.recordId,
                proof:
                  record.apiId === undefined
                    ? {
                        kind: record.deleted
                          ? 'exact_deleted_record'
                          : 'exact_active_record',
                      }
                    : { kind: 'external_api_id', apiId: record.apiId },
                serviceId,
                courtId: record.resourceId,
                startsAt: record.datetime,
                endsAt,
                deleted: record.deleted,
                now: observedAt,
              },
            );
          if (refreshed.outcome !== 'updated') return;
          const changed =
            refreshed.reservation.version !== candidate.reservationVersion;
          if (!changed) return;
          const match =
            await this.dependencies.matchReservations.synchronizeCanonicalRefresh(
              transaction,
              refreshed.reservation,
            );
          const bookingEvent = record.deleted
            ? 'reservation_cancelled'
            : 'reservation_rescheduled';
          await this.dependencies.intents.enqueueDirect(transaction, {
            eventKey: `${bookingEvent}:${candidate.reservationId}:${refreshed.reservation.version}`,
            eventType: bookingEvent,
            category: 'booking_updates',
            sourceId: candidate.reservationId,
            sourceVersion: refreshed.reservation.version,
            recipientAccountId: candidate.ownerAccountId,
            reservationId: candidate.reservationId,
            occurredAt: observedAt,
          });
          if (match.outcome === 'moved' && match.matchId !== undefined) {
            await this.dependencies.intents.enqueueMatchAudience(transaction, {
              eventKey: `match_schedule_changed:${candidate.reservationId}:${refreshed.reservation.version}`,
              eventType: 'match_schedule_changed',
              category: 'match_activity',
              sourceId: candidate.reservationId,
              sourceVersion: refreshed.reservation.version,
              matchId: match.matchId,
              reservationId: candidate.reservationId,
              occurredAt: observedAt,
            });
          }
        },
      );
      return 'processed';
    } catch {
      return 'stop';
    } finally {
      try {
        await this.dependencies.transactions.runInTransaction((transaction) =>
          this.dependencies.leases.complete(transaction, {
            reservationId: candidate.reservationId,
            leaseOwner: this.leaseOwner,
            now: this.readNow(),
          }),
        );
      } catch {
        this.logger.error(
          'YCLIENTS reconciliation lease completion failed safely',
        );
      }
    }
  }

  private readNow(): UnixEpochSeconds {
    const value = this.dependencies.clock.nowEpochSeconds();
    if (!isUnixEpochSeconds(value)) {
      throw new TypeError('YCLIENTS reconciliation clock is invalid');
    }
    return value;
  }

  private schedule(delay: number): void {
    if (!this.active) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = undefined;
      });
    }, delay);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      await this.reconcileBatch();
    } catch {
      this.logger.error('YCLIENTS notification reconciliation failed safely');
    } finally {
      this.schedule(YCLIENTS_NOTIFICATION_RECONCILIATION_INTERVAL_MILLISECONDS);
    }
  }
}
