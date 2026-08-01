import { isInternalUuid } from '../common/internal-uuid';
import {
  AssignMatchLineupSlotRequest,
  ReleaseMatchLineupSlotRequest,
} from './match-lineup-api.types';
import {
  isMatchLineupCourtSide,
  isMatchLineupTeamNumber,
} from './match-lineup.types';
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

export function readLineupMatchId(value: unknown) {
  return isInternalUuid(value) && isMatchId(value) ? value : undefined;
}

export function readAssignMatchLineupSlotRequest(
  value: unknown,
): AssignMatchLineupSlotRequest | undefined {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['requestKey', 'teamNumber', 'courtSide']) ||
    typeof value.requestKey !== 'string' ||
    !REQUEST_KEY_PATTERN.test(value.requestKey) ||
    !isMatchLineupTeamNumber(value.teamNumber) ||
    !isMatchLineupCourtSide(value.courtSide)
  ) {
    return undefined;
  }
  return Object.freeze({
    requestKey: value.requestKey,
    teamNumber: value.teamNumber,
    courtSide: value.courtSide,
  });
}

export function readReleaseMatchLineupSlotRequest(
  value: unknown,
): ReleaseMatchLineupSlotRequest | undefined {
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
