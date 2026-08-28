import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { isAccountId } from '../accounts/account.types';
import { encodeLengthPrefixedUtf8 } from '../auth/crypto-encoding';
import { isUnixEpochSeconds } from '../auth/auth.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  ContactVerificationDeliveryRequest,
  isContactVerificationChallengeId,
  isContactVerificationSubjectDigest,
  isContactVerificationTarget,
  isContactVerificationVerifierDigest,
} from './contact-verification.contracts';
import {
  ContactVerificationDigestKeyVersion,
  contactVerificationDigestKeyVersion,
} from './contact-verification-digest.port';
import {
  CONTACT_VERIFICATION_ENVELOPE_ALGORITHM,
  CONTACT_VERIFICATION_PURPOSE,
  ContactVerificationEncryptedDispatchEnvelope,
  ContactVerificationEncryptedEnvelope,
  ContactVerificationEnvelopeKeyVersion,
  ContactVerificationEnvelopePort,
  DecryptContactVerificationContactInput,
  DecryptContactVerificationDispatchInput,
  DecryptContactVerificationProofInput,
  EncryptContactVerificationContactInput,
  EncryptContactVerificationDispatchInput,
  EncryptContactVerificationProofInput,
  contactVerificationEnvelopeKeyVersion,
} from './contact-verification-envelope.port';

const ENVELOPE_DOMAIN = 'prosto-padel/contact-verification-envelope/v1';
const ENCRYPTION_KEY_SALT = 'prosto-padel/contact-verification-envelope-key/v1';
const PAYLOAD_DIGEST_KEY_SALT =
  'prosto-padel/contact-verification-payload-digest-key/v1';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MASTER_KEY_BYTES = 32;
const MAX_KEYRING_ENTRIES = 32;
const MAX_CONTACT_BYTES = 4_096;
const MAX_PROOF_BYTES = 4_096;
const MAX_DISPATCH_PAYLOAD_BYTES = 16_384;
const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type EnvelopeKind = 'contact' | 'proof' | 'dispatch';

export interface ContactVerificationEnvelopeEncryptionKeyConfig {
  readonly keyVersion: ContactVerificationEnvelopeKeyVersion;
  readonly secret: Buffer;
}

export interface ContactVerificationEnvelopeDigestKeyConfig {
  readonly keyVersion: ContactVerificationDigestKeyVersion;
  readonly secret: Buffer;
}

export interface ContactVerificationEnvelopeAdapterConfig {
  readonly activeEncryptionKeyVersion: ContactVerificationEnvelopeKeyVersion;
  readonly encryptionKeys: readonly ContactVerificationEnvelopeEncryptionKeyConfig[];
  readonly activeDigestKeyVersion: ContactVerificationDigestKeyVersion;
  readonly digestKeys: readonly ContactVerificationEnvelopeDigestKeyConfig[];
}

export type ContactVerificationEnvelopeAdapterFailure =
  | 'invalid_config'
  | 'invalid_input'
  | 'invalid_envelope'
  | 'unknown_key_version'
  | 'authentication_failed'
  | 'disabled'
  | 'crypto_failure';

export class ContactVerificationEnvelopeAdapterError extends Error {
  readonly name = 'ContactVerificationEnvelopeAdapterError';

  constructor(readonly reason: ContactVerificationEnvelopeAdapterFailure) {
    super('Contact verification envelope operation failed');
  }
}

function failure(
  reason: ContactVerificationEnvelopeAdapterFailure,
): ContactVerificationEnvelopeAdapterError {
  return new ContactVerificationEnvelopeAdapterError(reason);
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

function isPositiveInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function isKeyVersion(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= 2_147_483_647
  );
}

function isCanonicalContact(field: unknown, value: unknown): value is string {
  return (
    (field === 'phone' &&
      typeof value === 'string' &&
      PHONE_PATTERN.test(value)) ||
    (field === 'email' &&
      typeof value === 'string' &&
      value.length <= 320 &&
      value.trim() === value &&
      value.toLowerCase() === value &&
      EMAIL_PATTERN.test(value))
  );
}

function isBoundedSecret(
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

function deriveKey(secret: Buffer, salt: string, info: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      secret,
      Buffer.from(salt, 'utf8'),
      Buffer.from(info, 'utf8'),
      MASTER_KEY_BYTES,
    ),
  );
}

