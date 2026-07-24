import { QueryResultRow } from 'pg';
import {
  ACCOUNT_STATUSES,
  USER_ROLES,
  isAccountId,
} from '../accounts/account.types';
import { isExternalIdentityId } from '../accounts/external-identity-lifecycle.types';
import { EXTERNAL_IDENTITY_PROVIDERS } from '../accounts/external-identity.types';
import {
  AUTHENTICATION_INTENTS,
  isAuthenticationOperationId,
  unixEpochSeconds,
} from '../auth/auth.types';
import {
  FRESH_AUTHENTICATION_VERIFICATION_METHODS,
  isFreshAuthenticationEvidenceId,
} from '../auth/fresh-authentication.types';
import { isOtpChallengeId } from '../auth/otp.types';
import {
  SCOPED_GRANT_SCOPES,
  isScopedGrantId,
} from '../auth/scoped-grant.state-machine';
import {
  SECURITY_AUDIT_AGGREGATE_TYPES,
  SECURITY_AUDIT_EVENT_TYPES,
  SECURITY_AUDIT_GRANT_STATUSES,
  SECURITY_AUDIT_OPERATION_TERMINAL_STATUSES,
  SECURITY_AUDIT_OTP_STATUSES,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_SESSION_STATUSES,
  SecurityAuditEvent,
  SecurityAuditEventId,
  SecurityAuditEventType,
  SecurityAuditMetadata,
  SecurityAuditOutcome,
  createSecurityAuditEvent,
  createSecurityAuditMetadata,
} from '../auth/security-audit.types';
import { isSessionId } from '../auth/session.types';
import { isInternalUuid } from '../common/internal-uuid';
import { decodePostgresNonNegativeBigint } from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import {
  SecurityAuditAppendResult,
  SecurityAuditPersistenceError,
  SecurityAuditPersistenceFailure,
  SecurityAuditRepository,
} from './security-audit.repository';

const INSERT_SECURITY_AUDIT_EVENT_SQL = `
  INSERT INTO backend_auth.security_audit_events (
    event_id, event_type, outcome, occurred_at,
    account_id, role, previous_status, next_status,
    identity_id, provider, reserved_account_id, attempted_account_id,
    operation_id, attempted_operation_id, intent, terminal_status,
    challenge_id, otp_status, session_id, session_status, generation,
    evidence_id, verification_method, grant_id, scope, grant_status,
    aggregate_type, aggregate_id
  )
  VALUES (
    $1, $2, $3, $4,
    $5, $6, $7, $8,
    $9, $10, $11, $12,
    $13, $14, $15, $16,
    $17, $18, $19, $20, $21,
    $22, $23, $24, $25, $26,
    $27, $28
  )
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id
`;

const SELECT_SECURITY_AUDIT_EVENT_SQL = `
  SELECT
    event_id, event_type, outcome, occurred_at,
    account_id, role, previous_status, next_status,
    identity_id, provider, reserved_account_id, attempted_account_id,
    operation_id, attempted_operation_id, intent, terminal_status,
    challenge_id, otp_status, session_id, session_status, generation,
    evidence_id, verification_method, grant_id, scope, grant_status,
    aggregate_type, aggregate_id
  FROM backend_auth.security_audit_events
  WHERE event_id = $1
`;

const APPENDED_RESULT: SecurityAuditAppendResult = Object.freeze({
  status: 'appended',
});
const IDEMPOTENT_RETRY_RESULT: SecurityAuditAppendResult = Object.freeze({
  status: 'idempotent_retry',
});
const EVENT_ID_CONFLICT_RESULT: SecurityAuditAppendResult = Object.freeze({
  status: 'event_id_conflict',
});

const ATTEMPTED_OPERATION_OUTCOMES: readonly SecurityAuditOutcome[] =
  Object.freeze([
    'replay_detected',
    'conflict',
    'dependency_failure',
  ]);

interface InsertedSecurityAuditEventRow extends QueryResultRow {
  readonly event_id: unknown;
}

