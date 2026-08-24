import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import {
  PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION,
  type PlayerOnboardingInitialLevelLabel,
} from '../auth/player-onboarding-initial-level';
import { PostgresCodecError, decodePostgresBigint } from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import {
  PlayerOnboardingConsentKind,
  PlayerOnboardingConsentRecord,
  PlayerOnboardingReadPersistenceError,
  PlayerOnboardingReadPersistenceFailure,
  PlayerOnboardingReader,
  PlayerOnboardingRecord,
  PlayerOnboardingStateRecord,
  PlayerOnboardingStep,
  ReadPlayerOnboardingInput,
  ReadPlayerOnboardingResult,
} from './player-onboarding-reader';
import { PostgresTransaction } from './postgres-transaction';

const FIND_PLAYER_ONBOARDING_SQL = `
  SELECT
    details.account_id,
    details.first_name,
    details.last_name,
    details.phone,
    details.normalized_email,
    state.account_id AS state_account_id,
    state.flow_version,
    state.status,
    state.current_step,
    state.survey_version,
    state.survey_answers,
    state.initial_level_label,
    state.revision,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'kind', acceptance.consent_kind,
          'documentVersion', acceptance.document_version
        )
        ORDER BY acceptance.consent_kind, acceptance.document_version
      )
      FROM backend_auth.account_consent_acceptances AS acceptance
      WHERE acceptance.account_id = details.account_id
        AND acceptance.flow_version = state.flow_version
    ), '[]'::jsonb) AS consents
  FROM backend_auth.player_profile_details AS details
  LEFT JOIN backend_auth.player_onboarding_states AS state
    ON state.account_id = details.account_id
  WHERE details.account_id = $1
`;

const MAX_NAME_CODE_POINTS = 256;
const FLOW_VERSION_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;
const DOCUMENT_VERSION_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/u;
const ANSWER_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u;
const ONBOARDING_STATUSES = Object.freeze([
  'in_progress',
  'completed',
] as const);
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
const INITIAL_LEVEL_LABELS = Object.freeze([
  'D',
  'D+',
  'C',
  'C+',
  'B',
  'B+',
  'A',
] as const);

interface PlayerOnboardingRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly first_name: unknown;
  readonly last_name: unknown;
  readonly phone: unknown;
  readonly normalized_email: unknown;
  readonly state_account_id: unknown;
  readonly flow_version: unknown;
  readonly status: unknown;
  readonly current_step: unknown;
  readonly survey_version: unknown;
  readonly survey_answers: unknown;
  readonly initial_level_label: unknown;
  readonly revision: unknown;
  readonly consents: unknown;
}

function failure(
  reason: PlayerOnboardingReadPersistenceFailure,
): PlayerOnboardingReadPersistenceError {
  return new PlayerOnboardingReadPersistenceError(reason);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= maximum
  );
}

function readLastName(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (!isBoundedString(value, MAX_NAME_CODE_POINTS)) {
    throw failure('invalid_persisted_state');
  }
  return value;
}

function readPhone(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !PHONE_PATTERN.test(value)) {
    throw failure('invalid_persisted_state');
  }
  return value;
}

function readEmail(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== 'string' ||
    value.length > 320 ||
    !EMAIL_PATTERN.test(value)
  ) {
    throw failure('invalid_persisted_state');
  }
  return value;
}

function readSurveyAnswers(value: unknown): Readonly<Record<string, string>> {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length > 16 ||
    !Object.entries(value).every(
      ([question, answer]) =>
        ANSWER_CODE_PATTERN.test(question) &&
        typeof answer === 'string' &&
        ANSWER_CODE_PATTERN.test(answer),
    )
  ) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({ ...value }) as Readonly<Record<string, string>>;
}

function readConsents(
  value: unknown,
): readonly PlayerOnboardingConsentRecord[] {
  if (!Array.isArray(value)) {
    throw failure('invalid_persisted_state');
  }

  const consents: PlayerOnboardingConsentRecord[] = [];
  let previousKey: string | undefined;
  for (const consent of value) {
    if (
      !isPlainRecord(consent) ||
      Object.keys(consent).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(consent, 'kind') ||
      !Object.prototype.hasOwnProperty.call(consent, 'documentVersion') ||
      typeof consent.kind !== 'string' ||
      !CONSENT_KINDS.includes(consent.kind as (typeof CONSENT_KINDS)[number]) ||
      typeof consent.documentVersion !== 'string' ||
      !DOCUMENT_VERSION_PATTERN.test(consent.documentVersion)
    ) {
      throw failure('invalid_persisted_state');
    }
    const key = `${consent.kind}\u0000${consent.documentVersion}`;
    if (previousKey !== undefined && key <= previousKey) {
      throw failure('invalid_persisted_state');
    }
    previousKey = key;
    consents.push(
      Object.freeze({
        kind: consent.kind as PlayerOnboardingConsentKind,
        documentVersion: consent.documentVersion,
      }),
    );
  }
  return Object.freeze(consents);
}

