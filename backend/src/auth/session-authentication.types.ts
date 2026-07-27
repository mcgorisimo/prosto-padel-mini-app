import { AccountId, UserRole } from '../accounts/account.types';
import { UnixEpochSeconds } from './auth.types';

export interface AuthenticatedSessionPrincipal {
  readonly accountId: AccountId;
  readonly role: UserRole;
  readonly expiresAt: UnixEpochSeconds;
}

export interface SessionAuthenticationInput {
  readonly credential: string;
  readonly now: UnixEpochSeconds;
}

export type SessionAuthenticationResult =
  | {
      readonly outcome: 'authenticated';
      readonly principal: AuthenticatedSessionPrincipal;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'invalid_request'
        | 'session_invalid'
        | 'temporary_unavailable'
        | 'internal_failure';
    };
