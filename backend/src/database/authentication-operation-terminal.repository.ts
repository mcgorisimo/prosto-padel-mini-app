import {
  AuthenticationOperationCommand,
  AuthenticationOperationRejectionReason,
} from '../auth/authentication-operation.state-machine';
import {
  AuthenticationOperationId,
  UnixEpochSeconds,
} from '../auth/auth.types';
import { SecurityAuditEventId } from '../auth/security-audit.types';
import { PostgresTransaction } from './postgres-transaction';

export interface ApplyAuthenticationOperationTerminalInput {
  readonly command: AuthenticationOperationCommand;
  readonly audit: {
    readonly eventId: SecurityAuditEventId;
    readonly occurredAt: UnixEpochSeconds;
  };
}

export type AuthenticationOperationTerminalRejectionReason =
  | 'operation_not_found'
  | Extract<
      AuthenticationOperationRejectionReason,
      | 'operation_binding_conflict'
      | 'resolution_identity_conflict'
      | 'intent_outcome_incompatible'
      | 'operation_not_expired'
      | 'operation_expired'
      | 'command_reuse_conflict'
      | 'forbidden_transition'
    >;

export type AuthenticationOperationTerminalResult =
  | {
      readonly outcome: 'transitioned';
      readonly operationId: AuthenticationOperationId;
      readonly status: 'completed' | 'failed' | 'expired';
    }
  | {
      readonly outcome: 'idempotent_retry';
      readonly operationId: AuthenticationOperationId;
      readonly status: 'completed' | 'failed' | 'expired';
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: AuthenticationOperationTerminalRejectionReason;
    };

export type AuthenticationOperationTerminalPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure'
  | 'audit_conflict';

export class AuthenticationOperationTerminalPersistenceError extends Error {
  readonly name = 'AuthenticationOperationTerminalPersistenceError';

  constructor(
    readonly reason: AuthenticationOperationTerminalPersistenceFailure,
  ) {
    super('Authentication operation terminal persistence failed');
  }
}

export interface AuthenticationOperationTerminalRepository {
  applyTerminalCommand(
    transaction: PostgresTransaction,
    input: ApplyAuthenticationOperationTerminalInput,
  ): Promise<AuthenticationOperationTerminalResult>;
}
