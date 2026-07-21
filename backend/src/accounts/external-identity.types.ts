export const EXTERNAL_IDENTITY_PROVIDERS = Object.freeze([
  'telegram',
  'apple',
  'google',
  'phone',
] as const);

export type ExternalIdentityProvider =
  (typeof EXTERNAL_IDENTITY_PROVIDERS)[number];

/**
 * Compatibility shape for provider payloads. It is not a stable lookup key;
 * account lookup must use ExternalIdentityKey.
 */
export interface ExternalIdentityReference {
  readonly provider: ExternalIdentityProvider;
  readonly subject: string;
}

declare const externalIdentityNamespaceBrand: unique symbol;
declare const canonicalExternalIdentitySubjectBrand: unique symbol;
declare const externalIdentityLookupDigestBrand: unique symbol;

const MAX_EXTERNAL_IDENTITY_NAMESPACE_LENGTH = 128;
const MAX_EXTERNAL_IDENTITY_SUBJECT_LENGTH = 512;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type ExternalIdentityNamespace = string & {
  readonly [externalIdentityNamespaceBrand]: 'ExternalIdentityNamespace';
};

export type CanonicalExternalIdentitySubject = string & {
  readonly [canonicalExternalIdentitySubjectBrand]:
    'CanonicalExternalIdentitySubject';
};

export type ExternalIdentityLookupDigest = string & {
  readonly [externalIdentityLookupDigestBrand]: 'ExternalIdentityLookupDigest';
};

export type ExternalIdentityLookup =
  | {
      readonly kind: 'canonical_subject';
      readonly subject: CanonicalExternalIdentitySubject;
    }
  | {
      readonly kind: 'lookup_digest';
      readonly digest: ExternalIdentityLookupDigest;
    };

export interface ExternalIdentityKey {
  readonly provider: ExternalIdentityProvider;
  readonly namespace: ExternalIdentityNamespace;
  readonly lookup: ExternalIdentityLookup;
}

export function externalIdentityNamespace(
  value: string,
): ExternalIdentityNamespace {
  if (
    value.length === 0 ||
    value.length > MAX_EXTERNAL_IDENTITY_NAMESPACE_LENGTH ||
    value.trim() !== value ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new TypeError('External identity namespace is invalid');
  }

  return value as ExternalIdentityNamespace;
}

/**
 * Trust boundary for provider adapters only. This function does not
 * canonicalize a subject; the provider adapter must validate and canonicalize
 * the value before calling it.
 */
export function trustProviderCanonicalizedExternalIdentitySubject(
  value: string,
): CanonicalExternalIdentitySubject {
  if (
    value.length === 0 ||
    value.length > MAX_EXTERNAL_IDENTITY_SUBJECT_LENGTH ||
    value.trim() !== value ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new TypeError('Provider-canonicalized identity subject is invalid');
  }

  return value as CanonicalExternalIdentitySubject;
}

export function externalIdentityLookupDigest(
  value: string,
): ExternalIdentityLookupDigest {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError('External identity lookup digest is invalid');
  }

  return value as ExternalIdentityLookupDigest;
}
