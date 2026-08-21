import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  PlayerOnboardingReadPersistenceError,
  PlayerOnboardingReader,
  ReadPlayerOnboardingInput,
  ReadPlayerOnboardingResult,
} from '../database/player-onboarding-reader';
import { PostgresTransaction } from '../database/postgres-transaction';
import {
  PlayerOnboardingService,
  PlayerOnboardingTransactionExecutor,
} from './player-onboarding.service';

const ACCOUNT_ID = deterministicUuid('player-onboarding-service') as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-onboarding-service-other',
) as AccountId;

function createHarness(result: ReadPlayerOnboardingResult = firstRunResult()) {
  const transaction = {} as PostgresTransaction;
  const run = jest.fn<
    ReturnType<PlayerOnboardingTransactionExecutor['run']>,
    Parameters<PlayerOnboardingTransactionExecutor['run']>
  >(async (operation) => operation(transaction));
  const findByAccountId = jest
    .fn<
      Promise<ReadPlayerOnboardingResult>,
      [PostgresTransaction, ReadPlayerOnboardingInput]
    >()
    .mockResolvedValue(result);
  const service = new PlayerOnboardingService({
    transactions: { run } as PlayerOnboardingTransactionExecutor,
    onboarding: { findByAccountId } as PlayerOnboardingReader,
  });
  return { service, transaction, run, findByAccountId };
}

function firstRunResult(): ReadPlayerOnboardingResult {
  return {
    outcome: 'found',
    onboarding: {
      accountId: ACCOUNT_ID,
      firstName: 'Synthetic',
      lastName: null,
      phone: '+79990000000',
      normalizedEmail: 'player@example.test',
      state: null,
      consents: [],
    },
  };
}

function draftResult(): ReadPlayerOnboardingResult {
  return {
    outcome: 'found',
    onboarding: {
      accountId: ACCOUNT_ID,
      firstName: 'Synthetic',
      lastName: 'Player',
      phone: '+79990000000',
      normalizedEmail: 'player@example.test',
      state: {
        flowVersion: 'tma_v1',
        status: 'in_progress',
        currentStep: 'level_survey',
        surveyVersion: 'initial_level_v1',
        surveyAnswers: { experience: 'beginner' },
        revision: 4,
      },
      consents: [
        { kind: 'privacy', documentVersion: '2026-08-01' },
        { kind: 'terms', documentVersion: '2026-08-01' },
      ],
    },
  };
}

describe('PlayerOnboardingService', () => {
  it('derives first-run required state without writing or inventing versions', async () => {
    const harness = createHarness();

    await expect(
      harness.service.readOwnOnboarding({
        accountId: ACCOUNT_ID,
        role: 'player',
      }),
    ).resolves.toEqual({
      outcome: 'found',
      onboarding: {
        status: 'required',
        flowVersion: null,
        currentStep: 'profile',
        surveyVersion: null,
        revision: null,
        profile: { firstName: 'Synthetic', lastName: null },
        contacts: {
          phone: '+79990000000',
          normalizedEmail: 'player@example.test',
          assurance: 'declared',
        },
        consents: [],
        surveyAnswers: {},
      },
    });
    expect(harness.run).toHaveBeenCalledTimes(1);
    expect(harness.findByAccountId).toHaveBeenCalledWith(harness.transaction, {
      accountId: ACCOUNT_ID,
    });
  });

  it('returns only the resumable draft allowlist for the authenticated owner', async () => {
    const harness = createHarness(draftResult());
    const result = await harness.service.readOwnOnboarding({
      accountId: ACCOUNT_ID,
      role: 'player',
    });

    expect(result).toEqual({
      outcome: 'found',
      onboarding: {
        status: 'in_progress',
        flowVersion: 'tma_v1',
        currentStep: 'level_survey',
        surveyVersion: 'initial_level_v1',
        revision: 4,
        profile: { firstName: 'Synthetic', lastName: 'Player' },
        contacts: {
          phone: '+79990000000',
          normalizedEmail: 'player@example.test',
          assurance: 'declared',
        },
        consents: [
          { kind: 'privacy', documentVersion: '2026-08-01' },
          { kind: 'terms', documentVersion: '2026-08-01' },
        ],
        surveyAnswers: { experience: 'beginner' },
      },
    });
    if (result.outcome === 'found') {
      expect(Object.isFrozen(result.onboarding)).toBe(true);
      expect(Object.isFrozen(result.onboarding.profile)).toBe(true);
      expect(Object.isFrozen(result.onboarding.contacts)).toBe(true);
      expect(Object.isFrozen(result.onboarding.consents)).toBe(true);
      expect(Object.isFrozen(result.onboarding.surveyAnswers)).toBe(true);
      const serialized = JSON.stringify(result.onboarding);
      for (const forbidden of [
        ACCOUNT_ID,
        'rating',
        'isVerified',
        'phoneVerified',
        'emailVerified',
        'acceptedAt',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });

  it('rejects a club admin before opening a player onboarding transaction', async () => {
    const harness = createHarness();
    await expect(
      harness.service.readOwnOnboarding({
        accountId: ACCOUNT_ID,
        role: 'club_admin',
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'onboarding_not_found',
    });
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.findByAccountId).not.toHaveBeenCalled();
  });

  it.each([
    { accountId: 'not-a-uuid', role: 'player' },
    { accountId: ACCOUNT_ID, role: 'owner' },
    { accountId: ACCOUNT_ID, role: 'player', other: true },
  ])('rejects malformed input before persistence %#', async (input) => {
    const harness = createHarness();
    await expect(
      harness.service.readOwnOnboarding(input as never),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'invalid_request',
    });
    expect(harness.run).not.toHaveBeenCalled();
  });

  it('fails closed when persistence returns another account owner', async () => {
    const result = firstRunResult();
    if (result.outcome !== 'found') {
      throw new Error('Expected found fixture');
    }
    const harness = createHarness({
      outcome: 'found',
      onboarding: { ...result.onboarding, accountId: OTHER_ACCOUNT_ID },
    });

    await expect(
      harness.service.readOwnOnboarding({
        accountId: ACCOUNT_ID,
        role: 'player',
      }),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
  });

  it.each([
    ['not_found', { outcome: 'not_found' }, 'onboarding_not_found'],
    [
      'malformed',
      { outcome: 'found', onboarding: { privateField: 'secret' } },
      'internal_failure',
    ],
  ] as const)(
    'maps %s repository result safely',
    async (_label, result, reason) => {
      const harness = createHarness(result as never);
      await expect(
        harness.service.readOwnOnboarding({
          accountId: ACCOUNT_ID,
          role: 'player',
        }),
      ).resolves.toEqual({ outcome: 'rejected', reason });
    },
  );

  it.each([
    ['database_unavailable', 'temporary_unavailable'],
    ['transaction_conflict', 'temporary_unavailable'],
    ['permission_denied', 'internal_failure'],
    ['invalid_persisted_state', 'internal_failure'],
  ] as const)('maps %s persistence error safely', async (failure, reason) => {
    const harness = createHarness();
    harness.findByAccountId.mockRejectedValueOnce(
      new PlayerOnboardingReadPersistenceError(failure),
    );
    await expect(
      harness.service.readOwnOnboarding({
        accountId: ACCOUNT_ID,
        role: 'player',
      }),
    ).resolves.toEqual({ outcome: 'rejected', reason });
  });
});
