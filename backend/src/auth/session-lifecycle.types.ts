import { UnixEpochSeconds } from './auth.types';

export interface SessionLifecycleRequestInput {
  readonly credential: string;
  readonly requestKey: string;
  readonly now: UnixEpochSeconds;
}

export type SessionRefreshRejectionReason =
  | 'invalid_request'
  | 'session_refresh_reopen_required'
  | 'session_expired'
  | 'session_invalid'
  | 'session_request_conflict'
  | 'temporary_unavailable'
  | 'internal_failure';

export type SessionRefreshResult =
  | {
      readonly outcome: 'refreshed';
      readonly credential: string;
      readonly expiresAt: UnixEpochSeconds;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: SessionRefreshRejectionReason;
    };

export type SessionLogoutRejectionReason =
  | 'invalid_request'
  | 'session_invalid'
  | 'session_request_conflict'
  | 'temporary_unavailable'
  | 'internal_failure';

export type SessionLogoutResult =
  | {
      readonly outcome: 'logged_out';
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: SessionLogoutRejectionReason;
    };
