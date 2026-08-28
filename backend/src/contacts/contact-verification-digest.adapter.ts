import { createHmac, hkdfSync } from 'node:crypto';
import { encodeLengthPrefixedUtf8 } from '../auth/crypto-encoding';
import {
  contactVerificationRequestDigest,
  contactVerificationSourceDigest,
  contactVerificationSubjectDigest,
  contactVerificationVerifierDigest,
  isContactVerificationTarget,
} from './contact-verification.contracts';
import {
  CONTACT_VERIFICATION_DIGEST_ALGORITHM,
  CONTACT_VERIFICATION_REQUEST_DIGEST_OPERATIONS,
  ComputedContactVerificationRequestDigest,
  ComputedContactVerificationSourceDigest,
  ComputedContactVerificationSubjectDigest,
  ComputedContactVerificationVerifierDigest,
  ContactVerificationDigestKeyVersion,
  ContactVerificationDigestPort,
  ContactVerificationRequestDigestInput,
  ContactVerificationSourceDigestInput,
  ContactVerificationSubjectDigestInput,
  ContactVerificationVerifierDigestInput,
  contactVerificationDigestKeyVersion,
} from './contact-verification-digest.port';

const DIGEST_DOMAIN = 'prosto-padel/contact-verification-digest/v1';
const HKDF_SALT = 'prosto-padel/contact-verification-digest-key/v1';
const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_SECRET_BYTES = 4_096;
const MAXIMUM_PROOF_BYTES = 4_096;
const MAXIMUM_REQUEST_BYTES = 65_536;
const MAXIMUM_SOURCE_BYTES = 2_048;
const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type DigestKind = 'subject' | 'verifier' | 'request' | 'source';

export interface ContactVerificationDigestAdapterConfig {
  readonly keyVersion: ContactVerificationDigestKeyVersion;
  readonly secret: Buffer;
}

export type ContactVerificationDigestAdapterFailure =
  'invalid_config' | 'invalid_input' | 'disabled' | 'crypto_failure';

export class ContactVerificationDigestAdapterError extends Error {
  readonly name = 'ContactVerificationDigestAdapterError';

  constructor(readonly reason: ContactVerificationDigestAdapterFailure) {
    super('Contact verification digest computation failed');
  }
}

function failure(
  reason: ContactVerificationDigestAdapterFailure,
): ContactVerificationDigestAdapterError {
  return new ContactVerificationDigestAdapterError(reason);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
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

function isBoundedCanonicalString(
  value: unknown,
  maximumBytes: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    !CONTROL_CHARACTER_PATTERN.test(value) &&
    Buffer.byteLength(value, 'utf8') <= maximumBytes
  );
}

function deriveKey(secret: Buffer, kind: DigestKind): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      secret,
      Buffer.from(HKDF_SALT, 'utf8'),
      Buffer.from(kind, 'utf8'),
      32,
    ),
  );
}

export class HmacContactVerificationDigestAdapter implements ContactVerificationDigestPort {
  readonly #keyVersion: ContactVerificationDigestKeyVersion;
  readonly #keys: Readonly<Record<DigestKind, Buffer>>;
  readonly #enabled: boolean;

