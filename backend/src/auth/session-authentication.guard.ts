import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { USER_ROLES, isAccountId } from '../accounts/account.types';
import {
  UnixEpochSeconds,
  isUnixEpochSeconds,
  unixEpochSeconds,
} from './auth.types';
import {
  SessionLifecyclePublicError,
  readSessionBearerCredential,
} from './session-lifecycle.http';
import { SessionAuthenticationService } from './session-authentication.service';
import {
  AuthenticatedSessionPrincipal,
  SessionAuthenticationResult,
} from './session-authentication.types';

export const SESSION_AUTHENTICATION_CLOCK = Symbol(
  'SESSION_AUTHENTICATION_CLOCK',
);

export interface SessionAuthenticationClock {
  nowEpochSeconds(): UnixEpochSeconds;
}

export const SYSTEM_SESSION_AUTHENTICATION_CLOCK: SessionAuthenticationClock =
  Object.freeze({
    nowEpochSeconds(): UnixEpochSeconds {
      return unixEpochSeconds(Math.floor(Date.now() / 1_000));
    },
  });

const AUTHENTICATED_SESSION_PRINCIPAL = Symbol(
  'AUTHENTICATED_SESSION_PRINCIPAL',
);

type RequestWithAuthenticatedSession = FastifyRequest & {
  readonly [AUTHENTICATED_SESSION_PRINCIPAL]?: AuthenticatedSessionPrincipal;
};

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

function rejection(
  reason: Extract<
    SessionAuthenticationResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): HttpException {
  switch (reason) {
    case 'invalid_request':
    case 'session_invalid':
      return invalidSession();
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

function isPrincipal(
  value: unknown,
  now: UnixEpochSeconds,
): value is AuthenticatedSessionPrincipal {
  const expectedKeys = ['accountId', 'role', 'expiresAt'] as const;
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) &&
    isAccountId((value as AuthenticatedSessionPrincipal).accountId) &&
    USER_ROLES.includes((value as AuthenticatedSessionPrincipal).role) &&
    isUnixEpochSeconds(
      (value as AuthenticatedSessionPrincipal).expiresAt,
    ) &&
    (value as AuthenticatedSessionPrincipal).expiresAt > now
  );
}

export function readAuthenticatedSessionPrincipal(
  request: FastifyRequest,
): AuthenticatedSessionPrincipal | undefined {
  return (request as RequestWithAuthenticatedSession)[
    AUTHENTICATED_SESSION_PRINCIPAL
  ];
}

@Injectable()
export class SessionBearerGuard implements CanActivate {
  constructor(
    private readonly service: SessionAuthenticationService,
    @Inject(SESSION_AUTHENTICATION_CLOCK)
    private readonly clock: SessionAuthenticationClock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithAuthenticatedSession>();
    const reply = http.getResponse<FastifyReply>();
    disableCaching(reply);

    const credential = readSessionBearerCredential(
      request.headers.authorization,
    );
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
      result = await this.service.authenticate({ credential, now });
    } catch {
      throw internalFailure();
    }
    if (result.outcome === 'rejected') {
      throw rejection(result.reason);
    }
    if (!isPrincipal(result.principal, now)) {
      throw internalFailure();
    }

    Object.defineProperty(request, AUTHENTICATED_SESSION_PRINCIPAL, {
      value: result.principal,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return true;
  }
}

export const SESSION_AUTHENTICATION_CLOCK_PROVIDER = Object.freeze({
  provide: SESSION_AUTHENTICATION_CLOCK,
  useValue: SYSTEM_SESSION_AUTHENTICATION_CLOCK,
});
