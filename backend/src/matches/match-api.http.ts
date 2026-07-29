import { isUnixEpochSeconds } from '../auth/auth.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  CreateMatchRequest,
  MatchActionRequest,
  MatchFeedRequest,
} from './match-api.types';
import {
  MatchDurationMinutes,
  MatchId,
  MatchScenario,
} from './match.types';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const FEED_LIMIT_PATTERN = /^(?:[1-9]|[1-4][0-9]|50)$/u;
const CREATE_REQUIRED_KEYS = Object.freeze([
  'requestKey',
  'startsAt',
  'durationMinutes',
  'scenario',
  'description',
  'isRatingMatch',
] as const);
const CREATE_OPTIONAL_KEYS = Object.freeze([
  'courtId',
  'title',
  'ratingMin',
  'ratingMax',
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isQueryRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    [...value].length >= minimum &&
    [...value].length <= maximum &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function isDescription(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    [...value].length <= 2_000 &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function isOptionalTitle(value: unknown): value is string | undefined {
  return value === undefined || isBoundedText(value, 1, 160);
}

function isPublicRatingRange(
  minimum: unknown,
  maximum: unknown,
): minimum is number {
  return (
    Number.isInteger(minimum) &&
    Number.isInteger(maximum) &&
    (minimum as number) >= 0 &&
    (maximum as number) <= 6 &&
    (minimum as number) <= (maximum as number)
  );
}

function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  return (
    required.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) &&
    Object.keys(value).every(
      (key) => required.includes(key) || optional.includes(key),
    )
  );
}

export function readCreateMatchRequest(
  value: unknown,
): CreateMatchRequest | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyAllowedKeys(
      value,
      CREATE_REQUIRED_KEYS,
      CREATE_OPTIONAL_KEYS,
    ) ||
    !isInternalUuid(value.requestKey) ||
    !isUnixEpochSeconds(value.startsAt) ||
    ![60, 90, 120, 150].includes(value.durationMinutes as number) ||
    (value.courtId !== undefined &&
      !isBoundedText(value.courtId, 1, 64)) ||
    !['community', 'social', 'private'].includes(
      value.scenario as string,
    ) ||
    !isOptionalTitle(value.title) ||
    !isDescription(value.description) ||
    typeof value.isRatingMatch !== 'boolean'
  ) {
    return undefined;
  }

  const scenario = value.scenario as MatchScenario;
  if (
    ((scenario === 'social' || scenario === 'private') &&
      value.courtId === undefined) ||
    (scenario === 'private'
      ? Object.prototype.hasOwnProperty.call(value, 'ratingMin') ||
        Object.prototype.hasOwnProperty.call(value, 'ratingMax') ||
        value.isRatingMatch !== false
      : !Object.prototype.hasOwnProperty.call(value, 'ratingMin') ||
        !Object.prototype.hasOwnProperty.call(value, 'ratingMax') ||
        !isPublicRatingRange(value.ratingMin, value.ratingMax))
  ) {
    return undefined;
  }

  return Object.freeze({
    requestKey: value.requestKey,
    startsAt: value.startsAt,
    durationMinutes: value.durationMinutes as MatchDurationMinutes,
    ...(value.courtId === undefined ? {} : { courtId: value.courtId }),
    scenario,
    ...(value.title === undefined ? {} : { title: value.title }),
    description: value.description,
    ...(scenario === 'private'
      ? {}
      : {
          ratingMin: value.ratingMin as number,
          ratingMax: value.ratingMax as number,
        }),
    isRatingMatch: value.isRatingMatch,
  });
}

export function readMatchActionRequest(
  value: unknown,
): MatchActionRequest | undefined {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(value, 'requestKey') ||
    !isInternalUuid(value.requestKey)
  ) {
    return undefined;
  }
  return Object.freeze({ requestKey: value.requestKey });
}

export function readMatchFeedRequest(
  value: unknown,
): MatchFeedRequest | undefined {
  if (
    !isQueryRecord(value) ||
    Object.keys(value).some((key) => key !== 'limit') ||
    (Object.prototype.hasOwnProperty.call(value, 'limit') &&
      !(
        (typeof value.limit === 'string' &&
          FEED_LIMIT_PATTERN.test(value.limit)) ||
        (Number.isInteger(value.limit) &&
          (value.limit as number) >= 1 &&
          (value.limit as number) <= 50)
      ))
  ) {
    return undefined;
  }
  return Object.freeze({
    limit: Object.prototype.hasOwnProperty.call(value, 'limit')
      ? Number(value.limit)
      : 20,
  });
}

export function readMatchId(value: unknown): MatchId | undefined {
  return isInternalUuid(value) ? (value as MatchId) : undefined;
}
