import { Injectable } from '@nestjs/common';
import { QueryResultRow } from 'pg';
import { AccountId, isAccountId } from '../accounts/account.types';
import { UnixEpochSeconds, isUnixEpochSeconds } from '../auth/auth.types';
import { isInternalUuid } from '../common/internal-uuid';
import { MatchId, isMatchId } from '../matches/match.types';
import {
  ClaimedTelegramNotificationIntent,
  TELEGRAM_NOTIFICATION_CATEGORIES,
  TELEGRAM_NOTIFICATION_EVENT_TYPES,
  TelegramDestinationDisableReason,
  TelegramNotificationCategory,
  TelegramNotificationEventType,
  TelegramNotificationRetryFailure,
  TelegramNotificationTerminalFailure,
} from '../notifications/telegram-notification-intent.types';
import {
  CourtReservationId,
  isCourtReservationId,
} from '../reservations/reservation.types';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';
import {
  ClaimExactTelegramInvitationCanaryInput,
  ClaimTelegramNotificationIntentInput,
  EnqueueDirectTelegramNotificationIntentInput,
  EnqueueMatchAudienceTelegramNotificationIntentInput,
  FinalizeTelegramNotificationIntentInput,
  TelegramNotificationIntentBase,
  TelegramNotificationIntentClaimResult,
  TelegramNotificationIntentFinalizeResult,
  TelegramNotificationIntentPersistenceError,
  TelegramNotificationIntentPersistenceFailure,
  TelegramNotificationIntentRepository,
} from './telegram-notification-intent.repository';

const MAX_BIGINT_TEXT = '9007199254740991';
const EVENT_KEY_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,255}$/u;
const MAX_ATTEMPTS = 20;
const INVITATION_CANARY_MAX_AGE_SECONDS = 3_600;

const EVENT_CATEGORY: Readonly<
  Record<TelegramNotificationEventType, TelegramNotificationCategory>
> = Object.freeze({
  match_invited: 'match_activity',
  waitlist_slot_available: 'match_activity',
  match_schedule_changed: 'match_activity',
  match_cancelled: 'match_activity',
  participant_joined: 'match_activity',
  participant_left: 'match_activity',
  chat_message_created: 'chat_messages',
  match_reminder_24h: 'match_reminders',
  match_reminder_2h: 'match_reminders',
  reservation_confirmed: 'booking_updates',
  reservation_rescheduled: 'booking_updates',
  reservation_cancelled: 'booking_updates',
});

const ENQUEUE_DIRECT_SQL = `
  WITH inserted AS (
    INSERT INTO backend_notification.telegram_delivery_intents (
      event_key, event_type, category, source_id, source_version,
      recipient_account_id, match_id, reservation_id, occurred_at,
      available_at, status, attempt_count, updated_at, version
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'pending',0,$9,1)
    ON CONFLICT (event_key, recipient_account_id) DO NOTHING
    RETURNING *
  )
  SELECT event_key, event_type, category, source_id, source_version,
    recipient_account_id, match_id, reservation_id, occurred_at, true AS inserted
  FROM inserted
  UNION ALL
  SELECT event_key, event_type, category, source_id, source_version,
    recipient_account_id, match_id, reservation_id, occurred_at, false AS inserted
  FROM backend_notification.telegram_delivery_intents
  WHERE event_key = $1 AND recipient_account_id = $6
    AND NOT EXISTS (SELECT 1 FROM inserted)
`;

const ENQUEUE_MATCH_OWNER_SQL = `
  WITH recipient AS MATERIALIZED (
    SELECT owner_account_id AS account_id
    FROM backend_match.matches
    WHERE id = $6
  ), inserted AS (
    INSERT INTO backend_notification.telegram_delivery_intents (
      event_key, event_type, category, source_id, source_version,
      recipient_account_id, match_id, reservation_id, occurred_at,
      available_at, status, attempt_count, updated_at, version
    )
    SELECT $1,$2,$3,$4,$5,account_id,$6,$7,$8,$8,'pending',0,$8,1
    FROM recipient
    ON CONFLICT (event_key, recipient_account_id) DO NOTHING
    RETURNING *
  )
  SELECT event_key, event_type, category, source_id, source_version,
    recipient_account_id, match_id, reservation_id, occurred_at, true AS inserted
  FROM inserted
  UNION ALL
  SELECT intent.event_key, intent.event_type, intent.category, intent.source_id,
    intent.source_version, intent.recipient_account_id, intent.match_id,
    intent.reservation_id, intent.occurred_at, false AS inserted
  FROM backend_notification.telegram_delivery_intents AS intent
  JOIN recipient ON recipient.account_id = intent.recipient_account_id
  WHERE intent.event_key = $1 AND NOT EXISTS (SELECT 1 FROM inserted)
`;

