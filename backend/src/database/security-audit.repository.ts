import {
  SecurityAuditEvent,
  SecurityAuditEventType,
} from '../auth/security-audit.types';
import { PostgresTransaction } from './postgres-transaction';

export type SecurityAuditAppendResult =
  | { readonly status: 'appended' }
  | { readonly status: 'idempotent_retry' }
  | { readonly status: 'event_id_conflict' };

export type SecurityAuditPersistenceFailure =
  | 'referential_integrity'
  | 'invalid_audit_event'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class SecurityAuditPersistenceError extends Error {
  readonly name = 'SecurityAuditPersistenceError';

  constructor(readonly reason: SecurityAuditPersistenceFailure) {
    super('Security audit persistence failed');
  }
}

export interface SecurityAuditRepository {
  append<EventType extends SecurityAuditEventType>(
    transaction: PostgresTransaction,
    event: SecurityAuditEvent<EventType>,
  ): Promise<SecurityAuditAppendResult>;
}
