import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  MatchWaitlistEntryRecord,
  MatchWaitlistMutationRecord,
  WaitingMatchWaitlistEntryRecord,
  isMatchWaitlistCommandId,
  isMatchWaitlistEntryId,
  isMatchWaitlistRequestDigest,
} from '../matches/match-waitlist.types';
import { isMatchId } from '../matches/match.types';
import {
  JoinMatchWaitlistInput,
  LeaveMatchWaitlistInput,
  ListMatchWaitlistInput,
  ListMatchWaitlistResult,
  MatchWaitlistPersistenceError,
  MatchWaitlistPersistenceFailure,
  MatchWaitlistRepository,
  MutateMatchWaitlistResult,
  ReadMatchWaitlistPromotionCandidateResult,
  ResolveMatchWaitlistPromotionInput,
  ResolveWaitingMatchWaitlistAccountInput,
} from './match-waitlist.repository';
import {
  decodePostgresByteaDigest,
  decodePostgresNonNegativeBigint,
  encodePostgresByteaDigest,
} from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { readPlayerRatingLevel } from './postgres-match.repository';
import { PostgresTransaction } from './postgres-transaction';

const ACTIVE_MATCH_STATUSES = new Set([
  'open',
  'searching',
  'confirmed',
  'upcoming',
]);
const MAX_LIST_LIMIT = 50;

const SELECT_MATCH_FOR_UPDATE_SQL = `
  SELECT
    id,
    owner_account_id,
    starts_at,
    kind,
    visibility,
    scenario,
    status,
    rating_min,
    rating_max,
    is_rating_match
  FROM backend_match.matches
  WHERE id = $1
  FOR UPDATE
`;

const SELECT_COMMAND_SQL = `
  SELECT
    command_id,
    entry_id,
    match_id,
    actor_account_id,
    request_digest,
    command_type,
    result_type,
    applied_at,
    entry_status,
    entry_version
  FROM backend_match.match_waitlist_commands
  WHERE command_id = $1
`;

const SELECT_ACTIVE_PARTICIPANTS_SQL = `
  SELECT account_id, slot_number
  FROM backend_match.match_participants
  WHERE match_id = $1
    AND status = 'active'
  ORDER BY slot_number, id
  FOR UPDATE
`;

const SELECT_PENDING_INVITATIONS_SQL = `
  SELECT invited_account_id, slot_number
  FROM backend_match.match_invitations
  WHERE match_id = $1
    AND status = 'pending'
  ORDER BY slot_number, id
  FOR UPDATE
`;

const SELECT_PLAYER_SQL = `
  SELECT
    accounts.id,
    accounts.status,
    accounts.role,
    profiles.account_id AS profile_account_id,
    ratings.rating,
    ratings.is_verified
  FROM backend_auth.accounts AS accounts
  LEFT JOIN backend_auth.player_profiles AS profiles
    ON profiles.account_id = accounts.id
  LEFT JOIN backend_auth.player_rating_states AS ratings
    ON ratings.account_id = accounts.id
  WHERE accounts.id = $1
`;

const SELECT_WAITING_ENTRY_SQL = `
  SELECT
    id,
    match_id,
    account_id,
    status,
    joined_at,
    updated_at,
    resolved_at,
    version
  FROM backend_match.match_waitlist_entries
  WHERE match_id = $1
    AND account_id = $2
    AND status = 'waiting'
  FOR UPDATE
`;

const SELECT_ACTIVE_OFFER_FOR_ACCOUNT_SQL = `
  SELECT id
  FROM backend_match.match_waitlist_offers
  WHERE match_id = $1
    AND account_id = $2
    AND status = 'active'
  LIMIT 1
`;

const INSERT_ENTRY_SQL = `
  INSERT INTO backend_match.match_waitlist_entries (
    id,
    match_id,
    account_id,
    status,
    joined_at,
    updated_at,
    version
  )
  VALUES ($1, $2, $3, 'waiting', $4, $4, 1)
  RETURNING id, match_id, account_id, status, joined_at, updated_at,
    resolved_at, version
`;

const UPDATE_ENTRY_LEFT_SQL = `
  UPDATE backend_match.match_waitlist_entries
  SET
    status = 'left',
    updated_at = $4,
    resolved_at = $4,
    version = 2
  WHERE id = $1
    AND match_id = $2
    AND account_id = $3
    AND status = 'waiting'
    AND version = 1
  RETURNING id, match_id, account_id, status, joined_at, updated_at,
    resolved_at, version
`;

