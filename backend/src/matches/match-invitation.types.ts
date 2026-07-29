import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { InternalUuid, isInternalUuid } from '../common/internal-uuid';
import {
  MatchDurationMinutes,
  MatchId,
  MatchInvitationId,
  MatchParticipantId,
  MatchScenario,
  MatchSlotNumber,
  MatchStatus,
} from './match.types';

declare const matchInvitationCommandIdBrand: unique symbol;
declare const matchInvitationRequestDigestBrand: unique symbol;

const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type MatchInvitationCommandId = InternalUuid & {
  readonly [matchInvitationCommandIdBrand]: 'MatchInvitationCommandId';
};

export type MatchInvitationRequestDigest = string & {
  readonly [matchInvitationRequestDigestBrand]:
    'MatchInvitationRequestDigest';
};

export type MatchInvitationStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'cancelled';

export type MatchInvitationCommandType =
  | 'create_invitation'
  | 'accept_invitation'
  | 'decline_invitation'
  | 'cancel_invitation';

export type MatchInvitationResultType =
  | 'invitation_created'
  | 'invitation_accepted'
  | 'invitation_declined'
  | 'invitation_cancelled';

export interface MatchInvitationMatchSnapshot {
  readonly matchId: MatchId;
  readonly ownerAccountId: AccountId;
  readonly startsAt: UnixEpochSeconds;
  readonly durationMinutes: MatchDurationMinutes;
  readonly courtId: string;
  readonly courtName: string;
  readonly courtType: string;
  readonly scenario: MatchScenario;
  readonly status: MatchStatus;
  readonly title?: string;
  readonly ratingMin?: number;
  readonly ratingMax?: number;
  readonly isRatingMatch: boolean;
  readonly pricePerPersonSnapshot?: number;
}

export interface MatchInvitationRecord {
  readonly invitationId: MatchInvitationId;
  readonly matchId: MatchId;
  readonly invitedByAccountId: AccountId;
  readonly invitedAccountId: AccountId;
  readonly slotNumber: MatchSlotNumber;
  readonly status: MatchInvitationStatus;
  readonly createdAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly respondedAt?: UnixEpochSeconds;
  readonly version: number;
  readonly match: MatchInvitationMatchSnapshot;
}

export interface AppliedMatchInvitationCommand {
  readonly commandId: MatchInvitationCommandId;
  readonly invitationId: MatchInvitationId;
  readonly matchId: MatchId;
  readonly actorAccountId: AccountId;
  readonly requestDigest: MatchInvitationRequestDigest;
  readonly commandType: MatchInvitationCommandType;
  readonly resultType: MatchInvitationResultType;
  readonly appliedAt: UnixEpochSeconds;
  readonly invitationVersion: number;
  readonly matchStatus: MatchStatus;
  readonly participantId?: MatchParticipantId;
  readonly matchVersion?: number;
}

export function isMatchInvitationCommandId(
  value: unknown,
): value is MatchInvitationCommandId {
  return isInternalUuid(value);
}

export function isMatchInvitationRequestDigest(
  value: unknown,
): value is MatchInvitationRequestDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}