interface SecurityAuditEventRow extends QueryResultRow {
  readonly event_id: unknown;
  readonly event_type: unknown;
  readonly outcome: unknown;
  readonly occurred_at: unknown;
  readonly account_id: unknown;
  readonly role: unknown;
  readonly previous_status: unknown;
  readonly next_status: unknown;
  readonly identity_id: unknown;
  readonly provider: unknown;
  readonly reserved_account_id: unknown;
  readonly attempted_account_id: unknown;
  readonly operation_id: unknown;
  readonly attempted_operation_id: unknown;
  readonly intent: unknown;
  readonly terminal_status: unknown;
  readonly challenge_id: unknown;
  readonly otp_status: unknown;
  readonly session_id: unknown;
  readonly session_status: unknown;
  readonly generation: unknown;
  readonly evidence_id: unknown;
  readonly verification_method: unknown;
  readonly grant_id: unknown;
  readonly scope: unknown;
  readonly grant_status: unknown;
  readonly aggregate_type: unknown;
  readonly aggregate_id: unknown;
}

interface ComparableSecurityAuditEvent {
  eventId: string;
  eventType: SecurityAuditEventType;
  outcome: SecurityAuditOutcome;
  occurredAt: number;
  accountId: string | null;
  role: string | null;
  previousStatus: string | null;
  nextStatus: string | null;
  identityId: string | null;
  provider: string | null;
  reservedAccountId: string | null;
  attemptedAccountId: string | null;
  operationId: string | null;
  attemptedOperationId: string | null;
  intent: string | null;
  terminalStatus: string | null;
  challengeId: string | null;
  otpStatus: string | null;
  sessionId: string | null;
  sessionStatus: string | null;
  generation: number | null;
  evidenceId: string | null;
  verificationMethod: string | null;
  grantId: string | null;
  scope: string | null;
  grantStatus: string | null;
  aggregateType: string | null;
  aggregateId: string | null;
}

type SecurityAuditEventUnion = {
  [EventType in SecurityAuditEventType]: SecurityAuditEvent<EventType>;
}[SecurityAuditEventType];

function storageFailure(): SecurityAuditPersistenceError {
  return new SecurityAuditPersistenceError('storage_failure');
}

function isClosedValue<Value extends string>(
  value: unknown,
  values: readonly Value[],
): value is Value {
  return (
    typeof value === 'string' &&
    (values as readonly string[]).includes(value)
  );
}

function requireClosedValue<Value extends string>(
  value: string | null,
  values: readonly Value[],
): Value {
  if (!isClosedValue(value, values)) {
    throw storageFailure();
  }

  return value;
}

function requireIdentifier<Value extends string>(
  value: string | null,
  guard: (candidate: unknown) => candidate is Value,
): Value {
  if (!guard(value)) {
    throw storageFailure();
  }

  return value;
}

function readNullableText(value: unknown): string | null {
  if (value === null || typeof value === 'string') {
    return value;
  }

  throw storageFailure();
}

function readNullableIdentifier(value: unknown): string | null {
  if (value === null || isInternalUuid(value)) {
    return value;
  }

  throw storageFailure();
}

function readPositiveGeneration(value: unknown): number | null {
  if (value === null) {
    return null;
  }

  const generation = decodePostgresNonNegativeBigint(value);
  if (generation === 0) {
    throw storageFailure();
  }

  return generation;
}

function readPersistedRow(
  row: SecurityAuditEventRow,
): ComparableSecurityAuditEvent {
  if (!isInternalUuid(row.event_id)) {
    throw storageFailure();
  }

  return {
    eventId: row.event_id,
    eventType: requireClosedValue(
      readNullableText(row.event_type),
      SECURITY_AUDIT_EVENT_TYPES,
    ),
    outcome: requireClosedValue(
      readNullableText(row.outcome),
      SECURITY_AUDIT_OUTCOMES,
    ),
    occurredAt: decodePostgresNonNegativeBigint(row.occurred_at),
    accountId: readNullableIdentifier(row.account_id),
    role: readNullableText(row.role),
    previousStatus: readNullableText(row.previous_status),
    nextStatus: readNullableText(row.next_status),
    identityId: readNullableIdentifier(row.identity_id),
    provider: readNullableText(row.provider),
    reservedAccountId: readNullableIdentifier(row.reserved_account_id),
    attemptedAccountId: readNullableIdentifier(row.attempted_account_id),
    operationId: readNullableIdentifier(row.operation_id),
    attemptedOperationId: readNullableIdentifier(
      row.attempted_operation_id,
    ),
    intent: readNullableText(row.intent),
    terminalStatus: readNullableText(row.terminal_status),
    challengeId: readNullableIdentifier(row.challenge_id),
    otpStatus: readNullableText(row.otp_status),
    sessionId: readNullableIdentifier(row.session_id),
    sessionStatus: readNullableText(row.session_status),
    generation: readPositiveGeneration(row.generation),
    evidenceId: readNullableIdentifier(row.evidence_id),
    verificationMethod: readNullableText(row.verification_method),
    grantId: readNullableIdentifier(row.grant_id),
    scope: readNullableText(row.scope),
    grantStatus: readNullableText(row.grant_status),
    aggregateType: readNullableText(row.aggregate_type),
    aggregateId: readNullableIdentifier(row.aggregate_id),
  };
}