function decodeLengthPrefixedUtf8(
  encoded: Buffer,
  expectedValues: number,
): readonly string[] {
  const values: string[] = [];
  let offset = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  while (offset < encoded.length && values.length < expectedValues) {
    if (encoded.length - offset < 4) {
      throw failure('invalid_envelope');
    }
    const length = encoded.readUInt32BE(offset);
    offset += 4;
    if (length > encoded.length - offset) {
      throw failure('invalid_envelope');
    }
    values.push(decoder.decode(encoded.subarray(offset, offset + length)));
    offset += length;
  }
  if (values.length !== expectedValues || offset !== encoded.length) {
    throw failure('invalid_envelope');
  }
  return values;
}

interface DerivedEncryptionKeys {
  readonly contact: Buffer;
  readonly proof: Buffer;
  readonly dispatch: Buffer;
}

const CONTACT_BINDING_KEYS = Object.freeze([
  'accountId',
  'field',
  'purpose',
  'contactVersion',
  'subjectDigest',
  'subjectDigestKeyVersion',
] as const);

const CHALLENGE_BINDING_KEYS = Object.freeze([
  ...CONTACT_BINDING_KEYS,
  'challengeId',
  'method',
  'verifierDigest',
  'verifierDigestKeyVersion',
  'challengeExpiresAt',
] as const);

export class AesGcmContactVerificationEnvelopeAdapter implements ContactVerificationEnvelopePort {
  readonly #activeEncryptionKeyVersion: ContactVerificationEnvelopeKeyVersion;
  readonly #activeDigestKeyVersion: ContactVerificationDigestKeyVersion;
  readonly #encryptionKeys = new Map<number, DerivedEncryptionKeys>();
  readonly #digestKeys = new Map<number, Buffer>();
  readonly #enabled: boolean;

  constructor(
    rawConfig: ContactVerificationEnvelopeAdapterConfig,
    enabled = true,
  ) {
    try {
      if (
        !isPlainRecord(rawConfig) ||
        !hasExactlyKeys(rawConfig, [
          'activeEncryptionKeyVersion',
          'encryptionKeys',
          'activeDigestKeyVersion',
          'digestKeys',
        ]) ||
        !isKeyVersion(rawConfig.activeEncryptionKeyVersion) ||
        !isKeyVersion(rawConfig.activeDigestKeyVersion) ||
        !Array.isArray(rawConfig.encryptionKeys) ||
        rawConfig.encryptionKeys.length < 1 ||
        rawConfig.encryptionKeys.length > MAX_KEYRING_ENTRIES ||
        !Array.isArray(rawConfig.digestKeys) ||
        rawConfig.digestKeys.length < 1 ||
        rawConfig.digestKeys.length > MAX_KEYRING_ENTRIES
      ) {
        throw failure('invalid_config');
      }

      for (const rawKey of rawConfig.encryptionKeys) {
        if (
          !isPlainRecord(rawKey) ||
          !hasExactlyKeys(rawKey, ['keyVersion', 'secret']) ||
          !isKeyVersion(rawKey.keyVersion) ||
          !Buffer.isBuffer(rawKey.secret) ||
          rawKey.secret.length !== MASTER_KEY_BYTES ||
          this.#encryptionKeys.has(rawKey.keyVersion)
        ) {
          throw failure('invalid_config');
        }
        const secret = Buffer.from(rawKey.secret);
        try {
          this.#encryptionKeys.set(
            rawKey.keyVersion,
            Object.freeze({
              contact: deriveKey(secret, ENCRYPTION_KEY_SALT, 'contact'),
              proof: deriveKey(secret, ENCRYPTION_KEY_SALT, 'proof'),
              dispatch: deriveKey(secret, ENCRYPTION_KEY_SALT, 'dispatch'),
            }),
          );
        } finally {
          secret.fill(0);
        }
      }

      for (const rawKey of rawConfig.digestKeys) {
        if (
          !isPlainRecord(rawKey) ||
          !hasExactlyKeys(rawKey, ['keyVersion', 'secret']) ||
          !isKeyVersion(rawKey.keyVersion) ||
          !Buffer.isBuffer(rawKey.secret) ||
          rawKey.secret.length !== MASTER_KEY_BYTES ||
          this.#digestKeys.has(rawKey.keyVersion)
        ) {
          throw failure('invalid_config');
        }
        const secret = Buffer.from(rawKey.secret);
        try {
          this.#digestKeys.set(
            rawKey.keyVersion,
            deriveKey(secret, PAYLOAD_DIGEST_KEY_SALT, 'dispatch-payload'),
          );
        } finally {
          secret.fill(0);
        }
      }

