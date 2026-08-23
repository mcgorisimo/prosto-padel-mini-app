import {
  AccountId,
  isAccountId,
  UserRole,
  USER_ROLES,
} from '../accounts/account.types';

export interface OwnAccountNotificationPreferences {
  readonly telegramMatchNotificationsEnabled: boolean;
  readonly version: number | null;
}

export interface ReadOwnAccountNotificationPreferencesInput {
  readonly accountId: AccountId;
  readonly role: UserRole;
}

export interface PatchOwnAccountNotificationPreferences {
  readonly telegramMatchNotificationsEnabled: boolean;
  readonly expectedVersion: number | null;
}

export interface UpdateOwnAccountNotificationPreferencesInput extends ReadOwnAccountNotificationPreferencesInput {
  readonly patch: PatchOwnAccountNotificationPreferences;
}

export type OwnAccountNotificationPreferencesRejection =
  | 'invalid_request'
  | 'version_conflict'
  | 'temporary_unavailable'
  | 'internal_failure';

export type ReadOwnAccountNotificationPreferencesResult =
  | Readonly<{
      readonly outcome: 'found';
      readonly preferences: OwnAccountNotificationPreferences;
    }>
  | Readonly<{
      readonly outcome: 'rejected';
      readonly reason: OwnAccountNotificationPreferencesRejection;
    }>;

export type UpdateOwnAccountNotificationPreferencesResult =
  | Readonly<{
      readonly outcome: 'updated';
      readonly preferences: OwnAccountNotificationPreferences;
    }>
  | Readonly<{
      readonly outcome: 'rejected';
      readonly reason: OwnAccountNotificationPreferencesRejection;
    }>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

export function isOwnAccountNotificationPreferences(
  value: unknown,
): value is OwnAccountNotificationPreferences {
  return (
    isPlainRecord(value) &&
    hasExactlyKeys(value, ['telegramMatchNotificationsEnabled', 'version']) &&
    typeof value.telegramMatchNotificationsEnabled === 'boolean' &&
    (value.version === null ||
      (typeof value.version === 'number' &&
        Number.isSafeInteger(value.version) &&
        value.version >= 1))
  );
}

export function readPatchOwnAccountNotificationPreferences(
  value: unknown,
): PatchOwnAccountNotificationPreferences | undefined {
  if (
    !isPlainRecord(value) ||
    !hasExactlyKeys(value, [
      'telegramMatchNotificationsEnabled',
      'expectedVersion',
    ]) ||
    typeof value.telegramMatchNotificationsEnabled !== 'boolean' ||
    !(
      value.expectedVersion === null ||
      (typeof value.expectedVersion === 'number' &&
        Number.isSafeInteger(value.expectedVersion) &&
        value.expectedVersion >= 1)
    )
  ) {
    return undefined;
  }
  return Object.freeze({
    telegramMatchNotificationsEnabled: value.telegramMatchNotificationsEnabled,
    expectedVersion: value.expectedVersion,
  });
}

export function isNotificationPreferencesPrincipalInput(
  value: unknown,
): value is ReadOwnAccountNotificationPreferencesInput {
  return (
    isPlainRecord(value) &&
    hasExactlyKeys(value, ['accountId', 'role']) &&
    isAccountId(value.accountId) &&
    USER_ROLES.includes(value.role as UserRole)
  );
}
