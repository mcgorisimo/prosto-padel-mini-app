import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { BookingsController } from './bookings.controller';

@Module({
  imports: [AuthModule, IntegrationsModule],
  controllers: [BookingsController],
})
export class BookingsModule {}