function readState(
  row: PlayerOnboardingRow,
  expectedAccountId: ReadPlayerOnboardingInput['accountId'],
): PlayerOnboardingStateRecord | null {
  if (row.state_account_id === null) {
    if (
      row.flow_version !== null ||
      row.status !== null ||
      row.current_step !== null ||
      row.survey_version !== null ||
      row.survey_answers !== null ||
      row.initial_level_label !== null ||
      row.revision !== null
    ) {
      throw failure('invalid_persisted_state');
    }
    return null;
  }

  if (
    !isAccountId(row.state_account_id) ||
    row.state_account_id !== expectedAccountId ||
    typeof row.flow_version !== 'string' ||
    !FLOW_VERSION_PATTERN.test(row.flow_version) ||
    typeof row.status !== 'string' ||
    !ONBOARDING_STATUSES.includes(
      row.status as (typeof ONBOARDING_STATUSES)[number],
    ) ||
    typeof row.current_step !== 'string' ||
    !ONBOARDING_STEPS.includes(
      row.current_step as (typeof ONBOARDING_STEPS)[number],
    ) ||
    typeof row.survey_version !== 'string' ||
    !FLOW_VERSION_PATTERN.test(row.survey_version)
  ) {
    throw failure('invalid_persisted_state');
  }

  const revision = decodePostgresBigint(row.revision);
  const surveyAnswers = readSurveyAnswers(row.survey_answers);
  const exposesInitialLevel =
    row.status === 'completed' &&
    row.survey_version === PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION;
  const initialLevelLabel = exposesInitialLevel
    ? typeof row.initial_level_label === 'string' &&
      INITIAL_LEVEL_LABELS.includes(
        row.initial_level_label as PlayerOnboardingInitialLevelLabel,
      )
      ? (row.initial_level_label as PlayerOnboardingInitialLevelLabel)
      : undefined
    : row.initial_level_label === null
      ? null
      : undefined;
  if (
    revision < 1 ||
    initialLevelLabel === undefined ||
    (row.status === 'completed'
      ? row.current_step !== 'completed' ||
        Object.keys(surveyAnswers).length === 0
      : row.current_step === 'completed')
  ) {
    throw failure('invalid_persisted_state');
  }

  return Object.freeze({
    flowVersion: row.flow_version,
    status: row.status as PlayerOnboardingStateRecord['status'],
    currentStep: row.current_step as PlayerOnboardingStep,
    surveyVersion: row.survey_version,
    surveyAnswers,
    initialLevelLabel,
    revision,
  });
}

function hydrate(
  row: PlayerOnboardingRow,
  expectedAccountId: ReadPlayerOnboardingInput['accountId'],
): PlayerOnboardingRecord {
  try {
    if (
      !isAccountId(row.account_id) ||
      row.account_id !== expectedAccountId ||
      !isBoundedString(row.first_name, MAX_NAME_CODE_POINTS)
    ) {
      throw failure('invalid_persisted_state');
    }

    const state = readState(row, expectedAccountId);
    const consents = readConsents(row.consents);
    if (state === null && consents.length !== 0) {
      throw failure('invalid_persisted_state');
    }

    return Object.freeze({
      accountId: row.account_id,
      firstName: row.first_name,
      lastName: readLastName(row.last_name),
      phone: readPhone(row.phone),
      normalizedEmail: readEmail(row.normalized_email),
      state,
      consents,
    });
  } catch (error) {
    if (error instanceof PlayerOnboardingReadPersistenceError) {
      throw error;
    }
    if (error instanceof PostgresCodecError) {
      throw failure('invalid_persisted_state');
    }
    throw failure('invalid_persisted_state');
  }
}

function mapPersistenceError(
  error: unknown,
): PlayerOnboardingReadPersistenceError {
  if (error instanceof PlayerOnboardingReadPersistenceError) {
    return error;
  }

  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return failure('storage_failure');
  }

  switch (classified.category) {
    case 'insufficient_privilege':
      return failure('permission_denied');
    case 'serialization_failure':
    case 'deadlock_detected':
      return failure('transaction_conflict');
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled':
      return failure('database_unavailable');
    default:
      return failure('storage_failure');
  }
}

const NOT_FOUND: ReadPlayerOnboardingResult = Object.freeze({
  outcome: 'not_found',
});

export class PostgresPlayerOnboardingReader implements PlayerOnboardingReader {
  async findByAccountId(
    transaction: PostgresTransaction,
    input: ReadPlayerOnboardingInput,
  ): Promise<ReadPlayerOnboardingResult> {
    try {
      if (
        !isPlainRecord(input) ||
        Object.keys(input).length !== 1 ||
        !Object.prototype.hasOwnProperty.call(input, 'accountId') ||
        !isAccountId(input.accountId)
      ) {
        throw failure('invalid_input');
      }

      const selected = await transaction.query<PlayerOnboardingRow>(
        FIND_PLAYER_ONBOARDING_SQL,
        [input.accountId],
      );
      if (selected.rowCount === 0 && selected.rows.length === 0) {
        return NOT_FOUND;
      }
      if (selected.rowCount !== 1 || selected.rows.length !== 1) {
        throw failure('invalid_persisted_state');
      }

      return Object.freeze({
        outcome: 'found',
        onboarding: hydrate(selected.rows[0], input.accountId),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
