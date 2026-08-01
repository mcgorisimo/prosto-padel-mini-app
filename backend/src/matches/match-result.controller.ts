import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import {
  SessionBearerGuard,
  readAuthenticatedSessionPrincipal,
} from '../auth/session-authentication.guard';
import { SessionLifecyclePublicError } from '../auth/session-lifecycle.http';
import { MatchResultApiRejection } from './match-result-api.types';
import {
  readResolveMatchResultRequest,
  readResultMatchId,
  readSubmitMatchResultRequest,
} from './match-result.http';
import { MatchResultService } from './match-result.service';

function publicError(statusCode: number, code: string, message: string) {
  const response: SessionLifecyclePublicError = Object.freeze({ statusCode, code, message });
  return new HttpException(response, statusCode);
}

function rejection(reason: MatchResultApiRejection) {
  const mappings: Record<MatchResultApiRejection, readonly [number, string, string]> = {
    invalid_request: [HttpStatus.BAD_REQUEST, 'match_result_invalid_request', 'Match result request is invalid'],
    forbidden: [HttpStatus.FORBIDDEN, 'match_result_forbidden', 'Match result request is forbidden'],
    match_not_found: [HttpStatus.NOT_FOUND, 'match_result_match_not_found', 'Match was not found'],
    result_not_found: [HttpStatus.NOT_FOUND, 'match_result_not_found', 'Match result was not found'],
    result_exists: [HttpStatus.CONFLICT, 'match_result_exists', 'Match result already exists'],
    match_not_finished: [HttpStatus.CONFLICT, 'match_result_too_early', 'Match has not finished yet'],
    match_closed: [HttpStatus.CONFLICT, 'match_result_match_closed', 'Match is closed'],
    participant_not_active: [HttpStatus.FORBIDDEN, 'match_result_participant_required', 'Active match participation is required'],
    lineup_incomplete: [HttpStatus.CONFLICT, 'match_result_lineup_incomplete', 'A complete lineup is required'],
    result_not_pending: [HttpStatus.CONFLICT, 'match_result_not_pending', 'Match result is not pending'],
    same_team_confirmation: [HttpStatus.FORBIDDEN, 'match_result_opponent_confirmation_required', 'An opposing team player must confirm the result'],
    submitter_cannot_dispute: [HttpStatus.FORBIDDEN, 'match_result_submitter_cannot_dispute', 'The result submitter cannot dispute it'],
    request_conflict: [HttpStatus.CONFLICT, 'match_result_request_conflict', 'Result request conflicts with an earlier request'],
    temporary_unavailable: [HttpStatus.SERVICE_UNAVAILABLE, 'match_result_service_unavailable', 'Match result service is unavailable'],
    internal_failure: [HttpStatus.INTERNAL_SERVER_ERROR, 'match_result_internal_error', 'Match result request failed'],
  };
  const [status, code, message] = mappings[reason];
  return publicError(status, code, message);
}

function principal(request: FastifyRequest) {
  const value = readAuthenticatedSessionPrincipal(request);
  if (value === undefined) throw rejection('internal_failure');
  return value;
}

function disableCaching(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

@Controller('matches/:matchId/result')
export class MatchResultController {
  constructor(private readonly service: MatchResultService) {}

  @Get()
  @UseGuards(SessionBearerGuard)
  async read(
    @Param('matchId') rawMatchId: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readResultMatchId(rawMatchId);
    if (matchId === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = await this.service.read({
      accountId: actor.accountId,
      role: actor.role,
      matchId,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({ result: result.result });
  }

  @Post('submit')
  @UseGuards(SessionBearerGuard)
  async submit(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readResultMatchId(rawMatchId);
    const parsed = readSubmitMatchResultRequest(body);
    if (matchId === undefined || parsed === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = await this.service.submit({
      accountId: actor.accountId,
      role: actor.role,
      matchId,
      request: parsed,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({ result: result.result });
  }

  @Post('confirm')
  @UseGuards(SessionBearerGuard)
  confirm(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.resolve('confirm', rawMatchId, body, request, reply);
  }

  @Post('dispute')
  @UseGuards(SessionBearerGuard)
  dispute(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.resolve('dispute', rawMatchId, body, request, reply);
  }

  private async resolve(
    operation: 'confirm' | 'dispute',
    rawMatchId: unknown,
    body: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readResultMatchId(rawMatchId);
    const parsed = readResolveMatchResultRequest(body);
    if (matchId === undefined || parsed === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = operation === 'confirm'
      ? await this.service.confirm({ accountId: actor.accountId, role: actor.role, matchId, request: parsed })
      : await this.service.dispute({ accountId: actor.accountId, role: actor.role, matchId, request: parsed });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({ result: result.result });
  }
}
