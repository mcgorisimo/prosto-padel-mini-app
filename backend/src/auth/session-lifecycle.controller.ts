import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Res,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { BackendDomainEventLogger } from '../common/logging/backend-domain-event.logger';
import { isUnixEpochSeconds } from './auth.types';
import {
  SESSION_LIFECYCLE_HTTP_CLOCK,
  SYSTEM_SESSION_LIFECYCLE_HTTP_CLOCK,
  SessionLifecycleHttpClock,
  SessionLifecyclePublicError,
  SessionRefreshHttpSuccessResponse,
  createSessionRefreshHttpSuccessResponse,
  readSessionBearerCredential,
  readSessionLifecycleHttpRequest,
} from './session-lifecycle.http';
import { SessionLifecycleService } from './session-lifecycle.service';
import {
  SessionLogoutRejectionReason,
  SessionRefreshRejectionReason,
} from './session-lifecycle.types';

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

function invalidRequest(): HttpException {
  return publicError(
    HttpStatus.BAD_REQUEST,
    'session_request_invalid',
    'Session request is invalid',
  );
}

function invalidSession(): HttpException {
  return publicError(
    HttpStatus.UNAUTHORIZED,
    'session_invalid',
    'Session is invalid',
  );
}

function temporaryUnavailable(): HttpException {
  return publicError(
    HttpStatus.SERVICE_UNAVAILABLE,
    'session_service_unavailable',
    'Session service is unavailable',
  );
}

function internalFailure(): HttpException {
  return publicError(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'session_internal_error',
    'Session request failed',
  );
}

function refreshRejection(reason: SessionRefreshRejectionReason): HttpException {
  switch (reason) {
    case 'invalid_request':
      return invalidRequest();
    case 'session_refresh_reopen_required':
      return publicError(
        HttpStatus.CONFLICT,
        'session_refresh_reopen_required',
        'Session refresh cannot be recovered; reopen the Mini App',
      );
    case 'session_expired':
      return publicError(
        HttpStatus.UNAUTHORIZED,
        'session_expired',
        'Session has expired',
      );
    case 'session_invalid':
      return invalidSession();
    case 'session_request_conflict':
      return publicError(
        HttpStatus.CONFLICT,
        'session_request_conflict',
        'Session request conflicts with existing state',
      );
    case 'temporary_unavailable':
      return temporaryUnavailable();
    case 'internal_failure':
      return internalFailure();
  }
}

function logoutRejection(reason: SessionLogoutRejectionReason): HttpException {
  switch (reason) {
    case 'invalid_request':
      return invalidRequest();
    case 'session_invalid':
      return invalidSession();
    case 'session_request_conflict':
      return publicError(
        HttpStatus.CONFLICT,
        'session_request_conflict',
        'Session request conflicts with existing state',
      );
    case 'temporary_unavailable':
      return temporaryUnavailable();
    case 'internal_failure':
      return internalFailure();
  }
}

function disableCaching(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

@Controller('auth/session')
export class SessionLifecycleController {
  constructor(
    private readonly service: SessionLifecycleService,
    @Inject(SESSION_LIFECYCLE_HTTP_CLOCK)
    private readonly clock: SessionLifecycleHttpClock,
    private readonly domainEvents: BackendDomainEventLogger,
  ) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Headers('authorization') authorization: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionRefreshHttpSuccessResponse> {
    disableCaching(reply);
    const request = readSessionLifecycleHttpRequest(body);
    if (request === undefined) {
      throw invalidRequest();
    }
    const credential = readSessionBearerCredential(authorization);
    if (credential === undefined) {
      throw invalidSession();
    }

    let now;
    try {
      now = this.clock.nowEpochSeconds();
    } catch {
      throw internalFailure();
    }
    if (!isUnixEpochSeconds(now)) {
      throw internalFailure();
    }

    let result;
    try {
      result = await this.service.refresh({
        credential,
        requestKey: request.requestKey,
        now,
      });
    } catch {
      throw internalFailure();
    }
    if (result.outcome === 'rejected') {
      this.domainEvents.record({
        domain: 'auth',
        action: 'session_refresh',
        outcome: 'rejected',
        reason: result.reason,
      });
      throw refreshRejection(result.reason);
    }
    const response = createSessionRefreshHttpSuccessResponse(
      result.credential,
      result.expiresAt,
      now,
    );
    if (response === undefined) {
      throw internalFailure();
    }
    this.domainEvents.record({
      domain: 'auth',
      action: 'session_refresh',
      outcome: 'refreshed',
    });
    return response;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Headers('authorization') authorization: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    disableCaching(reply);
    const request = readSessionLifecycleHttpRequest(body);
    if (request === undefined) {
      throw invalidRequest();
    }
    const credential = readSessionBearerCredential(authorization);
    if (credential === undefined) {
      throw invalidSession();
    }

    let now;
    try {
      now = this.clock.nowEpochSeconds();
    } catch {
      throw internalFailure();
    }
    if (!isUnixEpochSeconds(now)) {
      throw internalFailure();
    }

    let result;
    try {
      result = await this.service.logout({
        credential,
        requestKey: request.requestKey,
        now,
      });
    } catch {
      throw internalFailure();
    }
    if (result.outcome === 'rejected') {
      this.domainEvents.record({
        domain: 'auth',
        action: 'session_logout',
        outcome: 'rejected',
        reason: result.reason,
      });
      throw logoutRejection(result.reason);
    }
    this.domainEvents.record({
      domain: 'auth',
      action: 'session_logout',
      outcome: 'logged_out',
    });
  }
}

export const SESSION_LIFECYCLE_HTTP_CLOCK_PROVIDER = Object.freeze({
  provide: SESSION_LIFECYCLE_HTTP_CLOCK,
  useValue: SYSTEM_SESSION_LIFECYCLE_HTTP_CLOCK,
});
