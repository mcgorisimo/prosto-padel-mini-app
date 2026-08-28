import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';
import { isMatchNotificationId } from '../matches/match-notification.types';
import { isMatchId, isMatchInvitationId } from '../matches/match.types';
import {
  ClaimedTelegramNotification,
  TelegramDestinationDisableReason,
  TelegramNotificationRetryFailure,
  TelegramNotificationTerminalFailure,
  isTelegramNotificationOutboxId,
} from '../notifications/telegram-notification.types';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import {
  ClaimTelegramNotificationInput,
  EnqueueInvitationDeliveryInput,
  EnqueueMatchNotificationDeliveryInput,
  FinalizeTelegramNotificationInput,
  TelegramNotificationClaimResult,
  TelegramNotificationFinalizeResult,
  TelegramNotificationOutboxPersistenceError,
  TelegramNotificationOutboxPersistenceFailure,
  TelegramNotificationOutboxRepository,
} from './telegram-notification-outbox.repository';

const MAX_BIGINT_TEXT = '9007199254740991';
const RETRY_FAILURES = Object.freeze([
  'telegram_rate_limited',
] as const);
const TERMINAL_FAILURES = Object.freeze([
  'destination_unavailable',
  'preference_disabled',
  'telegram_forbidden',
  'telegram_bad_request',
  'telegram_unauthorized',
  'delivery_unknown',
] as const);
const DISABLE_REASONS = Object.freeze([
  'telegram_forbidden',
  'invalid_destination',
] as const);

const ENQUEUE_MATCH_NOTIFICATION_SQL = `
  WITH inserted AS (
    INSERT INTO backend_match.telegram_notification_outbox (
      id,
      source_type,
      match_notification_id,
      created_at,
      available_at,
      status,
      attempt_count,
      updated_at,
      version
    )
    VALUES ($1, 'match_notification', $2, $3, $3, 'pending', 0, $3, 1)
    ON CONFLICT DO NOTHING
    RETURNING id, source_type, match_notification_id, invitation_id,
      created_at, available_at, status, attempt_count, version
  )
  SELECT *, true AS inserted
  FROM inserted
  UNION ALL
  SELECT id, source_type, match_notification_id, invitation_id,
    created_at, available_at, status, attempt_count, version,
    false AS inserted
  FROM backend_match.telegram_notification_outbox
  WHERE match_notification_id = $2
    AND NOT EXISTS (SELECT 1 FROM inserted)
`;

const ENQUEUE_INVITATION_SQL = `
  WITH inserted AS (
    INSERT INTO backend_match.telegram_notification_outbox (
      id,
      source_type,
      invitation_id,
      created_at,
      available_at,
      status,
      attempt_count,
      updated_at,
      version
    )
    VALUES ($1, 'match_invitation', $2, $3, $3, 'pending', 0, $3, 1)
    ON CONFLICT DO NOTHING
    RETURNING id, source_type, match_notification_id, invitation_id,
      created_at, available_at, status, attempt_count, version
  )
  SELECT *, true AS inserted
  FROM inserted
  UNION ALL
  SELECT id, source_type, match_notification_id, invitation_id,
    created_at, available_at, status, attempt_count, version,
    false AS inserted
  FROM backend_match.telegram_notification_outbox
  WHERE invitation_id = $2
    AND NOT EXISTS (SELECT 1 FROM inserted)
`;

const ABANDON_EXHAUSTED_SQL = `
  UPDATE backend_match.telegram_notification_outbox AS outbox
  SET status = 'abandoned',
      updated_at = $1,
      failure_code = 'retry_exhausted',
      version = outbox.version + 1
  WHERE outbox.id = (
    SELECT pending.id
    FROM backend_match.telegram_notification_outbox AS pending
    WHERE pending.status = 'pending'
      AND pending.available_at <= $1
      AND pending.attempt_count >= 20
    ORDER BY pending.available_at, pending.created_at, pending.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING outbox.id
`;

const ABANDON_AMBIGUOUS_SQL = `
  UPDATE backend_match.telegram_notification_outbox AS outbox
  SET status = 'abandoned',
      updated_at = $1,
      failure_code = 'delivery_unknown',
      version = outbox.version + 1
  WHERE outbox.id = (
    SELECT pending.id
    FROM backend_match.telegram_notification_outbox AS pending
    WHERE pending.status = 'pending'
      AND pending.available_at <= $1
      AND pending.attempt_count > 0
      AND pending.failure_code IS NULL
    ORDER BY pending.available_at, pending.created_at, pending.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING outbox.id
`;

