import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import {
  SessionBearerGuard,
  readAuthenticatedSessionPrincipal,
} from './session-authentication.guard';
import { SessionLifecyclePublicError } from './session-lifecycle.http';
import { PlayerInitialLevelReassessmentService } from './player-initial-level-reassessment.service';
import {
  CompleteOwnPlayerInitialLevelReassessmentResult,
  OwnPlayerInitialLevelReassessment,
  ReadOwnPlayerInitialLevelReassessmentResult,
  isOwnPlayerInitialLevelReassessment,
  readOwnPlayerInitialLevelReassessmentCompletion,
} from './player-initial-level-reassessment.types';

function publicError(
  statusCode: number,
  code: string,
  message: string,
): HttpException {
  const response: SessionLifecyclePublicError = Object.freeze({
    statusCode,
    code,
    message,
  });
  return new HttpException(response, statusCode);
}

function readRejection(
  reason: Extract<
    ReadOwnPlayerInitialLevelReassessmentResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): HttpException {
  switch (reason) {
    case 'invalid_request':
    case 'internal_failure':
      return publicError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'initial_level_reassessment_internal_error',
        'Initial level reassessment request failed',
      );
    case 'temporary_unavailable':
      return publicError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'initial_level_reassessment_unavailable',
        'Initial level reassessment is unavailable',
      );
  }
}

function completionRejection(
  reason: Extract<
    CompleteOwnPlayerInitialLevelReassessmentResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): HttpException {
  switch (reason) {
    case 'invalid_request':
      return publicError(
        HttpStatus.BAD_REQUEST,
        'initial_level_reassessment_invalid_request',
        'Initial level reassessment request is invalid',
      );
    case 'reassessment_not_eligible':
      return publicError(
        HttpStatus.CONFLICT,
        'initial_level_reassessment_not_eligible',
        'Initial level reassessment is not available',
      );
    case 'reassessment_source_conflict':
      return publicError(
        HttpStatus.CONFLICT,
        'initial_level_reassessment_source_conflict',
        'Initial level reassessment source is stale',
      );
    case 'reassessment_conflict':
      return publicError(
        HttpStatus.CONFLICT,
        'initial_level_reassessment_conflict',
        'Initial level reassessment conflicts with completed evidence',
      );
    case 'temporary_unavailable':
      return publicError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'initial_level_reassessment_unavailable',
        'Initial level reassessment is unavailable',
      );
    case 'internal_failure':
      return publicError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'initial_level_reassessment_internal_error',
        'Initial level reassessment request failed',
      );
  }
}

function disableCaching(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

@Controller('onboarding/me/initial-level-reassessment')
export class PlayerInitialLevelReassessmentController {
  constructor(
    private readonly service: PlayerInitialLevelReassessmentService,
  ) {}

  @Get()
  @UseGuards(SessionBearerGuard)
  async read(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OwnPlayerInitialLevelReassessment> {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw readRejection('internal_failure');
    }
    let result: ReadOwnPlayerInitialLevelReassessmentResult;
    try {
      result = await this.service.readOwnReassessment({
        accountId: principal.accountId,
        role: principal.role,
      });
    } catch {
      throw readRejection('internal_failure');
    }
    if (result.outcome === 'rejected') {
      throw readRejection(result.reason);
    }
    if (!isOwnPlayerInitialLevelReassessment(result.reassessment)) {
      throw readRejection('internal_failure');
    }
    return result.reassessment;
  }

  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionBearerGuard)
  async complete(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<
    Extract<OwnPlayerInitialLevelReassessment, { readonly status: 'completed' }>
  > {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw completionRejection('internal_failure');
    }
    const completion = readOwnPlayerInitialLevelReassessmentCompletion(body);
    if (completion === undefined) {
      throw completionRejection('invalid_request');
    }
    let result: CompleteOwnPlayerInitialLevelReassessmentResult;
    try {
      result = await this.service.completeOwnReassessment({
        accountId: principal.accountId,
        role: principal.role,
        completion,
      });
    } catch {
      throw completionRejection('internal_failure');
    }
    if (result.outcome === 'rejected') {
      throw completionRejection(result.reason);
    }
    if (
      !isOwnPlayerInitialLevelReassessment(result.reassessment) ||
      result.reassessment.status !== 'completed'
    ) {
      throw completionRejection('internal_failure');
    }
    return result.reassessment;
  }
}
