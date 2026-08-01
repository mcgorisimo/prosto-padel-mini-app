import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { InternalUuid, isInternalUuid } from '../common/internal-uuid';
import { MatchId } from './match.types';

declare const matchResultIdBrand: unique symbol;
declare const matchResultCommandIdBrand: unique symbol;
declare const matchResultRequestDigestBrand: unique symbol;

const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type MatchResultId = InternalUuid & {
  readonly [matchResultIdBrand]: 'MatchResultId';
};

export type MatchResultCommandId = InternalUuid & {
  readonly [matchResultCommandIdBrand]: 'MatchResultCommandId';
};

export type MatchResultRequestDigest = string & {
  readonly [matchResultRequestDigestBrand]: 'MatchResultRequestDigest';
};

export type MatchResultStatus = 'submitted' | 'confirmed' | 'disputed';
export type MatchResultTeamNumber = 1 | 2;

export interface MatchResultSetRecord {
  readonly team1Games: number;
  readonly team2Games: number;
}

export interface MatchResultRecord {
  readonly resultId: MatchResultId;
  readonly matchId: MatchId;
  readonly lineupVersion: number;
  readonly team1LeftAccountId: AccountId;
  readonly team1RightAccountId: AccountId;
  readonly team2LeftAccountId: AccountId;
  readonly team2RightAccountId: AccountId;
  readonly sets: readonly MatchResultSetRecord[];
  readonly winningTeam: MatchResultTeamNumber;
  readonly status: MatchResultStatus;
  readonly submittedByAccountId: AccountId;
  readonly submittedAt: UnixEpochSeconds;
  readonly confirmedByAccountId?: AccountId;
  readonly confirmedAt?: UnixEpochSeconds;
  readonly disputedByAccountId?: AccountId;
  readonly disputedAt?: UnixEpochSeconds;
  readonly version: number;
}

export interface MatchResultMutationRecord {
  readonly resultId: MatchResultId;
  readonly matchId: MatchId;
  readonly status: MatchResultStatus;
  readonly appliedAt: UnixEpochSeconds;
  readonly resultVersion: number;
}

export function isMatchResultId(value: unknown): value is MatchResultId {
  return isInternalUuid(value);
}

export function isMatchResultCommandId(
  value: unknown,
): value is MatchResultCommandId {
  return isInternalUuid(value);
}

export function isMatchResultRequestDigest(
  value: unknown,
): value is MatchResultRequestDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function isMatchResultStatus(
  value: unknown,
): value is MatchResultStatus {
  return value === 'submitted' || value === 'confirmed' || value === 'disputed';
}

export function isMatchResultTeamNumber(
  value: unknown,
): value is MatchResultTeamNumber {
  return value === 1 || value === 2;
}
