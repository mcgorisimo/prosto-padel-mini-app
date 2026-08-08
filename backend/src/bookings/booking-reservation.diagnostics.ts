import { Injectable, Logger } from '@nestjs/common';
import {
  CourtReservationId,
  ReservationOperationId,
} from '../reservations/reservation.types';

export type BookingReservationFinalizationStage =
  | 'confirm_binding'
  | 'persist_unknown'
  | 'persist_unknown_fallback';

export type BookingReservationFinalizationOutcome =
  | 'confirmed'
  | 'unknown_persisted'
  | 'transition_rejected'
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure'
  | 'unexpected_failure';

export type BookingReservationFinalizationDiagnostic = Readonly<{
  reservationId: CourtReservationId;
  operationId: ReservationOperationId;
  stage: BookingReservationFinalizationStage;
  outcome: BookingReservationFinalizationOutcome;
}>;

export interface BookingReservationDiagnosticSink {
  record(event: BookingReservationFinalizationDiagnostic): void;
}

export const BOOKING_RESERVATION_DIAGNOSTIC_SINK = Symbol(
  'BOOKING_RESERVATION_DIAGNOSTIC_SINK',
);

@Injectable()
export class BookingReservationDiagnosticLogger
  implements BookingReservationDiagnosticSink
{
  private readonly logger = new Logger('BookingReservationFinalization');

  record(event: BookingReservationFinalizationDiagnostic): void {
    this.logger.warn({
      event: 'booking_reservation_finalization',
      reservationId: event.reservationId,
      operationId: event.operationId,
      stage: event.stage,
      outcome: event.outcome,
    });
  }
}