function createPersistedEvent<EventType extends SecurityAuditEventType>(
  persisted: ComparableSecurityAuditEvent,
  eventType: EventType,
  metadata: SecurityAuditMetadata<EventType>,
): SecurityAuditEvent<EventType> {
  return createSecurityAuditEvent({
    eventId: persisted.eventId as SecurityAuditEventId,
    eventType,
    outcome: persisted.outcome,
    occurredAt: unixEpochSeconds(persisted.occurredAt),
    metadata,
  });
}

function decodePersistedEvent(
  persisted: ComparableSecurityAuditEvent,
): SecurityAuditEventUnion {
  switch (persisted.eventType) {
    case 'account_created':
      return createPersistedEvent(
        persisted,
        'account_created',
        createSecurityAuditMetadata('account_created', {
          accountId: requireIdentifier(persisted.accountId, isAccountId),
          role: requireClosedValue(persisted.role, USER_ROLES),
        }),
      );
    case 'account_status_changed':
      return createPersistedEvent(
        persisted,
        'account_status_changed',
        createSecurityAuditMetadata('account_status_changed', {
          accountId: requireIdentifier(persisted.accountId, isAccountId),
          previousStatus: requireClosedValue(
            persisted.previousStatus,
            ACCOUNT_STATUSES,
          ),
          nextStatus: requireClosedValue(
            persisted.nextStatus,
            ACCOUNT_STATUSES,
          ),
        }),
      );
    case 'external_identity_linked':
    case 'external_identity_unlinked': {
      const metadata = {
        identityId: requireIdentifier(
          persisted.identityId,
          isExternalIdentityId,
        ),
        accountId: requireIdentifier(persisted.accountId, isAccountId),
        provider: requireClosedValue(
          persisted.provider,
          EXTERNAL_IDENTITY_PROVIDERS,
        ),
      };

      return persisted.eventType === 'external_identity_linked'
        ? createPersistedEvent(
            persisted,
            'external_identity_linked',
            createSecurityAuditMetadata(
              'external_identity_linked',
              metadata,
            ),
          )
        : createPersistedEvent(
            persisted,
            'external_identity_unlinked',
            createSecurityAuditMetadata(
              'external_identity_unlinked',
              metadata,
            ),
          );
    }
    case 'external_identity_transfer_blocked': {
      const reservedAccountId = requireIdentifier(
        persisted.reservedAccountId,
        isAccountId,
      );
      const attemptedAccountId = requireIdentifier(
        persisted.attemptedAccountId,
        isAccountId,
      );
      if (reservedAccountId === attemptedAccountId) {
        throw storageFailure();
      }

      return createPersistedEvent(
        persisted,
        'external_identity_transfer_blocked',
        createSecurityAuditMetadata(
          'external_identity_transfer_blocked',
          {
            identityId: requireIdentifier(
              persisted.identityId,
              isExternalIdentityId,
            ),
            reservedAccountId,
            attemptedAccountId,
            provider: requireClosedValue(
              persisted.provider,
              EXTERNAL_IDENTITY_PROVIDERS,
            ),
          },
        ),
      );
    }
    case 'authentication_operation_terminal':
      return createPersistedEvent(
        persisted,
        'authentication_operation_terminal',
        createSecurityAuditMetadata('authentication_operation_terminal', {
          operationId: requireIdentifier(
            persisted.operationId,
            isAuthenticationOperationId,
          ),
          intent: requireClosedValue(
            persisted.intent,
            AUTHENTICATION_INTENTS,
          ),
          terminalStatus: requireClosedValue(
            persisted.terminalStatus,
            SECURITY_AUDIT_OPERATION_TERMINAL_STATUSES,
          ),
        }),
      );
    case 'telegram_proof_consumption':
      if (
        persisted.operationId !== null &&
        persisted.attemptedOperationId === null
      ) {
        return createPersistedEvent(
          persisted,
          'telegram_proof_consumption',
          createSecurityAuditMetadata('telegram_proof_consumption', {
            operationId: requireIdentifier(
              persisted.operationId,
              isAuthenticationOperationId,
            ),
          }),
        );
      }

      if (
        persisted.operationId === null &&
        persisted.attemptedOperationId !== null &&
        ATTEMPTED_OPERATION_OUTCOMES.includes(persisted.outcome)
      ) {
        return createPersistedEvent(
          persisted,
          'telegram_proof_consumption',
          createSecurityAuditMetadata('telegram_proof_consumption', {
            attemptedOperationId: requireIdentifier(
              persisted.attemptedOperationId,
              isAuthenticationOperationId,
            ),
          }),
        );
      }

      throw storageFailure();
    case 'otp_challenge_transition':
      return createPersistedEvent(
        persisted,
        'otp_challenge_transition',
        createSecurityAuditMetadata('otp_challenge_transition', {
          challengeId: requireIdentifier(
            persisted.challengeId,
            isOtpChallengeId,
          ),
          status: requireClosedValue(
            persisted.otpStatus,
            SECURITY_AUDIT_OTP_STATUSES,
          ),
        }),
      );
    case 'session_family_created':
      return createPersistedEvent(
        persisted,
        'session_family_created',
        createSecurityAuditMetadata('session_family_created', {
          sessionId: requireIdentifier(persisted.sessionId, isSessionId),
          accountId: requireIdentifier(persisted.accountId, isAccountId),
          authenticationOperationId: requireIdentifier(
            persisted.operationId,
            isAuthenticationOperationId,
          ),
        }),
      );
    case 'session_family_transition':
      return createPersistedEvent(
        persisted,
        'session_family_transition',
        createSecurityAuditMetadata('session_family_transition', {
          sessionId: requireIdentifier(persisted.sessionId, isSessionId),
          status: requireClosedValue(
            persisted.sessionStatus,
            SECURITY_AUDIT_SESSION_STATUSES,
          ),
        }),
      );
    case 'session_credential_rotation':
      if (persisted.generation === null) {
        throw storageFailure();
      }

      return createPersistedEvent(
        persisted,
        'session_credential_rotation',
        createSecurityAuditMetadata('session_credential_rotation', {
          sessionId: requireIdentifier(persisted.sessionId, isSessionId),
          generation: persisted.generation,
        }),
      );
    case 'fresh_authentication_issued':
      return createPersistedEvent(
        persisted,
        'fresh_authentication_issued',
        createSecurityAuditMetadata('fresh_authentication_issued', {
          evidenceId: requireIdentifier(
            persisted.evidenceId,
            isFreshAuthenticationEvidenceId,
          ),
          accountId: requireIdentifier(persisted.accountId, isAccountId),
          sessionId: requireIdentifier(persisted.sessionId, isSessionId),
          verificationMethod: requireClosedValue(
            persisted.verificationMethod,
            FRESH_AUTHENTICATION_VERIFICATION_METHODS,
          ),
        }),
      );
    case 'reauthentication_grant_issued':
      return createPersistedEvent(
        persisted,
        'reauthentication_grant_issued',
        createSecurityAuditMetadata('reauthentication_grant_issued', {
          grantId: requireIdentifier(persisted.grantId, isScopedGrantId),
          accountId: requireIdentifier(persisted.accountId, isAccountId),
          sessionId: requireIdentifier(persisted.sessionId, isSessionId),
          scope: requireClosedValue(persisted.scope, SCOPED_GRANT_SCOPES),
        }),
      );
    case 'reauthentication_grant_transition':
      return createPersistedEvent(
        persisted,
        'reauthentication_grant_transition',
        createSecurityAuditMetadata('reauthentication_grant_transition', {
          grantId: requireIdentifier(persisted.grantId, isScopedGrantId),
          status: requireClosedValue(
            persisted.grantStatus,
            SECURITY_AUDIT_GRANT_STATUSES,
          ),
        }),
      );
    case 'persisted_auth_state_rejected':
      return createPersistedEvent(
        persisted,
        'persisted_auth_state_rejected',
        createSecurityAuditMetadata('persisted_auth_state_rejected', {
          aggregateType: requireClosedValue(
            persisted.aggregateType,
            SECURITY_AUDIT_AGGREGATE_TYPES,
          ),
          aggregateId: requireIdentifier(
            persisted.aggregateId,
            isInternalUuid,
          ),
        }),
      );
  }
}