const INSERT_COMMAND_SQL = `
  INSERT INTO backend_match.match_waitlist_commands (
    command_id,
    entry_id,
    match_id,
    actor_account_id,
    request_digest,
    command_type,
    result_type,
    applied_at,
    entry_status,
    entry_version
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  RETURNING command_id
`;

const SELECT_LIST_SQL = `
  WITH authorized_match AS MATERIALIZED (
    SELECT matches.id
    FROM backend_match.matches AS matches
    WHERE matches.id = $1
      AND matches.kind = 'match'
      AND matches.visibility = 'public'
      AND matches.scenario <> 'private'
  ),
  ranked AS MATERIALIZED (
    SELECT
      entries.id,
      entries.match_id,
      entries.account_id,
      entries.status,
      entries.joined_at,
      entries.updated_at,
      entries.resolved_at,
      entries.version,
      row_number() OVER (
        ORDER BY entries.joined_at, entries.id
      )::bigint AS queue_position,
      count(*) OVER ()::bigint AS queue_count
    FROM backend_match.match_waitlist_entries AS entries
    JOIN authorized_match ON authorized_match.id = entries.match_id
    WHERE entries.status = 'waiting'
  ),
  page AS MATERIALIZED (
    SELECT *
    FROM ranked
    WHERE queue_position <= $3
  ),
  selected AS (
    SELECT * FROM page
    UNION ALL
    SELECT ranked.*
    FROM ranked
    WHERE ranked.account_id = $2
      AND NOT EXISTS (
        SELECT 1 FROM page WHERE page.id = ranked.id
      )
  )
  SELECT
    authorized_match.id AS authorized_match_id,
    selected.id,
    selected.match_id,
    selected.account_id,
    selected.status,
    selected.joined_at,
    selected.updated_at,
    selected.resolved_at,
    selected.version,
    selected.queue_position,
    coalesce(selected.queue_count, 0)::bigint AS queue_count
  FROM authorized_match
  LEFT JOIN selected ON true
  ORDER BY selected.queue_position NULLS LAST, selected.id NULLS LAST
`;

const SELECT_PROMOTION_CANDIDATE_SQL = `
  SELECT
    entries.id,
    entries.match_id,
    entries.account_id,
    entries.status,
    entries.joined_at,
    entries.updated_at,
    entries.resolved_at,
    entries.version,
    1::bigint AS queue_position,
    (
      accounts.status = 'active'
      AND accounts.role = 'player'
      AND profiles.account_id IS NOT NULL
      AND ratings.account_id IS NOT NULL
    ) AS player_is_active
  FROM backend_match.match_waitlist_entries AS entries
  LEFT JOIN backend_auth.accounts AS accounts
    ON accounts.id = entries.account_id
  LEFT JOIN backend_auth.player_profiles AS profiles
    ON profiles.account_id = entries.account_id
  LEFT JOIN backend_auth.player_rating_states AS ratings
    ON ratings.account_id = entries.account_id
  WHERE entries.match_id = $1
    AND entries.status = 'waiting'
  ORDER BY entries.joined_at, entries.id
  LIMIT 1
  FOR UPDATE OF entries
`;

const SKIP_INELIGIBLE_PROMOTION_ENTRIES_SQL = `
  UPDATE backend_match.match_waitlist_entries AS entries
  SET
    status = 'skipped',
    updated_at = $2,
    resolved_at = $2,
    version = 2
  FROM backend_match.matches AS matches
  WHERE entries.match_id = $1
    AND matches.id = entries.match_id
    AND entries.status = 'waiting'
    AND entries.version = 1
    AND (
      entries.account_id = matches.owner_account_id
      OR EXISTS (
        SELECT 1
        FROM backend_match.match_participants AS participants
        WHERE participants.match_id = entries.match_id
          AND participants.account_id = entries.account_id
          AND participants.status = 'active'
      )
      OR EXISTS (
        SELECT 1
        FROM backend_match.match_invitations AS invitations
        WHERE invitations.match_id = entries.match_id
          AND invitations.invited_account_id = entries.account_id
          AND invitations.status = 'pending'
      )
      OR NOT EXISTS (
        SELECT 1
        FROM backend_auth.accounts AS accounts
        JOIN backend_auth.player_profiles AS profiles
          ON profiles.account_id = accounts.id
        JOIN backend_auth.player_rating_states AS ratings
          ON ratings.account_id = accounts.id
        WHERE accounts.id = entries.account_id
          AND accounts.status = 'active'
          AND accounts.role = 'player'
          AND (
            matches.is_rating_match = false
            OR ratings.is_verified = true
          )
          AND CASE
            WHEN ratings.rating < 2.0 THEN 0
            WHEN ratings.rating < 3.0 THEN 1
            WHEN ratings.rating < 3.5 THEN 2
            WHEN ratings.rating < 4.0 THEN 3
            WHEN ratings.rating < 4.7 THEN 4
            WHEN ratings.rating < 5.5 THEN 5
            ELSE 6
          END >= matches.rating_min
          AND CASE
            WHEN ratings.rating < 2.0 THEN 0
            WHEN ratings.rating < 3.0 THEN 1
            WHEN ratings.rating < 3.5 THEN 2
            WHEN ratings.rating < 4.0 THEN 3
            WHEN ratings.rating < 4.7 THEN 4
            WHEN ratings.rating < 5.5 THEN 5
            ELSE 6
          END <= matches.rating_max
      )
    )
`;

