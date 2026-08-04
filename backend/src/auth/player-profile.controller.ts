import {
  Controller,
  Body,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Req,
  Res,
  Patch,
  Put,
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
  UpdateOwnPlayerProfileResult,
  isOwnPlayerProfile,
  readOwnPlayerProfilePatch,
} from './player-profile.types';
import { PlayerProfilePhotoService } from '../profiles/player-profile-photo.service';
import { playerProfilePhotoRejection } from '../profiles/player-profile-photo.http';
import {
  UpdateOwnPlayerProfilePhotoResult,
  isAcceptedPlayerProfilePhotoMediaType,
} from '../profiles/player-profile-photo.types';

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
    ReadOwnPlayerProfileResult | UpdateOwnPlayerProfileResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): HttpException {
  switch (reason) {
    case 'content_not_allowed':
      return publicError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'profile_content_not_allowed',
        'Profile contains disallowed language',
      );
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

function invalidPatch(): HttpException {
  return publicError(
    HttpStatus.BAD_REQUEST,
    'profile_invalid_request',
    'Profile update is invalid',
  );
}

function readFoundProfile(
  result: ReadOwnPlayerProfileResult | UpdateOwnPlayerProfileResult,
  expectedOutcome: 'found' | 'updated',
): OwnPlayerProfile {
  if (result.outcome === 'rejected') {
    throw rejection(result.reason);
  }
  if (
    result.outcome !== expectedOutcome ||
    Object.keys(result).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(result, 'profile') ||
    !isOwnPlayerProfile(result.profile)
  ) {
    throw rejection('internal_failure');
  }
  return result.profile;
}

type PlayerProfilePhotoSuccess = Exclude<
  UpdateOwnPlayerProfilePhotoResult,
  { outcome: 'rejected' }
>;
const PLAYER_PROFILE_PHOTO_REJECTION_REASONS = Object.freeze([
  'invalid_request',
  'invalid_image',
  'profile_not_found',
  'conflict',
  'feature_unavailable',
  'temporary_unavailable',
  'internal_failure',
] as const);

function readPhotoSuccess(
  value: unknown,
  expectedOutcome: PlayerProfilePhotoSuccess['outcome'],
): PlayerProfilePhotoSuccess {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !Object.prototype.hasOwnProperty.call(value, 'outcome') ||
    typeof (value as { outcome?: unknown }).outcome !== 'string'
  ) {
    throw playerProfilePhotoRejection('internal_failure');
  }
  const result = value as Record<string, unknown>;
  if (result.outcome === 'rejected') {
    if (
      Object.keys(result).length !== 2 ||
      typeof result.reason !== 'string' ||
      !PLAYER_PROFILE_PHOTO_REJECTION_REASONS.includes(
        result.reason as (typeof PLAYER_PROFILE_PHOTO_REJECTION_REASONS)[number],
      )
    ) {
      throw playerProfilePhotoRejection('internal_failure');
    }
    throw playerProfilePhotoRejection(
      result.reason as (typeof PLAYER_PROFILE_PHOTO_REJECTION_REASONS)[number],
    );
  }
  if (result.outcome !== expectedOutcome) {
    throw playerProfilePhotoRejection('internal_failure');
  }
  if (
    Object.keys(result).length !== 3 ||
    !Object.prototype.hasOwnProperty.call(result, 'photoUrl') ||
    !Object.prototype.hasOwnProperty.call(result, 'fullPhotoUrl')
  ) {
    throw playerProfilePhotoRejection('internal_failure');
  }
  if (expectedOutcome === 'deleted') {
    if (result.photoUrl !== null || result.fullPhotoUrl !== null) {
      throw playerProfilePhotoRejection('internal_failure');
    }
    return Object.freeze({
      outcome: 'deleted',
      photoUrl: null,
      fullPhotoUrl: null,
    });
  }
  if (
    typeof result.photoUrl !== 'string' ||
    typeof result.fullPhotoUrl !== 'string' ||
    result.photoUrl.length > 2_048 ||
    result.fullPhotoUrl.length > 2_048
  ) {
    throw playerProfilePhotoRejection('internal_failure');
  }
  try {
    if (
      new URL(result.photoUrl).protocol !== 'https:' ||
      new URL(result.fullPhotoUrl).protocol !== 'https:'
    ) {
      throw new Error('Invalid protocol');
    }
  } catch {
    throw playerProfilePhotoRejection('internal_failure');
  }
  return Object.freeze({
    outcome: 'updated',
    photoUrl: result.photoUrl,
    fullPhotoUrl: result.fullPhotoUrl,
  });
}

@Controller('profile')
export class PlayerProfileController {
  constructor(
    private readonly service: PlayerProfileService,
    private readonly photos: PlayerProfilePhotoService,
  ) {}

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
    return readFoundProfile(result, 'found');
  }

  @Patch('me')
  @UseGuards(SessionBearerGuard)
  async updateMe(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OwnPlayerProfile> {
    disableCaching(reply);
    const changes = readOwnPlayerProfilePatch(body);
    if (changes === undefined) {
      throw invalidPatch();
    }
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw rejection('internal_failure');
    }

    let result;
    try {
      result = await this.service.updateOwnProfile({
        accountId: principal.accountId,
        role: principal.role,
        changes,
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
    return readFoundProfile(result, 'updated');
  }

  @Put('me/photo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionBearerGuard)
  async uploadPhoto(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Exclude<UpdateOwnPlayerProfilePhotoResult, { outcome: 'rejected' }>> {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    const contentType = request.headers['content-type']?.split(';', 1)[0];
    if (
      principal === undefined ||
      !isAcceptedPlayerProfilePhotoMediaType(contentType) ||
      !Buffer.isBuffer(body)
    ) {
      throw playerProfilePhotoRejection('invalid_request');
    }

    let result: unknown;
    try {
      result = await this.photos.uploadOwnPhoto({
        accountId: principal.accountId,
        role: principal.role,
        mediaType: contentType,
        body,
      });
    } catch {
      throw playerProfilePhotoRejection('internal_failure');
    }
    return readPhotoSuccess(result, 'updated');
  }

  @Delete('me/photo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionBearerGuard)
  async deletePhoto(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Exclude<UpdateOwnPlayerProfilePhotoResult, { outcome: 'rejected' }>> {
    disableCaching(reply);
    const principal = readAuthenticatedSessionPrincipal(request);
    if (principal === undefined) {
      throw playerProfilePhotoRejection('internal_failure');
    }

    let result: unknown;
    try {
      result = await this.photos.deleteOwnPhoto({
        accountId: principal.accountId,
        role: principal.role,
      });
    } catch {
      throw playerProfilePhotoRejection('internal_failure');
    }
    return readPhotoSuccess(result, 'deleted');
  }
}
