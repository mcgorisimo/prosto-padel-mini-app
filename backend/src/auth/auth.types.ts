import {
  AccountId,
  AccountStatus,
  UserRole,
} from '../accounts/account.types';
import {
  ExternalIdentityKey,
  ExternalIdentityNamespace,
  ExternalIdentityProvider,
  ExternalIdentityReference,
} from '../accounts/external-identity.types';
import {
  InternalUuid,
  isInternalUuid,
  newInternalUuid,
} from '../common/internal-uuid';
import type { OtpChallengeId } from './otp.types';

export interface VerifiedExternalIdentityBase
  extends ExternalIdentityReference {
  readonly verifiedAt: Date;
}

export interface VerifiedTelegramIdentity
  extends VerifiedExternalIdentityBase {
  readonly provider: 'telegram';
  readonly authDate: Date;
  readonly firstName: string;
  readonly lastName?: string;
  readonly username?: string;
  readonly languageCode?: string;
  readonly photoUrl?: string;
}

export type VerifiedExternalIdentity = VerifiedTelegramIdentity;

declare const authenticationProofFingerprintBrand: unique symbol;
declare const authenticationOperationIdBrand: unique symbol;
declare const authenticationIdempotencyKeyBrand: unique symbol;
declare const authenticationRequestDigestBrand: unique symbol;
declare const authenticationCommandIdBrand: unique symbol;
declare const unixEpochSecondsBrand: unique symbol;

const MAX_AUTHENTICATION_OPAQUE_VALUE_LENGTH = 256;
const AUTHENTICATION_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

export type AuthenticationProofFingerprint = string & {
  readonly [authenticationProofFingerprintBrand]:
    'AuthenticationProofFingerprint';
};

export type AuthenticationOperationId = InternalUuid & {
  readonly [authenticationOperationIdBrand]: 'AuthenticationOperationId';
};

export type AuthenticationIdempotencyKey = string & {
  readonly [authenticationIdempotencyKeyBrand]:
    'AuthenticationIdempotencyKey';
};

export type AuthenticationRequestDigest = string & {
  readonly [authenticationRequestDigestBrand]: 'AuthenticationRequestDigest';
};

/**
 * A command ID is unique within one authentication operation. A future
 * persistence adapter must atomically enforce uniqueness for the pair
 * (operationId, commandId); commandId alone is not globally unique.
 */
export type AuthenticationCommandId = InternalUuid & {
  readonly [authenticationCommandIdBrand]: 'AuthenticationCommandId';
};

export type UnixEpochSeconds = number & {
  readonly [unixEpochSecondsBrand]: 'UnixEpochSeconds';
};

export function isUnixEpochSeconds(value: unknown): value is UnixEpochSeconds {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function unixEpochSeconds(value: number): UnixEpochSeconds {
  if (!isUnixEpochSeconds(value)) {
    throw new TypeError('Unix epoch seconds are invalid');
  }

  return value;
}

function isAuthenticationOpaqueValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_AUTHENTICATION_OPAQUE_VALUE_LENGTH &&
    value.trim() === value &&
    !AUTHENTICATION_CONTROL_CHARACTER_PATTERN.test(value)
  );
}

export function isAuthenticationOperationId(
  value: unknown,
): value is AuthenticationOperationId {
  return isInternalUuid(value);
}

export function isAuthenticationIdempotencyKey(
  value: unknown,
): value is AuthenticationIdempotencyKey {
  return isAuthenticationOpaqueValue(value);
}

export function isAuthenticationRequestDigest(
  value: unknown,
): value is AuthenticationRequestDigest {
  return isAuthenticationOpaqueValue(value);
}

export function isAuthenticationCommandId(
  value: unknown,
): value is AuthenticationCommandId {
  return isInternalUuid(value);
}

export function newAuthenticationOperationId(): AuthenticationOperationId {
  return newInternalUuid() as AuthenticationOperationId;
}

export function newAuthenticationCommandId(): AuthenticationCommandId {
  return newInternalUuid() as AuthenticationCommandId;
}

