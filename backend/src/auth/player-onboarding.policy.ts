import { PlayerOnboardingConsentKind } from '../database/player-onboarding-reader';
import type { OwnPlayerOnboardingCompletion } from './player-onboarding.types';

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

function consentVersion(
  completion: OwnPlayerOnboardingCompletion,
  kind: PlayerOnboardingConsentKind,
): string | undefined {
  return completion.consents.find((consent) => consent.kind === kind)
    ?.documentVersion;
}

export function isCurrentPlayerOnboardingCompletion(
  completion: OwnPlayerOnboardingCompletion,
): boolean {
  if (
    completion.flowVersion !== CURRENT_PLAYER_ONBOARDING_POLICY.flowVersion ||
    completion.survey.version !==
      CURRENT_PLAYER_ONBOARDING_POLICY.survey.version ||
    completion.consents.length !== CURRENT_CONSENTS.length ||
    Object.keys(completion.survey.answers).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(
      completion.survey.answers,
      CURRENT_PLAYER_ONBOARDING_POLICY.survey.requiredQuestion,
    )
  ) {
    return false;
  }

  for (const consent of CURRENT_CONSENTS) {
    if (consentVersion(completion, consent.kind) !== consent.documentVersion) {
      return false;
    }
  }

  const answer =
    completion.survey.answers[
      CURRENT_PLAYER_ONBOARDING_POLICY.survey.requiredQuestion
    ];
  return CURRENT_PLAYER_ONBOARDING_POLICY.survey.allowedAnswers.includes(
    answer as (typeof EXPERIENCE_ANSWERS)[number],
  );
}
