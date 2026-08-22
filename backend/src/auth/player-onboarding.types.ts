import { AccountId, UserRole, isAccountId } from '../accounts/account.types';
import {
  PlayerOnboardingConsentKind,
  PlayerOnboardingStep,
} from '../database/player-onboarding-reader';

export interface ReadOwnPlayerOnboardingInput {
  readonly accountId: AccountId;
  readonly role: UserRole;
}

export interface OwnPlayerOnboardingDraft {
  readonly expectedRevision: number | null;
  readonly profile: Readonly<{
    readonly firstName: string;
    readonly lastName: string | null;
  }>;
  readonly contacts: Readonly<{
    readonly phone: string | null;
    readonly email: string | null;
  }>;
}

export interface SaveOwnPlayerOnboardingDraftInput {
  readonly accountId: AccountId;
  readonly role: UserRole;
  readonly draft: OwnPlayerOnboardingDraft;
}

export type OwnPlayerOnboardingProgress =
  | Readonly<{
      readonly expectedRevision: number;
      readonly flowVersion: string;
      readonly nextStep: 'consents';
    }>
  | Readonly<{
      readonly expectedRevision: number;
      readonly flowVersion: string;
      readonly nextStep: 'level_survey';
      readonly consents: readonly OwnPlayerOnboardingConsent[];
    }>;

export interface AdvanceOwnPlayerOnboardingInput {
  readonly accountId: AccountId;
  readonly role: UserRole;
  readonly progress: OwnPlayerOnboardingProgress;
}

export interface OwnPlayerOnboardingCompletion {
  readonly expectedRevision: number;
  readonly flowVersion: string;
  readonly consents: readonly OwnPlayerOnboardingConsent[];
  readonly survey: Readonly<{
    readonly version: string;
    readonly answers: Readonly<Record<string, string>>;
  }>;
}

