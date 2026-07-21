import {
  EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
  ExternalIdentityLookupDigestPort,
  externalIdentityLookupDigestPepperVersion,
  externalIdentityLookupDigestVersion,
  isComputedExternalIdentityLookupDigest,
} from './external-identity-lookup-digest.port';
import {
  externalIdentityLookupDigest,
  externalIdentityNamespace,
  trustProviderCanonicalizedExternalIdentitySubject,
} from './external-identity.types';

describe('external identity lookup digest port', () => {
  it('defines HMAC-SHA-256 with provider and namespace domain inputs', async () => {
    const port: ExternalIdentityLookupDigestPort = {
      async compute(input) {
        return {
          algorithm: EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM,
          provider: input.provider,
          namespace: input.namespace,
          digest: externalIdentityLookupDigest('a'.repeat(64)),
          digestVersion: input.digestVersion,
          pepperVersion: input.pepperVersion,
        };
      },
    };
    const result = await port.compute({
      provider: 'phone',
      namespace: externalIdentityNamespace('phone:e164:v1'),
      canonicalSubject:
        trustProviderCanonicalizedExternalIdentitySubject('+79990000000'),
      digestVersion: externalIdentityLookupDigestVersion(1),
      pepperVersion: externalIdentityLookupDigestPepperVersion(2),
    });

    expect(isComputedExternalIdentityLookupDigest(result)).toBe(true);
    expect(result).toMatchObject({
      algorithm: 'hmac-sha-256',
      provider: 'phone',
      namespace: 'phone:e164:v1',
      digestVersion: 1,
      pepperVersion: 2,
    });
    expect(result).not.toHaveProperty('canonicalSubject');
  });
});