const ENQUEUE_MATCH_AUDIENCE_SQL = `
  WITH recipients AS MATERIALIZED (
    SELECT matches.owner_account_id AS account_id
    FROM backend_match.matches AS matches
    WHERE matches.id = $6
    UNION
    SELECT participants.account_id
    FROM backend_match.match_participants AS participants
    WHERE participants.match_id = $6 AND participants.status = 'active'
  ), expected AS MATERIALIZED (
    SELECT account_id FROM recipients WHERE $9::uuid IS NULL OR account_id <> $9
  ), inserted AS (
    INSERT INTO backend_notification.telegram_delivery_intents (
      event_key, event_type, category, source_id, source_version,
      recipient_account_id, match_id, reservation_id, occurred_at,
      available_at, status, attempt_count, updated_at, version
    )
    SELECT $1,$2,$3,$4,$5,account_id,$6,$7,$8,$8,'pending',0,$8,1
    FROM expected
    ON CONFLICT (event_key, recipient_account_id) DO NOTHING
    RETURNING *
  )
  SELECT intent.event_key, intent.event_type, intent.category, intent.source_id,
    intent.source_version, intent.recipient_account_id, intent.match_id,
    intent.reservation_id, intent.occurred_at,
    EXISTS (
      SELECT 1 FROM inserted
      WHERE inserted.event_key = intent.event_key
        AND inserted.recipient_account_id = intent.recipient_account_id
    ) AS inserted
  FROM backend_notification.telegram_delivery_intents AS intent
  JOIN expected ON expected.account_id = intent.recipient_account_id
  WHERE intent.event_key = $1
  ORDER BY intent.recipient_account_id
`;

const ENQUEUE_DUE_REMINDERS_SQL = `
  WITH due_matches AS MATERIALIZED (
    SELECT matches.id, matches.owner_account_id, matches.starts_at,
      reminder.event_type
    FROM backend_match.matches AS matches
    CROSS JOIN LATERAL (
      SELECT 'match_reminder_24h'::text AS event_type
      WHERE matches.starts_at - 86400 <= $1
        AND matches.starts_at - 7200 > $1
      UNION ALL
      SELECT 'match_reminder_2h'::text AS event_type
      WHERE matches.starts_at - 7200 <= $1
        AND matches.starts_at > $1
    ) AS reminder
    WHERE matches.status IN ('open','searching','confirmed','upcoming')
      AND NOT EXISTS (
        SELECT 1
        FROM backend_notification.telegram_delivery_intents AS existing
        WHERE existing.event_key = reminder.event_type || ':'
          || matches.id::text || ':' || matches.starts_at::text
      )
    ORDER BY matches.starts_at, matches.id, reminder.event_type
    LIMIT $2
    FOR UPDATE OF matches SKIP LOCKED
  ), recipients AS MATERIALIZED (
    SELECT due.id AS match_id, due.starts_at, due.event_type,
      due.owner_account_id AS account_id
    FROM due_matches AS due
    UNION
    SELECT due.id, due.starts_at, due.event_type, participant.account_id
    FROM due_matches AS due
    JOIN backend_match.match_participants AS participant
      ON participant.match_id = due.id AND participant.status = 'active'
  ), inserted AS (
    INSERT INTO backend_notification.telegram_delivery_intents (
      event_key, event_type, category, source_id, source_version,
      recipient_account_id, match_id, occurred_at, available_at,
      status, attempt_count, updated_at, version
    )
    SELECT event_type || ':' || match_id::text || ':' || starts_at::text,
      event_type, 'match_reminders', match_id, starts_at, account_id,
      match_id, $1, $1, 'pending', 0, $1, 1
    FROM recipients
    ON CONFLICT (event_key, recipient_account_id) DO NOTHING
    RETURNING event_key
  )
  SELECT count(*)::bigint AS inserted_count FROM inserted
`;

const ABANDON_AMBIGUOUS_SQL = `
  UPDATE backend_notification.telegram_delivery_intents AS intent
  SET status='abandoned', updated_at=$1, failure_code='delivery_unknown',
      version=intent.version+1
  WHERE (intent.event_key, intent.recipient_account_id) = (
    SELECT pending.event_key, pending.recipient_account_id
    FROM backend_notification.telegram_delivery_intents AS pending
    WHERE pending.status='pending' AND pending.available_at <= $1
      AND pending.attempt_count > 0 AND pending.failure_code IS NULL
    ORDER BY pending.available_at, pending.occurred_at, pending.event_key,
      pending.recipient_account_id
    FOR UPDATE SKIP LOCKED LIMIT 1
  )
  RETURNING event_key
`;

