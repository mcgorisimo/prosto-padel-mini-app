import {
  arePlayerOnboardingConsents,
  createPlayerOnboardingPolicy,
  hasPlayerOnboardingConsents,
  isPlayerOnboardingCompletion,
} from './player-onboarding.policy';

const POLICY = createPlayerOnboardingPolicy({
  terms: 'terms-test-2026-08-23-v1',
  privacy: 'privacy-test-2026-08-23-v1',
  cancellation: 'cancellation-test-2026-08-23-v1',
});

const CONSENTS = Object.freeze([
  Object.freeze({
    kind: 'terms' as const,
    documentVersion: 'terms-test-2026-08-23-v1',
  }),
  Object.freeze({
    kind: 'privacy' as const,
    documentVersion: 'privacy-test-2026-08-23-v1',
  }),
  Object.freeze({
    kind: 'cancellation' as const,
    documentVersion: 'cancellation-test-2026-08-23-v1',
  }),
]);

describe('player onboarding policy', () => {
  it('builds an immutable exact three-document policy', () => {
    expect(POLICY).toEqual({
      flowVersion: 'tma_v1',
      consents: [
        {
          kind: 'cancellation',
          documentVersion: 'cancellation-test-2026-08-23-v1',
        },
        {
          kind: 'privacy',
          documentVersion: 'privacy-test-2026-08-23-v1',
        },
        {
          kind: 'terms',
          documentVersion: 'terms-test-2026-08-23-v1',
        },
      ],
      survey: {
        version: 'initial_level_v1',
        requiredQuestion: 'experience',
        allowedAnswers: ['beginner', 'intermediate', 'advanced'],
      },
    });
    expect(Object.isFrozen(POLICY)).toBe(true);
    expect(Object.isFrozen(POLICY.consents)).toBe(true);
  });

  it('accepts only the configured consent versions and survey contract', () => {
    expect(arePlayerOnboardingConsents(POLICY, CONSENTS)).toBe(true);
    expect(
      hasPlayerOnboardingConsents(POLICY, [
        ...CONSENTS,
        { kind: 'terms', documentVersion: 'historical-test-v0' },
      ]),
    ).toBe(true);
    expect(
      arePlayerOnboardingConsents(POLICY, [
        ...CONSENTS.slice(0, 2),
        { kind: 'cancellation', documentVersion: 'historical-test-v0' },
      ]),
    ).toBe(false);
    expect(
      isPlayerOnboardingCompletion(POLICY, {
        expectedRevision: 3,
        flowVersion: 'tma_v1',
        consents: CONSENTS,
        survey: {
          version: 'initial_level_v1',
          answers: { experience: 'beginner' },
        },
      }),
    ).toBe(true);
  });
});
