import { HttpException, HttpStatus } from '@nestjs/common';
import { SessionLifecyclePublicError } from '../auth/session-lifecycle.http';
import { UpdateOwnPlayerProfilePhotoResult } from './player-profile-photo.types';

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

export function playerProfilePhotoRejection(
  reason: Extract<
    UpdateOwnPlayerProfilePhotoResult,
    { readonly outcome: 'rejected' }
  >['reason'],
): HttpException {
  switch (reason) {
    case 'invalid_request':
      return publicError(
        HttpStatus.BAD_REQUEST,
        'profile_photo_invalid_request',
        'Profile photo request is invalid',
      );
    case 'invalid_image':
      return publicError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'profile_photo_invalid_image',
        'Profile photo is invalid',
      );
    case 'profile_not_found':
      return publicError(
        HttpStatus.NOT_FOUND,
        'profile_not_found',
        'Profile was not found',
      );
    case 'conflict':
      return publicError(
        HttpStatus.CONFLICT,
        'profile_photo_conflict',
        'Profile photo changed concurrently',
      );
    case 'feature_unavailable':
    case 'temporary_unavailable':
      return publicError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'profile_photo_service_unavailable',
        'Profile photo service is unavailable',
      );
    case 'internal_failure':
      return publicError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'profile_photo_internal_error',
        'Profile photo request failed',
      );
  }
}
