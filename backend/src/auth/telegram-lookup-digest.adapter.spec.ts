import { createHmac } from 'node:crypto';
import {
  externalIdentityLookupDigestPepperVersion,
  externalIdentityLookupDigestVersion,
} from '../accounts/external-identity-lookup-digest.port';
import {
  ExternalIdentityProvider,
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from '../accounts/external-identity.types';
import {
  AuthenticationProofFingerprint,
  VerifiedTelegramProof,
  unixEpochSeconds,
} from './auth.types';
import {
  TelegramLookupDigestAdapterError,
  TelegramLookupDigestCandidatesAdapter,
} from './telegram-lookup-digest.adapter';

const PEPPER = Buffer.from('11'.repeat(32), 'hex');
const NAMESPACE = externalIdentityNamespace('telegram:bot:123456');
const SUBJECT = trustProviderCanonicalizedExternalIdentitySubject('987654321');
const FINGERPRINT = '22'.repeat(32) as AuthenticationProofFingerprint;

function encode(values: readonly string[]): Buffer {
  const parts: Buffer[] = [];
  for (const value of values) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    parts.push(length, bytes);
  }
  return Buffer.concat(parts);
}

function adapter(
  digestVersion = 1,
  pepperVersion = 1,
  pepper = PEPPER,
): TelegramLookupDigestCandidatesAdapter {
  return new TelegramLookupDigestCandidatesAdapter({
    digestVersion: externalIdentityLookupDigestVersion(digestVersion),
    pepperVersion: externalIdentityLookupDigestPepperVersion(pepperVersion),
    pepper,
  });
}

function proof(subject = SUBJECT): VerifiedTelegramProof {
  return {
    provider: 'telegram',
    namespace: NAMESPACE,
    identityKey: {
      provider: 'telegram',
      namespace: NAMESPACE,
      lookup: { kind: 'canonical_subject', subject },
    },
    authDate: unixEpochSeconds(1_800_000_000),
    verifiedAt: unixEpochSeconds(1_800_000_010),
    expiresAt: unixEpochSeconds(1_800_000_600),
    proofFingerprint: FINGERPRINT,
  };
}

describe('TelegramLookupDigestCandidatesAdapter', () => {
  it('computes the exact length-prefixed HMAC-SHA-256 candidate', async () => {
    const result = await adapter().computeCandidates(proof());
    const expected = createHmac('sha256', PEPPER)
      .update(
        encode([
          'prosto-padel/external-identity-lookup/v1',
          'telegram',
          NAMESPACE,
          SUBJECT,
          '1',
          '1',
        ]),
      )
      .digest('hex');

    expect(result.primary).toEqual({
      algorithm: 'hmac-sha-256',
      provider: 'telegram',
      namespace: NAMESPACE,
      digest: expected,
      digestVersion: 1,
      pepperVersion: 1,
    });
    expect(result.all).toEqual([result.primary]);
    expect(result.primary.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(result)).not.toContain(SUBJECT);
    expect(JSON.stringify(result)).not.toContain(PEPPER.toString('hex'));
  });

  it('is stable for the same input and configuration', async () => {
    const first = await adapter().computeCandidates(proof());
    const second = await adapter().computeCandidates(proof());
    expect(second).toEqual(first);
  });

  it.each([
    ['subject', 'phone' as ExternalIdentityProvider, 'telegram:bot:123456', '1', 1, 1],
    ['namespace', 'telegram' as ExternalIdentityProvider, 'telegram:bot:654321', '987654321', 1, 1],
    ['provider', 'google' as ExternalIdentityProvider, 'telegram:bot:123456', '987654321', 1, 1],
    ['digest version', 'telegram' as ExternalIdentityProvider, 'telegram:bot:123456', '987654321', 2, 1],
    ['pepper version', 'telegram' as ExternalIdentityProvider, 'telegram:bot:123456', '987654321', 1, 2],
  ] as const)(
    'domain-separates a different %s',
    async (_name, provider, namespace, subject, digestVersion, pepperVersion) => {
      const baseline = await adapter().compute({
        provider: 'telegram',
        namespace: NAMESPACE,
        canonicalSubject: SUBJECT,
        digestVersion: externalIdentityLookupDigestVersion(1),
        pepperVersion: externalIdentityLookupDigestPepperVersion(1),
      });
      const changed = await adapter(digestVersion, pepperVersion).compute({
        provider,
        namespace: externalIdentityNamespace(namespace),
        canonicalSubject:
          trustProviderCanonicalizedExternalIdentitySubject(subject),
        digestVersion: externalIdentityLookupDigestVersion(digestVersion),
        pepperVersion:
          externalIdentityLookupDigestPepperVersion(pepperVersion),
      });

      expect(changed.digest).not.toBe(baseline.digest);
    },
  );

  it('copies the pepper supplied to the constructor', async () => {
    const mutablePepper = Buffer.from(PEPPER);
    const instance = adapter(1, 1, mutablePepper);
    const before = await instance.computeCandidates(proof());
    mutablePepper.fill(0xff);
    const after = await instance.computeCandidates(proof());
    expect(after).toEqual(before);
  });

  it('rejects a short pepper with a fixed safe error', () => {
    const secretMarker = 'lookup-pepper-secret-marker';
    let caught: unknown;
    try {
      adapter(1, 1, Buffer.from(secretMarker));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TelegramLookupDigestAdapterError);
    const safe = caught as TelegramLookupDigestAdapterError;
    expect(safe.reason).toBe('invalid_config');
    expect(Object.getOwnPropertyNames(safe).sort()).toEqual(
      ['message', 'name', 'reason', 'stack'].sort(),
    );
    expect('cause' in safe).toBe(false);
    expect(`${safe.message}\n${safe.stack}\n${JSON.stringify(safe)}`).not.toContain(
      secretMarker,
    );
  });

  it('does not disclose an invalid canonical subject in its error', async () => {
    const subjectMarker = 'telegram-subject-secret\u0000marker';
    const invalid = proof() as unknown as {
      identityKey: { lookup: { subject: string } };
    };
    invalid.identityKey.lookup.subject = subjectMarker;

    let caught: unknown;
    try {
      await adapter().computeCandidates(invalid as unknown as VerifiedTelegramProof);
    } catch (error) {
      caught = error;
    }
    const safe = caught as TelegramLookupDigestAdapterError;
    expect(safe.reason).toBe('invalid_input');
    expect(`${safe.message}\n${safe.stack}\n${JSON.stringify(safe)}`).not.toContain(
      subjectMarker,
    );
  });
});