function serializeEvent(
  event: SecurityAuditEventUnion,
): ComparableSecurityAuditEvent {
  const persisted: ComparableSecurityAuditEvent = {
    eventId: event.eventId,
    eventType: event.eventType,
    outcome: event.outcome,
    occurredAt: event.occurredAt,
    accountId: null,
    role: null,
    previousStatus: null,
    nextStatus: null,
    identityId: null,
    provider: null,
    reservedAccountId: null,
    attemptedAccountId: null,
    operationId: null,
    attemptedOperationId: null,
    intent: null,
    terminalStatus: null,
    challengeId: null,
    otpStatus: null,
    sessionId: null,
    sessionStatus: null,
    generation: null,
    evidenceId: null,
    verificationMethod: null,
    grantId: null,
    scope: null,
    grantStatus: null,
    aggregateType: null,
    aggregateId: null,
  };

  switch (event.eventType) {
    case 'account_created':
      persisted.accountId = event.metadata.accountId;
      persisted.role = event.metadata.role;
      break;
    case 'account_status_changed':
      persisted.accountId = event.metadata.accountId;
      persisted.previousStatus = event.metadata.previousStatus;
      persisted.nextStatus = event.metadata.nextStatus;
      break;
    case 'external_identity_linked':
    case 'external_identity_unlinked':
      persisted.identityId = event.metadata.identityId;
      persisted.accountId = event.metadata.accountId;
      persisted.provider = event.metadata.provider;
      break;
    case 'external_identity_transfer_blocked':
      persisted.identityId = event.metadata.identityId;
      persisted.reservedAccountId = event.metadata.reservedAccountId;
      persisted.attemptedAccountId = event.metadata.attemptedAccountId;
      persisted.provider = event.metadata.provider;
      break;
    case 'authentication_operation_terminal':
      persisted.operationId = event.metadata.operationId;
      persisted.intent = event.metadata.intent;
      persisted.terminalStatus = event.metadata.terminalStatus;
      break;
    case 'telegram_proof_consumption':
      if (event.metadata.operationId !== undefined) {
        persisted.operationId = event.metadata.operationId;
      } else {
        persisted.attemptedOperationId =
          event.metadata.attemptedOperationId;
      }
      break;
    case 'otp_challenge_transition':
      persisted.challengeId = event.metadata.challengeId;
      persisted.otpStatus = event.metadata.status;
      break;
    case 'session_family_created':
      persisted.sessionId = event.metadata.sessionId;
      persisted.accountId = event.metadata.accountId;
      persisted.operationId = event.metadata.authenticationOperationId;
      break;
    case 'session_family_transition':
      persisted.sessionId = event.metadata.sessionId;
      persisted.sessionStatus = event.metadata.status;
      break;
    case 'session_credential_rotation':
      persisted.sessionId = event.metadata.sessionId;
      persisted.generation = event.metadata.generation;
      break;
    case 'fresh_authentication_issued':
      persisted.evidenceId = event.metadata.evidenceId;
      persisted.accountId = event.metadata.accountId;
      persisted.sessionId = event.metadata.sessionId;
      persisted.verificationMethod = event.metadata.verificationMethod;
      break;
    case 'reauthentication_grant_issued':
      persisted.grantId = event.metadata.grantId;
      persisted.accountId = event.metadata.accountId;
      persisted.sessionId = event.metadata.sessionId;
      persisted.scope = event.metadata.scope;
      break;
    case 'reauthentication_grant_transition':
      persisted.grantId = event.metadata.grantId;
      persisted.grantStatus = event.metadata.status;
      break;
    case 'persisted_auth_state_rejected':
      persisted.aggregateType = event.metadata.aggregateType;
      persisted.aggregateId = event.metadata.aggregateId;
      break;
  }

  return persisted;
}

