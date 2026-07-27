import { AccountId } from '../accounts/account.types';
import {
  UnixEpochSeconds,
  VerifiedTelegramProfileDetails,
} from '../auth/auth.types';
import { PostgresTransaction } from './postgres-transaction';

export interface CreatePlayerProfileDetailsInput {
  readonly accountId: AccountId;
  readonly profile: VerifiedTelegramProfileDetails;
  readonly observedAt: UnixEpochSeconds;
}

export type CreatePlayerProfileDetailsResult = Readonly<{
  readonly outcome: 'created' | 'existing';
  readonly accountId: AccountId;
}>;

export type PlayerProfileDetailsPersistenceFailure =
  | 'invalid_input'
  | 'referential_integrity'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PlayerProfileDetailsPersistenceError extends Error {
  readonly name = 'PlayerProfileDetailsPersistenceError';

  constructor(readonly reason: PlayerProfileDetailsPersistenceFailure) {
    super('Player profile details persistence failed');
  }
}

export interface PlayerProfileDetailsRepository {
  createIfAbsent(
    transaction: PostgresTransaction,
    input: CreatePlayerProfileDetailsInput,
  ): Promise<CreatePlayerProfileDetailsResult>;
}
