import { AccountId, UserRole } from '../accounts/account.types';
import { AcceptedPlayerProfilePhotoMediaType } from './player-profile-photo.processor';

export interface UploadOwnPlayerProfilePhotoInput {
  readonly accountId: AccountId;
  readonly role: UserRole;
  readonly mediaType: AcceptedPlayerProfilePhotoMediaType;
  readonly body: Buffer;
}

export interface DeleteOwnPlayerProfilePhotoInput {
  readonly accountId: AccountId;
  readonly role: UserRole;
}

export type UpdateOwnPlayerProfilePhotoResult =
  | Readonly<{
      outcome: 'updated';
      photoUrl: string;
      fullPhotoUrl: string;
    }>
  | Readonly<{
      outcome: 'deleted';
      photoUrl: null;
      fullPhotoUrl: null;
    }>
  | Readonly<{
      outcome: 'rejected';
      reason:
        | 'invalid_request'
        | 'invalid_image'
        | 'profile_not_found'
        | 'conflict'
        | 'feature_unavailable'
        | 'temporary_unavailable'
        | 'internal_failure';
    }>;

export function isAcceptedPlayerProfilePhotoMediaType(
  value: unknown,
): value is AcceptedPlayerProfilePhotoMediaType {
  return (
    value === 'image/jpeg' ||
    value === 'image/png' ||
    value === 'image/webp'
  );
}
