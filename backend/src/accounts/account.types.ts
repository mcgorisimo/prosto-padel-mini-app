export const USER_ROLES = Object.freeze(['player', 'club_admin'] as const);

export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = Object.freeze([
  'active',
  'blocked',
  'pending_deletion',
  'anonymized',
] as const);

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

declare const accountIdBrand: unique symbol;

export type AccountId = string & {
  readonly [accountIdBrand]: 'AccountId';
};
