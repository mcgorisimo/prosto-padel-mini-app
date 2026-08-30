import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import {
  MatchWaitlistOfferCommandId,
  MatchWaitlistOfferId,
  MatchWaitlistOfferMutationRecord,
  MatchWaitlistOfferRecord,
  MatchWaitlistOfferRequestDigest,
} from '../matches/match-waitlist-offer.types';
import { MatchWaitlistEntryId } from '../matches/match-waitlist.types';
import { MatchId } from '../matches/match.types';
import { PostgresTransaction } from './postgres-transaction';

export interface CreateMatchWaitlistOfferInput {
  readonly offerId: MatchWaitlistOfferId;
  readonly entryId: MatchWaitlistEntryId;
  readonly matchId: MatchId;
  readonly accountId: AccountId;
  readonly now: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
}

export type CreateMatchWaitlistOfferResult =
  | { readonly outcome: 'created'; readonly offer: MatchWaitlistOfferRecord }
  | {
      readonly outcome:
        | 'active_offer_exists'
        | 'candidate_unavailable'
        | 'match_unavailable'
        | 'slot_unavailable';
    };

export interface ReadMatchWaitlistOfferActionInput {
  readonly commandId: MatchWaitlistOfferCommandId;
  readonly offerId: MatchWaitlistOfferId;
  readonly matchId: MatchId;
  readonly accountId: AccountId;
  readonly action: 'accept' | 'decline';
  readonly requestDigest: MatchWaitlistOfferRequestDigest;
  readonly now: UnixEpochSeconds;
}

export type ReadMatchWaitlistOfferActionResult =
  | {
      readonly outcome: 'ready';
      readonly offer: MatchWaitlistOfferRecord & { readonly status: 'active' };
    }
  | {
      readonly outcome: 'idempotent_retry';
      readonly mutation: MatchWaitlistOfferMutationRecord;
    }
  | {
      readonly outcome:
        | 'command_reuse_conflict'
        | 'offer_not_found'
        | 'offer_expired'
        | 'offer_resolved'
        | 'match_unavailable';
    };

export interface ResolveMatchWaitlistOfferInput
  extends ReadMatchWaitlistOfferActionInput {
  readonly entryId: MatchWaitlistEntryId;
  readonly status: 'accepted' | 'declined';
}

export interface ExpireMatchWaitlistOfferInput {
  readonly matchId: MatchId;
  readonly now: UnixEpochSeconds;
}

export type ExpireMatchWaitlistOfferResult =
  | { readonly outcome: 'none' }
  | {
      readonly outcome: 'expired' | 'cancelled';
      readonly offer: MatchWaitlistOfferRecord;
    };

export type MatchWaitlistOfferPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'offer_conflict'
  | 'command_conflict'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class MatchWaitlistOfferPersistenceError extends Error {
  readonly name = 'MatchWaitlistOfferPersistenceError';

  constructor(readonly reason: MatchWaitlistOfferPersistenceFailure) {
    super('Match waitlist offer persistence failed');
  }
}

export interface MatchWaitlistOfferRepository {
  create(
    transaction: PostgresTransaction,
    input: CreateMatchWaitlistOfferInput,
  ): Promise<CreateMatchWaitlistOfferResult>;

  readCurrentForAccount(
    transaction: PostgresTransaction,
    input: {
      readonly matchId: MatchId;
      readonly accountId: AccountId;
      readonly now: UnixEpochSeconds;
    },
  ): Promise<MatchWaitlistOfferRecord | undefined>;

  readAction(
    transaction: PostgresTransaction,
    input: ReadMatchWaitlistOfferActionInput,
  ): Promise<ReadMatchWaitlistOfferActionResult>;

  resolve(
    transaction: PostgresTransaction,
    input: ResolveMatchWaitlistOfferInput,
  ): Promise<MatchWaitlistOfferMutationRecord>;

  listDueMatchIds(
    transaction: PostgresTransaction,
    input: { readonly now: UnixEpochSeconds; readonly limit: number },
  ): Promise<readonly MatchId[]>;

  expireForMatch(
    transaction: PostgresTransaction,
    input: ExpireMatchWaitlistOfferInput,
  ): Promise<ExpireMatchWaitlistOfferResult>;
}
