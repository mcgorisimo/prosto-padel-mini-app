import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
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
import { BackendDomainEventLogger } from '../common/logging/backend-domain-event.logger';
import {
  readCreateMatchRequest,
  readMatchActionRequest,
  readMatchFeedRequest,
  readMatchId,
  readUpdateMatchDescriptionRequest,
} from './match-api.http';
import { MatchApiService } from './match-api.service';
import { MatchApiRejection } from './match-api.types';

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

function rejection(reason: MatchApiRejection): HttpException {
  switch (reason) {
    case 'invalid_request':
      return publicError(
        HttpStatus.BAD_REQUEST,
        'match_invalid_request',
        'Match request is invalid',
      );
    case 'forbidden':
      return publicError(
        HttpStatus.FORBIDDEN,
        'match_forbidden',
        'Match operation is not allowed',
      );
    case 'match_not_found':
      return publicError(
        HttpStatus.NOT_FOUND,
        'match_not_found',
        'Match was not found',
      );
    case 'match_closed':
      return publicError(
        HttpStatus.CONFLICT,
        'match_closed',
        'Match is closed',
      );
    case 'match_not_joinable':
      return publicError(
        HttpStatus.CONFLICT,
        'match_not_joinable',
        'Match cannot be joined',
      );
    case 'match_started':
      return publicError(
        HttpStatus.CONFLICT,
        'match_started',
        'Match has already started',
      );
    case 'content_not_allowed':
      return publicError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'match_content_not_allowed',
        'Match comment contains disallowed language',
      );
    case 'rating_verification_required':
      return publicError(
        HttpStatus.FORBIDDEN,
        'match_rating_verification_required',
        'Verified player profile is required for rating matches',
      );
    case 'rating_out_of_range':
      return publicError(
        HttpStatus.CONFLICT,
        'match_rating_out_of_range',
        'Player rating is outside the match range',
      );
    case 'owner_cannot_join':
      return publicError(
        HttpStatus.CONFLICT,
        'match_owner_cannot_join',
        'Match owner already occupies the owner slot',
      );
    case 'already_joined':
      return publicError(
        HttpStatus.CONFLICT,
        'match_already_joined',
        'Player has already joined the match',
      );
    case 'invitation_pending':
      return publicError(
        HttpStatus.CONFLICT,
        'match_invitation_pending',
        'Respond to the pending invitation before joining',
      );
    case 'match_full':
      return publicError(
        HttpStatus.CONFLICT,
        'match_full',
        'Match has no available slots',
      );
    case 'participant_not_active':
      return publicError(
        HttpStatus.CONFLICT,
        'match_participant_not_active',
        'Player is not an active match participant',
      );
    case 'request_conflict':
      return publicError(
        HttpStatus.CONFLICT,
        'match_request_conflict',
        'Match request conflicts with an earlier request',
      );
    case 'match_conflict':
      return publicError(
        HttpStatus.CONFLICT,
        'match_conflict',
        'Match was changed by another request',
      );
    case 'temporary_unavailable':
      return publicError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'match_service_unavailable',
        'Match service is unavailable',
      );
    case 'internal_failure':
      return publicError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'match_internal_error',
        'Match request failed',
      );
  }
}

