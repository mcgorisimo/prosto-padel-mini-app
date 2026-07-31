import { isInternalUuid } from '../common/internal-uuid';
import {
  ListMatchWaitlistRequest,
  MatchWaitlistActionRequest,
} from './match-waitlist-api.types';
import { isMatchId } from './match.types';

const REQUEST_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

export function readWaitlistMatchId(value: unknown) {
  return isInternalUuid(value) && isMatchId(value) ? value : undefined;
}

export function readListMatchWaitlistRequest(
  value: unknown,
): ListMatchWaitlistRequest | undefined {
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'limit')) {
    return undefined;
  }
  const rawLimit = value.limit ?? '50';
  if (
    typeof rawLimit !== 'string' ||
    !/^(?:[1-9]|[1-4][0-9]|50)$/u.test(rawLimit)
  ) {
    return undefined;
  }
  return Object.freeze({ limit: Number(rawLimit) });
}

export function readMatchWaitlistActionRequest(
  value: unknown,
): MatchWaitlistActionRequest | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['requestKey']) ||
    typeof value.requestKey !== 'string' ||
    !REQUEST_KEY_PATTERN.test(value.requestKey)
  ) {
    return undefined;
  }
  return Object.freeze({ requestKey: value.requestKey });
}
