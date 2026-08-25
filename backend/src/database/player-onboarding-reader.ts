import { AccountId } from '../accounts/account.types';
import type { PlayerOnboardingInitialLevelLabel } from '../auth/player-onboarding-initial-level';
import { PostgresTransaction } from './postgres-transaction';

export type PlayerOnboardingStep =
  'profile' | 'contacts' | 'consents' | 'level_survey' | 'completed';

export type PlayerOnboardingConsentKind =
  'terms' | 'privacy' | 'cancellation' | 'personal_data_processing';

export interface PlayerOnboardingStateRecord {
  readonly flowVersion: string;
  readonly status: 'in_progress' | 'completed';
  readonly currentStep: PlayerOnboardingStep;
  readonly surveyVersion: string;
  readonly surveyAnswers: Readonly<Record<string, string>>;
  readonly initialLevelLabel: PlayerOnboardingInitialLevelLabel | null;
  readonly revision: number;
}

export interface PlayerOnboardingConsentRecord {
  readonly kind: PlayerOnboardingConsentKind;
  readonly documentVersion: string;
}

export interface PlayerOnboardingRecord {
  readonly accountId: AccountId;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly phone: string | null;
  readonly normalizedEmail: string | null;
  readonly state: PlayerOnboardingStateRecord | null;
  readonly consents: readonly PlayerOnboardingConsentRecord[];
}

export interface ReadPlayerOnboardingInput {
  readonly accountId: AccountId;
}

export type ReadPlayerOnboardingResult =
  | {
      readonly outcome: 'found';
      readonly onboarding: PlayerOnboardingRecord;
    }
  | {
      readonly outcome: 'not_found';
    };

export type PlayerOnboardingReadPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PlayerOnboardingReadPersistenceError extends Error {
  readonly name = 'PlayerOnboardingReadPersistenceError';

  constructor(readonly reason: PlayerOnboardingReadPersistenceFailure) {
    super('Player onboarding read persistence failed');
  }
}

export interface PlayerOnboardingReader {
  findByAccountId(
    transaction: PostgresTransaction,
    input: ReadPlayerOnboardingInput,
  ): Promise<ReadPlayerOnboardingResult>;
}
