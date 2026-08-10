import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  MatchNotificationRecord,
  isMatchNotificationId,
  isMatchNotificationType,
} from '../matches/match-notification.types';
import {
  MatchWaitlistEntryId,
  isMatchWaitlistEntryId,
} from '../matches/match-waitlist.types';
import { isMatchId } from '../matches/match.types';
import { ReservationTarget, isReservationTarget } from '../reservations/reservation.types';
import {
  CreateWaitlistPromotionNotificationInput,
  CreateWaitlistPromotionNotificationResult,
  ListMatchNotificationsInput,
  ListMatchNotificationsResult,
  MarkMatchNotificationReadInput,
  MarkMatchNotificationReadResult,
  MatchNotificationPersistenceError,
  MatchNotificationPersistenceFailure,
  MatchNotificationRepository,
} from './match-notification.repository';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';

const MAX_LIST_LIMIT = 50;

const SELECT_NOTIFICATION_PAGE_SQL = `
  WITH all_notifications AS MATERIALIZED (
    SELECT
      notifications.id,
      notifications.waitlist_entry_id,
      notifications.match_id,
      notifications.recipient_account_id,
      notifications.notification_type,
      notifications.created_at,
      notifications.read_at,
      notifications.version,
      NULL::bigint AS previous_service_id,
      NULL::bigint AS previous_resource_id,
      NULL::text AS previous_datetime_text,
      NULL::text AS previous_end_datetime_text,
      NULL::bigint AS current_service_id,
      NULL::bigint AS current_resource_id,
      NULL::text AS current_datetime_text,
      NULL::text AS current_end_datetime_text
    FROM backend_match.match_notifications AS notifications
    WHERE notifications.recipient_account_id = $1
    UNION ALL
    SELECT
      events.event_id AS id,
      NULL::uuid AS waitlist_entry_id,
      events.match_id,
      recipients.recipient_account_id,
      events.event_type AS notification_type,
      recipients.created_at,
      recipients.read_at,
      recipients.version,
      events.previous_service_id,
      events.previous_resource_id,
      events.previous_datetime_text,
      events.previous_end_datetime_text,
      events.current_service_id,
      events.current_resource_id,
      events.current_datetime_text,
      events.current_end_datetime_text
    FROM backend_match.match_reservation_event_recipients AS recipients
    JOIN backend_match.match_reservation_events AS events
      ON events.event_id = recipients.event_id
    WHERE recipients.recipient_account_id = $1
  ),
  paged_notifications AS MATERIALIZED (
    SELECT *
    FROM all_notifications AS notifications
    WHERE (
        $2::bigint IS NULL
        OR (notifications.created_at, notifications.id)
          < ($2::bigint, $3::uuid)
      )
    ORDER BY notifications.created_at DESC, notifications.id DESC
    LIMIT $4::integer
  ),
  unread_notifications AS MATERIALIZED (
    SELECT pg_catalog.count(*) AS unread_count
    FROM all_notifications AS notifications
    WHERE notifications.read_at IS NULL
  )
  SELECT
    paged_notifications.id,
    paged_notifications.waitlist_entry_id,
    paged_notifications.match_id,
    paged_notifications.recipient_account_id,
    paged_notifications.notification_type,
    paged_notifications.created_at,
    paged_notifications.read_at,
    paged_notifications.version,
    paged_notifications.previous_service_id,
    paged_notifications.previous_resource_id,
    paged_notifications.previous_datetime_text,
    paged_notifications.previous_end_datetime_text,
    paged_notifications.current_service_id,
    paged_notifications.current_resource_id,
    paged_notifications.current_datetime_text,
    paged_notifications.current_end_datetime_text,
    unread_notifications.unread_count
  FROM unread_notifications
  LEFT JOIN paged_notifications ON true
  ORDER BY
    paged_notifications.created_at DESC NULLS LAST,
    paged_notifications.id DESC NULLS LAST
`;