function comparisonValues(
  persisted: ComparableSecurityAuditEvent,
): readonly unknown[] {
  return [
    persisted.eventId,
    persisted.eventType,
    persisted.outcome,
    persisted.occurredAt,
    persisted.accountId,
    persisted.role,
    persisted.previousStatus,
    persisted.nextStatus,
    persisted.identityId,
    persisted.provider,
    persisted.reservedAccountId,
    persisted.attemptedAccountId,
    persisted.operationId,
    persisted.attemptedOperationId,
    persisted.intent,
    persisted.terminalStatus,
    persisted.challengeId,
    persisted.otpStatus,
    persisted.sessionId,
    persisted.sessionStatus,
    persisted.generation,
    persisted.evidenceId,
    persisted.verificationMethod,
    persisted.grantId,
    persisted.scope,
    persisted.grantStatus,
    persisted.aggregateType,
    persisted.aggregateId,
  ];
}

function insertValues(
  persisted: ComparableSecurityAuditEvent,
): readonly unknown[] {
  const values = [...comparisonValues(persisted)];
  values[3] = persisted.occurredAt.toString(10);
  values[20] =
    persisted.generation === null
      ? null
      : persisted.generation.toString(10);
  return values;
}

function persistedEventsEqual(
  left: ComparableSecurityAuditEvent,
  right: ComparableSecurityAuditEvent,
): boolean {
  const leftValues = comparisonValues(left);
  const rightValues = comparisonValues(right);
  return leftValues.every(
    (value, index) => Object.is(value, rightValues[index]),
  );
}

