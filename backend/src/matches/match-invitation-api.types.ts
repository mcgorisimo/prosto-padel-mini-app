import { AccountId, UserRole } from '../accounts/account.types';
import { MatchParticipantState } from './match.types';
import {
  MatchInvitationMatchSnapshot,
  MatchInvitationRecord,
} from './match-invitation.types';
import {
  MatchId,
  MatchInvitationId,
  MatchSlotNumber,
} from './match.types';
import { MatchPlayerProjectionResponse } from './match-api.types';

export interface CreateMatchInvitationRequest {
  readonly requestKey: string;
  readonly playerId: AccountId;
  readonly slotNumber: MatchSlotNumber;
}

export interface MatchInvitationActionRequest {
  readonly requestKey: string;
}

export interface MatchInvitationListRequest {
  readonly limit: number;
}

export interface MatchInvitationApiActor {
  readonly accountId: AccountId;
  readonly role: UserRole;
}

export interface CreateMatchInvitationApiInput
  extends MatchInvitationApiActor {
  readonly matchId: MatchId;
  readonly request: CreateMatchInvitationRequest;
}

export interface ListIncomingMatchInvitationsApiInput
  extends MatchInvitationApiActor {
  readonly request: MatchInvitationListRequest;
}

export interface ListOutgoingMatchInvitationsApiInput
  extends MatchInvitationApiActor {
  readonly matchId: MatchId;
  readonly request: MatchInvitationListRequest;
}

export interface MutateMatchInvitationApiInput
  extends MatchInvitationApiActor {
  readonly invitationId: MatchInvitationId;
  readonly request: MatchInvitationActionRequest;
}

export interface MatchInvitationMatchResponse
  extends MatchInvitationMatchSnapshot {
  readonly owner: MatchPlayerProjectionResponse;
}

export interface MatchInvitationResponse
  extends Omit<MatchInvitationRecord, 'match'> {
  readonly match: MatchInvitationMatchResponse;
  readonly invitedPlayer: MatchPlayerProjectionResponse;
}

export interface AcceptedMatchInvitationResponse {
  readonly invitation: MatchInvitationResponse;
  readonly participant: Pick<
    MatchParticipantState,
    'participantId' | 'accountId' | 'slotNumber' | 'status'
  >;
  readonly matchVersion: number;
}

export type MatchInvitationApiRejection =
  | 'invalid_request'
  | 'forbidden'
  | 'invitation_not_found'
  | 'invitation_closed'
  | 'match_not_found'
  | 'match_closed'
  | 'match_started'
  | 'match_full'
  | 'slot_unavailable'
  | 'already_participant'
  | 'already_invited'
  | 'player_not_found'
  | 'rating_verification_required'
  | 'rating_out_of_range'
  | 'request_conflict'
  | 'match_conflict'
  | 'temporary_unavailable'
  | 'internal_failure';

export type MatchInvitationApiMutationResult =
  | {
      readonly outcome:
        | 'invitation_created'
        | 'invitation_declined'
        | 'invitation_cancelled';
      readonly invitation: MatchInvitationResponse;
    }
  | {
      readonly outcome: 'invitation_accepted';
      readonly result: AcceptedMatchInvitationResponse;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchInvitationApiRejection;
    };
export type MatchInvitationApiListResult =
  | {
      readonly outcome: 'found';
      readonly invitations: readonly MatchInvitationResponse[];
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchInvitationApiRejection;
    };
