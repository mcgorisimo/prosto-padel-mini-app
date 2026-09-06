import { Controller, Get, HttpException, HttpStatus, Query, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { readAuthenticatedSessionPrincipal, SessionBearerGuard } from '../auth/session-authentication.guard';
import type { TrainingScheduleResponse } from './training-schedule.types';

@Controller('trainings')
@UseGuards(SessionBearerGuard)
export class TrainingScheduleController {
  @Get('schedule')
  read(@Req() request: FastifyRequest, @Query() query: Record<string, unknown>): TrainingScheduleResponse {
    // The guard owns authentication and no-store headers, including failures.
    if (!readAuthenticatedSessionPrincipal(request)) {
      throw new HttpException({ statusCode: 401, code: 'session_invalid', message: 'Session is invalid' }, HttpStatus.UNAUTHORIZED);
    }
    if (Object.keys(query).length !== 0) {
      throw new HttpException({ statusCode: 400, code: 'training_schedule_invalid_request', message: 'Training schedule request is invalid' }, HttpStatus.BAD_REQUEST);
    }
    // Intentionally no provider/DB dependency or runtime flag. A service ID
    // allowlist alone cannot override hidden events inside that service.
    return Object.freeze({ outcome: 'not_configured', sessions: Object.freeze([] as const) });
  }
}
