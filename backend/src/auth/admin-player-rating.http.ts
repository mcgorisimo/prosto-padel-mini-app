import { isAccountId } from '../accounts/account.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  AdminPlayerListRequest,
  SetAdminPlayerRatingStateRequest,
} from './admin-player-rating-api.types';

const FILTERS = Object.freeze(['all', 'verified', 'unverified'] as const);
const QUERY_KEYS = Object.freeze(['search', 'verification', 'cursor', 'limit']);
const REQUEST_KEYS = Object.freeze(['requestKey', 'rating', 'isVerified']);
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,1024}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRating(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 10) {
    return false;
  }
  const scaled = value * 100;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  return Math.abs(scaled - Math.round(scaled)) <= tolerance;
}

function readSearch(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.normalize('NFKC') !== value ||
    value.length === 0 ||
    [...value].length > 64 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

export function readAdminPlayerId(value: unknown) {
  return isAccountId(value) ? value : undefined;
}

export function readAdminPlayerListRequest(
  value: unknown,
): AdminPlayerListRequest | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !QUERY_KEYS.includes(key))
  ) {
    return undefined;
  }
  const search = readSearch(value.search);
  if (value.search !== undefined && search === undefined) return undefined;
  const verification = value.verification === undefined ? 'all' : value.verification;
  if (
    typeof verification !== 'string' ||
    !FILTERS.includes(verification as (typeof FILTERS)[number])
  ) {
    return undefined;
  }
  const limitText = value.limit === undefined ? '20' : value.limit;
  if (typeof limitText !== 'string' || !/^(?:[1-9]|[1-4][0-9]|50)$/u.test(limitText)) {
    return undefined;
  }
  if (
    value.cursor !== undefined &&
    (typeof value.cursor !== 'string' || !CURSOR_PATTERN.test(value.cursor))
  ) {
    return undefined;
  }
  return Object.freeze({
    ...(search === undefined ? {} : { search }),
    verification: verification as (typeof FILTERS)[number],
    ...(value.cursor === undefined ? {} : { cursor: value.cursor }),
    limit: Number(limitText),
  });
}

export function readSetAdminPlayerRatingStateRequest(
  value: unknown,
): SetAdminPlayerRatingStateRequest | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== REQUEST_KEYS.length ||
    !REQUEST_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key)) ||
    !isInternalUuid(value.requestKey) ||
    !isRating(value.rating) ||
    typeof value.isVerified !== 'boolean'
  ) {
    return undefined;
  }
  return Object.freeze({
    requestKey: value.requestKey,
    rating: value.rating,
    isVerified: value.isVerified,
  });
}
