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
import { AuthenticatedSessionPrincipal } from './session-authentication.types';
import { SessionLifecyclePublicError } from './session-lifecycle.http';

export type SessionMeHttpResponse = AuthenticatedSessionPrincipal;

function internalFailure(): HttpException {
  const response: SessionLifecyclePublicError = Object.freeze({
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'session_internal_error',
    message: 'Session request failed',
  });
  return new HttpException(response, HttpStatus.INTERNAL_SERVER_ERROR);
}

@Controller('auth/session')
export class SessionAuthenticationController {
  @Get('me')
  @UseGuards(SessionBearerGuard)
  me(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): SessionMeHttpResponse {
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw internalFailure();
    }
    return principal;
  }
}