const RESOLVE_PROMOTION_SQL = `
  UPDATE backend_match.match_waitlist_entries
  SET
    status = $4,
    updated_at = $5,
    resolved_at = $5,
    version = 2
  WHERE id = $1
    AND match_id = $2
    AND account_id = $3
    AND status = 'waiting'
    AND version = 1
  RETURNING id
`;

const RESOLVE_WAITING_ACCOUNT_SQL = `
  UPDATE backend_match.match_waitlist_entries
  SET
    status = 'promoted',
    updated_at = $3,
    resolved_at = $3,
    version = 2
  WHERE match_id = $1
    AND account_id = $2
    AND status = 'waiting'
    AND version = 1
  RETURNING id
`;

interface MatchRow extends QueryResultRow {
  readonly id: unknown;
  readonly owner_account_id: unknown;
  readonly starts_at: unknown;
  readonly kind: unknown;
  readonly visibility: unknown;
  readonly scenario: unknown;
  readonly status: unknown;
  readonly rating_min: unknown;
  readonly rating_max: unknown;
  readonly is_rating_match: unknown;
}

interface ParticipantRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly slot_number: unknown;
}

interface InvitationRow extends QueryResultRow {
  readonly invited_account_id: unknown;
  readonly slot_number: unknown;
}

interface PlayerRow extends QueryResultRow {
  readonly id: unknown;
  readonly status: unknown;
  readonly role: unknown;
  readonly profile_account_id: unknown;
  readonly rating: unknown;
  readonly is_verified: unknown;
}

interface EntryRow extends QueryResultRow {
  readonly id: unknown;
  readonly match_id: unknown;
  readonly account_id: unknown;
  readonly status: unknown;
  readonly joined_at: unknown;
  readonly updated_at: unknown;
  readonly resolved_at: unknown;
  readonly version: unknown;
}

interface ListRow extends EntryRow {
  readonly authorized_match_id: unknown;
  readonly queue_position: unknown;
  readonly queue_count: unknown;
}

interface PromotionRow extends EntryRow {
  readonly queue_position: unknown;
  readonly player_is_active: unknown;
}

interface CommandRow extends QueryResultRow {
  readonly command_id: unknown;
  readonly entry_id: unknown;
  readonly match_id: unknown;
  readonly actor_account_id: unknown;
  readonly request_digest: unknown;
  readonly command_type: unknown;
  readonly result_type: unknown;
  readonly applied_at: unknown;
  readonly entry_status: unknown;
  readonly entry_version: unknown;
}

function failure(reason: MatchWaitlistPersistenceFailure) {
  return new MatchWaitlistPersistenceError(reason);
}

function invalidInput() {
  return failure('invalid_input');
}

function invalidState() {
  return failure('invalid_persisted_state');
}

function exactOne(rowCount: number | null, rows: readonly unknown[]) {
  if (rowCount !== 1 || rows.length !== 1) throw invalidState();
}

function readEpoch(value: unknown) {
  const decoded = decodePostgresNonNegativeBigint(value);
  if (!isUnixEpochSeconds(decoded)) throw invalidState();
  return decoded;
}

function readSmallPositiveInteger(value: unknown, maximum?: number) {
  const decoded = decodePostgresNonNegativeBigint(value);
  if (
    !Number.isSafeInteger(decoded) ||
    decoded < 1 ||
    (maximum !== undefined && decoded > maximum)
  ) {
    throw invalidState();
  }
  return decoded;
}

