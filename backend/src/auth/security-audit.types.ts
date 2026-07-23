import {
  ACCOUNT_STATUSES,
  USER_ROLES,
  AccountId,
  AccountStatus,
  UserRole,
} from '../accounts/account.types';
import {
  ExternalIdentityId,
  isExternalIdentityId,
} from '../accounts/external-identity-lifecycle.types';
import {
  EXTERNAL_IDENTITY_PROVIDERS,
  ExternalIdentityProvider,
} from '../accounts/external-identity.types';
import {
  InternalUuid,
  isInternalUuid,
  newInternalUuid,
} from '../common/internal-uuid';
import {
  AUTHENTICATION_INTENTS,
  AuthenticationIntent,
  AuthenticationOperationId,
  UnixEpochSeconds,
  isAuthenticationOperationId,
  isUnixEpochSeconds,
} from './auth.types';
import {
  FRESH_AUTHENTICATION_VERIFICATION_METHODS,
  FreshAuthenticationEvidenceId,
  FreshAuthenticationVerificationMethod,
  isFreshAuthenticationEvidenceId,
} from './fresh-authentication.types';
import {
  OtpChallengeId,
  isOtpChallengeId,
} from './otp.types';
import {
  SCOPED_GRANT_SCOPES,
  ScopedGrantId,
  ScopedGrantScope,
  isScopedGrantId,
} from './scoped-grant.state-machine';
import { SessionId, isSessionId } from './session.types';

export const SECURITY_AUDIT_EVENT_TYPES = Object.freeze([
  'account_created',
  'account_status_changed',
  'external_identity_linked',
  'external_identity_unlinked',
  'external_identity_transfer_blocked',
  'authentication_operation_terminal',
  'telegram_proof_consumption',
  'otp_challenge_transition',
  'session_family_created',
  'session_family_transition',
  'session_credential_rotation',
  'fresh_authentication_issued',
  'reauthentication_grant_issued',
  'reauthentication_grant_transition',
  'persisted_auth_state_rejected',
] as const);

export type SecurityAuditEventType =
  (typeof SECURITY_AUDIT_EVENT_TYPES)[number];

export const SECURITY_AUDIT_OUTCOMES = Object.freeze([
  'success',
  'idempotent_retry',
  'denied',
  'expired',
  'replay_detected',
  'conflict',
  'invalid_state',
  'dependency_failure',
] as const);

export type SecurityAuditOutcome = (typeof SECURITY_AUDIT_OUTCOMES)[number];

export const SECURITY_AUDIT_FORBIDDEN_VALUE_TYPES = Object.freeze([
  'telegram_subject',
  'phone',
  'raw_init_data',
  'otp',
  'session_credential',
  'lookup_digest',
  'credential_digest',
  'idempotency_key',
  'ciphertext',
  'name',
  'username',
  'photo_url',
  'pepper',
  'encryption_key',
] as const);

export type SecurityAuditForbiddenValueType =
  (typeof SECURITY_AUDIT_FORBIDDEN_VALUE_TYPES)[number];

export const SECURITY_AUDIT_AGGREGATE_TYPES = Object.freeze([
  'account',
  'external_identity',
  'authentication_operation',
  'telegram_proof_consumption',
  'otp_challenge',
  'session_family',
  'fresh_authentication_evidence',
  'reauthentication_grant',
] as const);

export type SecurityAuditAggregateType =
  (typeof SECURITY_AUDIT_AGGREGATE_TYPES)[number];

export const SECURITY_AUDIT_OPERATION_TERMINAL_STATUSES = Object.freeze([
  'completed',
  'failed',
  'expired',
] as const);

export const SECURITY_AUDIT_OTP_STATUSES = Object.freeze([
  'verified',
  'incorrect_code',
  'attempts_exhausted',
  'expired',
  'cancelled',
] as const);

export const SECURITY_AUDIT_SESSION_STATUSES = Object.freeze([
  'active',
  'revoked',
  'expired',
  'reuse_detected',
] as const);

export const SECURITY_AUDIT_GRANT_STATUSES = Object.freeze([
  'active',
  'consumed',
  'revoked',
  'expired',
] as const);

declare const securityAuditEventIdBrand: unique symbol;
declare const securityAuditMetadataBrand: unique symbol;

export type SecurityAuditEventId = InternalUuid & {
  readonly [securityAuditEventIdBrand]: 'SecurityAuditEventId';
};

