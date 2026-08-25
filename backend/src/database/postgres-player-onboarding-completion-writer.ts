import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION,
  PlayerOnboardingInitialLevelLabel,
  scorePlayerOnboardingInitialLevel,
} from '../auth/player-onboarding-initial-level';
import { PostgresCodecError, decodePostgresBigint } from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import {
  CompletePlayerOnboardingInput,
  CompletePlayerOnboardingResult,
  PlayerOnboardingCompletionPersistenceError,
  PlayerOnboardingCompletionPersistenceFailure,
  PlayerOnboardingCompletionWriter,
} from './player-onboarding-completion-writer';
import { PlayerOnboardingConsentKind } from './player-onboarding-reader';
import { PostgresTransaction } from './postgres-transaction';

const LOCK_PROFILE_SQL = `
  SELECT account_id, first_name, phone, normalized_email
  FROM backend_auth.player_profile_details
  WHERE account_id = $1::uuid
  FOR UPDATE
`;

const LOCK_STATE_SQL = `
  SELECT
    account_id,
    flow_version,
    status,
    current_step,
    survey_version,
    survey_answers,
    initial_level_score,
    initial_level_label,
    revision,
    created_at,
    updated_at,
    completed_at
  FROM backend_auth.player_onboarding_states
  WHERE account_id = $1::uuid
  FOR UPDATE
`;

const FIND_CONSENTS_SQL = `
  SELECT consent_kind, document_version, flow_version, accepted_at
  FROM backend_auth.account_consent_acceptances
  WHERE account_id = $1::uuid
    AND flow_version = $2::text
  ORDER BY consent_kind, document_version
`;

const INSERT_CONSENTS_SQL = `
  INSERT INTO backend_auth.account_consent_acceptances (
    account_id,
    consent_kind,
    document_version,
    flow_version,
    accepted_at
  )
  VALUES
    ($1::uuid, $2::text, $3::text, $8::text, $9::bigint),
    ($1::uuid, $4::text, $5::text, $8::text, $9::bigint),
    ($1::uuid, $6::text, $7::text, $8::text, $9::bigint)
  ON CONFLICT (account_id, consent_kind, document_version) DO NOTHING
`;

const COMPLETE_STATE_SQL = `
  UPDATE backend_auth.player_onboarding_states
  SET
    status = 'completed',
    current_step = 'completed',
    survey_answers = $3::jsonb,
    initial_level_score = $7::smallint,
    initial_level_label = $8::text,
    revision = revision + 1,
    updated_at = GREATEST(updated_at, $4::bigint),
    completed_at = GREATEST(updated_at, $4::bigint)
  WHERE account_id = $1::uuid
    AND status = 'in_progress'
    AND current_step = 'level_survey'
    AND revision = $2::bigint
    AND flow_version = $5::text
    AND survey_version = $6::text
  RETURNING account_id, revision, initial_level_score, initial_level_label
`;

const MAX_NAME_CODE_POINTS = 256;
const VERSION_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;
const DOCUMENT_VERSION_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/u;
const ANSWER_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u;
const CONSENT_KINDS = Object.freeze([
  'terms',
  'cancellation',
  'personal_data_processing',
] as const);

interface ProfileRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly first_name: unknown;
  readonly phone: unknown;
  readonly normalized_email: unknown;
}

interface StateRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly flow_version: unknown;
  readonly status: unknown;
  readonly current_step: unknown;
  readonly survey_version: unknown;
  readonly survey_answers: unknown;
  readonly initial_level_score: unknown;
  readonly initial_level_label: unknown;
  readonly revision: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly completed_at: unknown;
}

interface ConsentRow extends QueryResultRow {
  readonly consent_kind: unknown;
  readonly document_version: unknown;
  readonly flow_version: unknown;
  readonly accepted_at: unknown;
}

interface CompletedRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly revision: unknown;
  readonly initial_level_score: unknown;
  readonly initial_level_label: unknown;
}

