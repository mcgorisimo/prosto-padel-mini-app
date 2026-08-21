import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  PlayerOnboardingDraftWritePersistenceError,
  PlayerOnboardingDraftWriter,
  SavePlayerOnboardingDraftInput,
  SavePlayerOnboardingDraftResult,
} from '../database/player-onboarding-draft-writer';
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
import { unixEpochSeconds } from './auth.types';
import { SaveOwnPlayerOnboardingDraftInput } from './player-onboarding.types';

const ACCOUNT_ID = deterministicUuid('player-onboarding-service') as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-onboarding-service-other',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);

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
  const saveDraft = jest
    .fn<
      Promise<SavePlayerOnboardingDraftResult>,
      [PostgresTransaction, SavePlayerOnboardingDraftInput]
    >()
    .mockResolvedValue({ outcome: 'saved', revision: 1 });
  const service = new PlayerOnboardingService({
    transactions: { run } as PlayerOnboardingTransactionExecutor,
    onboarding: { findByAccountId } as PlayerOnboardingReader,
    draftWriter: { saveDraft } as PlayerOnboardingDraftWriter,
    clock: { nowEpochSeconds: () => NOW },
  });
  return { service, transaction, run, findByAccountId, saveDraft };
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

function savedDraftResult(revision: number): ReadPlayerOnboardingResult {
  return {
    outcome: 'found',
    onboarding: {
      accountId: ACCOUNT_ID,
      firstName: 'Updated',
      lastName: 'Player',
      phone: '+79991112233',
      normalizedEmail: 'owner@example.test',
      state: {
        flowVersion: 'tma_v1',
        status: 'in_progress',
        currentStep: 'profile',
        surveyVersion: 'initial_level_v1',
        surveyAnswers: {},
        revision,
      },
      consents: [],
    },
  };
}