const CLAIM_NEXT_SQL = `
  WITH candidate AS MATERIALIZED (
    SELECT pending.id
    FROM backend_match.telegram_notification_outbox AS pending
    WHERE pending.status = 'pending'
      AND pending.available_at <= $1
      AND pending.attempt_count < 20
    ORDER BY pending.available_at, pending.created_at, pending.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE backend_match.telegram_notification_outbox AS outbox
    SET available_at = $2,
        attempt_count = outbox.attempt_count + 1,
        updated_at = $1,
        failure_code = NULL,
        version = outbox.version + 1
    FROM candidate
    WHERE outbox.id = candidate.id
    RETURNING outbox.id,
      outbox.source_type,
      outbox.match_notification_id,
      outbox.invitation_id,
      outbox.attempt_count,
      outbox.version
  )
  SELECT claimed.id,
    claimed.source_type,
    claimed.match_notification_id,
    claimed.invitation_id,
    claimed.attempt_count,
    claimed.version,
    CASE
      WHEN claimed.source_type = 'match_notification'
        THEN notifications.recipient_account_id
      ELSE invitations.invited_account_id
    END AS recipient_account_id,
    CASE
      WHEN destinations.status = 'enabled'
        THEN destinations.telegram_chat_id
      ELSE NULL
    END AS telegram_chat_id,
    CASE
      WHEN destinations.status = 'enabled'
        THEN destinations.version
      ELSE NULL
    END AS destination_version,
    COALESCE(
      preferences.telegram_match_notifications_enabled,
      true
    ) AS preference_enabled,
    matches.id AS match_id,
    matches.starts_at,
    matches.court_name
  FROM claimed
  LEFT JOIN backend_match.match_notifications AS notifications
    ON notifications.id = claimed.match_notification_id
  LEFT JOIN backend_match.match_invitations AS invitations
    ON invitations.id = claimed.invitation_id
  JOIN backend_match.matches AS matches
    ON matches.id = COALESCE(notifications.match_id, invitations.match_id)
    LEFT JOIN backend_auth.telegram_notification_destinations AS destinations
    ON destinations.account_id = COALESCE(
      notifications.recipient_account_id,
      invitations.invited_account_id
    )
  LEFT JOIN backend_auth.account_notification_preferences AS preferences
    ON preferences.account_id = COALESCE(
      notifications.recipient_account_id,
      invitations.invited_account_id
    )
`;

const MARK_SENT_SQL = `
  UPDATE backend_match.telegram_notification_outbox AS outbox
  SET status = 'sent',
      updated_at = $3,
      sent_at = $3,
      telegram_message_id = $4,
      failure_code = NULL,
      version = outbox.version + 1
  WHERE outbox.id = $1
    AND outbox.status = 'pending'
    AND outbox.version = $2
  RETURNING outbox.id
`;

const SCHEDULE_RETRY_SQL = `
  UPDATE backend_match.telegram_notification_outbox AS outbox
  SET available_at = $4,
      updated_at = $3,
      failure_code = $5,
      version = outbox.version + 1
  WHERE outbox.id = $1
    AND outbox.status = 'pending'
    AND outbox.version = $2
  RETURNING outbox.id
`;

const ABANDON_SQL = `
  WITH finalized AS MATERIALIZED (
    UPDATE backend_match.telegram_notification_outbox AS outbox
    SET status = 'abandoned',
        updated_at = $3,
        failure_code = $4,
        version = outbox.version + 1
    WHERE outbox.id = $1
      AND outbox.status = 'pending'
      AND outbox.version = $2
    RETURNING outbox.match_notification_id, outbox.invitation_id
  ), recipient AS (
    SELECT COALESCE(
      notifications.recipient_account_id,
      invitations.invited_account_id
    ) AS account_id
    FROM finalized
    LEFT JOIN backend_match.match_notifications AS notifications
      ON notifications.id = finalized.match_notification_id
    LEFT JOIN backend_match.match_invitations AS invitations
      ON invitations.id = finalized.invitation_id
  ), disabled AS (
    UPDATE backend_auth.telegram_notification_destinations AS destination
    SET status = 'disabled',
        updated_at = $3,
        disabled_at = $3,
        disable_reason = $5,
        version = destination.version + 1
    FROM recipient
    WHERE $5::text IS NOT NULL
      AND destination.account_id = recipient.account_id
      AND destination.status = 'enabled'
      AND destination.version = $6
    RETURNING destination.account_id
  )
  SELECT EXISTS (SELECT 1 FROM finalized) AS applied
`;

