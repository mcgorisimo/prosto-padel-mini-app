import { AccountId } from '../accounts/account.types';
import { PostgresTransaction } from './postgres-transaction';

export interface SearchPublicPlayerProfilesInput {
  readonly query: string;
  readonly limit: number;
}

export interface PublicPlayerProfileRecord {
  readonly playerId: AccountId;
  readonly firstName: string;
  readonly lastName?: string;
  readonly username?: string;
  readonly rating: number;
  readonly isVerified: boolean;
}

export interface SearchPublicPlayerProfilesResult {
  readonly outcome: 'found';
  readonly players: readonly PublicPlayerProfileRecord[];
}

export type PublicPlayerProfileSearchPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PublicPlayerProfileSearchPersistenceError extends Error {
  readonly name = 'PublicPlayerProfileSearchPersistenceError';

  constructor(
    readonly reason: PublicPlayerProfileSearchPersistenceFailure,
  ) {
    super('Public player profile search persistence failed');
  }
}

export interface PublicPlayerProfileSearchRepository {
  search(
    transaction: PostgresTransaction,
    input: SearchPublicPlayerProfilesInput,
  ): Promise<SearchPublicPlayerProfilesResult>;
}