  constructor(
    rawConfig: ContactVerificationDigestAdapterConfig,
    enabled = true,
  ) {
    try {
      if (
        !isPlainRecord(rawConfig) ||
        !hasExactlyKeys(rawConfig, ['keyVersion', 'secret']) ||
        !Buffer.isBuffer(rawConfig.secret) ||
        rawConfig.secret.length < MINIMUM_SECRET_BYTES ||
        rawConfig.secret.length > MAXIMUM_SECRET_BYTES
      ) {
        throw failure('invalid_config');
      }
      this.#keyVersion = contactVerificationDigestKeyVersion(
        rawConfig.keyVersion,
      );
      const secret = Buffer.from(rawConfig.secret);
      try {
        this.#keys = Object.freeze({
          subject: deriveKey(secret, 'subject'),
          verifier: deriveKey(secret, 'verifier'),
          request: deriveKey(secret, 'request'),
          source: deriveKey(secret, 'source'),
        });
      } finally {
        secret.fill(0);
      }
      this.#enabled = enabled;
    } catch (error) {
      if (error instanceof ContactVerificationDigestAdapterError) {
        throw error;
      }
      throw failure('invalid_config');
    }
  }

  static disabled(): HmacContactVerificationDigestAdapter {
    return new HmacContactVerificationDigestAdapter(
      {
        keyVersion: contactVerificationDigestKeyVersion(1),
        secret: Buffer.alloc(MINIMUM_SECRET_BYTES),
      },
      false,
    );
  }

  #digest(kind: DigestKind, values: readonly string[]): string {
    if (!this.#enabled) {
      throw failure('disabled');
    }
    return createHmac('sha256', this.#keys[kind])
      .update(
        encodeLengthPrefixedUtf8([
          DIGEST_DOMAIN,
          kind,
          this.#keyVersion.toString(10),
          ...values,
        ]),
      )
      .digest('hex');
  }

  computeSubject(
    rawInput: ContactVerificationSubjectDigestInput,
  ): ComputedContactVerificationSubjectDigest {
    try {
      if (
        !isPlainRecord(rawInput) ||
        !hasExactlyKeys(rawInput, ['field', 'canonicalContact']) ||
        !(
          (rawInput.field === 'phone' &&
            typeof rawInput.canonicalContact === 'string' &&
            PHONE_PATTERN.test(rawInput.canonicalContact)) ||
          (rawInput.field === 'email' &&
            typeof rawInput.canonicalContact === 'string' &&
            rawInput.canonicalContact.length <= 320 &&
            rawInput.canonicalContact.trim() === rawInput.canonicalContact &&
            rawInput.canonicalContact.toLowerCase() ===
              rawInput.canonicalContact &&
            EMAIL_PATTERN.test(rawInput.canonicalContact))
        )
      ) {
        throw failure('invalid_input');
      }
      return Object.freeze({
        kind: 'subject',
        algorithm: CONTACT_VERIFICATION_DIGEST_ALGORITHM,
        keyVersion: this.#keyVersion,
        field: rawInput.field,
        digest: contactVerificationSubjectDigest(
          this.#digest('subject', [rawInput.field, rawInput.canonicalContact]),
        ),
      });
    } catch (error) {
      throw this.#mapError(error);
    }
  }

  computeVerifier(
    rawInput: ContactVerificationVerifierDigestInput,
  ): ComputedContactVerificationVerifierDigest {
    try {
      if (
        !isPlainRecord(rawInput) ||
        !hasExactlyKeys(rawInput, ['field', 'method', 'plaintextProof']) ||
        !isContactVerificationTarget(rawInput.field, rawInput.method) ||
        !isBoundedCanonicalString(rawInput.plaintextProof, MAXIMUM_PROOF_BYTES)
      ) {
        throw failure('invalid_input');
      }
      return Object.freeze({
        kind: 'verifier',
        algorithm: CONTACT_VERIFICATION_DIGEST_ALGORITHM,
        keyVersion: this.#keyVersion,
        field: rawInput.field,
        method: rawInput.method,
        digest: contactVerificationVerifierDigest(
          this.#digest('verifier', [
            rawInput.field,
            rawInput.method,
            rawInput.plaintextProof,
          ]),
        ),
      });
    } catch (error) {
      throw this.#mapError(error);
    }
  }

  computeRequest(
    rawInput: ContactVerificationRequestDigestInput,
  ): ComputedContactVerificationRequestDigest {
    try {
      if (
        !isPlainRecord(rawInput) ||
        !hasExactlyKeys(rawInput, ['operation', 'canonicalRequest']) ||
        typeof rawInput.operation !== 'string' ||
        !(
          CONTACT_VERIFICATION_REQUEST_DIGEST_OPERATIONS as readonly string[]
        ).includes(rawInput.operation) ||
        !isBoundedCanonicalString(
          rawInput.canonicalRequest,
          MAXIMUM_REQUEST_BYTES,
        )
      ) {
        throw failure('invalid_input');
      }
      return Object.freeze({
        kind: 'request',
        algorithm: CONTACT_VERIFICATION_DIGEST_ALGORITHM,
        keyVersion: this.#keyVersion,
        operation: rawInput.operation,
        digest: contactVerificationRequestDigest(
          this.#digest('request', [
            rawInput.operation,
            rawInput.canonicalRequest,
          ]),
        ),
      });
    } catch (error) {
      throw this.#mapError(error);
    }
  }

  computeSource(
    rawInput: ContactVerificationSourceDigestInput,
  ): ComputedContactVerificationSourceDigest {
    try {
      if (
        !isPlainRecord(rawInput) ||
        !hasExactlyKeys(rawInput, ['canonicalSource']) ||
        !isBoundedCanonicalString(
          rawInput.canonicalSource,
          MAXIMUM_SOURCE_BYTES,
        )
      ) {
        throw failure('invalid_input');
      }
      return Object.freeze({
        kind: 'source',
        algorithm: CONTACT_VERIFICATION_DIGEST_ALGORITHM,
        keyVersion: this.#keyVersion,
        digest: contactVerificationSourceDigest(
          this.#digest('source', [rawInput.canonicalSource]),
        ),
      });
    } catch (error) {
      throw this.#mapError(error);
    }
  }

  #mapError(error: unknown): ContactVerificationDigestAdapterError {
    if (error instanceof ContactVerificationDigestAdapterError) {
      return error;
    }
    if (error instanceof TypeError) {
      return failure('invalid_input');
    }
    return failure('crypto_failure');
  }
}