interface ValidatedCompletionInput extends CompletePlayerOnboardingInput {
  readonly initialLevelScore: number;
  readonly initialLevelLabel: PlayerOnboardingInitialLevelLabel;
}

function failure(
  reason: PlayerOnboardingCompletionPersistenceFailure,
): PlayerOnboardingCompletionPersistenceError {
  return new PlayerOnboardingCompletionPersistenceError(reason);
}

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

function validAnswers(
  value: unknown,
): value is Readonly<Record<string, string>> {
  return (
    isPlainRecord(value) &&
    Object.keys(value).length >= 1 &&
    Object.keys(value).length <= 16 &&
    Object.entries(value).every(
      ([question, answer]) =>
        ANSWER_CODE_PATTERN.test(question) &&
        typeof answer === 'string' &&
        ANSWER_CODE_PATTERN.test(answer),
    )
  );
}

function validateInput(value: unknown): ValidatedCompletionInput {
  if (
    !isPlainRecord(value) ||
    !hasExactlyKeys(value, [
      'accountId',
      'expectedRevision',
      'flowVersion',
      'consents',
      'surveyVersion',
      'surveyAnswers',
      'completedAt',
    ]) ||
    !isAccountId(value.accountId) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    typeof value.flowVersion !== 'string' ||
    !VERSION_PATTERN.test(value.flowVersion) ||
    !Array.isArray(value.consents) ||
    value.consents.length !== CONSENT_KINDS.length ||
    typeof value.surveyVersion !== 'string' ||
    !VERSION_PATTERN.test(value.surveyVersion) ||
    value.surveyVersion !== PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION ||
    !validAnswers(value.surveyAnswers) ||
    !isUnixEpochSeconds(value.completedAt)
  ) {
    throw failure('invalid_input');
  }

  const kinds = new Set<PlayerOnboardingConsentKind>();
  for (const consent of value.consents) {
    if (
      !isPlainRecord(consent) ||
      !hasExactlyKeys(consent, ['kind', 'documentVersion']) ||
      typeof consent.kind !== 'string' ||
      !CONSENT_KINDS.includes(consent.kind as (typeof CONSENT_KINDS)[number]) ||
      kinds.has(consent.kind as PlayerOnboardingConsentKind) ||
      typeof consent.documentVersion !== 'string' ||
      !DOCUMENT_VERSION_PATTERN.test(consent.documentVersion)
    ) {
      throw failure('invalid_input');
    }
    kinds.add(consent.kind as PlayerOnboardingConsentKind);
  }

  const result = scorePlayerOnboardingInitialLevel(value.surveyAnswers);
  if (result === undefined) {
    throw failure('invalid_input');
  }
  return Object.freeze({
    ...(value as unknown as CompletePlayerOnboardingInput),
    initialLevelScore: result.score,
    initialLevelLabel: result.label,
  });
}

function oneRow<Row extends QueryResultRow>(
  rows: readonly Row[],
  rowCount: number | null,
): Row {
  if (rowCount !== 1 || rows.length !== 1) {
    throw failure('invalid_persisted_state');
  }
  return rows[0];
}

function ownedAccount(
  value: unknown,
  accountId: CompletePlayerOnboardingInput['accountId'],
): void {
  if (!isAccountId(value) || value !== accountId) {
    throw failure('invalid_persisted_state');
  }
}

function profileReady(row: ProfileRow): boolean {
  return (
    typeof row.first_name === 'string' &&
    row.first_name.trim() === row.first_name &&
    row.first_name.length > 0 &&
    [...row.first_name].length <= MAX_NAME_CODE_POINTS &&
    typeof row.phone === 'string' &&
    PHONE_PATTERN.test(row.phone) &&
    typeof row.normalized_email === 'string' &&
    row.normalized_email.length <= 320 &&
    row.normalized_email.trim() === row.normalized_email &&
    row.normalized_email.toLowerCase() === row.normalized_email &&
    EMAIL_PATTERN.test(row.normalized_email)
  );
}

