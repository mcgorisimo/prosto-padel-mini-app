import { AccountId, UserRole } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { SessionCredentialDigest } from '../auth/session.types';
import { PostgresTransaction } from './postgres-transaction';

export interface AuthenticateSessionCredentialInput {
  readonly presentedCredentialDigest: SessionCredentialDigest;
  readonly now: UnixEpochSeconds;
}

export type AuthenticateSessionCredentialResult =
  | {
      readonly outcome: 'authenticated';
      readonly accountId: AccountId;
      readonly role: UserRole;
      readonly expiresAt: UnixEpochSeconds;
    }
  | {
      readonly outcome: 'rejected';
    };

export type SessionAuthenticationPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class SessionAuthenticationPersistenceError extends Error {
  readonly name = 'SessionAuthenticationPersistenceError';

  constructor(readonly reason: SessionAuthenticationPersistenceFailure) {
    super('Session authentication persistence failed');
  }
}

export interface SessionAuthenticationRepository {
  authenticatePresentedCredential(
    transaction: PostgresTransaction,
    input: AuthenticateSessionCredentialInput,
  ): Promise<AuthenticateSessionCredentialResult>;
}
