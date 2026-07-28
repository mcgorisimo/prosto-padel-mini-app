import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { PostgresTransaction } from './postgres-transaction';

export type PlayerSidePreference = 'Left' | 'Both' | 'Right';

export interface PlayerProfileChanges {
  readonly firstName?: string;
  readonly lastName?: string | null;
  readonly phone?: string | null;
  readonly sidePreference?: PlayerSidePreference;
}

export interface UpdatePlayerProfileInput {
  readonly accountId: AccountId;
  readonly changes: PlayerProfileChanges;
  readonly updatedAt: UnixEpochSeconds;
}

export type UpdatePlayerProfileResult =
  | { readonly outcome: 'updated' }
  | { readonly outcome: 'not_found' };

export type PlayerProfileWritePersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PlayerProfileWritePersistenceError extends Error {
  readonly name = 'PlayerProfileWritePersistenceError';

  constructor(readonly reason: PlayerProfileWritePersistenceFailure) {
    super('Player profile write persistence failed');
  }
}

export interface PlayerProfileWriter {
  updateByAccountId(
    transaction: PostgresTransaction,
    input: UpdatePlayerProfileInput,
  ): Promise<UpdatePlayerProfileResult>;
}
