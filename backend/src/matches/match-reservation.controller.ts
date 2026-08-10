import {
  Body,
  Controller,
  HttpCode,
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
import { readMatchId } from './match-api.http';
import { readLinkMatchReservationRequest } from './match-reservation-api.http';
import { MatchReservationApiService } from './match-reservation-api.service';
import { LinkMatchReservationApiRejection } from './match-reservation-api.types';

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

function rejection(reason: LinkMatchReservationApiRejection): HttpException {
  const mappings: Record<
    LinkMatchReservationApiRejection,
    readonly [number, string, string]
  > = {
    invalid_request: [400, 'match_reservation_invalid_request', 'Match reservation request is invalid'],
    forbidden: [403, 'match_reservation_forbidden', 'Match reservation operation is not allowed'],
    match_not_found: [404, 'match_not_found', 'Match was not found'],
    reservation_not_found: [404, 'match_reservation_not_found', 'Reservation was not found'],
    match_terminal: [409, 'match_reservation_match_terminal', 'Match is already closed'],
    reservation_not_confirmed: [409, 'match_reservation_not_confirmed', 'Reservation is not confirmed'],
    provider_binding_missing: [409, 'match_reservation_binding_missing', 'Reservation confirmation is incomplete'],
    match_already_linked: [409, 'match_reservation_match_already_linked', 'Match already has a court reservation'],
    reservation_already_linked: [409, 'match_reservation_already_linked', 'Reservation is already linked to another match'],
    unsupported_duration: [409, 'match_reservation_duration_unsupported', 'Reservation duration is not supported by matches'],
    match_conflict: [409, 'match_reservation_conflict', 'Match reservation changed concurrently'],
    temporary_unavailable: [503, 'match_reservation_service_unavailable', 'Match reservation service is unavailable'],
    internal_failure: [500, 'match_reservation_internal_error', 'Match reservation request failed'],
  };
  const [status, code, message] = mappings[reason];
  return publicError(status, code, message);
}

@Controller('matches')
export class MatchReservationController {
  constructor(private readonly service: MatchReservationApiService) {}

  @Post(':matchId/reservation-link')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionBearerGuard)
  async link(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');
    const matchId = readMatchId(rawMatchId);
    const parsed = readLinkMatchReservationRequest(body);
    if (matchId === undefined || parsed === undefined) {
      throw rejection('invalid_request');
    }
    const actor = readAuthenticatedSessionPrincipal(request);
    if (actor === undefined) throw rejection('internal_failure');
    let result;
    try {
      result = await this.service.link({
        accountId: actor.accountId,
        role: actor.role,
        matchId,
        request: parsed,
      });
    } catch {
      throw rejection('internal_failure');
    }
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({
      persistence: result.persistence,
      ...result.courtBooking,
    });
  }
}
