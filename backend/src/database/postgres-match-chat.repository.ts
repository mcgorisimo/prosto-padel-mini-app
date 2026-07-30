import { QueryResultRow } from 'pg';
import {
  ACCOUNT_STATUSES,
  isAccountId,
} from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  isCanonicalMatchMessageBody,
  isMatchMessageCommandId,
  isMatchMessageId,
  isMatchMessageRequestDigest,
  MatchMessageRecord,
} from '../matches/match-chat.types';
import {
  MATCH_STATUSES,
  isMatchId,
} from '../matches/match.types';
import {
  ListMatchMessagesInput,
  ListMatchMessagesResult,
  MatchChatPersistenceError,
  MatchChatPersistenceFailure,
  MatchChatRepository,
  MatchChatSenderRecord,
  ReadMatchChatSendersInput,
  ReadMatchChatSendersResult,
  SendMatchMessageInput,
  SendMatchMessageResult,
} from './match-chat.repository';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';

const MAX_LIST_LIMIT = 50;
const MAX_NAME_CODE_POINTS = 256;
const MAX_USERNAME_CODE_POINTS = 64;
const RATING_PATTERN = /^(?:[0-9]\.[0-9]{2}|10\.00)$/u;

const SELECT_AUTHORIZED_MESSAGES_SQL = `
  WITH authorized_match AS MATERIALIZED (
    SELECT matches.id
    FROM backend_match.matches AS matches
    WHERE matches.id = $1
      AND (
        matches.owner_account_id = $2
        OR EXISTS (
          SELECT 1
          FROM backend_match.match_participants AS participants
          WHERE participants.match_id = matches.id
            AND participants.account_id = $2
            AND participants.status = 'active'
        )
      )
  ),
  paged_messages AS MATERIALIZED (
    SELECT
      messages.id,
      messages.match_id,
      messages.sender_account_id,
      messages.body,
      messages.created_at
    FROM backend_match.match_messages AS messages
    JOIN authorized_match
      ON authorized_match.id = messages.match_id
    WHERE (
      $3::bigint IS NULL
      OR (messages.created_at, messages.id) < ($3::bigint, $4::uuid)
    )
    ORDER BY messages.created_at DESC, messages.id DESC
    LIMIT $5::integer
  )
  SELECT
    authorized_match.id AS authorized_match_id,
    paged_messages.id AS message_id,
    paged_messages.match_id,
    paged_messages.sender_account_id,
    paged_messages.body,
    paged_messages.created_at
  FROM authorized_match
  LEFT JOIN paged_messages ON true
  ORDER BY
    paged_messages.created_at DESC NULLS LAST,
    paged_messages.id DESC NULLS LAST
`;

const SELECT_MATCH_FOR_CHAT_SEND_SQL = `
  SELECT
    matches.id,
    matches.owner_account_id,
    matches.status
  FROM backend_match.matches AS matches
  WHERE matches.id = $1
  FOR UPDATE OF matches
`;

const SELECT_CHAT_SENDERS_SQL = `
  SELECT
    accounts.id AS sender_account_id,
    accounts.role,
    accounts.status,
    details.first_name,
    details.last_name,
    details.username,
    rating_states.rating,
    rating_states.is_verified
  FROM backend_auth.accounts AS accounts
  JOIN backend_auth.player_profiles AS profiles
    ON profiles.account_id = accounts.id
  LEFT JOIN backend_auth.player_profile_details AS details
    ON details.account_id = profiles.account_id
    AND accounts.status = 'active'
  LEFT JOIN backend_auth.player_rating_states AS rating_states
    ON rating_states.account_id = profiles.account_id
    AND accounts.status = 'active'
  WHERE accounts.id = ANY ($1::uuid[])
  ORDER BY accounts.id
`;

