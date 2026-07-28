import {
  AccountId,
  UserRole,
  isAccountId,
} from '../accounts/account.types';

export interface PublicPlayerProfile {
  readonly playerId: AccountId;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly username: string | null;
  readonly rating: number;
  readonly isVerified: boolean;
}

export interface SearchPublicPlayerProfilesRequest {
  readonly query: string;
  readonly limit: number;
}

export interface SearchPublicPlayerProfilesInput
  extends SearchPublicPlayerProfilesRequest {
  readonly role: UserRole;
}

export type SearchPublicPlayerProfilesResult =
  | {
      readonly outcome: 'found';
      readonly players: readonly PublicPlayerProfile[];
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'invalid_request'
        | 'temporary_unavailable'
        | 'internal_failure';
    };

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const MIN_QUERY_CODE_POINTS = 2;
const MAX_QUERY_CODE_POINTS = 64;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const CANONICAL_LIMIT_PATTERN = /^(?:[1-9]|1[0-9]|20)$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeQuery(value: string): string | undefined {
  let normalized = value.normalize('NFKC').trim();
  if (normalized.startsWith('@')) {
    normalized = normalized.slice(1);
  }
  normalized = normalized.trim();
  return (
    [...normalized].length >= MIN_QUERY_CODE_POINTS &&
    [...normalized].length <= MAX_QUERY_CODE_POINTS &&
    !CONTROL_CHARACTER_PATTERN.test(normalized)
  )
    ? normalized
    : undefined;
}

export function readPublicPlayerProfileSearchQuery(
  value: unknown,
): SearchPublicPlayerProfilesRequest | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['q', 'limit'].includes(key)) ||
    !Object.prototype.hasOwnProperty.call(value, 'q') ||
    typeof value.q !== 'string' ||
    (Object.prototype.hasOwnProperty.call(value, 'limit') &&
      (typeof value.limit !== 'string' ||
        !CANONICAL_LIMIT_PATTERN.test(value.limit)))
  ) {
    return undefined;
  }

  const query = normalizeQuery(value.q);
  if (query === undefined) {
    return undefined;
  }
  const limit = Object.prototype.hasOwnProperty.call(value, 'limit')
    ? Number(value.limit)
    : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return undefined;
  }

  return Object.freeze({ query, limit });
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

export function isPublicPlayerProfile(
  value: unknown,
): value is PublicPlayerProfile {
  const expectedKeys = [
    'playerId',
    'firstName',
    'lastName',
    'username',
    'rating',
    'isVerified',
  ] as const;
  return (
    isRecord(value) &&
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) &&
    isAccountId(value.playerId) &&
    isNullableBoundedString(value.firstName, 256) &&
    value.firstName !== null &&
    isNullableBoundedString(value.lastName, 256) &&
    isNullableBoundedString(value.username, 64) &&
    isRating(value.rating) &&
    typeof value.isVerified === 'boolean'
  );
}
