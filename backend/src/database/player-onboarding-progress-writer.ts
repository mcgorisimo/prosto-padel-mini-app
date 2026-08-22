import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { PlayerOnboardingConsentRecord } from './player-onboarding-reader';
import { PostgresTransaction } from './postgres-transaction';

export type PlayerOnboardingProgressStep = 'consents' | 'level_survey';

export interface AdvancePlayerOnboardingInput {
  readonly accountId: AccountId;
  readonly expectedRevision: number;
  readonly flowVersion: string;
  readonly nextStep: PlayerOnboardingProgressStep;
  readonly consents: readonly PlayerOnboardingConsentRecord[];
  readonly advancedAt: UnixEpochSeconds;
}

export type AdvancePlayerOnboardingResult =
  | {
      readonly outcome: 'advanced';
      readonly revision: number;
      readonly replayed: boolean;
    }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'stale_revision' }
  | { readonly outcome: 'incomplete' }
  | { readonly outcome: 'conflict' }
  | { readonly outcome: 'closed' };

export type PlayerOnboardingProgressPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PlayerOnboardingProgressPersistenceError extends Error {
  readonly name = 'PlayerOnboardingProgressPersistenceError';

  constructor(readonly reason: PlayerOnboardingProgressPersistenceFailure) {
    super('Player onboarding progress persistence failed');
  }
}

export interface PlayerOnboardingProgressWriter {
  advance(
    transaction: PostgresTransaction,
    input: AdvancePlayerOnboardingInput,
  ): Promise<AdvancePlayerOnboardingResult>;
}
