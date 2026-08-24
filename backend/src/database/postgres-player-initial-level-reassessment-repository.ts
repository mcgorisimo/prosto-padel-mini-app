import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION,
  PlayerOnboardingInitialLevelLabel,
  scorePlayerOnboardingInitialLevel,
} from '../auth/player-onboarding-initial-level';
import {
  CompletePlayerInitialLevelReassessmentInput,
  CompletePlayerInitialLevelReassessmentResult,
  PlayerInitialLevelReassessmentPersistenceError,
  PlayerInitialLevelReassessmentPersistenceFailure,
  PlayerInitialLevelReassessmentRepository,
  PlayerInitialLevelReassessmentSource,
  PlayerInitialLevelReassessmentState,
  ReadPlayerInitialLevelReassessmentInput,
} from './player-initial-level-reassessment-repository';
import { PostgresCodecError, decodePostgresBigint } from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';

const READ_STATE_SQL = `
  SELECT
    source.account_id,
    source.flow_version,
    source.status,
    source.current_step,
    source.survey_version,
    source.revision,
    source.completed_at AS source_completed_at,
    reassessment.account_id AS reassessment_account_id,
    reassessment.source_flow_version,
    reassessment.source_survey_version,
    reassessment.source_revision,
    reassessment.survey_version AS reassessment_survey_version,
    reassessment.survey_answers,
    reassessment.initial_level_score,
    reassessment.initial_level_label
  FROM backend_auth.player_onboarding_states AS source
  LEFT JOIN backend_auth.player_initial_level_reassessments AS reassessment
    ON reassessment.account_id = source.account_id
  WHERE source.account_id = $1
`;

const LOCK_SOURCE_SQL = `
  SELECT
    account_id,
    flow_version,
    status,
    current_step,
    survey_version,
    revision,
    completed_at
  FROM backend_auth.player_onboarding_states
  WHERE account_id = $1
  FOR UPDATE
`;

const FIND_REASSESSMENT_SQL = `
  SELECT
    account_id,
    source_flow_version,
    source_survey_version,
    source_revision,
    survey_version,
    survey_answers,
    initial_level_score,
    initial_level_label
  FROM backend_auth.player_initial_level_reassessments
  WHERE account_id = $1
`;

const INSERT_REASSESSMENT_SQL = `
  INSERT INTO backend_auth.player_initial_level_reassessments (
    account_id,
    source_flow_version,
    source_survey_version,
    source_revision,
    survey_version,
    survey_answers,
    initial_level_score,
    initial_level_label,
    completed_at
  ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
  ON CONFLICT (account_id) DO NOTHING
  RETURNING
    account_id,
    source_flow_version,
    source_survey_version,
    source_revision,
    survey_version,
    survey_answers,
    initial_level_score,
    initial_level_label
`;

const FLOW_VERSION_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;
const LABELS = Object.freeze(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A'] as const);

interface SourceRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly flow_version: unknown;
  readonly status: unknown;
  readonly current_step: unknown;
  readonly survey_version: unknown;
  readonly revision: unknown;
  readonly completed_at: unknown;
}

interface ReassessmentRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly source_flow_version: unknown;
  readonly source_survey_version: unknown;
  readonly source_revision: unknown;
  readonly survey_version: unknown;
  readonly survey_answers: unknown;
  readonly initial_level_score: unknown;
  readonly initial_level_label: unknown;
}

interface ReadStateRow extends SourceRow {
  readonly source_completed_at: unknown;
  readonly reassessment_account_id: unknown;
  readonly source_flow_version: unknown;
  readonly source_survey_version: unknown;
  readonly source_revision: unknown;
  readonly reassessment_survey_version: unknown;
  readonly survey_answers: unknown;
  readonly initial_level_score: unknown;
  readonly initial_level_label: unknown;
}

function failure(
  reason: PlayerInitialLevelReassessmentPersistenceFailure,
): PlayerInitialLevelReassessmentPersistenceError {
  return new PlayerInitialLevelReassessmentPersistenceError(reason);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validInputAnswers(
  value: unknown,
): value is Readonly<Record<string, string>> {
  return (
    isPlainRecord(value) &&
    scorePlayerOnboardingInitialLevel(value as Record<string, string>) !==
      undefined
  );
}

function copyAnswers(value: unknown): Readonly<Record<string, string>> {
  if (!validInputAnswers(value)) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function sameAnswers(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const rightEntries = Object.entries(right).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([question, answer], index) =>
        rightEntries[index][0] === question &&
        rightEntries[index][1] === answer,
    )
  );
}

