import { isAccountId } from '../accounts/account.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  isMatchId,
  isMatchInvitationId,
} from './match.types';
import {
  CreateMatchInvitationRequest,
  MatchInvitationActionRequest,
  MatchInvitationListRequest,
} from './match-invitation-api.types';

const REQUEST_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

function isRequestKey(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_KEY_PATTERN.test(value);
}

export function readCreateMatchInvitationRequest(
  value: unknown,
): CreateMatchInvitationRequest | undefined {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ['requestKey', 'playerId', 'slotNumber']) ||
    !isRequestKey(value.requestKey) ||
    !isAccountId(value.playerId) ||
    ![2, 3, 4].includes(value.slotNumber as number)
  ) {
    return undefined;
  }
  return Object.freeze({
    requestKey: value.requestKey,
    playerId: value.playerId,
    slotNumber: value.slotNumber as 2 | 3 | 4,
  });
}

export function readMatchInvitationActionRequest(
  value: unknown,
): MatchInvitationActionRequest | undefined {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ['requestKey']) ||
    !isRequestKey(value.requestKey)
  ) {
    return undefined;
  }
  return Object.freeze({ requestKey: value.requestKey });
}

export function readMatchInvitationListRequest(
  value: unknown,
): MatchInvitationListRequest | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'limit')) return undefined;
  const raw = value.limit ?? '20';
  if (
    typeof raw !== 'string' ||
    !/^(?:[1-9]|1[0-9]|20)$/u.test(raw)
  ) {
    return undefined;
  }
  return Object.freeze({ limit: Number(raw) });
}

export function readMatchInvitationId(value: unknown) {
  return isInternalUuid(value) && isMatchInvitationId(value)
    ? value
    : undefined;
}

export function readInvitationMatchId(value: unknown) {
  return isInternalUuid(value) && isMatchId(value) ? value : undefined;
}