function hydrateEntry(row: EntryRow): MatchWaitlistEntryRecord {
  if (
    !isMatchWaitlistEntryId(row.id) ||
    !isMatchId(row.match_id) ||
    !isAccountId(row.account_id) ||
    !['waiting', 'promoted', 'left', 'skipped'].includes(String(row.status))
  ) {
    throw invalidState();
  }
  const joinedAt = readEpoch(row.joined_at);
  const updatedAt = readEpoch(row.updated_at);
  const version = readSmallPositiveInteger(row.version, 2);
  const resolvedAt = row.resolved_at === null ? undefined : readEpoch(row.resolved_at);
  const status = row.status as MatchWaitlistEntryRecord['status'];
  if (
    updatedAt < joinedAt ||
    (status === 'waiting' && (resolvedAt !== undefined || version !== 1)) ||
    (status !== 'waiting' &&
      (resolvedAt === undefined || resolvedAt < joinedAt || resolvedAt > updatedAt || version !== 2))
  ) {
    throw invalidState();
  }
  return Object.freeze({
    entryId: row.id,
    matchId: row.match_id,
    accountId: row.account_id,
    status,
    joinedAt,
    updatedAt,
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    version: version as 1 | 2,
  });
}

function waitingEntry(row: EntryRow, positionValue: unknown): WaitingMatchWaitlistEntryRecord {
  const entry = hydrateEntry(row);
  if (entry.status !== 'waiting' || entry.version !== 1) throw invalidState();
  return Object.freeze({
    entryId: entry.entryId,
    matchId: entry.matchId,
    accountId: entry.accountId,
    status: 'waiting',
    joinedAt: entry.joinedAt,
    updatedAt: entry.updatedAt,
    version: 1,
    queuePosition: readSmallPositiveInteger(positionValue),
  });
}

function mutationFromCommand(row: CommandRow): MatchWaitlistMutationRecord {
  if (
    !isMatchWaitlistEntryId(row.entry_id) ||
    !isMatchId(row.match_id) ||
    !['waiting', 'left'].includes(String(row.entry_status))
  ) {
    throw invalidState();
  }
  const version = readSmallPositiveInteger(row.entry_version, 2);
  if (
    (row.entry_status === 'waiting' && version !== 1) ||
    (row.entry_status === 'left' && version !== 2)
  ) {
    throw invalidState();
  }
  return Object.freeze({
    entryId: row.entry_id,
    matchId: row.match_id,
    status: row.entry_status as 'waiting' | 'left',
    appliedAt: readEpoch(row.applied_at),
    version: version as 1 | 2,
  });
}

function validateJoin(input: JoinMatchWaitlistInput) {
  if (
    !isMatchWaitlistCommandId(input.commandId) ||
    !isMatchWaitlistEntryId(input.entryId) ||
    !isMatchId(input.matchId) ||
    !isAccountId(input.actorAccountId) ||
    !isMatchWaitlistRequestDigest(input.requestDigest) ||
    !isUnixEpochSeconds(input.now)
  ) throw invalidInput();
  return input;
}

function validateLeave(input: LeaveMatchWaitlistInput) {
  if (
    !isMatchWaitlistCommandId(input.commandId) ||
    !isMatchId(input.matchId) ||
    !isAccountId(input.actorAccountId) ||
    !isMatchWaitlistRequestDigest(input.requestDigest) ||
    !isUnixEpochSeconds(input.now)
  ) throw invalidInput();
  return input;
}

function commandMatches(
  row: CommandRow,
  input: JoinMatchWaitlistInput | LeaveMatchWaitlistInput,
  type: 'join_waitlist' | 'leave_waitlist',
) {
  const expectedStatus = type === 'join_waitlist' ? 'waiting' : 'left';
  const expectedVersion = type === 'join_waitlist' ? 1 : 2;
  return (
    row.command_id === input.commandId &&
    row.match_id === input.matchId &&
    row.actor_account_id === input.actorAccountId &&
    decodePostgresByteaDigest(row.request_digest) === input.requestDigest &&
    row.command_type === type &&
    row.result_type === (type === 'join_waitlist' ? 'waitlist_joined' : 'waitlist_left') &&
    row.entry_status === expectedStatus &&
    readSmallPositiveInteger(row.entry_version, 2) === expectedVersion &&
    (type !== 'join_waitlist' || row.entry_id === (input as JoinMatchWaitlistInput).entryId)
  );
}