const SELECT_CHAT_SEND_ACCESS_SQL = `
  SELECT (
    $2::uuid = $3::uuid
    OR EXISTS (
      SELECT 1
      FROM backend_match.match_participants AS participants
      WHERE participants.match_id = $1
        AND participants.account_id = $2
        AND participants.status = 'active'
    )
  ) AS can_send
`;

const SELECT_COMMAND_BY_ID_SQL = `
  SELECT
    command_id,
    message_id,
    match_id,
    actor_account_id,
    request_digest,
    command_type,
    result_type,
    applied_at
  FROM backend_match.match_message_commands
  WHERE command_id = $1
`;

const SELECT_MESSAGE_BY_ID_SQL = `
  SELECT
    id,
    match_id,
    sender_account_id,
    body,
    created_at
  FROM backend_match.match_messages
  WHERE id = $1
`;

const INSERT_MESSAGE_SQL = `
  INSERT INTO backend_match.match_messages (
    id,
    match_id,
    sender_account_id,
    body,
    created_at
  )
  VALUES ($1, $2, $3, $4, $5)
  RETURNING
    id,
    match_id,
    sender_account_id,
    body,
    created_at
`;

const INSERT_COMMAND_SQL = `
  INSERT INTO backend_match.match_message_commands (
    command_id,
    message_id,
    match_id,
    actor_account_id,
    request_digest,
    command_type,
    result_type,
    applied_at
  )
  VALUES ($1, $2, $3, $4, $5, 'send_message', 'message_sent', $6)
  RETURNING command_id
`;

interface MessageRow extends QueryResultRow {
  readonly id: unknown;
  readonly match_id: unknown;
  readonly sender_account_id: unknown;
  readonly body: unknown;
  readonly created_at: unknown;
}

interface MessageListRow extends QueryResultRow {
  readonly authorized_match_id: unknown;
  readonly message_id: unknown;
  readonly match_id: unknown;
  readonly sender_account_id: unknown;
  readonly body: unknown;
  readonly created_at: unknown;
}

interface MatchAccessRow extends QueryResultRow {
  readonly id: unknown;
  readonly owner_account_id: unknown;
  readonly status: unknown;
}

interface ChatSendAccessRow extends QueryResultRow {
  readonly can_send: unknown;
}

interface ChatSenderRow extends QueryResultRow {
  readonly sender_account_id: unknown;
  readonly role: unknown;
  readonly status: unknown;
  readonly first_name: unknown;
  readonly last_name: unknown;
  readonly username: unknown;
  readonly rating: unknown;
  readonly is_verified: unknown;
}

interface CommandRow extends QueryResultRow {
  readonly command_id: unknown;
  readonly message_id: unknown;
  readonly match_id: unknown;
  readonly actor_account_id: unknown;
  readonly request_digest: unknown;
  readonly command_type: unknown;
  readonly result_type: unknown;
  readonly applied_at: unknown;
}

function failure(
  reason: MatchChatPersistenceFailure,
): MatchChatPersistenceError {
  return new MatchChatPersistenceError(reason);
}

function invalidInput(): MatchChatPersistenceError {
  return failure('invalid_input');
}

function invalidState(): MatchChatPersistenceError {
  return failure('invalid_persisted_state');
}

function readEpoch(value: unknown) {
  const parsed =
    typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value)
      ? Number(value)
      : value;
  if (!isUnixEpochSeconds(parsed)) throw invalidState();
  return parsed;
}

function hydrateMessage(row: MessageRow): MatchMessageRecord {
  if (
    !isMatchMessageId(row.id) ||
    !isMatchId(row.match_id) ||
    !isAccountId(row.sender_account_id) ||
    !isCanonicalMatchMessageBody(row.body)
  ) {
    throw invalidState();
  }
  return Object.freeze({
    messageId: row.id,
    matchId: row.match_id,
    senderAccountId: row.sender_account_id,
    body: row.body,
    createdAt: readEpoch(row.created_at),
  });
}

