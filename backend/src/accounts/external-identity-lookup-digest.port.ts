import {
  EXTERNAL_IDENTITY_PROVIDERS,
  CanonicalExternalIdentitySubject,
  ExternalIdentityLookupDigest,
  ExternalIdentityNamespace,
  ExternalIdentityProvider,
  externalIdentityLookupDigest,
  externalIdentityNamespace,
} from './external-identity.types';

export const EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM =
  'hmac-sha-256' as const;

declare const lookupDigestVersionBrand: unique symbol;
declare const lookupDigestPepperVersionBrand: unique symbol;

export type ExternalIdentityLookupDigestVersion = number & {
  readonly [lookupDigestVersionBrand]: 'ExternalIdentityLookupDigestVersion';
};

export type ExternalIdentityLookupDigestPepperVersion = number & {
  readonly [lookupDigestPepperVersionBrand]:
    'ExternalIdentityLookupDigestPepperVersion';
};

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0
  );
}

export function externalIdentityLookupDigestVersion(
  value: number,
): ExternalIdentityLookupDigestVersion {
  if (!isPositiveSafeInteger(value)) {
    throw new TypeError('External identity lookup digest version is invalid');
  }

  return value as ExternalIdentityLookupDigestVersion;
}

export function externalIdentityLookupDigestPepperVersion(
  value: number,
): ExternalIdentityLookupDigestPepperVersion {
  if (!isPositiveSafeInteger(value)) {
    throw new TypeError('External identity lookup digest pepper version is invalid');
  }

  return value as ExternalIdentityLookupDigestPepperVersion;
}

export interface ExternalIdentityLookupDigestComputationInput {
  readonly provider: ExternalIdentityProvider;
  readonly namespace: ExternalIdentityNamespace;
  /** Transient provider-canonicalized value; never persist or log it. */
  readonly canonicalSubject: CanonicalExternalIdentitySubject;
  readonly digestVersion: ExternalIdentityLookupDigestVersion;
  readonly pepperVersion: ExternalIdentityLookupDigestPepperVersion;
}

export interface ComputedExternalIdentityLookupDigest {
  readonly algorithm: typeof EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM;
  readonly provider: ExternalIdentityProvider;
  readonly namespace: ExternalIdentityNamespace;
  readonly digest: ExternalIdentityLookupDigest;
  readonly digestVersion: ExternalIdentityLookupDigestVersion;
  readonly pepperVersion: ExternalIdentityLookupDigestPepperVersion;
}

/**
 * The adapter must compute a 32-byte HMAC-SHA-256 value over an unambiguous,
 * versioned encoding that domain-separates provider and namespace. Pepper
 * material and keys remain outside PostgreSQL and outside this contract.
 */
export interface ExternalIdentityLookupDigestPort {
  compute(
    input: ExternalIdentityLookupDigestComputationInput,
  ): Promise<ComputedExternalIdentityLookupDigest>;
}

function passesStringFactory(
  value: unknown,
  factory: (input: string) => unknown,
): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  try {
    factory(value);
    return true;
  } catch {
    return false;
  }
}

export function isComputedExternalIdentityLookupDigest(
  value: unknown,
): value is ComputedExternalIdentityLookupDigest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  return (
    keys.length === 6 &&
    [
      'algorithm',
      'provider',
      'namespace',
      'digest',
      'digestVersion',
      'pepperVersion',
    ].every((key) => Object.prototype.hasOwnProperty.call(candidate, key)) &&
    candidate.algorithm === EXTERNAL_IDENTITY_LOOKUP_DIGEST_ALGORITHM &&
    typeof candidate.provider === 'string' &&
    (EXTERNAL_IDENTITY_PROVIDERS as readonly string[]).includes(
      candidate.provider,
    ) &&
    passesStringFactory(candidate.namespace, externalIdentityNamespace) &&
    passesStringFactory(candidate.digest, externalIdentityLookupDigest) &&
    isPositiveSafeInteger(candidate.digestVersion) &&
    isPositiveSafeInteger(candidate.pepperVersion)
  );
}
