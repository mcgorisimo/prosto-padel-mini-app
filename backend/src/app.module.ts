import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { BookingsModule } from './bookings/bookings.module';
import { LoggingModule } from './common/logging/logging.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { IntegrationsModule } from './integrations/integrations.module';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    AuthModule,
    AccountsModule,
    BookingsModule,
    EventsModule,
    IntegrationsModule,
    HealthModule,
  ],
})
export class AppModule {}
