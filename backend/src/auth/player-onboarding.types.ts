import { AccountId, UserRole, isAccountId } from '../accounts/account.types';
import {
  PlayerOnboardingConsentKind,
  PlayerOnboardingStep,
} from '../database/player-onboarding-reader';

export interface ReadOwnPlayerOnboardingInput {
  readonly accountId: AccountId;
  readonly role: UserRole;
}

export interface OwnPlayerOnboardingConsent {
  readonly kind: PlayerOnboardingConsentKind;
  readonly documentVersion: string;
}

export interface OwnPlayerOnboarding {
  readonly status: 'required' | 'in_progress' | 'completed';
  readonly flowVersion: string | null;
  readonly currentStep: PlayerOnboardingStep;
  readonly surveyVersion: string | null;
  readonly revision: number | null;
  readonly profile: Readonly<{
    readonly firstName: string;
    readonly lastName: string | null;
  }>;
  readonly contacts: Readonly<{
    readonly phone: string | null;
    readonly normalizedEmail: string | null;
    readonly assurance: 'declared';
  }>;
  readonly consents: readonly OwnPlayerOnboardingConsent[];
  readonly surveyAnswers: Readonly<Record<string, string>>;
}

export type ReadOwnPlayerOnboardingResult =
  | {
      readonly outcome: 'found';
      readonly onboarding: OwnPlayerOnboarding;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'invalid_request'
        | 'onboarding_not_found'
        | 'temporary_unavailable'
        | 'internal_failure';
    };

const FLOW_VERSION_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;
const DOCUMENT_VERSION_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/u;
const ANSWER_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u;
const ONBOARDING_STEPS = Object.freeze([
  'profile',
  'contacts',
  'consents',
  'level_survey',
  'completed',
] as const);
const CONSENT_KINDS = Object.freeze([
  'terms',
  'privacy',
  'cancellation',
] as const);

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

function isBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= maximum
  );
}

function isProfile(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasExactlyKeys(value, ['firstName', 'lastName']) &&
    isBoundedString(value.firstName, 256) &&
    (value.lastName === null || isBoundedString(value.lastName, 256))
  );
}

function isContacts(value: unknown): boolean {
  return (
    isPlainRecord(value) &&
    hasExactlyKeys(value, ['phone', 'normalizedEmail', 'assurance']) &&
    (value.phone === null ||
      (typeof value.phone === 'string' && PHONE_PATTERN.test(value.phone))) &&
    (value.normalizedEmail === null ||
      (typeof value.normalizedEmail === 'string' &&
        value.normalizedEmail.length <= 320 &&
        EMAIL_PATTERN.test(value.normalizedEmail))) &&
    value.assurance === 'declared'
  );
}

function isConsents(
  value: unknown,
): value is readonly OwnPlayerOnboardingConsent[] {
  return (
    Array.isArray(value) &&
    value.every(
      (consent) =>
        isPlainRecord(consent) &&
        hasExactlyKeys(consent, ['kind', 'documentVersion']) &&
        typeof consent.kind === 'string' &&
        CONSENT_KINDS.includes(
          consent.kind as (typeof CONSENT_KINDS)[number],
        ) &&
        typeof consent.documentVersion === 'string' &&
        DOCUMENT_VERSION_PATTERN.test(consent.documentVersion),
    )
  );
}

function isSurveyAnswers(value: unknown): value is Record<string, string> {
  return (
    isPlainRecord(value) &&
    Object.keys(value).length <= 16 &&
    Object.entries(value).every(
      ([question, answer]) =>
        ANSWER_CODE_PATTERN.test(question) &&
        typeof answer === 'string' &&
        ANSWER_CODE_PATTERN.test(answer),
    )
  );
}

export function isOwnPlayerOnboarding(
  value: unknown,
): value is OwnPlayerOnboarding {
  if (
    !isPlainRecord(value) ||
    !hasExactlyKeys(value, [
      'status',
      'flowVersion',
      'currentStep',
      'surveyVersion',
      'revision',
      'profile',
      'contacts',
      'consents',
      'surveyAnswers',
    ]) ||
    !['required', 'in_progress', 'completed'].includes(
      value.status as string,
    ) ||
    typeof value.currentStep !== 'string' ||
    !ONBOARDING_STEPS.includes(
      value.currentStep as (typeof ONBOARDING_STEPS)[number],
    ) ||
    !isProfile(value.profile) ||
    !isContacts(value.contacts) ||
    !isConsents(value.consents) ||
    !isSurveyAnswers(value.surveyAnswers)
  ) {
    return false;
  }

  if (value.status === 'required') {
    return (
      value.flowVersion === null &&
      value.currentStep === 'profile' &&
      value.surveyVersion === null &&
      value.revision === null &&
      value.consents.length === 0 &&
      Object.keys(value.surveyAnswers).length === 0
    );
  }

  return (
    typeof value.flowVersion === 'string' &&
    FLOW_VERSION_PATTERN.test(value.flowVersion) &&
    typeof value.surveyVersion === 'string' &&
    FLOW_VERSION_PATTERN.test(value.surveyVersion) &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 1 &&
    (value.status === 'completed'
      ? value.currentStep === 'completed' &&
        Object.keys(value.surveyAnswers).length > 0
      : value.currentStep !== 'completed')
  );
}

export function isReadOwnPlayerOnboardingInput(
  value: unknown,
): value is ReadOwnPlayerOnboardingInput {
  return (
    isPlainRecord(value) &&
    hasExactlyKeys(value, ['accountId', 'role']) &&
    isAccountId(value.accountId) &&
    (value.role === 'player' || value.role === 'club_admin')
  );
}
