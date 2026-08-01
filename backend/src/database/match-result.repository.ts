import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  MatchResultCommandId,
  MatchResultId,
  MatchResultMutationRecord,
  MatchResultRecord,
  MatchResultRequestDigest,
  MatchResultSetRecord,
} from '../matches/match-result.types';
import { MatchId } from '../matches/match.types';
import { PostgresTransaction } from './postgres-transaction';

export interface ReadMatchResultInput {
  readonly matchId: MatchId;
  readonly actorAccountId: AccountId;
  readonly now: UnixEpochSeconds;
}

interface MutateMatchResultInput extends ReadMatchResultInput {
  readonly commandId: MatchResultCommandId;
  readonly requestDigest: MatchResultRequestDigest;
}

export interface SubmitMatchResultInput extends MutateMatchResultInput {
  readonly resultId: MatchResultId;
  readonly sets: readonly MatchResultSetRecord[];
}

export interface ConfirmMatchResultInput extends MutateMatchResultInput {}
export interface DisputeMatchResultInput extends MutateMatchResultInput {}

export type MatchResultRejection =
  | 'command_reuse_conflict'
  | 'match_not_found'
  | 'result_not_found'
  | 'result_exists'
  | 'match_not_finished'
  | 'match_closed'
  | 'participant_not_active'
  | 'lineup_incomplete'
  | 'result_not_pending'
  | 'same_team_confirmation'
  | 'submitter_cannot_dispute';

export type ReadMatchResultResult =
  | { readonly outcome: 'found'; readonly result: MatchResultRecord }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'match_not_found' | 'result_not_found';
    };

export type MutateMatchResultResult =
  | {
      readonly outcome:
        | 'result_submitted'
        | 'result_confirmed'
        | 'result_disputed';
      readonly persistence: 'applied' | 'idempotent_retry';
      readonly result: MatchResultMutationRecord;
    }
  | { readonly outcome: 'rejected'; readonly reason: MatchResultRejection };

export type MatchResultPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'result_conflict'
  | 'command_conflict'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class MatchResultPersistenceError extends Error {
  readonly name = 'MatchResultPersistenceError';

  constructor(readonly reason: MatchResultPersistenceFailure) {
    super('Match result persistence failed');
  }
}

export interface MatchResultRepository {
  read(
    transaction: PostgresTransaction,
    input: ReadMatchResultInput,
  ): Promise<ReadMatchResultResult>;

  submit(
    transaction: PostgresTransaction,
    input: SubmitMatchResultInput,
  ): Promise<MutateMatchResultResult>;

  confirm(
    transaction: PostgresTransaction,
    input: ConfirmMatchResultInput,
  ): Promise<MutateMatchResultResult>;

  dispute(
    transaction: PostgresTransaction,
    input: DisputeMatchResultInput,
  ): Promise<MutateMatchResultResult>;
}
