import {
  ContactVerificationField,
  ContactVerificationMethod,
  ContactVerificationRequestDigest,
  ContactVerificationSourceDigest,
  ContactVerificationSubjectDigest,
  ContactVerificationVerifierDigest,
} from './contact-verification.contracts';

export const CONTACT_VERIFICATION_DIGEST_ALGORITHM = 'hmac-sha-256' as const;

declare const contactVerificationDigestKeyVersionBrand: unique symbol;

export type ContactVerificationDigestKeyVersion = number & {
  readonly [contactVerificationDigestKeyVersionBrand]: 'ContactVerificationDigestKeyVersion';
};

export function contactVerificationDigestKeyVersion(
  value: number,
): ContactVerificationDigestKeyVersion {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new TypeError('Contact verification digest key version is invalid');
  }
  return value as ContactVerificationDigestKeyVersion;
}

export interface ContactVerificationSubjectDigestInput {
  readonly field: ContactVerificationField;
  /** Canonical E.164 phone or lowercase email; transient and never logged. */
  readonly canonicalContact: string;
}

export interface ContactVerificationVerifierDigestInput {
  readonly field: ContactVerificationField;
  readonly method: ContactVerificationMethod;
  /** Transient OTP, code or link token; never persisted or logged. */
  readonly plaintextProof: string;
}

export const CONTACT_VERIFICATION_REQUEST_DIGEST_OPERATIONS = Object.freeze([
  'start',
  'submit_proof',
  'expire',
  'reserve_resend',
  'cancel',
] as const);

export type ContactVerificationRequestDigestOperation =
  (typeof CONTACT_VERIFICATION_REQUEST_DIGEST_OPERATIONS)[number];

export interface ContactVerificationRequestDigestInput {
  readonly operation: ContactVerificationRequestDigestOperation;
  /** Deterministic canonical request encoding supplied by a trusted caller. */
  readonly canonicalRequest: string;
}

export interface ContactVerificationSourceDigestInput {
  /** Canonical network-source key supplied by a trusted edge adapter. */
  readonly canonicalSource: string;
}

interface ComputedDigestBase {
  readonly algorithm: typeof CONTACT_VERIFICATION_DIGEST_ALGORITHM;
  readonly keyVersion: ContactVerificationDigestKeyVersion;
}

export type ComputedContactVerificationSubjectDigest = Readonly<
  ComputedDigestBase & {
    kind: 'subject';
    field: ContactVerificationField;
    digest: ContactVerificationSubjectDigest;
  }
>;

export type ComputedContactVerificationVerifierDigest = Readonly<
  ComputedDigestBase & {
    kind: 'verifier';
    field: ContactVerificationField;
    method: ContactVerificationMethod;
    digest: ContactVerificationVerifierDigest;
  }
>;

export type ComputedContactVerificationRequestDigest = Readonly<
  ComputedDigestBase & {
    kind: 'request';
    operation: ContactVerificationRequestDigestOperation;
    digest: ContactVerificationRequestDigest;
  }
>;

export type ComputedContactVerificationSourceDigest = Readonly<
  ComputedDigestBase & {
    kind: 'source';
    digest: ContactVerificationSourceDigest;
  }
>;

/**
 * Implementations use separate keyed domains for every digest kind. Key
 * material remains outside PostgreSQL, returned values and typed errors.
 */
export interface ContactVerificationDigestPort {
  computeSubject(
    input: ContactVerificationSubjectDigestInput,
  ): ComputedContactVerificationSubjectDigest;

  computeVerifier(
    input: ContactVerificationVerifierDigestInput,
  ): ComputedContactVerificationVerifierDigest;

  computeRequest(
    input: ContactVerificationRequestDigestInput,
  ): ComputedContactVerificationRequestDigest;

  computeSource(
    input: ContactVerificationSourceDigestInput,
  ): ComputedContactVerificationSourceDigest;
}
