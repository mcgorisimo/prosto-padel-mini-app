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
import { BackendDomainEventLogger } from '../common/logging/backend-domain-event.logger';
import { MatchChatApiRejection } from './match-chat-api.types';
import {
  readChatMatchId,
  readMatchMessagesRequest,
  readSendMatchMessageRequest,
} from './match-chat.http';
import { MatchChatService } from './match-chat.service';

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

function rejection(reason: MatchChatApiRejection): HttpException {
  const mappings: Record<
    MatchChatApiRejection,
    readonly [number, string, string]
  > = {
    invalid_request: [
      HttpStatus.BAD_REQUEST,
      'match_chat_invalid_request',
      'Match chat request is invalid',
    ],
    content_not_allowed: [
      HttpStatus.UNPROCESSABLE_ENTITY,
      'match_chat_content_not_allowed',
      'Match chat message contains disallowed language',
    ],
    match_not_found: [
      HttpStatus.NOT_FOUND,
      'match_chat_not_found',
      'Match chat was not found',
    ],
    match_closed: [
      HttpStatus.CONFLICT,
      'match_chat_closed',
      'Match chat is closed',
    ],
    request_conflict: [
      HttpStatus.CONFLICT,
      'match_chat_request_conflict',
      'Match chat request conflicts with an earlier request',
    ],
    temporary_unavailable: [
      HttpStatus.SERVICE_UNAVAILABLE,
      'match_chat_service_unavailable',
      'Match chat service is unavailable',
    ],
    internal_failure: [
      HttpStatus.INTERNAL_SERVER_ERROR,
      'match_chat_internal_error',
      'Match chat request failed',
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

@Controller('matches/:matchId/messages')
export class MatchChatController {
  constructor(
    private readonly service: MatchChatService,
    private readonly domainEvents: BackendDomainEventLogger,
  ) {}

  @Get()
  @UseGuards(SessionBearerGuard)
  async list(
    @Param('matchId') rawMatchId: unknown,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readChatMatchId(rawMatchId);
    const parsed = readMatchMessagesRequest(query);
    if (matchId === undefined || parsed === undefined) {
      throw rejection('invalid_request');
    }
    const actor = principal(request);
    const result = await this.service.list({
      accountId: actor.accountId,
      role: actor.role,
      matchId,
      request: parsed,
    });
    if (result.outcome === 'rejected') throw rejection(result.reason);
    return Object.freeze({
      messages: result.messages,
      ...(result.nextCursor === undefined
        ? {}
        : { nextCursor: result.nextCursor }),
    });
  }

  @Post()
  @UseGuards(SessionBearerGuard)
  async send(
    @Param('matchId') rawMatchId: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    disableCaching(reply);
    const matchId = readChatMatchId(rawMatchId);
    const parsed = readSendMatchMessageRequest(body);
    if (matchId === undefined || parsed === undefined) {
      throw rejection('invalid_request');
    }
    const actor = principal(request);
    const result = await this.service.send({
      accountId: actor.accountId,
      role: actor.role,
      matchId,
      request: parsed,
    });
    if (result.outcome === 'rejected') {
      this.domainEvents.record({
        domain: 'match_chat',
        action: 'send_message',
        outcome: 'rejected',
        matchId,
        reason: result.reason,
      });
      throw rejection(result.reason);
    }
    this.domainEvents.record({
      domain: 'match_chat',
      action: 'send_message',
      outcome:
        result.persistence === 'applied' ? 'sent' : 'idempotent_retry',
      matchId,
      messageId: result.message.messageId,
    });
    return Object.freeze({ message: result.message });
  }
}
