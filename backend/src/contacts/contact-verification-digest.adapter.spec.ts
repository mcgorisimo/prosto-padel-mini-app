import { createHmac, hkdfSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { encodeLengthPrefixedUtf8 } from '../auth/crypto-encoding';
import {
  ContactVerificationDigestAdapterError,
  HmacContactVerificationDigestAdapter,
} from './contact-verification-digest.adapter';
import {
  ContactVerificationDigestKeyVersion,
  contactVerificationDigestKeyVersion,
} from './contact-verification-digest.port';

const SECRET = Buffer.from('31'.repeat(32), 'hex');
const KEY_VERSION = contactVerificationDigestKeyVersion(7);
const PRIVATE_CONTACT = 'player@example.test';
const PRIVATE_PROOF = '928451';
const PRIVATE_REQUEST = '{"field":"email","method":"email_code"}';
const PRIVATE_SOURCE = '203.0.113.0/24';
const DOMAIN = 'prosto-padel/contact-verification-digest/v1';
const SALT = 'prosto-padel/contact-verification-digest-key/v1';

function adapter(
  secret = SECRET,
  keyVersion: ContactVerificationDigestKeyVersion = KEY_VERSION,
): HmacContactVerificationDigestAdapter {
  return new HmacContactVerificationDigestAdapter({ secret, keyVersion });
}

function expected(
  kind: 'subject' | 'verifier' | 'request' | 'source',
  values: readonly string[],
  secret = SECRET,
  keyVersion = KEY_VERSION,
): string {
  const key = Buffer.from(
    hkdfSync(
      'sha256',
      secret,
      Buffer.from(SALT, 'utf8'),
      Buffer.from(kind, 'utf8'),
      32,
    ),
  );
  return createHmac('sha256', key)
    .update(
      encodeLengthPrefixedUtf8([
        DOMAIN,
        kind,
        keyVersion.toString(10),
        ...values,
      ]),
    )
    .digest('hex');
}

describe('HmacContactVerificationDigestAdapter', () => {
  it('computes the exact current-contact digest without returning plaintext', () => {
    const result = adapter().computeSubject({
      field: 'email',
      canonicalContact: PRIVATE_CONTACT,
    });

    expect(result).toEqual({
      kind: 'subject',
      algorithm: 'hmac-sha-256',
      keyVersion: KEY_VERSION,
      field: 'email',
      digest: expected('subject', ['email', PRIVATE_CONTACT]),
    });
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(result)).not.toContain(PRIVATE_CONTACT);
    expect(JSON.stringify(result)).not.toContain(SECRET.toString('hex'));
  });

  it.each([
    ['phone_sms_otp', 'phone'],
    ['email_code', 'email'],
    ['email_link', 'email'],
  ] as const)(
    'domain-binds %s verifier proof to its exact target',
    (method, field) => {
      const result = adapter().computeVerifier({
        field,
        method,
        plaintextProof: PRIVATE_PROOF,
      });
      expect(result).toEqual({
        kind: 'verifier',
        algorithm: 'hmac-sha-256',
        keyVersion: KEY_VERSION,
        field,
        method,
        digest: expected('verifier', [field, method, PRIVATE_PROOF]),
      });
      expect(JSON.stringify(result)).not.toContain(PRIVATE_PROOF);
    },
  );

  it('domain-separates equal proof bytes across methods', () => {
    const code = adapter().computeVerifier({
      field: 'email',
      method: 'email_code',
      plaintextProof: PRIVATE_PROOF,
    });
    const link = adapter().computeVerifier({
      field: 'email',
      method: 'email_link',
      plaintextProof: PRIVATE_PROOF,
    });
    expect(link.digest).not.toBe(code.digest);
  });

  it('domain-separates request operations and source keys', () => {
    const start = adapter().computeRequest({
      operation: 'start',
      canonicalRequest: PRIVATE_REQUEST,
    });
    const resend = adapter().computeRequest({
      operation: 'reserve_resend',
      canonicalRequest: PRIVATE_REQUEST,
    });
    const source = adapter().computeSource({
      canonicalSource: PRIVATE_SOURCE,
    });

    expect(start.digest).toBe(expected('request', ['start', PRIVATE_REQUEST]));
    expect(resend.digest).toBe(
      expected('request', ['reserve_resend', PRIVATE_REQUEST]),
    );
    expect(source.digest).toBe(expected('source', [PRIVATE_SOURCE]));
    expect(new Set([start.digest, resend.digest, source.digest]).size).toBe(3);
    expect(JSON.stringify({ start, resend, source })).not.toMatch(
      /player@example|203\.0\.113/iu,
    );
  });

  it('changes every digest when the persisted key version changes', () => {
    const nextVersion = contactVerificationDigestKeyVersion(8);
    const current = adapter().computeSource({
      canonicalSource: PRIVATE_SOURCE,
    });
    const next = adapter(SECRET, nextVersion).computeSource({
      canonicalSource: PRIVATE_SOURCE,
    });
    expect(next.keyVersion).toBe(nextVersion);
    expect(next.digest).not.toBe(current.digest);
  });

  it('copies secret material supplied by the caller', () => {
    const mutableSecret = Buffer.from(SECRET);
    const instance = adapter(mutableSecret);
    const before = instance.computeRequest({
      operation: 'start',
      canonicalRequest: PRIVATE_REQUEST,
    });
    mutableSecret.fill(0xff);
    const after = instance.computeRequest({
      operation: 'start',
      canonicalRequest: PRIVATE_REQUEST,
    });
    expect(after).toEqual(before);
  });

  it.each([
    [{ field: 'phone', canonicalContact: '79990000000' }, 'phone without plus'],
    [
      { field: 'email', canonicalContact: 'Player@example.test' },
      'mixed-case email',
    ],
    [
      { field: 'email', canonicalContact: ' player@example.test' },
      'padded email',
    ],
    [{ field: 'name', canonicalContact: PRIVATE_CONTACT }, 'unknown field'],
  ])('rejects non-canonical subject input: %s', (input) => {
    expect(() => adapter().computeSubject(input as never)).toThrow(
      ContactVerificationDigestAdapterError,
    );
  });

  it.each([
    { field: 'phone', method: 'email_code', plaintextProof: PRIVATE_PROOF },
    { field: 'email', method: 'phone_sms_otp', plaintextProof: PRIVATE_PROOF },
    { field: 'email', method: 'email_code', plaintextProof: '' },
    { field: 'email', method: 'email_code', plaintextProof: ' padded ' },
    { field: 'email', method: 'email_link', plaintextProof: 'token\nvalue' },
  ])('rejects confused or non-canonical verifier input: %p', (input) => {
    expect(() => adapter().computeVerifier(input as never)).toThrow(
      ContactVerificationDigestAdapterError,
    );
  });

  it.each([
    null,
    {},
    { operation: 'start', canonicalRequest: '' },
    { operation: 'unknown', canonicalRequest: PRIVATE_REQUEST },
    { operation: 'start', canonicalRequest: PRIVATE_REQUEST, extra: true },
  ])('rejects invalid request input without hashing it: %p', (input) => {
    expect(() => adapter().computeRequest(input as never)).toThrow(
      ContactVerificationDigestAdapterError,
    );
  });

  it('returns fixed safe errors without secret or input material', () => {
    const secretMarker = 'contact-digest-secret-marker';
    let configError: unknown;
    try {
      adapter(Buffer.from(secretMarker));
    } catch (error) {
      configError = error;
    }
    expect(configError).toBeInstanceOf(ContactVerificationDigestAdapterError);
    expect(configError).toMatchObject({ reason: 'invalid_config' });

    let inputError: unknown;
    try {
      adapter().computeSource({
        canonicalSource: `private-${PRIVATE_SOURCE}\nmarker`,
      });
    } catch (error) {
      inputError = error;
    }
    expect(inputError).toMatchObject({ reason: 'invalid_input' });
    const serialized = `${inspect(configError)}\n${inspect(inputError)}`;
    expect(serialized).not.toContain(secretMarker);
    expect(serialized).not.toContain(PRIVATE_SOURCE);
    expect(serialized).not.toContain(SECRET.toString('hex'));
  });

  it('rejects invalid key versions at the contract boundary', () => {
    for (const invalid of [0, -1, 2_147_483_648, Number.NaN]) {
      expect(() => contactVerificationDigestKeyVersion(invalid)).toThrow(
        TypeError,
      );
    }
  });

  it('fails closed when explicitly disabled', () => {
    const disabled = HmacContactVerificationDigestAdapter.disabled();
    expect(() =>
      disabled.computeSource({ canonicalSource: PRIVATE_SOURCE }),
    ).toThrow(expect.objectContaining({ reason: 'disabled' }));
  });

  it('stays outside every runtime module', () => {
    const modules = [
      join(__dirname, '..', 'app.module.ts'),
      join(__dirname, '..', 'auth', 'auth.module.ts'),
      join(__dirname, '..', 'database', 'database.module.ts'),
    ].map((path) => readFileSync(path, 'utf8'));
    expect(modules.join('\n')).not.toMatch(
      /HmacContactVerificationDigestAdapter|contact-verification-digest/gu,
    );
  });
});
