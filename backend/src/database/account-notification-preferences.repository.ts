import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { PostgresTransaction } from './postgres-transaction';

export interface AccountNotificationPreferenceRecord {
  readonly accountId: AccountId;
  readonly telegramMatchNotificationsEnabled: boolean;
  readonly createdAt: UnixEpochSeconds;
  readonly updatedAt: UnixEpochSeconds;
  readonly version: number;
}

export interface ReadAccountNotificationPreferenceInput {
  readonly accountId: AccountId;
}

export type ReadAccountNotificationPreferenceResult =
  | Readonly<{ readonly outcome: 'missing' }>
  | Readonly<{
      readonly outcome: 'found';
      readonly preference: AccountNotificationPreferenceRecord;
    }>;

export interface SaveAccountNotificationPreferenceInput {
  readonly accountId: AccountId;
  readonly telegramMatchNotificationsEnabled: boolean;
  readonly expectedVersion: number | null;
  readonly updatedAt: UnixEpochSeconds;
}

export type SaveAccountNotificationPreferenceResult =
  | Readonly<{
      readonly outcome: 'saved';
      readonly preference: AccountNotificationPreferenceRecord;
    }>
  | Readonly<{ readonly outcome: 'conflict' }>;

export type AccountNotificationPreferencesPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class AccountNotificationPreferencesPersistenceError extends Error {
  readonly name = 'AccountNotificationPreferencesPersistenceError';

  constructor(
    readonly reason: AccountNotificationPreferencesPersistenceFailure,
  ) {
    super('Account notification preferences persistence failed');
  }
}

export interface AccountNotificationPreferencesRepository {
  findByAccountId(
    transaction: PostgresTransaction,
    input: ReadAccountNotificationPreferenceInput,
  ): Promise<ReadAccountNotificationPreferenceResult>;

  save(
    transaction: PostgresTransaction,
    input: SaveAccountNotificationPreferenceInput,
  ): Promise<SaveAccountNotificationPreferenceResult>;
}
