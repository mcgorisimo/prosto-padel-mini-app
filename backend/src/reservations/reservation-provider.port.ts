import {
  PendingReservationOperation,
  ReservationProviderRejectionReason,
  UnknownReservationOperation,
  YclientsReservationBinding,
} from './reservation.types';

export type ReservationProviderWriteResult =
  | Readonly<{
      outcome: 'confirmed';
      providerBinding?: YclientsReservationBinding;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason: ReservationProviderRejectionReason;
    }>
  | Readonly<{ outcome: 'unknown' }>;

export type ReservationProviderReconciliationResult =
  | Readonly<{
      outcome: 'confirmed';
      providerBinding?: YclientsReservationBinding;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason: ReservationProviderRejectionReason;
    }>
  | Readonly<{ outcome: 'still_unknown' }>;

/**
 * Unknown writes cannot be passed back to executeWrite. They must be resolved
 * through reconcile, so orchestration cannot blindly repeat a provider write.
 */
export interface ReservationProviderPort {
  executeWrite(
    operation: PendingReservationOperation,
  ): Promise<ReservationProviderWriteResult>;

  reconcile(
    operation: UnknownReservationOperation,
  ): Promise<ReservationProviderReconciliationResult>;
}