      if (
        !this.#encryptionKeys.has(rawConfig.activeEncryptionKeyVersion) ||
        !this.#digestKeys.has(rawConfig.activeDigestKeyVersion)
      ) {
        throw failure('invalid_config');
      }
      this.#activeEncryptionKeyVersion = contactVerificationEnvelopeKeyVersion(
        rawConfig.activeEncryptionKeyVersion,
      );
      this.#activeDigestKeyVersion = contactVerificationDigestKeyVersion(
        rawConfig.activeDigestKeyVersion,
      );
      this.#enabled = enabled;
    } catch (error) {
      if (error instanceof ContactVerificationEnvelopeAdapterError) {
        throw error;
      }
      throw failure('invalid_config');
    }
  }

  static disabled(): AesGcmContactVerificationEnvelopeAdapter {
    return new AesGcmContactVerificationEnvelopeAdapter(
      {
        activeEncryptionKeyVersion: contactVerificationEnvelopeKeyVersion(1),
        encryptionKeys: [
          {
            keyVersion: contactVerificationEnvelopeKeyVersion(1),
            secret: Buffer.alloc(MASTER_KEY_BYTES),
          },
        ],
        activeDigestKeyVersion: contactVerificationDigestKeyVersion(1),
        digestKeys: [
          {
            keyVersion: contactVerificationDigestKeyVersion(1),
            secret: Buffer.alloc(MASTER_KEY_BYTES),
          },
        ],
      },
      false,
    );
  }

  encryptContact(
    rawInput: EncryptContactVerificationContactInput,
  ): ContactVerificationEncryptedEnvelope {
    try {
      this.#requireEnabled();
      const input = this.#contactInput(rawInput, 'encrypt');
      const plaintext = Buffer.from(input.canonicalContact, 'utf8');
      try {
        return this.#encrypt('contact', plaintext, this.#contactBinding(input));
      } finally {
        plaintext.fill(0);
      }
    } catch (error) {
      throw this.#mapEncryptError(error);
    }
  }

  decryptContact(rawInput: DecryptContactVerificationContactInput): string {
    try {
      this.#requireEnabled();
      const input = this.#contactInput(rawInput, 'decrypt');
      const plaintext = this.#decrypt(
        'contact',
        input.envelope,
        this.#contactBinding(input),
        MAX_CONTACT_BYTES,
      );
      try {
        const value = new TextDecoder('utf-8', { fatal: true }).decode(
          plaintext,
        );
        if (!isCanonicalContact(input.field, value)) {
          throw failure('invalid_envelope');
        }
        return value;
      } finally {
        plaintext.fill(0);
      }
    } catch (error) {
      throw this.#mapDecryptError(error);
    }
  }

  encryptProof(
    rawInput: EncryptContactVerificationProofInput,
  ): ContactVerificationEncryptedEnvelope {
    try {
      this.#requireEnabled();
      const input = this.#proofInput(rawInput, 'encrypt');
      const plaintext = Buffer.from(input.plaintextProof, 'utf8');
      try {
        return this.#encrypt(
          'proof',
          plaintext,
          this.#challengeBinding(input, input.proofExpiresAt),
        );
      } finally {
        plaintext.fill(0);
      }
    } catch (error) {
      throw this.#mapEncryptError(error);
    }
  }

  decryptProof(rawInput: DecryptContactVerificationProofInput): string {
    try {
      this.#requireEnabled();
      const input = this.#proofInput(rawInput, 'decrypt');
      const plaintext = this.#decrypt(
        'proof',
        input.envelope,
        this.#challengeBinding(input, input.proofExpiresAt),
        MAX_PROOF_BYTES,
      );
      try {
        const value = new TextDecoder('utf-8', { fatal: true }).decode(
          plaintext,
        );
        if (!isBoundedSecret(value, MAX_PROOF_BYTES)) {
          throw failure('invalid_envelope');
        }
        return value;
      } finally {
        plaintext.fill(0);
      }
    } catch (error) {
      throw this.#mapDecryptError(error);
    }
  }

  encryptDispatch(
    rawInput: EncryptContactVerificationDispatchInput,
  ): ContactVerificationEncryptedDispatchEnvelope {
    try {
      this.#requireEnabled();
      const input = this.#dispatchInput(rawInput, 'encrypt');
      const proof =
        input.request.method === 'email_link'
          ? input.request.singleUseToken
          : input.request.plaintextCode;
      const plaintext = encodeLengthPrefixedUtf8([
        input.request.destination,
        proof,
      ]);
      if (plaintext.length > MAX_DISPATCH_PAYLOAD_BYTES) {
        plaintext.fill(0);
        throw failure('invalid_input');
      }
      try {
        const binding = this.#dispatchBinding(input);
        const envelope = this.#encrypt('dispatch', plaintext, binding);
        const digestKey = this.#digestKeys.get(this.#activeDigestKeyVersion);
        if (digestKey === undefined) {
          throw failure('crypto_failure');
        }
        return Object.freeze({
          ...envelope,
          payloadDigest: this.#payloadDigest(
            digestKey,
            this.#activeDigestKeyVersion,
            binding,
            plaintext,
          ),
          payloadDigestKeyVersion: this.#activeDigestKeyVersion,
        });
      } finally {
        plaintext.fill(0);
      }
    } catch (error) {
      throw this.#mapEncryptError(error);
    }
  }

  decryptDispatch(
    rawInput: DecryptContactVerificationDispatchInput,
  ): ContactVerificationDeliveryRequest {
    try {
      this.#requireEnabled();
      const input = this.#dispatchInput(rawInput, 'decrypt');
      const envelope = this.#dispatchEnvelope(input.envelope);
      const binding = this.#dispatchBinding(input);
      const plaintext = this.#decrypt(
        'dispatch',
        {
          ciphertext: envelope.ciphertext,
          nonce: envelope.nonce,
          authTag: envelope.authTag,
          algorithm: envelope.algorithm,
          keyVersion: envelope.keyVersion,
        },
        binding,
        MAX_DISPATCH_PAYLOAD_BYTES,
      );
      try {
        const digestKey = this.#digestKeys.get(
          envelope.payloadDigestKeyVersion,
        );
        if (digestKey === undefined) {
          throw failure('unknown_key_version');
        }
        const expected = this.#payloadDigest(
          digestKey,
          envelope.payloadDigestKeyVersion,
          binding,
          plaintext,
        );
        if (!timingSafeEqual(expected, envelope.payloadDigest)) {
          throw failure('authentication_failed');
        }
        const [destination, proof] = decodeLengthPrefixedUtf8(plaintext, 2);
        if (
          !isCanonicalContact(input.field, destination) ||
          !isBoundedSecret(proof, MAX_PROOF_BYTES)
        ) {
          throw failure('invalid_envelope');
        }
        const base = {
          challengeId: input.challengeId,
          dispatchId: input.dispatchId,
          destination,
          expiresAt: input.payloadExpiresAt,
        } as const;
        return input.method === 'email_link'
          ? Object.freeze({
              ...base,
              method: 'email_link' as const,
              singleUseToken: proof,
            })
          : Object.freeze({
              ...base,
              method: input.method,
              plaintextCode: proof,
            });
      } finally {
        plaintext.fill(0);
      }
    } catch (error) {
      throw this.#mapDecryptError(error);
    }
  }

  #requireEnabled(): void {
    if (!this.#enabled) {
      throw failure('disabled');
    }
  }

  #contactInput(
    rawInput: EncryptContactVerificationContactInput,
    mode: 'encrypt',
  ): EncryptContactVerificationContactInput;
  #contactInput(
    rawInput: DecryptContactVerificationContactInput,
    mode: 'decrypt',
  ): DecryptContactVerificationContactInput;
  #contactInput(
    rawInput:
      | EncryptContactVerificationContactInput
      | DecryptContactVerificationContactInput,
    mode: 'encrypt' | 'decrypt',
  ):
    | EncryptContactVerificationContactInput
    | DecryptContactVerificationContactInput {
    const canonicalContact =
      'canonicalContact' in rawInput ? rawInput.canonicalContact : undefined;
    const keys = [
      ...CONTACT_BINDING_KEYS,
      mode === 'encrypt' ? 'canonicalContact' : 'envelope',
    ];
    if (
      !isPlainRecord(rawInput) ||
      !hasExactlyKeys(rawInput, keys) ||
      !isAccountId(rawInput.accountId) ||
      (rawInput.field !== 'phone' && rawInput.field !== 'email') ||
      rawInput.purpose !== CONTACT_VERIFICATION_PURPOSE ||
      !isPositiveInteger(rawInput.contactVersion) ||
      !isContactVerificationSubjectDigest(rawInput.subjectDigest) ||
      !isKeyVersion(rawInput.subjectDigestKeyVersion) ||
      (mode === 'encrypt' &&
        !isCanonicalContact(rawInput.field, canonicalContact))
    ) {
      throw failure('invalid_input');
    }
    if (mode === 'decrypt') {
      if (!('envelope' in rawInput)) {
        throw failure('invalid_input');
      }
      this.#envelope(rawInput.envelope, MAX_CONTACT_BYTES);
    }
    return rawInput;
  }

  #proofInput(
    rawInput: EncryptContactVerificationProofInput,
    mode: 'encrypt',
  ): EncryptContactVerificationProofInput;
  #proofInput(
    rawInput: DecryptContactVerificationProofInput,
    mode: 'decrypt',
  ): DecryptContactVerificationProofInput;
  #proofInput(
    rawInput:
      | EncryptContactVerificationProofInput
      | DecryptContactVerificationProofInput,
    mode: 'encrypt' | 'decrypt',
  ):
    | EncryptContactVerificationProofInput
    | DecryptContactVerificationProofInput {
    const plaintextProof =
      'plaintextProof' in rawInput ? rawInput.plaintextProof : undefined;
    const keys = [
      ...CHALLENGE_BINDING_KEYS,
      'proofExpiresAt',
      mode === 'encrypt' ? 'plaintextProof' : 'envelope',
    ];
    if (
      !this.#challengeInput(rawInput, keys) ||
      !isUnixEpochSeconds(rawInput.proofExpiresAt) ||
      rawInput.proofExpiresAt < 1 ||
      rawInput.proofExpiresAt > rawInput.challengeExpiresAt ||
      (mode === 'encrypt' && !isBoundedSecret(plaintextProof, MAX_PROOF_BYTES))
    ) {
      throw failure('invalid_input');
    }
    if (mode === 'decrypt') {
      if (!('envelope' in rawInput)) {
        throw failure('invalid_input');
      }
      this.#envelope(rawInput.envelope, MAX_PROOF_BYTES);
    }
    return rawInput;
  }

  #dispatchInput(
    rawInput: EncryptContactVerificationDispatchInput,
    mode: 'encrypt',
  ): EncryptContactVerificationDispatchInput;
  #dispatchInput(
    rawInput: DecryptContactVerificationDispatchInput,
    mode: 'decrypt',
  ): DecryptContactVerificationDispatchInput;
  #dispatchInput(
    rawInput:
      | EncryptContactVerificationDispatchInput
      | DecryptContactVerificationDispatchInput,
    mode: 'encrypt' | 'decrypt',
  ):
    | EncryptContactVerificationDispatchInput
    | DecryptContactVerificationDispatchInput {
    const keys = [
      ...CHALLENGE_BINDING_KEYS,
      'dispatchId',
      'payloadExpiresAt',
      mode === 'encrypt' ? 'request' : 'envelope',
    ];
    if (
      !this.#challengeInput(rawInput, keys) ||
      !isInternalUuid(rawInput.dispatchId) ||
      !isUnixEpochSeconds(rawInput.payloadExpiresAt) ||
      rawInput.payloadExpiresAt < 1 ||
      rawInput.payloadExpiresAt > rawInput.challengeExpiresAt
    ) {
      throw failure('invalid_input');
    }
    if (mode === 'encrypt') {
      if (!('request' in rawInput)) {
        throw failure('invalid_input');
      }
      if (
        !this.#deliveryRequest(
          rawInput.request,
          rawInput as EncryptContactVerificationDispatchInput,
        )
      ) {
        throw failure('invalid_input');
      }
    } else {
      if (!('envelope' in rawInput)) {
        throw failure('invalid_input');
      }
      this.#dispatchEnvelope(rawInput.envelope);
    }
    return rawInput;
  }

  #challengeInput(
    rawInput: unknown,
    exactKeys: readonly string[],
  ): rawInput is Record<string, unknown> {
    return (
      isPlainRecord(rawInput) &&
      hasExactlyKeys(rawInput, exactKeys) &&
      isAccountId(rawInput.accountId) &&
      isContactVerificationChallengeId(rawInput.challengeId) &&
      isContactVerificationTarget(rawInput.field, rawInput.method) &&
      rawInput.purpose === CONTACT_VERIFICATION_PURPOSE &&
      isPositiveInteger(rawInput.contactVersion) &&
      isContactVerificationSubjectDigest(rawInput.subjectDigest) &&
      isKeyVersion(rawInput.subjectDigestKeyVersion) &&
      isContactVerificationVerifierDigest(rawInput.verifierDigest) &&
      isKeyVersion(rawInput.verifierDigestKeyVersion) &&
      isUnixEpochSeconds(rawInput.challengeExpiresAt) &&
      rawInput.challengeExpiresAt > 0
    );
  }

  #deliveryRequest(
    rawRequest: unknown,
    binding: EncryptContactVerificationDispatchInput,
  ): rawRequest is ContactVerificationDeliveryRequest {
    if (!isPlainRecord(rawRequest) || typeof rawRequest.method !== 'string') {
      return false;
    }
    const secretKey =
      rawRequest.method === 'email_link' ? 'singleUseToken' : 'plaintextCode';
    return (
      hasExactlyKeys(rawRequest, [
        'challengeId',
        'dispatchId',
        'destination',
        'expiresAt',
        'method',
        secretKey,
      ]) &&
      rawRequest.challengeId === binding.challengeId &&
      rawRequest.dispatchId === binding.dispatchId &&
      rawRequest.method === binding.method &&
      rawRequest.expiresAt === binding.payloadExpiresAt &&
      isCanonicalContact(binding.field, rawRequest.destination) &&
      isBoundedSecret(rawRequest[secretKey], MAX_PROOF_BYTES)
    );
  }

  #contactBinding(
    input:
      | EncryptContactVerificationContactInput
      | DecryptContactVerificationContactInput
      | EncryptContactVerificationProofInput
      | DecryptContactVerificationProofInput
      | EncryptContactVerificationDispatchInput
      | DecryptContactVerificationDispatchInput,
  ): readonly string[] {
    return [
      input.accountId,
      input.field,
      input.purpose,
      input.contactVersion.toString(10),
      input.subjectDigest,
      input.subjectDigestKeyVersion.toString(10),
    ];
  }

  #challengeBinding(
    input:
      | EncryptContactVerificationProofInput
      | DecryptContactVerificationProofInput
      | EncryptContactVerificationDispatchInput
      | DecryptContactVerificationDispatchInput,
    envelopeExpiresAt: number,
  ): readonly string[] {
    return [
      input.challengeId,
      ...this.#contactBinding(input),
      input.method,
      input.verifierDigest,
      input.verifierDigestKeyVersion.toString(10),
      input.challengeExpiresAt.toString(10),
      envelopeExpiresAt.toString(10),
    ];
  }

  #dispatchBinding(
    input:
      | EncryptContactVerificationDispatchInput
      | DecryptContactVerificationDispatchInput,
  ): readonly string[] {
    return [
      ...this.#challengeBinding(input, input.payloadExpiresAt),
      input.dispatchId,
    ];
  }

  #aad(
    kind: EnvelopeKind,
    keyVersion: ContactVerificationEnvelopeKeyVersion,
    binding: readonly string[],
  ): Buffer {
    return encodeLengthPrefixedUtf8([
      ENVELOPE_DOMAIN,
      'aead',
      kind,
      CONTACT_VERIFICATION_ENVELOPE_ALGORITHM,
      keyVersion.toString(10),
      ...binding,
    ]);
  }

  #encrypt(
    kind: EnvelopeKind,
    plaintext: Buffer,
    binding: readonly string[],
  ): ContactVerificationEncryptedEnvelope {
    const keys = this.#encryptionKeys.get(this.#activeEncryptionKeyVersion);
    if (keys === undefined) {
      throw failure('crypto_failure');
    }
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', keys[kind], nonce, {
      authTagLength: AUTH_TAG_BYTES,
    });
    cipher.setAAD(this.#aad(kind, this.#activeEncryptionKeyVersion, binding));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return Object.freeze({
      ciphertext,
      nonce,
      authTag: cipher.getAuthTag(),
      algorithm: CONTACT_VERIFICATION_ENVELOPE_ALGORITHM,
      keyVersion: this.#activeEncryptionKeyVersion,
    });
  }

  #decrypt(
    kind: EnvelopeKind,
    rawEnvelope: unknown,
    binding: readonly string[],
    maximumCiphertextBytes: number,
  ): Buffer {
    const envelope = this.#envelope(rawEnvelope, maximumCiphertextBytes);
    const keys = this.#encryptionKeys.get(envelope.keyVersion);
    if (keys === undefined) {
      throw failure('unknown_key_version');
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        keys[kind],
        envelope.nonce,
        { authTagLength: AUTH_TAG_BYTES },
      );
      decipher.setAAD(this.#aad(kind, envelope.keyVersion, binding));
      decipher.setAuthTag(envelope.authTag);
      return Buffer.concat([
        decipher.update(envelope.ciphertext),
        decipher.final(),
      ]);
    } catch {
      throw failure('authentication_failed');
    }
  }

  #envelope(
    rawEnvelope: unknown,
    maximumCiphertextBytes: number,
  ): ContactVerificationEncryptedEnvelope {
    if (
      !isPlainRecord(rawEnvelope) ||
      !hasExactlyKeys(rawEnvelope, [
        'ciphertext',
        'nonce',
        'authTag',
        'algorithm',
        'keyVersion',
      ]) ||
      !Buffer.isBuffer(rawEnvelope.ciphertext) ||
      rawEnvelope.ciphertext.length < 1 ||
      rawEnvelope.ciphertext.length > maximumCiphertextBytes ||
      !Buffer.isBuffer(rawEnvelope.nonce) ||
      rawEnvelope.nonce.length !== NONCE_BYTES ||
      !Buffer.isBuffer(rawEnvelope.authTag) ||
      rawEnvelope.authTag.length !== AUTH_TAG_BYTES ||
      rawEnvelope.algorithm !== CONTACT_VERIFICATION_ENVELOPE_ALGORITHM ||
      !isKeyVersion(rawEnvelope.keyVersion)
    ) {
      throw failure('invalid_envelope');
    }
    return rawEnvelope as unknown as ContactVerificationEncryptedEnvelope;
  }

  #dispatchEnvelope(
    rawEnvelope: unknown,
  ): ContactVerificationEncryptedDispatchEnvelope {
    if (
      !isPlainRecord(rawEnvelope) ||
      !hasExactlyKeys(rawEnvelope, [
        'ciphertext',
        'nonce',
        'authTag',
        'algorithm',
        'keyVersion',
        'payloadDigest',
        'payloadDigestKeyVersion',
      ]) ||
      !Buffer.isBuffer(rawEnvelope.payloadDigest) ||
      rawEnvelope.payloadDigest.length !== 32 ||
      !isKeyVersion(rawEnvelope.payloadDigestKeyVersion)
    ) {
      throw failure('invalid_envelope');
    }
    this.#envelope(
      {
        ciphertext: rawEnvelope.ciphertext,
        nonce: rawEnvelope.nonce,
        authTag: rawEnvelope.authTag,
        algorithm: rawEnvelope.algorithm,
        keyVersion: rawEnvelope.keyVersion,
      },
      MAX_DISPATCH_PAYLOAD_BYTES,
    );
    return rawEnvelope as unknown as ContactVerificationEncryptedDispatchEnvelope;
  }

  #payloadDigest(
    key: Buffer,
    keyVersion: ContactVerificationDigestKeyVersion,
    binding: readonly string[],
    plaintext: Buffer,
  ): Buffer {
    return createHmac('sha256', key)
      .update(
        encodeLengthPrefixedUtf8([
          ENVELOPE_DOMAIN,
          'payload-digest',
          keyVersion.toString(10),
          ...binding,
        ]),
      )
      .update(plaintext)
      .digest();
  }

  #mapEncryptError(error: unknown): ContactVerificationEnvelopeAdapterError {
    if (error instanceof ContactVerificationEnvelopeAdapterError) {
      return error;
    }
    return failure('crypto_failure');
  }

  #mapDecryptError(error: unknown): ContactVerificationEnvelopeAdapterError {
    if (error instanceof ContactVerificationEnvelopeAdapterError) {
      return error;
    }
    return failure('authentication_failed');
  }
}
