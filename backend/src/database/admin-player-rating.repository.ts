import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { InternalUuid } from '../common/internal-uuid';
import { PostgresTransaction } from './postgres-transaction';

export type AdminPlayerVerificationFilter =
  | 'all'
  | 'verified'
  | 'unverified';

export interface AdminPlayerRecord {
  readonly accountId: AccountId;
  readonly firstName: string;
  readonly lastName?: string;
  readonly username?: string;
  readonly phone?: string;
  readonly sidePreference?: 'Left' | 'Both' | 'Right';
  readonly rating: number;
  readonly isVerified: boolean;
}

export interface ListAdminPlayersInput {
  readonly actorAccountId: AccountId;
  readonly afterAccountId?: AccountId;
  readonly search?: string;
  readonly verification: AdminPlayerVerificationFilter;
  readonly limit: number;
}

export type ListAdminPlayersResult =
  | {
      readonly outcome: 'listed';
      readonly players: readonly AdminPlayerRecord[];
      readonly nextAfterAccountId?: AccountId;
    }
  | { readonly outcome: 'forbidden' };

export type AdminRatingStateResultType =
  | 'rating_updated'
  | 'verification_updated'
  | 'rating_and_verification_updated'
  | 'rating_state_unchanged';

export interface AdminRatingStateCommandRecord {
  readonly commandId: InternalUuid;
  readonly actorAccountId: AccountId;
  readonly targetAccountId: AccountId;
  readonly resultType: AdminRatingStateResultType;
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly isVerifiedBefore: boolean;
  readonly isVerifiedAfter: boolean;
  readonly appliedAt: UnixEpochSeconds;
}

export interface SetAdminPlayerRatingStateInput {
  readonly commandId: InternalUuid;
  readonly actorAccountId: AccountId;
  readonly targetAccountId: AccountId;
  readonly requestDigest: string;
  readonly rating: number;
  readonly isVerified: boolean;
  readonly appliedAt: UnixEpochSeconds;
}

export type SetAdminPlayerRatingStateResult =
  | {
      readonly outcome: 'applied';
      readonly command: AdminRatingStateCommandRecord;
    }
  | {
      readonly outcome:
        | 'forbidden'
        | 'player_not_found'
        | 'request_conflict';
    };

export type AdminPlayerRatingPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class AdminPlayerRatingPersistenceError extends Error {
  readonly name = 'AdminPlayerRatingPersistenceError';

  constructor(readonly reason: AdminPlayerRatingPersistenceFailure) {
    super('Administrative player rating persistence failed');
  }
}

export interface AdminPlayerRatingRepository {
  listPlayers(
    transaction: PostgresTransaction,
    input: ListAdminPlayersInput,
  ): Promise<ListAdminPlayersResult>;

  setRatingState(
    transaction: PostgresTransaction,
    input: SetAdminPlayerRatingStateInput,
  ): Promise<SetAdminPlayerRatingStateResult>;
}
