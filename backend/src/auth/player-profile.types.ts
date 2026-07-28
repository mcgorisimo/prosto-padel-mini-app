import {
  AccountId,
  UserRole,
  isAccountId,
} from '../accounts/account.types';

export interface ReadOwnPlayerProfileInput {
  readonly accountId: AccountId;
  readonly role: UserRole;
}

export interface OwnPlayerProfile {
  readonly accountId: AccountId;
  readonly role: 'player';
  readonly firstName: string;
  readonly lastName: string | null;
  readonly username: string | null;
  readonly photoUrl: string | null;
  readonly languageCode: string | null;
}

export type ReadOwnPlayerProfileResult =
  | {
      readonly outcome: 'found';
      readonly profile: OwnPlayerProfile;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'invalid_request'
        | 'profile_not_found'
        | 'temporary_unavailable'
        | 'internal_failure';
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableBoundedString(
  value: unknown,
  maximumCodePoints: number,
): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length > 0 &&
      [...value].length <= maximumCodePoints)
  );
}

export function isOwnPlayerProfile(
  value: unknown,
): value is OwnPlayerProfile {
  const expectedKeys = [
    'accountId',
    'role',
    'firstName',
    'lastName',
    'username',
    'photoUrl',
    'languageCode',
  ] as const;
  if (
    !isRecord(value) ||
    Object.keys(value).length !== expectedKeys.length ||
    !expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) ||
    !isAccountId(value.accountId) ||
    value.role !== 'player' ||
    !isNullableBoundedString(value.firstName, 256) ||
    value.firstName === null ||
    !isNullableBoundedString(value.lastName, 256) ||
    !isNullableBoundedString(value.username, 64) ||
    !isNullableBoundedString(value.photoUrl, 2_048) ||
    !isNullableBoundedString(value.languageCode, 64)
  ) {
    return false;
  }
  if (value.photoUrl !== null) {
    try {
      if (new URL(value.photoUrl).protocol !== 'https:') {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}
