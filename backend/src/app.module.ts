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
import { MembershipsModule } from './memberships/memberships.module';
import { TrainingsModule } from './trainings/trainings.module';
import { CrmBindingModule } from './crm-binding/crm-binding.module';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    AuthModule,
    AccountsModule,
    BookingsModule,
    MembershipsModule,
    TrainingsModule,
    CrmBindingModule,
    EventsModule,
    IntegrationsModule,
    HealthModule,
  ],
})
export class AppModule {}
