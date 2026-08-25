import { AccountId, isAccountId } from '../accounts/account.types';
import {
  InternalUuid,
  isInternalUuid,
  newInternalUuid,
} from '../common/internal-uuid';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';

export const CONTACT_VERIFICATION_FIELDS = Object.freeze([
  'phone',
  'email',
] as const);

export type ContactVerificationField =
  (typeof CONTACT_VERIFICATION_FIELDS)[number];

export const CONTACT_VERIFICATION_METHODS = Object.freeze([
  'phone_sms_otp',
  'email_code',
  'email_link',
] as const);

export type ContactVerificationMethod =
  (typeof CONTACT_VERIFICATION_METHODS)[number];

export type ContactVerificationTarget =
  | Readonly<{ field: 'phone'; method: 'phone_sms_otp' }>
  | Readonly<{
      field: 'email';
      method: 'email_code' | 'email_link';
    }>;

export const CONTACT_VERIFICATION_ABUSE_SCOPES = Object.freeze([
  'account',
  'contact',
  'network',
] as const);

export type ContactVerificationAbuseScope =
  (typeof CONTACT_VERIFICATION_ABUSE_SCOPES)[number];

export const DEFAULT_CONTACT_VERIFICATION_POLICY = Object.freeze({
  phone_sms_otp: Object.freeze({ ttlSeconds: 600, maxAttempts: 5 }),
  email_code: Object.freeze({ ttlSeconds: 600, maxAttempts: 5 }),
  email_link: Object.freeze({ ttlSeconds: 900, maxAttempts: 5 }),
  resendCooldownSeconds: 60,
  startsPer15Minutes: 3,
  startsPer24Hours: 10,
});

export const MAX_CONTACT_VERIFICATION_ATTEMPTS = 10;
export const MAX_CONTACT_VERIFICATION_TTL_SECONDS = 86_400;

declare const challengeIdBrand: unique symbol;
declare const commandIdBrand: unique symbol;
declare const idempotencyKeyBrand: unique symbol;
declare const requestDigestBrand: unique symbol;
declare const subjectDigestBrand: unique symbol;
declare const verifierDigestBrand: unique symbol;
declare const sourceDigestBrand: unique symbol;

export type ContactVerificationChallengeId = InternalUuid & {
  readonly [challengeIdBrand]: 'ContactVerificationChallengeId';
};

export type ContactVerificationCommandId = InternalUuid & {
  readonly [commandIdBrand]: 'ContactVerificationCommandId';
};

export type ContactVerificationIdempotencyKey = string & {
  readonly [idempotencyKeyBrand]: 'ContactVerificationIdempotencyKey';
};

export type ContactVerificationRequestDigest = string & {
  readonly [requestDigestBrand]: 'ContactVerificationRequestDigest';
};

/** HMAC/peppered digest of the canonical E.164 phone or lowercase email. */
export type ContactVerificationSubjectDigest = string & {
  readonly [subjectDigestBrand]: 'ContactVerificationSubjectDigest';
};

/** HMAC/peppered digest of the submitted code or single-use link token. */
export type ContactVerificationVerifierDigest = string & {
  readonly [verifierDigestBrand]: 'ContactVerificationVerifierDigest';
};

/** HMAC/peppered source key used by the abuse guard; never an audit value. */
export type ContactVerificationSourceDigest = string & {
  readonly [sourceDigestBrand]: 'ContactVerificationSourceDigest';
};

const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