export function isAuthenticationProofFingerprint(
  value: unknown,
): value is AuthenticationProofFingerprint {
  return typeof value === 'string' && SHA_256_HEX_PATTERN.test(value);
}

export interface TelegramAuthenticationProofReference {
  readonly type: 'telegram_proof';
  readonly proofFingerprint: AuthenticationProofFingerprint;
}

export interface OtpAuthenticationProofReference {
  readonly type: 'otp_challenge';
  readonly challengeId: OtpChallengeId;
}

export type AuthenticationProofReference =
  | TelegramAuthenticationProofReference
  | OtpAuthenticationProofReference;

export function telegramAuthenticationProofReference(
  proofFingerprint: AuthenticationProofFingerprint,
): TelegramAuthenticationProofReference {
  if (!isAuthenticationProofFingerprint(proofFingerprint)) {
    throw new TypeError('Telegram proof fingerprint is invalid');
  }

  return Object.freeze({ type: 'telegram_proof', proofFingerprint });
}

export function otpAuthenticationProofReference(
  challengeId: OtpChallengeId,
): OtpAuthenticationProofReference {
  if (!isInternalUuid(challengeId)) {
    throw new TypeError('OTP challenge reference is invalid');
  }

  return Object.freeze({ type: 'otp_challenge', challengeId });
}

export function isAuthenticationProofReference(
  value: unknown,
): value is AuthenticationProofReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.type === 'telegram_proof') {
    return (
      Object.keys(candidate).length === 2 &&
      Object.prototype.hasOwnProperty.call(candidate, 'proofFingerprint') &&
      isAuthenticationProofFingerprint(candidate.proofFingerprint)
    );
  }

  return (
    candidate.type === 'otp_challenge' &&
    Object.keys(candidate).length === 2 &&
    Object.prototype.hasOwnProperty.call(candidate, 'challengeId') &&
    isInternalUuid(candidate.challengeId)
  );
}

export const AUTHENTICATION_INTENTS = Object.freeze([
  'sign_in',
  'sign_up',
  'link_identity',
  'fresh_authentication',
  'account_recovery',
] as const);

export type AuthenticationIntent = (typeof AUTHENTICATION_INTENTS)[number];

export function isAuthenticationIntent(
  value: unknown,
): value is AuthenticationIntent {
  return (
    typeof value === 'string' &&
    (AUTHENTICATION_INTENTS as readonly string[]).includes(value)
  );
}

export interface VerifiedTelegramProof {
  readonly provider: 'telegram';
  readonly namespace: ExternalIdentityNamespace;
  readonly identityKey: ExternalIdentityKey & {
    readonly provider: 'telegram';
  };
  readonly authDate: UnixEpochSeconds;
  readonly verifiedAt: UnixEpochSeconds;
  readonly expiresAt: UnixEpochSeconds;
  readonly proofFingerprint: AuthenticationProofFingerprint;
}

export type TelegramProofVerificationOutcome =
  | {
      readonly status: 'verified';
      readonly proof: VerifiedTelegramProof;
    }
  | {
      readonly status: 'expired';
      readonly reason: 'expired_proof';
      readonly proofFingerprint: AuthenticationProofFingerprint;
      readonly expiresAt: UnixEpochSeconds;
    }
  | {
      readonly status: 'invalid';
      readonly reason: 'invalid_proof';
    };

export interface SessionMetadata {
  readonly sessionId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly authProvider: ExternalIdentityProvider;
  readonly externalIdentitySubject: string;
}

export type AdminStepUpState =
  | {
      readonly status: 'not_verified';
    }
  | {
      readonly status: 'verified';
      readonly method: 'totp';
      readonly verifiedAt: Date;
      readonly expiresAt: Date;
    };

export interface AuthenticatedPrincipal {
  readonly accountId: AccountId;
  readonly role: UserRole;
  readonly accountStatus: AccountStatus;
  readonly session: SessionMetadata;
  readonly adminStepUp: AdminStepUpState;
}