interface EnqueuedRow extends QueryResultRow {
  readonly id: unknown;
  readonly source_type: unknown;
  readonly match_notification_id: unknown;
  readonly invitation_id: unknown;
  readonly created_at: unknown;
  readonly available_at: unknown;
  readonly status: unknown;
  readonly attempt_count: unknown;
  readonly version: unknown;
  readonly inserted: unknown;
}

interface ClaimedRow extends QueryResultRow {
  readonly id: unknown;
  readonly source_type: unknown;
  readonly match_notification_id: unknown;
  readonly invitation_id: unknown;
  readonly attempt_count: unknown;
  readonly version: unknown;
  readonly recipient_account_id: unknown;
  readonly telegram_chat_id: unknown;
  readonly destination_version: unknown;
  readonly preference_enabled: unknown;
  readonly match_id: unknown;
  readonly starts_at: unknown;
  readonly court_name: unknown;
}

interface AppliedRow extends QueryResultRow {
  readonly id?: unknown;
  readonly applied?: unknown;
}

function failure(
  reason: TelegramNotificationOutboxPersistenceFailure,
): TelegramNotificationOutboxPersistenceError {
  return new TelegramNotificationOutboxPersistenceError(reason);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function readSafeInteger(value: unknown): number {
  const parsed =
    typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    throw failure('invalid_persisted_state');
  }
  return Number(parsed);
}

function readEpoch(value: unknown): UnixEpochSeconds {
  const parsed = readSafeInteger(value);
  if (!isUnixEpochSeconds(parsed)) {
    throw failure('invalid_persisted_state');
  }
  return parsed;
}

function validBigintText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]*$/u.test(value) &&
    (value.length < MAX_BIGINT_TEXT.length ||
      (value.length === MAX_BIGINT_TEXT.length && value <= MAX_BIGINT_TEXT))
  );
}

function validateEnqueueMatchNotification(
  value: unknown,
): EnqueueMatchNotificationDeliveryInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 3 ||
    !isTelegramNotificationOutboxId(value.outboxId) ||
    !isMatchNotificationId(value.matchNotificationId) ||
    !isUnixEpochSeconds(value.now)
  ) {
    throw failure('invalid_input');
  }
  return value as unknown as EnqueueMatchNotificationDeliveryInput;
}

function validateEnqueueInvitation(
  value: unknown,
): EnqueueInvitationDeliveryInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 3 ||
    !isTelegramNotificationOutboxId(value.outboxId) ||
    !isMatchInvitationId(value.invitationId) ||
    !isUnixEpochSeconds(value.now)
  ) {
    throw failure('invalid_input');
  }
  return value as unknown as EnqueueInvitationDeliveryInput;
}

function assertEnqueued(
  row: EnqueuedRow | undefined,
  expected: {
    readonly outboxId: string;
    readonly sourceType: 'match_notification' | 'match_invitation';
    readonly sourceId: string;
    readonly now: UnixEpochSeconds;
  },
): void {
  if (
    row === undefined ||
    !isTelegramNotificationOutboxId(row.id) ||
    row.id !== expected.outboxId ||
    row.source_type !== expected.sourceType ||
    row.status !== 'pending' ||
    readEpoch(row.created_at) !== expected.now ||
    readEpoch(row.available_at) !== expected.now ||
    readSafeInteger(row.attempt_count) !== 0 ||
    readSafeInteger(row.version) !== 1 ||
    typeof row.inserted !== 'boolean' ||
    (expected.sourceType === 'match_notification'
      ? !isMatchNotificationId(row.match_notification_id) ||
        row.match_notification_id !== expected.sourceId ||
        row.invitation_id !== null
      : !isMatchInvitationId(row.invitation_id) ||
        row.invitation_id !== expected.sourceId ||
        row.match_notification_id !== null)
  ) {
    throw failure('source_conflict');
  }
}

function validateClaimInput(value: unknown): ClaimTelegramNotificationInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 2 ||
    !isUnixEpochSeconds(value.now) ||
    !isUnixEpochSeconds(value.leaseUntil) ||
    value.leaseUntil <= value.now
  ) {
    throw failure('invalid_input');
  }
  return value as unknown as ClaimTelegramNotificationInput;
}