function isBoundedString(
  value: unknown,
  maximumCodePoints: number,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    [...value].length <= maximumCodePoints
  );
}

function readOptionalString(
  value: unknown,
  maximumCodePoints: number,
): string | undefined {
  if (value === null) return undefined;
  if (!isBoundedString(value, maximumCodePoints)) throw invalidState();
  return value;
}

function readRating(value: unknown): number {
  if (typeof value !== 'string' || !RATING_PATTERN.test(value)) {
    throw invalidState();
  }
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
    throw invalidState();
  }
  return rating;
}

function hydrateSender(row: ChatSenderRow): MatchChatSenderRecord {
  if (
    !isAccountId(row.sender_account_id) ||
    row.role !== 'player' ||
    typeof row.status !== 'string' ||
    !ACCOUNT_STATUSES.includes(
      row.status as (typeof ACCOUNT_STATUSES)[number],
    )
  ) {
    throw invalidState();
  }
  if (row.status !== 'active') {
    if (
      row.first_name !== null ||
      row.last_name !== null ||
      row.username !== null ||
      row.rating !== null ||
      row.is_verified !== null
    ) {
      throw invalidState();
    }
    return Object.freeze({
      senderAccountId: row.sender_account_id,
      availability: 'unavailable',
    });
  }
  if (
    !isBoundedString(row.first_name, MAX_NAME_CODE_POINTS) ||
    typeof row.is_verified !== 'boolean'
  ) {
    throw invalidState();
  }
  const lastName = readOptionalString(
    row.last_name,
    MAX_NAME_CODE_POINTS,
  );
  const username = readOptionalString(
    row.username,
    MAX_USERNAME_CODE_POINTS,
  );
  return Object.freeze({
    senderAccountId: row.sender_account_id,
    availability: 'available',
    firstName: row.first_name,
    ...(lastName === undefined ? {} : { lastName }),
    ...(username === undefined ? {} : { username }),
    rating: readRating(row.rating),
    isVerified: row.is_verified,
  });
}

function exactOne(
  rowCount: number | null,
  rows: readonly unknown[],
): void {
  if (rowCount !== 1 || rows.length !== 1) throw invalidState();
}

function validateListInput(
  input: ListMatchMessagesInput,
): ListMatchMessagesInput {
  if (
    !isMatchId(input.matchId) ||
    !isAccountId(input.actorAccountId) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_LIST_LIMIT ||
    (input.before !== undefined &&
      (!isUnixEpochSeconds(input.before.createdAt) ||
        !isMatchMessageId(input.before.messageId)))
  ) {
    throw invalidInput();
  }
  return input;
}

function validateSendInput(
  input: SendMatchMessageInput,
): SendMatchMessageInput {
  if (
    !isMatchMessageCommandId(input.commandId) ||
    !isMatchMessageId(input.messageId) ||
    !isMatchId(input.matchId) ||
    !isAccountId(input.actorAccountId) ||
    !isMatchMessageRequestDigest(input.requestDigest) ||
    !isCanonicalMatchMessageBody(input.body) ||
    !isUnixEpochSeconds(input.now)
  ) {
    throw invalidInput();
  }
  return input;
}

function validateReadSendersInput(
  input: ReadMatchChatSendersInput,
): ReadMatchChatSendersInput {
  if (
    !Array.isArray(input.senderAccountIds) ||
    input.senderAccountIds.length < 1 ||
    input.senderAccountIds.length > MAX_LIST_LIMIT ||
    input.senderAccountIds.some(
      (senderAccountId) => !isAccountId(senderAccountId),
    ) ||
    new Set(input.senderAccountIds).size !==
      input.senderAccountIds.length
  ) {
    throw invalidInput();
  }
  return input;
}

