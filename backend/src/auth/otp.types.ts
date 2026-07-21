import { ExternalIdentityKey } from '../accounts/external-identity.types';
import {
  AuthenticationIntent,
  AuthenticationOperationId,
  UnixEpochSeconds,
} from './auth.types';

declare const otpChallengeIdBrand: unique symbol;
declare const otpCommandIdBrand: unique symbol;
declare const otpVerifierDigestBrand: unique symbol;
declare const otpRequestDigestBrand: unique symbol;

const MAX_OTP_OPAQUE_VALUE_LENGTH = 256;
const OTP_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export const MAX_OTP_ATTEMPTS = 10;

export type OtpChallengeId = string & {
  readonly [otpChallengeIdBrand]: 'OtpChallengeId';
};

/**
 * A command ID is unique within one challenge. A future persistence adapter
 * must atomically enforce uniqueness for (otpChallengeId, commandId).
 */
export type OtpCommandId = string & {
  readonly [otpCommandIdBrand]: 'OtpCommandId';
};

/**
 * The digest must be produced by a trusted adapter using HMAC or another
 * secret-peppered construction. The state machine never receives a plaintext
 * OTP code, computes this digest, or knows the production secret.
 */
export type OtpVerifierDigest = string & {
  readonly [otpVerifierDigestBrand]: 'OtpVerifierDigest';
};

export type OtpRequestDigest = string & {
  readonly [otpRequestDigestBrand]: 'OtpRequestDigest';
};

function isOtpOpaqueValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_OTP_OPAQUE_VALUE_LENGTH &&
    value.trim() === value &&
    !OTP_CONTROL_CHARACTER_PATTERN.test(value)
  );
}

export function isOtpChallengeId(value: unknown): value is OtpChallengeId {
  return isOtpOpaqueValue(value);
}

export function isOtpCommandId(value: unknown): value is OtpCommandId {
  return isOtpOpaqueValue(value);
}

export function isOtpVerifierDigest(
  value: unknown,
): value is OtpVerifierDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function isOtpRequestDigest(value: unknown): value is OtpRequestDigest {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export function isOtpAttemptCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_OTP_ATTEMPTS
  );
}

export const OTP_CANCEL_REASONS = Object.freeze([
  'user_cancelled',
  'superseded',
  'security_event',
] as const);

export type OtpCancelReason = (typeof OTP_CANCEL_REASONS)[number];

export function isOtpCancelReason(value: unknown): value is OtpCancelReason {
  return (
    typeof value === 'string' &&
    (OTP_CANCEL_REASONS as readonly string[]).includes(value)
  );
}

export interface OtpVerificationMetadata {
  readonly verifiedAt: UnixEpochSeconds;
  readonly commandId: OtpCommandId;
}

export interface OtpExpirationMetadata {
  readonly expiredAt: UnixEpochSeconds;
  readonly commandId: OtpCommandId;
}

export interface OtpAttemptsExhaustedMetadata {
  readonly exhaustedAt: UnixEpochSeconds;
  readonly commandId: OtpCommandId;
}

export interface OtpCancellationMetadata {
  readonly reason: OtpCancelReason;
  readonly cancelledAt: UnixEpochSeconds;
  readonly commandId: OtpCommandId;
}

export type OtpAppliedResult =
  | {
      readonly type: 'otp_verified';
      readonly verification: OtpVerificationMetadata;
    }
  | {
      readonly type: 'incorrect_code';
      readonly attemptsRemaining: number;
    }
  | {
      readonly type: 'otp_attempts_exhausted';
      readonly exhaustion: OtpAttemptsExhaustedMetadata;
    }
  | {
      readonly type: 'otp_expired';
      readonly expiration: OtpExpirationMetadata;
    }
  | {
      readonly type: 'otp_cancelled';
      readonly cancellation: OtpCancellationMetadata;
    };

