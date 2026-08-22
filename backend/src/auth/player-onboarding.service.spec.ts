import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  CompletePlayerOnboardingInput,
  CompletePlayerOnboardingResult,
  PlayerOnboardingCompletionPersistenceError,
  PlayerOnboardingCompletionWriter,
} from '../database/player-onboarding-completion-writer';
import {
  PlayerOnboardingDraftWritePersistenceError,
  PlayerOnboardingDraftWriter,
  SavePlayerOnboardingDraftInput,
  SavePlayerOnboardingDraftResult,
} from '../database/player-onboarding-draft-writer';
import {
  AdvancePlayerOnboardingInput,
  AdvancePlayerOnboardingResult,
  PlayerOnboardingProgressWriter,
} from '../database/player-onboarding-progress-writer';
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
import {
  AdvanceOwnPlayerOnboardingInput,
  CompleteOwnPlayerOnboardingInput,
  SaveOwnPlayerOnboardingDraftInput,
} from './player-onboarding.types';

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
  const complete = jest
    .fn<
      Promise<CompletePlayerOnboardingResult>,
      [PostgresTransaction, CompletePlayerOnboardingInput]
    >()
    .mockResolvedValue({ outcome: 'completed', revision: 5, replayed: false });
  const advance = jest
    .fn<
      Promise<AdvancePlayerOnboardingResult>,
      [PostgresTransaction, AdvancePlayerOnboardingInput]
    >()
    .mockResolvedValue({ outcome: 'advanced', revision: 2, replayed: false });
  const service = new PlayerOnboardingService({
    transactions: { run } as PlayerOnboardingTransactionExecutor,
    onboarding: { findByAccountId } as PlayerOnboardingReader,
    draftWriter: { saveDraft } as PlayerOnboardingDraftWriter,
    progressWriter: { advance } as PlayerOnboardingProgressWriter,
    completionWriter: { complete } as PlayerOnboardingCompletionWriter,
    clock: { nowEpochSeconds: () => NOW },
  });
  return {
    service,
    transaction,
    run,
    findByAccountId,
    saveDraft,
    advance,
    complete,
  };
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

function progressResult(
  currentStep: 'consents' | 'level_survey',
  revision: number,
): ReadPlayerOnboardingResult {
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
        currentStep,
        surveyVersion: 'initial_level_v1',
        surveyAnswers: {},
        revision,
      },
      consents:
        currentStep === 'level_survey'
          ? [
              { kind: 'cancellation', documentVersion: '2026-08-01' },
              { kind: 'privacy', documentVersion: '2026-08-01' },
              { kind: 'terms', documentVersion: '2026-08-01' },
            ]
          : [],
    },
  };
}

function completedResult(): ReadPlayerOnboardingResult {
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
        status: 'completed',
        currentStep: 'completed',
        surveyVersion: 'initial_level_v1',
        surveyAnswers: { experience: 'beginner' },
        revision: 5,
      },
      consents: [
        { kind: 'cancellation', documentVersion: '2026-08-01' },
        { kind: 'privacy', documentVersion: '2026-08-01' },
        { kind: 'terms', documentVersion: '2026-08-01' },
      ],
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

function completionInput(
  overrides: Partial<CompleteOwnPlayerOnboardingInput> = {},
): CompleteOwnPlayerOnboardingInput {
  return {
    accountId: ACCOUNT_ID,
    role: 'player',
    completion: {
      expectedRevision: 4,
      flowVersion: 'tma_v1',
      consents: [
        { kind: 'terms', documentVersion: '2026-08-01' },
        { kind: 'privacy', documentVersion: '2026-08-01' },
        { kind: 'cancellation', documentVersion: '2026-08-01' },
      ],
      survey: {
        version: 'initial_level_v1',
        answers: { experience: 'beginner' },
      },
    },
    ...overrides,
  };
}