function validateInputEvent<EventType extends SecurityAuditEventType>(
  event: SecurityAuditEvent<EventType>,
): SecurityAuditEventUnion {
  try {
    return createSecurityAuditEvent(event) as SecurityAuditEventUnion;
  } catch {
    throw new SecurityAuditPersistenceError('invalid_audit_event');
  }
}

function persistenceError(error: unknown): SecurityAuditPersistenceError {
  if (error instanceof SecurityAuditPersistenceError) {
    return error;
  }

  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return storageFailure();
  }

  let reason: SecurityAuditPersistenceFailure;
  switch (classified.category) {
    case 'foreign_key_violation':
      reason = 'referential_integrity';
      break;
    case 'check_violation':
    case 'not_null_violation':
    case 'invalid_text_representation':
      reason = 'invalid_audit_event';
      break;
    case 'insufficient_privilege':
      reason = 'permission_denied';
      break;
    case 'serialization_failure':
    case 'deadlock_detected':
      reason = 'transaction_conflict';
      break;
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled':
      reason = 'database_unavailable';
      break;
    default:
      reason = 'storage_failure';
      break;
  }

  return new SecurityAuditPersistenceError(reason);
}

export class PostgresSecurityAuditRepository
  implements SecurityAuditRepository
{
  async append<EventType extends SecurityAuditEventType>(
    transaction: PostgresTransaction,
    event: SecurityAuditEvent<EventType>,
  ): Promise<SecurityAuditAppendResult> {
    try {
      const validatedEvent = validateInputEvent(event);
      const expected = serializeEvent(validatedEvent);
      const inserted =
        await transaction.query<InsertedSecurityAuditEventRow>(
          INSERT_SECURITY_AUDIT_EVENT_SQL,
          insertValues(expected),
        );

      if (inserted.rows.length === 1) {
        if (inserted.rows[0].event_id !== expected.eventId) {
          throw storageFailure();
        }

        return APPENDED_RESULT;
      }

      if (inserted.rows.length !== 0) {
        throw storageFailure();
      }

      const selected = await transaction.query<SecurityAuditEventRow>(
        SELECT_SECURITY_AUDIT_EVENT_SQL,
        [expected.eventId],
      );
      if (selected.rows.length !== 1) {
        throw storageFailure();
      }

      const persisted = readPersistedRow(selected.rows[0]);
      const decoded = decodePersistedEvent(persisted);
      const canonicalPersisted = serializeEvent(decoded);
      if (!persistedEventsEqual(persisted, canonicalPersisted)) {
        throw storageFailure();
      }

      return persistedEventsEqual(persisted, expected)
        ? IDEMPOTENT_RETRY_RESULT
        : EVENT_ID_CONFLICT_RESULT;
    } catch (error) {
      throw persistenceError(error);
    }
  }
}