function sourceFromRow(
  row: SourceRow,
  accountId: ReadPlayerInitialLevelReassessmentInput['accountId'],
):
  | Readonly<{
      source: PlayerInitialLevelReassessmentSource;
      completedAt: number;
    }>
  | undefined {
  if (!isAccountId(row.account_id) || row.account_id !== accountId) {
    throw failure('invalid_persisted_state');
  }
  if (
    row.status !== 'completed' ||
    row.current_step !== 'completed' ||
    row.survey_version !== 'initial_level_v1'
  ) {
    return undefined;
  }
  if (
    typeof row.flow_version !== 'string' ||
    !FLOW_VERSION_PATTERN.test(row.flow_version)
  ) {
    throw failure('invalid_persisted_state');
  }
  const revision = decodePostgresBigint(row.revision);
  const completedAt = decodePostgresBigint(row.completed_at);
  if (revision < 1 || completedAt < 0) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({
    source: Object.freeze({
      flowVersion: row.flow_version,
      surveyVersion: 'initial_level_v1' as const,
      revision,
    }),
    completedAt,
  });
}

function initialLevelResult(
  score: unknown,
  label: unknown,
): Readonly<{
  score: number;
  label: PlayerOnboardingInitialLevelLabel;
}> {
  if (
    typeof score !== 'number' ||
    !Number.isSafeInteger(score) ||
    score < 0 ||
    score > 20 ||
    typeof label !== 'string' ||
    !LABELS.includes(label as (typeof LABELS)[number])
  ) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({
    score,
    label: label as PlayerOnboardingInitialLevelLabel,
  });
}

function reassessmentFromRow(
  row: ReassessmentRow,
  accountId: ReadPlayerInitialLevelReassessmentInput['accountId'],
): Extract<
  PlayerInitialLevelReassessmentState,
  { readonly status: 'completed' }
> {
  if (
    !isAccountId(row.account_id) ||
    row.account_id !== accountId ||
    typeof row.source_flow_version !== 'string' ||
    !FLOW_VERSION_PATTERN.test(row.source_flow_version) ||
    row.source_survey_version !== 'initial_level_v1' ||
    row.survey_version !== PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION
  ) {
    throw failure('invalid_persisted_state');
  }
  const sourceRevision = decodePostgresBigint(row.source_revision);
  if (sourceRevision < 1) {
    throw failure('invalid_persisted_state');
  }
  const answers = copyAnswers(row.survey_answers);
  const calculated = scorePlayerOnboardingInitialLevel(answers);
  const persisted = initialLevelResult(
    row.initial_level_score,
    row.initial_level_label,
  );
  if (
    calculated === undefined ||
    calculated.score !== persisted.score ||
    calculated.label !== persisted.label
  ) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({
    status: 'completed' as const,
    source: Object.freeze({
      flowVersion: row.source_flow_version,
      surveyVersion: 'initial_level_v1' as const,
      revision: sourceRevision,
    }),
    surveyVersion: PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION,
    surveyAnswers: answers,
    initialLevelScore: persisted.score,
    initialLevelLabel: persisted.label,
  });
}