const MARK_LIFECYCLE_NOTIFICATION_READ_SQL = `
  WITH updated_recipient AS MATERIALIZED (
    UPDATE backend_match.match_reservation_event_recipients AS recipients
    SET read_at = $3, version = 2
    WHERE recipients.event_id = $1
      AND recipients.recipient_account_id = $2
      AND recipients.read_at IS NULL
      AND recipients.version = 1
      AND recipients.created_at <= $3
    RETURNING recipients.event_id, recipients.recipient_account_id,
      recipients.created_at, recipients.read_at, recipients.version
  ), selected_recipient AS MATERIALIZED (
    SELECT updated_recipient.*, true AS was_updated
    FROM updated_recipient
    UNION ALL
    SELECT recipients.event_id, recipients.recipient_account_id,
      recipients.created_at, recipients.read_at, recipients.version,
      false AS was_updated
    FROM backend_match.match_reservation_event_recipients AS recipients
    WHERE recipients.event_id = $1
      AND recipients.recipient_account_id = $2
      AND NOT EXISTS (SELECT 1 FROM updated_recipient)
    LIMIT 1
  )
  SELECT
    events.event_id AS id,
    NULL::uuid AS waitlist_entry_id,
    events.match_id,
    selected_recipient.recipient_account_id,
    events.event_type AS notification_type,
    selected_recipient.created_at,
    selected_recipient.read_at,
    selected_recipient.version,
    events.previous_service_id,
    events.previous_resource_id,
    events.previous_datetime_text,
    events.previous_end_datetime_text,
    events.current_service_id,
    events.current_resource_id,
    events.current_datetime_text,
    events.current_end_datetime_text,
    selected_recipient.was_updated
  FROM selected_recipient
  JOIN backend_match.match_reservation_events AS events
    ON events.event_id = selected_recipient.event_id
`;

const MARK_NOTIFICATION_READ_SQL = `
  WITH updated_notification AS MATERIALIZED (
    UPDATE backend_match.match_notifications AS notifications
    SET
      read_at = $3,
      version = 2
    WHERE notifications.id = $1
      AND notifications.recipient_account_id = $2
      AND notifications.read_at IS NULL
      AND notifications.version = 1
      AND notifications.created_at <= $3
    RETURNING
      notifications.id,
      notifications.waitlist_entry_id,
      notifications.match_id,
      notifications.recipient_account_id,
      notifications.notification_type,
      notifications.created_at,
      notifications.read_at,
      notifications.version
  )
  SELECT
    updated_notification.*,
    true AS was_updated
  FROM updated_notification
  UNION ALL
  SELECT
    notifications.id,
    notifications.waitlist_entry_id,
    notifications.match_id,
    notifications.recipient_account_id,
    notifications.notification_type,
    notifications.created_at,
    notifications.read_at,
    notifications.version,
    false AS was_updated
  FROM backend_match.match_notifications AS notifications
  WHERE notifications.id = $1
    AND notifications.recipient_account_id = $2
    AND NOT EXISTS (SELECT 1 FROM updated_notification)
  LIMIT 1
`;

const INSERT_WAITLIST_PROMOTION_NOTIFICATION_SQL = `
  INSERT INTO backend_match.match_notifications (
    id,
    waitlist_entry_id,
    match_id,
    recipient_account_id,
    notification_type,
    created_at,
    version
  )
  VALUES ($1, $2, $3, $4, 'waitlist_promoted', $5, 1)
  ON CONFLICT (waitlist_entry_id) DO NOTHING
  RETURNING
    id,
    waitlist_entry_id,
    match_id,
    recipient_account_id,
    notification_type,
    created_at,
    read_at,
    version
`;

const SELECT_NOTIFICATION_BY_WAITLIST_ENTRY_SQL = `
  SELECT
    id,
    waitlist_entry_id,
    match_id,
    recipient_account_id,
    notification_type,
    created_at,
    read_at,
    version
  FROM backend_match.match_notifications
  WHERE waitlist_entry_id = $1
`;

interface NotificationRow extends QueryResultRow {
  readonly id: unknown;
  readonly waitlist_entry_id: unknown;
  readonly match_id: unknown;
  readonly recipient_account_id: unknown;
  readonly notification_type: unknown;
  readonly created_at: unknown;
  readonly read_at: unknown;
  readonly version: unknown;
  readonly previous_service_id: unknown;
  readonly previous_resource_id: unknown;
  readonly previous_datetime_text: unknown;
  readonly previous_end_datetime_text: unknown;
  readonly current_service_id: unknown;
  readonly current_resource_id: unknown;
  readonly current_datetime_text: unknown;
  readonly current_end_datetime_text: unknown;
}

interface NotificationPageRow extends NotificationRow {
  readonly unread_count: unknown;
}

