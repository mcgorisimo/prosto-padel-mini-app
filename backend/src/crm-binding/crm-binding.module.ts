import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { readYclientsApiConfiguration } from '../config/yclients-api.config';
import { IntegrationsModule } from '../integrations/integrations.module';
import { YclientsConservativeRequestLimiter } from '../integrations/yclients/yclients-request-limiter';
import { CrmBindingController } from './crm-binding.controller';
import { CrmBindingService } from './crm-binding.service';
import { ClosedCrmBindingStore } from './crm-binding.types';
import { YclientsClientLookup } from './yclients-client-lookup';
import { DatabaseModule } from '../database/database.module';
import { PostgresTransactionRunner } from '../database/postgres-transaction';
import { ManualBindingController } from './manual-binding.controller';
import { ManualBindingService } from './manual-binding.service';
import { PostgresManualBindingRepository } from './postgres-manual-binding.repository';
import { YclientsManualClientReader } from './yclients-manual-client.reader';

@Module({
  imports: [AuthModule, IntegrationsModule, DatabaseModule],
  controllers: [CrmBindingController, ManualBindingController],
  providers: [
    {
      provide: CrmBindingService,
      inject: [ConfigService, YclientsConservativeRequestLimiter],
      useFactory: (
        config: ConfigService,
        limiter: YclientsConservativeRequestLimiter,
      ) => {
        const runtime = readYclientsApiConfiguration(config);
        return new CrmBindingService({
          companyId: runtime.companyId,
          // Deliberately no env switch can enable an unimplemented SMS verifier.
          store: new ClosedCrmBindingStore(),
          lookup: new YclientsClientLookup({
            runtime,
            limiter,
            fetch: globalThis.fetch,
          }),
        });
      },
    },
    {
      provide: ManualBindingService,
      inject: [
        ConfigService,
        PostgresTransactionRunner,
        YclientsConservativeRequestLimiter,
      ],
      useFactory: (
        config: ConfigService,
        transactions: PostgresTransactionRunner,
        limiter: YclientsConservativeRequestLimiter,
      ) => {
        const runtime = readYclientsApiConfiguration(config);
        return new ManualBindingService({
          enabled: config.get('CRM_MANUAL_BINDING_ENABLED') === true,
          companyId: runtime.companyId,
          repository: new PostgresManualBindingRepository(transactions),
          emailLookup: new YclientsClientLookup({ runtime, fetch: globalThis.fetch, limiter }),
          clients: new YclientsManualClientReader({
            runtime,
            fetch: globalThis.fetch,
            limiter,
          }),
        });
      },
    },
  ],
})
export class CrmBindingModule {}
