import { AccountId } from '../accounts/account.types';
import { UnixEpochSeconds } from '../auth/auth.types';
import { PlayerOnboardingInitialLevelLabel } from '../auth/player-onboarding-initial-level';
import { PostgresTransaction } from './postgres-transaction';

export interface PlayerInitialLevelReassessmentSource {
  readonly flowVersion: string;
  readonly surveyVersion: 'initial_level_v1';
  readonly revision: number;
}

export type PlayerInitialLevelReassessmentState =
  | Readonly<{ readonly status: 'not_eligible' }>
  | Readonly<{
      readonly status: 'required';
      readonly source: PlayerInitialLevelReassessmentSource;
      readonly surveyVersion: 'initial_level_v2';
    }>
  | Readonly<{
      readonly status: 'completed';
      readonly source: PlayerInitialLevelReassessmentSource;
      readonly surveyVersion: 'initial_level_v2';
      readonly surveyAnswers: Readonly<Record<string, string>>;
      readonly initialLevelScore: number;
      readonly initialLevelLabel: PlayerOnboardingInitialLevelLabel;
    }>;

export interface ReadPlayerInitialLevelReassessmentInput {
  readonly accountId: AccountId;
}

export interface CompletePlayerInitialLevelReassessmentInput {
  readonly accountId: AccountId;
  readonly source: PlayerInitialLevelReassessmentSource;
  readonly surveyVersion: 'initial_level_v2';
  readonly surveyAnswers: Readonly<Record<string, string>>;
  readonly completedAt: UnixEpochSeconds;
}

export type CompletePlayerInitialLevelReassessmentResult =
  | Readonly<{
      readonly outcome: 'completed';
      readonly replayed: boolean;
      readonly initialLevelScore: number;
      readonly initialLevelLabel: PlayerOnboardingInitialLevelLabel;
    }>
  | Readonly<{ readonly outcome: 'not_eligible' }>
  | Readonly<{ readonly outcome: 'stale_source' }>
  | Readonly<{ readonly outcome: 'conflict' }>;

export type PlayerInitialLevelReassessmentPersistenceFailure =
  | 'invalid_input'
  | 'invalid_persisted_state'
  | 'permission_denied'
  | 'transaction_conflict'
  | 'database_unavailable'
  | 'storage_failure';

export class PlayerInitialLevelReassessmentPersistenceError extends Error {
  readonly name = 'PlayerInitialLevelReassessmentPersistenceError';

  constructor(
    readonly reason: PlayerInitialLevelReassessmentPersistenceFailure,
  ) {
    super('Player initial level reassessment persistence failed');
  }
}

export interface PlayerInitialLevelReassessmentRepository {
  read(
    transaction: PostgresTransaction,
    input: ReadPlayerInitialLevelReassessmentInput,
  ): Promise<PlayerInitialLevelReassessmentState>;

  complete(
    transaction: PostgresTransaction,
    input: CompletePlayerInitialLevelReassessmentInput,
  ): Promise<CompletePlayerInitialLevelReassessmentResult>;
}