function mapPersistenceError(
  error: unknown,
): PlayerInitialLevelReassessmentPersistenceError {
  if (error instanceof PlayerInitialLevelReassessmentPersistenceError) {
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

const NOT_ELIGIBLE = Object.freeze({ status: 'not_eligible' as const });
const STALE_SOURCE = Object.freeze({ outcome: 'stale_source' as const });
const CONFLICT = Object.freeze({ outcome: 'conflict' as const });

export class PostgresPlayerInitialLevelReassessmentRepository implements PlayerInitialLevelReassessmentRepository {
  async read(
    transaction: PostgresTransaction,
    input: ReadPlayerInitialLevelReassessmentInput,
  ): Promise<PlayerInitialLevelReassessmentState> {
    if (!isPlainRecord(input) || !isAccountId(input.accountId)) {
      throw failure('invalid_input');
    }
    try {
      const result = await transaction.query<ReadStateRow>(READ_STATE_SQL, [
        input.accountId,
      ]);
      if (result.rowCount === 0 && result.rows.length === 0) {
        return NOT_ELIGIBLE;
      }
      if (result.rowCount !== 1 || result.rows.length !== 1) {
        throw failure('invalid_persisted_state');
      }
      const row = result.rows[0];
      const source = sourceFromRow(
        {
          ...row,
          completed_at: row.source_completed_at,
        },
        input.accountId,
      );
      if (row.reassessment_account_id === null) {
        if (
          row.source_flow_version !== null ||
          row.source_survey_version !== null ||
          row.source_revision !== null ||
          row.reassessment_survey_version !== null ||
          row.survey_answers !== null ||
          row.initial_level_score !== null ||
          row.initial_level_label !== null
        ) {
          throw failure('invalid_persisted_state');
        }
        return source === undefined
          ? NOT_ELIGIBLE
          : Object.freeze({
              status: 'required' as const,
              source: source.source,
              surveyVersion: PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION,
            });
      }
      const reassessment = reassessmentFromRow(
        {
          account_id: row.reassessment_account_id,
          source_flow_version: row.source_flow_version,
          source_survey_version: row.source_survey_version,
          source_revision: row.source_revision,
          survey_version: row.reassessment_survey_version,
          survey_answers: row.survey_answers,
          initial_level_score: row.initial_level_score,
          initial_level_label: row.initial_level_label,
        },
        input.accountId,
      );
      if (
        source === undefined ||
        reassessment.source.flowVersion !== source.source.flowVersion ||
        reassessment.source.revision !== source.source.revision
      ) {
        throw failure('invalid_persisted_state');
      }
      return reassessment;
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async complete(
    transaction: PostgresTransaction,
    input: CompletePlayerInitialLevelReassessmentInput,
  ): Promise<CompletePlayerInitialLevelReassessmentResult> {
    if (
      !isPlainRecord(input) ||
      !isAccountId(input.accountId) ||
      !isPlainRecord(input.source) ||
      typeof input.source.flowVersion !== 'string' ||
      !FLOW_VERSION_PATTERN.test(input.source.flowVersion) ||
      input.source.surveyVersion !== 'initial_level_v1' ||
      !Number.isSafeInteger(input.source.revision) ||
      input.source.revision < 1 ||
      input.surveyVersion !== PLAYER_ONBOARDING_INITIAL_LEVEL_SURVEY_VERSION ||
      !validInputAnswers(input.surveyAnswers) ||
      !isUnixEpochSeconds(input.completedAt)
    ) {
      throw failure('invalid_input');
    }
    const calculated = scorePlayerOnboardingInitialLevel(input.surveyAnswers);
    if (calculated === undefined) {
      throw failure('invalid_input');
    }
    try {
      const sourceResult = await transaction.query<SourceRow>(LOCK_SOURCE_SQL, [
        input.accountId,
      ]);
      if (sourceResult.rowCount === 0 && sourceResult.rows.length === 0) {
        return { outcome: 'not_eligible' };
      }
      if (sourceResult.rowCount !== 1 || sourceResult.rows.length !== 1) {
        throw failure('invalid_persisted_state');
      }
      const source = sourceFromRow(sourceResult.rows[0], input.accountId);
      if (source === undefined) {
        return { outcome: 'not_eligible' };
      }
      if (
        source.source.flowVersion !== input.source.flowVersion ||
        source.source.surveyVersion !== input.source.surveyVersion ||
        source.source.revision !== input.source.revision
      ) {
        return STALE_SOURCE;
      }

      const existingResult = await transaction.query<ReassessmentRow>(
        FIND_REASSESSMENT_SQL,
        [input.accountId],
      );
      if (existingResult.rowCount === 1 && existingResult.rows.length === 1) {
        const existing = reassessmentFromRow(
          existingResult.rows[0],
          input.accountId,
        );
        if (
          existing.source.flowVersion !== input.source.flowVersion ||
          existing.source.revision !== input.source.revision ||
          existing.surveyVersion !== input.surveyVersion ||
          !sameAnswers(existing.surveyAnswers, input.surveyAnswers) ||
          existing.initialLevelScore !== calculated.score ||
          existing.initialLevelLabel !== calculated.label
        ) {
          return CONFLICT;
        }
        return Object.freeze({
          outcome: 'completed' as const,
          replayed: true,
          initialLevelScore: existing.initialLevelScore,
          initialLevelLabel: existing.initialLevelLabel,
        });
      }
      if (existingResult.rowCount !== 0 || existingResult.rows.length !== 0) {
        throw failure('invalid_persisted_state');
      }

      const completedAt = Math.max(source.completedAt, input.completedAt);
      const inserted = await transaction.query<ReassessmentRow>(
        INSERT_REASSESSMENT_SQL,
        [
          input.accountId,
          input.source.flowVersion,
          input.source.surveyVersion,
          input.source.revision,
          input.surveyVersion,
          input.surveyAnswers,
          calculated.score,
          calculated.label,
          completedAt,
        ],
      );
      if (inserted.rowCount !== 1 || inserted.rows.length !== 1) {
        throw failure('transaction_conflict');
      }
      const completed = reassessmentFromRow(inserted.rows[0], input.accountId);
      if (
        !sameAnswers(completed.surveyAnswers, input.surveyAnswers) ||
        completed.initialLevelScore !== calculated.score ||
        completed.initialLevelLabel !== calculated.label
      ) {
        throw failure('invalid_persisted_state');
      }
      return Object.freeze({
        outcome: 'completed' as const,
        replayed: false,
        initialLevelScore: completed.initialLevelScore,
        initialLevelLabel: completed.initialLevelLabel,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
