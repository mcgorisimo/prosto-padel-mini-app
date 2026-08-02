import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from './auth.types';
import {
  AdminPlayerVerificationFilter,
  AdminRatingStateResultType,
} from '../database/admin-player-rating.repository';

export interface AdminPlayerRatingActor {
  readonly accountId: AccountId;
  readonly role: 'player' | 'club_admin';
}

export interface AdminPlayerListRequest {
  readonly search?: string;
  readonly verification: AdminPlayerVerificationFilter;
  readonly cursor?: string;
  readonly limit: number;
}

export interface AdminPlayerSummary {
  readonly accountId: AccountId;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly username: string | null;
  readonly phone: string | null;
  readonly sidePreference: 'Left' | 'Both' | 'Right' | null;
  readonly rating: number;
  readonly isVerified: boolean;
}

export interface AdminPlayerListResponse {
  readonly players: readonly AdminPlayerSummary[];
  readonly nextCursor: string | null;
}

export interface SetAdminPlayerRatingStateRequest {
  readonly requestKey: string;
  readonly rating: number;
  readonly isVerified: boolean;
}

export interface AdminPlayerRatingStateResponse {
  readonly commandId: string;
  readonly targetAccountId: AccountId;
  readonly resultType: AdminRatingStateResultType;
  readonly ratingBefore: number;
  readonly rating: number;
  readonly isVerifiedBefore: boolean;
  readonly isVerified: boolean;
  readonly appliedAt: UnixEpochSeconds;
}

export type AdminPlayerRatingApiRejection =
  | 'invalid_request'
  | 'forbidden'
  | 'player_not_found'
  | 'request_conflict'
  | 'temporary_unavailable'
  | 'internal_failure';

export type ListAdminPlayersApiResult =
  | {
      readonly outcome: 'listed';
      readonly response: AdminPlayerListResponse;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: AdminPlayerRatingApiRejection;
    };

export type SetAdminPlayerRatingStateApiResult =
  | {
      readonly outcome: 'applied';
      readonly state: AdminPlayerRatingStateResponse;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: AdminPlayerRatingApiRejection;
    };

export interface ListAdminPlayersApiInput extends AdminPlayerRatingActor {
  readonly request: AdminPlayerListRequest;
}

export interface SetAdminPlayerRatingStateApiInput
  extends AdminPlayerRatingActor {
  readonly targetAccountId: AccountId;
  readonly request: SetAdminPlayerRatingStateRequest;
}
