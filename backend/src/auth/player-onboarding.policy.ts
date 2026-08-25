import type {
  OwnPlayerOnboardingCompletion,
  OwnPlayerOnboardingConsent,
} from './player-onboarding.types';
import type { PlayerOnboardingDocumentVersions } from '../config/player-onboarding-policy.config';
import {
  PLAYER_ONBOARDING_INITIAL_LEVEL_QUESTION_CODES,
  PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION,
  PlayerOnboardingInitialLevelResult,
  scorePlayerOnboardingInitialLevel,
} from './player-onboarding-initial-level';

export const PLAYER_ONBOARDING_FLOW_VERSION = 'tma_v1';
export const PLAYER_ONBOARDING_LEGAL_RECONSENT_FLOW_VERSION =
  'tma_legal_reconsent_v1';
export const PLAYER_ONBOARDING_SURVEY_VERSION =
  PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION;

export type PlayerOnboardingPolicy = Readonly<{
  flowVersion: typeof PLAYER_ONBOARDING_FLOW_VERSION;
  consents: readonly OwnPlayerOnboardingConsent[];
  survey: Readonly<{
    version: typeof PLAYER_ONBOARDING_SURVEY_VERSION;
    questionCodes: typeof PLAYER_ONBOARDING_INITIAL_LEVEL_QUESTION_CODES;
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
        kind: 'personal_data_processing' as const,
        documentVersion: documentVersions.personalDataProcessing,
      }),
      Object.freeze({
        kind: 'terms' as const,
        documentVersion: documentVersions.terms,
      }),
    ]),
    survey: Object.freeze({
      version: PLAYER_ONBOARDING_SURVEY_VERSION,
      questionCodes: PLAYER_ONBOARDING_INITIAL_LEVEL_QUESTION_CODES,
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
  return policy.consents.every((required) =>
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
  return scorePlayerOnboardingCompletion(policy, completion) !== undefined;
}

export function scorePlayerOnboardingCompletion(
  policy: PlayerOnboardingPolicy,
  completion: OwnPlayerOnboardingCompletion,
): PlayerOnboardingInitialLevelResult | undefined {
  if (
    completion.flowVersion !== policy.flowVersion ||
    completion.survey.version !== policy.survey.version ||
    !arePlayerOnboardingConsents(policy, completion.consents)
  ) {
    return undefined;
  }
  return scorePlayerOnboardingInitialLevel(completion.survey.answers);
}