function commandMatches(
  row: CommandRow,
  input: SendMatchMessageInput,
): boolean {
  return (
    row.command_id === input.commandId &&
    row.message_id === input.messageId &&
    row.match_id === input.matchId &&
    row.actor_account_id === input.actorAccountId &&
    Buffer.isBuffer(row.request_digest) &&
    row.request_digest.length === 32 &&
    row.request_digest.toString('hex') === input.requestDigest &&
    row.command_type === 'send_message' &&
    row.result_type === 'message_sent' &&
    isUnixEpochSeconds(readEpoch(row.applied_at))
  );
}

function mapPersistenceError(
  error: unknown,
): MatchChatPersistenceError {
  if (error instanceof MatchChatPersistenceError) return error;
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return failure('storage_failure');
  }
  const { category, metadata } = classified;
  if (category === 'unique_violation') {
    switch (metadata.constraint) {
      case 'match_message_commands_pkey':
        return failure('command_conflict');
      case 'match_messages_pkey':
      case 'match_messages_identity_key':
      case 'match_message_commands_message_match_key':
        return failure('message_conflict');
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

export class PostgresMatchChatRepository implements MatchChatRepository {
  async list(
    transaction: PostgresTransaction,
    input: ListMatchMessagesInput,
  ): Promise<ListMatchMessagesResult> {
    try {
      const validated = validateListInput(input);
      const selected = await transaction.query<MessageListRow>(
        SELECT_AUTHORIZED_MESSAGES_SQL,
        [
          validated.matchId,
          validated.actorAccountId,
          validated.before?.createdAt ?? null,
          validated.before?.messageId ?? null,
          validated.limit + 1,
        ],
      );
      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length > validated.limit + 1
      ) {
        throw invalidState();
      }
      if (selected.rows.length === 0) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'match_not_found',
        });
      }
      if (
        selected.rows.some(
          (row) => row.authorized_match_id !== validated.matchId,
        )
      ) {
        throw invalidState();
      }
      if (
        selected.rows.length === 1 &&
        selected.rows[0].message_id === null
      ) {
        const empty = selected.rows[0];
        if (
          empty.match_id !== null ||
          empty.sender_account_id !== null ||
          empty.body !== null ||
          empty.created_at !== null
        ) {
          throw invalidState();
        }
        return Object.freeze({
          outcome: 'found',
          messages: Object.freeze([]),
        });
      }
      if (selected.rows.some((row) => row.message_id === null)) {
        throw invalidState();
      }
      const hydrated = selected.rows.map((row) =>
        hydrateMessage({
          id: row.message_id,
          match_id: row.match_id,
          sender_account_id: row.sender_account_id,
          body: row.body,
          created_at: row.created_at,
        }),
      );
      if (
        new Set(hydrated.map((message) => message.messageId)).size !==
        hydrated.length
      ) {
        throw invalidState();
      }
      const hasMore = hydrated.length > validated.limit;
      const messages = hydrated.slice(0, validated.limit);
      const oldest = messages.at(-1);
      return Object.freeze({
        outcome: 'found',
        messages: Object.freeze(messages),
        ...(hasMore && oldest !== undefined
          ? {
              nextCursor: Object.freeze({
                createdAt: oldest.createdAt,
                messageId: oldest.messageId,
              }),
            }
          : {}),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async readSenders(
    transaction: PostgresTransaction,
    input: ReadMatchChatSendersInput,
  ): Promise<ReadMatchChatSendersResult> {
    try {
      const validated = validateReadSendersInput(input);
      const selected = await transaction.query<ChatSenderRow>(
        SELECT_CHAT_SENDERS_SQL,
        [validated.senderAccountIds],
      );
      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length !== validated.senderAccountIds.length
      ) {
        throw invalidState();
      }
      const requested = new Set(validated.senderAccountIds);
      const senders = selected.rows.map(hydrateSender);
      if (
        senders.some(
          (sender) => !requested.has(sender.senderAccountId),
        ) ||
        new Set(
          senders.map((sender) => sender.senderAccountId),
        ).size !== senders.length
      ) {
        throw invalidState();
      }
      return Object.freeze({
        outcome: 'found',
        senders: Object.freeze(senders),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async send(
    transaction: PostgresTransaction,
    input: SendMatchMessageInput,
  ): Promise<SendMatchMessageResult> {
    try {
      const validated = validateSendInput(input);
      const locked = await transaction.query<MatchAccessRow>(
        SELECT_MATCH_FOR_CHAT_SEND_SQL,
        [validated.matchId],
      );
      if (
        locked.rowCount !== locked.rows.length ||
        locked.rows.length > 1
      ) {
        throw invalidState();
      }
      if (locked.rows.length === 0) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'match_not_found',
        });
      }
      const match = locked.rows[0];
      if (
        match.id !== validated.matchId ||
        !isAccountId(match.owner_account_id) ||
        typeof match.status !== 'string' ||
        !MATCH_STATUSES.includes(
          match.status as (typeof MATCH_STATUSES)[number],
        )
      ) {
        throw invalidState();
      }

      const existing = await transaction.query<CommandRow>(
        SELECT_COMMAND_BY_ID_SQL,
        [validated.commandId],
      );
      if (
        existing.rowCount !== existing.rows.length ||
        existing.rows.length > 1
      ) {
        throw invalidState();
      }
      if (existing.rows.length === 1) {
        if (!commandMatches(existing.rows[0], validated)) {
          return Object.freeze({
            outcome: 'rejected',
            reason: 'command_reuse_conflict',
          });
        }
        const message = await transaction.query<MessageRow>(
          SELECT_MESSAGE_BY_ID_SQL,
          [validated.messageId],
        );
        exactOne(message.rowCount, message.rows);
        const hydrated = hydrateMessage(message.rows[0]);
        if (
          hydrated.matchId !== validated.matchId ||
          hydrated.senderAccountId !== validated.actorAccountId ||
          hydrated.body !== validated.body
        ) {
          throw invalidState();
        }
        return Object.freeze({
          outcome: 'message_sent',
          persistence: 'idempotent_retry',
          message: hydrated,
        });
      }

      const access = await transaction.query<ChatSendAccessRow>(
        SELECT_CHAT_SEND_ACCESS_SQL,
        [
          validated.matchId,
          validated.actorAccountId,
          match.owner_account_id,
        ],
      );
      exactOne(access.rowCount, access.rows);
      if (typeof access.rows[0].can_send !== 'boolean') {
        throw invalidState();
      }
      if (!access.rows[0].can_send) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'match_not_found',
        });
      }
      if (match.status === 'completed' || match.status === 'cancelled') {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'match_closed',
        });
      }

      const insertedMessage = await transaction.query<MessageRow>(
        INSERT_MESSAGE_SQL,
        [
          validated.messageId,
          validated.matchId,
          validated.actorAccountId,
          validated.body,
          validated.now,
        ],
      );
      exactOne(insertedMessage.rowCount, insertedMessage.rows);
      const message = hydrateMessage(insertedMessage.rows[0]);
      if (
        message.messageId !== validated.messageId ||
        message.matchId !== validated.matchId ||
        message.senderAccountId !== validated.actorAccountId ||
        message.body !== validated.body ||
        message.createdAt !== validated.now
      ) {
        throw invalidState();
      }
      const insertedCommand = await transaction.query(
        INSERT_COMMAND_SQL,
        [
          validated.commandId,
          validated.messageId,
          validated.matchId,
          validated.actorAccountId,
          Buffer.from(validated.requestDigest, 'hex'),
          validated.now,
        ],
      );
      exactOne(insertedCommand.rowCount, insertedCommand.rows);
      if (
        insertedCommand.rows[0]?.command_id !== validated.commandId
      ) {
        throw invalidState();
      }
      return Object.freeze({
        outcome: 'message_sent',
        persistence: 'applied',
        message,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