interface AppliedOtpCommandBase {
  readonly challengeId: OtpChallengeId;
  readonly commandId: OtpCommandId;
  readonly requestDigest: OtpRequestDigest;
  readonly appliedAt: UnixEpochSeconds;
  readonly result: OtpAppliedResult;
}

export interface AppliedSubmitOtpCommand extends AppliedOtpCommandBase {
  readonly commandType: 'submit_otp';
  readonly presentedDigest: OtpVerifierDigest;
}

export interface AppliedExpireOtpCommand extends AppliedOtpCommandBase {
  readonly commandType: 'expire_otp';
}

export interface AppliedCancelOtpCommand extends AppliedOtpCommandBase {
  readonly commandType: 'cancel_otp';
  readonly reason: OtpCancelReason;
}

export type AppliedOtpCommand =
  | AppliedSubmitOtpCommand
  | AppliedExpireOtpCommand
  | AppliedCancelOtpCommand;

export interface OtpChallengeStateBinding {
  readonly challengeId: OtpChallengeId;
  readonly intent: AuthenticationIntent;
  /**
   * A canonical phone subject is personal data. It may be created only by a
   * trusted phone adapter after provider-specific canonicalization and must
   * never be logged or included in typed errors. Prefer lookup_digest for
   * persistent lookup. A transient delivery destination belongs only in an
   * OtpSenderRequest and is never part of OtpChallengeState.
   */
  readonly identityKey: ExternalIdentityKey & { readonly provider: 'phone' };
  readonly operationId: AuthenticationOperationId;
  readonly requestDigest: OtpRequestDigest;
  readonly verifierDigest: OtpVerifierDigest;
  readonly createdAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
  readonly maxAttempts: number;
  readonly attemptsRemaining: number;
  readonly appliedCommands: readonly AppliedOtpCommand[];
}

export interface PendingOtpChallenge extends OtpChallengeStateBinding {
  readonly status: 'pending';
}

export interface VerifiedOtpChallenge extends OtpChallengeStateBinding {
  readonly status: 'verified';
  readonly verification: OtpVerificationMetadata;
}

export interface ExpiredOtpChallenge extends OtpChallengeStateBinding {
  readonly status: 'expired';
  readonly expiration: OtpExpirationMetadata;
}

export interface AttemptsExhaustedOtpChallenge
  extends OtpChallengeStateBinding {
  readonly status: 'attempts_exhausted';
  readonly exhaustion: OtpAttemptsExhaustedMetadata;
}

export interface CancelledOtpChallenge extends OtpChallengeStateBinding {
  readonly status: 'cancelled';
  readonly cancellation: OtpCancellationMetadata;
}

export type OtpChallengeState =
  | PendingOtpChallenge
  | VerifiedOtpChallenge
  | ExpiredOtpChallenge
  | AttemptsExhaustedOtpChallenge
  | CancelledOtpChallenge;

export interface CreateOtpChallengeBinding {
  readonly challengeId: OtpChallengeId;
  readonly intent: AuthenticationIntent;
  readonly identityKey: ExternalIdentityKey;
  readonly operationId: AuthenticationOperationId;
  readonly requestDigest: OtpRequestDigest;
  readonly verifierDigest: OtpVerifierDigest;
  readonly createdAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
  readonly maxAttempts: number;
}

interface OtpCommandBase {
  readonly challengeId: OtpChallengeId;
  readonly commandId: OtpCommandId;
  readonly now: UnixEpochSeconds;
  readonly requestDigest: OtpRequestDigest;
}

export interface SubmitOtpCommand extends OtpCommandBase {
  readonly type: 'submit_otp';
  readonly presentedDigest: OtpVerifierDigest;
}

export interface ExpireOtpCommand extends OtpCommandBase {
  readonly type: 'expire_otp';
}

export interface CancelOtpCommand extends OtpCommandBase {
  readonly type: 'cancel_otp';
  readonly reason: OtpCancelReason;
}

export type OtpCommand =
  | SubmitOtpCommand
  | ExpireOtpCommand
  | CancelOtpCommand;
