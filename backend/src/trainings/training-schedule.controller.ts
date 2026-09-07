import { Controller, Get, HttpException, HttpStatus, Query, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { readAuthenticatedSessionPrincipal, SessionBearerGuard } from '../auth/session-authentication.guard';
import { TrainingScheduleService } from './training-schedule.service';
import type { TrainingScheduleResponse } from './training-schedule.types';

@Controller('trainings')
@UseGuards(SessionBearerGuard)
export class TrainingScheduleController {
  constructor(private readonly schedule: TrainingScheduleService) {}

  @Get('schedule')
  async read(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>): Promise<TrainingScheduleResponse> {
    // The guard owns authentication and no-store headers, including failures.
    if (!readAuthenticatedSessionPrincipal(request)) {
      throw new HttpException({ statusCode: 401, code: 'session_invalid', message: 'Session is invalid' }, HttpStatus.UNAUTHORIZED);
    }
    if (Object.keys(query).length !== 0) {
      throw new HttpException({ statusCode: 400, code: 'training_schedule_invalid_request', message: 'Training schedule request is invalid' }, HttpStatus.BAD_REQUEST);
    }
    return this.schedule.read();
  }
}
