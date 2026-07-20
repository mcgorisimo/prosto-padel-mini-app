import { Module } from '@nestjs/common';
import { YclientsAdapter } from './yclients.adapter';

@Module({
  providers: [YclientsAdapter],
  exports: [YclientsAdapter],
})
export class YclientsModule {}
