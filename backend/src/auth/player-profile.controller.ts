import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
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
import { PlayerProfileService } from './player-profile.service';
import {
  OwnPlayerProfile,
  ReadOwnPlayerProfileResult,
  isOwnPlayerProfile,
} from './player-profile.types';

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
    ReadOwnPlayerProfileResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): HttpException {
  switch (reason) {
    case 'profile_not_found':
      return publicError(
        HttpStatus.NOT_FOUND,
        'profile_not_found',
        'Profile was not found',
      );
    case 'temporary_unavailable':
      return publicError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'profile_service_unavailable',
        'Profile service is unavailable',
      );
    case 'invalid_request':
    case 'internal_failure':
      return publicError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'profile_internal_error',
        'Profile request failed',
      );
  }
}

function disableCaching(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

@Controller('profile')
export class PlayerProfileController {
  constructor(private readonly service: PlayerProfileService) {}

  @Get('me')
  @UseGuards(SessionBearerGuard)
  async me(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OwnPlayerProfile> {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw rejection('internal_failure');
    }

    let result;
    try {
      result = await this.service.readOwnProfile({
        accountId: principal.accountId,
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
    if (result.outcome === 'rejected') {
      throw rejection(result.reason);
    }
    if (
      result.outcome !== 'found' ||
      Object.keys(result).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(result, 'profile') ||
      !isOwnPlayerProfile(result.profile)
    ) {
      throw rejection('internal_failure');
    }
    return result.profile;
  }
}