export interface CompleteOwnPlayerOnboardingInput {
  readonly accountId: AccountId;
  readonly role: UserRole;
  readonly completion: OwnPlayerOnboardingCompletion;
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

export type SaveOwnPlayerOnboardingDraftResult =
  | {
      readonly outcome: 'saved';
      readonly onboarding: OwnPlayerOnboarding;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'invalid_request'
        | 'onboarding_not_found'
        | 'stale_revision'
        | 'onboarding_closed'
        | 'content_not_allowed'
        | 'temporary_unavailable'
        | 'internal_failure';
    };

export type AdvanceOwnPlayerOnboardingResult =
  | {
      readonly outcome: 'advanced';
      readonly onboarding: OwnPlayerOnboarding;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'invalid_request'
        | 'onboarding_not_found'
        | 'stale_revision'
        | 'onboarding_incomplete'
        | 'progress_conflict'
        | 'onboarding_closed'
        | 'temporary_unavailable'
        | 'internal_failure';
    };

export type CompleteOwnPlayerOnboardingResult =
  | {
      readonly outcome: 'completed';
      readonly onboarding: OwnPlayerOnboarding;
    }
  | {
      readonly outcome: 'rejected';
      readonly reason:
        | 'invalid_request'
        | 'onboarding_not_found'
        | 'stale_revision'
        | 'onboarding_incomplete'
        | 'completion_conflict'
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

function isDraftName(value: unknown): value is string {
  return isBoundedString(value, 256) && value.trim() === value;
}

function isDraftProfile(
  value: unknown,
): value is OwnPlayerOnboardingDraft['profile'] {
  return (
    isPlainRecord(value) &&
    hasExactlyKeys(value, ['firstName', 'lastName']) &&
    isDraftName(value.firstName) &&
    (value.lastName === null || isDraftName(value.lastName))
  );
}

function isDraftContacts(
  value: unknown,
): value is OwnPlayerOnboardingDraft['contacts'] {
  return (
    isPlainRecord(value) &&
    hasExactlyKeys(value, ['phone', 'email']) &&
    (value.phone === null ||
      (typeof value.phone === 'string' && PHONE_PATTERN.test(value.phone))) &&
    (value.email === null ||
      (typeof value.email === 'string' &&
        value.email.length <= 512 &&
        value.email.trim().length > 0))
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

export function readOwnPlayerOnboardingDraft(
  value: unknown,
): OwnPlayerOnboardingDraft | undefined {
  if (
    !isPlainRecord(value) ||
    !hasExactlyKeys(value, ['expectedRevision', 'profile', 'contacts']) ||
    !(
      value.expectedRevision === null ||
      (typeof value.expectedRevision === 'number' &&
        Number.isSafeInteger(value.expectedRevision) &&
        value.expectedRevision >= 1)
    ) ||
    !isDraftProfile(value.profile) ||
    !isDraftContacts(value.contacts)
  ) {
    return undefined;
  }

  return Object.freeze({
    expectedRevision: value.expectedRevision,
    profile: Object.freeze({
      firstName: value.profile.firstName,
      lastName: value.profile.lastName,
    }),
    contacts: Object.freeze({
      phone: value.contacts.phone,
      email: value.contacts.email,
    }),
  });
}

export function readOwnPlayerOnboardingProgress(
  value: unknown,
): OwnPlayerOnboardingProgress | undefined {
  if (
    !isPlainRecord(value) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    typeof value.flowVersion !== 'string' ||
    !FLOW_VERSION_PATTERN.test(value.flowVersion)
  ) {
    return undefined;
  }

  if (
    value.nextStep === 'consents' &&
    hasExactlyKeys(value, ['expectedRevision', 'flowVersion', 'nextStep'])
  ) {
    return Object.freeze({
      expectedRevision: value.expectedRevision,
      flowVersion: value.flowVersion,
      nextStep: 'consents',
    });
  }

  if (
    value.nextStep !== 'level_survey' ||
    !hasExactlyKeys(value, [
      'expectedRevision',
      'flowVersion',
      'nextStep',
      'consents',
    ]) ||
    !isConsents(value.consents) ||
    value.consents.length !== CONSENT_KINDS.length ||
    new Set(value.consents.map((consent) => consent.kind)).size !==
      CONSENT_KINDS.length
  ) {
    return undefined;
  }

  const consents = [...value.consents]
    .sort((left, right) => left.kind.localeCompare(right.kind))
    .map((consent) =>
      Object.freeze({
        kind: consent.kind,
        documentVersion: consent.documentVersion,
      }),
    );
  return Object.freeze({
    expectedRevision: value.expectedRevision,
    flowVersion: value.flowVersion,
    nextStep: 'level_survey',
    consents: Object.freeze(consents),
  });
}

function readCompletionSurvey(
  value: unknown,
): OwnPlayerOnboardingCompletion['survey'] | undefined {
  if (
    !isPlainRecord(value) ||
    !hasExactlyKeys(value, ['version', 'answers']) ||
    typeof value.version !== 'string' ||
    !FLOW_VERSION_PATTERN.test(value.version) ||
    !isSurveyAnswers(value.answers) ||
    Object.keys(value.answers).length === 0
  ) {
    return undefined;
  }

  return Object.freeze({
    version: value.version,
    answers: Object.freeze(
      Object.fromEntries(
        Object.entries(value.answers).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    ),
  });
}

export function readOwnPlayerOnboardingCompletion(
  value: unknown,
): OwnPlayerOnboardingCompletion | undefined {
  if (
    !isPlainRecord(value) ||
    !hasExactlyKeys(value, [
      'expectedRevision',
      'flowVersion',
      'consents',
      'survey',
    ]) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    typeof value.flowVersion !== 'string' ||
    !FLOW_VERSION_PATTERN.test(value.flowVersion) ||
    !isConsents(value.consents) ||
    value.consents.length !== CONSENT_KINDS.length ||
    new Set(value.consents.map((consent) => consent.kind)).size !==
      CONSENT_KINDS.length
  ) {
    return undefined;
  }

  const survey = readCompletionSurvey(value.survey);
  if (survey === undefined) {
    return undefined;
  }
  const consents = [...value.consents]
    .sort((left, right) => left.kind.localeCompare(right.kind))
    .map((consent) =>
      Object.freeze({
        kind: consent.kind,
        documentVersion: consent.documentVersion,
      }),
    );

  return Object.freeze({
    expectedRevision: value.expectedRevision,
    flowVersion: value.flowVersion,
    consents: Object.freeze(consents),
    survey,
  });
}

export function isSaveOwnPlayerOnboardingDraftInput(
  value: unknown,
): value is SaveOwnPlayerOnboardingDraftInput {
  return (
    isPlainRecord(value) &&
    hasExactlyKeys(value, ['accountId', 'role', 'draft']) &&
    isAccountId(value.accountId) &&
    (value.role === 'player' || value.role === 'club_admin') &&
    readOwnPlayerOnboardingDraft(value.draft) !== undefined
  );
}

export function isAdvanceOwnPlayerOnboardingInput(
  value: unknown,
): value is AdvanceOwnPlayerOnboardingInput {
  return (
    isPlainRecord(value) &&
    hasExactlyKeys(value, ['accountId', 'role', 'progress']) &&
    isAccountId(value.accountId) &&
    (value.role === 'player' || value.role === 'club_admin') &&
    readOwnPlayerOnboardingProgress(value.progress) !== undefined
  );
}

export function isCompleteOwnPlayerOnboardingInput(
  value: unknown,
): value is CompleteOwnPlayerOnboardingInput {
  return (
    isPlainRecord(value) &&
    hasExactlyKeys(value, ['accountId', 'role', 'completion']) &&
    isAccountId(value.accountId) &&
    (value.role === 'player' || value.role === 'club_admin') &&
    readOwnPlayerOnboardingCompletion(value.completion) !== undefined
  );
}
