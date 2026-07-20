import { Module } from '@nestjs/common';
import { CRM_ADAPTER } from './crm/crm.tokens';
import { DisabledCrmAdapter } from './crm/disabled-crm.adapter';

@Module({
  providers: [
    DisabledCrmAdapter,
    {
      provide: CRM_ADAPTER,
      useExisting: DisabledCrmAdapter,
    },
  ],
  exports: [CRM_ADAPTER],
})
export class IntegrationsModule {}
