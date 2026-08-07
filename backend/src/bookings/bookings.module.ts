import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { DatabaseModule } from '../database/database.module';
import {
  BOOKING_RESERVATION_CLOCK,
  BookingReservationService,
} from './booking-reservation.service';
import { BookingsController } from './bookings.controller';

@Module({
  imports: [AuthModule, DatabaseModule, IntegrationsModule],
  controllers: [BookingsController],
  providers: [
    BookingReservationService,
    {
      provide: BOOKING_RESERVATION_CLOCK,
      useValue: { nowEpochSeconds: () => Math.floor(Date.now() / 1_000) },
    },
  ],
})
export class BookingsModule {}