const ABANDON_EXHAUSTED_SQL = `
  UPDATE backend_notification.telegram_delivery_intents AS intent
  SET status='abandoned', updated_at=$1, failure_code='retry_exhausted',
      version=intent.version+1
  WHERE (intent.event_key, intent.recipient_account_id) = (
    SELECT pending.event_key, pending.recipient_account_id
    FROM backend_notification.telegram_delivery_intents AS pending
    WHERE pending.status='pending' AND pending.available_at <= $1
      AND pending.attempt_count >= ${MAX_ATTEMPTS}
    ORDER BY pending.available_at, pending.occurred_at, pending.event_key,
      pending.recipient_account_id
    FOR UPDATE SKIP LOCKED LIMIT 1
  )
  RETURNING event_key
`;

const CLAIM_NEXT_SQL = `
  WITH candidate AS MATERIALIZED (
    SELECT intent.*,
      destination.telegram_chat_id,
      destination.version AS destination_version,
      CASE
        WHEN (
          intent.event_type IN ('match_reminder_24h','match_reminder_2h')
          AND (
            matches.id IS NULL OR matches.starts_at <> intent.source_version
            OR matches.starts_at <= $1
            OR matches.status IN ('completed','cancelled')
          )
        ) OR (
          intent.event_type = 'chat_message_created'
          AND (matches.id IS NULL OR matches.status IN ('completed','cancelled'))
        ) OR (
          intent.event_type IN (
            'reservation_confirmed','reservation_rescheduled',
            'reservation_cancelled','match_schedule_changed'
          )
          AND reservations.version > intent.source_version
        ) THEN 'stale_event'
        WHEN destination.status IS DISTINCT FROM 'enabled'
          THEN 'destination_unavailable'
        WHEN NOT (
          COALESCE(preference.telegram_match_notifications_enabled, true)
          AND CASE intent.category
            WHEN 'match_activity' THEN
              COALESCE(preference.telegram_match_activity_enabled, true)
            WHEN 'chat_messages' THEN
              COALESCE(preference.telegram_chat_messages_enabled, true)
            WHEN 'match_reminders' THEN
              COALESCE(preference.telegram_match_reminders_enabled, true)
            WHEN 'booking_updates' THEN
              COALESCE(preference.telegram_booking_updates_enabled, true)
          END
        ) THEN 'preference_disabled'
      END AS terminal_reason
    FROM backend_notification.telegram_delivery_intents AS intent
    LEFT JOIN backend_auth.telegram_notification_destinations AS destination
      ON destination.account_id = intent.recipient_account_id
    LEFT JOIN backend_auth.account_notification_preferences AS preference
      ON preference.account_id = intent.recipient_account_id
    LEFT JOIN backend_match.matches AS matches ON matches.id = intent.match_id
    LEFT JOIN backend_reservation.court_reservations AS reservations
      ON reservations.reservation_id = intent.reservation_id
    CROSS JOIN backend_notification.telegram_delivery_rate_budget AS rate
    WHERE intent.status='pending' AND intent.available_at <= $1
      AND intent.attempt_count < ${MAX_ATTEMPTS}
      AND rate.singleton = true
      AND (
        CASE
          WHEN (
            intent.event_type IN ('match_reminder_24h','match_reminder_2h')
            AND (
              matches.id IS NULL OR matches.starts_at <> intent.source_version
              OR matches.starts_at <= $1
              OR matches.status IN ('completed','cancelled')
            )
          ) OR (
            intent.event_type = 'chat_message_created'
            AND (matches.id IS NULL OR matches.status IN ('completed','cancelled'))
          ) OR (
            intent.event_type IN (
              'reservation_confirmed','reservation_rescheduled',
              'reservation_cancelled','match_schedule_changed'
            ) AND reservations.version > intent.source_version
          ) THEN true
          WHEN destination.status IS DISTINCT FROM 'enabled' THEN true
          WHEN NOT (
            COALESCE(preference.telegram_match_notifications_enabled, true)
            AND CASE intent.category
              WHEN 'match_activity' THEN
                COALESCE(preference.telegram_match_activity_enabled, true)
              WHEN 'chat_messages' THEN
                COALESCE(preference.telegram_chat_messages_enabled, true)
              WHEN 'match_reminders' THEN
                COALESCE(preference.telegram_match_reminders_enabled, true)
              WHEN 'booking_updates' THEN
                COALESCE(preference.telegram_booking_updates_enabled, true)
            END
          ) THEN true
          ELSE rate.next_send_at <= $1
        END
      )
    ORDER BY intent.available_at, intent.occurred_at,
      intent.event_key, intent.recipient_account_id
    FOR UPDATE OF intent, rate SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE backend_notification.telegram_delivery_intents AS intent
    SET available_at=$2, attempt_count=intent.attempt_count+1,
      updated_at=$1, failure_code=NULL, version=intent.version+1
    FROM candidate
    WHERE intent.event_key=candidate.event_key
      AND intent.recipient_account_id=candidate.recipient_account_id
    RETURNING intent.*, candidate.terminal_reason
  ), budget AS (
    UPDATE backend_notification.telegram_delivery_rate_budget AS rate
    SET next_send_at=$1+1, updated_at=$1, version=rate.version+1
    WHERE rate.singleton=true
      AND EXISTS (
        SELECT 1 FROM claimed WHERE claimed.terminal_reason IS NULL
      )
    RETURNING singleton
  )
  SELECT claimed.*, destination.telegram_chat_id,
    destination.version AS destination_version
  FROM claimed
  LEFT JOIN backend_auth.telegram_notification_destinations AS destination
    ON destination.account_id=claimed.recipient_account_id
`;

