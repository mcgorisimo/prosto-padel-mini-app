import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import {
  ContactCheckoutVerificationSnapshot,
  ContactVerificationField,
  EmailContactVerificationState,
  isContactVerificationTarget,
  PhoneContactVerificationState,
} from '../contacts/contact-verification.contracts';
import { isUnixEpochSeconds, unixEpochSeconds } from '../auth/auth.types';
import {
  ContactVerificationSnapshotPersistenceError,
  ContactVerificationSnapshotPersistenceFailure,
  ContactVerificationSnapshotRepository,
  ReadContactVerificationSnapshotInput,
} from './contact-verification-snapshot.repository';
import { decodePostgresBigint, PostgresCodecError } from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';

const READ_CHECKOUT_SNAPSHOT_SQL = `
  WITH database_time AS (
    SELECT
      FLOOR(EXTRACT(EPOCH FROM transaction_timestamp()))::bigint AS now_epoch
  ),
  contact_snapshot AS (
    SELECT
      contact.account_id,
      contact.field,
      contact.contact_version,
      CASE
        WHEN verified.contact_version IS NOT NULL THEN 'verified'
        WHEN EXISTS (
          SELECT 1
          FROM backend_auth.contact_verification_challenges AS pending
          WHERE pending.account_id = contact.account_id
            AND pending.field = contact.field
            AND pending.purpose = 'contact_ownership'
            AND pending.contact_version = contact.contact_version
            AND pending.subject_digest = contact.subject_digest
            AND pending.subject_digest_key_version =
              contact.subject_digest_key_version
            AND pending.state = 'pending'
            AND pending.attempts_remaining > 0
            AND database_time.now_epoch < pending.expires_at
            AND (
              (contact.field = 'phone' AND pending.method = 'phone_sms_otp')
              OR
              (
                contact.field = 'email'
                AND pending.method IN ('email_code', 'email_link')
              )
            )
        ) THEN 'pending'
        ELSE 'unverified'
      END AS status,
      verified.contact_version AS verified_version,
      verified.method AS verified_method,
      verified.verified_at
    FROM backend_auth.account_contacts AS contact
    CROSS JOIN database_time
    LEFT JOIN LATERAL (
      SELECT
        challenge.contact_version,
        challenge.method,
        challenge.verified_at
      FROM backend_auth.contact_verification_challenges AS challenge
      WHERE challenge.account_id = contact.account_id
        AND challenge.field = contact.field
        AND challenge.purpose = 'contact_ownership'
        AND challenge.contact_version = contact.contact_version
        AND challenge.subject_digest = contact.subject_digest
        AND challenge.subject_digest_key_version =
          contact.subject_digest_key_version
        AND challenge.state = 'verified'
        AND challenge.verified_at IS NOT NULL
        AND challenge.verified_at < challenge.expires_at
        AND (
          (contact.field = 'phone' AND challenge.method = 'phone_sms_otp')
          OR
          (
            contact.field = 'email'
            AND challenge.method IN ('email_code', 'email_link')
          )
        )
      ORDER BY challenge.verified_at DESC, challenge.challenge_id DESC
      LIMIT 1
    ) AS verified ON TRUE
    WHERE contact.account_id = $1
      AND contact.field IN ('phone', 'email')
  )
  SELECT
    snapshot.account_id,
    snapshot.field,
    snapshot.contact_version,
    snapshot.status,
    snapshot.verified_version,
    snapshot.verified_method,
    snapshot.verified_at
  FROM contact_snapshot AS snapshot
  ORDER BY snapshot.field
`;

const SNAPSHOT_ROW_KEYS = Object.freeze([
  'account_id',
  'contact_version',
  'field',
  'status',
  'verified_at',
  'verified_method',
  'verified_version',
]);

interface ContactVerificationSnapshotRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly field: unknown;
  readonly contact_version: unknown;
  readonly status: unknown;
  readonly verified_version: unknown;
  readonly verified_method: unknown;
  readonly verified_at: unknown;
}

type ContactState =
  | PhoneContactVerificationState
  | EmailContactVerificationState;

