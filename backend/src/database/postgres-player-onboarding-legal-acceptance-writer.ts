import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import { classifyPostgresError } from './postgres-error-classifier';
import {
  AcceptPlayerOnboardingLegalPolicyInput,
  AcceptPlayerOnboardingLegalPolicyResult,
  PlayerOnboardingLegalAcceptancePersistenceError,
  PlayerOnboardingLegalAcceptancePersistenceFailure,
  PlayerOnboardingLegalAcceptanceWriter,
} from './player-onboarding-legal-acceptance-writer';
import { PlayerOnboardingConsentKind } from './player-onboarding-reader';
import { PostgresTransaction } from './postgres-transaction';

const LOCK_COMPLETED_ONBOARDING_SQL = `
  SELECT account_id, status, current_step
  FROM backend_auth.player_onboarding_states
  WHERE account_id = $1::uuid
  FOR UPDATE
`;

const INSERT_ACCEPTANCES_SQL = `
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

const FIND_ACCEPTANCES_SQL = `
  SELECT consent_kind, document_version
  FROM backend_auth.account_consent_acceptances
  WHERE account_id = $1::uuid
  ORDER BY consent_kind, document_version
`;

const VERSION_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;
const DOCUMENT_VERSION_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/u;
const REQUIRED_KINDS = Object.freeze([
  'cancellation',
  'personal_data_processing',
  'terms',
] as const);

interface StateRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly status: unknown;
  readonly current_step: unknown;
}

interface ConsentRow extends QueryResultRow {
  readonly consent_kind: unknown;
  readonly document_version: unknown;
}

function failure(
  reason: PlayerOnboardingLegalAcceptancePersistenceFailure,
): PlayerOnboardingLegalAcceptancePersistenceError {
  return new PlayerOnboardingLegalAcceptancePersistenceError(reason);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validateInput(value: unknown): AcceptPlayerOnboardingLegalPolicyInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 4 ||
    !isAccountId(value.accountId) ||
    !Array.isArray(value.consents) ||
    value.consents.length !== REQUIRED_KINDS.length ||
    typeof value.flowVersion !== 'string' ||
    !VERSION_PATTERN.test(value.flowVersion) ||
    !isUnixEpochSeconds(value.acceptedAt)
  ) {
    throw failure('invalid_input');
  }
  const kinds = new Set<PlayerOnboardingConsentKind>();
  for (const consent of value.consents) {
    if (
      !isPlainRecord(consent) ||
      Object.keys(consent).length !== 2 ||
      typeof consent.kind !== 'string' ||
      !REQUIRED_KINDS.includes(
        consent.kind as (typeof REQUIRED_KINDS)[number],
      ) ||
      kinds.has(consent.kind as PlayerOnboardingConsentKind) ||
      typeof consent.documentVersion !== 'string' ||
      !DOCUMENT_VERSION_PATTERN.test(consent.documentVersion)
    ) {
      throw failure('invalid_input');
    }
    kinds.add(consent.kind as PlayerOnboardingConsentKind);
  }
  return value as unknown as AcceptPlayerOnboardingLegalPolicyInput;
}

function mapPersistenceError(
  error: unknown,
): PlayerOnboardingLegalAcceptancePersistenceError {
  if (error instanceof PlayerOnboardingLegalAcceptancePersistenceError) {
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

export class PostgresPlayerOnboardingLegalAcceptanceWriter implements PlayerOnboardingLegalAcceptanceWriter {
  async accept(
    transaction: PostgresTransaction,
    input: AcceptPlayerOnboardingLegalPolicyInput,
  ): Promise<AcceptPlayerOnboardingLegalPolicyResult> {
    try {
      const validated = validateInput(input);
      const selected = await transaction.query<StateRow>(
        LOCK_COMPLETED_ONBOARDING_SQL,
        [validated.accountId],
      );
      if (selected.rowCount === 0 && selected.rows.length === 0) {
        return Object.freeze({ outcome: 'not_found' });
      }
      if (selected.rowCount !== 1 || selected.rows.length !== 1) {
        throw failure('invalid_persisted_state');
      }
      const state = selected.rows[0];
      if (
        !isAccountId(state.account_id) ||
        state.account_id !== input.accountId
      ) {
        throw failure('invalid_persisted_state');
      }
      if (state.status !== 'completed' || state.current_step !== 'completed') {
        return Object.freeze({ outcome: 'incomplete' });
      }

      const parameters: unknown[] = [validated.accountId];
      for (const consent of validated.consents) {
        parameters.push(consent.kind, consent.documentVersion);
      }
      parameters.push(validated.flowVersion, validated.acceptedAt);
      await transaction.query(INSERT_ACCEPTANCES_SQL, parameters);

      const reread = await transaction.query<ConsentRow>(FIND_ACCEPTANCES_SQL, [
        validated.accountId,
      ]);
      const present = new Set(
        reread.rows.map((row) => {
          if (
            typeof row.consent_kind !== 'string' ||
            typeof row.document_version !== 'string' ||
            !DOCUMENT_VERSION_PATTERN.test(row.document_version)
          ) {
            throw failure('invalid_persisted_state');
          }
          return `${row.consent_kind}\0${row.document_version}`;
        }),
      );
      if (
        !validated.consents.every((consent) =>
          present.has(`${consent.kind}\0${consent.documentVersion}`),
        )
      ) {
        return Object.freeze({ outcome: 'conflict' });
      }
      return Object.freeze({ outcome: 'accepted' });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
