import type {
  OwnPlayerOnboardingCompletion,
  OwnPlayerOnboardingConsent,
} from './player-onboarding.types';

export const PLAYER_ONBOARDING_FLOW_VERSION = 'tma_v1';
export const PLAYER_ONBOARDING_SURVEY_VERSION = 'initial_level_v1';

const CURRENT_CONSENTS = Object.freeze([
  Object.freeze({
    kind: 'cancellation' as const,
    documentVersion: '2026-08-01',
  }),
  Object.freeze({ kind: 'privacy' as const, documentVersion: '2026-08-01' }),
  Object.freeze({ kind: 'terms' as const, documentVersion: '2026-08-01' }),
]);

const EXPERIENCE_ANSWERS = Object.freeze([
  'beginner',
  'intermediate',
  'advanced',
] as const);

export const CURRENT_PLAYER_ONBOARDING_POLICY = Object.freeze({
  flowVersion: PLAYER_ONBOARDING_FLOW_VERSION,
  consents: CURRENT_CONSENTS,
  survey: Object.freeze({
    version: PLAYER_ONBOARDING_SURVEY_VERSION,
    requiredQuestion: 'experience',
    allowedAnswers: EXPERIENCE_ANSWERS,
  }),
});

export function areCurrentPlayerOnboardingConsents(
  consents: readonly OwnPlayerOnboardingConsent[],
): boolean {
  return (
    consents.length === CURRENT_CONSENTS.length &&
    hasCurrentPlayerOnboardingConsents(consents)
  );
}

export function hasCurrentPlayerOnboardingConsents(
  consents: readonly OwnPlayerOnboardingConsent[],
): boolean {
  return CURRENT_CONSENTS.every(
    (required) =>
      consents.some(
        (consent) =>
          consent.kind === required.kind &&
          consent.documentVersion === required.documentVersion,
      ),
  );
}

export function isCurrentPlayerOnboardingCompletion(
  completion: OwnPlayerOnboardingCompletion,
): boolean {
  if (
    completion.flowVersion !== CURRENT_PLAYER_ONBOARDING_POLICY.flowVersion ||
    completion.survey.version !==
      CURRENT_PLAYER_ONBOARDING_POLICY.survey.version ||
    !areCurrentPlayerOnboardingConsents(completion.consents) ||
    Object.keys(completion.survey.answers).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(
      completion.survey.answers,
      CURRENT_PLAYER_ONBOARDING_POLICY.survey.requiredQuestion,
    )
  ) {
    return false;
  }

  const answer =
    completion.survey.answers[
      CURRENT_PLAYER_ONBOARDING_POLICY.survey.requiredQuestion
    ];
  return CURRENT_PLAYER_ONBOARDING_POLICY.survey.allowedAnswers.includes(
    answer as (typeof EXPERIENCE_ANSWERS)[number],
  );
}
