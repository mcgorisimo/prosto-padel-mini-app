import { AccountId } from '../accounts/account.types';
import { PostgresTransaction } from './postgres-transaction';

export interface ReadPlayerProfileInput {
  readonly accountId: AccountId;
}

export interface PlayerProfileRecord {
  readonly accountId: AccountId;
  readonly firstName: string;
  readonly lastName?: string;
  readonly username?: string;
  readonly photoUrl?: string;
  readonly languageCode?: string;
  readonly phone?: string;
  readonly sidePreference?: 'Left' | 'Both' | 'Right';
  readonly rating: number;
  readonly isVerified: boolean;
  readonly capabilities: readonly 'club_admin'[];
}

export type ReadPlayerProfileResult =
  | {
      readonly outcome: 'found';
      readonly profile: PlayerProfileRecord;
    }
  | {
      readonly outcome: 'not_found';
    };

export type PlayerProfileReadPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PlayerProfileReadPersistenceError extends Error {
  readonly name = 'PlayerProfileReadPersistenceError';

  constructor(readonly reason: PlayerProfileReadPersistenceFailure) {
    super('Player profile read persistence failed');
  }
}

export interface PlayerProfileReader {
  findByAccountId(
    transaction: PostgresTransaction,
    input: ReadPlayerProfileInput,
  ): Promise<ReadPlayerProfileResult>;
}