function progressInput(
  progress: AdvanceOwnPlayerOnboardingInput['progress'] = {
    expectedRevision: 1,
    flowVersion: 'tma_v1',
    nextStep: 'consents',
  },
  overrides: Partial<AdvanceOwnPlayerOnboardingInput> = {},
): AdvanceOwnPlayerOnboardingInput {
  return {
    accountId: ACCOUNT_ID,
    role: 'player',
    progress,
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

  it('advances a ready owner profile to consents by one exact revision', async () => {
    const harness = createHarness(progressResult('consents', 2));

    await expect(
      harness.service.advanceOwnOnboarding(progressInput()),
    ).resolves.toEqual({
      outcome: 'advanced',
      onboarding: {
        status: 'in_progress',
        flowVersion: 'tma_v1',
        currentStep: 'consents',
        surveyVersion: 'initial_level_v1',
        revision: 2,
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
    expect(harness.advance).toHaveBeenCalledWith(harness.transaction, {
      accountId: ACCOUNT_ID,
      expectedRevision: 1,
      flowVersion: 'tma_v1',
      nextStep: 'consents',
      consents: [],
      advancedAt: NOW,
    });
    expect(harness.findByAccountId).toHaveBeenCalledWith(harness.transaction, {
      accountId: ACCOUNT_ID,
    });
  });

  it('resumes consents with exact backend test policy before level_survey', async () => {
    const harness = createHarness(progressResult('level_survey', 3));
    harness.advance.mockResolvedValueOnce({
      outcome: 'advanced',
      revision: 3,
      replayed: false,
    });
    const progress: AdvanceOwnPlayerOnboardingInput['progress'] = {
      expectedRevision: 2,
      flowVersion: 'tma_v1',
      nextStep: 'level_survey',
      consents: [
        { kind: 'terms', documentVersion: '2026-08-01' },
        { kind: 'privacy', documentVersion: '2026-08-01' },
        { kind: 'cancellation', documentVersion: '2026-08-01' },
      ],
    };

    const result = await harness.service.advanceOwnOnboarding(
      progressInput(progress),
    );
    expect(result).toMatchObject({
      outcome: 'advanced',
      onboarding: { currentStep: 'level_survey', revision: 3 },
    });
    expect(harness.advance).toHaveBeenCalledWith(harness.transaction, {
      accountId: ACCOUNT_ID,
      expectedRevision: 2,
      flowVersion: 'tma_v1',
      nextStep: 'level_survey',
      consents: [
        { kind: 'cancellation', documentVersion: '2026-08-01' },
        { kind: 'privacy', documentVersion: '2026-08-01' },
        { kind: 'terms', documentVersion: '2026-08-01' },
      ],
      advancedAt: NOW,
    });
  });

  it('accepts current test policy alongside historical same-flow consent rows', async () => {
    const persisted = progressResult('level_survey', 3);
    if (persisted.outcome !== 'found') {
      throw new Error('Expected progress fixture');
    }
    const harness = createHarness({
      outcome: 'found',
      onboarding: {
        ...persisted.onboarding,
        consents: [
          { kind: 'cancellation', documentVersion: '2026-07-01' },
          { kind: 'cancellation', documentVersion: '2026-08-01' },
          { kind: 'privacy', documentVersion: '2026-07-01' },
          { kind: 'privacy', documentVersion: '2026-08-01' },
          { kind: 'terms', documentVersion: '2026-07-01' },
          { kind: 'terms', documentVersion: '2026-08-01' },
        ],
      },
    });
    harness.advance.mockResolvedValueOnce({
      outcome: 'advanced',
      revision: 3,
      replayed: true,
    });

    await expect(
      harness.service.advanceOwnOnboarding(
        progressInput({
          expectedRevision: 2,
          flowVersion: 'tma_v1',
          nextStep: 'level_survey',
          consents: [
            { kind: 'terms', documentVersion: '2026-08-01' },
            { kind: 'privacy', documentVersion: '2026-08-01' },
            { kind: 'cancellation', documentVersion: '2026-08-01' },
          ],
        }),
      ),
    ).resolves.toMatchObject({
      outcome: 'advanced',
      onboarding: { currentStep: 'level_survey', revision: 3 },
    });
  });

  it('returns an exact replay as the current resumable representation', async () => {
    const harness = createHarness(progressResult('consents', 2));
    harness.advance.mockResolvedValueOnce({
      outcome: 'advanced',
      revision: 2,
      replayed: true,
    });

    await expect(
      harness.service.advanceOwnOnboarding(progressInput()),
    ).resolves.toMatchObject({
      outcome: 'advanced',
      onboarding: { currentStep: 'consents', revision: 2 },
    });
    expect(harness.findByAccountId).toHaveBeenCalledTimes(1);
  });

  it('rejects non-owner roles and outdated consent policy before a transaction', async () => {
    const harness = createHarness();
    await expect(
      harness.service.advanceOwnOnboarding(
        progressInput(undefined, { role: 'club_admin' }),
      ),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'onboarding_not_found',
    });
    await expect(
      harness.service.advanceOwnOnboarding(
        progressInput({
          expectedRevision: 2,
          flowVersion: 'tma_v1',
          nextStep: 'level_survey',
          consents: [
            { kind: 'terms', documentVersion: '2026-08-02' },
            { kind: 'privacy', documentVersion: '2026-08-02' },
            { kind: 'cancellation', documentVersion: '2026-08-02' },
          ],
        }),
      ),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'progress_conflict',
    });
    expect(harness.run).not.toHaveBeenCalled();
    expect(harness.advance).not.toHaveBeenCalled();
  });

  it.each([
    ['stale_revision', 'stale_revision'],
    ['conflict', 'progress_conflict'],
  ] as const)(
    'maps writer %s to a bounded owner conflict',
    async (outcome, reason) => {
      const harness = createHarness();
      harness.advance.mockResolvedValueOnce({ outcome });
      await expect(
        harness.service.advanceOwnOnboarding(progressInput()),
      ).resolves.toEqual({ outcome: 'rejected', reason });
      expect(harness.findByAccountId).not.toHaveBeenCalled();
    },
  );

  it('fails transactionally when progress reread belongs to another owner', async () => {
    const harness = createHarness({
      outcome: 'found',
      onboarding: {
        ...(progressResult('consents', 2) as Extract<
          ReadPlayerOnboardingResult,
          { outcome: 'found' }
        >).onboarding,
        accountId: OTHER_ACCOUNT_ID,
      },
    });

    await expect(
      harness.service.advanceOwnOnboarding(progressInput()),
    ).resolves.toEqual({ outcome: 'rejected', reason: 'internal_failure' });
  });

  it('atomically completes the authenticated owner with backend-owned policy and rereads the result', async () => {
    const harness = createHarness(completedResult());

    await expect(
      harness.service.completeOwnOnboarding(completionInput()),
    ).resolves.toEqual({
      outcome: 'completed',
      onboarding: {
        status: 'completed',
        flowVersion: 'tma_v1',
        currentStep: 'completed',
        surveyVersion: 'initial_level_v1',
        revision: 5,
        profile: { firstName: 'Synthetic', lastName: 'Player' },
        contacts: {
          phone: '+79990000000',
          normalizedEmail: 'player@example.test',
          assurance: 'declared',
        },
        consents: [
          { kind: 'cancellation', documentVersion: '2026-08-01' },
          { kind: 'privacy', documentVersion: '2026-08-01' },
          { kind: 'terms', documentVersion: '2026-08-01' },
        ],
        surveyAnswers: { experience: 'beginner' },
      },
    });
    expect(harness.run).toHaveBeenCalledTimes(1);
    expect(harness.complete).toHaveBeenCalledWith(harness.transaction, {
      accountId: ACCOUNT_ID,
      expectedRevision: 4,
      flowVersion: 'tma_v1',
      consents: [
        { kind: 'cancellation', documentVersion: '2026-08-01' },
        { kind: 'privacy', documentVersion: '2026-08-01' },
        { kind: 'terms', documentVersion: '2026-08-01' },
      ],
      surveyVersion: 'initial_level_v1',
      surveyAnswers: { experience: 'beginner' },
      completedAt: NOW,
    });
    expect(harness.findByAccountId).toHaveBeenCalledWith(harness.transaction, {
      accountId: ACCOUNT_ID,
    });
    expect(JSON.stringify(harness.complete.mock.calls[0])).not.toMatch(
      /isVerified|verified|rating/iu,
    );
  });

  it('returns an exact replay as the same completed representation without verification claims', async () => {
    const harness = createHarness(completedResult());
    harness.complete.mockResolvedValueOnce({
      outcome: 'completed',
      revision: 5,
      replayed: true,
    });

    const result =
      await harness.service.completeOwnOnboarding(completionInput());
    expect(result.outcome).toBe('completed');
    if (result.outcome === 'completed') {
      expect(result.onboarding.contacts.assurance).toBe('declared');
      expect(result.onboarding).not.toHaveProperty('isVerified');
      expect(result.onboarding).not.toHaveProperty('rating');
    }
  });

  it.each([
    [
      'outdated consent',
      {
        ...completionInput().completion,
        consents: [
          { kind: 'terms' as const, documentVersion: '2026-07-01' },
          { kind: 'privacy' as const, documentVersion: '2026-08-01' },
          { kind: 'cancellation' as const, documentVersion: '2026-08-01' },
        ],
      },
    ],
    [
      'unknown survey answer',
      {
        ...completionInput().completion,
        survey: {
          version: 'initial_level_v1',
          answers: { experience: 'unsupported' },
        },
      },
    ],
    [
      'partial survey',
      {
        ...completionInput().completion,
        survey: { version: 'initial_level_v1', answers: {} },
      },
    ],
  ])('rejects %s before persistence', async (_label, completion) => {
    const harness = createHarness(completedResult());
    const result = await harness.service.completeOwnOnboarding(
      completionInput({ completion }),
    );
    expect(result).toEqual({
      outcome: 'rejected',
      reason:
        _label === 'partial survey' ? 'invalid_request' : 'completion_conflict',
    });
    expect(harness.run).not.toHaveBeenCalled();
  });

  it('hides non-player ownership before policy validation or a transaction', async () => {
    const harness = createHarness(completedResult());
    await expect(
      harness.service.completeOwnOnboarding(
        completionInput({ role: 'club_admin' }),
      ),
    ).resolves.toEqual({
      outcome: 'rejected',
      reason: 'onboarding_not_found',
    });
    expect(harness.run).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 'onboarding_not_found'],
    ['stale_revision', 'stale_revision'],
    ['incomplete', 'onboarding_incomplete'],
    ['conflict', 'completion_conflict'],
  ] as const)(
    'maps completion writer %s without rereading',
    async (outcome, reason) => {
      const harness = createHarness(completedResult());
      harness.complete.mockResolvedValueOnce({ outcome });
      await expect(
        harness.service.completeOwnOnboarding(completionInput()),
      ).resolves.toEqual({ outcome: 'rejected', reason });
      expect(harness.findByAccountId).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['database_unavailable', 'temporary_unavailable'],
    ['transaction_conflict', 'temporary_unavailable'],
    ['permission_denied', 'internal_failure'],
    ['invalid_persisted_state', 'internal_failure'],
  ] as const)(
    'maps completion persistence %s safely',
    async (failure, reason) => {
      const harness = createHarness(completedResult());
      harness.complete.mockRejectedValueOnce(
        new PlayerOnboardingCompletionPersistenceError(failure),
      );
      await expect(
        harness.service.completeOwnOnboarding(completionInput()),
      ).resolves.toEqual({ outcome: 'rejected', reason });
      expect(harness.findByAccountId).not.toHaveBeenCalled();
    },
  );

  it('fails transactionally when completion reread is not the exact completed owner state', async () => {
    const completed = completedResult();
    if (completed.outcome !== 'found') {
      throw new Error('Expected completed fixture');
    }
    const harness = createHarness({
      outcome: 'found',
      onboarding: { ...completed.onboarding, accountId: OTHER_ACCOUNT_ID },
    });
    await expect(
      harness.service.completeOwnOnboarding(completionInput()),
    ).resolves.toEqual({ outcome: 'rejected', reason: 'internal_failure' });
    expect(harness.complete).toHaveBeenCalledTimes(1);
    expect(harness.findByAccountId).toHaveBeenCalledTimes(1);
  });
});