function failure(
  reason: ContactVerificationSnapshotPersistenceFailure,
): ContactVerificationSnapshotPersistenceError {
  return new ContactVerificationSnapshotPersistenceError(reason);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validateInput(
  value: unknown,
): ReadContactVerificationSnapshotInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(value, 'accountId') ||
    !isAccountId(value.accountId)
  ) {
    throw failure('invalid_input');
  }
  return Object.freeze({ accountId: value.accountId });
}

function positiveBigint(value: unknown): number {
  const decoded = decodePostgresBigint(value);
  if (decoded < 1) {
    throw failure('invalid_persisted_state');
  }
  return decoded;
}

function hasExactRowKeys(row: ContactVerificationSnapshotRow): boolean {
  return (
    Object.keys(row).sort().join('\n') === SNAPSHOT_ROW_KEYS.join('\n')
  );
}

function hydrateState(
  row: ContactVerificationSnapshotRow,
  expectedAccountId: ReadContactVerificationSnapshotInput['accountId'],
): ContactState {
  try {
    if (
      !hasExactRowKeys(row) ||
      !isAccountId(row.account_id) ||
      row.account_id !== expectedAccountId ||
      (row.field !== 'phone' && row.field !== 'email')
    ) {
      throw failure('invalid_persisted_state');
    }

    const field: ContactVerificationField = row.field;
    const contactVersion = positiveBigint(row.contact_version);
    if (row.status === 'unverified' || row.status === 'pending') {
      if (
        row.verified_version !== null ||
        row.verified_method !== null ||
        row.verified_at !== null
      ) {
        throw failure('invalid_persisted_state');
      }
      return Object.freeze({
        field,
        status: row.status,
        contactVersion,
      }) as ContactState;
    }

    if (row.status !== 'verified') {
      throw failure('invalid_persisted_state');
    }
    const verifiedVersion = positiveBigint(row.verified_version);
    const verifiedAtValue = decodePostgresBigint(row.verified_at);
    if (
      verifiedVersion !== contactVersion ||
      !isUnixEpochSeconds(verifiedAtValue) ||
      !isContactVerificationTarget(field, row.verified_method)
    ) {
      throw failure('invalid_persisted_state');
    }
    return Object.freeze({
      field,
      status: 'verified',
      contactVersion,
      verifiedVersion,
      method: row.verified_method,
      verifiedAt: unixEpochSeconds(verifiedAtValue),
    }) as ContactState;
  } catch (error) {
    if (error instanceof ContactVerificationSnapshotPersistenceError) {
      throw error;
    }
    if (error instanceof PostgresCodecError) {
      throw failure('invalid_persisted_state');
    }
    throw error;
  }
}

function mapPersistenceError(
  error: unknown,
): ContactVerificationSnapshotPersistenceError {
  if (error instanceof ContactVerificationSnapshotPersistenceError) {
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

const MISSING_PHONE: PhoneContactVerificationState = Object.freeze({
  field: 'phone',
  status: 'missing',
});
const MISSING_EMAIL: EmailContactVerificationState = Object.freeze({
  field: 'email',
  status: 'missing',
});

export class PostgresContactVerificationSnapshotRepository
  implements ContactVerificationSnapshotRepository
{
  async readCheckoutSnapshot(
    transaction: PostgresTransaction,
    rawInput: ReadContactVerificationSnapshotInput,
  ): Promise<ContactCheckoutVerificationSnapshot> {
    try {
      const input = validateInput(rawInput);
      const selected =
        await transaction.query<ContactVerificationSnapshotRow>(
          READ_CHECKOUT_SNAPSHOT_SQL,
          [input.accountId],
        );

      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length > 2
      ) {
        throw failure('invalid_persisted_state');
      }

      let phone: PhoneContactVerificationState = MISSING_PHONE;
      let email: EmailContactVerificationState = MISSING_EMAIL;
      const observed = new Set<ContactVerificationField>();
      for (const row of selected.rows) {
        const state = hydrateState(row, input.accountId);
        if (observed.has(state.field)) {
          throw failure('invalid_persisted_state');
        }
        observed.add(state.field);
        if (state.field === 'phone') {
          phone = state;
        } else {
          email = state;
        }
      }

      return Object.freeze({
        accountId: input.accountId,
        phone,
        email,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
