import { Global, Module } from '@nestjs/common';
import { BackendDomainEventLogger } from './backend-domain-event.logger';
import { RequestContextStore } from './request-context.store';

@Global()
@Module({
  providers: [BackendDomainEventLogger, RequestContextStore],
  exports: [BackendDomainEventLogger, RequestContextStore],
})
export class LoggingModule {}
