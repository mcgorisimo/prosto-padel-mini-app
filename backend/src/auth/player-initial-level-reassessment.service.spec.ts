import { inspect } from 'node:util';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  CompletePlayerInitialLevelReassessmentInput,
  CompletePlayerInitialLevelReassessmentResult,
  PlayerInitialLevelReassessmentPersistenceError,
  PlayerInitialLevelReassessmentRepository,
  PlayerInitialLevelReassessmentState,
  ReadPlayerInitialLevelReassessmentInput,
} from '../database/player-initial-level-reassessment-repository';
import { PostgresTransaction } from '../database/postgres-transaction';
import { unixEpochSeconds } from './auth.types';
import {
  PlayerInitialLevelReassessmentService,
  PlayerInitialLevelReassessmentTransactionExecutor,
} from './player-initial-level-reassessment.service';
import { CompleteOwnPlayerInitialLevelReassessmentInput } from './player-initial-level-reassessment.types';

const ACCOUNT_ID = deterministicUuid(
  'player-initial-level-reassessment-service',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-initial-level-reassessment-service-other',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_REASSESSMENT_SERVICE_PRIVATE';
const ANSWERS = Object.freeze({
  match_count: 'thirty_one_to_ninety_nine',
  rally_stability: 'steady_under_pressure',
  glass_play: 'confident_returns',
  serve_return_net: 'confident_patterns',
  match_experience_year: 'league_or_club',
});

function requiredState(): PlayerInitialLevelReassessmentState {
  return {
    status: 'required',
    source: {
      flowVersion: 'tma_v1',
      surveyVersion: 'initial_level_v1',
      revision: 4,
    },
    surveyVersion: 'initial_level_v2',
  };
}

function completedPersistenceState(): PlayerInitialLevelReassessmentState {
  return {
    status: 'completed',
    source: {
      flowVersion: 'tma_v1',
      surveyVersion: 'initial_level_v1',
      revision: 4,
    },
    surveyVersion: 'initial_level_v2',
    surveyAnswers: ANSWERS,
    initialLevelScore: 15,
    initialLevelLabel: 'B+',
  };
}

function completion(
  overrides: Partial<
    CompleteOwnPlayerInitialLevelReassessmentInput['completion']
  > = {},
): CompleteOwnPlayerInitialLevelReassessmentInput['completion'] {
  return {
    source: {
      flowVersion: 'tma_v1',
      surveyVersion: 'initial_level_v1',
      revision: 4,
    },
    survey: {
      version: 'initial_level_v2',
      answers: ANSWERS,
    },
    ...overrides,
  };
}

function createHarness(
  state: PlayerInitialLevelReassessmentState = requiredState(),
  completionResult: CompletePlayerInitialLevelReassessmentResult = {
    outcome: 'completed',
    replayed: false,
    initialLevelScore: 15,
    initialLevelLabel: 'B+',
  },
) {
  const transaction = {} as PostgresTransaction;
  const run = jest.fn(
    async (operation: (value: PostgresTransaction) => Promise<unknown>) =>
      operation(transaction),
  );
  const transactions: PlayerInitialLevelReassessmentTransactionExecutor = {
    run: <T>(
      operation: (value: PostgresTransaction) => Promise<T>,
    ): Promise<T> => run(operation) as Promise<T>,
  };
  const read = jest
    .fn<
      Promise<PlayerInitialLevelReassessmentState>,
      [PostgresTransaction, ReadPlayerInitialLevelReassessmentInput]
    >()
    .mockResolvedValue(state);
  const complete = jest
    .fn<
      Promise<CompletePlayerInitialLevelReassessmentResult>,
      [PostgresTransaction, CompletePlayerInitialLevelReassessmentInput]
    >()
    .mockResolvedValue(completionResult);
  const service = new PlayerInitialLevelReassessmentService({
    transactions,
    reassessments: {
      read,
      complete,
    } as PlayerInitialLevelReassessmentRepository,
    clock: { nowEpochSeconds: () => NOW },
  });
  return { service, transaction, run, read, complete };
}

describe('PlayerInitialLevelReassessmentService', () => {
  it('reads a required owner-scoped v1 source without private profile fields', async () => {
    const harness = createHarness();

    await expect(
      harness.service.readOwnReassessment({
        accountId: ACCOUNT_ID,
        role: 'player',
      }),
    ).resolves.toEqual({ outcome: 'found', reassessment: requiredState() });
    expect(harness.read).toHaveBeenCalledWith(harness.transaction, {
      accountId: ACCOUNT_ID,
    });
  });

  it('returns completed label only and does not expose score, answers, or source', async () => {
    const harness = createHarness(completedPersistenceState());
    const result = await harness.service.readOwnReassessment({
      accountId: ACCOUNT_ID,
      role: 'player',
    });

    expect(result).toEqual({
      outcome: 'found',
      reassessment: {
        status: 'completed',
        surveyVersion: 'initial_level_v2',
        initialLevelLabel: 'B+',
      },
    });
    expect(JSON.stringify(result)).not.toContain('initialLevelScore');
    expect(JSON.stringify(result)).not.toContain('surveyAnswers');
    expect(JSON.stringify(result)).not.toContain('source');
  });

  it.each([
    { status: 'not_eligible' as const },
    requiredState(),
    completedPersistenceState(),
  ])('accepts all repository GET states: $status', async (state) => {
    const harness = createHarness(state);
    await expect(
      harness.service.readOwnReassessment({
        accountId: ACCOUNT_ID,
        role: 'player',
      }),
    ).resolves.toMatchObject({ outcome: 'found' });
  });

  it('does not let a club_admin probe player eligibility', async () => {
    const harness = createHarness();
    await expect(
      harness.service.readOwnReassessment({
        accountId: OTHER_ACCOUNT_ID,
        role: 'club_admin',
      }),
    ).resolves.toEqual({
      outcome: 'found',
      reassessment: { status: 'not_eligible' },
    });
    expect(harness.run).not.toHaveBeenCalled();
  });

  it('completes with five option IDs and returns the server label only', async () => {
    const harness = createHarness();
    const result = await harness.service.completeOwnReassessment({
      accountId: ACCOUNT_ID,
      role: 'player',
      completion: completion(),
    });

    expect(result).toEqual({
      outcome: 'completed',
      reassessment: {
        status: 'completed',
        surveyVersion: 'initial_level_v2',
        initialLevelLabel: 'B+',
      },
    });
    expect(harness.complete).toHaveBeenCalledWith(harness.transaction, {
      accountId: ACCOUNT_ID,
      source: completion().source,
      surveyVersion: 'initial_level_v2',
      surveyAnswers: ANSWERS,
      completedAt: NOW,
    });
    expect(JSON.stringify(result)).not.toContain('15');
    expect(JSON.stringify(result)).not.toContain('score');
  });

  it('returns the same safe representation for an exact idempotent replay', async () => {
    const harness = createHarness(requiredState(), {
      outcome: 'completed',
      replayed: true,
      initialLevelScore: 15,
      initialLevelLabel: 'B+',
    });
    await expect(
      harness.service.completeOwnReassessment({
        accountId: ACCOUNT_ID,
        role: 'player',
        completion: completion(),
      }),
    ).resolves.toEqual({
      outcome: 'completed',
      reassessment: {
        status: 'completed',
        surveyVersion: 'initial_level_v2',
        initialLevelLabel: 'B+',
      },
    });
  });

  it.each([
    ['not_eligible', 'reassessment_not_eligible'],
    ['stale_source', 'reassessment_source_conflict'],
    ['conflict', 'reassessment_conflict'],
  ] as const)(
    'maps persistence %s without exposing storage details',
    async (outcome, reason) => {
      const harness = createHarness(requiredState(), { outcome });
      await expect(
        harness.service.completeOwnReassessment({
          accountId: ACCOUNT_ID,
          role: 'player',
          completion: completion(),
        }),
      ).resolves.toEqual({ outcome: 'rejected', reason });
    },
  );

  it('rejects incomplete answers before opening a transaction', async () => {
    const harness = createHarness();
    await expect(
      harness.service.completeOwnReassessment({
        accountId: ACCOUNT_ID,
        role: 'player',
        completion: completion({
          survey: {
            version: 'initial_level_v2',
            answers: { match_count: 'none' },
          },
        }),
      }),
    ).resolves.toEqual({ outcome: 'rejected', reason: 'invalid_request' });
    expect(harness.run).not.toHaveBeenCalled();
  });

  it('fails closed when persistence returns a score that differs from deterministic scoring', async () => {
    const harness = createHarness(requiredState(), {
      outcome: 'completed',
      replayed: false,
      initialLevelScore: 14,
      initialLevelLabel: 'B',
    });
    await expect(
      harness.service.completeOwnReassessment({
        accountId: ACCOUNT_ID,
        role: 'player',
        completion: completion(),
      }),
    ).resolves.toEqual({ outcome: 'rejected', reason: 'internal_failure' });
  });

  it('maps temporary persistence failures without retaining PII', async () => {
    const harness = createHarness();
    harness.read.mockRejectedValueOnce(
      Object.assign(
        new PlayerInitialLevelReassessmentPersistenceError(
          'database_unavailable',
        ),
        { privateValue: `${PRIVATE_MARKER}:private@example.test` },
      ),
    );
    const result = await harness.service.readOwnReassessment({
      accountId: ACCOUNT_ID,
      role: 'player',
    });
    expect(result).toEqual({
      outcome: 'rejected',
      reason: 'temporary_unavailable',
    });
    expect(inspect(result)).not.toContain(PRIVATE_MARKER);
    expect(inspect(result)).not.toContain('private@example.test');
  });
});
