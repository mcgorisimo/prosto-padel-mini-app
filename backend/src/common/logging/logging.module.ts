import { Global, Module } from '@nestjs/common';
import { BackendMetricsController } from '../metrics/backend-metrics.controller';
import { BackendMetricsService } from '../metrics/backend-metrics.service';
import { BackendDomainEventLogger } from './backend-domain-event.logger';
import { RequestContextStore } from './request-context.store';

@Global()
@Module({
  controllers: [BackendMetricsController],
  providers: [
    BackendDomainEventLogger,
    BackendMetricsService,
    RequestContextStore,
  ],
  exports: [
    BackendDomainEventLogger,
    BackendMetricsService,
    RequestContextStore,
  ],
})
export class LoggingModule {}
