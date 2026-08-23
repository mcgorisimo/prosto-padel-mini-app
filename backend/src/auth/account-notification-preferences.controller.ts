import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SessionLifecyclePublicError } from './session-lifecycle.http';
import {
  SessionBearerGuard,
  readAuthenticatedSessionPrincipal,
} from './session-authentication.guard';
import { AccountNotificationPreferencesService } from './account-notification-preferences.service';
import {
  OwnAccountNotificationPreferences,
  OwnAccountNotificationPreferencesRejection,
  ReadOwnAccountNotificationPreferencesResult,
  UpdateOwnAccountNotificationPreferencesResult,
  isOwnAccountNotificationPreferences,
  readPatchOwnAccountNotificationPreferences,
} from './account-notification-preferences.types';

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
  reason: OwnAccountNotificationPreferencesRejection,
): HttpException {
  switch (reason) {
    case 'version_conflict':
      return publicError(
        HttpStatus.CONFLICT,
        'notification_preferences_version_conflict',
        'Notification preferences changed; refresh and retry',
      );
    case 'temporary_unavailable':
      return publicError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'notification_preferences_service_unavailable',
        'Notification preferences service is unavailable',
      );
    case 'invalid_request':
    case 'internal_failure':
      return publicError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'notification_preferences_internal_error',
        'Notification preferences request failed',
      );
  }
}

function invalidPatch(): HttpException {
  return publicError(
    HttpStatus.BAD_REQUEST,
    'notification_preferences_invalid_request',
    'Notification preferences update is invalid',
  );
}

function disableCaching(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

function readPreferences(
  result:
    | ReadOwnAccountNotificationPreferencesResult
    | UpdateOwnAccountNotificationPreferencesResult,
  expectedOutcome: 'found' | 'updated',
): OwnAccountNotificationPreferences {
  if (result.outcome === 'rejected') {
    throw rejection(result.reason);
  }
  if (
    result.outcome !== expectedOutcome ||
    Object.keys(result).length !== 2 ||
    !isOwnAccountNotificationPreferences(result.preferences)
  ) {
    throw rejection('internal_failure');
  }
  return result.preferences;
}

@Controller('notification-preferences')
export class AccountNotificationPreferencesController {
  constructor(
    private readonly service: AccountNotificationPreferencesService,
  ) {}

  @Get('me')
  @UseGuards(SessionBearerGuard)
  async me(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OwnAccountNotificationPreferences> {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw rejection('internal_failure');
    }
    try {
      return readPreferences(
        await this.service.readOwnPreferences({
          accountId: principal.accountId,
          role: principal.role,
        }),
        'found',
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw rejection('internal_failure');
    }
  }

  @Patch('me')
  @UseGuards(SessionBearerGuard)
  async updateMe(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OwnAccountNotificationPreferences> {
    disableCaching(reply);
    const patch = readPatchOwnAccountNotificationPreferences(body);
    if (patch === undefined) {
      throw invalidPatch();
    }
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw rejection('internal_failure');
    }
    try {
      return readPreferences(
        await this.service.updateOwnPreferences({
          accountId: principal.accountId,
          role: principal.role,
          patch,
        }),
        'updated',
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw rejection('internal_failure');
    }
  }
}