const CLAIM_EXACT_INVITATION_CANARY_SQL = `
  WITH event_scope AS MATERIALIZED (
    SELECT count(*)::bigint AS recipient_count
    FROM backend_notification.telegram_delivery_intents
    WHERE event_key=$3
  ), candidate AS MATERIALIZED (
    SELECT intent.*, destination.telegram_chat_id,
      destination.version AS destination_version
    FROM backend_notification.telegram_delivery_intents AS intent
    JOIN backend_match.match_invitations AS invitation
      ON invitation.id=intent.source_id
      AND invitation.match_id=intent.match_id
      AND invitation.invited_account_id=intent.recipient_account_id
    JOIN backend_match.matches AS matches ON matches.id=intent.match_id
    JOIN backend_auth.telegram_notification_destinations AS destination
      ON destination.account_id=intent.recipient_account_id
    LEFT JOIN backend_auth.account_notification_preferences AS preference
      ON preference.account_id=intent.recipient_account_id
    CROSS JOIN backend_notification.telegram_delivery_rate_budget AS rate
    CROSS JOIN event_scope
    WHERE intent.event_key=$3 AND intent.recipient_account_id=$4
      AND intent.event_key='match_invited:' || intent.source_id::text
      AND intent.event_type='match_invited'
      AND intent.category='match_activity'
      AND intent.status='pending' AND intent.available_at <= $1
      AND intent.attempt_count=0 AND intent.failure_code IS NULL
      AND intent.occurred_at >= $1-${INVITATION_CANARY_MAX_AGE_SECONDS}
      AND invitation.status='pending' AND invitation.version=1
      AND invitation.created_at=intent.occurred_at
      AND intent.source_version=invitation.version
      AND matches.status IN ('open','searching','confirmed','upcoming')
      AND matches.starts_at > $1
      AND destination.status='enabled'
      AND COALESCE(preference.telegram_match_notifications_enabled, true)
      AND COALESCE(preference.telegram_match_activity_enabled, true)
      AND rate.singleton=true AND rate.next_send_at <= $1
      AND event_scope.recipient_count=1
    FOR UPDATE OF intent, rate SKIP LOCKED
  ), claimed AS (
    UPDATE backend_notification.telegram_delivery_intents AS intent
    SET available_at=$2, attempt_count=1, updated_at=$1,
      failure_code=NULL, version=intent.version+1
    FROM candidate
    WHERE intent.event_key=candidate.event_key
      AND intent.recipient_account_id=candidate.recipient_account_id
    RETURNING intent.*
  ), budget AS (
    UPDATE backend_notification.telegram_delivery_rate_budget AS rate
    SET next_send_at=$1+1, updated_at=$1, version=rate.version+1
    WHERE rate.singleton=true AND EXISTS (SELECT 1 FROM claimed)
    RETURNING singleton
  )
  SELECT claimed.*, destination.telegram_chat_id,
    destination.version AS destination_version
  FROM claimed
  JOIN backend_auth.telegram_notification_destinations AS destination
    ON destination.account_id=claimed.recipient_account_id
`;

const MARK_SENT_SQL = `
  UPDATE backend_notification.telegram_delivery_intents
  SET status='sent', updated_at=$4, sent_at=$4, telegram_message_id=$5,
    failure_code=NULL, version=version+1
  WHERE event_key=$1 AND recipient_account_id=$2 AND version=$3
    AND status='pending'
  RETURNING event_key
`;

const SCHEDULE_RETRY_SQL = `
  UPDATE backend_notification.telegram_delivery_intents
  SET available_at=$5, updated_at=$4, failure_code=$6, version=version+1
  WHERE event_key=$1 AND recipient_account_id=$2 AND version=$3
    AND status='pending'
  RETURNING event_key
`;

const ABANDON_SQL = `
  WITH finalized AS MATERIALIZED (
    UPDATE backend_notification.telegram_delivery_intents
    SET status=CASE WHEN $5='stale_event' THEN 'superseded' ELSE 'abandoned' END,
      updated_at=$4, failure_code=$5, version=version+1
    WHERE event_key=$1 AND recipient_account_id=$2 AND version=$3
      AND status='pending'
    RETURNING recipient_account_id
  ), disabled AS (
    UPDATE backend_auth.telegram_notification_destinations AS destination
    SET status='disabled', updated_at=$4, disabled_at=$4,
      disable_reason=$6, version=destination.version+1
    FROM finalized
    WHERE $6::text IS NOT NULL
      AND destination.account_id=finalized.recipient_account_id
      AND destination.status='enabled' AND destination.version=$7
    RETURNING destination.account_id
  )
  SELECT EXISTS (SELECT 1 FROM finalized) AS applied
`;

