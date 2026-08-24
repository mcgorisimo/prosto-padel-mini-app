import {
  CompletePlayerInitialLevelReassessmentResult,
  PlayerInitialLevelReassessmentPersistenceError,
  PlayerInitialLevelReassessmentRepository,
} from '../database/player-initial-level-reassessment-repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { SessionAuthenticationClock } from './session-authentication.guard';
import {
  CompleteOwnPlayerInitialLevelReassessmentInput,
  CompleteOwnPlayerInitialLevelReassessmentResult,
  OwnPlayerInitialLevelReassessment,
  ReadOwnPlayerInitialLevelReassessmentInput,
  ReadOwnPlayerInitialLevelReassessmentResult,
  isCompleteOwnPlayerInitialLevelReassessmentInput,
  isOwnPlayerInitialLevelReassessment,
  isReadOwnPlayerInitialLevelReassessmentInput,
} from './player-initial-level-reassessment.types';
import { scorePlayerOnboardingInitialLevel } from './player-onboarding-initial-level';

export interface PlayerInitialLevelReassessmentTransactionExecutor {
  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PlayerInitialLevelReassessmentServiceDependencies {
  readonly transactions: PlayerInitialLevelReassessmentTransactionExecutor;
  readonly reassessments: PlayerInitialLevelReassessmentRepository;
  readonly clock: SessionAuthenticationClock;
}

type RejectionReason = Extract<
  | ReadOwnPlayerInitialLevelReassessmentResult
  | CompleteOwnPlayerInitialLevelReassessmentResult,
  { readonly outcome: 'rejected' }
>['reason'];

function rejected<Reason extends RejectionReason>(
  reason: Reason,
): Readonly<{ readonly outcome: 'rejected'; readonly reason: Reason }> {
  return Object.freeze({ outcome: 'rejected', reason });
}

function temporaryStorageFailure(error: unknown): boolean {
  return (
    error instanceof PlayerInitialLevelReassessmentPersistenceError &&
    (error.reason === 'database_unavailable' ||
      error.reason === 'transaction_conflict')
  );
}

function publicState(
  value: unknown,
): OwnPlayerInitialLevelReassessment | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const state = value as Record<string, unknown>;
  let candidate: unknown;
  if (state.status === 'not_eligible') {
    candidate = { status: 'not_eligible' };
  } else if (state.status === 'required') {
    candidate = {
      status: 'required',
      source: state.source,
      surveyVersion: state.surveyVersion,
    };
  } else if (state.status === 'completed') {
    candidate = {
      status: 'completed',
      surveyVersion: state.surveyVersion,
      initialLevelLabel: state.initialLevelLabel,
    };
  } else {
    return undefined;
  }
  return isOwnPlayerInitialLevelReassessment(candidate)
    ? Object.freeze(candidate as OwnPlayerInitialLevelReassessment)
    : undefined;
}

export class PlayerInitialLevelReassessmentService {
  constructor(
    readonly dependencies: PlayerInitialLevelReassessmentServiceDependencies,
  ) {}

  async readOwnReassessment(
    input: ReadOwnPlayerInitialLevelReassessmentInput,
  ): Promise<ReadOwnPlayerInitialLevelReassessmentResult> {
    if (!isReadOwnPlayerInitialLevelReassessmentInput(input)) {
      return rejected('invalid_request');
    }
    if (input.role !== 'player') {
      return Object.freeze({
        outcome: 'found',
        reassessment: Object.freeze({ status: 'not_eligible' }),
      });
    }
    try {
      const state = await this.dependencies.transactions.run((transaction) =>
        this.dependencies.reassessments.read(transaction, {
          accountId: input.accountId,
        }),
      );
      const reassessment = publicState(state);
      return reassessment === undefined
        ? rejected('internal_failure')
        : Object.freeze({ outcome: 'found', reassessment });
    } catch (error) {
      return rejected(
        temporaryStorageFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }
  }

  async completeOwnReassessment(
    input: CompleteOwnPlayerInitialLevelReassessmentInput,
  ): Promise<CompleteOwnPlayerInitialLevelReassessmentResult> {
    if (!isCompleteOwnPlayerInitialLevelReassessmentInput(input)) {
      return rejected('invalid_request');
    }
    if (input.role !== 'player') {
      return rejected('reassessment_not_eligible');
    }
    const calculated = scorePlayerOnboardingInitialLevel(
      input.completion.survey.answers,
    );
    if (calculated === undefined) {
      return rejected('invalid_request');
    }
    try {
      const result =
        await this.dependencies.transactions.run<CompletePlayerInitialLevelReassessmentResult>(
          (transaction) =>
            this.dependencies.reassessments.complete(transaction, {
              accountId: input.accountId,
              source: input.completion.source,
              surveyVersion: input.completion.survey.version,
              surveyAnswers: input.completion.survey.answers,
              completedAt: this.dependencies.clock.nowEpochSeconds(),
            }),
        );
      switch (result.outcome) {
        case 'not_eligible':
          return rejected('reassessment_not_eligible');
        case 'stale_source':
          return rejected('reassessment_source_conflict');
        case 'conflict':
          return rejected('reassessment_conflict');
        case 'completed': {
          if (
            result.initialLevelScore !== calculated.score ||
            result.initialLevelLabel !== calculated.label
          ) {
            return rejected('internal_failure');
          }
          return Object.freeze({
            outcome: 'completed',
            reassessment: Object.freeze({
              status: 'completed',
              surveyVersion: input.completion.survey.version,
              initialLevelLabel: result.initialLevelLabel,
            }),
          });
        }
      }
    } catch (error) {
      return rejected(
        temporaryStorageFailure(error)
          ? 'temporary_unavailable'
          : 'internal_failure',
      );
    }
  }
}