function sameAnswers(
  persisted: unknown,
  expected: Readonly<Record<string, string>>,
): boolean {
  if (!validAnswers(persisted)) {
    throw failure('invalid_persisted_state');
  }
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const persistedEntries = Object.entries(persisted).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return (
    expectedEntries.length === persistedEntries.length &&
    expectedEntries.every(
      ([question, answer], index) =>
        persistedEntries[index][0] === question &&
        persistedEntries[index][1] === answer,
    )
  );
}

function initialLevelResult(
  scoreValue: unknown,
  labelValue: unknown,
): Readonly<{
  score: number;
  label: PlayerOnboardingInitialLevelLabel;
}> {
  if (
    typeof scoreValue !== 'number' ||
    !Number.isSafeInteger(scoreValue) ||
    scoreValue < 0 ||
    scoreValue > 20 ||
    !['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'].includes(labelValue as string)
  ) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({
    score: scoreValue,
    label: labelValue as PlayerOnboardingInitialLevelLabel,
  });
}

function requiredConsentsPresent(
  rows: readonly ConsentRow[],
  input: CompletePlayerOnboardingInput,
  createdAt: number,
  completedAt: number,
): boolean {
  const present = new Set<string>();
  for (const row of rows) {
    if (
      typeof row.consent_kind !== 'string' ||
      !CONSENT_KINDS.includes(
        row.consent_kind as (typeof CONSENT_KINDS)[number],
      ) ||
      typeof row.document_version !== 'string' ||
      !DOCUMENT_VERSION_PATTERN.test(row.document_version) ||
      row.flow_version !== input.flowVersion
    ) {
      throw failure('invalid_persisted_state');
    }
    const acceptedAt = decodePostgresBigint(row.accepted_at);
    if (acceptedAt >= createdAt && acceptedAt <= completedAt) {
      present.add(`${row.consent_kind}\u0000${row.document_version}`);
    }
  }
  return input.consents.every((consent) =>
    present.has(`${consent.kind}\u0000${consent.documentVersion}`),
  );
}

function mapPersistenceError(
  error: unknown,
): PlayerOnboardingCompletionPersistenceError {
  if (error instanceof PlayerOnboardingCompletionPersistenceError) {
    return error;
  }
  if (error instanceof PostgresCodecError) {
    return failure('invalid_persisted_state');
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
    case 'unique_violation':
      return failure('transaction_conflict');
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled':
      return failure('database_unavailable');
    default:
      return failure('storage_failure');
  }
}

const NOT_FOUND: CompletePlayerOnboardingResult = Object.freeze({
  outcome: 'not_found',
});
const STALE_REVISION: CompletePlayerOnboardingResult = Object.freeze({
  outcome: 'stale_revision',
});
const INCOMPLETE: CompletePlayerOnboardingResult = Object.freeze({
  outcome: 'incomplete',
});
const CONFLICT: CompletePlayerOnboardingResult = Object.freeze({
  outcome: 'conflict',
});

