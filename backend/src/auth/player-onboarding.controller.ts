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
import {
  SessionBearerGuard,
  readAuthenticatedSessionPrincipal,
} from './session-authentication.guard';
import { SessionLifecyclePublicError } from './session-lifecycle.http';
import { PlayerOnboardingService } from './player-onboarding.service';
import {
  OwnPlayerOnboarding,
  ReadOwnPlayerOnboardingResult,
  SaveOwnPlayerOnboardingDraftResult,
  isOwnPlayerOnboarding,
  readOwnPlayerOnboardingDraft,
} from './player-onboarding.types';

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
    ReadOwnPlayerOnboardingResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): HttpException {
  switch (reason) {
    case 'onboarding_not_found':
      return publicError(
        HttpStatus.NOT_FOUND,
        'onboarding_not_found',
        'Onboarding was not found',
      );
    case 'temporary_unavailable':
      return publicError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'onboarding_service_unavailable',
        'Onboarding service is unavailable',
      );
    case 'invalid_request':
    case 'internal_failure':
      return publicError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'onboarding_internal_error',
        'Onboarding request failed',
      );
  }
}

function draftRejection(
  reason: Extract<
    SaveOwnPlayerOnboardingDraftResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): HttpException {
  switch (reason) {
    case 'invalid_request':
      return publicError(
        HttpStatus.BAD_REQUEST,
        'onboarding_draft_invalid_request',
        'Onboarding draft request is invalid',
      );
    case 'onboarding_not_found':
      return publicError(
        HttpStatus.NOT_FOUND,
        'onboarding_not_found',
        'Onboarding was not found',
      );
    case 'stale_revision':
      return publicError(
        HttpStatus.CONFLICT,
        'onboarding_draft_revision_conflict',
        'Onboarding draft revision is stale',
      );
    case 'onboarding_closed':
      return publicError(
        HttpStatus.CONFLICT,
        'onboarding_draft_closed',
        'Onboarding draft is closed',
      );
    case 'content_not_allowed':
      return publicError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'onboarding_draft_content_not_allowed',
        'Onboarding draft content is not allowed',
      );
    case 'temporary_unavailable':
      return publicError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'onboarding_service_unavailable',
        'Onboarding service is unavailable',
      );
    case 'internal_failure':
      return publicError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'onboarding_internal_error',
        'Onboarding request failed',
      );
  }
}

function disableCaching(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store');
  reply.header('Pragma', 'no-cache');
}

function readFound(value: unknown): OwnPlayerOnboarding {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, 'outcome') ||
    !Object.prototype.hasOwnProperty.call(value, 'onboarding')
  ) {
    throw rejection('internal_failure');
  }
  const result = value as Record<string, unknown>;
  if (result.outcome !== 'found' || !isOwnPlayerOnboarding(result.onboarding)) {
    throw rejection('internal_failure');
  }
  return result.onboarding;
}

function readRejectionReason(
  value: unknown,
):
  | Extract<
      ReadOwnPlayerOnboardingResult,
      { readonly outcome: 'rejected' }
    >['reason']
  | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, 'outcome') ||
    !Object.prototype.hasOwnProperty.call(value, 'reason')
  ) {
    return undefined;
  }
  const result = value as Record<string, unknown>;
  return result.outcome === 'rejected' &&
    typeof result.reason === 'string' &&
    [
      'invalid_request',
      'onboarding_not_found',
      'temporary_unavailable',
      'internal_failure',
    ].includes(result.reason)
    ? (result.reason as Extract<
        ReadOwnPlayerOnboardingResult,
        { readonly outcome: 'rejected' }
      >['reason'])
    : undefined;
}

function readSaved(value: unknown): OwnPlayerOnboarding {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, 'outcome') ||
    !Object.prototype.hasOwnProperty.call(value, 'onboarding')
  ) {
    throw draftRejection('internal_failure');
  }
  const result = value as Record<string, unknown>;
  if (result.outcome !== 'saved' || !isOwnPlayerOnboarding(result.onboarding)) {
    throw draftRejection('internal_failure');
  }
  return result.onboarding;
}

function readDraftRejectionReason(
  value: unknown,
):
  | Extract<
      SaveOwnPlayerOnboardingDraftResult,
      { readonly outcome: 'rejected' }
    >['reason']
  | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, 'outcome') ||
    !Object.prototype.hasOwnProperty.call(value, 'reason')
  ) {
    return undefined;
  }
  const result = value as Record<string, unknown>;
  return result.outcome === 'rejected' &&
    typeof result.reason === 'string' &&
    [
      'invalid_request',
      'onboarding_not_found',
      'stale_revision',
      'onboarding_closed',
      'content_not_allowed',
      'temporary_unavailable',
      'internal_failure',
    ].includes(result.reason)
    ? (result.reason as Extract<
        SaveOwnPlayerOnboardingDraftResult,
        { readonly outcome: 'rejected' }
      >['reason'])
    : undefined;
}

@Controller('onboarding')
export class PlayerOnboardingController {
  constructor(private readonly service: PlayerOnboardingService) {}

  @Get('me')
  @UseGuards(SessionBearerGuard)
  async me(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OwnPlayerOnboarding> {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw rejection('internal_failure');
    }

    let result: unknown;
    try {
      result = await this.service.readOwnOnboarding({
        accountId: principal.accountId,
        role: principal.role,
      });
    } catch {
      throw rejection('internal_failure');
    }
    const rejectionReason = readRejectionReason(result);
    if (rejectionReason !== undefined) {
      throw rejection(rejectionReason);
    }
    return readFound(result);
  }

  @Patch('me')
  @UseGuards(SessionBearerGuard)
  async saveDraft(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OwnPlayerOnboarding> {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw draftRejection('internal_failure');
    }
    const draft = readOwnPlayerOnboardingDraft(body);
    if (draft === undefined) {
      throw draftRejection('invalid_request');
    }

    let result: unknown;
    try {
      result = await this.service.saveOwnOnboardingDraft({
        accountId: principal.accountId,
        role: principal.role,
        draft,
      });
    } catch {
      throw draftRejection('internal_failure');
    }
    const rejectionReason = readDraftRejectionReason(result);
    if (rejectionReason !== undefined) {
      throw draftRejection(rejectionReason);
    }
    return readSaved(result);
  }
}
