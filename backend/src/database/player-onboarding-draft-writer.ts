import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { PostgresTransaction } from './postgres-transaction';

export interface SavePlayerOnboardingDraftInput {
  readonly accountId: AccountId;
  readonly expectedRevision: number | null;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly phone: string | null;
  readonly normalizedEmail: string | null;
  readonly flowVersion: string;
  readonly surveyVersion: string;
  readonly updatedAt: UnixEpochSeconds;
}

export type SavePlayerOnboardingDraftResult =
  | { readonly outcome: 'saved'; readonly revision: number }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'stale_revision' }
  | { readonly outcome: 'closed' };

export type PlayerOnboardingDraftWritePersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PlayerOnboardingDraftWritePersistenceError extends Error {
  readonly name = 'PlayerOnboardingDraftWritePersistenceError';

  constructor(readonly reason: PlayerOnboardingDraftWritePersistenceFailure) {
    super('Player onboarding draft write persistence failed');
  }
}

export interface PlayerOnboardingDraftWriter {
  saveDraft(
    transaction: PostgresTransaction,
    input: SavePlayerOnboardingDraftInput,
  ): Promise<SavePlayerOnboardingDraftResult>;
}
