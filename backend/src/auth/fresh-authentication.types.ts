import { AccountId } from '../accounts/account.types';
import {
  InternalUuid,
  isInternalUuid,
  newInternalUuid,
} from '../common/internal-uuid';
import { UnixEpochSeconds, isUnixEpochSeconds } from './auth.types';
import {
  SessionId,
  isSessionAccountId,
  isSessionId,
} from './session.types';

declare const freshAuthenticationEvidenceIdBrand: unique symbol;

export type FreshAuthenticationEvidenceId = InternalUuid & {
  readonly [freshAuthenticationEvidenceIdBrand]:
    'FreshAuthenticationEvidenceId';
};

export const FRESH_AUTHENTICATION_VERIFICATION_METHODS = Object.freeze([
  'external_identity',
  'otp',
  'admin_totp',
] as const);

export type FreshAuthenticationVerificationMethod =
  (typeof FRESH_AUTHENTICATION_VERIFICATION_METHODS)[number];

export interface FreshAuthenticationEvidenceInput {
  readonly evidenceId: FreshAuthenticationEvidenceId;
  readonly accountId: AccountId;
  readonly sessionId: SessionId;
  readonly verificationMethod: FreshAuthenticationVerificationMethod;
  readonly authenticatedAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
}

export interface FreshAuthenticationEvidence
  extends FreshAuthenticationEvidenceInput {}

export const FRESH_AUTHENTICATION_EVIDENCE_REJECTION_REASONS = Object.freeze([
  'invalid_input_shape',
  'invalid_evidence_id',
  'invalid_account_id',
  'invalid_session_id',
  'invalid_verification_method',
  'invalid_authenticated_at',
  'invalid_expires_at',
  'invalid_evidence_window',
] as const);

export type FreshAuthenticationEvidenceRejectionReason =
  (typeof FRESH_AUTHENTICATION_EVIDENCE_REJECTION_REASONS)[number];

export type CreateFreshAuthenticationEvidenceResult =
  | {
      readonly outcome: 'created';
      readonly evidence: FreshAuthenticationEvidence;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason: 'invalid_fresh_authentication_evidence';
      readonly evidenceReason: FreshAuthenticationEvidenceRejectionReason;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    )
  );
}

export function isFreshAuthenticationEvidenceId(
  value: unknown,
): value is FreshAuthenticationEvidenceId {
  return isInternalUuid(value);
}

export function newFreshAuthenticationEvidenceId(): FreshAuthenticationEvidenceId {
  return newInternalUuid() as FreshAuthenticationEvidenceId;
}

export function isFreshAuthenticationVerificationMethod(
  value: unknown,
): value is FreshAuthenticationVerificationMethod {
  return (
    typeof value === 'string' &&
    (FRESH_AUTHENTICATION_VERIFICATION_METHODS as readonly string[]).includes(
      value,
    )
  );
}

function evidenceRejectionReason(
  input: unknown,
): FreshAuthenticationEvidenceRejectionReason | undefined {
  if (!isRecord(input)) {
    return 'invalid_input_shape';
  }
  if (!isFreshAuthenticationEvidenceId(input.evidenceId)) {
    return 'invalid_evidence_id';
  }
  if (!isSessionAccountId(input.accountId)) {
    return 'invalid_account_id';
  }
  if (!isSessionId(input.sessionId)) {
    return 'invalid_session_id';
  }
  if (!isFreshAuthenticationVerificationMethod(input.verificationMethod)) {
    return 'invalid_verification_method';
  }
  if (!isUnixEpochSeconds(input.authenticatedAt)) {
    return 'invalid_authenticated_at';
  }
  if (!isUnixEpochSeconds(input.expiresAt)) {
    return 'invalid_expires_at';
  }
  if (input.authenticatedAt >= input.expiresAt) {
    return 'invalid_evidence_window';
  }

  return undefined;
}

export function isFreshAuthenticationEvidence(
  value: unknown,
): value is FreshAuthenticationEvidence {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, [
      'evidenceId',
      'accountId',
      'sessionId',
      'verificationMethod',
      'authenticatedAt',
      'expiresAt',
    ]) &&
    evidenceRejectionReason(value) === undefined
  );
}

export function isFreshAuthenticationEvidenceValidAt(
  evidence: unknown,
  now: unknown,
): evidence is FreshAuthenticationEvidence {
  return (
    isFreshAuthenticationEvidence(evidence) &&
    isUnixEpochSeconds(now) &&
    now >= evidence.authenticatedAt &&
    now < evidence.expiresAt
  );
}

export function createFreshAuthenticationEvidence(
  input: FreshAuthenticationEvidenceInput,
): CreateFreshAuthenticationEvidenceResult {
  const evidenceReason = evidenceRejectionReason(input);
  if (evidenceReason !== undefined) {
    return {
      outcome: 'rejected',
      reason: 'invalid_fresh_authentication_evidence',
      evidenceReason,
    };
  }

  const evidence: FreshAuthenticationEvidence = Object.freeze({
    evidenceId: input.evidenceId,
    accountId: input.accountId,
    sessionId: input.sessionId,
    verificationMethod: input.verificationMethod,
    authenticatedAt: input.authenticatedAt,
    expiresAt: input.expiresAt,
  });

  return { outcome: 'created', evidence };
}
