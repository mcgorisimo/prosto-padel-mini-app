import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { BookingReservationCoreModule } from './booking-reservation-core.module';
import { BookingsController } from './bookings.controller';

@Module({
  imports: [AuthModule, BookingReservationCoreModule, IntegrationsModule],
  controllers: [BookingsController],
})
export class BookingsModule {}
