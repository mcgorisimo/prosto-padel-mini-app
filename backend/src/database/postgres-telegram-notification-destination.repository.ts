import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import {
  VerifiedTelegramNotificationPermission,
  isUnixEpochSeconds,
} from '../auth/auth.types';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import {
  SynchronizeTelegramNotificationDestinationInput,
  SynchronizeTelegramNotificationDestinationResult,
  TelegramNotificationDestinationPersistenceError,
  TelegramNotificationDestinationPersistenceFailure,
  TelegramNotificationDestinationRepository,
} from './telegram-notification-destination.repository';

const MAX_TELEGRAM_CHAT_ID_TEXT = String(2 ** 52 - 1);

const ENABLE_DESTINATION_SQL = `
  WITH applied AS (
    INSERT INTO backend_auth.telegram_notification_destinations (
      account_id,
      telegram_chat_id,
      status,
      permission_granted_at,
      updated_at,
      version
    )
    VALUES ($1, $2, 'enabled', $3, $3, 1)
    ON CONFLICT (account_id) DO UPDATE
    SET telegram_chat_id = EXCLUDED.telegram_chat_id,
        status = 'enabled',
        permission_granted_at = EXCLUDED.permission_granted_at,
        updated_at = EXCLUDED.updated_at,
        disabled_at = NULL,
        disable_reason = NULL,
        version = backend_auth.telegram_notification_destinations.version + 1
    WHERE backend_auth.telegram_notification_destinations.updated_at <=
          EXCLUDED.updated_at
      AND (
        backend_auth.telegram_notification_destinations.telegram_chat_id <>
          EXCLUDED.telegram_chat_id
        OR backend_auth.telegram_notification_destinations.status <> 'enabled'
        OR backend_auth.telegram_notification_destinations.permission_granted_at <>
          EXCLUDED.permission_granted_at
        OR backend_auth.telegram_notification_destinations.disabled_at IS NOT NULL
        OR backend_auth.telegram_notification_destinations.disable_reason IS NOT NULL
      )
    RETURNING account_id, status, TRUE AS changed
  )
  SELECT account_id, status, changed
  FROM applied
  UNION ALL
  SELECT destination.account_id, destination.status, FALSE AS changed
  FROM backend_auth.telegram_notification_destinations AS destination
  WHERE destination.account_id = $1
    AND NOT EXISTS (SELECT 1 FROM applied)
`;

const DISABLE_DESTINATION_SQL = `
  WITH applied AS (
    UPDATE backend_auth.telegram_notification_destinations
    SET status = 'disabled',
        updated_at = $2,
        disabled_at = $2,
        disable_reason = 'user_revoked',
        version = version + 1
    WHERE account_id = $1
      AND updated_at <= $2
      AND NOT (
        status = 'disabled'
        AND updated_at = $2
        AND disabled_at = $2
        AND disable_reason = 'user_revoked'
      )
    RETURNING account_id, status, TRUE AS changed
  )
  SELECT account_id, status, changed
  FROM applied
  UNION ALL
  SELECT destination.account_id, destination.status, FALSE AS changed
  FROM backend_auth.telegram_notification_destinations AS destination
  WHERE destination.account_id = $1
    AND NOT EXISTS (SELECT 1 FROM applied)
  UNION ALL
  SELECT $1::uuid AS account_id, 'absent'::text AS status, FALSE AS changed
  WHERE NOT EXISTS (SELECT 1 FROM applied)
    AND NOT EXISTS (
      SELECT 1
      FROM backend_auth.telegram_notification_destinations AS destination
      WHERE destination.account_id = $1
    )
`;

interface DestinationStateRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly status: unknown;
  readonly changed: unknown;
}

function failure(
  reason: TelegramNotificationDestinationPersistenceFailure,
): TelegramNotificationDestinationPersistenceError {
  return new TelegramNotificationDestinationPersistenceError(reason);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validTelegramChatId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]*$/u.test(value) &&
    (value.length < MAX_TELEGRAM_CHAT_ID_TEXT.length ||
      (value.length === MAX_TELEGRAM_CHAT_ID_TEXT.length &&
        value <= MAX_TELEGRAM_CHAT_ID_TEXT))
  );
}

function validatePermission(
  value: unknown,
): VerifiedTelegramNotificationPermission {
  if (!isPlainRecord(value) || typeof value.status !== 'string') {
    throw failure('invalid_input');
  }
  if (value.status === 'not_granted' && Object.keys(value).length === 1) {
    return Object.freeze({ status: 'not_granted' as const });
  }
  if (
    value.status === 'granted' &&
    Object.keys(value).length === 2 &&
    Object.prototype.hasOwnProperty.call(value, 'telegramChatId') &&
    validTelegramChatId(value.telegramChatId)
  ) {
    return Object.freeze({
      status: 'granted' as const,
      telegramChatId: value.telegramChatId,
    });
  }
  throw failure('invalid_input');
}

function validateInput(
  value: unknown,
): SynchronizeTelegramNotificationDestinationInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 3 ||
    !isAccountId(value.accountId) ||
    !isUnixEpochSeconds(value.observedAt)
  ) {
    throw failure('invalid_input');
  }
  return Object.freeze({
    accountId: value.accountId,
    permission: validatePermission(value.permission),
    observedAt: value.observedAt,
  });
}

function hydrateResult(
  row: DestinationStateRow | undefined,
  input: SynchronizeTelegramNotificationDestinationInput,
): SynchronizeTelegramNotificationDestinationResult {
  if (
    row === undefined ||
    !isAccountId(row.account_id) ||
    row.account_id !== input.accountId ||
    (row.status !== 'enabled' &&
      row.status !== 'disabled' &&
      row.status !== 'absent') ||
    typeof row.changed !== 'boolean'
  ) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({
    outcome: 'synchronized' as const,
    accountId: row.account_id,
    state: row.status,
    changed: row.changed,
  });
}

function mapPersistenceError(
  error: unknown,
): TelegramNotificationDestinationPersistenceError {
  if (error instanceof TelegramNotificationDestinationPersistenceError) {
    return error;
  }
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return failure('storage_failure');
  }
  switch (classified.category) {
    case 'unique_violation':
      return failure('binding_conflict');
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

export class PostgresTelegramNotificationDestinationRepository
  implements TelegramNotificationDestinationRepository
{
  async synchronize(
    transaction: PostgresTransaction,
    inputValue: SynchronizeTelegramNotificationDestinationInput,
  ): Promise<SynchronizeTelegramNotificationDestinationResult> {
    try {
      const input = validateInput(inputValue);
      const permission = input.permission;
      const query =
        permission.status === 'granted'
          ? await transaction.query<DestinationStateRow>(
              ENABLE_DESTINATION_SQL,
              [
                input.accountId,
                permission.telegramChatId,
                input.observedAt.toString(10),
              ],
            )
          : await transaction.query<DestinationStateRow>(
              DISABLE_DESTINATION_SQL,
              [input.accountId, input.observedAt.toString(10)],
            );
      if (query.rowCount !== 1 || query.rows.length !== 1) {
        throw failure('invalid_persisted_state');
      }
      return hydrateResult(query.rows[0], input);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
