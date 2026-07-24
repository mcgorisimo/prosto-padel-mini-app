import {
  CreateActiveSessionBinding,
  SessionId,
} from '../auth/session.types';
import {
  UnixEpochSeconds,
} from '../auth/auth.types';
import { SecurityAuditEventId } from '../auth/security-audit.types';
import { PostgresTransaction } from './postgres-transaction';

export interface CreateInitialSessionInput {
  readonly binding: CreateActiveSessionBinding;
  readonly audit: {
    readonly eventId: SecurityAuditEventId;
    readonly occurredAt: UnixEpochSeconds;
  };
}

export type InitialSessionRejectionReason =
  | 'operation_not_found'
  | 'operation_not_completed'
  | 'operation_resolution_ineligible'
  | 'account_not_found'
  | 'account_not_active'
  | 'account_binding_conflict';

export type InitialSessionConflictReason =
  | 'session_binding_conflict'
  | 'credential_conflict';

interface InitialSessionSuccess {
  readonly sessionId: SessionId;
  readonly generation: 1;
  readonly expiresAt: UnixEpochSeconds;
}

export type CreateInitialSessionResult =
  | (InitialSessionSuccess & { readonly outcome: 'created' })
  | (InitialSessionSuccess & { readonly outcome: 'idempotent_retry' })
  | {
      readonly outcome: 'rejected';
      readonly reason: InitialSessionRejectionReason;
    }
  | {
      readonly outcome: 'conflict';
      readonly reason: InitialSessionConflictReason;
    };

export type InitialSessionPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'session_binding_conflict'
  | 'credential_conflict'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure'
  | 'audit_conflict';

export class InitialSessionPersistenceError extends Error {
  readonly name = 'InitialSessionPersistenceError';

  constructor(readonly reason: InitialSessionPersistenceFailure) {
    super('Initial session persistence failed');
  }
}

export interface InitialSessionRepository {
  createInitialSession(
    transaction: PostgresTransaction,
    input: CreateInitialSessionInput,
  ): Promise<CreateInitialSessionResult>;
}
