export const EXTERNAL_IDENTITY_PROVIDERS = Object.freeze([
  'telegram',
  'apple',
  'google',
  'phone',
] as const);

export type ExternalIdentityProvider =
  (typeof EXTERNAL_IDENTITY_PROVIDERS)[number];

export interface ExternalIdentityReference {
  readonly provider: ExternalIdentityProvider;
  readonly subject: string;
}
