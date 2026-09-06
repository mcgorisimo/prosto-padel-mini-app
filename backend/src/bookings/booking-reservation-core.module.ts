import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { DatabaseModule } from '../database/database.module';
import {
  BOOKING_RESERVATION_CLOCK,
  BookingReservationService,
} from './booking-reservation.service';
import {
  BOOKING_RESERVATION_DIAGNOSTIC_SINK,
  BookingReservationDiagnosticLogger,
} from './booking-reservation.diagnostics';

@Module({
  imports: [DatabaseModule, IntegrationsModule],
  exports: [BookingReservationService],
  providers: [
    BookingReservationService,
    BookingReservationDiagnosticLogger,
    {
      provide: BOOKING_RESERVATION_DIAGNOSTIC_SINK,
      useExisting: BookingReservationDiagnosticLogger,
    },
    {
      provide: BOOKING_RESERVATION_CLOCK,
      useValue: { nowEpochSeconds: () => Math.floor(Date.now() / 1_000) },
    },
  ],
})
export class BookingReservationCoreModule {}