function saveInput(
  overrides: Partial<SaveOwnPlayerOnboardingDraftInput> = {},
): SaveOwnPlayerOnboardingDraftInput {
  return {
    accountId: ACCOUNT_ID,
    role: 'player',
    draft: {
      expectedRevision: null,
      profile: { firstName: 'Updated', lastName: 'Player' },
      contacts: {
        phone: '+79991112233',
        email: ' Owner@Example.Test ',
      },
    },
    ...overrides,
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

  it('creates a first-run owner draft with backend-owned versions and normalized declared contacts', async () => {
    const harness = createHarness(savedDraftResult(1));

    await expect(
      harness.service.saveOwnOnboardingDraft(saveInput()),
    ).resolves.toEqual({
      outcome: 'saved',
      onboarding: {
        status: 'in_progress',
        flowVersion: 'tma_v1',
        currentStep: 'profile',
        surveyVersion: 'initial_level_v1',
        revision: 1,
        profile: { firstName: 'Updated', lastName: 'Player' },
        contacts: {
          phone: '+79991112233',
          normalizedEmail: 'owner@example.test',
          assurance: 'declared',
        },
        consents: [],
        surveyAnswers: {},
      },
    });
    expect(harness.saveDraft).toHaveBeenCalledWith(harness.transaction, {
      accountId: ACCOUNT_ID,
      expectedRevision: null,
      firstName: 'Updated',
      lastName: 'Player',
      phone: '+79991112233',
      normalizedEmail: 'owner@example.test',
      flowVersion: 'tma_v1',
      surveyVersion: 'initial_level_v1',
      updatedAt: NOW,
    });
    expect(harness.findByAccountId).toHaveBeenCalledWith(harness.transaction, {
      accountId: ACCOUNT_ID,
    });
  });

  it('resumes only the exact revision and rereads the same owner in one transaction', async () => {
    const harness = createHarness(savedDraftResult(5));
    harness.saveDraft.mockResolvedValueOnce({
      outcome: 'saved',
      revision: 5,
    });
    const input = saveInput({
      draft: {
        ...saveInput().draft,
        expectedRevision: 4,
      },
    });

    await expect(
      harness.service.saveOwnOnboardingDraft(input),
    ).resolves.toMatchObject({
      outcome: 'saved',
      onboarding: { revision: 5 },
    });
    expect(harness.run).toHaveBeenCalledTimes(1);
    expect(harness.saveDraft.mock.invocationCallOrder[0]).toBeLessThan(
      harness.findByAccountId.mock.invocationCallOrder[0],
    );
  });

  it.each([
    ['not_found', 'onboarding_not_found'],
    ['stale_revision', 'stale_revision'],
    ['closed', 'onboarding_closed'],
  ] as const)('maps writer %s without rereading', async (outcome, reason) => {
    const harness = createHarness(savedDraftResult(1));
    harness.saveDraft.mockResolvedValueOnce({ outcome });

    await expect(
      harness.service.saveOwnOnboardingDraft(saveInput()),
    ).resolves.toEqual({ outcome: 'rejected', reason });
    expect(harness.findByAccountId).not.toHaveBeenCalled();
  });

  it('hides non-player ownership before opening a transaction', async () => {
    const harness = createHarness(savedDraftResult(1));
    await expect(
      harness.service.saveOwnOnboardingDraft(saveInput({ role: 'club_admin' })),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'onboarding_not_found',
    });
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.saveDraft).not.toHaveBeenCalled();
  });

  it.each([
    saveInput({
      draft: {
        ...saveInput().draft,
        contacts: { phone: '79991112233', email: null },
      },
    }),
    saveInput({
      draft: {
        ...saveInput().draft,
        contacts: { phone: null, email: 'invalid-email' },
      },
    }),
    { ...saveInput(), accountId: OTHER_ACCOUNT_ID, owner: ACCOUNT_ID },
  ])(
    'rejects malformed or expanded input before persistence %#',
    async (input) => {
      const harness = createHarness(savedDraftResult(1));
      await expect(
        harness.service.saveOwnOnboardingDraft(input as never),
      ).resolves.toEqual({ outcome: 'rejected', reason: 'invalid_request' });
      expect(harness.run).not.toHaveBeenCalled();
    },
  );

  it('rejects disallowed names without copying them into persistence', async () => {
    const harness = createHarness(savedDraftResult(1));
    await expect(
      harness.service.saveOwnOnboardingDraft(
        saveInput({
          draft: {
            ...saveInput().draft,
            profile: { firstName: 'fuck', lastName: null },
          },
        }),
      ),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'content_not_allowed',
    });
    expect(harness.run).not.toHaveBeenCalled();
  });

  it('fails transactionally when the post-write reread belongs to another owner', async () => {
    const result = savedDraftResult(1);
    if (result.outcome !== 'found') {
      throw new Error('Expected found fixture');
    }
    const harness = createHarness({
      outcome: 'found',
      onboarding: { ...result.onboarding, accountId: OTHER_ACCOUNT_ID },
    });
    await expect(
      harness.service.saveOwnOnboardingDraft(saveInput()),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'internal_failure',
    });
    expect(harness.saveDraft).toHaveBeenCalledTimes(1);
    expect(harness.findByAccountId).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['database_unavailable', 'temporary_unavailable'],
    ['transaction_conflict', 'temporary_unavailable'],
    ['permission_denied', 'internal_failure'],
    ['invalid_persisted_state', 'internal_failure'],
  ] as const)('maps draft writer %s safely', async (failure, reason) => {
    const harness = createHarness(savedDraftResult(1));
    harness.saveDraft.mockRejectedValueOnce(
      new PlayerOnboardingDraftWritePersistenceError(failure),
    );
    await expect(
      harness.service.saveOwnOnboardingDraft(saveInput()),
    ).resolves.toEqual({ outcome: 'rejected', reason });
    expect(harness.findByAccountId).not.toHaveBeenCalled();
  });
});
