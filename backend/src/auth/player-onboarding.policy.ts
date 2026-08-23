import type {
  OwnPlayerOnboardingCompletion,
  OwnPlayerOnboardingConsent,
} from './player-onboarding.types';
import type { PlayerOnboardingDocumentVersions } from '../config/player-onboarding-policy.config';

export const PLAYER_ONBOARDING_FLOW_VERSION = 'tma_v1';
export const PLAYER_ONBOARDING_SURVEY_VERSION = 'initial_level_v1';

const EXPERIENCE_ANSWERS = Object.freeze([
  'beginner',
  'intermediate',
  'advanced',
] as const);

export type PlayerOnboardingPolicy = Readonly<{
  flowVersion: typeof PLAYER_ONBOARDING_FLOW_VERSION;
  consents: readonly OwnPlayerOnboardingConsent[];
  survey: Readonly<{
    version: typeof PLAYER_ONBOARDING_SURVEY_VERSION;
    requiredQuestion: 'experience';
    allowedAnswers: typeof EXPERIENCE_ANSWERS;
  }>;
}>;

export function createPlayerOnboardingPolicy(
  documentVersions: PlayerOnboardingDocumentVersions,
): PlayerOnboardingPolicy {
  return Object.freeze({
    flowVersion: PLAYER_ONBOARDING_FLOW_VERSION,
    consents: Object.freeze([
      Object.freeze({
        kind: 'cancellation' as const,
        documentVersion: documentVersions.cancellation,
      }),
      Object.freeze({
        kind: 'privacy' as const,
        documentVersion: documentVersions.privacy,
      }),
      Object.freeze({
        kind: 'terms' as const,
        documentVersion: documentVersions.terms,
      }),
    ]),
    survey: Object.freeze({
      version: PLAYER_ONBOARDING_SURVEY_VERSION,
      requiredQuestion: 'experience' as const,
      allowedAnswers: EXPERIENCE_ANSWERS,
    }),
  });
}

export function arePlayerOnboardingConsents(
  policy: PlayerOnboardingPolicy,
  consents: readonly OwnPlayerOnboardingConsent[],
): boolean {
  return (
    consents.length === policy.consents.length &&
    hasPlayerOnboardingConsents(policy, consents)
  );
}

export function hasPlayerOnboardingConsents(
  policy: PlayerOnboardingPolicy,
  consents: readonly OwnPlayerOnboardingConsent[],
): boolean {
  return policy.consents.every(
    (required) =>
      consents.some(
        (consent) =>
          consent.kind === required.kind &&
          consent.documentVersion === required.documentVersion,
      ),
  );
}

export function isPlayerOnboardingCompletion(
  policy: PlayerOnboardingPolicy,
  completion: OwnPlayerOnboardingCompletion,
): boolean {
  if (
    completion.flowVersion !== policy.flowVersion ||
    completion.survey.version !==
      policy.survey.version ||
    !arePlayerOnboardingConsents(policy, completion.consents) ||
    Object.keys(completion.survey.answers).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(
      completion.survey.answers,
      policy.survey.requiredQuestion,
    )
  ) {
    return false;
  }

  const answer =
    completion.survey.answers[
      policy.survey.requiredQuestion
    ];
  return policy.survey.allowedAnswers.includes(
    answer as (typeof EXPERIENCE_ANSWERS)[number],
  );
}