function protectedDigest(value: string, label: string): string {
  if (!SHA_256_HEX_PATTERN.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function isContactVerificationChallengeId(
  value: unknown,
): value is ContactVerificationChallengeId {
  return isInternalUuid(value);
}

export function isContactVerificationCommandId(
  value: unknown,
): value is ContactVerificationCommandId {
  return isInternalUuid(value);
}

export function newContactVerificationChallengeId(): ContactVerificationChallengeId {
  return newInternalUuid() as ContactVerificationChallengeId;
}

export function newContactVerificationCommandId(): ContactVerificationCommandId {
  return newInternalUuid() as ContactVerificationCommandId;
}

export function isContactVerificationIdempotencyKey(
  value: unknown,
): value is ContactVerificationIdempotencyKey {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_IDEMPOTENCY_KEY_LENGTH &&
    value.trim() === value &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

export function contactVerificationIdempotencyKey(
  value: string,
): ContactVerificationIdempotencyKey {
  if (!isContactVerificationIdempotencyKey(value)) {
    throw new TypeError('Contact verification idempotency key is invalid');
  }
  return value;
}

export function isContactVerificationRequestDigest(
  value: unknown,
): value is ContactVerificationRequestDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function contactVerificationRequestDigest(
  value: string,
): ContactVerificationRequestDigest {
  return protectedDigest(
    value,
    'Contact verification request digest',
  ) as ContactVerificationRequestDigest;
}

export function isContactVerificationSubjectDigest(
  value: unknown,
): value is ContactVerificationSubjectDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function contactVerificationSubjectDigest(
  value: string,
): ContactVerificationSubjectDigest {
  return protectedDigest(
    value,
    'Contact verification subject digest',
  ) as ContactVerificationSubjectDigest;
}

export function isContactVerificationVerifierDigest(
  value: unknown,
): value is ContactVerificationVerifierDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function contactVerificationVerifierDigest(
  value: string,
): ContactVerificationVerifierDigest {
  return protectedDigest(
    value,
    'Contact verification verifier digest',
  ) as ContactVerificationVerifierDigest;
}

export function isContactVerificationSourceDigest(
  value: unknown,
): value is ContactVerificationSourceDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function contactVerificationSourceDigest(
  value: string,
): ContactVerificationSourceDigest {
  return protectedDigest(
    value,
    'Contact verification source digest',
  ) as ContactVerificationSourceDigest;
}

export function isContactVerificationTarget(
  field: unknown,
  method: unknown,
): field is ContactVerificationField {
  return (
    (field === 'phone' && method === 'phone_sms_otp') ||
    (field === 'email' && (method === 'email_code' || method === 'email_link'))
  );
}

interface DeliveryRequestBase {
  readonly challengeId: ContactVerificationChallengeId;
  /** Stable internal dispatch ID; adapters must not expose provider IDs. */
  readonly dispatchId: InternalUuid;
  readonly destination: string;
  readonly expiresAt: UnixEpochSeconds;
}

export type ContactVerificationDeliveryRequest =
  | (DeliveryRequestBase & {
      readonly method: 'phone_sms_otp';
      readonly plaintextCode: string;
    })
  | (DeliveryRequestBase & {
      readonly method: 'email_code';
      readonly plaintextCode: string;
    })
  | (DeliveryRequestBase & {
      readonly method: 'email_link';
      readonly singleUseToken: string;
    });

export type ContactVerificationDeliveryOutcome =
  | Readonly<{ outcome: 'accepted' }>
  | Readonly<{ outcome: 'unavailable' }>
  | Readonly<{ outcome: 'rate_limited'; retryAt: UnixEpochSeconds }>
  | Readonly<{ outcome: 'unknown' }>;

export interface ContactVerificationDeliveryPort {
  /**
   * Destination and plaintext proof are transient. The caller must never put
   * them in challenge state, audit events, ordinary logs or typed errors.
   */
  deliver(
    request: ContactVerificationDeliveryRequest,
  ): Promise<ContactVerificationDeliveryOutcome>;
}

export type ContactVerificationRateLimitOperation =
  'start' | 'resend' | 'submit';

interface ContactVerificationRateLimitRequestBase {
  readonly accountId: AccountId;
  readonly contactValueDigest: ContactVerificationSubjectDigest;
  readonly sourceDigest: ContactVerificationSourceDigest;
  readonly now: UnixEpochSeconds;
  readonly requiredScopes: typeof CONTACT_VERIFICATION_ABUSE_SCOPES;
}

export type ContactVerificationRateLimitRequest = ContactVerificationTarget &
  ContactVerificationRateLimitRequestBase &
  (
    | Readonly<{ operation: 'start' }>
    | Readonly<{
        operation: 'resend' | 'submit';
        challengeId: ContactVerificationChallengeId;
      }>
  );

export type ContactVerificationRateLimitOutcome =
  | Readonly<{
      outcome: 'allowed';
      decisionId: InternalUuid;
      checkedAt: UnixEpochSeconds;
    }>
  | Readonly<{
      outcome: 'rate_limited';
      decisionId: InternalUuid;
      checkedAt: UnixEpochSeconds;
      retryAt: UnixEpochSeconds;
    }>;

export interface ContactVerificationRateLimitPort {
  /** Consumes every required bucket atomically or returns rate_limited. */
  consume(
    request: ContactVerificationRateLimitRequest,
  ): Promise<ContactVerificationRateLimitOutcome>;
}

export type ContactVerificationAuditEvent =
  | Readonly<{
      eventId: InternalUuid;
      eventType: 'challenge_created';
      occurredAt: UnixEpochSeconds;
      accountId: AccountId;
      challengeId: ContactVerificationChallengeId;
      field: ContactVerificationField;
      method: ContactVerificationMethod;
      outcome: 'created';
    }>
  | Readonly<{
      eventId: InternalUuid;
      eventType: 'delivery_outcome';
      occurredAt: UnixEpochSeconds;
      accountId: AccountId;
      challengeId: ContactVerificationChallengeId;
      dispatchId: InternalUuid;
      field: ContactVerificationField;
      method: ContactVerificationMethod;
      outcome: ContactVerificationDeliveryOutcome['outcome'];
    }>
  | Readonly<{
      eventId: InternalUuid;
      eventType: 'challenge_transition';
      occurredAt: UnixEpochSeconds;
      accountId: AccountId;
      challengeId: ContactVerificationChallengeId;
      field: ContactVerificationField;
      method: ContactVerificationMethod;
      outcome:
        | 'verified'
        | 'incorrect_proof'
        | 'resend_reserved'
        | 'attempts_exhausted'
        | 'expired'
        | 'cancelled'
        | 'idempotent_retry'
        | 'conflict'
        | 'rate_limited';
    }>
  | Readonly<{
      eventId: InternalUuid;
      eventType: 'rate_limit_decision';
      occurredAt: UnixEpochSeconds;
      accountId: AccountId;
      decisionId: InternalUuid;
      field: ContactVerificationField;
      method: ContactVerificationMethod;
      operation: ContactVerificationRateLimitOperation;
      outcome: 'allowed' | 'rate_limited';
    }>
  | Readonly<{
      eventId: InternalUuid;
      eventType: 'contact_invalidated';
      occurredAt: UnixEpochSeconds;
      accountId: AccountId;
      field: ContactVerificationField;
      contactVersion: number;
      outcome: 'invalidated';
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function hasValidAuditBase(value: Record<string, unknown>): boolean {
  return (
    isInternalUuid(value.eventId) &&
    isUnixEpochSeconds(value.occurredAt) &&
    isAccountId(value.accountId) &&
    isContactVerificationTarget(value.field, value.method)
  );
}

const TRANSITION_AUDIT_OUTCOMES = Object.freeze([
  'verified',
  'incorrect_proof',
  'resend_reserved',
  'attempts_exhausted',
  'expired',
  'cancelled',
  'idempotent_retry',
  'conflict',
  'rate_limited',
] as const);

const DELIVERY_AUDIT_OUTCOMES = Object.freeze([
  'accepted',
  'unavailable',
  'rate_limited',
  'unknown',
] as const);

function includesString(values: readonly string[], value: unknown): boolean {
  return typeof value === 'string' && values.includes(value);
}

export function createContactVerificationAuditEvent(
  input: unknown,
): ContactVerificationAuditEvent {
  if (!isRecord(input) || typeof input.eventType !== 'string') {
    throw new TypeError('Contact verification audit event is invalid');
  }

  let valid = false;
  switch (input.eventType) {
    case 'challenge_created':
      valid =
        hasExactlyKeys(input, [
          'eventId',
          'eventType',
          'occurredAt',
          'accountId',
          'challengeId',
          'field',
          'method',
          'outcome',
        ]) &&
        hasValidAuditBase(input) &&
        isContactVerificationChallengeId(input.challengeId) &&
        input.outcome === 'created';
      break;
    case 'delivery_outcome':
      valid =
        hasExactlyKeys(input, [
          'eventId',
          'eventType',
          'occurredAt',
          'accountId',
          'challengeId',
          'dispatchId',
          'field',
          'method',
          'outcome',
        ]) &&
        hasValidAuditBase(input) &&
        isContactVerificationChallengeId(input.challengeId) &&
        isInternalUuid(input.dispatchId) &&
        includesString(DELIVERY_AUDIT_OUTCOMES, input.outcome);
      break;
    case 'challenge_transition':
      valid =
        hasExactlyKeys(input, [
          'eventId',
          'eventType',
          'occurredAt',
          'accountId',
          'challengeId',
          'field',
          'method',
          'outcome',
        ]) &&
        hasValidAuditBase(input) &&
        isContactVerificationChallengeId(input.challengeId) &&
        includesString(TRANSITION_AUDIT_OUTCOMES, input.outcome);
      break;
    case 'rate_limit_decision':
      valid =
        hasExactlyKeys(input, [
          'eventId',
          'eventType',
          'occurredAt',
          'accountId',
          'decisionId',
          'field',
          'method',
          'operation',
          'outcome',
        ]) &&
        hasValidAuditBase(input) &&
        isInternalUuid(input.decisionId) &&
        includesString(['start', 'resend', 'submit'], input.operation) &&
        includesString(['allowed', 'rate_limited'], input.outcome);
      break;
    case 'contact_invalidated':
      valid =
        hasExactlyKeys(input, [
          'eventId',
          'eventType',
          'occurredAt',
          'accountId',
          'field',
          'contactVersion',
          'outcome',
        ]) &&
        isInternalUuid(input.eventId) &&
        isUnixEpochSeconds(input.occurredAt) &&
        isAccountId(input.accountId) &&
        includesString(CONTACT_VERIFICATION_FIELDS, input.field) &&
        isPositiveInteger(input.contactVersion) &&
        input.outcome === 'invalidated';
      break;
  }

  if (!valid) {
    throw new TypeError('Contact verification audit event is invalid');
  }
  return Object.freeze({ ...input }) as ContactVerificationAuditEvent;
}

type UnverifiedContactState<Field extends ContactVerificationField> =
  | Readonly<{ field: Field; status: 'missing' }>
  | Readonly<{
      field: Field;
      status: 'unverified' | 'pending';
      contactVersion: number;
    }>;

type VerifiedContactState<
  Field extends ContactVerificationField,
  Method extends ContactVerificationMethod,
> = Readonly<{
  field: Field;
  status: 'verified';
  contactVersion: number;
  verifiedVersion: number;
  method: Method;
  verifiedAt: UnixEpochSeconds;
}>;

export type PhoneContactVerificationState =
  | UnverifiedContactState<'phone'>
  | VerifiedContactState<'phone', 'phone_sms_otp'>;

export type EmailContactVerificationState =
  | UnverifiedContactState<'email'>
  | VerifiedContactState<'email', 'email_code' | 'email_link'>;

export interface ContactCheckoutVerificationSnapshot {
  readonly accountId: AccountId;
  readonly phone: PhoneContactVerificationState;
  readonly email: EmailContactVerificationState;
}

export type ContactCheckoutEligibility =
  | Readonly<{ eligible: true }>
  | Readonly<{
      eligible: false;
      reason: 'contacts_not_verified';
      missing: readonly ContactVerificationField[];
    }>
  | Readonly<{ eligible: false; reason: 'invalid_state' }>;

function isContactState(
  value: unknown,
  expectedField: ContactVerificationField,
): value is PhoneContactVerificationState | EmailContactVerificationState {
  if (!isRecord(value) || value.field !== expectedField) {
    return false;
  }
  if (value.status === 'missing') {
    return hasExactlyKeys(value, ['field', 'status']);
  }
  if (value.status === 'unverified' || value.status === 'pending') {
    return (
      hasExactlyKeys(value, ['field', 'status', 'contactVersion']) &&
      isPositiveInteger(value.contactVersion)
    );
  }
  if (
    value.status !== 'verified' ||
    !hasExactlyKeys(value, [
      'field',
      'status',
      'contactVersion',
      'verifiedVersion',
      'method',
      'verifiedAt',
    ]) ||
    !isPositiveInteger(value.contactVersion) ||
    !isPositiveInteger(value.verifiedVersion) ||
    !isUnixEpochSeconds(value.verifiedAt)
  ) {
    return false;
  }
  return isContactVerificationTarget(value.field, value.method);
}

export function evaluateContactCheckoutEligibility(
  input: unknown,
): ContactCheckoutEligibility {
  if (
    !isRecord(input) ||
    !hasExactlyKeys(input, ['accountId', 'phone', 'email']) ||
    !isAccountId(input.accountId) ||
    !isContactState(input.phone, 'phone') ||
    !isContactState(input.email, 'email')
  ) {
    return Object.freeze({ eligible: false, reason: 'invalid_state' });
  }

  const missing: ContactVerificationField[] = [];
  if (
    input.phone.status !== 'verified' ||
    input.phone.contactVersion !== input.phone.verifiedVersion
  ) {
    missing.push('phone');
  }
  if (
    input.email.status !== 'verified' ||
    input.email.contactVersion !== input.email.verifiedVersion
  ) {
    missing.push('email');
  }

  return missing.length === 0
    ? Object.freeze({ eligible: true })
    : Object.freeze({
        eligible: false,
        reason: 'contacts_not_verified',
        missing: Object.freeze(missing),
      });
}