interface IntentRow extends QueryResultRow {
  readonly event_key: unknown;
  readonly event_type: unknown;
  readonly category: unknown;
  readonly source_id: unknown;
  readonly source_version: unknown;
  readonly recipient_account_id: unknown;
  readonly match_id: unknown;
  readonly reservation_id: unknown;
  readonly occurred_at: unknown;
  readonly inserted?: unknown;
  readonly attempt_count?: unknown;
  readonly version?: unknown;
  readonly telegram_chat_id?: unknown;
  readonly destination_version?: unknown;
  readonly terminal_reason?: unknown;
}

interface CountRow extends QueryResultRow {
  readonly inserted_count: unknown;
}

interface AppliedRow extends QueryResultRow {
  readonly event_key?: unknown;
  readonly applied?: unknown;
}

function failure(
  reason: TelegramNotificationIntentPersistenceFailure,
): TelegramNotificationIntentPersistenceError {
  return new TelegramNotificationIntentPersistenceError(reason);
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

function validBigintText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]*$/u.test(value) &&
    (value.length < MAX_BIGINT_TEXT.length ||
      (value.length === MAX_BIGINT_TEXT.length && value <= MAX_BIGINT_TEXT))
  );
}

function validBase(value: unknown): value is TelegramNotificationIntentBase {
  if (
    !isPlainRecord(value) ||
    !EVENT_KEY_PATTERN.test(String(value.eventKey)) ||
    !TELEGRAM_NOTIFICATION_EVENT_TYPES.includes(
      value.eventType as TelegramNotificationEventType,
    ) ||
    !TELEGRAM_NOTIFICATION_CATEGORIES.includes(
      value.category as TelegramNotificationCategory,
    ) ||
    EVENT_CATEGORY[value.eventType as TelegramNotificationEventType] !==
      value.category ||
    !isInternalUuid(value.sourceId) ||
    !Number.isSafeInteger(value.sourceVersion) ||
    Number(value.sourceVersion) < 1 ||
    !isUnixEpochSeconds(value.occurredAt) ||
    (value.matchId !== undefined && !isMatchId(value.matchId)) ||
    (value.reservationId !== undefined &&
      !isCourtReservationId(value.reservationId))
  ) {
    return false;
  }
  const booking = value.category === 'booking_updates';
  return booking
    ? value.reservationId !== undefined
    : value.matchId !== undefined;
}

function parameters(input: TelegramNotificationIntentBase): readonly unknown[] {
  return [
    input.eventKey,
    input.eventType,
    input.category,
    input.sourceId,
    input.sourceVersion,
    input.matchId ?? null,
    input.reservationId ?? null,
    input.occurredAt.toString(10),
  ];
}

function assertRows(
  rows: readonly IntentRow[],
  input: TelegramNotificationIntentBase,
  recipients?: ReadonlySet<AccountId>,
  allowEmpty = false,
): void {
  if (
    (!allowEmpty && rows.length < 1) ||
    (recipients !== undefined && rows.length !== recipients.size)
  ) {
    throw failure('event_conflict');
  }
  for (const row of rows) {
    if (
      row.event_key !== input.eventKey ||
      row.event_type !== input.eventType ||
      row.category !== input.category ||
      row.source_id !== input.sourceId ||
      readSafeInteger(row.source_version) !== input.sourceVersion ||
      row.match_id !== (input.matchId ?? null) ||
      row.reservation_id !== (input.reservationId ?? null) ||
      readSafeInteger(row.occurred_at) !== input.occurredAt ||
      !isAccountId(row.recipient_account_id) ||
      (recipients !== undefined && !recipients.has(row.recipient_account_id)) ||
      typeof row.inserted !== 'boolean'
    ) {
      throw failure('event_conflict');
    }
  }
}

function validateClaim(value: unknown): ClaimTelegramNotificationIntentInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 2 ||
    !isUnixEpochSeconds(value.now) ||
    !isUnixEpochSeconds(value.leaseUntil) ||
    value.leaseUntil <= value.now
  ) {
    throw failure('invalid_input');
  }
  return value as unknown as ClaimTelegramNotificationIntentInput;
}

function validateExactInvitationCanaryClaim(
  value: unknown,
): ClaimExactTelegramInvitationCanaryInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 4 ||
    !isUnixEpochSeconds(value.now) ||
    !isUnixEpochSeconds(value.leaseUntil) ||
    value.leaseUntil <= value.now ||
    typeof value.eventKey !== 'string' ||
    !value.eventKey.startsWith('match_invited:') ||
    !isInternalUuid(value.eventKey.slice('match_invited:'.length)) ||
    !isAccountId(value.recipientAccountId)
  ) {
    throw failure('invalid_input');
  }
  return value as unknown as ClaimExactTelegramInvitationCanaryInput;
}

