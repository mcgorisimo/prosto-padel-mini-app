import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import { PostgresCodecError, decodePostgresBigint } from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import {
  PlayerOnboardingDraftWritePersistenceError,
  PlayerOnboardingDraftWritePersistenceFailure,
  PlayerOnboardingDraftWriter,
  SavePlayerOnboardingDraftInput,
  SavePlayerOnboardingDraftResult,
} from './player-onboarding-draft-writer';
import { PostgresTransaction } from './postgres-transaction';

const LOCK_PROFILE_SQL = `
  SELECT account_id
  FROM backend_auth.player_profile_details
  WHERE account_id = $1::uuid
  FOR UPDATE
`;

const LOCK_STATE_SQL = `
  SELECT account_id, status, revision, updated_at
  FROM backend_auth.player_onboarding_states
  WHERE account_id = $1::uuid
  FOR UPDATE
`;

const UPDATE_PROFILE_SQL = `
  UPDATE backend_auth.player_profile_details
  SET
    first_name = $2::text,
    last_name = $3::text,
    phone = $4::text,
    normalized_email = $5::text,
    updated_at = GREATEST(updated_at, $6::bigint)
  WHERE account_id = $1::uuid
  RETURNING account_id
`;

const INSERT_STATE_SQL = `
  INSERT INTO backend_auth.player_onboarding_states (
    account_id,
    flow_version,
    current_step,
    survey_version,
    created_at,
    updated_at
  )
  VALUES ($1::uuid, $2::text, 'profile', $3::text, $4::bigint, $4::bigint)
  RETURNING account_id, revision
`;

const UPDATE_STATE_SQL = `
  UPDATE backend_auth.player_onboarding_states
  SET
    revision = revision + 1,
    updated_at = GREATEST(updated_at, $3::bigint)
  WHERE account_id = $1::uuid
    AND status = 'in_progress'
    AND revision = $2::bigint
  RETURNING account_id, revision
`;

const MAX_NAME_CODE_POINTS = 256;
const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,63}$/u;
const VERSION_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;

interface AccountRow extends QueryResultRow {
  readonly account_id: unknown;
}

interface StateRow extends AccountRow {
  readonly status: unknown;
  readonly revision: unknown;
  readonly updated_at: unknown;
}

interface SavedRow extends AccountRow {
  readonly revision: unknown;
}

function failure(
  reason: PlayerOnboardingDraftWritePersistenceFailure,
): PlayerOnboardingDraftWritePersistenceError {
  return new PlayerOnboardingDraftWritePersistenceError(reason);
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

function validName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    [...value].length <= MAX_NAME_CODE_POINTS
  );
}

function validateInput(value: unknown): SavePlayerOnboardingDraftInput {
  if (
    !isPlainRecord(value) ||
    !hasExactlyKeys(value, [
      'accountId',
      'expectedRevision',
      'firstName',
      'lastName',
      'phone',
      'normalizedEmail',
      'flowVersion',
      'surveyVersion',
      'updatedAt',
    ]) ||
    !isAccountId(value.accountId) ||
    !(
      value.expectedRevision === null ||
      (typeof value.expectedRevision === 'number' &&
        Number.isSafeInteger(value.expectedRevision) &&
        value.expectedRevision >= 1)
    ) ||
    !validName(value.firstName) ||
    !(value.lastName === null || validName(value.lastName)) ||
    !(
      value.phone === null ||
      (typeof value.phone === 'string' && PHONE_PATTERN.test(value.phone))
    ) ||
    !(
      value.normalizedEmail === null ||
      (typeof value.normalizedEmail === 'string' &&
        value.normalizedEmail.length <= 320 &&
        EMAIL_PATTERN.test(value.normalizedEmail))
    ) ||
    typeof value.flowVersion !== 'string' ||
    !VERSION_PATTERN.test(value.flowVersion) ||
    typeof value.surveyVersion !== 'string' ||
    !VERSION_PATTERN.test(value.surveyVersion) ||
    !isUnixEpochSeconds(value.updatedAt)
  ) {
    throw failure('invalid_input');
  }
  return value as unknown as SavePlayerOnboardingDraftInput;
}

