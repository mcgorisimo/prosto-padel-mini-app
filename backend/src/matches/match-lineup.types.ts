import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { InternalUuid, isInternalUuid } from '../common/internal-uuid';
import { MatchId } from './match.types';

declare const matchLineupAssignmentIdBrand: unique symbol;
declare const matchLineupCommandIdBrand: unique symbol;
declare const matchLineupRequestDigestBrand: unique symbol;

const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type MatchLineupAssignmentId = InternalUuid & {
  readonly [matchLineupAssignmentIdBrand]: 'MatchLineupAssignmentId';
};

export type MatchLineupCommandId = InternalUuid & {
  readonly [matchLineupCommandIdBrand]: 'MatchLineupCommandId';
};

export type MatchLineupRequestDigest = string & {
  readonly [matchLineupRequestDigestBrand]: 'MatchLineupRequestDigest';
};

export type MatchLineupTeamNumber = 1 | 2;
export type MatchLineupCourtSide = 'left' | 'right';
export type MatchLineupStatus = 'draft' | 'locked';

export interface ActiveMatchLineupAssignmentRecord {
  readonly assignmentId: MatchLineupAssignmentId;
  readonly matchId: MatchId;
  readonly accountId: AccountId;
  readonly teamNumber: MatchLineupTeamNumber;
  readonly courtSide: MatchLineupCourtSide;
  readonly assignedAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly version: number;
}

export interface MatchLineupRecord {
  readonly matchId: MatchId;
  readonly status: MatchLineupStatus;
  readonly createdAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly version: number;
  readonly eligibleAccountIds: readonly AccountId[];
  readonly assignments: readonly ActiveMatchLineupAssignmentRecord[];
}

export interface MatchLineupMutationRecord {
  readonly assignmentId: MatchLineupAssignmentId;
  readonly matchId: MatchId;
  readonly accountId: AccountId;
  readonly teamNumber: MatchLineupTeamNumber;
  readonly courtSide: MatchLineupCourtSide;
  readonly appliedAt: UnixEpochSeconds;
  readonly lineupVersion: number;
}

export function isMatchLineupAssignmentId(
  value: unknown,
): value is MatchLineupAssignmentId {
  return isInternalUuid(value);
}

export function isMatchLineupCommandId(
  value: unknown,
): value is MatchLineupCommandId {
  return isInternalUuid(value);
}

export function isMatchLineupRequestDigest(
  value: unknown,
): value is MatchLineupRequestDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function isMatchLineupTeamNumber(
  value: unknown,
): value is MatchLineupTeamNumber {
  return value === 1 || value === 2;
}

export function isMatchLineupCourtSide(
  value: unknown,
): value is MatchLineupCourtSide {
  return value === 'left' || value === 'right';
}
