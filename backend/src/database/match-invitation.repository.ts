import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  MatchCommandId,
  MatchId,
  MatchInvitationId,
  MatchParticipantId,
  MatchRequestDigest,
  MatchSlotNumber,
} from '../matches/match.types';
import {
  MatchInvitationCommandId,
  MatchInvitationRecord,
  MatchInvitationRequestDigest,
} from '../matches/match-invitation.types';
import { MatchParticipantState } from '../matches/match.types';
import { PostgresTransaction } from './postgres-transaction';

export type MatchInvitationPersistence =
  | 'applied'
  | 'idempotent_retry';

export type MatchInvitationRejection =
  | 'command_reuse_conflict'
  | 'invitation_not_found'
  | 'invitation_closed'
  | 'forbidden'
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
  | 'match_conflict';

interface MatchInvitationCommandInput {
  readonly commandId: MatchInvitationCommandId;
  readonly requestDigest: MatchInvitationRequestDigest;
  readonly now: UnixEpochSeconds;
}

export interface CreateMatchInvitationInput
  extends MatchInvitationCommandInput {
  readonly invitationId: MatchInvitationId;
  readonly matchId: MatchId;
  readonly actorAccountId: AccountId;
  readonly invitedAccountId: AccountId;
  readonly slotNumber: MatchSlotNumber;
}

export interface AcceptMatchInvitationInput
  extends MatchInvitationCommandInput {
  readonly invitationId: MatchInvitationId;
  readonly actorAccountId: AccountId;
  readonly matchCommandId: MatchCommandId;
  readonly matchRequestDigest: MatchRequestDigest;
  readonly participantId: MatchParticipantId;
}

export interface RespondMatchInvitationInput
  extends MatchInvitationCommandInput {
  readonly invitationId: MatchInvitationId;
  readonly actorAccountId: AccountId;
}

export interface ListIncomingMatchInvitationsInput {
  readonly actorAccountId: AccountId;
  readonly now: UnixEpochSeconds;
  readonly limit: number;
}

export interface ListOutgoingMatchInvitationsInput {
  readonly matchId: MatchId;
  readonly actorAccountId: AccountId;
  readonly limit: number;
}

export type MatchInvitationMutationResult =
  | {
      readonly outcome:
        | 'invitation_created'
        | 'invitation_declined'
        | 'invitation_cancelled';
      readonly persistence: MatchInvitationPersistence;
      readonly invitation: MatchInvitationRecord;
    }
  | {
      readonly outcome: 'invitation_accepted';
      readonly persistence: MatchInvitationPersistence;
      readonly invitation: MatchInvitationRecord;
      readonly participant: MatchParticipantState;
      readonly matchVersion: number;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchInvitationRejection;
    };

export type ListMatchInvitationsResult =
  | {
      readonly outcome: 'found';
      readonly invitations: readonly MatchInvitationRecord[];
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'forbidden' | 'match_not_found';
    };

export type MatchInvitationPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'invitation_conflict'
  | 'command_conflict'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class MatchInvitationPersistenceError extends Error {
  readonly name = 'MatchInvitationPersistenceError';

  constructor(readonly reason: MatchInvitationPersistenceFailure) {
    super('Match invitation persistence failed');
  }
}

export interface MatchInvitationRepository {
  create(
    transaction: PostgresTransaction,
    input: CreateMatchInvitationInput,
  ): Promise<MatchInvitationMutationResult>;

  listIncoming(
    transaction: PostgresTransaction,
    input: ListIncomingMatchInvitationsInput,
  ): Promise<ListMatchInvitationsResult>;

  listOutgoing(
    transaction: PostgresTransaction,
    input: ListOutgoingMatchInvitationsInput,
  ): Promise<ListMatchInvitationsResult>;

  accept(
    transaction: PostgresTransaction,
    input: AcceptMatchInvitationInput,
  ): Promise<MatchInvitationMutationResult>;

  decline(
    transaction: PostgresTransaction,
    input: RespondMatchInvitationInput,
  ): Promise<MatchInvitationMutationResult>;

  cancel(
    transaction: PostgresTransaction,
    input: RespondMatchInvitationInput,
  ): Promise<MatchInvitationMutationResult>;
}