function disableCaching(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

function principal(request: FastifyRequest) {
  const value = readAuthenticatedSessionPrincipal(request);
  if (value === undefined) {
    throw rejection('internal_failure');
  }
  return value;
}

function serviceFailure(): never {
  throw rejection('internal_failure');
}

@Controller('matches')
export class MatchController {
  constructor(
    private readonly service: MatchApiService,
    private readonly domainEvents: BackendDomainEventLogger,
  ) {}

  @Post()
  @UseGuards(SessionBearerGuard)
  async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const parsed = readCreateMatchRequest(body);
    if (parsed === undefined) {
      throw rejection('invalid_request');
    }
    const actor = principal(request);
    let result;
    try {
      result = await this.service.create({
        accountId: actor.accountId,
        role: actor.role,
        request: parsed,
      });
    } catch {
      return serviceFailure();
    }
    if (result.outcome === 'rejected') {
      this.domainEvents.record({
        domain: 'match',
        action: 'create',
        outcome: 'rejected',
        reason: result.reason,
      });
      throw rejection(result.reason);
    }
    this.domainEvents.record({
      domain: 'match',
      action: 'create',
      outcome:
        result.persistence === 'applied' ? 'created' : 'idempotent_retry',
      matchId: result.match.matchId,
    });
    return Object.freeze({ match: result.match });
  }

  @Get()
  @UseGuards(SessionBearerGuard)
  async list(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const parsed = readMatchFeedRequest(query);
    if (parsed === undefined) {
      throw rejection('invalid_request');
    }
    const actor = principal(request);
    let result;
    try {
      result = await this.service.list({
        accountId: actor.accountId,
        role: actor.role,
        request: parsed,
      });
    } catch {
      return serviceFailure();
    }
    if (result.outcome === 'rejected') {
      throw rejection(result.reason);
    }
    return Object.freeze({ matches: result.matches });
  }

  @Get('mine')
  @UseGuards(SessionBearerGuard)
  async listMine(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const parsed = readMatchFeedRequest(query);
    if (parsed === undefined) {
      throw rejection('invalid_request');
    }
    const actor = principal(request);
    let result;
    try {
      result = await this.service.listMine({
        accountId: actor.accountId,
        role: actor.role,
        request: parsed,
      });
    } catch {
      return serviceFailure();
    }
    if (result.outcome === 'rejected') {
      throw rejection(result.reason);
    }
    return Object.freeze({ matches: result.matches });
  }

  @Get(':matchId')
  @UseGuards(SessionBearerGuard)
  async detail(
    @Param('matchId') rawMatchId: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readMatchId(rawMatchId);
    if (matchId === undefined) {
      throw rejection('invalid_request');
    }
    const actor = principal(request);
    let result;
    try {
      result = await this.service.detail({
        accountId: actor.accountId,
        role: actor.role,
        matchId,
      });
    } catch {
      return serviceFailure();
    }
    if (result.outcome === 'rejected') {
      throw rejection(result.reason);
    }
    return Object.freeze({ match: result.match });
  }

  @Post(':matchId/join')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionBearerGuard)
  async join(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.mutate(
      'join',
      rawMatchId,
      body,
      request,
      reply,
    );
  }

  @Patch(':matchId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionBearerGuard)
  async updateDescription(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readMatchId(rawMatchId);
    const parsed = readUpdateMatchDescriptionRequest(body);
    if (matchId === undefined || parsed === undefined) {
      throw rejection('invalid_request');
    }
    const actor = principal(request);
    let result;
    try {
      result = await this.service.updateDescription({
        accountId: actor.accountId,
        role: actor.role,
        matchId,
        request: parsed,
      });
    } catch {
      return serviceFailure();
    }
    if (result.outcome === 'rejected') {
      throw rejection(result.reason);
    }
    return Object.freeze({ match: result.match });
  }

  @Post(':matchId/leave')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionBearerGuard)
  async leave(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.mutate(
      'leave',
      rawMatchId,
      body,
      request,
      reply,
    );
  }

  private async mutate(
    operation: 'join' | 'leave',
    rawMatchId: unknown,
    body: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readMatchId(rawMatchId);
    const parsed = readMatchActionRequest(body);
    if (matchId === undefined || parsed === undefined) {
      throw rejection('invalid_request');
    }
    const actor = principal(request);
    let result;
    try {
      const input = {
        accountId: actor.accountId,
        role: actor.role,
        matchId,
        request: parsed,
      };
      result =
        operation === 'join'
          ? await this.service.join(input)
          : await this.service.leave(input);
    } catch {
      return serviceFailure();
    }
    if (result.outcome === 'rejected') {
      this.domainEvents.record({
        domain: 'match_slot',
        action: operation,
        outcome: 'rejected',
        matchId,
        reason: result.reason,
      });
      throw rejection(result.reason);
    }
    this.domainEvents.record({
      domain: 'match_slot',
      action: operation,
      outcome:
        result.persistence === 'idempotent_retry'
          ? 'idempotent_retry'
          : operation === 'join'
            ? 'occupied'
            : 'released',
      matchId,
      slotNumber: result.participant.slotNumber,
    });
    return Object.freeze({ participant: result.participant });
  }
}
