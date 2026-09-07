import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import {
  readYclientsApiConfiguration,
  YCLIENTS_API_REQUEST_TIMEOUT_MILLISECONDS,
} from '../config/yclients-api.config';
import { IntegrationsModule } from '../integrations/integrations.module';
import { YclientsConservativeRequestLimiter } from '../integrations/yclients/yclients-request-limiter';
import { TrainingScheduleController } from './training-schedule.controller';
import { TrainingScheduleService } from './training-schedule.service';
import { YclientsTrainingScheduleClient } from './yclients-training-schedule.client';

@Module({
  imports: [AuthModule, IntegrationsModule],
  controllers: [TrainingScheduleController],
  providers: [
    {
      provide: YclientsTrainingScheduleClient,
      inject: [ConfigService, YclientsConservativeRequestLimiter],
      useFactory: (config: ConfigService, limiter: YclientsConservativeRequestLimiter) =>
        new YclientsTrainingScheduleClient({
          runtime: readYclientsApiConfiguration(config),
          requestTimeoutMilliseconds: YCLIENTS_API_REQUEST_TIMEOUT_MILLISECONDS,
          fetch: globalThis.fetch,
          limiter,
        }),
    },
    {
      provide: TrainingScheduleService,
      inject: [YclientsTrainingScheduleClient],
      useFactory: (provider: YclientsTrainingScheduleClient) => new TrainingScheduleService({ provider }),
    },
  ],
})
export class TrainingsModule {}