function hydrateClaim(row: IntentRow): ClaimedTelegramNotificationIntent {
  if (
    typeof row.event_key !== 'string' ||
    !EVENT_KEY_PATTERN.test(row.event_key) ||
    !TELEGRAM_NOTIFICATION_EVENT_TYPES.includes(
      row.event_type as TelegramNotificationEventType,
    ) ||
    !TELEGRAM_NOTIFICATION_CATEGORIES.includes(
      row.category as TelegramNotificationCategory,
    ) ||
    !isAccountId(row.recipient_account_id) ||
    !isUnixEpochSeconds(readSafeInteger(row.occurred_at)) ||
    !(
      row.terminal_reason === null ||
      row.terminal_reason === undefined ||
      row.terminal_reason === 'destination_unavailable' ||
      row.terminal_reason === 'preference_disabled' ||
      row.terminal_reason === 'stale_event'
    ) ||
    (row.telegram_chat_id === null) !== (row.destination_version === null) ||
    (row.telegram_chat_id !== null &&
      row.telegram_chat_id !== undefined &&
      !validBigintText(row.telegram_chat_id))
  ) {
    throw failure('invalid_persisted_state');
  }
  const eventType = row.event_type as TelegramNotificationEventType;
  const sourceVersion = readSafeInteger(row.source_version);
  const attemptCount = readSafeInteger(row.attempt_count);
  const claimVersion = readSafeInteger(row.version);
  if (attemptCount < 1 || attemptCount > MAX_ATTEMPTS || claimVersion < 2) {
    throw failure('invalid_persisted_state');
  }
  const booking = EVENT_CATEGORY[eventType] === 'booking_updates';
  if (
    (booking && !isCourtReservationId(row.reservation_id)) ||
    (!booking && !isMatchId(row.match_id))
  ) {
    throw failure('invalid_persisted_state');
  }
  const destinationVersion =
    row.destination_version === null || row.destination_version === undefined
      ? undefined
      : readSafeInteger(row.destination_version);
  const terminalReason =
    row.terminal_reason === null || row.terminal_reason === undefined
      ? undefined
      : (row.terminal_reason as ClaimedTelegramNotificationIntent['terminalReason']);
  return Object.freeze({
    eventKey: row.event_key,
    eventType,
    category: row.category as TelegramNotificationCategory,
    sourceVersion,
    recipientAccountId: row.recipient_account_id,
    claimVersion,
    attemptCount,
    occurredAt: readSafeInteger(row.occurred_at) as UnixEpochSeconds,
    ...(row.telegram_chat_id === null || row.telegram_chat_id === undefined
      ? {}
      : { telegramChatId: row.telegram_chat_id as string, destinationVersion }),
    ...(terminalReason === undefined ? {} : { terminalReason }),
    deepLink: booking
      ? Object.freeze({
          screen: 'booking' as const,
          reservationId: row.reservation_id as CourtReservationId,
        })
      : Object.freeze({
          screen: 'match' as const,
          matchId: row.match_id as MatchId,
        }),
  });
}

function validateFinalize(
  value: unknown,
  extras: readonly string[],
): FinalizeTelegramNotificationIntentInput {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length !== 4 + extras.length ||
    !extras.every((key) => Object.prototype.hasOwnProperty.call(value, key)) ||
    !EVENT_KEY_PATTERN.test(String(value.eventKey)) ||
    !isAccountId(value.recipientAccountId) ||
    !Number.isSafeInteger(value.claimVersion) ||
    Number(value.claimVersion) < 2 ||
    !isUnixEpochSeconds(value.now)
  ) {
    throw failure('invalid_input');
  }
  return value as unknown as FinalizeTelegramNotificationIntentInput;
}

function finalizeResult(
  rowCount: number | null,
  rows: readonly AppliedRow[],
  booleanResult = false,
): TelegramNotificationIntentFinalizeResult {
  if (rowCount !== rows.length || rows.length > 1) {
    throw failure('invalid_persisted_state');
  }
  const applied = booleanResult
    ? rows.length === 1 && rows[0]?.applied === true
    : rows.length === 1;
  if (
    booleanResult &&
    rows.length === 1 &&
    typeof rows[0]?.applied !== 'boolean'
  ) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({ outcome: applied ? 'applied' : 'stale_claim' });
}

