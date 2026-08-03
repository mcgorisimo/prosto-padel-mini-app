import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import { MatchNotificationApiRejection } from './match-notification-api.types';
import {
  readMarkMatchNotificationRequest,
  readMatchNotificationId,
  readMatchNotificationsRequest,
} from './match-notification.http';
import { MatchNotificationService } from './match-notification.service';

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

function rejection(reason: MatchNotificationApiRejection): HttpException {
  const mappings: Record<
    MatchNotificationApiRejection,
    readonly [number, string, string]
  > = {
    invalid_request: [
      HttpStatus.BAD_REQUEST,
      'match_notification_invalid_request',
      'Match notification request is invalid',
    ],
    notification_not_found: [
      HttpStatus.NOT_FOUND,
      'match_notification_not_found',
      'Match notification was not found',
    ],
    temporary_unavailable: [
      HttpStatus.SERVICE_UNAVAILABLE,
      'match_notification_service_unavailable',
      'Match notification service is unavailable',
    ],
    internal_failure: [
      HttpStatus.INTERNAL_SERVER_ERROR,
      'match_notification_internal_error',
      'Match notification request failed',
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

@Controller('match-notifications')
export class MatchNotificationController {
  constructor(private readonly service: MatchNotificationService) {}

  @Get()
  @UseGuards(SessionBearerGuard)
  async list(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const parsed = readMatchNotificationsRequest(query);
    if (parsed === undefined) throw rejection('invalid_request');
    const actor = principal(request);
    const result = await this.service.list({
      accountId: actor.accountId,
      role: actor.role,
      request: parsed,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({
      notifications: result.notifications,
      unreadCount: result.unreadCount,
      ...(result.nextCursor === undefined
        ? {}
        : { nextCursor: result.nextCursor }),
    });
  }

  @Post(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionBearerGuard)
  async markRead(
    @Param('notificationId') rawNotificationId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const notificationId = readMatchNotificationId(rawNotificationId);
    if (
      notificationId === undefined ||
      readMarkMatchNotificationRequest(body) === undefined
    ) {
      throw rejection('invalid_request');
    }
    const actor = principal(request);
    const result = await this.service.markRead({
      accountId: actor.accountId,
      role: actor.role,
      notificationId,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({ notification: result.notification });
  }
}
