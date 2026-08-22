import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import { PostgresCodecError, decodePostgresBigint } from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import {
  AdvancePlayerOnboardingInput,
  AdvancePlayerOnboardingResult,
  PlayerOnboardingProgressPersistenceError,
  PlayerOnboardingProgressPersistenceFailure,
  PlayerOnboardingProgressWriter,
} from './player-onboarding-progress-writer';
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

const ADVANCE_TO_CONSENTS_SQL = `
  UPDATE backend_auth.player_onboarding_states
  SET
    current_step = 'consents',
    revision = revision + 1,
    updated_at = GREATEST(updated_at, $3::bigint)
  WHERE account_id = $1::uuid
    AND status = 'in_progress'
    AND revision = $2::bigint
    AND flow_version = $4::text
    AND current_step IN ('profile', 'contacts')
  RETURNING account_id, revision
`;

const ADVANCE_TO_LEVEL_SURVEY_SQL = `
  UPDATE backend_auth.player_onboarding_states
  SET
    current_step = 'level_survey',
    revision = revision + 1,
    updated_at = GREATEST(updated_at, $3::bigint)
  WHERE account_id = $1::uuid
    AND status = 'in_progress'
    AND revision = $2::bigint
    AND flow_version = $4::text
    AND current_step = 'consents'
  RETURNING account_id, revision
`;

