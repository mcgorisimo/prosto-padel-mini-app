import {
  InternalUuid,
  isInternalUuid,
  newInternalUuid,
} from '../common/internal-uuid';

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

export type AccountId = InternalUuid & {
  readonly [accountIdBrand]: 'AccountId';
};

export function isAccountId(value: unknown): value is AccountId {
  return isInternalUuid(value);
}

export function accountId(value: string): AccountId {
  if (!isAccountId(value)) {
    throw new TypeError('Account ID is invalid');
  }

  return value;
}

export function newAccountId(): AccountId {
  return newInternalUuid() as AccountId;
}
