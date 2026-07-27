import { UnixEpochSeconds } from '../auth/auth.types';
import { SecurityAuditEventId } from '../auth/security-audit.types';
import {
  SessionCommandId,
  SessionCredentialDigest,
  SessionRequestDigest,
} from '../auth/session.types';
import { PostgresTransaction } from './postgres-transaction';

export interface ApplyPresentedSessionCredentialInput {
  readonly presentedCredentialDigest: SessionCredentialDigest;
  readonly nextCredentialDigest: SessionCredentialDigest;
  readonly commandId: SessionCommandId;
  readonly requestDigest: SessionRequestDigest;
  readonly now: UnixEpochSeconds;
  readonly audit: {
    readonly eventId: SecurityAuditEventId;
  };
}

export type SessionCredentialLifecyclePersistence =
  | 'applied'
  | 'idempotent_retry';

export type ApplyPresentedSessionCredentialResult =
  | {
      readonly outcome: 'credential_rotated';
      readonly persistence: SessionCredentialLifecyclePersistence;
      readonly generation: number;
      readonly expiresAt: UnixEpochSeconds;
    }
  | {
      readonly outcome: 'session_expired';
      readonly persistence: SessionCredentialLifecyclePersistence;
      readonly expiresAt: UnixEpochSeconds;
    }
  | {
      readonly outcome: 'credential_reuse_detected';
      readonly persistence: SessionCredentialLifecyclePersistence;
      readonly expiresAt: UnixEpochSeconds;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'credential_not_found'
        | 'session_closed'
        | 'command_reuse_conflict'
        | 'invalid_next_credential';
    };

export type SessionCredentialLifecyclePersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'credential_conflict'
  | 'command_conflict'
  | 'audit_conflict'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class SessionCredentialLifecyclePersistenceError extends Error {
  readonly name = 'SessionCredentialLifecyclePersistenceError';

  constructor(
    readonly reason: SessionCredentialLifecyclePersistenceFailure,
  ) {
    super('Session credential lifecycle persistence failed');
  }
}

export interface SessionCredentialLifecycleRepository {
  applyPresentedCredential(
    transaction: PostgresTransaction,
    input: ApplyPresentedSessionCredentialInput,
  ): Promise<ApplyPresentedSessionCredentialResult>;
}