interface SecurityAuditMetadataByEvent {
  readonly account_created: {
    readonly accountId: AccountId;
    readonly role: UserRole;
  };
  readonly account_status_changed: {
    readonly accountId: AccountId;
    readonly previousStatus: AccountStatus;
    readonly nextStatus: AccountStatus;
  };
  readonly external_identity_linked: {
    readonly identityId: ExternalIdentityId;
    readonly accountId: AccountId;
    readonly provider: ExternalIdentityProvider;
  };
  readonly external_identity_unlinked: {
    readonly identityId: ExternalIdentityId;
    readonly accountId: AccountId;
    readonly provider: ExternalIdentityProvider;
  };
  readonly external_identity_transfer_blocked: {
    readonly identityId: ExternalIdentityId;
    readonly reservedAccountId: AccountId;
    readonly attemptedAccountId: AccountId;
    readonly provider: ExternalIdentityProvider;
  };
  readonly authentication_operation_terminal: {
    readonly operationId: AuthenticationOperationId;
    readonly intent: AuthenticationIntent;
    readonly terminalStatus:
      (typeof SECURITY_AUDIT_OPERATION_TERMINAL_STATUSES)[number];
  };
  readonly telegram_proof_consumption:
    | {
        readonly operationId: AuthenticationOperationId;
        readonly attemptedOperationId?: never;
      }
    | {
        readonly operationId?: never;
        readonly attemptedOperationId: AuthenticationOperationId;
      };
  readonly otp_challenge_transition: {
    readonly challengeId: OtpChallengeId;
    readonly status: (typeof SECURITY_AUDIT_OTP_STATUSES)[number];
  };
  readonly session_family_created: {
    readonly sessionId: SessionId;
    readonly accountId: AccountId;
    readonly authenticationOperationId: AuthenticationOperationId;
  };
  readonly session_family_transition: {
    readonly sessionId: SessionId;
    readonly status: (typeof SECURITY_AUDIT_SESSION_STATUSES)[number];
  };
  readonly session_credential_rotation: {
    readonly sessionId: SessionId;
    readonly generation: number;
  };
  readonly fresh_authentication_issued: {
    readonly evidenceId: FreshAuthenticationEvidenceId;
    readonly accountId: AccountId;
    readonly sessionId: SessionId;
    readonly verificationMethod: FreshAuthenticationVerificationMethod;
  };
  readonly reauthentication_grant_issued: {
    readonly grantId: ScopedGrantId;
    readonly accountId: AccountId;
    readonly sessionId: SessionId;
    readonly scope: ScopedGrantScope;
  };
  readonly reauthentication_grant_transition: {
    readonly grantId: ScopedGrantId;
    readonly status: (typeof SECURITY_AUDIT_GRANT_STATUSES)[number];
  };
  readonly persisted_auth_state_rejected: {
    readonly aggregateType: SecurityAuditAggregateType;
    readonly aggregateId: InternalUuid;
  };
}

export type SecurityAuditMetadata<EventType extends SecurityAuditEventType> =
  Readonly<SecurityAuditMetadataByEvent[EventType]> & {
    readonly [securityAuditMetadataBrand]: EventType;
  };

type RejectConflictingOperationReferenceKeys<Value> =
  'operationId' extends keyof Value
    ? 'attemptedOperationId' extends keyof Value
      ? never
      : unknown
    : unknown;

type RejectUnexpectedMetadataKeys<
  EventType extends SecurityAuditEventType,
  Value,
> = Exclude<
  keyof Value,
  keyof SecurityAuditMetadataByEvent[EventType]
> extends never
  ? unknown
  : never;

