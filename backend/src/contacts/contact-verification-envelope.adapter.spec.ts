import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { InternalUuid } from '../common/internal-uuid';
import {
  ContactVerificationChallengeId,
  contactVerificationSubjectDigest,
  contactVerificationVerifierDigest,
} from './contact-verification.contracts';
import {
  AesGcmContactVerificationEnvelopeAdapter,
  ContactVerificationEnvelopeAdapterConfig,
  ContactVerificationEnvelopeAdapterError,
} from './contact-verification-envelope.adapter';
import {
  CONTACT_VERIFICATION_ENVELOPE_ALGORITHM,
  CONTACT_VERIFICATION_PURPOSE,
  ContactVerificationEncryptedDispatchEnvelope,
  ContactVerificationEncryptedEnvelope,
  DecryptContactVerificationContactInput,
  DecryptContactVerificationDispatchInput,
  DecryptContactVerificationProofInput,
  EncryptContactVerificationContactInput,
  EncryptContactVerificationDispatchInput,
  EncryptContactVerificationProofInput,
  contactVerificationEnvelopeKeyVersion,
} from './contact-verification-envelope.port';
import { contactVerificationDigestKeyVersion } from './contact-verification-digest.port';

const ACCOUNT_ID = deterministicUuid(
  'contact-verification-envelope-account',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'contact-verification-envelope-other-account',
) as AccountId;
const CHALLENGE_ID = deterministicUuid(
  'contact-verification-envelope-challenge',
) as ContactVerificationChallengeId;
const OTHER_CHALLENGE_ID = deterministicUuid(
  'contact-verification-envelope-other-challenge',
) as ContactVerificationChallengeId;
const DISPATCH_ID = deterministicUuid(
  'contact-verification-envelope-dispatch',
) as InternalUuid;
const OTHER_DISPATCH_ID = deterministicUuid(
  'contact-verification-envelope-other-dispatch',
) as InternalUuid;
const SUBJECT_DIGEST = contactVerificationSubjectDigest('11'.repeat(32));
const OTHER_SUBJECT_DIGEST = contactVerificationSubjectDigest('22'.repeat(32));
const VERIFIER_DIGEST = contactVerificationVerifierDigest('33'.repeat(32));
const OTHER_VERIFIER_DIGEST = contactVerificationVerifierDigest(
  '44'.repeat(32),
);
const SUBJECT_KEY_VERSION = contactVerificationDigestKeyVersion(3);
const VERIFIER_KEY_VERSION = contactVerificationDigestKeyVersion(4);
const ENCRYPTION_VERSION_1 = contactVerificationEnvelopeKeyVersion(1);
const ENCRYPTION_VERSION_2 = contactVerificationEnvelopeKeyVersion(2);
const DIGEST_VERSION_1 = contactVerificationDigestKeyVersion(11);
const DIGEST_VERSION_2 = contactVerificationDigestKeyVersion(12);
const CHALLENGE_EXPIRES_AT = unixEpochSeconds(1_800_000_900);
const ENVELOPE_EXPIRES_AT = unixEpochSeconds(1_800_000_600);
const PHONE = '+79991234567';
const EMAIL = 'player@example.test';
const CODE = '482951';
const TOKEN = 'email-link-single-use-token-marker';
const PRIVATE_MARKER = 'contact-envelope-private-marker';

function config(
  activeEncryptionKeyVersion = ENCRYPTION_VERSION_2,
  activeDigestKeyVersion = DIGEST_VERSION_2,
): ContactVerificationEnvelopeAdapterConfig {
  return {
    activeEncryptionKeyVersion,
    encryptionKeys: [
      { keyVersion: ENCRYPTION_VERSION_1, secret: Buffer.alloc(32, 0x11) },
      { keyVersion: ENCRYPTION_VERSION_2, secret: Buffer.alloc(32, 0x12) },
    ],
    activeDigestKeyVersion,
    digestKeys: [
      { keyVersion: DIGEST_VERSION_1, secret: Buffer.alloc(32, 0x21) },
      { keyVersion: DIGEST_VERSION_2, secret: Buffer.alloc(32, 0x22) },
    ],
  };
}

function adapter(
  activeEncryptionKeyVersion = ENCRYPTION_VERSION_2,
  activeDigestKeyVersion = DIGEST_VERSION_2,
): AesGcmContactVerificationEnvelopeAdapter {
  return new AesGcmContactVerificationEnvelopeAdapter(
    config(activeEncryptionKeyVersion, activeDigestKeyVersion),
  );
}

