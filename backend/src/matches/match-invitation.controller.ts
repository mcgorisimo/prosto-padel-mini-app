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
import {
  readCreateMatchInvitationRequest,
  readInvitationMatchId,
  readMatchInvitationActionRequest,
  readMatchInvitationId,
  readMatchInvitationListRequest,
} from './match-invitation.http';
import { MatchInvitationService } from './match-invitation.service';
import { MatchInvitationApiRejection } from './match-invitation-api.types';

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

function rejection(reason: MatchInvitationApiRejection): HttpException {
  const mappings: Record<
    MatchInvitationApiRejection,
    readonly [number, string, string]
  > = {
    invalid_request: [
      HttpStatus.BAD_REQUEST,
      'match_invitation_invalid_request',
      'Match invitation request is invalid',
    ],
    forbidden: [
      HttpStatus.FORBIDDEN,
      'match_invitation_forbidden',
      'Match invitation operation is not allowed',
    ],
    invitation_not_found: [
      HttpStatus.NOT_FOUND,
      'match_invitation_not_found',
      'Match invitation was not found',
    ],
    invitation_closed: [
      HttpStatus.CONFLICT,
      'match_invitation_closed',
      'Match invitation is already closed',
    ],
    match_not_found: [
      HttpStatus.NOT_FOUND,
      'match_not_found',
      'Match was not found',
    ],
    match_closed: [
      HttpStatus.CONFLICT,
      'match_closed',
      'Match is closed',
    ],
    match_started: [
      HttpStatus.CONFLICT,
      'match_started',
      'Match has already started',
    ],
    match_full: [
      HttpStatus.CONFLICT,
      'match_full',
      'Match has no available slots',
    ],
    slot_unavailable: [
      HttpStatus.CONFLICT,
      'match_invitation_slot_unavailable',
      'Requested match slot is unavailable',
    ],
    already_participant: [
      HttpStatus.CONFLICT,
      'match_invitation_already_participant',
      'Player already participates in the match',
    ],
    already_invited: [
      HttpStatus.CONFLICT,
      'match_invitation_already_pending',
      'Player already has a pending invitation',
    ],
    player_not_found: [
      HttpStatus.NOT_FOUND,
      'match_invitation_player_not_found',
      'Player was not found',
    ],
    rating_verification_required: [
      HttpStatus.FORBIDDEN,
      'match_rating_verification_required',
      'Verified player profile is required for rating matches',
    ],
    rating_out_of_range: [
      HttpStatus.CONFLICT,
      'match_rating_out_of_range',
      'Player rating is outside the match range',
    ],
    request_conflict: [
      HttpStatus.CONFLICT,
      'match_invitation_request_conflict',
      'Match invitation request conflicts with an earlier request',
    ],
    match_conflict: [
      HttpStatus.CONFLICT,
      'match_conflict',
      'Match was changed by another request',
    ],
    temporary_unavailable: [
      HttpStatus.SERVICE_UNAVAILABLE,
      'match_invitation_service_unavailable',
      'Match invitation service is unavailable',
    ],
    internal_failure: [
      HttpStatus.INTERNAL_SERVER_ERROR,
      'match_invitation_internal_error',
      'Match invitation request failed',
    ],
  };
  const [status, code, message] = mappings[reason];
  return publicError(status, code, message);
}

function principal(request: FastifyRequest) {
  const value = readAuthenticatedSessionPrincipal(request);
  if (value === undefined) throw rejection('internal_failure');
  return value;
}

function disableCaching(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

@Controller()
export class MatchInvitationController {
  constructor(private readonly service: MatchInvitationService) {}

  @Post('matches/:matchId/invitations')
  @UseGuards(SessionBearerGuard)
  async create(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readInvitationMatchId(rawMatchId);
    const parsed = readCreateMatchInvitationRequest(body);
    if (matchId === undefined || parsed === undefined) {
      throw rejection('invalid_request');
    }
    const actor = principal(request);
    const result = await this.service.create({
      accountId: actor.accountId,
      role: actor.role,
      matchId,
      request: parsed,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    if (result.outcome !== 'invitation_created') {
      throw rejection('internal_failure');
    }
    return Object.freeze({ invitation: result.invitation });
  }

  @Get('match-invitations')
  @UseGuards(SessionBearerGuard)
  async incoming(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const parsed = readMatchInvitationListRequest(query);
    if (parsed === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = await this.service.listIncoming({
      accountId: actor.accountId,
      role: actor.role,
      request: parsed,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({ invitations: result.invitations });
  }

  @Get('matches/:matchId/invitations')
  @UseGuards(SessionBearerGuard)
  async outgoing(
    @Param('matchId') rawMatchId: unknown,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readInvitationMatchId(rawMatchId);
    const parsed = readMatchInvitationListRequest(query);
    if (matchId === undefined || parsed === undefined) {
      throw rejection('invalid_request');
    }
    const actor = principal(request);
    const result = await this.service.listOutgoing({
      accountId: actor.accountId,
      role: actor.role,
      matchId,
      request: parsed,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({ invitations: result.invitations });
  }

  @Post('match-invitations/:invitationId/:action')
  @UseGuards(SessionBearerGuard)
  async mutate(
    @Param('invitationId') rawInvitationId: unknown,
    @Param('action') rawAction: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const invitationId = readMatchInvitationId(rawInvitationId);
    const parsed = readMatchInvitationActionRequest(body);
    if (
      invitationId === undefined ||
      parsed === undefined ||
      !['accept', 'decline', 'cancel'].includes(rawAction as string)
    ) {
      throw rejection('invalid_request');
    }
    const actor = principal(request);
    const input = {
      accountId: actor.accountId,
      role: actor.role,
      invitationId,
      request: parsed,
    };
    const result =
      rawAction === 'accept'
        ? await this.service.accept(input)
        : rawAction === 'decline'
          ? await this.service.decline(input)
          : await this.service.cancel(input);
    if (result.outcome === 'rejected') throw rejection(result.reason);
    if ('result' in result) {
      return result.result;
    }
    return Object.freeze({ invitation: result.invitation });
  }
}
