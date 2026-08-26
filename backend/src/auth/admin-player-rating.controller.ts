import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SessionLifecyclePublicError } from './session-lifecycle.http';
import { SessionBearerGuard, readAuthenticatedSessionPrincipal } from './session-authentication.guard';
import { AdminPlayerRatingApiRejection } from './admin-player-rating-api.types';
import { readAdminPlayerId, readAdminPlayerListRequest, readAdminPlayerSearchRequest, readSetAdminPlayerRatingStateRequest } from './admin-player-rating.http';
import { AdminPlayerRatingService } from './admin-player-rating.service';

function publicError(statusCode: number, code: string, message: string) {
  const response: SessionLifecyclePublicError = Object.freeze({ statusCode, code, message });
  return new HttpException(response, statusCode);
}

function rejection(reason: AdminPlayerRatingApiRejection) {
  const map: Record<AdminPlayerRatingApiRejection, readonly [number, string, string]> = {
    invalid_request: [HttpStatus.BAD_REQUEST, 'admin_player_rating_invalid_request', 'Administrative player rating request is invalid'],
    forbidden: [HttpStatus.FORBIDDEN, 'admin_player_rating_forbidden', 'Administrative player rating request is forbidden'],
    player_not_found: [HttpStatus.NOT_FOUND, 'admin_player_rating_player_not_found', 'Player was not found'],
    request_conflict: [HttpStatus.CONFLICT, 'admin_player_rating_request_conflict', 'Administrative player rating request conflicts with an earlier request'],
    temporary_unavailable: [HttpStatus.SERVICE_UNAVAILABLE, 'admin_player_rating_unavailable', 'Administrative player rating service is unavailable'],
    internal_failure: [HttpStatus.INTERNAL_SERVER_ERROR, 'admin_player_rating_internal_error', 'Administrative player rating request failed'],
  };
  const [status, code, message] = map[reason];
  return publicError(status, code, message);
}

function principal(request: FastifyRequest) {
  const value = readAuthenticatedSessionPrincipal(request);
  if (value === undefined) throw rejection('internal_failure');
  return value;
}

function noCache(reply: FastifyReply) {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

@Controller('admin/players')
export class AdminPlayerRatingController {
  constructor(private readonly service: AdminPlayerRatingService) {}

  @Get()
  @UseGuards(SessionBearerGuard)
  async list(
    @Query() rawQuery: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    noCache(reply);
    const parsed = readAdminPlayerListRequest(rawQuery);
    if (parsed === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = await this.service.list({ accountId: actor.accountId, role: actor.role, request: parsed });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return result.response;
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionBearerGuard)
  async search(
    @Body() rawBody: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    noCache(reply);
    const parsed = readAdminPlayerSearchRequest(rawBody);
    if (parsed === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = await this.service.list({ accountId: actor.accountId, role: actor.role, request: parsed });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return result.response;
  }

  @Post(':playerId/rating-state')
  @UseGuards(SessionBearerGuard)
  async setRatingState(
    @Param('playerId') rawPlayerId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    noCache(reply);
    const targetAccountId = readAdminPlayerId(rawPlayerId);
    const parsed = readSetAdminPlayerRatingStateRequest(body);
    if (targetAccountId === undefined || parsed === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = await this.service.setRatingState({
      accountId: actor.accountId,
      role: actor.role,
      targetAccountId,
      request: parsed,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({ state: result.state });
  }
}