function hydrateClaim(row: ClaimedRow): ClaimedTelegramNotification {
  if (
    !isTelegramNotificationOutboxId(row.id) ||
    (row.source_type !== 'match_notification' &&
      row.source_type !== 'match_invitation') ||
    !isAccountId(row.recipient_account_id) ||
    !isMatchId(row.match_id) ||
    typeof row.court_name !== 'string' ||
    row.court_name.length < 1 ||
    [...row.court_name].length > 128 ||
    ((row.telegram_chat_id === null) !==
      (row.destination_version === null)) ||
    (row.telegram_chat_id !== null &&
      !validBigintText(row.telegram_chat_id)) ||
    typeof row.preference_enabled !== 'boolean' ||
    (row.source_type === 'match_notification' &&
      (!isMatchNotificationId(row.match_notification_id) ||
        row.invitation_id !== null)) ||
    (row.source_type === 'match_invitation' &&
      (!isMatchInvitationId(row.invitation_id) ||
        row.match_notification_id !== null))
  ) {
    throw failure('invalid_persisted_state');
  }
  const attemptCount = readSafeInteger(row.attempt_count);
  const claimVersion = readSafeInteger(row.version);
  const destinationVersion =
    row.destination_version === null
      ? undefined
      : readSafeInteger(row.destination_version);
  if (attemptCount < 1 || attemptCount > 20 || claimVersion < 2) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({
    outboxId: row.id,
    claimVersion,
    attemptCount,
    recipientAccountId: row.recipient_account_id,
    ...(row.telegram_chat_id === null
      ? {}
      : {
          telegramChatId: row.telegram_chat_id,
          destinationVersion,
        }),
    matchId: row.match_id,
    matchStartsAt: readEpoch(row.starts_at),
    courtName: row.court_name,
    sourceType: row.source_type,
    preferenceEnabled: row.preference_enabled,
  });
}

function validateFinalizeInput(
  value: unknown,
  extraKeys: readonly string[],
): FinalizeTelegramNotificationInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 3 + extraKeys.length ||
    !extraKeys.every((key) =>
      Object.prototype.hasOwnProperty.call(value, key),
    ) ||
    !isTelegramNotificationOutboxId(value.outboxId) ||
    !Number.isSafeInteger(value.claimVersion) ||
    Number(value.claimVersion) < 2 ||
    !isUnixEpochSeconds(value.now)
  ) {
    throw failure('invalid_input');
  }
  return value as unknown as FinalizeTelegramNotificationInput;
}

