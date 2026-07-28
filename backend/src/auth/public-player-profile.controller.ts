import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
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
import { PublicPlayerProfileService } from './public-player-profile.service';
import {
  PublicPlayerProfile,
  SearchPublicPlayerProfilesResult,
  isPublicPlayerProfile,
  readPublicPlayerProfileSearchQuery,
} from './public-player-profile.types';

interface PublicPlayerProfileSearchResponse {
  readonly players: readonly PublicPlayerProfile[];
}

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

function rejection(
  reason: Extract<
    SearchPublicPlayerProfilesResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): HttpException {
  switch (reason) {
    case 'invalid_request':
      return publicError(
        HttpStatus.BAD_REQUEST,
        'player_search_invalid_request',
        'Player search request is invalid',
      );
    case 'temporary_unavailable':
      return publicError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'player_search_unavailable',
        'Player search is unavailable',
      );
    case 'internal_failure':
      return publicError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'player_search_internal_error',
        'Player search failed',
      );
  }
}

function disableCaching(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

function foundPlayers(
  result: SearchPublicPlayerProfilesResult,
): PublicPlayerProfileSearchResponse {
  if (result.outcome === 'rejected') {
    throw rejection(result.reason);
  }
  if (
    Object.keys(result).length !== 2 ||
    !Array.isArray(result.players) ||
    result.players.length > 20 ||
    !result.players.every(isPublicPlayerProfile) ||
    new Set(result.players.map((player) => player.playerId)).size !==
      result.players.length
  ) {
    throw rejection('internal_failure');
  }
  return Object.freeze({
    players: Object.freeze([...result.players]),
  });
}

@Controller('players')
export class PublicPlayerProfileController {
  constructor(private readonly service: PublicPlayerProfileService) {}

  @Get('search')
  @UseGuards(SessionBearerGuard)
  async search(
    @Query() rawQuery: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PublicPlayerProfileSearchResponse> {
    disableCaching(reply);
    const query = readPublicPlayerProfileSearchQuery(rawQuery);
    if (query === undefined) {
      throw rejection('invalid_request');
    }
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw rejection('internal_failure');
    }

    let result;
    try {
      result = await this.service.search({
        ...query,
        role: principal.role,
      });
    } catch {
      throw rejection('internal_failure');
    }
    if (
      typeof result !== 'object' ||
      result === null ||
      Array.isArray(result) ||
      typeof result.outcome !== 'string'
    ) {
      throw rejection('internal_failure');
    }
    return foundPlayers(result);
  }
}
