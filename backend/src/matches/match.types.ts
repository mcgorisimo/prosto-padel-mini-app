import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  InternalUuid,
  isInternalUuid,
  newInternalUuid,
} from '../common/internal-uuid';

declare const matchIdBrand: unique symbol;
declare const matchParticipantIdBrand: unique symbol;
declare const matchCommandIdBrand: unique symbol;
declare const matchRequestDigestBrand: unique symbol;

const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type MatchId = InternalUuid & {
  readonly [matchIdBrand]: 'MatchId';
};

export type MatchParticipantId = InternalUuid & {
  readonly [matchParticipantIdBrand]: 'MatchParticipantId';
};

export type MatchCommandId = InternalUuid & {
  readonly [matchCommandIdBrand]: 'MatchCommandId';
};

export type MatchRequestDigest = string & {
  readonly [matchRequestDigestBrand]: 'MatchRequestDigest';
};

export const MATCH_STATUSES = Object.freeze([
  'open',
  'searching',
  'confirmed',
  'upcoming',
  'completed',
  'cancelled',
] as const);

export type MatchStatus = (typeof MATCH_STATUSES)[number];

export type MatchKind = 'match' | 'private';
export type MatchVisibility = 'public' | 'private';
export type MatchScenario = 'community' | 'social' | 'private';
export type MatchDurationMinutes = 60 | 90 | 120 | 150;
export type MatchSlotNumber = 2 | 3 | 4;
export type MatchParticipantStatus = 'active' | 'left' | 'removed';
export type MatchCommandType =
  | 'create_match'
  | 'join_match'
  | 'leave_match';
export type MatchCommandResultType =
  | 'match_created'
  | 'participant_joined'
  | 'participant_left';

export interface MatchParticipantState {
  readonly participantId: MatchParticipantId;
  readonly accountId: AccountId;
  readonly slotNumber: MatchSlotNumber;
  readonly status: MatchParticipantStatus;
  readonly joinedAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly leftAt?: UnixEpochSeconds;
  readonly version: number;
}

export interface AppliedMatchCommand {
  readonly commandId: MatchCommandId;
  readonly matchId: MatchId;
  readonly actorAccountId: AccountId;
  readonly commandSequence: number;
  readonly requestDigest: MatchRequestDigest;
  readonly commandType: MatchCommandType;
  readonly appliedAt: UnixEpochSeconds;
  readonly participantId?: MatchParticipantId;
  readonly resultType: MatchCommandResultType;
  readonly matchVersion: number;
}

export interface MatchState {
  readonly matchId: MatchId;
  readonly ownerAccountId: AccountId;
  readonly createdAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly startsAt: UnixEpochSeconds;
  readonly durationMinutes: MatchDurationMinutes;
  readonly courtId: string;
  readonly courtName: string;
  readonly courtType: string;
  readonly kind: MatchKind;
  readonly visibility: MatchVisibility;
  readonly scenario: MatchScenario;
  readonly status: MatchStatus;
  readonly title?: string;
  readonly description: string;
  readonly ratingMin?: number;
  readonly ratingMax?: number;
  readonly isRatingMatch: boolean;
  readonly pricePerPersonSnapshot?: number;
  readonly version: number;
  readonly terminalAt?: UnixEpochSeconds;
  readonly participants: readonly MatchParticipantState[];
  readonly appliedCommands: readonly AppliedMatchCommand[];
}

interface MatchCommandBase {
  readonly matchId: MatchId;
  readonly commandId: MatchCommandId;
  readonly actorAccountId: AccountId;
  readonly requestDigest: MatchRequestDigest;
  readonly now: UnixEpochSeconds;
}

export interface CreateMatchCommand extends MatchCommandBase {
  readonly type: 'create_match';
  readonly startsAt: UnixEpochSeconds;
  readonly durationMinutes: MatchDurationMinutes;
  readonly courtId: string;
  readonly courtName: string;
  readonly courtType: string;
  readonly kind: MatchKind;
  readonly visibility: MatchVisibility;
  readonly scenario: MatchScenario;
  readonly status: 'open' | 'searching' | 'upcoming';
  readonly title?: string;
  readonly description: string;
  readonly ratingMin?: number;
  readonly ratingMax?: number;
  readonly isRatingMatch: boolean;
  readonly pricePerPersonSnapshot?: number;
}

export interface JoinMatchCommand extends MatchCommandBase {
  readonly type: 'join_match';
  readonly participantId: MatchParticipantId;
  readonly actorRatingLevel: number;
}

export interface LeaveMatchCommand extends MatchCommandBase {
  readonly type: 'leave_match';
}

export type MatchCommand =
  | CreateMatchCommand
  | JoinMatchCommand
  | LeaveMatchCommand;

export function isMatchId(value: unknown): value is MatchId {
  return isInternalUuid(value);
}

export function isMatchParticipantId(
  value: unknown,
): value is MatchParticipantId {
  return isInternalUuid(value);
}

export function isMatchCommandId(value: unknown): value is MatchCommandId {
  return isInternalUuid(value);
}

export function isMatchRequestDigest(
  value: unknown,
): value is MatchRequestDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function newMatchId(): MatchId {
  return newInternalUuid() as MatchId;
}

export function newMatchParticipantId(): MatchParticipantId {
  return newInternalUuid() as MatchParticipantId;
}

export function newMatchCommandId(): MatchCommandId {
  return newInternalUuid() as MatchCommandId;
}
