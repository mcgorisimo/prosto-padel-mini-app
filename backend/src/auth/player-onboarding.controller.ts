import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Patch,
  Post,
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
  AdvanceOwnPlayerOnboardingResult,
  CompleteOwnPlayerOnboardingResult,
  OwnPlayerOnboarding,
  ReadOwnPlayerOnboardingResult,
  SaveOwnPlayerOnboardingDraftResult,
  isOwnPlayerOnboarding,
  readOwnPlayerOnboardingCompletion,
  readOwnPlayerOnboardingDraft,
  readOwnPlayerOnboardingProgress,
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

function progressRejection(
  reason: Extract<
    AdvanceOwnPlayerOnboardingResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): HttpException {
  switch (reason) {
    case 'invalid_request':
      return publicError(
        HttpStatus.BAD_REQUEST,
        'onboarding_progress_invalid_request',
        'Onboarding progress request is invalid',
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
        'onboarding_progress_revision_conflict',
        'Onboarding progress revision is stale',
      );
    case 'progress_conflict':
      return publicError(
        HttpStatus.CONFLICT,
        'onboarding_progress_conflict',
        'Onboarding progress conflicts with current state',
      );
    case 'onboarding_incomplete':
      return publicError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'onboarding_progress_incomplete',
        'Onboarding progress requirements are incomplete',
      );
    case 'onboarding_closed':
      return publicError(
        HttpStatus.CONFLICT,
        'onboarding_progress_closed',
        'Onboarding progress is closed',
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

function completionRejection(
  reason: Extract<
    CompleteOwnPlayerOnboardingResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): HttpException {
  switch (reason) {
    case 'invalid_request':
      return publicError(
        HttpStatus.BAD_REQUEST,
        'onboarding_completion_invalid_request',
        'Onboarding completion request is invalid',
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
        'onboarding_completion_revision_conflict',
        'Onboarding completion revision is stale',
      );
    case 'completion_conflict':
      return publicError(
        HttpStatus.CONFLICT,
        'onboarding_completion_conflict',
        'Onboarding completion conflicts with current state',
      );
    case 'onboarding_incomplete':
      return publicError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'onboarding_incomplete',
        'Onboarding requirements are incomplete',
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

function readAdvanced(
  value: unknown,
  expectedStep: 'consents' | 'level_survey',
): OwnPlayerOnboarding {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, 'outcome') ||
    !Object.prototype.hasOwnProperty.call(value, 'onboarding')
  ) {
    throw progressRejection('internal_failure');
  }
  const result = value as Record<string, unknown>;
  if (
    result.outcome !== 'advanced' ||
    !isOwnPlayerOnboarding(result.onboarding) ||
    result.onboarding.status !== 'in_progress' ||
    result.onboarding.currentStep !== expectedStep
  ) {
    throw progressRejection('internal_failure');
  }
  return result.onboarding;
}

function readProgressRejectionReason(
  value: unknown,
):
  | Extract<
      AdvanceOwnPlayerOnboardingResult,
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
      'onboarding_incomplete',
      'progress_conflict',
      'onboarding_closed',
      'temporary_unavailable',
      'internal_failure',
    ].includes(result.reason)
    ? (result.reason as Extract<
        AdvanceOwnPlayerOnboardingResult,
        { readonly outcome: 'rejected' }
      >['reason'])
    : undefined;
}

function readCompleted(value: unknown): OwnPlayerOnboarding {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, 'outcome') ||
    !Object.prototype.hasOwnProperty.call(value, 'onboarding')
  ) {
    throw completionRejection('internal_failure');
  }
  const result = value as Record<string, unknown>;
  if (
    result.outcome !== 'completed' ||
    !isOwnPlayerOnboarding(result.onboarding) ||
    result.onboarding.status !== 'completed'
  ) {
    throw completionRejection('internal_failure');
  }
  return result.onboarding;
}

function readCompletionRejectionReason(
  value: unknown,
):
  | Extract<
      CompleteOwnPlayerOnboardingResult,
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
      'onboarding_incomplete',
      'completion_conflict',
      'temporary_unavailable',
      'internal_failure',
    ].includes(result.reason)
    ? (result.reason as Extract<
        CompleteOwnPlayerOnboardingResult,
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

  @Post('me/progress')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionBearerGuard)
  async advance(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OwnPlayerOnboarding> {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw progressRejection('internal_failure');
    }
    const progress = readOwnPlayerOnboardingProgress(body);
    if (progress === undefined) {
      throw progressRejection('invalid_request');
    }

    let result: unknown;
    try {
      result = await this.service.advanceOwnOnboarding({
        accountId: principal.accountId,
        role: principal.role,
        progress,
      });
    } catch {
      throw progressRejection('internal_failure');
    }
    const rejectionReason = readProgressRejectionReason(result);
    if (rejectionReason !== undefined) {
      throw progressRejection(rejectionReason);
    }
    return readAdvanced(result, progress.nextStep);
  }

  @Post('me/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionBearerGuard)
  async complete(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OwnPlayerOnboarding> {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw completionRejection('internal_failure');
    }
    const completion = readOwnPlayerOnboardingCompletion(body);
    if (completion === undefined) {
      throw completionRejection('invalid_request');
    }

    let result: unknown;
    try {
      result = await this.service.completeOwnOnboarding({
        accountId: principal.accountId,
        role: principal.role,
        completion,
      });
    } catch {
      throw completionRejection('internal_failure');
    }
    const rejectionReason = readCompletionRejectionReason(result);
    if (rejectionReason !== undefined) {
      throw completionRejection(rejectionReason);
    }
    return readCompleted(result);
  }
}
