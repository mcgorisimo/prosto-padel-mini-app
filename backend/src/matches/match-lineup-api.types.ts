import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { MatchPublicPlayerResponse } from './match-api.types';
import {
  MatchLineupAssignmentId,
  MatchLineupCourtSide,
  MatchLineupMutationRecord,
  MatchLineupStatus,
  MatchLineupTeamNumber,
} from './match-lineup.types';
import { MatchId } from './match.types';

export interface MatchLineupApiActor {
  readonly accountId: AccountId;
  readonly role: 'player' | 'club_admin';
}

export interface AssignMatchLineupSlotRequest {
  readonly requestKey: string;
  readonly teamNumber: MatchLineupTeamNumber;
  readonly courtSide: MatchLineupCourtSide;
}

export interface ReleaseMatchLineupSlotRequest {
  readonly requestKey: string;
}

export interface ReadMatchLineupApiInput extends MatchLineupApiActor {
  readonly matchId: MatchId;
}

export interface AssignMatchLineupSlotApiInput extends MatchLineupApiActor {
  readonly matchId: MatchId;
  readonly request: AssignMatchLineupSlotRequest;
}

export interface ReleaseMatchLineupSlotApiInput extends MatchLineupApiActor {
  readonly matchId: MatchId;
  readonly request: ReleaseMatchLineupSlotRequest;
}

export type MatchLineupPlayerResponse =
  | MatchPublicPlayerResponse
  | { readonly unavailable: true };

export interface MatchLineupSlotResponse {
  readonly teamNumber: MatchLineupTeamNumber;
  readonly courtSide: MatchLineupCourtSide;
  readonly assignment?: {
    readonly assignmentId: MatchLineupAssignmentId;
    readonly player: MatchLineupPlayerResponse;
    readonly assignedAt: UnixEpochSeconds;
    readonly isCurrentPlayer: boolean;
  };
}

export interface MatchLineupResponse {
  readonly matchId: MatchId;
  readonly status: MatchLineupStatus;
  readonly version: number;
  readonly slots: readonly MatchLineupSlotResponse[];
  readonly unassignedPlayers: readonly MatchLineupPlayerResponse[];
}

export type MatchLineupApiRejection =
  | 'invalid_request'
  | 'forbidden'
  | 'match_not_found'
  | 'match_closed'
  | 'match_started'
  | 'participant_not_active'
  | 'lineup_locked'
  | 'slot_occupied'
  | 'already_assigned'
  | 'not_assigned'
  | 'request_conflict'
  | 'temporary_unavailable'
  | 'internal_failure';

export type ReadMatchLineupApiResult =
  | { readonly outcome: 'found'; readonly lineup: MatchLineupResponse }
  | { readonly outcome: 'rejected'; readonly reason: MatchLineupApiRejection };

export type MutateMatchLineupApiResult =
  | {
      readonly outcome: 'lineup_slot_claimed' | 'lineup_slot_moved' | 'lineup_slot_released';
      readonly assignment: MatchLineupMutationRecord;
    }
  | { readonly outcome: 'rejected'; readonly reason: MatchLineupApiRejection };
