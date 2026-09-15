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

@Module({
  imports: [AuthModule, IntegrationsModule], controllers: [CrmBindingController],
  providers: [{ provide: CrmBindingService, inject: [ConfigService, YclientsConservativeRequestLimiter],
    useFactory: (config: ConfigService, limiter: YclientsConservativeRequestLimiter) => {
      const runtime = readYclientsApiConfiguration(config);
      return new CrmBindingService({ companyId: runtime.companyId,
        // Deliberately no env switch can enable an unimplemented SMS verifier.
        store: new ClosedCrmBindingStore(),
        lookup: new YclientsClientLookup({ runtime, limiter, fetch: globalThis.fetch }),
      });
    } }],
})
export class CrmBindingModule {}
