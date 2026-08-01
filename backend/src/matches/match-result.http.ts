import { isInternalUuid } from '../common/internal-uuid';
import {
  ResolveMatchResultRequest,
  SubmitMatchResultRequest,
} from './match-result-api.types';
import { MatchResultSetRecord } from './match-result.types';
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

function requestKey(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_KEY_PATTERN.test(value);
}

function scoreSet(value: unknown): MatchResultSetRecord | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['team1Games', 'team2Games']) ||
    !Number.isInteger(value.team1Games) ||
    !Number.isInteger(value.team2Games) ||
    (value.team1Games as number) < 0 ||
    (value.team1Games as number) > 7 ||
    (value.team2Games as number) < 0 ||
    (value.team2Games as number) > 7
  ) {
    return undefined;
  }
  return Object.freeze({
    team1Games: value.team1Games as number,
    team2Games: value.team2Games as number,
  });
}

export function readResultMatchId(value: unknown) {
  return isInternalUuid(value) && isMatchId(value) ? value : undefined;
}

export function readSubmitMatchResultRequest(
  value: unknown,
): SubmitMatchResultRequest | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['requestKey', 'sets']) ||
    !requestKey(value.requestKey) ||
    !Array.isArray(value.sets) ||
    (value.sets.length !== 2 && value.sets.length !== 3)
  ) {
    return undefined;
  }
  const sets = value.sets.map(scoreSet);
  if (sets.some((set) => set === undefined)) return undefined;
  return Object.freeze({
    requestKey: value.requestKey,
    sets: Object.freeze(sets as MatchResultSetRecord[]),
  });
}

export function readResolveMatchResultRequest(
  value: unknown,
): ResolveMatchResultRequest | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['requestKey']) ||
    !requestKey(value.requestKey)
  ) {
    return undefined;
  }
  return Object.freeze({ requestKey: value.requestKey });
}
