import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { InternalUuid, isInternalUuid } from '../common/internal-uuid';
import { MatchWaitlistEntryId } from './match-waitlist.types';
import { MatchId, MatchSlotNumber } from './match.types';

declare const matchWaitlistOfferIdBrand: unique symbol;
declare const matchWaitlistOfferCommandIdBrand: unique symbol;
declare const matchWaitlistOfferRequestDigestBrand: unique symbol;

const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type MatchWaitlistOfferId = InternalUuid & {
  readonly [matchWaitlistOfferIdBrand]: 'MatchWaitlistOfferId';
};

export type MatchWaitlistOfferCommandId = InternalUuid & {
  readonly [matchWaitlistOfferCommandIdBrand]: 'MatchWaitlistOfferCommandId';
};

export type MatchWaitlistOfferRequestDigest = string & {
  readonly [matchWaitlistOfferRequestDigestBrand]: 'MatchWaitlistOfferRequestDigest';
};

export type MatchWaitlistOfferStatus =
  | 'active'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'cancelled';

export interface MatchWaitlistOfferRecord {
  readonly offerId: MatchWaitlistOfferId;
  readonly entryId: MatchWaitlistEntryId;
  readonly matchId: MatchId;
  readonly accountId: AccountId;
  readonly slotNumber: MatchSlotNumber;
  readonly status: MatchWaitlistOfferStatus;
  readonly offeredAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly resolvedAt?: UnixEpochSeconds;
  readonly version: 1 | 2;
}

export interface MatchWaitlistOfferMutationRecord {
  readonly offerId: MatchWaitlistOfferId;
  readonly matchId: MatchId;
  readonly status: 'accepted' | 'declined';
  readonly appliedAt: UnixEpochSeconds;
  readonly version: 2;
}

export function isMatchWaitlistOfferId(
  value: unknown,
): value is MatchWaitlistOfferId {
  return isInternalUuid(value);
}

export function isMatchWaitlistOfferCommandId(
  value: unknown,
): value is MatchWaitlistOfferCommandId {
  return isInternalUuid(value);
}

export function isMatchWaitlistOfferRequestDigest(
  value: unknown,
): value is MatchWaitlistOfferRequestDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}
