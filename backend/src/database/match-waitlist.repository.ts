import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  MatchWaitlistCommandId,
  MatchWaitlistEntryId,
  MatchWaitlistMutationRecord,
  MatchWaitlistRequestDigest,
  WaitingMatchWaitlistEntryRecord,
} from '../matches/match-waitlist.types';
import { MatchId } from '../matches/match.types';
import { PostgresTransaction } from './postgres-transaction';

export interface JoinMatchWaitlistInput {
  readonly commandId: MatchWaitlistCommandId;
  readonly entryId: MatchWaitlistEntryId;
  readonly matchId: MatchId;
  readonly actorAccountId: AccountId;
  readonly requestDigest: MatchWaitlistRequestDigest;
  readonly now: UnixEpochSeconds;
}

export interface LeaveMatchWaitlistInput {
  readonly commandId: MatchWaitlistCommandId;
  readonly matchId: MatchId;
  readonly actorAccountId: AccountId;
  readonly requestDigest: MatchWaitlistRequestDigest;
  readonly now: UnixEpochSeconds;
}

export interface ListMatchWaitlistInput {
  readonly matchId: MatchId;
  readonly actorAccountId: AccountId;
  readonly limit: number;
}

export type MatchWaitlistRejection =
  | 'command_reuse_conflict'
  | 'match_not_found'
  | 'match_closed'
  | 'match_started'
  | 'match_not_full'
  | 'owner_cannot_join'
  | 'already_joined'
  | 'invitation_pending'
  | 'already_waiting'
  | 'not_waiting'
  | 'player_not_found'
  | 'rating_verification_required'
  | 'rating_out_of_range';

export type MutateMatchWaitlistResult =
  | {
      readonly outcome: 'waitlist_joined' | 'waitlist_left';
      readonly persistence: 'applied' | 'idempotent_retry';
      readonly entry: MatchWaitlistMutationRecord;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: MatchWaitlistRejection;
    };

export type ListMatchWaitlistResult =
  | {
      readonly outcome: 'found';
      readonly entries: readonly WaitingMatchWaitlistEntryRecord[];
      readonly current?: WaitingMatchWaitlistEntryRecord;
      readonly count: number;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'match_not_found';
    };

export type ReadMatchWaitlistPromotionCandidateResult =
  | {
      readonly outcome: 'candidate';
      readonly entry: WaitingMatchWaitlistEntryRecord;
      readonly playerIsActive: boolean;
    }
  | {
      readonly outcome: 'empty' | 'match_unavailable';
    };

export interface ResolveMatchWaitlistPromotionInput {
  readonly entryId: MatchWaitlistEntryId;
  readonly matchId: MatchId;
  readonly accountId: AccountId;
  readonly outcome: 'promoted' | 'skipped';
  readonly now: UnixEpochSeconds;
}

export interface ResolveWaitingMatchWaitlistAccountInput {
  readonly matchId: MatchId;
  readonly accountId: AccountId;
  readonly now: UnixEpochSeconds;
}

export type MatchWaitlistPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'entry_conflict'
  | 'command_conflict'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class MatchWaitlistPersistenceError extends Error {
  readonly name = 'MatchWaitlistPersistenceError';

  constructor(readonly reason: MatchWaitlistPersistenceFailure) {
    super('Match waitlist persistence failed');
  }
}

export interface MatchWaitlistRepository {
  join(
    transaction: PostgresTransaction,
    input: JoinMatchWaitlistInput,
  ): Promise<MutateMatchWaitlistResult>;

  leave(
    transaction: PostgresTransaction,
    input: LeaveMatchWaitlistInput,
  ): Promise<MutateMatchWaitlistResult>;

  list(
    transaction: PostgresTransaction,
    input: ListMatchWaitlistInput,
  ): Promise<ListMatchWaitlistResult>;

  readPromotionCandidate(
    transaction: PostgresTransaction,
    input: { readonly matchId: MatchId; readonly now: UnixEpochSeconds },
  ): Promise<ReadMatchWaitlistPromotionCandidateResult>;

  resolvePromotion(
    transaction: PostgresTransaction,
    input: ResolveMatchWaitlistPromotionInput,
  ): Promise<void>;

  resolveWaitingAccount(
    transaction: PostgresTransaction,
    input: ResolveWaitingMatchWaitlistAccountInput,
  ): Promise<boolean>;
}
