import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
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
import { MatchWaitlistApiRejection } from './match-waitlist-api.types';
import {
  readListMatchWaitlistRequest,
  readMatchWaitlistActionRequest,
  readWaitlistMatchId,
} from './match-waitlist.http';
import { MatchWaitlistService } from './match-waitlist.service';

function publicError(statusCode: number, code: string, message: string) {
  const response: SessionLifecyclePublicError = Object.freeze({ statusCode, code, message });
  return new HttpException(response, statusCode);
}

function rejection(reason: MatchWaitlistApiRejection) {
  const mappings: Record<MatchWaitlistApiRejection, readonly [number, string, string]> = {
    invalid_request: [HttpStatus.BAD_REQUEST, 'match_waitlist_invalid_request', 'Match waitlist request is invalid'],
    forbidden: [HttpStatus.FORBIDDEN, 'match_waitlist_forbidden', 'Match waitlist request is forbidden'],
    match_not_found: [HttpStatus.NOT_FOUND, 'match_waitlist_not_found', 'Match waitlist was not found'],
    match_closed: [HttpStatus.CONFLICT, 'match_waitlist_closed', 'Match waitlist is closed'],
    match_started: [HttpStatus.CONFLICT, 'match_waitlist_started', 'Match has already started'],
    match_not_full: [HttpStatus.CONFLICT, 'match_waitlist_not_full', 'Match still has an available slot'],
    owner_cannot_join: [HttpStatus.CONFLICT, 'match_waitlist_owner', 'Match owner cannot join the waitlist'],
    already_joined: [HttpStatus.CONFLICT, 'match_waitlist_already_joined', 'Player already joined the match'],
    invitation_pending: [HttpStatus.CONFLICT, 'match_waitlist_invitation_pending', 'Player has a pending match invitation'],
    already_waiting: [HttpStatus.CONFLICT, 'match_waitlist_already_waiting', 'Player is already waiting'],
    not_waiting: [HttpStatus.CONFLICT, 'match_waitlist_not_waiting', 'Player is not waiting'],
    player_not_found: [HttpStatus.NOT_FOUND, 'match_waitlist_player_not_found', 'Player was not found'],
    rating_verification_required: [HttpStatus.CONFLICT, 'match_waitlist_verification_required', 'Verified rating is required'],
    rating_out_of_range: [HttpStatus.CONFLICT, 'match_waitlist_rating_out_of_range', 'Player rating is outside the match range'],
    request_conflict: [HttpStatus.CONFLICT, 'match_waitlist_request_conflict', 'Waitlist request conflicts with an earlier request'],
    temporary_unavailable: [HttpStatus.SERVICE_UNAVAILABLE, 'match_waitlist_service_unavailable', 'Match waitlist service is unavailable'],
    internal_failure: [HttpStatus.INTERNAL_SERVER_ERROR, 'match_waitlist_internal_error', 'Match waitlist request failed'],
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

@Controller('matches/:matchId/waitlist')
export class MatchWaitlistController {
  constructor(private readonly service: MatchWaitlistService) {}

  @Get()
  @UseGuards(SessionBearerGuard)
  async list(
    @Param('matchId') rawMatchId: unknown,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readWaitlistMatchId(rawMatchId);
    const parsed = readListMatchWaitlistRequest(query);
    if (matchId === undefined || parsed === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = await this.service.list({
      accountId: actor.accountId,
      role: actor.role,
      matchId,
      request: parsed,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({
      entries: result.entries,
      ...(result.current === undefined ? {} : { current: result.current }),
      count: result.count,
    });
  }

  @Post('join')
  @UseGuards(SessionBearerGuard)
  join(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.mutate('join', rawMatchId, body, request, reply);
  }

  @Post('leave')
  @UseGuards(SessionBearerGuard)
  leave(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.mutate('leave', rawMatchId, body, request, reply);
  }

  private async mutate(
    operation: 'join' | 'leave',
    rawMatchId: unknown,
    body: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readWaitlistMatchId(rawMatchId);
    const parsed = readMatchWaitlistActionRequest(body);
    if (matchId === undefined || parsed === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = await this.service[operation]({
      accountId: actor.accountId,
      role: actor.role,
      matchId,
      request: parsed,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({ entry: result.entry });
  }
}
