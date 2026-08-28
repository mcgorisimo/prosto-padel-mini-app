import { Injectable } from '@nestjs/common';
import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  isCourtReservationId,
  isReservationTarget,
} from '../reservations/reservation.types';
import { PostgresTransaction } from './postgres-transaction';
import {
  YclientsNotificationReconciliationCandidate,
  YclientsNotificationReconciliationRepository,
} from './yclients-notification-reconciliation.repository';

const CLAIM_SQL = `
  WITH candidate AS MATERIALIZED (
    SELECT reservation.reservation_id, reservation.owner_account_id,
      reservation.version AS reservation_version,
      reservation.yclients_company_id AS company_id,
      reservation.yclients_record_id AS record_id,
      reservation.target_service_id AS service_id,
      reservation.target_resource_id AS court_id,
      reservation.target_datetime_text AS starts_at,
      reservation.target_end_datetime_text AS ends_at
    FROM backend_reservation.court_reservations AS reservation
    LEFT JOIN backend_notification.yclients_reconciliation_leases AS lease
      ON lease.reservation_id=reservation.reservation_id
    WHERE reservation.status='confirmed'
      AND reservation.target_datetime > to_timestamp($2)
      AND reservation.target_datetime <= to_timestamp($4)
      AND reservation.yclients_appointment_id IS NOT NULL
      AND reservation.yclients_record_id IS NOT NULL
      AND reservation.yclients_record_hash_ciphertext IS NOT NULL
      AND reservation.yclients_record_hash_nonce IS NOT NULL
      AND reservation.yclients_record_hash_auth_tag IS NOT NULL
      AND reservation.yclients_record_hash_digest IS NOT NULL
      AND (lease.reservation_id IS NULL OR lease.lease_until <= $2)
      AND (
        lease.last_checked_at IS NULL
        OR lease.last_checked_at <= $2-$5
      )
    ORDER BY reservation.target_datetime, reservation.reservation_id
    FOR UPDATE OF reservation SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    INSERT INTO backend_notification.yclients_reconciliation_leases (
      reservation_id, lease_owner, lease_until, last_checked_at,
      created_at, updated_at, version
    )
    SELECT reservation_id,$1,$3,NULL,$2,$2,1 FROM candidate
    ON CONFLICT (reservation_id) DO UPDATE
      SET lease_owner=excluded.lease_owner,
          lease_until=excluded.lease_until,
          updated_at=excluded.updated_at,
          version=backend_notification.yclients_reconciliation_leases.version+1
      WHERE backend_notification.yclients_reconciliation_leases.lease_until <= $2
        AND (
          backend_notification.yclients_reconciliation_leases.last_checked_at IS NULL
          OR backend_notification.yclients_reconciliation_leases.last_checked_at <= $2-$5
        )
    RETURNING reservation_id
  )
  SELECT candidate.* FROM candidate
  JOIN claimed USING (reservation_id)
`;

const COMPLETE_SQL = `
  UPDATE backend_notification.yclients_reconciliation_leases
  SET lease_until=$3, last_checked_at=$3, updated_at=$3, version=version+1
  WHERE reservation_id=$1 AND lease_owner=$2 AND lease_until >= $3
  RETURNING reservation_id
`;

interface CandidateRow extends QueryResultRow {
  reservation_id: unknown;
  owner_account_id: unknown;
  reservation_version: unknown;
  company_id: unknown;
  record_id: unknown;
  service_id: unknown;
  court_id: unknown;
  starts_at: unknown;
  ends_at: unknown;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed =
    typeof value === 'string' && /^[1-9][0-9]*$/u.test(value)
      ? Number(value)
      : value;
  return Number.isSafeInteger(parsed) && Number(parsed) > 0
    ? Number(parsed)
    : undefined;
}

@Injectable()
export class PostgresYclientsNotificationReconciliationRepository implements YclientsNotificationReconciliationRepository {
  async claimNext(
    transaction: PostgresTransaction,
    input: Parameters<
      YclientsNotificationReconciliationRepository['claimNext']
    >[1],
  ): Promise<YclientsNotificationReconciliationCandidate | null> {
    if (
      !isInternalUuid(input?.leaseOwner) ||
      !isUnixEpochSeconds(input?.now) ||
      !isUnixEpochSeconds(input?.leaseUntil) ||
      !isUnixEpochSeconds(input?.horizonUntil) ||
      input.leaseUntil <= input.now ||
      input.horizonUntil <= input.now ||
      !Number.isInteger(input.minimumIntervalSeconds) ||
      input.minimumIntervalSeconds < 300 ||
      input.minimumIntervalSeconds > 900
    ) {
      throw new TypeError('YCLIENTS reconciliation claim is invalid');
    }
    const result = await transaction.query<CandidateRow>(CLAIM_SQL, [
      input.leaseOwner,
      input.now.toString(10),
      input.leaseUntil.toString(10),
      input.horizonUntil.toString(10),
      input.minimumIntervalSeconds,
    ]);
    if (result.rowCount !== result.rows.length || result.rows.length > 1) {
      throw new Error('YCLIENTS reconciliation claim state is invalid');
    }
    const row = result.rows[0];
    if (row === undefined) return null;
    const reservationVersion = positiveInteger(row.reservation_version);
    const companyId = positiveInteger(row.company_id);
    const recordId = positiveInteger(row.record_id);
    const serviceId = positiveInteger(row.service_id);
    const courtId = positiveInteger(row.court_id);
    const target = {
      serviceId,
      courtId,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    };
    if (
      !isCourtReservationId(row.reservation_id) ||
      !isAccountId(row.owner_account_id) ||
      reservationVersion === undefined ||
      companyId === undefined ||
      recordId === undefined ||
      !isReservationTarget(target)
    ) {
      throw new Error('YCLIENTS reconciliation candidate is invalid');
    }
    return Object.freeze({
      reservationId: row.reservation_id,
      ownerAccountId: row.owner_account_id,
      reservationVersion,
      companyId,
      recordId,
      target: Object.freeze(
        target as YclientsNotificationReconciliationCandidate['target'],
      ),
    });
  }

  async complete(
    transaction: PostgresTransaction,
    input: Parameters<
      YclientsNotificationReconciliationRepository['complete']
    >[1],
  ): Promise<'applied' | 'stale_lease'> {
    if (
      !isCourtReservationId(input?.reservationId) ||
      !isInternalUuid(input?.leaseOwner) ||
      !isUnixEpochSeconds(input?.now)
    ) {
      throw new TypeError('YCLIENTS reconciliation completion is invalid');
    }
    const result = await transaction.query(COMPLETE_SQL, [
      input.reservationId,
      input.leaseOwner,
      input.now.toString(10),
    ]);
    if (result.rowCount !== result.rows.length || result.rows.length > 1) {
      throw new Error('YCLIENTS reconciliation completion state is invalid');
    }
    return result.rows.length === 1 ? 'applied' : 'stale_lease';
  }
}
