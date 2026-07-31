import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { InternalUuid, isInternalUuid } from '../common/internal-uuid';
import { MatchId } from './match.types';

declare const matchWaitlistEntryIdBrand: unique symbol;
declare const matchWaitlistCommandIdBrand: unique symbol;
declare const matchWaitlistRequestDigestBrand: unique symbol;

const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type MatchWaitlistEntryId = InternalUuid & {
  readonly [matchWaitlistEntryIdBrand]: 'MatchWaitlistEntryId';
};

export type MatchWaitlistCommandId = InternalUuid & {
  readonly [matchWaitlistCommandIdBrand]: 'MatchWaitlistCommandId';
};

export type MatchWaitlistRequestDigest = string & {
  readonly [matchWaitlistRequestDigestBrand]: 'MatchWaitlistRequestDigest';
};

export type MatchWaitlistEntryStatus =
  | 'waiting'
  | 'promoted'
  | 'left'
  | 'skipped';

export interface MatchWaitlistEntryRecord {
  readonly entryId: MatchWaitlistEntryId;
  readonly matchId: MatchId;
  readonly accountId: AccountId;
  readonly status: MatchWaitlistEntryStatus;
  readonly joinedAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly resolvedAt?: UnixEpochSeconds;
  readonly version: 1 | 2;
}

export interface WaitingMatchWaitlistEntryRecord
  extends MatchWaitlistEntryRecord {
  readonly status: 'waiting';
  readonly resolvedAt?: never;
  readonly version: 1;
  readonly queuePosition: number;
}

export interface MatchWaitlistMutationRecord {
  readonly entryId: MatchWaitlistEntryId;
  readonly matchId: MatchId;
  readonly status: 'waiting' | 'left';
  readonly appliedAt: UnixEpochSeconds;
  readonly version: 1 | 2;
}

export function isMatchWaitlistEntryId(
  value: unknown,
): value is MatchWaitlistEntryId {
  return isInternalUuid(value);
}

export function isMatchWaitlistCommandId(
  value: unknown,
): value is MatchWaitlistCommandId {
  return isInternalUuid(value);
}

export function isMatchWaitlistRequestDigest(
  value: unknown,
): value is MatchWaitlistRequestDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}
