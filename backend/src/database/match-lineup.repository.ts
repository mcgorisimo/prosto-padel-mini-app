import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  MatchLineupAssignmentId,
  MatchLineupCommandId,
  MatchLineupCourtSide,
  MatchLineupMutationRecord,
  MatchLineupRecord,
  MatchLineupRequestDigest,
  MatchLineupTeamNumber,
} from '../matches/match-lineup.types';
import { MatchId } from '../matches/match.types';
import { PostgresTransaction } from './postgres-transaction';

export interface ReadMatchLineupInput {
  readonly matchId: MatchId;
  readonly actorAccountId: AccountId;
  readonly now: UnixEpochSeconds;
}

export interface AssignMatchLineupSlotInput extends ReadMatchLineupInput {
  readonly commandId: MatchLineupCommandId;
  readonly assignmentId: MatchLineupAssignmentId;
  readonly requestDigest: MatchLineupRequestDigest;
  readonly teamNumber: MatchLineupTeamNumber;
  readonly courtSide: MatchLineupCourtSide;
}

export interface ReleaseMatchLineupSlotInput extends ReadMatchLineupInput {
  readonly commandId: MatchLineupCommandId;
  readonly requestDigest: MatchLineupRequestDigest;
}

export type MatchLineupRejection =
  | 'command_reuse_conflict'
  | 'match_not_found'
  | 'match_closed'
  | 'match_started'
  | 'participant_not_active'
  | 'lineup_locked'
  | 'slot_occupied'
  | 'already_assigned'
  | 'not_assigned';

export type ReadMatchLineupResult =
  | { readonly outcome: 'found'; readonly lineup: MatchLineupRecord }
  | { readonly outcome: 'rejected'; readonly reason: 'match_not_found' };

export type MutateMatchLineupResult =
  | {
      readonly outcome: 'lineup_slot_claimed' | 'lineup_slot_moved' | 'lineup_slot_released';
      readonly persistence: 'applied' | 'idempotent_retry';
      readonly assignment: MatchLineupMutationRecord;
    }
  | { readonly outcome: 'rejected'; readonly reason: MatchLineupRejection };

export type MatchLineupPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'assignment_conflict'
  | 'command_conflict'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class MatchLineupPersistenceError extends Error {
  readonly name = 'MatchLineupPersistenceError';

  constructor(readonly reason: MatchLineupPersistenceFailure) {
    super('Match lineup persistence failed');
  }
}

export interface MatchLineupRepository {
  read(
    transaction: PostgresTransaction,
    input: ReadMatchLineupInput,
  ): Promise<ReadMatchLineupResult>;

  assign(
    transaction: PostgresTransaction,
    input: AssignMatchLineupSlotInput,
  ): Promise<MutateMatchLineupResult>;

  release(
    transaction: PostgresTransaction,
    input: ReleaseMatchLineupSlotInput,
  ): Promise<MutateMatchLineupResult>;

  releaseForParticipantLeave(
    transaction: PostgresTransaction,
    input: ReleaseMatchLineupSlotInput,
  ): Promise<boolean>;
}