export class PostgresPlayerOnboardingCompletionWriter implements PlayerOnboardingCompletionWriter {
  async complete(
    transaction: PostgresTransaction,
    input: CompletePlayerOnboardingInput,
  ): Promise<CompletePlayerOnboardingResult> {
    try {
      const validated = validateInput(input);
      const profileResult = await transaction.query<ProfileRow>(
        LOCK_PROFILE_SQL,
        [validated.accountId],
      );
      if (profileResult.rowCount === 0 && profileResult.rows.length === 0) {
        return NOT_FOUND;
      }
      const profile = oneRow(profileResult.rows, profileResult.rowCount);
      ownedAccount(profile.account_id, validated.accountId);

      const stateResult = await transaction.query<StateRow>(LOCK_STATE_SQL, [
        validated.accountId,
      ]);
      if (stateResult.rowCount === 0 && stateResult.rows.length === 0) {
        return INCOMPLETE;
      }
      const state = oneRow(stateResult.rows, stateResult.rowCount);
      ownedAccount(state.account_id, validated.accountId);
      const revision = decodePostgresBigint(state.revision);
      const createdAt = decodePostgresBigint(state.created_at);
      const updatedAt = decodePostgresBigint(state.updated_at);
      if (
        revision < 1 ||
        createdAt < 0 ||
        updatedAt < createdAt ||
        typeof state.flow_version !== 'string' ||
        !VERSION_PATTERN.test(state.flow_version) ||
        typeof state.survey_version !== 'string' ||
        !VERSION_PATTERN.test(state.survey_version)
      ) {
        throw failure('invalid_persisted_state');
      }

      if (state.status === 'completed') {
        const completedAt = decodePostgresBigint(state.completed_at);
        if (
          completedAt < updatedAt ||
          revision !== validated.expectedRevision + 1 ||
          state.current_step !== 'completed' ||
          state.flow_version !== validated.flowVersion ||
          state.survey_version !== validated.surveyVersion ||
          !sameAnswers(state.survey_answers, validated.surveyAnswers)
        ) {
          return CONFLICT;
        }
        const persistedInitialLevel = initialLevelResult(
          state.initial_level_score,
          state.initial_level_label,
        );
        if (
          persistedInitialLevel.score !== validated.initialLevelScore ||
          persistedInitialLevel.label !== validated.initialLevelLabel
        ) {
          return CONFLICT;
        }
        const consents = await transaction.query<ConsentRow>(
          FIND_CONSENTS_SQL,
          [validated.accountId, validated.flowVersion],
        );
        if (
          !requiredConsentsPresent(
            consents.rows,
            validated,
            createdAt,
            completedAt,
          )
        ) {
          return CONFLICT;
        }
        return Object.freeze({
          outcome: 'completed',
          revision,
          replayed: true,
          initialLevelScore: persistedInitialLevel.score,
          initialLevelLabel: persistedInitialLevel.label,
        });
      }

      if (
        state.status !== 'in_progress' ||
        state.completed_at !== null ||
        state.initial_level_score !== null ||
        state.initial_level_label !== null
      ) {
        throw failure('invalid_persisted_state');
      }
      if (revision !== validated.expectedRevision) {
        return STALE_REVISION;
      }
      if (
        state.flow_version !== validated.flowVersion ||
        state.survey_version !== validated.surveyVersion
      ) {
        return CONFLICT;
      }
      if (state.current_step !== 'level_survey' || !profileReady(profile)) {
        return INCOMPLETE;
      }

      const completedAt = Math.max(updatedAt, validated.completedAt);
      const consentParameters: unknown[] = [validated.accountId];
      for (const consent of validated.consents) {
        consentParameters.push(consent.kind, consent.documentVersion);
      }
      consentParameters.push(validated.flowVersion, completedAt);
      await transaction.query(INSERT_CONSENTS_SQL, consentParameters);

      const completed = await transaction.query<CompletedRow>(
        COMPLETE_STATE_SQL,
        [
          validated.accountId,
          validated.expectedRevision,
          validated.surveyAnswers,
          completedAt,
          validated.flowVersion,
          validated.surveyVersion,
          validated.initialLevelScore,
          validated.initialLevelLabel,
        ],
      );
      const completedRow = oneRow(completed.rows, completed.rowCount);
      ownedAccount(completedRow.account_id, validated.accountId);
      const completedRevision = decodePostgresBigint(completedRow.revision);
      const persistedInitialLevel = initialLevelResult(
        completedRow.initial_level_score,
        completedRow.initial_level_label,
      );
      if (
        completedRevision !== validated.expectedRevision + 1 ||
        persistedInitialLevel.score !== validated.initialLevelScore ||
        persistedInitialLevel.label !== validated.initialLevelLabel
      ) {
        throw failure('invalid_persisted_state');
      }
      return Object.freeze({
        outcome: 'completed',
        revision: completedRevision,
        replayed: false,
        initialLevelScore: persistedInitialLevel.score,
        initialLevelLabel: persistedInitialLevel.label,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
