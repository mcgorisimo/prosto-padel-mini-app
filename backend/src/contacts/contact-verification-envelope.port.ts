import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { InternalUuid } from '../common/internal-uuid';
import {
  ContactVerificationChallengeId,
  ContactVerificationDeliveryRequest,
  ContactVerificationField,
  ContactVerificationSubjectDigest,
  ContactVerificationTarget,
  ContactVerificationVerifierDigest,
} from './contact-verification.contracts';
import { ContactVerificationDigestKeyVersion } from './contact-verification-digest.port';

export const CONTACT_VERIFICATION_ENVELOPE_ALGORITHM = 'aes_256_gcm' as const;
export const CONTACT_VERIFICATION_PURPOSE = 'contact_ownership' as const;

declare const contactVerificationEnvelopeKeyVersionBrand: unique symbol;

export type ContactVerificationEnvelopeKeyVersion = number & {
  readonly [contactVerificationEnvelopeKeyVersionBrand]: 'ContactVerificationEnvelopeKeyVersion';
};

export function contactVerificationEnvelopeKeyVersion(
  value: number,
): ContactVerificationEnvelopeKeyVersion {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new TypeError('Contact verification envelope key version is invalid');
  }
  return value as ContactVerificationEnvelopeKeyVersion;
}

export type ContactVerificationEncryptedEnvelope = Readonly<{
  ciphertext: Buffer;
  nonce: Buffer;
  authTag: Buffer;
  algorithm: typeof CONTACT_VERIFICATION_ENVELOPE_ALGORITHM;
  keyVersion: ContactVerificationEnvelopeKeyVersion;
}>;

export type ContactVerificationEncryptedDispatchEnvelope = Readonly<
  ContactVerificationEncryptedEnvelope & {
    payloadDigest: Buffer;
    payloadDigestKeyVersion: ContactVerificationDigestKeyVersion;
  }
>;

interface ContactBindingBase {
  readonly accountId: AccountId;
  readonly field: ContactVerificationField;
  readonly purpose: typeof CONTACT_VERIFICATION_PURPOSE;
  readonly contactVersion: number;
  readonly subjectDigest: ContactVerificationSubjectDigest;
  readonly subjectDigestKeyVersion: ContactVerificationDigestKeyVersion;
}

export interface EncryptContactVerificationContactInput extends ContactBindingBase {
  /** Canonical E.164 phone or lowercase email; transient and never logged. */
  readonly canonicalContact: string;
}

export type DecryptContactVerificationContactInput = Readonly<
  Omit<EncryptContactVerificationContactInput, 'canonicalContact'> & {
    envelope: ContactVerificationEncryptedEnvelope;
  }
>;

interface ChallengeEnvelopeBindingBase extends ContactBindingBase {
  readonly challengeId: ContactVerificationChallengeId;
  readonly verifierDigest: ContactVerificationVerifierDigest;
  readonly verifierDigestKeyVersion: ContactVerificationDigestKeyVersion;
  readonly challengeExpiresAt: UnixEpochSeconds;
}

export type EncryptContactVerificationProofInput =
  ChallengeEnvelopeBindingBase &
    ContactVerificationTarget & {
      /** Transient OTP, code or link token; never persisted or logged. */
      readonly plaintextProof: string;
      readonly proofExpiresAt: UnixEpochSeconds;
    };

export type DecryptContactVerificationProofInput = Readonly<
  Omit<EncryptContactVerificationProofInput, 'plaintextProof'> & {
    envelope: ContactVerificationEncryptedEnvelope;
  }
>;

interface DispatchEnvelopeBindingBase extends ChallengeEnvelopeBindingBase {
  readonly dispatchId: InternalUuid;
  readonly payloadExpiresAt: UnixEpochSeconds;
}

export type EncryptContactVerificationDispatchInput =
  DispatchEnvelopeBindingBase &
    ContactVerificationTarget & {
      readonly request: ContactVerificationDeliveryRequest;
    };

export type DecryptContactVerificationDispatchInput = Readonly<
  Omit<EncryptContactVerificationDispatchInput, 'request'> & {
    envelope: ContactVerificationEncryptedDispatchEnvelope;
  }
>;

/**
 * Runtime-neutral AEAD boundary. Callers persist only returned envelopes and
 * must erase them transactionally according to migration 042 state rules.
 * Decryption results are transient delivery/write inputs and must never be
 * persisted, logged, audited or included in typed errors.
 */
export interface ContactVerificationEnvelopePort {
  encryptContact(
    input: EncryptContactVerificationContactInput,
  ): ContactVerificationEncryptedEnvelope;

  decryptContact(input: DecryptContactVerificationContactInput): string;

  encryptProof(
    input: EncryptContactVerificationProofInput,
  ): ContactVerificationEncryptedEnvelope;

  decryptProof(input: DecryptContactVerificationProofInput): string;

  encryptDispatch(
    input: EncryptContactVerificationDispatchInput,
  ): ContactVerificationEncryptedDispatchEnvelope;

  decryptDispatch(
    input: DecryptContactVerificationDispatchInput,
  ): ContactVerificationDeliveryRequest;
}