const MAX_NAME_CODE_POINTS = 256;
const VERSION_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;
const DOCUMENT_VERSION_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/u;
const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u;
const CONSENT_KINDS = Object.freeze([
  'terms',
  'privacy',
  'cancellation',
] as const);
const ONBOARDING_STEPS = Object.freeze([
  'profile',
  'contacts',
  'consents',
  'level_survey',
  'completed',
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

interface AdvancedRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly revision: unknown;
}

interface ValidatedState {
  readonly status: 'in_progress' | 'completed';
  readonly currentStep: (typeof ONBOARDING_STEPS)[number];
  readonly flowVersion: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

function failure(
  reason: PlayerOnboardingProgressPersistenceFailure,
): PlayerOnboardingProgressPersistenceError {
  return new PlayerOnboardingProgressPersistenceError(reason);
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

function validateInput(value: unknown): AdvancePlayerOnboardingInput {
  if (
    !isPlainRecord(value) ||
    !hasExactlyKeys(value, [
      'accountId',
      'expectedRevision',
      'flowVersion',
      'nextStep',
      'consents',
      'advancedAt',
    ]) ||
    !isAccountId(value.accountId) ||
    typeof value.expectedRevision !== 'number' ||
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    typeof value.flowVersion !== 'string' ||
    !VERSION_PATTERN.test(value.flowVersion) ||
    (value.nextStep !== 'consents' && value.nextStep !== 'level_survey') ||
    !Array.isArray(value.consents) ||
    !isUnixEpochSeconds(value.advancedAt)
  ) {
    throw failure('invalid_input');
  }

  if (value.nextStep === 'consents') {
    if (value.consents.length !== 0) {
      throw failure('invalid_input');
    }
    return value as unknown as AdvancePlayerOnboardingInput;
  }

  if (value.consents.length !== CONSENT_KINDS.length) {
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
  return value as unknown as AdvancePlayerOnboardingInput;
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
  accountId: AdvancePlayerOnboardingInput['accountId'],
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

function readState(row: StateRow): ValidatedState {
  const revision = decodePostgresBigint(row.revision);
  const createdAt = decodePostgresBigint(row.created_at);
  const updatedAt = decodePostgresBigint(row.updated_at);
  if (
    revision < 1 ||
    createdAt < 0 ||
    updatedAt < createdAt ||
    typeof row.flow_version !== 'string' ||
    !VERSION_PATTERN.test(row.flow_version) ||
    typeof row.survey_version !== 'string' ||
    !VERSION_PATTERN.test(row.survey_version) ||
    (row.status !== 'in_progress' && row.status !== 'completed') ||
    typeof row.current_step !== 'string' ||
    !ONBOARDING_STEPS.includes(
      row.current_step as (typeof ONBOARDING_STEPS)[number],
    ) ||
    (row.status === 'in_progress' && row.completed_at !== null) ||
    (row.status === 'completed' && row.completed_at === null)
  ) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({
    status: row.status,
    currentStep: row.current_step as (typeof ONBOARDING_STEPS)[number],
    flowVersion: row.flow_version,
    revision,
    createdAt,
    updatedAt,
  });
}

function requiredConsentsPresent(
  rows: readonly ConsentRow[],
  input: AdvancePlayerOnboardingInput,
  createdAt: number,
  updatedAt: number,
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
    if (acceptedAt >= createdAt && acceptedAt <= updatedAt) {
      present.add(`${row.consent_kind}\u0000${row.document_version}`);
    }
  }
  return input.consents.every((consent) =>
    present.has(`${consent.kind}\u0000${consent.documentVersion}`),
  );
}

function mapPersistenceError(
  error: unknown,
): PlayerOnboardingProgressPersistenceError {
  if (error instanceof PlayerOnboardingProgressPersistenceError) {
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

const NOT_FOUND: AdvancePlayerOnboardingResult = Object.freeze({
  outcome: 'not_found',
});
const STALE_REVISION: AdvancePlayerOnboardingResult = Object.freeze({
  outcome: 'stale_revision',
});
const INCOMPLETE: AdvancePlayerOnboardingResult = Object.freeze({
  outcome: 'incomplete',
});
const CONFLICT: AdvancePlayerOnboardingResult = Object.freeze({
  outcome: 'conflict',
});
const CLOSED: AdvancePlayerOnboardingResult = Object.freeze({
  outcome: 'closed',
});

export class PostgresPlayerOnboardingProgressWriter implements PlayerOnboardingProgressWriter {
  async advance(
    transaction: PostgresTransaction,
    input: AdvancePlayerOnboardingInput,
  ): Promise<AdvancePlayerOnboardingResult> {
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
      const stateRow = oneRow(stateResult.rows, stateResult.rowCount);
      ownedAccount(stateRow.account_id, validated.accountId);
      const state = readState(stateRow);

      if (state.status === 'completed') {
        return CLOSED;
      }
      if (state.flowVersion !== validated.flowVersion) {
        return CONFLICT;
      }
      if (state.revision === validated.expectedRevision + 1) {
        if (state.currentStep !== validated.nextStep) {
          return CONFLICT;
        }
        if (validated.nextStep === 'level_survey') {
          const consents = await transaction.query<ConsentRow>(
            FIND_CONSENTS_SQL,
            [validated.accountId, validated.flowVersion],
          );
          if (
            !requiredConsentsPresent(
              consents.rows,
              validated,
              state.createdAt,
              state.updatedAt,
            )
          ) {
            return CONFLICT;
          }
        }
        return Object.freeze({
          outcome: 'advanced',
          revision: state.revision,
          replayed: true,
        });
      }
      if (state.revision !== validated.expectedRevision) {
        return STALE_REVISION;
      }

      const transitionAllowed =
        validated.nextStep === 'consents'
          ? state.currentStep === 'profile' || state.currentStep === 'contacts'
          : state.currentStep === 'consents';
      if (!transitionAllowed) {
        return CONFLICT;
      }
      if (!profileReady(profile)) {
        return INCOMPLETE;
      }

      const advancedAt = Math.max(state.updatedAt, validated.advancedAt);
      if (validated.nextStep === 'level_survey') {
        const consentParameters: unknown[] = [validated.accountId];
        for (const consent of validated.consents) {
          consentParameters.push(consent.kind, consent.documentVersion);
        }
        consentParameters.push(validated.flowVersion, advancedAt);
        await transaction.query(INSERT_CONSENTS_SQL, consentParameters);
      }

      const advanced = await transaction.query<AdvancedRow>(
        validated.nextStep === 'consents'
          ? ADVANCE_TO_CONSENTS_SQL
          : ADVANCE_TO_LEVEL_SURVEY_SQL,
        [
          validated.accountId,
          validated.expectedRevision,
          advancedAt,
          validated.flowVersion,
        ],
      );
      const advancedRow = oneRow(advanced.rows, advanced.rowCount);
      ownedAccount(advancedRow.account_id, validated.accountId);
      const revision = decodePostgresBigint(advancedRow.revision);
      if (revision !== validated.expectedRevision + 1) {
        throw failure('invalid_persisted_state');
      }
      return Object.freeze({ outcome: 'advanced', revision, replayed: false });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