function finalizeResult(
  rowCount: number | null,
  rows: readonly AppliedRow[],
  booleanResult = false,
): TelegramNotificationFinalizeResult {
  if (rowCount !== rows.length || rows.length > 1) {
    throw failure('invalid_persisted_state');
  }
  const applied = booleanResult
    ? rows.length === 1 && rows[0]?.applied === true
    : rows.length === 1;
  if (booleanResult && rows.length === 1 && typeof rows[0]?.applied !== 'boolean') {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({
    outcome: applied ? 'applied' : 'stale_claim',
  });
}

function mapPersistenceError(
  error: unknown,
): TelegramNotificationOutboxPersistenceError {
  if (error instanceof TelegramNotificationOutboxPersistenceError) {
    return error;
  }
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return failure('storage_failure');
  }
  switch (classified.category) {
    case 'unique_violation':
      return failure('source_conflict');
    case 'foreign_key_violation':
      return failure('referential_integrity');
    case 'check_violation':
    case 'not_null_violation':
    case 'invalid_text_representation':
      return failure('invalid_input');
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

export class PostgresTelegramNotificationOutboxRepository
  implements TelegramNotificationOutboxRepository
{
  async enqueueMatchNotification(
    transaction: PostgresTransaction,
    inputValue: EnqueueMatchNotificationDeliveryInput,
  ): Promise<void> {
    try {
      const input = validateEnqueueMatchNotification(inputValue);
      const result = await transaction.query<EnqueuedRow>(
        ENQUEUE_MATCH_NOTIFICATION_SQL,
        [input.outboxId, input.matchNotificationId, input.now.toString(10)],
      );
      if (result.rowCount !== 1 || result.rows.length !== 1) {
        throw failure('source_conflict');
      }
      assertEnqueued(result.rows[0], {
        outboxId: input.outboxId,
        sourceType: 'match_notification',
        sourceId: input.matchNotificationId,
        now: input.now,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async enqueueInvitation(
    transaction: PostgresTransaction,
    inputValue: EnqueueInvitationDeliveryInput,
  ): Promise<void> {
    try {
      const input = validateEnqueueInvitation(inputValue);
      const result = await transaction.query<EnqueuedRow>(
        ENQUEUE_INVITATION_SQL,
        [input.outboxId, input.invitationId, input.now.toString(10)],
      );
      if (result.rowCount !== 1 || result.rows.length !== 1) {
        throw failure('source_conflict');
      }
      assertEnqueued(result.rows[0], {
        outboxId: input.outboxId,
        sourceType: 'match_invitation',
        sourceId: input.invitationId,
        now: input.now,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async claimNext(
    transaction: PostgresTransaction,
    inputValue: ClaimTelegramNotificationInput,
  ): Promise<TelegramNotificationClaimResult> {
    try {
      const input = validateClaimInput(inputValue);
      const ambiguous = await transaction.query<AppliedRow>(
        ABANDON_AMBIGUOUS_SQL,
        [input.now.toString(10)],
      );
      if (
        ambiguous.rowCount !== ambiguous.rows.length ||
        ambiguous.rows.length > 1
      ) {
        throw failure('invalid_persisted_state');
      }
      if (ambiguous.rows.length === 1) {
        return Object.freeze({ outcome: 'retry_exhausted' as const });
      }
      const exhausted = await transaction.query<AppliedRow>(
        ABANDON_EXHAUSTED_SQL,
        [input.now.toString(10)],
      );
      if (
        exhausted.rowCount !== exhausted.rows.length ||
        exhausted.rows.length > 1
      ) {
        throw failure('invalid_persisted_state');
      }
      if (exhausted.rows.length === 1) {
        return Object.freeze({ outcome: 'retry_exhausted' as const });
      }
      const claimed = await transaction.query<ClaimedRow>(CLAIM_NEXT_SQL, [
        input.now.toString(10),
        input.leaseUntil.toString(10),
      ]);
      if (claimed.rowCount !== claimed.rows.length || claimed.rows.length > 1) {
        throw failure('invalid_persisted_state');
      }
      if (claimed.rows.length === 0) {
        return Object.freeze({ outcome: 'none_available' as const });
      }
      return Object.freeze({
        outcome: 'claimed' as const,
        notification: hydrateClaim(claimed.rows[0]),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async markSent(
    transaction: PostgresTransaction,
    inputValue: FinalizeTelegramNotificationInput & {
      readonly telegramMessageId: string;
    },
  ): Promise<TelegramNotificationFinalizeResult> {
    try {
      const input = validateFinalizeInput(inputValue, ['telegramMessageId']);
      if (!validBigintText(inputValue.telegramMessageId)) {
        throw failure('invalid_input');
      }
      const result = await transaction.query<AppliedRow>(MARK_SENT_SQL, [
        input.outboxId,
        input.claimVersion,
        input.now.toString(10),
        inputValue.telegramMessageId,
      ]);
      return finalizeResult(result.rowCount, result.rows);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async scheduleRetry(
    transaction: PostgresTransaction,
    inputValue: FinalizeTelegramNotificationInput & {
      readonly availableAt: UnixEpochSeconds;
      readonly failure: TelegramNotificationRetryFailure;
    },
  ): Promise<TelegramNotificationFinalizeResult> {
    try {
      const input = validateFinalizeInput(inputValue, [
        'availableAt',
        'failure',
      ]);
      if (
        !isUnixEpochSeconds(inputValue.availableAt) ||
        inputValue.availableAt <= input.now ||
        !RETRY_FAILURES.includes(inputValue.failure)
      ) {
        throw failure('invalid_input');
      }
      const result = await transaction.query<AppliedRow>(
        SCHEDULE_RETRY_SQL,
        [
          input.outboxId,
          input.claimVersion,
          input.now.toString(10),
          inputValue.availableAt.toString(10),
          inputValue.failure,
        ],
      );
      return finalizeResult(result.rowCount, result.rows);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async abandon(
    transaction: PostgresTransaction,
    inputValue: FinalizeTelegramNotificationInput & {
      readonly failure: TelegramNotificationTerminalFailure;
      readonly disableDestination?: TelegramDestinationDisableReason;
      readonly destinationVersion?: number;
    },
  ): Promise<TelegramNotificationFinalizeResult> {
    try {
      const extraKeys = inputValue.disableDestination === undefined
        ? ['failure']
        : ['failure', 'disableDestination', 'destinationVersion'];
      const input = validateFinalizeInput(inputValue, extraKeys);
      if (
        !TERMINAL_FAILURES.includes(inputValue.failure) ||
        (inputValue.disableDestination !== undefined &&
          (!DISABLE_REASONS.includes(inputValue.disableDestination) ||
            !Number.isSafeInteger(inputValue.destinationVersion) ||
            Number(inputValue.destinationVersion) < 1)) ||
        (inputValue.disableDestination === undefined &&
          inputValue.destinationVersion !== undefined)
      ) {
        throw failure('invalid_input');
      }
      const result = await transaction.query<AppliedRow>(ABANDON_SQL, [
        input.outboxId,
        input.claimVersion,
        input.now.toString(10),
        inputValue.failure,
        inputValue.disableDestination ?? null,
        inputValue.destinationVersion ?? null,
      ]);
      return finalizeResult(result.rowCount, result.rows, true);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
