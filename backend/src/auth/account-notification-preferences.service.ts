import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from './auth.types';
import {
  AccountNotificationPreferenceRecord,
  AccountNotificationPreferencesPersistenceError,
  AccountNotificationPreferencesRepository,
} from '../database/account-notification-preferences.repository';
import { PostgresTransactionExecutorAdapter } from '../database/postgres-transaction-executor.adapter';
import { SessionAuthenticationClock } from './session-authentication.guard';
import {
  OwnAccountNotificationPreferences,
  OwnAccountNotificationPreferencesRejection,
  ReadOwnAccountNotificationPreferencesInput,
  ReadOwnAccountNotificationPreferencesResult,
  UpdateOwnAccountNotificationPreferencesInput,
  UpdateOwnAccountNotificationPreferencesResult,
  isNotificationPreferencesPrincipalInput,
  readPatchOwnAccountNotificationPreferences,
} from './account-notification-preferences.types';

export interface AccountNotificationPreferencesServiceDependencies {
  readonly transactions: PostgresTransactionExecutorAdapter;
  readonly preferences: AccountNotificationPreferencesRepository;
  readonly clock: SessionAuthenticationClock;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function rejected(
  reason: OwnAccountNotificationPreferencesRejection,
): Readonly<{
  readonly outcome: 'rejected';
  readonly reason: OwnAccountNotificationPreferencesRejection;
}> {
  return Object.freeze({ outcome: 'rejected', reason });
}

function temporaryStorageFailure(error: unknown): boolean {
  return (
    error instanceof AccountNotificationPreferencesPersistenceError &&
    (error.reason === 'database_unavailable' ||
      error.reason === 'transaction_conflict')
  );
}

function publicPreferences(
  record: AccountNotificationPreferenceRecord,
  expectedAccountId: ReadOwnAccountNotificationPreferencesInput['accountId'],
): OwnAccountNotificationPreferences | undefined {
  if (
    !isPlainRecord(record) ||
    Object.keys(record).length !== 5 ||
    !isAccountId(record.accountId) ||
    record.accountId !== expectedAccountId ||
    typeof record.telegramMatchNotificationsEnabled !== 'boolean' ||
    !isUnixEpochSeconds(record.createdAt) ||
    !isUnixEpochSeconds(record.updatedAt) ||
    record.updatedAt < record.createdAt ||
    typeof record.version !== 'number' ||
    !Number.isSafeInteger(record.version) ||
    record.version < 1
  ) {
    return undefined;
  }
  return Object.freeze({
    telegramMatchNotificationsEnabled: record.telegramMatchNotificationsEnabled,
    version: record.version,
  });
}

function validUpdateInput(
  value: unknown,
): value is UpdateOwnAccountNotificationPreferencesInput {
  return (
    isPlainRecord(value) &&
    Object.keys(value).length === 3 &&
    isNotificationPreferencesPrincipalInput({
      accountId: value.accountId,
      role: value.role,
    }) &&
    readPatchOwnAccountNotificationPreferences(value.patch) !== undefined
  );
}

export class AccountNotificationPreferencesService {
  constructor(
    readonly dependencies: AccountNotificationPreferencesServiceDependencies,
  ) {}

  async readOwnPreferences(
    input: ReadOwnAccountNotificationPreferencesInput,
  ): Promise<ReadOwnAccountNotificationPreferencesResult> {
    if (!isNotificationPreferencesPrincipalInput(input)) {
      return rejected('invalid_request');
    }
    try {
      const result = await this.dependencies.transactions.run((transaction) =>
        this.dependencies.preferences.findByAccountId(transaction, {
          accountId: input.accountId,
        }),
      );
      if (
        isPlainRecord(result) &&
        Object.keys(result).length === 1 &&
        result.outcome === 'missing'
      ) {
        return Object.freeze({
          outcome: 'found',
          preferences: Object.freeze({
            telegramMatchNotificationsEnabled: true,
            version: null,
          }),
        });
      }
      if (
        !isPlainRecord(result) ||
        Object.keys(result).length !== 2 ||
        result.outcome !== 'found'
      ) {
        return rejected('internal_failure');
      }
      const preferences = publicPreferences(
        result.preference as AccountNotificationPreferenceRecord,
        input.accountId,
      );
      return preferences === undefined
        ? rejected('internal_failure')
        : Object.freeze({ outcome: 'found', preferences });
    } catch (error) {
      return rejected(
        temporaryStorageFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }
  }

  async updateOwnPreferences(
    input: UpdateOwnAccountNotificationPreferencesInput,
  ): Promise<UpdateOwnAccountNotificationPreferencesResult> {
    if (!validUpdateInput(input)) {
      return rejected('invalid_request');
    }
    const patch = readPatchOwnAccountNotificationPreferences(input.patch);
    if (patch === undefined) {
      return rejected('invalid_request');
    }
    try {
      const result = await this.dependencies.transactions.run((transaction) =>
        this.dependencies.preferences.save(transaction, {
          accountId: input.accountId,
          telegramMatchNotificationsEnabled:
            patch.telegramMatchNotificationsEnabled,
          expectedVersion: patch.expectedVersion,
          updatedAt: this.dependencies.clock.nowEpochSeconds(),
        }),
      );
      if (
        isPlainRecord(result) &&
        Object.keys(result).length === 1 &&
        result.outcome === 'conflict'
      ) {
        return rejected('version_conflict');
      }
      if (
        !isPlainRecord(result) ||
        Object.keys(result).length !== 2 ||
        result.outcome !== 'saved'
      ) {
        return rejected('internal_failure');
      }
      const preferences = publicPreferences(
        result.preference as AccountNotificationPreferenceRecord,
        input.accountId,
      );
      return preferences === undefined
        ? rejected('internal_failure')
        : Object.freeze({ outcome: 'updated', preferences });
    } catch (error) {
      return rejected(
        temporaryStorageFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }
  }
}
