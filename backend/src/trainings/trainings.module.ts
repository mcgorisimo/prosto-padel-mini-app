import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TrainingScheduleController } from './training-schedule.controller';

@Module({ imports: [AuthModule], controllers: [TrainingScheduleController] })
export class TrainingsModule {}