function oneOwnedAccount(
  rows: readonly AccountRow[],
  rowCount: number | null,
  accountId: SavePlayerOnboardingDraftInput['accountId'],
): void {
  if (rowCount !== 1 || rows.length !== 1 || rows[0].account_id !== accountId) {
    throw failure('invalid_persisted_state');
  }
}

function savedRevision(
  rows: readonly SavedRow[],
  rowCount: number | null,
  accountId: SavePlayerOnboardingDraftInput['accountId'],
): number {
  oneOwnedAccount(rows, rowCount, accountId);
  const revision = decodePostgresBigint(rows[0].revision);
  if (revision < 1) {
    throw failure('invalid_persisted_state');
  }
  return revision;
}

function mapPersistenceError(
  error: unknown,
): PlayerOnboardingDraftWritePersistenceError {
  if (error instanceof PlayerOnboardingDraftWritePersistenceError) {
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

const NOT_FOUND: SavePlayerOnboardingDraftResult = Object.freeze({
  outcome: 'not_found',
});
const STALE_REVISION: SavePlayerOnboardingDraftResult = Object.freeze({
  outcome: 'stale_revision',
});
const CLOSED: SavePlayerOnboardingDraftResult = Object.freeze({
  outcome: 'closed',
});

export class PostgresPlayerOnboardingDraftWriter implements PlayerOnboardingDraftWriter {
  async saveDraft(
    transaction: PostgresTransaction,
    input: SavePlayerOnboardingDraftInput,
  ): Promise<SavePlayerOnboardingDraftResult> {
    try {
      const validated = validateInput(input);
      const profile = await transaction.query<AccountRow>(LOCK_PROFILE_SQL, [
        validated.accountId,
      ]);
      if (profile.rowCount === 0 && profile.rows.length === 0) {
        return NOT_FOUND;
      }
      oneOwnedAccount(profile.rows, profile.rowCount, validated.accountId);

      const state = await transaction.query<StateRow>(LOCK_STATE_SQL, [
        validated.accountId,
      ]);
      if (state.rowCount === 0 && state.rows.length === 0) {
        if (validated.expectedRevision !== null) {
          return STALE_REVISION;
        }
      } else {
        oneOwnedAccount(state.rows, state.rowCount, validated.accountId);
        const persistedRevision = decodePostgresBigint(state.rows[0].revision);
        const persistedUpdatedAt = decodePostgresBigint(
          state.rows[0].updated_at,
        );
        if (
          persistedRevision < 1 ||
          persistedUpdatedAt < 0 ||
          (state.rows[0].status !== 'in_progress' &&
            state.rows[0].status !== 'completed')
        ) {
          throw failure('invalid_persisted_state');
        }
        if (state.rows[0].status === 'completed') {
          return CLOSED;
        }
        if (validated.expectedRevision !== persistedRevision) {
          return STALE_REVISION;
        }
      }

      const updatedProfile = await transaction.query<AccountRow>(
        UPDATE_PROFILE_SQL,
        [
          validated.accountId,
          validated.firstName,
          validated.lastName,
          validated.phone,
          validated.normalizedEmail,
          validated.updatedAt,
        ],
      );
      oneOwnedAccount(
        updatedProfile.rows,
        updatedProfile.rowCount,
        validated.accountId,
      );

      const saved =
        validated.expectedRevision === null
          ? await transaction.query<SavedRow>(INSERT_STATE_SQL, [
              validated.accountId,
              validated.flowVersion,
              validated.surveyVersion,
              validated.updatedAt,
            ])
          : await transaction.query<SavedRow>(UPDATE_STATE_SQL, [
              validated.accountId,
              validated.expectedRevision,
              validated.updatedAt,
            ]);
      const revision = savedRevision(
        saved.rows,
        saved.rowCount,
        validated.accountId,
      );
      const expectedSavedRevision =
        validated.expectedRevision === null
          ? 1
          : validated.expectedRevision + 1;
      if (revision !== expectedSavedRevision) {
        throw failure('invalid_persisted_state');
      }
      return Object.freeze({ outcome: 'saved', revision });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
