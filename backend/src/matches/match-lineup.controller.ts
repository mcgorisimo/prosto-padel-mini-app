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
import { MatchLineupApiRejection } from './match-lineup-api.types';
import {
  readAssignMatchLineupSlotRequest,
  readLineupMatchId,
  readReleaseMatchLineupSlotRequest,
} from './match-lineup.http';
import { MatchLineupService } from './match-lineup.service';

function publicError(statusCode: number, code: string, message: string) {
  const response: SessionLifecyclePublicError = Object.freeze({ statusCode, code, message });
  return new HttpException(response, statusCode);
}

function rejection(reason: MatchLineupApiRejection) {
  const mappings: Record<MatchLineupApiRejection, readonly [number, string, string]> = {
    invalid_request: [HttpStatus.BAD_REQUEST, 'match_lineup_invalid_request', 'Match lineup request is invalid'],
    forbidden: [HttpStatus.FORBIDDEN, 'match_lineup_forbidden', 'Match lineup request is forbidden'],
    match_not_found: [HttpStatus.NOT_FOUND, 'match_lineup_not_found', 'Match lineup was not found'],
    match_closed: [HttpStatus.CONFLICT, 'match_lineup_closed', 'Match lineup is closed'],
    match_started: [HttpStatus.CONFLICT, 'match_lineup_started', 'Match has already started'],
    participant_not_active: [HttpStatus.FORBIDDEN, 'match_lineup_participant_required', 'Active match participation is required'],
    lineup_locked: [HttpStatus.CONFLICT, 'match_lineup_locked', 'Match lineup is locked'],
    slot_occupied: [HttpStatus.CONFLICT, 'match_lineup_slot_occupied', 'Match lineup slot is occupied'],
    already_assigned: [HttpStatus.CONFLICT, 'match_lineup_already_assigned', 'Player already occupies this lineup slot'],
    not_assigned: [HttpStatus.CONFLICT, 'match_lineup_not_assigned', 'Player has no lineup slot'],
    request_conflict: [HttpStatus.CONFLICT, 'match_lineup_request_conflict', 'Lineup request conflicts with an earlier request'],
    temporary_unavailable: [HttpStatus.SERVICE_UNAVAILABLE, 'match_lineup_service_unavailable', 'Match lineup service is unavailable'],
    internal_failure: [HttpStatus.INTERNAL_SERVER_ERROR, 'match_lineup_internal_error', 'Match lineup request failed'],
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

@Controller('matches/:matchId/lineup')
export class MatchLineupController {
  constructor(private readonly service: MatchLineupService) {}

  @Get()
  @UseGuards(SessionBearerGuard)
  async read(
    @Param('matchId') rawMatchId: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readLineupMatchId(rawMatchId);
    if (matchId === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = await this.service.read({
      accountId: actor.accountId,
      role: actor.role,
      matchId,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({ lineup: result.lineup });
  }

  @Post('assign')
  @UseGuards(SessionBearerGuard)
  async assign(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readLineupMatchId(rawMatchId);
    const parsed = readAssignMatchLineupSlotRequest(body);
    if (matchId === undefined || parsed === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = await this.service.assign({
      accountId: actor.accountId,
      role: actor.role,
      matchId,
      request: parsed,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({ assignment: result.assignment });
  }

  @Post('release')
  @UseGuards(SessionBearerGuard)
  async release(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readLineupMatchId(rawMatchId);
    const parsed = readReleaseMatchLineupSlotRequest(body);
    if (matchId === undefined || parsed === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = await this.service.release({
      accountId: actor.accountId,
      role: actor.role,
      matchId,
      request: parsed,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({ assignment: result.assignment });
  }
}
