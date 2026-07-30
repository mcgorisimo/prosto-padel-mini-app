import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { InternalUuid, isInternalUuid } from '../common/internal-uuid';
import { MatchId } from './match.types';

declare const matchMessageIdBrand: unique symbol;
declare const matchMessageCommandIdBrand: unique symbol;
declare const matchMessageRequestDigestBrand: unique symbol;

const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const DISALLOWED_CONTROL_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const MAX_MESSAGE_CODE_POINTS = 2_000;

export type MatchMessageId = InternalUuid & {
  readonly [matchMessageIdBrand]: 'MatchMessageId';
};

export type MatchMessageCommandId = InternalUuid & {
  readonly [matchMessageCommandIdBrand]: 'MatchMessageCommandId';
};

export type MatchMessageRequestDigest = string & {
  readonly [matchMessageRequestDigestBrand]: 'MatchMessageRequestDigest';
};

export interface MatchMessageRecord {
  readonly messageId: MatchMessageId;
  readonly matchId: MatchId;
  readonly senderAccountId: AccountId;
  readonly body: string;
  readonly createdAt: UnixEpochSeconds;
}

export interface MatchMessageCursor {
  readonly createdAt: UnixEpochSeconds;
  readonly messageId: MatchMessageId;
}

export function isMatchMessageId(value: unknown): value is MatchMessageId {
  return isInternalUuid(value);
}

export function isMatchMessageCommandId(
  value: unknown,
): value is MatchMessageCommandId {
  return isInternalUuid(value);
}

export function isMatchMessageRequestDigest(
  value: unknown,
): value is MatchMessageRequestDigest {
  return (
    typeof value === 'string' && SHA_256_HEX_PATTERN.test(value)
  );
}

export function isCanonicalMatchMessageBody(
  value: unknown,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= MAX_MESSAGE_CODE_POINTS &&
    value.trim() === value &&
    !DISALLOWED_CONTROL_PATTERN.test(value)
  );
}
