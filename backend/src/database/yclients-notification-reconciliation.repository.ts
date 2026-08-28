import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  CourtReservationId,
  ReservationTarget,
} from '../reservations/reservation.types';
import { PostgresTransaction } from './postgres-transaction';

export interface YclientsNotificationReconciliationCandidate {
  readonly reservationId: CourtReservationId;
  readonly ownerAccountId: AccountId;
  readonly reservationVersion: number;
  readonly companyId: number;
  readonly recordId: number;
  readonly target: ReservationTarget;
}

export interface YclientsNotificationReconciliationRepository {
  claimNext(
    transaction: PostgresTransaction,
    input: Readonly<{
      leaseOwner: string;
      now: UnixEpochSeconds;
      leaseUntil: UnixEpochSeconds;
      horizonUntil: UnixEpochSeconds;
      minimumIntervalSeconds: number;
    }>,
  ): Promise<YclientsNotificationReconciliationCandidate | null>;

  complete(
    transaction: PostgresTransaction,
    input: Readonly<{
      reservationId: CourtReservationId;
      leaseOwner: string;
      now: UnixEpochSeconds;
    }>,
  ): Promise<'applied' | 'stale_lease'>;
}