export interface SecurityAuditEvent<EventType extends SecurityAuditEventType> {
  readonly eventId: SecurityAuditEventId;
  readonly eventType: EventType;
  readonly outcome: SecurityAuditOutcome;
  readonly occurredAt: UnixEpochSeconds;
  readonly metadata: SecurityAuditMetadata<EventType>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isClosedValue(value: unknown, values: readonly string[]): boolean {
  return typeof value === 'string' && values.includes(value);
}

function assertMetadata(
  eventType: SecurityAuditEventType,
  value: unknown,
): asserts value is SecurityAuditMetadataByEvent[SecurityAuditEventType] {
  if (!isRecord(value)) {
    throw new TypeError('Security audit metadata is invalid');
  }

  const accountId = (candidate: unknown): boolean => isInternalUuid(candidate);
  let valid = false;
  switch (eventType) {
    case 'account_created':
      valid =
        hasExactlyKeys(value, ['accountId', 'role']) &&
        accountId(value.accountId) &&
        isClosedValue(value.role, USER_ROLES);
      break;
    case 'account_status_changed':
      valid =
        hasExactlyKeys(value, [
          'accountId',
          'previousStatus',
          'nextStatus',
        ]) &&
        accountId(value.accountId) &&
        isClosedValue(value.previousStatus, ACCOUNT_STATUSES) &&
        isClosedValue(value.nextStatus, ACCOUNT_STATUSES);
      break;
    case 'external_identity_linked':
    case 'external_identity_unlinked':
      valid =
        hasExactlyKeys(value, ['identityId', 'accountId', 'provider']) &&
        isExternalIdentityId(value.identityId) &&
        accountId(value.accountId) &&
        isClosedValue(value.provider, EXTERNAL_IDENTITY_PROVIDERS);
      break;
    case 'external_identity_transfer_blocked':
      valid =
        hasExactlyKeys(value, [
          'identityId',
          'reservedAccountId',
          'attemptedAccountId',
          'provider',
        ]) &&
        isExternalIdentityId(value.identityId) &&
        accountId(value.reservedAccountId) &&
        accountId(value.attemptedAccountId) &&
        isClosedValue(value.provider, EXTERNAL_IDENTITY_PROVIDERS);
      break;
    case 'authentication_operation_terminal':
      valid =
        hasExactlyKeys(value, ['operationId', 'intent', 'terminalStatus']) &&
        isAuthenticationOperationId(value.operationId) &&
        isClosedValue(value.intent, AUTHENTICATION_INTENTS) &&
        isClosedValue(
          value.terminalStatus,
          SECURITY_AUDIT_OPERATION_TERMINAL_STATUSES,
        );
      break;
    case 'telegram_proof_consumption':
      valid =
        (hasExactlyKeys(value, ['operationId']) &&
          isAuthenticationOperationId(value.operationId)) ||
        (hasExactlyKeys(value, ['attemptedOperationId']) &&
          isAuthenticationOperationId(value.attemptedOperationId));
      break;
    case 'otp_challenge_transition':
      valid =
        hasExactlyKeys(value, ['challengeId', 'status']) &&
        isOtpChallengeId(value.challengeId) &&
        isClosedValue(value.status, SECURITY_AUDIT_OTP_STATUSES);
      break;
    case 'session_family_created':
      valid =
        hasExactlyKeys(value, [
          'sessionId',
          'accountId',
          'authenticationOperationId',
        ]) &&
        isSessionId(value.sessionId) &&
        accountId(value.accountId) &&
        isAuthenticationOperationId(value.authenticationOperationId);
      break;
    case 'session_family_transition':
      valid =
        hasExactlyKeys(value, ['sessionId', 'status']) &&
        isSessionId(value.sessionId) &&
        isClosedValue(value.status, SECURITY_AUDIT_SESSION_STATUSES);
      break;
    case 'session_credential_rotation':
      valid =
        hasExactlyKeys(value, ['sessionId', 'generation']) &&
        isSessionId(value.sessionId) &&
        typeof value.generation === 'number' &&
        Number.isSafeInteger(value.generation) &&
        value.generation > 0;
      break;
    case 'fresh_authentication_issued':
      valid =
        hasExactlyKeys(value, [
          'evidenceId',
          'accountId',
          'sessionId',
          'verificationMethod',
        ]) &&
        isFreshAuthenticationEvidenceId(value.evidenceId) &&
        accountId(value.accountId) &&
        isSessionId(value.sessionId) &&
        isClosedValue(
          value.verificationMethod,
          FRESH_AUTHENTICATION_VERIFICATION_METHODS,
        );
      break;
    case 'reauthentication_grant_issued':
      valid =
        hasExactlyKeys(value, [
          'grantId',
          'accountId',
          'sessionId',
          'scope',
        ]) &&
        isScopedGrantId(value.grantId) &&
        accountId(value.accountId) &&
        isSessionId(value.sessionId) &&
        isClosedValue(value.scope, SCOPED_GRANT_SCOPES);
      break;
    case 'reauthentication_grant_transition':
      valid =
        hasExactlyKeys(value, ['grantId', 'status']) &&
        isScopedGrantId(value.grantId) &&
        isClosedValue(value.status, SECURITY_AUDIT_GRANT_STATUSES);
      break;
    case 'persisted_auth_state_rejected':
      valid =
        hasExactlyKeys(value, ['aggregateType', 'aggregateId']) &&
        isClosedValue(value.aggregateType, SECURITY_AUDIT_AGGREGATE_TYPES) &&
        isInternalUuid(value.aggregateId);
      break;
  }

  if (!valid) {
    throw new TypeError('Security audit metadata is invalid');
  }
}

export function createSecurityAuditMetadata<
  const EventType extends SecurityAuditEventType,
  const Value extends SecurityAuditMetadataByEvent[EventType],
>(
  eventType: EventType,
  value: Value &
    RejectUnexpectedMetadataKeys<EventType, Value> &
    RejectConflictingOperationReferenceKeys<Value>,
): SecurityAuditMetadata<EventType> {
  assertMetadata(eventType, value);
  return Object.freeze({ ...value }) as SecurityAuditMetadata<EventType>;
}

export function newSecurityAuditEventId(): SecurityAuditEventId {
  return newInternalUuid() as SecurityAuditEventId;
}

export function createSecurityAuditEvent<
  EventType extends SecurityAuditEventType,
>(input: SecurityAuditEvent<EventType>): SecurityAuditEvent<EventType> {
  if (
    !isInternalUuid(input.eventId) ||
    !isClosedValue(input.eventType, SECURITY_AUDIT_EVENT_TYPES) ||
    !isClosedValue(input.outcome, SECURITY_AUDIT_OUTCOMES) ||
    !isUnixEpochSeconds(input.occurredAt)
  ) {
    throw new TypeError('Security audit event is invalid');
  }

  assertMetadata(input.eventType, input.metadata);
  return Object.freeze({
    eventId: input.eventId,
    eventType: input.eventType,
    outcome: input.outcome,
    occurredAt: input.occurredAt,
    metadata: input.metadata,
  });
}