function validateMatch(row: MatchRow, matchId: string) {
  if (
    row.id !== matchId ||
    !isAccountId(row.owner_account_id) ||
    typeof row.kind !== 'string' ||
    typeof row.visibility !== 'string' ||
    typeof row.scenario !== 'string' ||
    typeof row.status !== 'string' ||
    typeof row.is_rating_match !== 'boolean'
  ) throw invalidState();
  return Object.freeze({
    ownerAccountId: row.owner_account_id,
    startsAt: readEpoch(row.starts_at),
    kind: row.kind,
    visibility: row.visibility,
    scenario: row.scenario,
    status: row.status,
    ratingMin: row.rating_min,
    ratingMax: row.rating_max,
    isRatingMatch: row.is_rating_match,
  });
}

function validateReservations(
  participants: { readonly rowCount: number | null; readonly rows: readonly ParticipantRow[] },
  invitations: { readonly rowCount: number | null; readonly rows: readonly InvitationRow[] },
) {
  if (
    participants.rowCount !== participants.rows.length ||
    invitations.rowCount !== invitations.rows.length ||
    participants.rows.length > 3 ||
    invitations.rows.length > 3
  ) throw invalidState();
  for (const row of participants.rows) {
    if (!isAccountId(row.account_id) || ![2, 3, 4].includes(row.slot_number as number)) {
      throw invalidState();
    }
  }
  for (const row of invitations.rows) {
    if (!isAccountId(row.invited_account_id) || ![2, 3, 4].includes(row.slot_number as number)) {
      throw invalidState();
    }
  }
  const activeSlots = participants.rows.map((row) => row.slot_number);
  const reservedSlots = invitations.rows.map((row) => row.slot_number);
  if (
    new Set(activeSlots).size !== activeSlots.length ||
    new Set(reservedSlots).size !== reservedSlots.length ||
    new Set([...activeSlots, ...reservedSlots]).size !==
      activeSlots.length + reservedSlots.length
  ) throw invalidState();
}

function mapPersistenceError(error: unknown): MatchWaitlistPersistenceError {
  if (error instanceof MatchWaitlistPersistenceError) return error;
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') return failure('storage_failure');
  const { category, metadata } = classified;
  if (category === 'unique_violation') {
    if (metadata.constraint === 'match_waitlist_commands_pkey') return failure('command_conflict');
    if (
      metadata.constraint === 'match_waitlist_entries_pkey' ||
      metadata.constraint === 'match_waitlist_entries_identity_key' ||
      metadata.constraint === 'match_waitlist_entries_one_waiting_account'
    ) return failure('entry_conflict');
  }
  switch (category) {
    case 'foreign_key_violation': return failure('referential_integrity');
    case 'insufficient_privilege': return failure('permission_denied');
    case 'serialization_failure':
    case 'deadlock_detected': return failure('transaction_conflict');
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled': return failure('database_unavailable');
    default: return failure('storage_failure');
  }
}

async function readCommand(
  transaction: PostgresTransaction,
  commandId: string,
) {
  const selected = await transaction.query<CommandRow>(SELECT_COMMAND_SQL, [commandId]);
  if (selected.rowCount !== selected.rows.length || selected.rows.length > 1) throw invalidState();
  return selected.rows[0];
}

async function insertCommand(
  transaction: PostgresTransaction,
  input: JoinMatchWaitlistInput | LeaveMatchWaitlistInput,
  entryId: string,
  type: 'join_waitlist' | 'leave_waitlist',
) {
  const joined = type === 'join_waitlist';
  const inserted = await transaction.query(INSERT_COMMAND_SQL, [
    input.commandId,
    entryId,
    input.matchId,
    input.actorAccountId,
    encodePostgresByteaDigest(input.requestDigest),
    type,
    joined ? 'waitlist_joined' : 'waitlist_left',
    input.now,
    joined ? 'waiting' : 'left',
    joined ? 1 : 2,
  ]);
  exactOne(inserted.rowCount, inserted.rows);
  if (inserted.rows[0]?.command_id !== input.commandId) throw invalidState();
}

export class PostgresMatchWaitlistRepository implements MatchWaitlistRepository {
  constructor(private readonly offersEnabled = false) {}

