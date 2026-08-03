import { AccountId } from '../accounts/account.types';
import {
  UnixEpochSeconds,
  VerifiedTelegramNotificationPermission,
} from '../auth/auth.types';
import { PostgresTransaction } from './postgres-transaction';

export interface SynchronizeTelegramNotificationDestinationInput {
  readonly accountId: AccountId;
  readonly permission: VerifiedTelegramNotificationPermission;
  readonly observedAt: UnixEpochSeconds;
}

export type SynchronizeTelegramNotificationDestinationResult = Readonly<{
  readonly outcome: 'synchronized';
  readonly accountId: AccountId;
  readonly state: 'enabled' | 'disabled' | 'absent';
  readonly changed: boolean;
}>;

export type TelegramNotificationDestinationPersistenceFailure =
  | 'invalid_input'
  | 'binding_conflict'
  | 'referential_integrity'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class TelegramNotificationDestinationPersistenceError extends Error {
  readonly name = 'TelegramNotificationDestinationPersistenceError';

  constructor(
    readonly reason: TelegramNotificationDestinationPersistenceFailure,
  ) {
    super('Telegram notification destination persistence failed');
  }
}

export interface TelegramNotificationDestinationRepository {
  synchronize(
    transaction: PostgresTransaction,
    input: SynchronizeTelegramNotificationDestinationInput,
  ): Promise<SynchronizeTelegramNotificationDestinationResult>;
}