function mapError(error: unknown): TelegramNotificationIntentPersistenceError {
  if (error instanceof TelegramNotificationIntentPersistenceError) return error;
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error')
    return failure('storage_failure');
  switch (classified.category) {
    case 'unique_violation':
      return failure('event_conflict');
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

@Injectable()
export class PostgresTelegramNotificationIntentRepository implements TelegramNotificationIntentRepository {
  async enqueueDirect(
    transaction: PostgresTransaction,
    value: EnqueueDirectTelegramNotificationIntentInput,
  ): Promise<void> {
    try {
      if (!validBase(value) || !isAccountId(value.recipientAccountId)) {
        throw failure('invalid_input');
      }
      const result = await transaction.query<IntentRow>(ENQUEUE_DIRECT_SQL, [
        value.eventKey,
        value.eventType,
        value.category,
        value.sourceId,
        value.sourceVersion,
        value.recipientAccountId,
        value.matchId ?? null,
        value.reservationId ?? null,
        value.occurredAt.toString(10),
      ]);
      assertRows(result.rows, value, new Set([value.recipientAccountId]));
    } catch (error) {
      throw mapError(error);
    }
  }

  async enqueueMatchOwner(
    transaction: PostgresTransaction,
    value: TelegramNotificationIntentBase & { readonly matchId: MatchId },
  ): Promise<void> {
    try {
      if (!validBase(value) || !isMatchId(value.matchId)) {
        throw failure('invalid_input');
      }
      const base = parameters(value);
      const result = await transaction.query<IntentRow>(
        ENQUEUE_MATCH_OWNER_SQL,
        [
          base[0],
          base[1],
          base[2],
          base[3],
          base[4],
          value.matchId,
          value.reservationId ?? null,
          value.occurredAt.toString(10),
        ],
      );
      assertRows(result.rows, value);
    } catch (error) {
      throw mapError(error);
    }
  }

  async enqueueMatchAudience(
    transaction: PostgresTransaction,
    value: EnqueueMatchAudienceTelegramNotificationIntentInput,
  ): Promise<number> {
    try {
      if (
        !validBase(value) ||
        !isMatchId(value.matchId) ||
        (value.excludeAccountId !== undefined &&
          !isAccountId(value.excludeAccountId))
      ) {
        throw failure('invalid_input');
      }
      const base = parameters(value);
      const result = await transaction.query<IntentRow>(
        ENQUEUE_MATCH_AUDIENCE_SQL,
        [
          base[0],
          base[1],
          base[2],
          base[3],
          base[4],
          value.matchId,
          value.reservationId ?? null,
          value.occurredAt.toString(10),
          value.excludeAccountId ?? null,
        ],
      );
      assertRows(result.rows, value, undefined, true);
      return result.rows.length;
    } catch (error) {
      throw mapError(error);
    }
  }

  async enqueueDueReminders(
    transaction: PostgresTransaction,
    value: Readonly<{
      now: UnixEpochSeconds;
      matchLimit: number;
    }>,
  ): Promise<number> {
    try {
      if (
        !isPlainRecord(value) ||
        Object.keys(value).length !== 2 ||
        !isUnixEpochSeconds(value.now) ||
        !Number.isInteger(value.matchLimit) ||
        value.matchLimit < 1 ||
        value.matchLimit > 50
      ) {
        throw failure('invalid_input');
      }
      const result = await transaction.query<CountRow>(
        ENQUEUE_DUE_REMINDERS_SQL,
        [value.now.toString(10), value.matchLimit],
      );
      if (result.rowCount !== 1 || result.rows.length !== 1) {
        throw failure('invalid_persisted_state');
      }
      const count = readSafeInteger(result.rows[0].inserted_count);
      if (count > value.matchLimit * 4)
        throw failure('invalid_persisted_state');
      return count;
    } catch (error) {
      throw mapError(error);
    }
  }

  async claimNext(
    transaction: PostgresTransaction,
    raw: ClaimTelegramNotificationIntentInput,
  ): Promise<TelegramNotificationIntentClaimResult> {
    try {
      const input = validateClaim(raw);
      const ambiguous = await transaction.query<AppliedRow>(
        ABANDON_AMBIGUOUS_SQL,
        [input.now.toString(10)],
      );
      if (
        ambiguous.rows.length > 1 ||
        ambiguous.rowCount !== ambiguous.rows.length
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
        exhausted.rows.length > 1 ||
        exhausted.rowCount !== exhausted.rows.length
      ) {
        throw failure('invalid_persisted_state');
      }
      if (exhausted.rows.length === 1) {
        return Object.freeze({ outcome: 'retry_exhausted' as const });
      }
      const claimed = await transaction.query<IntentRow>(CLAIM_NEXT_SQL, [
        input.now.toString(10),
        input.leaseUntil.toString(10),
      ]);
      if (claimed.rows.length === 0) {
        return Object.freeze({ outcome: 'none_available' as const });
      }
      if (claimed.rows.length !== 1 || claimed.rowCount !== 1) {
        throw failure('invalid_persisted_state');
      }
      return Object.freeze({
        outcome: 'claimed' as const,
        intent: hydrateClaim(claimed.rows[0]),
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  async claimExactInvitationCanary(
    transaction: PostgresTransaction,
    raw: ClaimExactTelegramInvitationCanaryInput,
  ): Promise<TelegramNotificationIntentClaimResult> {
    try {
      const input = validateExactInvitationCanaryClaim(raw);
      const claimed = await transaction.query<IntentRow>(
        CLAIM_EXACT_INVITATION_CANARY_SQL,
        [
          input.now.toString(10),
          input.leaseUntil.toString(10),
          input.eventKey,
          input.recipientAccountId,
        ],
      );
      if (claimed.rows.length === 0) {
        return Object.freeze({ outcome: 'none_available' as const });
      }
      if (claimed.rows.length !== 1 || claimed.rowCount !== 1) {
        throw failure('invalid_persisted_state');
      }
      const intent = hydrateClaim(claimed.rows[0]);
      if (
        intent.eventType !== 'match_invited' ||
        intent.eventKey !== input.eventKey ||
        intent.recipientAccountId !== input.recipientAccountId ||
        intent.attemptCount !== 1 ||
        intent.terminalReason !== undefined
      ) {
        throw failure('invalid_persisted_state');
      }
      return Object.freeze({ outcome: 'claimed' as const, intent });
    } catch (error) {
      throw mapError(error);
    }
  }

  async markSent(
    transaction: PostgresTransaction,
    raw: FinalizeTelegramNotificationIntentInput & {
      readonly telegramMessageId: string;
    },
  ): Promise<TelegramNotificationIntentFinalizeResult> {
    try {
      const input = validateFinalize(raw, ['telegramMessageId']);
      if (!validBigintText(raw.telegramMessageId))
        throw failure('invalid_input');
      const result = await transaction.query<AppliedRow>(MARK_SENT_SQL, [
        input.eventKey,
        input.recipientAccountId,
        input.claimVersion,
        input.now.toString(10),
        raw.telegramMessageId,
      ]);
      return finalizeResult(result.rowCount, result.rows);
    } catch (error) {
      throw mapError(error);
    }
  }

  async scheduleRetry(
    transaction: PostgresTransaction,
    raw: FinalizeTelegramNotificationIntentInput & {
      readonly availableAt: UnixEpochSeconds;
      readonly failure: TelegramNotificationRetryFailure;
    },
  ): Promise<TelegramNotificationIntentFinalizeResult> {
    try {
      const input = validateFinalize(raw, ['availableAt', 'failure']);
      if (
        raw.failure !== 'telegram_rate_limited' ||
        !isUnixEpochSeconds(raw.availableAt) ||
        raw.availableAt <= input.now
      )
        throw failure('invalid_input');
      const result = await transaction.query<AppliedRow>(SCHEDULE_RETRY_SQL, [
        input.eventKey,
        input.recipientAccountId,
        input.claimVersion,
        input.now.toString(10),
        raw.availableAt.toString(10),
        raw.failure,
      ]);
      return finalizeResult(result.rowCount, result.rows);
    } catch (error) {
      throw mapError(error);
    }
  }

  async abandon(
    transaction: PostgresTransaction,
    raw: FinalizeTelegramNotificationIntentInput & {
      readonly failure: TelegramNotificationTerminalFailure;
      readonly disableDestination?: TelegramDestinationDisableReason;
      readonly destinationVersion?: number;
    },
  ): Promise<TelegramNotificationIntentFinalizeResult> {
    try {
      const extras =
        raw.disableDestination === undefined
          ? ['failure']
          : ['failure', 'disableDestination', 'destinationVersion'];
      const input = validateFinalize(raw, extras);
      const terminal: readonly TelegramNotificationTerminalFailure[] = [
        'destination_unavailable',
        'preference_disabled',
        'stale_event',
        'telegram_forbidden',
        'telegram_bad_request',
        'telegram_unauthorized',
        'delivery_unknown',
        'retry_exhausted',
      ];
      if (
        !terminal.includes(raw.failure) ||
        (raw.disableDestination !== undefined &&
          (!['telegram_forbidden', 'invalid_destination'].includes(
            raw.disableDestination,
          ) ||
            !Number.isSafeInteger(raw.destinationVersion) ||
            Number(raw.destinationVersion) < 1)) ||
        (raw.disableDestination === undefined &&
          raw.destinationVersion !== undefined)
      )
        throw failure('invalid_input');
      const result = await transaction.query<AppliedRow>(ABANDON_SQL, [
        input.eventKey,
        input.recipientAccountId,
        input.claimVersion,
        input.now.toString(10),
        raw.failure,
        raw.disableDestination ?? null,
        raw.destinationVersion ?? null,
      ]);
      return finalizeResult(result.rowCount, result.rows, true);
    } catch (error) {
      throw mapError(error);
    }
  }
}