  async join(transaction: PostgresTransaction, input: JoinMatchWaitlistInput): Promise<MutateMatchWaitlistResult> {
    try {
      const validated = validateJoin(input);
      const locked = await transaction.query<MatchRow>(SELECT_MATCH_FOR_UPDATE_SQL, [validated.matchId]);
      if (locked.rowCount !== locked.rows.length || locked.rows.length > 1) throw invalidState();
      if (locked.rows.length === 0) return Object.freeze({ outcome: 'rejected', reason: 'match_not_found' });
      const match = validateMatch(locked.rows[0], validated.matchId);
      const existingCommand = await readCommand(transaction, validated.commandId);
      if (existingCommand !== undefined) {
        if (!commandMatches(existingCommand, validated, 'join_waitlist')) {
          return Object.freeze({ outcome: 'rejected', reason: 'command_reuse_conflict' });
        }
        return Object.freeze({
          outcome: 'waitlist_joined',
          persistence: 'idempotent_retry',
          entry: mutationFromCommand(existingCommand),
        });
      }
      if (
        match.kind !== 'match' ||
        match.visibility !== 'public' ||
        match.scenario === 'private' ||
        !ACTIVE_MATCH_STATUSES.has(match.status)
      ) return Object.freeze({ outcome: 'rejected', reason: 'match_closed' });
      if (match.startsAt <= validated.now) return Object.freeze({ outcome: 'rejected', reason: 'match_started' });
      if (match.ownerAccountId === validated.actorAccountId) {
        return Object.freeze({ outcome: 'rejected', reason: 'owner_cannot_join' });
      }

      const participants = await transaction.query<ParticipantRow>(SELECT_ACTIVE_PARTICIPANTS_SQL, [validated.matchId]);
      const invitations = await transaction.query<InvitationRow>(SELECT_PENDING_INVITATIONS_SQL, [validated.matchId]);
      validateReservations(participants, invitations);
      if (participants.rows.some((row) => row.account_id === validated.actorAccountId)) {
        return Object.freeze({ outcome: 'rejected', reason: 'already_joined' });
      }
      if (invitations.rows.some((row) => row.invited_account_id === validated.actorAccountId)) {
        return Object.freeze({ outcome: 'rejected', reason: 'invitation_pending' });
      }
      if (1 + participants.rows.length + invitations.rows.length < 4) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_not_full' });
      }

      const waiting = await transaction.query<EntryRow>(SELECT_WAITING_ENTRY_SQL, [validated.matchId, validated.actorAccountId]);
      if (waiting.rowCount !== waiting.rows.length || waiting.rows.length > 1) throw invalidState();
      if (waiting.rows.length === 1) return Object.freeze({ outcome: 'rejected', reason: 'already_waiting' });

      const player = await transaction.query<PlayerRow>(SELECT_PLAYER_SQL, [validated.actorAccountId]);
      if (player.rowCount !== player.rows.length || player.rows.length > 1) throw invalidState();
      if (player.rows.length === 0) return Object.freeze({ outcome: 'rejected', reason: 'player_not_found' });
      const playerRow = player.rows[0];
      if (
        playerRow.id !== validated.actorAccountId ||
        playerRow.status !== 'active' ||
        playerRow.role !== 'player' ||
        playerRow.profile_account_id !== validated.actorAccountId ||
        typeof playerRow.is_verified !== 'boolean'
      ) return Object.freeze({ outcome: 'rejected', reason: 'player_not_found' });
      const level = readPlayerRatingLevel(playerRow.rating);
      if (match.isRatingMatch && !playerRow.is_verified) {
        return Object.freeze({ outcome: 'rejected', reason: 'rating_verification_required' });
      }
      if (
        !Number.isInteger(match.ratingMin) ||
        !Number.isInteger(match.ratingMax) ||
        level < (match.ratingMin as number) ||
        level > (match.ratingMax as number)
      ) return Object.freeze({ outcome: 'rejected', reason: 'rating_out_of_range' });

      const inserted = await transaction.query<EntryRow>(INSERT_ENTRY_SQL, [
        validated.entryId,
        validated.matchId,
        validated.actorAccountId,
        validated.now,
      ]);
      exactOne(inserted.rowCount, inserted.rows);
      const entry = hydrateEntry(inserted.rows[0]);
      if (
        entry.entryId !== validated.entryId ||
        entry.matchId !== validated.matchId ||
        entry.accountId !== validated.actorAccountId ||
        entry.status !== 'waiting' ||
        entry.joinedAt !== validated.now
      ) throw invalidState();
      await insertCommand(transaction, validated, validated.entryId, 'join_waitlist');
      return Object.freeze({
        outcome: 'waitlist_joined',
        persistence: 'applied',
        entry: Object.freeze({
          entryId: entry.entryId,
          matchId: entry.matchId,
          status: 'waiting',
          appliedAt: validated.now,
          version: 1,
        }),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async leave(transaction: PostgresTransaction, input: LeaveMatchWaitlistInput): Promise<MutateMatchWaitlistResult> {
    try {
      const validated = validateLeave(input);
      const locked = await transaction.query<MatchRow>(SELECT_MATCH_FOR_UPDATE_SQL, [validated.matchId]);
      if (locked.rowCount !== locked.rows.length || locked.rows.length > 1) throw invalidState();
      if (locked.rows.length === 0) return Object.freeze({ outcome: 'rejected', reason: 'match_not_found' });
      validateMatch(locked.rows[0], validated.matchId);
      const existingCommand = await readCommand(transaction, validated.commandId);
      if (existingCommand !== undefined) {
        if (!commandMatches(existingCommand, validated, 'leave_waitlist')) {
          return Object.freeze({ outcome: 'rejected', reason: 'command_reuse_conflict' });
        }
        return Object.freeze({
          outcome: 'waitlist_left',
          persistence: 'idempotent_retry',
          entry: mutationFromCommand(existingCommand),
        });
      }
      if (this.offersEnabled) {
        const activeOffer = await transaction.query(SELECT_ACTIVE_OFFER_FOR_ACCOUNT_SQL, [
          validated.matchId,
          validated.actorAccountId,
        ]);
        if (activeOffer.rowCount !== activeOffer.rows.length || activeOffer.rows.length > 1) {
          throw invalidState();
        }
        if (activeOffer.rows.length === 1) {
          return Object.freeze({ outcome: 'rejected', reason: 'not_waiting' });
        }
      }
      const waiting = await transaction.query<EntryRow>(SELECT_WAITING_ENTRY_SQL, [validated.matchId, validated.actorAccountId]);
      if (waiting.rowCount !== waiting.rows.length || waiting.rows.length > 1) throw invalidState();
      if (waiting.rows.length === 0) return Object.freeze({ outcome: 'rejected', reason: 'not_waiting' });
      const entry = hydrateEntry(waiting.rows[0]);
      const updated = await transaction.query<EntryRow>(UPDATE_ENTRY_LEFT_SQL, [
        entry.entryId,
        validated.matchId,
        validated.actorAccountId,
        validated.now,
      ]);
      exactOne(updated.rowCount, updated.rows);
      const left = hydrateEntry(updated.rows[0]);
      if (left.status !== 'left' || left.version !== 2 || left.resolvedAt !== validated.now) throw invalidState();
      await insertCommand(transaction, validated, entry.entryId, 'leave_waitlist');
      return Object.freeze({
        outcome: 'waitlist_left',
        persistence: 'applied',
        entry: Object.freeze({
          entryId: entry.entryId,
          matchId: validated.matchId,
          status: 'left',
          appliedAt: validated.now,
          version: 2,
        }),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async list(transaction: PostgresTransaction, input: ListMatchWaitlistInput): Promise<ListMatchWaitlistResult> {
    try {
      if (
        !isMatchId(input.matchId) ||
        !isAccountId(input.actorAccountId) ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 || input.limit > MAX_LIST_LIMIT
      ) throw invalidInput();
      const selected = await transaction.query<ListRow>(SELECT_LIST_SQL, [input.matchId, input.actorAccountId, input.limit]);
      if (selected.rowCount !== selected.rows.length || selected.rows.length > input.limit + 1) throw invalidState();
      if (selected.rows.length === 0) return Object.freeze({ outcome: 'rejected', reason: 'match_not_found' });
      if (selected.rows.some((row) => row.authorized_match_id !== input.matchId)) throw invalidState();
      const count = decodePostgresNonNegativeBigint(selected.rows[0].queue_count);
      if (!Number.isSafeInteger(count)) throw invalidState();
      if (selected.rows.length === 1 && selected.rows[0].id === null) {
        const row = selected.rows[0];
        if ([row.match_id, row.account_id, row.status, row.joined_at, row.updated_at, row.resolved_at, row.version, row.queue_position].some((value) => value !== null)) throw invalidState();
        return Object.freeze({ outcome: 'found', entries: Object.freeze([]), count: 0 });
      }
      if (selected.rows.some((row) => row.id === null)) throw invalidState();
      const hydrated = selected.rows.map((row) => waitingEntry(row, row.queue_position));
      if (
        count < hydrated.length ||
        hydrated.some((entry) => entry.queuePosition > count) ||
        new Set(hydrated.map((entry) => entry.entryId)).size !== hydrated.length
      ) throw invalidState();
      const entries = hydrated.filter((entry) => entry.queuePosition <= input.limit);
      const current = hydrated.find((entry) => entry.accountId === input.actorAccountId);
      return Object.freeze({
        outcome: 'found',
        entries: Object.freeze(entries),
        ...(current === undefined ? {} : { current }),
        count,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async readPromotionCandidate(
    transaction: PostgresTransaction,
    input: { readonly matchId: import('../matches/match.types').MatchId; readonly now: import('../auth/auth.types').UnixEpochSeconds },
  ): Promise<ReadMatchWaitlistPromotionCandidateResult> {
    try {
      if (!isMatchId(input.matchId) || !isUnixEpochSeconds(input.now)) throw invalidInput();
      const locked = await transaction.query<MatchRow>(SELECT_MATCH_FOR_UPDATE_SQL, [input.matchId]);
      if (locked.rowCount !== locked.rows.length || locked.rows.length > 1) throw invalidState();
      if (locked.rows.length === 0) return Object.freeze({ outcome: 'match_unavailable' });
      const match = validateMatch(locked.rows[0], input.matchId);
      if (
        match.kind !== 'match' || match.visibility !== 'public' || match.scenario === 'private' ||
        !ACTIVE_MATCH_STATUSES.has(match.status) || match.startsAt <= input.now
      ) return Object.freeze({ outcome: 'match_unavailable' });
      if (!Number.isInteger(match.ratingMin) || !Number.isInteger(match.ratingMax)) {
        throw invalidState();
      }
      const participants = await transaction.query<ParticipantRow>(
        SELECT_ACTIVE_PARTICIPANTS_SQL,
        [input.matchId],
      );
      const invitations = await transaction.query<InvitationRow>(
        SELECT_PENDING_INVITATIONS_SQL,
        [input.matchId],
      );
      validateReservations(participants, invitations);
      const skipped = await transaction.query(
        SKIP_INELIGIBLE_PROMOTION_ENTRIES_SQL,
        [input.matchId, input.now],
      );
      if (
        skipped.rows.length !== 0 ||
        skipped.rowCount === null ||
        !Number.isSafeInteger(skipped.rowCount) ||
        skipped.rowCount < 0
      ) {
        throw invalidState();
      }
      const candidate = await transaction.query<PromotionRow>(SELECT_PROMOTION_CANDIDATE_SQL, [input.matchId]);
      if (candidate.rowCount !== candidate.rows.length || candidate.rows.length > 1) throw invalidState();
      if (candidate.rows.length === 0) return Object.freeze({ outcome: 'empty' });
      if (typeof candidate.rows[0].player_is_active !== 'boolean') throw invalidState();
      return Object.freeze({
        outcome: 'candidate',
        entry: waitingEntry(candidate.rows[0], candidate.rows[0].queue_position),
        playerIsActive: candidate.rows[0].player_is_active,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async resolvePromotion(transaction: PostgresTransaction, input: ResolveMatchWaitlistPromotionInput): Promise<void> {
    try {
      if (
        !isMatchWaitlistEntryId(input.entryId) || !isMatchId(input.matchId) ||
        !isAccountId(input.accountId) || !['promoted', 'skipped'].includes(input.outcome) ||
        !isUnixEpochSeconds(input.now)
      ) throw invalidInput();
      const updated = await transaction.query(RESOLVE_PROMOTION_SQL, [
        input.entryId, input.matchId, input.accountId, input.outcome, input.now,
      ]);
      exactOne(updated.rowCount, updated.rows);
      if (updated.rows[0]?.id !== input.entryId) throw invalidState();
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async resolveWaitingAccount(
    transaction: PostgresTransaction,
    input: ResolveWaitingMatchWaitlistAccountInput,
  ): Promise<boolean> {
    try {
      if (
        !isMatchId(input.matchId) ||
        !isAccountId(input.accountId) ||
        !isUnixEpochSeconds(input.now)
      ) throw invalidInput();
      const locked = await transaction.query<MatchRow>(
        SELECT_MATCH_FOR_UPDATE_SQL,
        [input.matchId],
      );
      exactOne(locked.rowCount, locked.rows);
      validateMatch(locked.rows[0], input.matchId);
      const updated = await transaction.query(RESOLVE_WAITING_ACCOUNT_SQL, [
        input.matchId,
        input.accountId,
        input.now,
      ]);
      if (
        updated.rowCount !== updated.rows.length ||
        updated.rows.length > 1 ||
        (updated.rows.length === 1 && !isMatchWaitlistEntryId(updated.rows[0]?.id))
      ) throw invalidState();
      return updated.rows.length === 1;
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
