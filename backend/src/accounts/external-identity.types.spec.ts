import * as externalIdentityContracts from './external-identity.types';
import {
  CanonicalExternalIdentitySubject,
  ExternalIdentityKey,
  ExternalIdentityLookupDigest,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from './external-identity.types';

describe('external identity key contracts', () => {
  const subject =
    trustProviderCanonicalizedExternalIdentitySubject('123456789');

  it('separates the same subject across providers', () => {
    const telegramKey: ExternalIdentityKey = {
      provider: 'telegram',
      namespace: externalIdentityNamespace('telegram:bot:123'),
      lookup: { kind: 'canonical_subject', subject },
    };
    const googleKey: ExternalIdentityKey = {
      provider: 'google',
      namespace: externalIdentityNamespace('telegram:bot:123'),
      lookup: { kind: 'canonical_subject', subject },
    };

    expect(telegramKey).not.toEqual(googleKey);
  });

  it('separates the same subject across namespaces', () => {
    const firstBotKey: ExternalIdentityKey = {
      provider: 'telegram',
      namespace: externalIdentityNamespace('telegram:bot:123'),
      lookup: { kind: 'canonical_subject', subject },
    };
    const secondBotKey: ExternalIdentityKey = {
      provider: 'telegram',
      namespace: externalIdentityNamespace('telegram:bot:456'),
      lookup: { kind: 'canonical_subject', subject },
    };

    expect(firstBotKey).not.toEqual(secondBotKey);
  });

  it('does not allow a canonical subject to be used as a lookup digest', () => {
    const canonical: CanonicalExternalIdentitySubject = subject;

    // @ts-expect-error Canonical subjects and lookup digests are distinct brands.
    const digest: ExternalIdentityLookupDigest = canonical;

    expect(digest).toBe(canonical);
  });

  it('requires an explicit validated conversion for lookup digests', () => {
    const digest = externalIdentityLookupDigest('a'.repeat(64));
    const key: ExternalIdentityKey = {
      provider: 'phone',
      namespace: externalIdentityNamespace('phone:e164:v1'),
      lookup: { kind: 'lookup_digest', digest },
    };

    expect(key.lookup.kind).toBe('lookup_digest');
  });

  it.each(['', ' namespace', 'namespace ', 'name\u0000space'])(
    'rejects invalid namespace %p',
    (value) => {
      expect(() => externalIdentityNamespace(value)).toThrow(TypeError);
    },
  );

  it('rejects an overlong namespace', () => {
    expect(() => externalIdentityNamespace('n'.repeat(129))).toThrow(
      TypeError,
    );
  });

  it.each(['', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63)])(
    'rejects invalid lookup digest %p',
    (value) => {
      expect(() => externalIdentityLookupDigest(value)).toThrow(TypeError);
    },
  );

  it('does not expose a universal canonicalization factory', () => {
    expect(externalIdentityContracts).not.toHaveProperty(
      'canonicalExternalIdentitySubject',
    );

    const rawSubject = 'arbitrary-subject';
    // @ts-expect-error Raw strings require an explicit provider-adapter trust boundary.
    const canonical: CanonicalExternalIdentitySubject = rawSubject;
    expect(canonical).toBe(rawSubject);
  });
});