interface MarkNotificationRow extends NotificationRow {
  readonly was_updated: unknown;
}

function failure(
  reason: MatchNotificationPersistenceFailure,
): MatchNotificationPersistenceError {
  return new MatchNotificationPersistenceError(reason);
}

function invalidInput(): MatchNotificationPersistenceError {
  return failure('invalid_input');
}

function invalidState(): MatchNotificationPersistenceError {
  return failure('invalid_persisted_state');
}

function readSafeInteger(value: unknown): number {
  const parsed =
    typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)
      ? Number(value)
      : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) {
    throw invalidState();
  }
  return Number(parsed);
}

function readEpoch(value: unknown) {
  const parsed = readSafeInteger(value);
  if (!isUnixEpochSeconds(parsed)) throw invalidState();
  return parsed;
}

function hydrateNotification(
  row: NotificationRow,
): MatchNotificationRecord {
  if (
    !isMatchNotificationId(row.id) ||
    !isMatchId(row.match_id) ||
    !isAccountId(row.recipient_account_id) ||
    !isMatchNotificationType(row.notification_type)
  ) {
    throw invalidState();
  }
  let waitlistEntryId: MatchWaitlistEntryId | undefined;
  if (row.waitlist_entry_id !== null && row.waitlist_entry_id !== undefined) {
    if (!isMatchWaitlistEntryId(row.waitlist_entry_id)) throw invalidState();
    waitlistEntryId = row.waitlist_entry_id;
  }
  if (
    (row.notification_type === 'waitlist_promoted' &&
      !isMatchWaitlistEntryId(waitlistEntryId)) ||
    (row.notification_type !== 'waitlist_promoted' &&
      waitlistEntryId !== undefined)
  ) {
    throw invalidState();
  }
  const target = (
    serviceId: unknown,
    courtId: unknown,
    startsAt: unknown,
    endsAt: unknown,
  ): ReservationTarget | undefined => {
    if (
      serviceId == null &&
      courtId == null &&
      startsAt == null &&
      endsAt == null
    ) return undefined;
    const candidate = Object.freeze({
      serviceId: readSafeInteger(serviceId),
      courtId: readSafeInteger(courtId),
      startsAt,
      endsAt,
    });
    if (!isReservationTarget(candidate)) throw invalidState();
    return candidate;
  };
  const previousTarget = target(
    row.previous_service_id,
    row.previous_resource_id,
    row.previous_datetime_text,
    row.previous_end_datetime_text,
  );
  const currentTarget = target(
    row.current_service_id,
    row.current_resource_id,
    row.current_datetime_text,
    row.current_end_datetime_text,
  );
  const targetShapeValid =
    (row.notification_type === 'waitlist_promoted' &&
      previousTarget === undefined && currentTarget === undefined) ||
    (row.notification_type === 'court_confirmed' &&
      previousTarget === undefined && currentTarget !== undefined) ||
    (row.notification_type === 'court_moved' &&
      previousTarget !== undefined && currentTarget !== undefined) ||
    (row.notification_type === 'court_cancelled' &&
      previousTarget !== undefined && currentTarget === undefined);
  if (!targetShapeValid) throw invalidState();
  const createdAt = readEpoch(row.created_at);
  const version = readSafeInteger(row.version);
  const readAt = row.read_at === null ? undefined : readEpoch(row.read_at);
  if (
    (readAt === undefined && version !== 1) ||
    (readAt !== undefined && (version !== 2 || readAt < createdAt))
  ) {
    throw invalidState();
  }
  return Object.freeze({
    notificationId: row.id,
    ...(waitlistEntryId === undefined ? {} : { waitlistEntryId }),
    matchId: row.match_id,
    recipientAccountId: row.recipient_account_id,
    notificationType: row.notification_type,
    createdAt,
    ...(readAt === undefined ? {} : { readAt }),
    ...(previousTarget === undefined ? {} : { previousTarget }),
    ...(currentTarget === undefined ? {} : { currentTarget }),
  });
}

function validateListInput(
  input: ListMatchNotificationsInput,
): ListMatchNotificationsInput {
  if (
    !isAccountId(input.recipientAccountId) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_LIST_LIMIT ||
    (input.before !== undefined &&
      (!isUnixEpochSeconds(input.before.createdAt) ||
        !isMatchNotificationId(input.before.notificationId)))
  ) {
    throw invalidInput();
  }
  return input;
}

