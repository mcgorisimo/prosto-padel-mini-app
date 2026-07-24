import {
  ExternalIdentityLookupDigest,
  ExternalIdentityNamespace,
} from '../accounts/external-identity.types';
import {
  AuthenticationOperationId,
  TelegramAuthenticationProofReference,
  UnixEpochSeconds,
} from '../auth/auth.types';
import { PendingAuthenticationOperation } from '../auth/authentication-operation.state-machine';
import { SecurityAuditEventId } from '../auth/security-audit.types';
import { TelegramProofConsumptionRecord } from '../auth/telegram-proof-consumption.state-machine';
import { PostgresTransaction } from './postgres-transaction';

export interface PendingTelegramAuthenticationOperation
  extends Omit<
    PendingAuthenticationOperation,
    'identityKey' | 'proofReference'
  > {
  readonly identityKey: {
    readonly provider: 'telegram';
    readonly namespace: ExternalIdentityNamespace;
    readonly lookup: {
      readonly kind: 'lookup_digest';
      readonly digest: ExternalIdentityLookupDigest;
    };
  };
  readonly proofReference: TelegramAuthenticationProofReference;
}

export interface PersistPendingTelegramAuthenticationInput {
  readonly operation: PendingTelegramAuthenticationOperation;
  readonly consumption: TelegramProofConsumptionRecord;
  readonly audit: {
    readonly eventId: SecurityAuditEventId;
    readonly occurredAt: UnixEpochSeconds;
  };
}

export type TelegramAuthenticationOperationResult =
  | {
      readonly outcome: 'created';
      readonly operationId: AuthenticationOperationId;
    }
  | {
      readonly outcome: 'idempotent_retry';
      readonly operationId: AuthenticationOperationId;
    }
  | {
      readonly outcome: 'conflict';
      readonly reason:
        | 'idempotency_key_conflict'
        | 'operation_binding_conflict';
    }
  | {
      readonly outcome: 'replay';
      readonly reason: 'proof_already_consumed';
    };

export type TelegramAuthenticationOperationPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'referential_integrity'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure'
  | 'audit_conflict';

export class TelegramAuthenticationOperationPersistenceError extends Error {
  readonly name = 'TelegramAuthenticationOperationPersistenceError';

  constructor(
    readonly reason: TelegramAuthenticationOperationPersistenceFailure,
  ) {
    super('Telegram authentication operation persistence failed');
  }
}

export interface TelegramAuthenticationOperationRepository {
  persistPending(
    transaction: PostgresTransaction,
    input: PersistPendingTelegramAuthenticationInput,
  ): Promise<TelegramAuthenticationOperationResult>;
}