function contactInput(
  overrides: Partial<EncryptContactVerificationContactInput> = {},
): EncryptContactVerificationContactInput {
  return {
    accountId: ACCOUNT_ID,
    field: 'phone',
    purpose: CONTACT_VERIFICATION_PURPOSE,
    contactVersion: 7,
    subjectDigest: SUBJECT_DIGEST,
    subjectDigestKeyVersion: SUBJECT_KEY_VERSION,
    canonicalContact: PHONE,
    ...overrides,
  } as EncryptContactVerificationContactInput;
}

function proofInput(
  method: 'phone_sms_otp' | 'email_code' | 'email_link' = 'phone_sms_otp',
  overrides: Record<string, unknown> = {},
): EncryptContactVerificationProofInput {
  const field = method === 'phone_sms_otp' ? 'phone' : 'email';
  return {
    challengeId: CHALLENGE_ID,
    accountId: ACCOUNT_ID,
    field,
    method,
    purpose: CONTACT_VERIFICATION_PURPOSE,
    contactVersion: 7,
    subjectDigest: SUBJECT_DIGEST,
    subjectDigestKeyVersion: SUBJECT_KEY_VERSION,
    verifierDigest: VERIFIER_DIGEST,
    verifierDigestKeyVersion: VERIFIER_KEY_VERSION,
    challengeExpiresAt: CHALLENGE_EXPIRES_AT,
    plaintextProof: method === 'email_link' ? TOKEN : CODE,
    proofExpiresAt: ENVELOPE_EXPIRES_AT,
    ...overrides,
  } as EncryptContactVerificationProofInput;
}

function dispatchInput(
  method: 'phone_sms_otp' | 'email_code' | 'email_link' = 'phone_sms_otp',
  overrides: Record<string, unknown> = {},
): EncryptContactVerificationDispatchInput {
  const field = method === 'phone_sms_otp' ? 'phone' : 'email';
  const request = {
    challengeId: CHALLENGE_ID,
    dispatchId: DISPATCH_ID,
    destination: field === 'phone' ? PHONE : EMAIL,
    expiresAt: ENVELOPE_EXPIRES_AT,
    method,
    ...(method === 'email_link'
      ? { singleUseToken: TOKEN }
      : { plaintextCode: CODE }),
  };
  return {
    challengeId: CHALLENGE_ID,
    accountId: ACCOUNT_ID,
    field,
    method,
    purpose: CONTACT_VERIFICATION_PURPOSE,
    contactVersion: 7,
    subjectDigest: SUBJECT_DIGEST,
    subjectDigestKeyVersion: SUBJECT_KEY_VERSION,
    verifierDigest: VERIFIER_DIGEST,
    verifierDigestKeyVersion: VERIFIER_KEY_VERSION,
    challengeExpiresAt: CHALLENGE_EXPIRES_AT,
    dispatchId: DISPATCH_ID,
    payloadExpiresAt: ENVELOPE_EXPIRES_AT,
    request,
    ...overrides,
  } as EncryptContactVerificationDispatchInput;
}

function contactDecryptInput(
  input: EncryptContactVerificationContactInput,
  envelope: ContactVerificationEncryptedEnvelope,
): DecryptContactVerificationContactInput {
  const { canonicalContact: _canonicalContact, ...binding } = input;
  return { ...binding, envelope };
}

function proofDecryptInput(
  input: EncryptContactVerificationProofInput,
  envelope: ContactVerificationEncryptedEnvelope,
): DecryptContactVerificationProofInput {
  const { plaintextProof: _plaintextProof, ...binding } = input;
  return { ...binding, envelope };
}

function dispatchDecryptInput(
  input: EncryptContactVerificationDispatchInput,
  envelope: ContactVerificationEncryptedDispatchEnvelope,
): DecryptContactVerificationDispatchInput {
  const { request: _request, ...binding } = input;
  return { ...binding, envelope };
}

function mutateBuffer(value: Buffer): Buffer {
  const changed = Buffer.from(value);
  changed[0] ^= 0xff;
  return changed;
}

function serializedEnvelope(envelope: object): string {
  return Object.values(envelope)
    .map((value) =>
      Buffer.isBuffer(value) ? value.toString('utf8') : String(value),
    )
    .join('\n');
}

