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
  readonly phone: string | null;
  readonly sidePreference: 'Left' | 'Both' | 'Right' | null;
  readonly rating: number;
  readonly isVerified: boolean;
}

export interface OwnPlayerProfilePatch {
  readonly firstName?: string;
  readonly lastName?: string | null;
  readonly phone?: string | null;
  readonly sidePreference?: 'Left' | 'Both' | 'Right';
}

export interface UpdateOwnPlayerProfileInput
  extends ReadOwnPlayerProfileInput {
  readonly changes: OwnPlayerProfilePatch;
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

export type UpdateOwnPlayerProfileResult =
  | {
      readonly outcome: 'updated';
      readonly profile: OwnPlayerProfile;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'invalid_request'
        | 'content_not_allowed'
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

function isRating(value: unknown): value is number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 10
  ) {
    return false;
  }
  const scaled = value * 100;
  const tolerance =
    Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  return Math.abs(scaled - Math.round(scaled)) <= tolerance;
}

const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const PATCH_KEYS = Object.freeze([
  'firstName',
  'lastName',
  'phone',
  'sidePreference',
] as const);
const SIDE_PREFERENCES = Object.freeze([
  'Left',
  'Both',
  'Right',
] as const);

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isTrimmedBoundedString(
  value: unknown,
  maximumCodePoints: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    [...value].length <= maximumCodePoints &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

export function readOwnPlayerProfilePatch(
  value: unknown,
): OwnPlayerProfilePatch | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).length === 0 ||
    Object.keys(value).some(
      (key) => !PATCH_KEYS.includes(key as (typeof PATCH_KEYS)[number]),
    ) ||
    (hasOwn(value, 'firstName') &&
      !isTrimmedBoundedString(value.firstName, 256)) ||
    (hasOwn(value, 'lastName') &&
      value.lastName !== null &&
      !isTrimmedBoundedString(value.lastName, 256)) ||
    (hasOwn(value, 'phone') &&
      value.phone !== null &&
      (typeof value.phone !== 'string' ||
        !PHONE_PATTERN.test(value.phone))) ||
    (hasOwn(value, 'sidePreference') &&
      (typeof value.sidePreference !== 'string' ||
        !SIDE_PREFERENCES.includes(
          value.sidePreference as (typeof SIDE_PREFERENCES)[number],
        )))
  ) {
    return undefined;
  }

  return Object.freeze({
    ...(hasOwn(value, 'firstName')
      ? { firstName: value.firstName as string }
      : {}),
    ...(hasOwn(value, 'lastName')
      ? { lastName: value.lastName as string | null }
      : {}),
    ...(hasOwn(value, 'phone')
      ? { phone: value.phone as string | null }
      : {}),
    ...(hasOwn(value, 'sidePreference')
      ? {
          sidePreference:
            value.sidePreference as NonNullable<
              OwnPlayerProfilePatch['sidePreference']
            >,
        }
      : {}),
  });
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
    'phone',
    'sidePreference',
    'rating',
    'isVerified',
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
    || (value.phone !== null &&
      (typeof value.phone !== 'string' ||
        !PHONE_PATTERN.test(value.phone)))
    || (value.sidePreference !== null &&
      (typeof value.sidePreference !== 'string' ||
        !SIDE_PREFERENCES.includes(
          value.sidePreference as (typeof SIDE_PREFERENCES)[number],
        )))
    || !isRating(value.rating)
    || typeof value.isVerified !== 'boolean'
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
