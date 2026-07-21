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
declare const unixEpochSecondsBrand: unique symbol;

export type AuthenticationProofFingerprint = string & {
  readonly [authenticationProofFingerprintBrand]:
    'AuthenticationProofFingerprint';
};

export type AuthenticationOperationId = string & {
  readonly [authenticationOperationIdBrand]: 'AuthenticationOperationId';
};

export type AuthenticationIdempotencyKey = string & {
  readonly [authenticationIdempotencyKeyBrand]:
    'AuthenticationIdempotencyKey';
};

export type AuthenticationRequestDigest = string & {
  readonly [authenticationRequestDigestBrand]: 'AuthenticationRequestDigest';
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

export const AUTHENTICATION_INTENTS = Object.freeze([
  'sign_in',
  'link_identity',
  'fresh_authentication',
  'manual_recovery',
  'identity_transfer',
  'account_deletion',
] as const);

export type AuthenticationIntent = (typeof AUTHENTICATION_INTENTS)[number];

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