describe('AesGcmContactVerificationEnvelopeAdapter', () => {
  it.each([
    ['phone', PHONE],
    ['email', EMAIL],
  ] as const)(
    'round-trips a current %s without plaintext persistence',
    (field, value) => {
      const crypto = adapter();
      const input = contactInput({
        field,
        canonicalContact: value,
        subjectDigest:
          field === 'phone' ? SUBJECT_DIGEST : OTHER_SUBJECT_DIGEST,
      });
      const encrypted = crypto.encryptContact(input);

      expect(encrypted).toMatchObject({
        algorithm: CONTACT_VERIFICATION_ENVELOPE_ALGORITHM,
        keyVersion: ENCRYPTION_VERSION_2,
      });
      expect(encrypted.nonce).toHaveLength(12);
      expect(encrypted.authTag).toHaveLength(16);
      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
      expect(encrypted.ciphertext.length).toBeLessThanOrEqual(4_096);
      expect(serializedEnvelope(encrypted)).not.toContain(value);
      expect(crypto.decryptContact(contactDecryptInput(input, encrypted))).toBe(
        value,
      );
    },
  );

  it('uses a fresh nonce while keeping the same contact binding decryptable', () => {
    const crypto = adapter();
    const input = contactInput();
    const first = crypto.encryptContact(input);
    const second = crypto.encryptContact(input);

    expect(first.nonce).not.toEqual(second.nonce);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(crypto.decryptContact(contactDecryptInput(input, first))).toBe(
      PHONE,
    );
    expect(crypto.decryptContact(contactDecryptInput(input, second))).toBe(
      PHONE,
    );
  });

  it.each(['phone_sms_otp', 'email_code', 'email_link'] as const)(
    'round-trips an active %s proof within the challenge expiry',
    (method) => {
      const crypto = adapter();
      const input = proofInput(method);
      const encrypted = crypto.encryptProof(input);

      expect(encrypted.ciphertext.length).toBeLessThanOrEqual(4_096);
      expect(serializedEnvelope(encrypted)).not.toContain(input.plaintextProof);
      expect(crypto.decryptProof(proofDecryptInput(input, encrypted))).toBe(
        input.plaintextProof,
      );
    },
  );

  it.each(['phone_sms_otp', 'email_code', 'email_link'] as const)(
    'round-trips an exact %s dispatch and emits migration-042 metadata',
    (method) => {
      const crypto = adapter();
      const input = dispatchInput(method);
      const encrypted = crypto.encryptDispatch(input);

      expect(encrypted).toMatchObject({
        algorithm: 'aes_256_gcm',
        keyVersion: ENCRYPTION_VERSION_2,
        payloadDigestKeyVersion: DIGEST_VERSION_2,
      });
      expect(encrypted.nonce).toHaveLength(12);
      expect(encrypted.authTag).toHaveLength(16);
      expect(encrypted.payloadDigest).toHaveLength(32);
      expect(encrypted.ciphertext.length).toBeLessThanOrEqual(16_384);
      expect(serializedEnvelope(encrypted)).not.toContain(
        input.request.destination,
      );
      expect(serializedEnvelope(encrypted)).not.toContain(
        input.request.method === 'email_link'
          ? input.request.singleUseToken
          : input.request.plaintextCode,
      );
      expect(
        crypto.decryptDispatch(dispatchDecryptInput(input, encrypted)),
      ).toEqual(input.request);
    },
  );

  it('keeps a stable keyed digest for byte-equivalent dispatches with fresh AEAD nonces', () => {
    const crypto = adapter();
    const input = dispatchInput('email_code');
    const first = crypto.encryptDispatch(input);
    const second = crypto.encryptDispatch(input);

    expect(first.nonce).not.toEqual(second.nonce);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    expect(first.payloadDigest).toEqual(second.payloadDigest);
    expect(crypto.decryptDispatch(dispatchDecryptInput(input, first))).toEqual(
      input.request,
    );
  });

  it('binds a contact envelope to owner, field, version and subject digest metadata', () => {
    const crypto = adapter();
    const input = contactInput();
    const encrypted = crypto.encryptContact(input);
    const attempts = [
      contactDecryptInput({ ...input, accountId: OTHER_ACCOUNT_ID }, encrypted),
      contactDecryptInput(
        {
          ...input,
          field: 'email',
          canonicalContact: EMAIL,
        },
        encrypted,
      ),
      contactDecryptInput({ ...input, contactVersion: 8 }, encrypted),
      contactDecryptInput(
        { ...input, subjectDigest: OTHER_SUBJECT_DIGEST },
        encrypted,
      ),
      contactDecryptInput(
        {
          ...input,
          subjectDigestKeyVersion: contactVerificationDigestKeyVersion(99),
        },
        encrypted,
      ),
    ];

    for (const attempt of attempts) {
      expect(() => crypto.decryptContact(attempt)).toThrow(
        expect.objectContaining({ reason: 'authentication_failed' }),
      );
    }
  });

  it('binds proof ciphertext across challenge, channel, verifier and expiry', () => {
    const crypto = adapter();
    const input = proofInput('email_code');
    const encrypted = crypto.encryptProof(input);
    const attempts = [
      proofDecryptInput(
        { ...input, challengeId: OTHER_CHALLENGE_ID },
        encrypted,
      ),
      proofDecryptInput(
        {
          ...input,
          field: 'email',
          method: 'email_link',
          plaintextProof: TOKEN,
        } as EncryptContactVerificationProofInput,
        encrypted,
      ),
      proofDecryptInput({ ...input, contactVersion: 8 }, encrypted),
      proofDecryptInput(
        { ...input, verifierDigest: OTHER_VERIFIER_DIGEST },
        encrypted,
      ),
      proofDecryptInput(
        {
          ...input,
          proofExpiresAt: unixEpochSeconds(ENVELOPE_EXPIRES_AT - 1),
        },
        encrypted,
      ),
    ];

    for (const attempt of attempts) {
      expect(() => crypto.decryptProof(attempt)).toThrow(
        expect.objectContaining({ reason: 'authentication_failed' }),
      );
    }
  });

  it('binds dispatch payloads to the same challenge, dispatch and recovery expiry', () => {
    const crypto = adapter();
    const input = dispatchInput('phone_sms_otp');
    const encrypted = crypto.encryptDispatch(input);
    const attempts = [
      dispatchDecryptInput(
        { ...input, challengeId: OTHER_CHALLENGE_ID },
        encrypted,
      ),
      dispatchDecryptInput(
        { ...input, dispatchId: OTHER_DISPATCH_ID },
        encrypted,
      ),
      dispatchDecryptInput({ ...input, contactVersion: 8 }, encrypted),
      dispatchDecryptInput(
        {
          ...input,
          payloadExpiresAt: unixEpochSeconds(ENVELOPE_EXPIRES_AT - 1),
        },
        encrypted,
      ),
    ];

    for (const attempt of attempts) {
      expect(() => crypto.decryptDispatch(attempt)).toThrow(
        expect.objectContaining({ reason: 'authentication_failed' }),
      );
    }
  });

  it('rejects ciphertext, nonce, tag and keyed-digest tampering', () => {
    const crypto = adapter();
    const input = dispatchInput('email_link');
    const encrypted = crypto.encryptDispatch(input);
    const attempts = [
      { ...encrypted, ciphertext: mutateBuffer(encrypted.ciphertext) },
      { ...encrypted, nonce: mutateBuffer(encrypted.nonce) },
      { ...encrypted, authTag: mutateBuffer(encrypted.authTag) },
      { ...encrypted, payloadDigest: mutateBuffer(encrypted.payloadDigest) },
    ];

    for (const envelope of attempts) {
      expect(() =>
        crypto.decryptDispatch(dispatchDecryptInput(input, envelope)),
      ).toThrow(
        expect.objectContaining({
          reason: expect.stringMatching(
            /authentication_failed|invalid_envelope/u,
          ),
        }),
      );
    }
  });

  it('domain-separates contact, proof and dispatch encryption keys', () => {
    const crypto = adapter();
    const contact = contactInput();
    const contactEnvelope = crypto.encryptContact(contact);
    const proof = proofInput('phone_sms_otp', { plaintextProof: PHONE });

    expect(() =>
      crypto.decryptProof(proofDecryptInput(proof, contactEnvelope)),
    ).toThrow(expect.objectContaining({ reason: 'authentication_failed' }));
  });

  it('decrypts retained old key versions while encrypting with the active versions', () => {
    const oldCrypto = adapter(ENCRYPTION_VERSION_1, DIGEST_VERSION_1);
    const rotatedCrypto = adapter(ENCRYPTION_VERSION_2, DIGEST_VERSION_2);
    const input = dispatchInput('email_code');
    const oldEnvelope = oldCrypto.encryptDispatch(input);
    const currentEnvelope = rotatedCrypto.encryptDispatch(input);

    expect(oldEnvelope.keyVersion).toBe(ENCRYPTION_VERSION_1);
    expect(oldEnvelope.payloadDigestKeyVersion).toBe(DIGEST_VERSION_1);
    expect(
      rotatedCrypto.decryptDispatch(dispatchDecryptInput(input, oldEnvelope)),
    ).toEqual(input.request);
    expect(currentEnvelope.keyVersion).toBe(ENCRYPTION_VERSION_2);
    expect(currentEnvelope.payloadDigestKeyVersion).toBe(DIGEST_VERSION_2);
  });

  it('fails closed for unknown encryption and digest key versions', () => {
    const crypto = adapter();
    const input = dispatchInput();
    const encrypted = crypto.encryptDispatch(input);

    expect(() =>
      crypto.decryptDispatch(
        dispatchDecryptInput(input, {
          ...encrypted,
          keyVersion: contactVerificationEnvelopeKeyVersion(99),
        }),
      ),
    ).toThrow(expect.objectContaining({ reason: 'unknown_key_version' }));
    expect(() =>
      crypto.decryptDispatch(
        dispatchDecryptInput(input, {
          ...encrypted,
          payloadDigestKeyVersion: contactVerificationDigestKeyVersion(99),
        }),
      ),
    ).toThrow(expect.objectContaining({ reason: 'unknown_key_version' }));
  });

  it('rejects invalid bindings and mismatched delivery requests before encryption', () => {
    const crypto = adapter();
    const wrongDispatch = dispatchInput('phone_sms_otp', {
      request: {
        ...dispatchInput('phone_sms_otp').request,
        dispatchId: OTHER_DISPATCH_ID,
      },
    });
    const wrongMethod = dispatchInput('email_code', {
      request: {
        ...dispatchInput('email_code').request,
        method: 'email_link',
        singleUseToken: TOKEN,
      },
    });

    for (const invalid of [
      contactInput({ canonicalContact: 'PLAYER@EXAMPLE.TEST' }),
      proofInput('phone_sms_otp', { plaintextProof: ` ${CODE}` }),
      proofInput('phone_sms_otp', {
        proofExpiresAt: unixEpochSeconds(CHALLENGE_EXPIRES_AT + 1),
      }),
      wrongDispatch,
      wrongMethod,
    ]) {
      const invoke =
        'canonicalContact' in invalid
          ? () =>
              crypto.encryptContact(
                invalid as EncryptContactVerificationContactInput,
              )
          : 'request' in invalid
            ? () =>
                crypto.encryptDispatch(
                  invalid as EncryptContactVerificationDispatchInput,
                )
            : () =>
                crypto.encryptProof(
                  invalid as EncryptContactVerificationProofInput,
                );
      expect(invoke).toThrow(
        expect.objectContaining({ reason: 'invalid_input' }),
      );
    }
  });

  it('rejects malformed envelope shapes before cryptographic processing', () => {
    const crypto = adapter();
    const input = contactInput();
    const encrypted = crypto.encryptContact(input);
    const malformed = [
      { ...encrypted, nonce: Buffer.alloc(11) },
      { ...encrypted, authTag: Buffer.alloc(15) },
      { ...encrypted, algorithm: 'aes_256_cbc' },
      { ...encrypted, extra: PRIVATE_MARKER },
      { ...encrypted, ciphertext: Buffer.alloc(0) },
    ];

    for (const envelope of malformed) {
      expect(() =>
        crypto.decryptContact(
          contactDecryptInput(
            input,
            envelope as ContactVerificationEncryptedEnvelope,
          ),
        ),
      ).toThrow(expect.objectContaining({ reason: 'invalid_envelope' }));
    }
  });

  it('copies caller key material and is unaffected by later caller mutation', () => {
    const rawConfig = config();
    const encryptionSecret = rawConfig.encryptionKeys[1].secret;
    const digestSecret = rawConfig.digestKeys[1].secret;
    const crypto = new AesGcmContactVerificationEnvelopeAdapter(rawConfig);
    const input = dispatchInput();
    const encrypted = crypto.encryptDispatch(input);

    encryptionSecret.fill(0);
    digestSecret.fill(0);
    expect(
      crypto.decryptDispatch(dispatchDecryptInput(input, encrypted)),
    ).toEqual(input.request);
  });

  it('keeps payload equality independent from encryption-key rotation', () => {
    const input = dispatchInput('email_link');
    const oldEncryption = adapter(ENCRYPTION_VERSION_1, DIGEST_VERSION_2);
    const newEncryption = adapter(ENCRYPTION_VERSION_2, DIGEST_VERSION_2);
    const oldEnvelope = oldEncryption.encryptDispatch(input);
    const newEnvelope = newEncryption.encryptDispatch(input);

    expect(oldEnvelope.keyVersion).not.toBe(newEnvelope.keyVersion);
    expect(oldEnvelope.payloadDigest).toEqual(newEnvelope.payloadDigest);
    expect(oldEnvelope.payloadDigestKeyVersion).toBe(DIGEST_VERSION_2);
    expect(newEnvelope.payloadDigestKeyVersion).toBe(DIGEST_VERSION_2);
  });

  it('returns fixed PII-safe errors for config, input and authentication failures', () => {
    let configError: unknown;
    try {
      new AesGcmContactVerificationEnvelopeAdapter({
        ...config(),
        encryptionKeys: [
          {
            keyVersion: ENCRYPTION_VERSION_1,
            secret: Buffer.from(`${PRIVATE_MARKER}-short`),
          },
        ],
      });
    } catch (error) {
      configError = error;
    }

    let inputError: unknown;
    try {
      adapter().encryptProof(
        proofInput('email_link', { plaintextProof: PRIVATE_MARKER + '\n' }),
      );
    } catch (error) {
      inputError = error;
    }

    const input = dispatchInput('email_link', {
      request: {
        ...dispatchInput('email_link').request,
        singleUseToken: PRIVATE_MARKER,
      },
    });
    const encrypted = adapter().encryptDispatch(input);
    let authenticationError: unknown;
    try {
      adapter().decryptDispatch(
        dispatchDecryptInput(input, {
          ...encrypted,
          authTag: mutateBuffer(encrypted.authTag),
        }),
      );
    } catch (error) {
      authenticationError = error;
    }

    for (const error of [configError, inputError, authenticationError]) {
      expect(error).toBeInstanceOf(ContactVerificationEnvelopeAdapterError);
      expect(inspect(error)).not.toContain(PRIVATE_MARKER);
      expect(inspect(error)).not.toContain(PHONE);
      expect(inspect(error)).not.toContain(EMAIL);
    }
  });

  it('rejects duplicate, missing-active and oversized keyring configuration', () => {
    const valid = config();
    const invalidConfigs = [
      {
        ...valid,
        encryptionKeys: [valid.encryptionKeys[0], valid.encryptionKeys[0]],
      },
      {
        ...valid,
        activeDigestKeyVersion: contactVerificationDigestKeyVersion(99),
      },
      {
        ...valid,
        digestKeys: Array.from({ length: 33 }, (_, index) => ({
          keyVersion: contactVerificationDigestKeyVersion(index + 1),
          secret: Buffer.alloc(32, index),
        })),
      },
    ];

    for (const invalid of invalidConfigs) {
      expect(
        () => new AesGcmContactVerificationEnvelopeAdapter(invalid),
      ).toThrow(expect.objectContaining({ reason: 'invalid_config' }));
    }
  });

  it('fails closed when explicitly disabled', () => {
    const disabled = AesGcmContactVerificationEnvelopeAdapter.disabled();
    expect(() => disabled.encryptContact(contactInput())).toThrow(
      expect.objectContaining({ reason: 'disabled' }),
    );
  });

  it('stays outside runtime, database and configuration modules', () => {
    const modules = [
      join(__dirname, '..', 'app.module.ts'),
      join(__dirname, '..', 'auth', 'auth.module.ts'),
      join(__dirname, '..', 'database', 'database.module.ts'),
      join(__dirname, '..', 'config', 'env.validation.ts'),
    ].map((path) => readFileSync(path, 'utf8'));
    expect(modules.join('\n')).not.toMatch(
      /AesGcmContactVerificationEnvelopeAdapter|contact-verification-envelope/gu,
    );
  });
});
