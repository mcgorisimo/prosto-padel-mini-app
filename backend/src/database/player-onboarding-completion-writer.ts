import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { PlayerOnboardingInitialLevelLabel } from '../auth/player-onboarding-initial-level';
import { PlayerOnboardingConsentRecord } from './player-onboarding-reader';
import { PostgresTransaction } from './postgres-transaction';

export interface CompletePlayerOnboardingInput {
  readonly accountId: AccountId;
  readonly expectedRevision: number;
  readonly flowVersion: string;
  readonly consents: readonly PlayerOnboardingConsentRecord[];
  readonly surveyVersion: string;
  readonly surveyAnswers: Readonly<Record<string, string>>;
  readonly completedAt: UnixEpochSeconds;
}

export type CompletePlayerOnboardingResult =
  | {
      readonly outcome: 'completed';
      readonly revision: number;
      readonly replayed: boolean;
      readonly initialLevelScore: number;
      readonly initialLevelLabel: PlayerOnboardingInitialLevelLabel;
    }
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'stale_revision' }
  | { readonly outcome: 'incomplete' }
  | { readonly outcome: 'conflict' };

export type PlayerOnboardingCompletionPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PlayerOnboardingCompletionPersistenceError extends Error {
  readonly name = 'PlayerOnboardingCompletionPersistenceError';

  constructor(readonly reason: PlayerOnboardingCompletionPersistenceFailure) {
    super('Player onboarding completion persistence failed');
  }
}

export interface PlayerOnboardingCompletionWriter {
  complete(
    transaction: PostgresTransaction,
    input: CompletePlayerOnboardingInput,
  ): Promise<CompletePlayerOnboardingResult>;
}
