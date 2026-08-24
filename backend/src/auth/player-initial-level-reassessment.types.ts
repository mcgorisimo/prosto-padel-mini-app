import { AccountId, UserRole, isAccountId } from '../accounts/account.types';
import {
  PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION,
  PlayerOnboardingInitialLevelLabel,
  scorePlayerOnboardingInitialLevel,
} from './player-onboarding-initial-level';

export type OwnPlayerInitialLevelReassessment =
  | Readonly<{ readonly status: 'not_eligible' }>
  | Readonly<{
      readonly status: 'required';
      readonly source: Readonly<{
        readonly flowVersion: string;
        readonly surveyVersion: 'initial_level_v1';
        readonly revision: number;
      }>;
      readonly surveyVersion: 'initial_level_v2';
    }>
  | Readonly<{
      readonly status: 'completed';
      readonly surveyVersion: 'initial_level_v2';
      readonly initialLevelLabel: PlayerOnboardingInitialLevelLabel;
    }>;

export interface ReadOwnPlayerInitialLevelReassessmentInput {
  readonly accountId: AccountId;
  readonly role: UserRole;
}

export interface CompleteOwnPlayerInitialLevelReassessmentInput {
  readonly accountId: AccountId;
  readonly role: UserRole;
  readonly completion: Readonly<{
    readonly source: Readonly<{
      readonly flowVersion: string;
      readonly surveyVersion: 'initial_level_v1';
      readonly revision: number;
    }>;
    readonly survey: Readonly<{
      readonly version: 'initial_level_v2';
      readonly answers: Readonly<Record<string, string>>;
    }>;
  }>;
}

export type ReadOwnPlayerInitialLevelReassessmentResult =
  | Readonly<{
      readonly outcome: 'found';
      readonly reassessment: OwnPlayerInitialLevelReassessment;
    }>
  | Readonly<{
      readonly outcome: 'rejected';
      readonly reason:
        'invalid_request' | 'temporary_unavailable' | 'internal_failure';
    }>;

export type CompleteOwnPlayerInitialLevelReassessmentResult =
  | Readonly<{
      readonly outcome: 'completed';
      readonly reassessment: Extract<
        OwnPlayerInitialLevelReassessment,
        { readonly status: 'completed' }
      >;
    }>
  | Readonly<{
      readonly outcome: 'rejected';
      readonly reason:
        | 'invalid_request'
        | 'reassessment_not_eligible'
        | 'reassessment_source_conflict'
        | 'reassessment_conflict'
        | 'temporary_unavailable'
        | 'internal_failure';
    }>;

const FLOW_VERSION_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isRole(value: unknown): value is UserRole {
  return value === 'player' || value === 'club_admin';
}

export function isReadOwnPlayerInitialLevelReassessmentInput(
  value: unknown,
): value is ReadOwnPlayerInitialLevelReassessmentInput {
  return (
    isPlainRecord(value) &&
    hasExactlyKeys(value, ['accountId', 'role']) &&
    isAccountId(value.accountId) &&
    isRole(value.role)
  );
}

export function readOwnPlayerInitialLevelReassessmentCompletion(
  value: unknown,
): CompleteOwnPlayerInitialLevelReassessmentInput['completion'] | undefined {
  if (
    !isPlainRecord(value) ||
    !hasExactlyKeys(value, ['source', 'survey']) ||
    !isPlainRecord(value.source) ||
    !hasExactlyKeys(value.source, [
      'flowVersion',
      'surveyVersion',
      'revision',
    ]) ||
    typeof value.source.flowVersion !== 'string' ||
    !FLOW_VERSION_PATTERN.test(value.source.flowVersion) ||
    value.source.surveyVersion !== 'initial_level_v1' ||
    typeof value.source.revision !== 'number' ||
    !Number.isSafeInteger(value.source.revision) ||
    value.source.revision < 1 ||
    !isPlainRecord(value.survey) ||
    !hasExactlyKeys(value.survey, ['version', 'answers']) ||
    value.survey.version !== PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION ||
    !isPlainRecord(value.survey.answers) ||
    scorePlayerOnboardingInitialLevel(
      value.survey.answers as Record<string, string>,
    ) === undefined
  ) {
    return undefined;
  }

  return Object.freeze({
    source: Object.freeze({
      flowVersion: value.source.flowVersion,
      surveyVersion: 'initial_level_v1' as const,
      revision: value.source.revision,
    }),
    survey: Object.freeze({
      version: PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION,
      answers: Object.freeze(
        Object.fromEntries(
          Object.entries(value.survey.answers).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ) as Record<string, string>,
      ),
    }),
  });
}

export function isCompleteOwnPlayerInitialLevelReassessmentInput(
  value: unknown,
): value is CompleteOwnPlayerInitialLevelReassessmentInput {
  return (
    isPlainRecord(value) &&
    hasExactlyKeys(value, ['accountId', 'role', 'completion']) &&
    isAccountId(value.accountId) &&
    isRole(value.role) &&
    readOwnPlayerInitialLevelReassessmentCompletion(value.completion) !==
      undefined
  );
}

export function isOwnPlayerInitialLevelReassessment(
  value: unknown,
): value is OwnPlayerInitialLevelReassessment {
  if (!isPlainRecord(value) || typeof value.status !== 'string') {
    return false;
  }
  if (value.status === 'not_eligible') {
    return hasExactlyKeys(value, ['status']);
  }
  if (value.status === 'completed') {
    return (
      hasExactlyKeys(value, ['status', 'surveyVersion', 'initialLevelLabel']) &&
      value.surveyVersion === PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION &&
      typeof value.initialLevelLabel === 'string' &&
      ['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'].includes(value.initialLevelLabel)
    );
  }
  return (
    value.status === 'required' &&
    hasExactlyKeys(value, ['status', 'source', 'surveyVersion']) &&
    value.surveyVersion === PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION &&
    isPlainRecord(value.source) &&
    hasExactlyKeys(value.source, [
      'flowVersion',
      'surveyVersion',
      'revision',
    ]) &&
    typeof value.source.flowVersion === 'string' &&
    FLOW_VERSION_PATTERN.test(value.source.flowVersion) &&
    value.source.surveyVersion === 'initial_level_v1' &&
    typeof value.source.revision === 'number' &&
    Number.isSafeInteger(value.source.revision) &&
    value.source.revision >= 1
  );
}
