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
import {
  TELEGRAM_LOGIN_FEATURE,
  TelegramLoginFeature,
} from './telegram-login.feature';
import {
  SYSTEM_TELEGRAM_LOGIN_HTTP_CLOCK,
  TELEGRAM_LOGIN_HTTP_CLOCK,
  TELEGRAM_SESSION_COOKIE_NAME,
  TelegramLoginHttpClock,
  TelegramLoginHttpSuccessResponse,
  TelegramLoginPublicError,
  createTelegramSessionCookie,
  readTelegramLoginHttpRequest,
} from './telegram-login.http';
import { TelegramLoginRejectionReason } from './telegram-login.types';

function publicError(
  statusCode: number,
  code: string,
  message: string,
): HttpException {
  const response: TelegramLoginPublicError = Object.freeze({
    statusCode,
    code,
    message,
  });
  return new HttpException(response, statusCode);
}

function invalidRequest(): HttpException {
  return publicError(
    HttpStatus.BAD_REQUEST,
    'telegram_login_request_invalid',
    'Telegram login request is invalid',
  );
}

function unavailable(): HttpException {
  return publicError(
    HttpStatus.SERVICE_UNAVAILABLE,
    'telegram_authentication_unavailable',
    'Telegram authentication is unavailable',
  );
}

function internalFailure(): HttpException {
  return publicError(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'telegram_authentication_internal_error',
    'Telegram authentication failed',
  );
}

function rejectionError(
  reason: TelegramLoginRejectionReason,
): HttpException {
  switch (reason) {
    case 'invalid_telegram_data':
    case 'telegram_proof_expired':
      return publicError(
        HttpStatus.UNAUTHORIZED,
        'telegram_authentication_failed',
        'Telegram authentication failed',
      );
    case 'account_unavailable':
      return publicError(
        HttpStatus.FORBIDDEN,
        'telegram_account_unavailable',
        'Telegram authentication is not permitted',
      );
    case 'proof_replayed':
      return publicError(
        HttpStatus.CONFLICT,
        'telegram_proof_replayed',
        'Telegram authentication request conflicts with existing state',
      );
    case 'request_conflict':
      return publicError(
        HttpStatus.CONFLICT,
        'telegram_authentication_conflict',
        'Telegram authentication request conflicts with existing state',
      );
    case 'temporary_conflict':
    case 'dependency_unavailable':
      return unavailable();
    case 'internal_failure':
      return internalFailure();
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

@Controller('auth/telegram')
export class TelegramLoginController {
  constructor(
    @Inject(TELEGRAM_LOGIN_FEATURE)
    private readonly feature: TelegramLoginFeature,
    @Inject(TELEGRAM_LOGIN_HTTP_CLOCK)
    private readonly clock: TelegramLoginHttpClock,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Headers('idempotency-key')
    idempotencyKeyHeader: string | readonly string[] | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TelegramLoginHttpSuccessResponse> {
    reply.header('Cache-Control', 'no-store');
    reply.header('Pragma', 'no-cache');

    const request = readTelegramLoginHttpRequest(
      body,
      idempotencyKeyHeader,
    );
    if (request === undefined) {
      throw invalidRequest();
    }
    if (!this.feature.enabled) {
      throw unavailable();
    }

    let now;
    try {
      now = this.clock.nowEpochSeconds();
    } catch {
      throw internalFailure();
    }

    let result;
    try {
      result = await this.feature.service.authenticateWithTelegram({
        rawInitData: request.initData,
        requestKey: request.requestKey,
        now,
      });
    } catch {
      throw internalFailure();
    }

    if (result.outcome === 'rejected') {
      throw rejectionError(result.reason);
    }

    const cookie = createTelegramSessionCookie(
      result.credential,
      result.expiresAt,
      now,
    );
    if (cookie === undefined) {
      throw internalFailure();
    }

    try {
      reply.setCookie(
        TELEGRAM_SESSION_COOKIE_NAME,
        cookie.credential,
        {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          expires: cookie.expires,
          maxAge: cookie.maxAge,
        },
      );
    } catch {
      throw internalFailure();
    }

    return Object.freeze({
      authenticated: true,
      sessionExpiresAt: result.expiresAt,
    });
  }
}

export const TELEGRAM_LOGIN_HTTP_CLOCK_PROVIDER = Object.freeze({
  provide: TELEGRAM_LOGIN_HTTP_CLOCK,
  useValue: SYSTEM_TELEGRAM_LOGIN_HTTP_CLOCK,
});