function validateMarkInput(
  input: MarkMatchNotificationReadInput,
): MarkMatchNotificationReadInput {
  if (
    !isMatchNotificationId(input.notificationId) ||
    !isAccountId(input.recipientAccountId) ||
    !isUnixEpochSeconds(input.now)
  ) {
    throw invalidInput();
  }
  return input;
}

function validateCreateInput(
  input: CreateWaitlistPromotionNotificationInput,
): CreateWaitlistPromotionNotificationInput {
  if (
    !isMatchNotificationId(input.notificationId) ||
    !isMatchWaitlistEntryId(input.waitlistEntryId) ||
    !isMatchId(input.matchId) ||
    !isAccountId(input.recipientAccountId) ||
    !isUnixEpochSeconds(input.now)
  ) {
    throw invalidInput();
  }
  return input;
}

function exactOne(
  rowCount: number | null,
  rows: readonly unknown[],
): void {
  if (rowCount !== 1 || rows.length !== 1) throw invalidState();
}

function mapPersistenceError(
  error: unknown,
): MatchNotificationPersistenceError {
  if (error instanceof MatchNotificationPersistenceError) return error;
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return failure('storage_failure');
  }
  const { category, metadata } = classified;
  if (category === 'unique_violation') {
    switch (metadata.constraint) {
      case 'match_notifications_pkey':
      case 'match_notifications_waitlist_entry_key':
        return failure('notification_conflict');
      default:
        return failure('storage_failure');
    }
  }
  switch (category) {
    case 'foreign_key_violation':
      return failure('referential_integrity');
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

function hasNotificationBinding(
  notification: MatchNotificationRecord,
  input: CreateWaitlistPromotionNotificationInput,
): boolean {
  return (
    notification.notificationId === input.notificationId &&
    notification.waitlistEntryId === input.waitlistEntryId &&
    notification.matchId === input.matchId &&
    notification.recipientAccountId === input.recipientAccountId &&
    notification.notificationType === 'waitlist_promoted'
  );
}

function assertInsertedNotification(
  notification: MatchNotificationRecord,
  input: CreateWaitlistPromotionNotificationInput,
): void {
  if (
    !hasNotificationBinding(notification, input) ||
    notification.createdAt !== input.now ||
    notification.readAt !== undefined
  ) throw invalidState();
}

function assertReplayNotification(
  notification: MatchNotificationRecord,
  input: CreateWaitlistPromotionNotificationInput,
): void {
  if (
    !hasNotificationBinding(notification, input) ||
    notification.createdAt > input.now
  ) throw failure('notification_conflict');
}

export class PostgresMatchNotificationRepository
  implements MatchNotificationRepository
{
  async list(
    transaction: PostgresTransaction,
    input: ListMatchNotificationsInput,
  ): Promise<ListMatchNotificationsResult> {
    try {
      const validated = validateListInput(input);
      const selected = await transaction.query<NotificationPageRow>(
        SELECT_NOTIFICATION_PAGE_SQL,
        [
          validated.recipientAccountId,
          validated.before?.createdAt ?? null,
          validated.before?.notificationId ?? null,
          validated.limit + 1,
        ],
      );
      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length < 1 ||
        selected.rows.length > validated.limit + 1
      ) {
        throw invalidState();
      }
      const unreadCounts = selected.rows.map((row) =>
        readSafeInteger(row.unread_count),
      );
      if (new Set(unreadCounts).size !== 1) throw invalidState();
      const unreadCount = unreadCounts[0];
      if (unreadCount === undefined) throw invalidState();

      if (selected.rows.length === 1 && selected.rows[0].id === null) {
        const empty = selected.rows[0];
        if (
          empty.waitlist_entry_id !== null ||
          empty.match_id !== null ||
          empty.recipient_account_id !== null ||
          empty.notification_type !== null ||
          empty.created_at !== null ||
          empty.read_at !== null ||
          empty.version !== null
        ) {
          throw invalidState();
        }
        return Object.freeze({
          outcome: 'found',
          notifications: Object.freeze([]),
          unreadCount,
        });
      }
      if (selected.rows.some((row) => row.id === null)) {
        throw invalidState();
      }
      const hydrated = selected.rows.map(hydrateNotification);
      if (
        hydrated.some(
          (notification) =>
            notification.recipientAccountId !==
            validated.recipientAccountId,
        ) ||
        new Set(
          hydrated.map((notification) => notification.notificationId),
        ).size !== hydrated.length
      ) {
        throw invalidState();
      }
      const hasMore = hydrated.length > validated.limit;
      const notifications = hydrated.slice(0, validated.limit);
      const oldest = notifications.at(-1);
      return Object.freeze({
        outcome: 'found',
        notifications: Object.freeze(notifications),
        unreadCount,
        ...(hasMore && oldest !== undefined
          ? {
              nextCursor: Object.freeze({
                createdAt: oldest.createdAt,
                notificationId: oldest.notificationId,
              }),
            }
          : {}),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async markRead(
    transaction: PostgresTransaction,
    input: MarkMatchNotificationReadInput,
  ): Promise<MarkMatchNotificationReadResult> {
    try {
      const validated = validateMarkInput(input);
      const selected = await transaction.query<MarkNotificationRow>(
        MARK_NOTIFICATION_READ_SQL,
        [
          validated.notificationId,
          validated.recipientAccountId,
          validated.now,
        ],
      );
      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length > 1
      ) {
        throw invalidState();
      }
      if (selected.rows.length === 0) {
        const lifecycle = await transaction.query<MarkNotificationRow>(
          MARK_LIFECYCLE_NOTIFICATION_READ_SQL,
          [
            validated.notificationId,
            validated.recipientAccountId,
            validated.now,
          ],
        );
        if (
          lifecycle.rowCount !== lifecycle.rows.length ||
          lifecycle.rows.length > 1
        ) throw invalidState();
        if (lifecycle.rows.length === 0) {
          return Object.freeze({
            outcome: 'rejected',
            reason: 'notification_not_found',
          });
        }
        const row = lifecycle.rows[0];
        if (typeof row.was_updated !== 'boolean') throw invalidState();
        const notification = hydrateNotification(row);
        if (
          notification.notificationId !== validated.notificationId ||
          notification.recipientAccountId !== validated.recipientAccountId ||
          notification.readAt === undefined ||
          (row.was_updated && notification.readAt !== validated.now)
        ) throw invalidState();
        return Object.freeze({
          outcome: 'notification_read',
          persistence: row.was_updated ? 'applied' : 'idempotent_retry',
          notification,
        });
      }
      const row = selected.rows[0];
      if (typeof row.was_updated !== 'boolean') throw invalidState();
      const notification = hydrateNotification(row);
      if (
        notification.notificationId !== validated.notificationId ||
        notification.recipientAccountId !==
          validated.recipientAccountId ||
        notification.readAt === undefined ||
        (row.was_updated && notification.readAt !== validated.now)
      ) {
        throw invalidState();
      }
      return Object.freeze({
        outcome: 'notification_read',
        persistence: row.was_updated
          ? 'applied'
          : 'idempotent_retry',
        notification,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async createWaitlistPromotion(
    transaction: PostgresTransaction,
    input: CreateWaitlistPromotionNotificationInput,
  ): Promise<CreateWaitlistPromotionNotificationResult> {
    try {
      const validated = validateCreateInput(input);
      const inserted = await transaction.query<NotificationRow>(
        INSERT_WAITLIST_PROMOTION_NOTIFICATION_SQL,
        [
          validated.notificationId,
          validated.waitlistEntryId,
          validated.matchId,
          validated.recipientAccountId,
          validated.now,
        ],
      );
      if (
        inserted.rowCount !== inserted.rows.length ||
        inserted.rows.length > 1
      ) {
        throw invalidState();
      }
      if (inserted.rows.length === 1) {
        const notification = hydrateNotification(inserted.rows[0]);
        assertInsertedNotification(notification, validated);
        return Object.freeze({
          outcome: 'notification_created',
          persistence: 'applied',
          notification,
        });
      }

      const existing = await transaction.query<NotificationRow>(
        SELECT_NOTIFICATION_BY_WAITLIST_ENTRY_SQL,
        [validated.waitlistEntryId],
      );
      exactOne(existing.rowCount, existing.rows);
      const notification = hydrateNotification(existing.rows[0]);
      assertReplayNotification(notification, validated);
      return Object.freeze({
        outcome: 'notification_created',
        persistence: 'idempotent_retry',
        notification,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
