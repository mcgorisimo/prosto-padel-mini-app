import { QueryResultRow } from 'pg';
import { AccountId, isAccountId } from '../accounts/account.types';
import {
  UnixEpochSeconds,
  isUnixEpochSeconds,
} from '../auth/auth.types';
import {
  MatchTransitionRejection,
  isValidMatchCommand,
  transitionMatch,
} from '../matches/match.state-machine';
import {
  MatchCourtCatalog,
  MatchCourtSnapshot,
} from '../matches/match-court-catalog';
import {
  AppliedMatchCommand,
  CreateMatchCommand,
  JoinMatchCommand,
  LeaveMatchCommand,
  MATCH_COMMENT_MAX_CODE_POINTS,
  MATCH_STATUSES,
  MatchCommand,
  MatchCommandId,
  MatchDurationMinutes,
  MatchId,
  MatchInvitationId,
  MatchParticipantId,
  MatchParticipantState,
  MatchRequestDigest,
  MatchScenario,
  MatchState,
  MatchStatus,
  UpdateMatchDescriptionCommand,
  isMatchCommandId,
  isMatchId,
  isMatchInvitationId,
  isMatchParticipantId,
  isMatchRequestDigest,
} from '../matches/match.types';
import {
  decodePostgresByteaDigest,
  decodePostgresNonNegativeBigint,
  encodePostgresByteaDigest,
} from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import {
  CreateMatchResult,
  CreateMatchPersistenceInput,
  FindVisibleMatchInput,
  JoinMatchInput,
  JoinMatchResult,
  LeaveMatchResult,
  ListAccountMatchFeedInput,
  ListPublicMatchFeedInput,
  MatchDetailRecord,
  MatchCommandRejection,
  MatchFeedRecord,
  MatchPersistenceError,
  MatchPersistenceFailure,
  MatchRepository,
  UpdateMatchDescriptionResult,
  matchDetailFromState,
} from './match.repository';
import {
  PlayerProfileReadPersistenceError,
  PlayerProfileReader,
} from './player-profile-reader';
import { PostgresTransaction } from './postgres-transaction';

const MAX_FEED_RESULTS = 50;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const PRICE_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{2})?$/u;
const PLAYER_RATING_PATTERN = /^(?:[0-9]\.[0-9]{2}|10\.00)$/u;

const LOCK_CREATE_COMMAND_SQL = `
  SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'backend_match:create_match:'::text || $1::text,
      0::bigint
    )
  ) AS locked
`;

const SELECT_COMMAND_BY_ID_SQL = `
  SELECT
    command_id,
    match_id,
    actor_account_id,
    command_sequence,
    request_digest,
    command_type,
    applied_at,
    participant_id,
    result_type,
    match_version
  FROM backend_match.match_commands
  WHERE command_id = $1
`;

const SELECT_MATCH_FOR_UPDATE_SQL = `
  SELECT
    id,
    owner_account_id,
    created_at,
    updated_at,
    starts_at,
    duration_minutes,
    court_id,
    court_name,
    court_type,
    kind,
    visibility,
    scenario,
    status,
    title,
    description,
    rating_min,
    rating_max,
    is_rating_match,
    price_per_person_snapshot,
    version,
    terminal_at
  FROM backend_match.matches
  WHERE id = $1
  FOR UPDATE
`;

const SELECT_PARTICIPANTS_FOR_UPDATE_SQL = `
  SELECT
    id,
    match_id,
    account_id,
    slot_number,
    status,
    joined_at,
    updated_at,
    left_at,
    version
  FROM backend_match.match_participants
  WHERE match_id = $1
  ORDER BY slot_number, joined_at, id
  FOR UPDATE
`;

const SELECT_COMMANDS_SQL = `
  SELECT
    command_id,
    match_id,
    actor_account_id,
    command_sequence,
    request_digest,
    command_type,
    applied_at,
    participant_id,
    result_type,
    match_version
  FROM backend_match.match_commands
  WHERE match_id = $1
  ORDER BY command_sequence
`;

const SELECT_ACTIVE_RESERVATION_TARGET_FOR_SHARE_SQL = `
  SELECT target_datetime_text, target_end_datetime_text
  FROM backend_match.match_reservation_links
  WHERE match_id = $1 AND state = 'active'
  FOR SHARE
`;

const SELECT_ACTOR_RATING_SQL = `
  SELECT rating, is_verified
  FROM backend_auth.player_rating_states
  WHERE account_id = $1
`;

const SELECT_PENDING_INVITATIONS_FOR_UPDATE_SQL = `
  SELECT id, invited_account_id, slot_number
  FROM backend_match.match_invitations
  WHERE match_id = $1
    AND status = 'pending'
  ORDER BY slot_number, id
  FOR UPDATE
`;

const INSERT_MATCH_SQL = `
  INSERT INTO backend_match.matches (
    id,
    owner_account_id,
    created_at,
    updated_at,
    starts_at,
    duration_minutes,
    court_id,
    court_name,
    court_type,
    kind,
    visibility,
    scenario,
    status,
    title,
    description,
    rating_min,
    rating_max,
    is_rating_match,
    price_per_person_snapshot,
    version
  )
  VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
  )
  RETURNING id, version
`;

const INSERT_PARTICIPANT_SQL = `
  INSERT INTO backend_match.match_participants (
    id,
    match_id,
    account_id,
    slot_number,
    status,
    joined_at,
    updated_at,
    version
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  RETURNING id, match_id, account_id, slot_number, status, version
`;

const UPDATE_PARTICIPANT_SQL = `
  UPDATE backend_match.match_participants
  SET
    status = $3,
    updated_at = $4,
    left_at = $5,
    version = $6
  WHERE id = $1
    AND match_id = $2
    AND status = 'active'
    AND left_at IS NULL
    AND version = $7
  RETURNING id, match_id, account_id, slot_number, status, version
`;

const UPDATE_MATCH_VERSION_SQL = `
  UPDATE backend_match.matches
  SET
    updated_at = $2,
    version = $3,
    status = $4
  WHERE id = $1
    AND version = $5
  RETURNING id, version
`;

const UPDATE_MATCH_DESCRIPTION_SQL = `
  UPDATE backend_match.matches
  SET
    updated_at = $2,
    version = $3,
    description = $4
  WHERE id = $1
    AND version = $5
  RETURNING id, version
`;

const INSERT_COMMAND_SQL = `
  INSERT INTO backend_match.match_commands (
    command_id,
    match_id,
    actor_account_id,
    command_sequence,
    request_digest,
    command_type,
    applied_at,
    participant_id,
    result_type,
    match_version
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  RETURNING command_id, match_id, command_sequence
`;

const SELECT_PUBLIC_FEED_SQL = `
  SELECT
    matches.id,
    matches.owner_account_id,
    matches.starts_at,
    matches.duration_minutes,
    matches.court_id,
    matches.court_name,
    matches.court_type,
    matches.scenario,
    matches.status,
    matches.title,
    matches.description,
    matches.rating_min,
    matches.rating_max,
    matches.is_rating_match,
    matches.price_per_person_snapshot,
    matches.version,
    1 + pg_catalog.count(participants.id)
      AS occupied_slots,
    COALESCE(
      pg_catalog.array_agg(
        participants.account_id
        ORDER BY participants.slot_number
      ) FILTER (WHERE participants.id IS NOT NULL),
      ARRAY[]::uuid[]
    ) AS participant_account_ids,
    COALESCE(
      pg_catalog.array_agg(
        participants.slot_number
        ORDER BY participants.slot_number
      ) FILTER (WHERE participants.id IS NOT NULL),
      ARRAY[]::smallint[]
    ) AS participant_slot_numbers
  FROM backend_match.matches AS matches
  LEFT JOIN backend_match.match_reservation_links AS reservation_links
    ON reservation_links.match_id = matches.id
   AND reservation_links.state = 'active'
  LEFT JOIN backend_match.match_participants AS participants
    ON participants.match_id = matches.id
   AND participants.status = 'active'
  WHERE matches.visibility = 'public'
    AND matches.kind = 'match'
    AND matches.status = ANY (
      ARRAY['open', 'searching', 'confirmed', 'upcoming']::text[]
    )
    AND COALESCE(
      EXTRACT(EPOCH FROM reservation_links.target_datetime)::bigint,
      matches.starts_at
    ) > $1
  GROUP BY matches.id, reservation_links.link_id
  ORDER BY COALESCE(
    EXTRACT(EPOCH FROM reservation_links.target_datetime)::bigint,
    matches.starts_at
  ), matches.id
  LIMIT $2::integer
`;

const SELECT_ACCOUNT_FEED_SQL = `
  SELECT
    matches.id,
    matches.owner_account_id,
    matches.starts_at,
    matches.duration_minutes,
    matches.court_id,
    matches.court_name,
    matches.court_type,
    matches.scenario,
    matches.status,
    matches.title,
    matches.description,
    matches.rating_min,
    matches.rating_max,
    matches.is_rating_match,
    matches.price_per_person_snapshot,
    matches.version,
    1 + pg_catalog.count(participants.id)
      AS occupied_slots,
    COALESCE(
      pg_catalog.array_agg(
        participants.account_id
        ORDER BY participants.slot_number
      ) FILTER (WHERE participants.id IS NOT NULL),
      ARRAY[]::uuid[]
    ) AS participant_account_ids,
    COALESCE(
      pg_catalog.array_agg(
        participants.slot_number
        ORDER BY participants.slot_number
      ) FILTER (WHERE participants.id IS NOT NULL),
      ARRAY[]::smallint[]
    ) AS participant_slot_numbers
  FROM backend_match.matches AS matches
  LEFT JOIN backend_match.match_reservation_links AS reservation_links
    ON reservation_links.match_id = matches.id
   AND reservation_links.state = 'active'
  LEFT JOIN backend_match.match_participants AS participants
    ON participants.match_id = matches.id
   AND participants.status = 'active'
  WHERE matches.visibility = 'public'
    AND matches.kind = 'match'
    AND matches.status = ANY (
      ARRAY['open', 'searching', 'confirmed', 'upcoming']::text[]
    )
    AND COALESCE(
      EXTRACT(EPOCH FROM reservation_links.target_datetime)::bigint,
      matches.starts_at
    ) > $1
    AND (
      matches.owner_account_id = $2
      OR EXISTS (
        SELECT 1
        FROM backend_match.match_participants AS account_participants
        WHERE account_participants.match_id = matches.id
          AND account_participants.account_id = $2
          AND account_participants.status = 'active'
      )
    )
  GROUP BY matches.id, reservation_links.link_id
  ORDER BY COALESCE(
    EXTRACT(EPOCH FROM reservation_links.target_datetime)::bigint,
    matches.starts_at
  ), matches.id
  LIMIT $3::integer
`;

const SELECT_VISIBLE_MATCH_SQL = `
  SELECT
    matches.id,
    matches.owner_account_id,
    matches.created_at,
    matches.updated_at,
    matches.starts_at,
    matches.duration_minutes,
    matches.court_id,
    matches.court_name,
    matches.court_type,
    matches.kind,
    matches.visibility,
    matches.scenario,
    matches.status,
    matches.title,
    matches.description,
    matches.rating_min,
    matches.rating_max,
    matches.is_rating_match,
    matches.price_per_person_snapshot,
    matches.version,
    matches.terminal_at,
    participants.id AS participant_id,
    participants.match_id AS participant_match_id,
    participants.account_id AS participant_account_id,
    participants.slot_number AS participant_slot_number,
    participants.status AS participant_status,
    participants.joined_at AS participant_joined_at,
    participants.updated_at AS participant_updated_at,
    participants.left_at AS participant_left_at,
    participants.version AS participant_version
  FROM backend_match.matches AS matches
  LEFT JOIN backend_match.match_participants AS participants
    ON participants.match_id = matches.id
   AND participants.status = 'active'
  WHERE matches.id = $1
    AND (
      matches.visibility = 'public'
      OR matches.owner_account_id = $2
      OR EXISTS (
        SELECT 1
        FROM backend_match.match_participants AS participants
        WHERE participants.match_id = matches.id
          AND participants.account_id = $2
          AND participants.status = 'active'
      )
    )
  ORDER BY
    participants.slot_number,
    participants.joined_at,
    participants.id
`;

interface MatchRow extends QueryResultRow {
  readonly id: unknown;
  readonly owner_account_id: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly starts_at: unknown;
  readonly duration_minutes: unknown;
  readonly court_id: unknown;
  readonly court_name: unknown;
  readonly court_type: unknown;
  readonly kind: unknown;
  readonly visibility: unknown;
  readonly scenario: unknown;
  readonly status: unknown;
  readonly title: unknown;
  readonly description: unknown;
  readonly rating_min: unknown;
  readonly rating_max: unknown;
  readonly is_rating_match: unknown;
  readonly price_per_person_snapshot: unknown;
  readonly version: unknown;
  readonly terminal_at: unknown;
}

interface ParticipantRow extends QueryResultRow {
  readonly id: unknown;
  readonly match_id: unknown;
  readonly account_id: unknown;
  readonly slot_number: unknown;
  readonly status: unknown;
  readonly joined_at: unknown;
  readonly updated_at: unknown;
  readonly left_at: unknown;
  readonly version: unknown;
}

interface CommandRow extends QueryResultRow {
  readonly command_id: unknown;
  readonly match_id: unknown;
  readonly actor_account_id: unknown;
  readonly command_sequence: unknown;
  readonly request_digest: unknown;
  readonly command_type: unknown;
  readonly applied_at: unknown;
  readonly participant_id: unknown;
  readonly result_type: unknown;
  readonly match_version: unknown;
}

interface ActorRatingRow extends QueryResultRow {
  readonly rating: unknown;
  readonly is_verified: unknown;
}

interface PendingInvitationRow extends QueryResultRow {
  readonly id: unknown;
  readonly invited_account_id: unknown;
  readonly slot_number: unknown;
}

interface ActiveReservationTargetRow extends QueryResultRow {
  readonly target_datetime_text: unknown;
  readonly target_end_datetime_text: unknown;
}

interface VisibleMatchRow extends MatchRow {
  readonly participant_id: unknown;
  readonly participant_match_id: unknown;
  readonly participant_account_id: unknown;
  readonly participant_slot_number: unknown;
  readonly participant_status: unknown;
  readonly participant_joined_at: unknown;
  readonly participant_updated_at: unknown;
  readonly participant_left_at: unknown;
  readonly participant_version: unknown;
}

interface FeedRow extends QueryResultRow {
  readonly id: unknown;
  readonly owner_account_id: unknown;
  readonly starts_at: unknown;
  readonly duration_minutes: unknown;
  readonly court_id: unknown;
  readonly court_name: unknown;
  readonly court_type: unknown;
  readonly scenario: unknown;
  readonly status: unknown;
  readonly title: unknown;
  readonly description: unknown;
  readonly rating_min: unknown;
  readonly rating_max: unknown;
  readonly is_rating_match: unknown;
  readonly price_per_person_snapshot: unknown;
  readonly version: unknown;
  readonly occupied_slots: unknown;
  readonly participant_account_ids: unknown;
  readonly participant_slot_numbers: unknown;
}

function failure(reason: MatchPersistenceFailure): MatchPersistenceError {
  return new MatchPersistenceError(reason);
}

function invalidInput(): MatchPersistenceError {
  return failure('invalid_input');
}

function invalidPersistedState(): MatchPersistenceError {
  return failure('invalid_persisted_state');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function readEpoch(value: unknown): UnixEpochSeconds {
  const decoded = decodePostgresNonNegativeBigint(value);
  if (!isUnixEpochSeconds(decoded)) {
    throw invalidPersistedState();
  }
  return decoded;
}

function readPositiveSafeInteger(value: unknown): number {
  const decoded = decodePostgresNonNegativeBigint(value);
  if (decoded < 1) {
    throw invalidPersistedState();
  }
  return decoded;
}

function readMatchDescription(value: unknown): string {
  if (
    typeof value !== 'string' ||
    [...value].length > MATCH_COMMENT_MAX_CODE_POINTS ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw invalidPersistedState();
  }
  return value;
}

function readSmallInteger(
  value: unknown,
  allowed: readonly number[],
): number {
  if (!Number.isInteger(value) || !allowed.includes(value as number)) {
    throw invalidPersistedState();
  }
  return value as number;
}

function readBoundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): string {
  if (
    typeof value !== 'string' ||
    [...value].length < minimum ||
    [...value].length > maximum ||
    value.trim() !== value ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw invalidPersistedState();
  }
  return value;
}

function readOptionalText(
  value: unknown,
  maximum: number,
): string | undefined {
  return value === null
    ? undefined
    : readBoundedText(value, 1, maximum);
}

function readPrice(value: unknown): number | undefined {
  if (value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || !PRICE_PATTERN.test(value)) {
    throw invalidPersistedState();
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000) {
    throw invalidPersistedState();
  }
  return parsed;
}

function readNullableRating(value: unknown): number | undefined {
  if (value === null) {
    return undefined;
  }
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 6) {
    throw invalidPersistedState();
  }
  return value as number;
}

export function readPlayerRatingLevel(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !PLAYER_RATING_PATTERN.test(value)
  ) {
    throw invalidPersistedState();
  }
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
    throw invalidPersistedState();
  }
  if (rating < 2) return 0;
  if (rating < 3) return 1;
  if (rating < 3.5) return 2;
  if (rating < 4) return 3;
  if (rating < 4.7) return 4;
  if (rating < 5.5) return 5;
  return 6;
}

function readStatus(value: unknown): MatchStatus {
  if (
    typeof value !== 'string' ||
    !MATCH_STATUSES.includes(value as MatchStatus)
  ) {
    throw invalidPersistedState();
  }
  return value as MatchStatus;
}

function participantRowFromVisible(
  row: VisibleMatchRow,
): ParticipantRow | null {
  if (row.participant_id === null) {
    if (
      row.participant_match_id !== null ||
      row.participant_account_id !== null ||
      row.participant_slot_number !== null ||
      row.participant_status !== null ||
      row.participant_joined_at !== null ||
      row.participant_updated_at !== null ||
      row.participant_left_at !== null ||
      row.participant_version !== null
    ) {
      throw invalidPersistedState();
    }
    return null;
  }
  return {
    id: row.participant_id,
    match_id: row.participant_match_id,
    account_id: row.participant_account_id,
    slot_number: row.participant_slot_number,
    status: row.participant_status,
    joined_at: row.participant_joined_at,
    updated_at: row.participant_updated_at,
    left_at: row.participant_left_at,
    version: row.participant_version,
  };
}

function hydrateParticipant(
  row: ParticipantRow,
  matchId: MatchId,
): MatchParticipantState {
  if (
    !isMatchParticipantId(row.id) ||
    row.match_id !== matchId ||
    !isAccountId(row.account_id) ||
    (row.status !== 'active' &&
      row.status !== 'left' &&
      row.status !== 'removed')
  ) {
    throw invalidPersistedState();
  }
  const status = row.status;
  const joinedAt = readEpoch(row.joined_at);
  const updatedAt = readEpoch(row.updated_at);
  const leftAt =
    row.left_at === null ? undefined : readEpoch(row.left_at);
  if (
    updatedAt < joinedAt ||
    (status === 'active') !== (leftAt === undefined) ||
    (leftAt !== undefined && leftAt < joinedAt)
  ) {
    throw invalidPersistedState();
  }
  return Object.freeze({
    participantId: row.id,
    accountId: row.account_id,
    slotNumber: readSmallInteger(row.slot_number, [2, 3, 4]) as 2 | 3 | 4,
    status,
    joinedAt,
    updatedAt,
    ...(leftAt === undefined ? {} : { leftAt }),
    version: readPositiveSafeInteger(row.version),
  });
}

function hydrateCommand(row: CommandRow, matchId?: MatchId): AppliedMatchCommand {
  if (
    !isMatchCommandId(row.command_id) ||
    !isMatchId(row.match_id) ||
    (matchId !== undefined && row.match_id !== matchId) ||
    !isAccountId(row.actor_account_id)
  ) {
    throw invalidPersistedState();
  }
  const commandType = row.command_type;
  const resultType = row.result_type;
  if (
    (commandType !== 'create_match' &&
      commandType !== 'update_match_description' &&
      commandType !== 'join_match' &&
      commandType !== 'leave_match') ||
    (resultType !== 'match_created' &&
      resultType !== 'match_description_updated' &&
      resultType !== 'participant_joined' &&
      resultType !== 'participant_left')
  ) {
    throw invalidPersistedState();
  }
  const participantId =
    row.participant_id === null
      ? undefined
      : isMatchParticipantId(row.participant_id)
        ? row.participant_id
        : (() => {
            throw invalidPersistedState();
          })();
  if (
    ((commandType === 'join_match' || commandType === 'leave_match') ===
      (participantId === undefined)) ||
    (commandType === 'create_match' && resultType !== 'match_created') ||
    (commandType === 'update_match_description' &&
      resultType !== 'match_description_updated') ||
    (commandType === 'join_match' && resultType !== 'participant_joined') ||
    (commandType === 'leave_match' && resultType !== 'participant_left')
  ) {
    throw invalidPersistedState();
  }
  const requestDigest = decodePostgresByteaDigest(row.request_digest);
  if (!isMatchRequestDigest(requestDigest)) {
    throw invalidPersistedState();
  }
  const commandSequence = readPositiveSafeInteger(row.command_sequence);
  const matchVersion = readPositiveSafeInteger(row.match_version);
  if (commandSequence !== matchVersion) {
    throw invalidPersistedState();
  }
  return Object.freeze({
    commandId: row.command_id,
    matchId: row.match_id,
    actorAccountId: row.actor_account_id,
    commandSequence,
    requestDigest,
    commandType,
    appliedAt: readEpoch(row.applied_at),
    ...(participantId === undefined ? {} : { participantId }),
    resultType,
    matchVersion,
  });
}

function hydrateMatchBase(row: MatchRow): Omit<
  MatchState,
  'participants' | 'appliedCommands'
> {
  if (
    !isMatchId(row.id) ||
    !isAccountId(row.owner_account_id) ||
    typeof row.is_rating_match !== 'boolean'
  ) {
    throw invalidPersistedState();
  }
  const createdAt = readEpoch(row.created_at);
  const updatedAt = readEpoch(row.updated_at);
  const startsAt = readEpoch(row.starts_at);
  const terminalAt =
    row.terminal_at === null ? undefined : readEpoch(row.terminal_at);
  const status = readStatus(row.status);
  const kind = row.kind;
  const visibility = row.visibility;
  const scenario = row.scenario;
  const ratingMin = readNullableRating(row.rating_min);
  const ratingMax = readNullableRating(row.rating_max);
  if (
    (kind !== 'match' && kind !== 'private') ||
    (visibility !== 'public' && visibility !== 'private') ||
    (scenario !== 'community' &&
      scenario !== 'social' &&
      scenario !== 'private') ||
    updatedAt < createdAt ||
    startsAt < createdAt ||
    ((status === 'completed' || status === 'cancelled') !==
      (terminalAt !== undefined)) ||
    (status === 'completed' &&
      terminalAt !== undefined &&
      terminalAt < startsAt) ||
    (status === 'cancelled' &&
      terminalAt !== undefined &&
      terminalAt < createdAt)
  ) {
    throw invalidPersistedState();
  }
  const publicFormat =
    kind === 'match' &&
    visibility === 'public' &&
    (scenario === 'community' || scenario === 'social') &&
    ratingMin !== undefined &&
    ratingMax !== undefined &&
    ratingMin <= ratingMax;
  const privateFormat =
    kind === 'private' &&
    visibility === 'private' &&
    scenario === 'private' &&
    ratingMin === undefined &&
    ratingMax === undefined &&
    row.is_rating_match === false;
  if (!publicFormat && !privateFormat) {
    throw invalidPersistedState();
  }
  return Object.freeze({
    matchId: row.id,
    ownerAccountId: row.owner_account_id,
    createdAt,
    updatedAt,
    startsAt,
    durationMinutes: readSmallInteger(
      row.duration_minutes,
      [60, 90, 120, 150],
    ) as MatchDurationMinutes,
    courtId: readBoundedText(row.court_id, 1, 64),
    courtName: readBoundedText(row.court_name, 1, 128),
    courtType: readBoundedText(row.court_type, 1, 64),
    kind,
    visibility,
    scenario,
    status,
    ...(row.title === null
      ? {}
      : { title: readOptionalText(row.title, 160) as string }),
    description: readMatchDescription(row.description),
    ...(ratingMin === undefined ? {} : { ratingMin }),
    ...(ratingMax === undefined ? {} : { ratingMax }),
    isRatingMatch: row.is_rating_match,
    ...(readPrice(row.price_per_person_snapshot) === undefined
      ? {}
      : {
          pricePerPersonSnapshot: readPrice(
            row.price_per_person_snapshot,
          ) as number,
        }),
    version: readPositiveSafeInteger(row.version),
    ...(terminalAt === undefined ? {} : { terminalAt }),
  });
}

function hydrateAggregate(
  matchRow: MatchRow,
  participantRows: readonly ParticipantRow[],
  commandRows: readonly CommandRow[],
): MatchState {
  const base = hydrateMatchBase(matchRow);
  const participants = participantRows.map((row) =>
    hydrateParticipant(row, base.matchId),
  );
  const commands = commandRows.map((row) =>
    hydrateCommand(row, base.matchId),
  );
  if (
    commands.length !== base.version ||
    commands.some(
      (command, index) =>
        command.commandSequence !== index + 1 ||
        command.matchVersion !== index + 1,
    ) ||
    commands[0]?.commandType !== 'create_match' ||
    commands[0]?.actorAccountId !== base.ownerAccountId ||
    new Set(commands.map((command) => command.commandId)).size !==
      commands.length ||
    new Set(participants.map((participant) => participant.participantId))
      .size !== participants.length
  ) {
    throw invalidPersistedState();
  }
  const active = participants.filter(
    (participant) => participant.status === 'active',
  );
  if (
    new Set(active.map((participant) => participant.slotNumber)).size !==
      active.length ||
    new Set(active.map((participant) => participant.accountId)).size !==
      active.length ||
    active.some(
      (participant) => participant.accountId === base.ownerAccountId,
    ) ||
    commands.some((command) => {
      if (
        command.commandType === 'create_match' ||
        command.commandType === 'update_match_description'
      ) {
        return (
          command.actorAccountId !== base.ownerAccountId ||
          command.participantId !== undefined
        );
      }
      const participant = participants.find(
        (candidate) =>
          candidate.participantId === command.participantId,
      );
      return (
        participant === undefined ||
        participant.accountId !== command.actorAccountId
      );
    })
  ) {
    throw invalidPersistedState();
  }
  return Object.freeze({
    ...base,
    participants: Object.freeze(participants),
    appliedCommands: Object.freeze(commands),
  });
}

function hydrateFeed(row: FeedRow): MatchFeedRecord {
  if (
    !isMatchId(row.id) ||
    !isAccountId(row.owner_account_id) ||
    (row.scenario !== 'community' && row.scenario !== 'social') ||
    typeof row.is_rating_match !== 'boolean' ||
    !Number.isInteger(row.rating_min) ||
    !Number.isInteger(row.rating_max)
  ) {
    throw invalidPersistedState();
  }
  const ratingMin = row.rating_min as number;
  const ratingMax = row.rating_max as number;
  const occupiedSlots = decodePostgresNonNegativeBigint(row.occupied_slots);
  if (
    !Array.isArray(row.participant_account_ids) ||
    !Array.isArray(row.participant_slot_numbers) ||
    row.participant_account_ids.length !==
      row.participant_slot_numbers.length ||
    row.participant_account_ids.length > 3
  ) {
    throw invalidPersistedState();
  }
  const participantAccountIds =
    row.participant_account_ids as unknown[];
  const participantSlotNumbers =
    row.participant_slot_numbers as unknown[];
  const participants = participantAccountIds.map(
    (playerId, index) => {
      const slotNumber = participantSlotNumbers[index];
      if (
        !isAccountId(playerId) ||
        ![2, 3, 4].includes(slotNumber as number)
      ) {
        throw invalidPersistedState();
      }
      return Object.freeze({
        playerId,
        slotNumber: slotNumber as MatchParticipantState['slotNumber'],
      });
    },
  );
  if (
    ratingMin < 0 ||
    ratingMax > 6 ||
    ratingMin > ratingMax ||
    occupiedSlots < 1 ||
    occupiedSlots > 4 ||
    occupiedSlots !== participants.length + 1 ||
    new Set(participants.map((participant) => participant.playerId))
      .size !== participants.length ||
    new Set(participants.map((participant) => participant.slotNumber))
      .size !== participants.length ||
    participants.some(
      (participant) => participant.playerId === row.owner_account_id,
    )
  ) {
    throw invalidPersistedState();
  }
  const price = readPrice(row.price_per_person_snapshot);
  return Object.freeze({
    matchId: row.id,
    ownerAccountId: row.owner_account_id,
    startsAt: readEpoch(row.starts_at),
    durationMinutes: readSmallInteger(
      row.duration_minutes,
      [60, 90, 120, 150],
    ) as MatchDurationMinutes,
    courtId: readBoundedText(row.court_id, 1, 64),
    courtName: readBoundedText(row.court_name, 1, 128),
    courtType: readBoundedText(row.court_type, 1, 64),
    scenario: row.scenario as Exclude<MatchScenario, 'private'>,
    status: readStatus(row.status),
    ...(row.title === null
      ? {}
      : { title: readOptionalText(row.title, 160) as string }),
    description: readMatchDescription(row.description),
    ratingMin,
    ratingMax,
    isRatingMatch: row.is_rating_match,
    ...(price === undefined ? {} : { pricePerPersonSnapshot: price }),
    occupiedSlots,
    version: readPositiveSafeInteger(row.version),
    participants: Object.freeze(participants),
  });
}

function assertCommand(command: MatchCommand): void {
  if (!isValidMatchCommand(command)) {
    throw invalidInput();
  }
}

function assertCreateCommandForLookup(
  command: CreateMatchPersistenceInput,
): void {
  const expectedStatus =
    command.scenario === 'private'
      ? 'upcoming'
      : command.scenario === 'community'
        ? 'searching'
        : 'confirmed';
  if (
    !isPlainRecord(command) ||
    command.type !== 'create_match' ||
    !isUnixEpochSeconds(command.now) ||
    !isUnixEpochSeconds(command.startsAt) ||
    (command.courtId === undefined &&
      command.scenario !== 'community') ||
    command.status !== expectedStatus ||
    !isValidMatchCommand({
      ...command,
      now: command.startsAt,
      courtId: command.courtId ?? `unassigned:${command.matchId}`,
      courtName: 'trusted-court',
      courtType: 'panoramic',
      actorIsVerified: false,
      pricePerPersonSnapshot: 1,
    })
  ) {
    throw invalidInput();
  }
}

function trustedCreateCommand(
  input: CreateMatchPersistenceInput,
  court: MatchCourtSnapshot,
  actorIsVerified: boolean,
): CreateMatchCommand {
  return Object.freeze({
    ...input,
    courtId: court.courtId,
    courtName: court.courtName,
    courtType: court.courtType,
    actorIsVerified,
    pricePerPersonSnapshot: court.pricePerPersonSnapshot,
  });
}

function originalCreateDetail(
  state: MatchState,
  command: AppliedMatchCommand,
  originalDescription: string,
): MatchDetailRecord {
  if (
    command.commandType !== 'create_match' ||
    command.resultType !== 'match_created' ||
    command.commandSequence !== 1 ||
    command.matchVersion !== 1 ||
    command.appliedAt !== state.createdAt ||
    command.actorAccountId !== state.ownerAccountId
  ) {
    throw invalidPersistedState();
  }
  const status =
    state.scenario === 'private'
      ? 'upcoming'
      : state.scenario === 'community'
        ? 'searching'
        : 'confirmed';
  return Object.freeze({
    matchId: state.matchId,
    ownerAccountId: state.ownerAccountId,
    createdAt: command.appliedAt,
    updatedAt: command.appliedAt,
    startsAt: state.startsAt,
    durationMinutes: state.durationMinutes,
    courtId: state.courtId,
    courtName: state.courtName,
    courtType: state.courtType,
    kind: state.kind,
    visibility: state.visibility,
    scenario: state.scenario,
    status,
    ...(state.title === undefined ? {} : { title: state.title }),
    description: originalDescription,
    ...(state.ratingMin === undefined
      ? {}
      : { ratingMin: state.ratingMin }),
    ...(state.ratingMax === undefined
      ? {}
      : { ratingMax: state.ratingMax }),
    isRatingMatch: state.isRatingMatch,
    ...(state.pricePerPersonSnapshot === undefined
      ? {}
      : { pricePerPersonSnapshot: state.pricePerPersonSnapshot }),
    version: 1,
    participants: Object.freeze([]),
  });
}

function assertJoinInput(input: JoinMatchInput): void {
  const keys = Object.keys(input);
  if (
    !isPlainRecord(input) ||
    (keys.length !== 7 && keys.length !== 8) ||
    (input.invitationId !== undefined &&
      !isMatchInvitationId(input.invitationId)) ||
    !isValidMatchCommand({
      ...input,
      actorRatingLevel: 0,
      actorIsVerified: false,
    })
  ) {
    throw invalidInput();
  }
}

function assertFeedInput(
  input: ListPublicMatchFeedInput,
): ListPublicMatchFeedInput {
  if (
    !isPlainRecord(input) ||
    Object.keys(input).length !== 2 ||
    !isUnixEpochSeconds(input.now) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_FEED_RESULTS
  ) {
    throw invalidInput();
  }
  return input;
}

function assertAccountFeedInput(
  input: ListAccountMatchFeedInput,
): ListAccountMatchFeedInput {
  if (
    !isPlainRecord(input) ||
    Object.keys(input).length !== 3 ||
    !isAccountId(input.accountId) ||
    !isUnixEpochSeconds(input.now) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_FEED_RESULTS
  ) {
    throw invalidInput();
  }
  return input;
}

function assertFindInput(
  input: FindVisibleMatchInput,
): FindVisibleMatchInput {
  if (
    !isPlainRecord(input) ||
    Object.keys(input).length !== 2 ||
    !isMatchId(input.matchId) ||
    !isAccountId(input.viewerAccountId)
  ) {
    throw invalidInput();
  }
  return input;
}

function commandValues(command: AppliedMatchCommand): readonly unknown[] {
  return [
    command.commandId,
    command.matchId,
    command.actorAccountId,
    command.commandSequence,
    encodePostgresByteaDigest(command.requestDigest),
    command.commandType,
    command.appliedAt,
    command.participantId ?? null,
    command.resultType,
    command.matchVersion,
  ];
}

function participantForIdempotentRetry(
  command: AppliedMatchCommand,
  current: MatchParticipantState,
): MatchParticipantState {
  if (
    command.participantId !== current.participantId ||
    command.actorAccountId !== current.accountId ||
    command.appliedAt < current.joinedAt
  ) {
    throw invalidPersistedState();
  }
  if (command.commandType === 'join_match') {
    if (command.appliedAt !== current.joinedAt) {
      throw invalidPersistedState();
    }
    return Object.freeze({
      participantId: current.participantId,
      accountId: current.accountId,
      slotNumber: current.slotNumber,
      status: 'active',
      joinedAt: current.joinedAt,
      updatedAt: command.appliedAt,
      version: 1,
    });
  }
  if (command.commandType === 'leave_match') {
    return Object.freeze({
      participantId: current.participantId,
      accountId: current.accountId,
      slotNumber: current.slotNumber,
      status: 'left',
      joinedAt: current.joinedAt,
      updatedAt: command.appliedAt,
      leftAt: command.appliedAt,
      version: 2,
    });
  }
  throw invalidPersistedState();
}

function mapRejection(
  reason: MatchTransitionRejection,
): MatchCommandRejection {
  switch (reason) {
    case 'invalid_match_state':
      throw invalidPersistedState();
    case 'invalid_match_command':
    case 'match_already_exists':
      throw invalidInput();
    default:
      return reason;
  }
}

function mapPersistenceError(error: unknown): MatchPersistenceError {
  if (error instanceof MatchPersistenceError) {
    return error;
  }
  if (error instanceof PlayerProfileReadPersistenceError) {
    switch (error.reason) {
      case 'invalid_input':
        return failure('storage_failure');
      case 'invalid_persisted_state':
        return failure('invalid_persisted_state');
      case 'permission_denied':
        return failure('permission_denied');
      case 'transaction_conflict':
        return failure('transaction_conflict');
      case 'database_unavailable':
        return failure('database_unavailable');
      case 'storage_failure':
        return failure('storage_failure');
    }
  }
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return failure('storage_failure');
  }
  const { category, metadata } = classified;
  if (category === 'unique_violation') {
    switch (metadata.constraint) {
      case 'match_commands_pkey':
      case 'match_commands_match_sequence_key':
        return failure('command_conflict');
      case 'matches_pkey':
      case 'match_participants_pkey':
      case 'match_participants_active_slot_key':
      case 'match_participants_active_account_key':
        return failure('match_conflict');
      default:
        return failure('storage_failure');
    }
  }
  if (
    metadata.code === '23P01' &&
    metadata.constraint === 'matches_no_active_court_overlap'
  ) {
    return failure('match_conflict');
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
    case 'check_violation':
    case 'not_null_violation':
    case 'invalid_text_representation':
    case 'object_not_in_prerequisite_state':
      return invalidPersistedState();
    case 'unknown_postgres_error':
      return failure('storage_failure');
  }
}

function exactOne(rowCount: number | null, rows: readonly unknown[]): void {
  if (rowCount !== 1 || rows.length !== 1) {
    throw invalidPersistedState();
  }
}

export class PostgresMatchRepository implements MatchRepository {
  constructor(
    readonly profiles: PlayerProfileReader,
    readonly courts: MatchCourtCatalog,
  ) {}

  private async lockAndHydrate(
    transaction: PostgresTransaction,
    matchId: MatchId,
  ): Promise<MatchState | null> {
    const match = await transaction.query<MatchRow>(
      SELECT_MATCH_FOR_UPDATE_SQL,
      [matchId],
    );
    if (match.rowCount !== match.rows.length || match.rows.length > 1) {
      throw invalidPersistedState();
    }
    if (match.rows.length === 0) {
      return null;
    }
    const participants = await transaction.query<ParticipantRow>(
      SELECT_PARTICIPANTS_FOR_UPDATE_SQL,
      [matchId],
    );
    const commands = await transaction.query<CommandRow>(
      SELECT_COMMANDS_SQL,
      [matchId],
    );
    if (
      participants.rowCount !== participants.rows.length ||
      commands.rowCount !== commands.rows.length
    ) {
      throw invalidPersistedState();
    }
    const state = hydrateAggregate(
      match.rows[0],
      participants.rows,
      commands.rows,
    );
    const reservationTarget =
      await transaction.query<ActiveReservationTargetRow>(
        SELECT_ACTIVE_RESERVATION_TARGET_FOR_SHARE_SQL,
        [matchId],
      );
    if (
      reservationTarget.rowCount !== reservationTarget.rows.length ||
      reservationTarget.rows.length > 1
    ) {
      throw invalidPersistedState();
    }
    if (reservationTarget.rows.length === 0) return state;
    const startsAtText = reservationTarget.rows[0].target_datetime_text;
    const endsAtText = reservationTarget.rows[0].target_end_datetime_text;
    if (typeof startsAtText !== 'string' || typeof endsAtText !== 'string') {
      throw invalidPersistedState();
    }
    const startsAtMilliseconds = Date.parse(startsAtText);
    const endsAtMilliseconds = Date.parse(endsAtText);
    const durationMinutes =
      (endsAtMilliseconds - startsAtMilliseconds) / 60_000;
    const effectiveStartsAt = startsAtMilliseconds / 1_000;
    if (
      !Number.isInteger(effectiveStartsAt) ||
      !isUnixEpochSeconds(effectiveStartsAt) ||
      ![60, 90, 120, 150].includes(durationMinutes)
    ) {
      throw invalidPersistedState();
    }
    return Object.freeze({
      ...state,
      startsAt: effectiveStartsAt,
      durationMinutes: durationMinutes as MatchDurationMinutes,
    });
  }

  async create(
    transaction: PostgresTransaction,
    command: CreateMatchPersistenceInput,
  ): Promise<CreateMatchResult> {
    assertCreateCommandForLookup(command);
    try {
      const createCommandLock = await transaction.query(
        LOCK_CREATE_COMMAND_SQL,
        [command.commandId],
      );
      exactOne(createCommandLock.rowCount, createCommandLock.rows);
      const existing = await transaction.query<CommandRow>(
        SELECT_COMMAND_BY_ID_SQL,
        [command.commandId],
      );
      if (
        existing.rowCount !== existing.rows.length ||
        existing.rows.length > 1
      ) {
        throw invalidPersistedState();
      }
      if (existing.rows.length === 1) {
        const persisted = hydrateCommand(existing.rows[0]);
        if (
          persisted.matchId !== command.matchId ||
          persisted.actorAccountId !== command.actorAccountId ||
          persisted.requestDigest !== command.requestDigest ||
          persisted.commandType !== 'create_match'
        ) {
          return Object.freeze({
            outcome: 'rejected',
            reason: 'command_reuse_conflict',
          });
        }
        const state = await this.lockAndHydrate(
          transaction,
          command.matchId,
        );
        if (state === null) {
          throw invalidPersistedState();
        }
        const stateCommand = state.appliedCommands.find(
          (candidate) => candidate.commandId === persisted.commandId,
        );
        if (
          stateCommand === undefined ||
          stateCommand.requestDigest !== persisted.requestDigest ||
          stateCommand.matchId !== persisted.matchId ||
          stateCommand.actorAccountId !== persisted.actorAccountId
        ) {
          throw invalidPersistedState();
        }
        return Object.freeze({
          outcome: 'match_created',
          persistence: 'idempotent_retry',
          match: originalCreateDetail(
            state,
            persisted,
            command.description,
          ),
        });
      }
      if (command.startsAt <= command.now) {
        throw invalidInput();
      }
      const court = this.courts.resolve({
        matchId: command.matchId,
        scenario: command.scenario,
        ...(command.courtId === undefined
          ? {}
          : { courtId: command.courtId }),
        startsAt: command.startsAt,
        durationMinutes: command.durationMinutes,
      });
      if (court === undefined) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'court_invalid',
        });
      }
      if (
        command.courtId !== undefined &&
        court.courtId !== command.courtId
      ) {
        throw invalidPersistedState();
      }
      let actorIsVerified = false;
      if (command.isRatingMatch) {
        const profile = await this.profiles.findByAccountId(transaction, {
          accountId: command.actorAccountId,
        });
        if (profile.outcome === 'not_found') {
          throw failure('referential_integrity');
        }
        if (
          profile.profile.accountId !== command.actorAccountId ||
          typeof profile.profile.isVerified !== 'boolean'
        ) {
          throw invalidPersistedState();
        }
        actorIsVerified = profile.profile.isVerified;
      }
      const verifiedCommand = trustedCreateCommand(
        command,
        court,
        actorIsVerified,
      );
      assertCommand(verifiedCommand);
      const transition = transitionMatch(null, verifiedCommand);
      if (
        transition.outcome !== 'transitioned' ||
        transition.transition !== 'match_created'
      ) {
        if (transition.outcome === 'rejected') {
          const reason = mapRejection(transition.reason);
          if (reason === 'rating_verification_required') {
            return Object.freeze({
              outcome: 'rejected',
              reason,
            });
          }
        }
        throw invalidPersistedState();
      }
      const state = transition.state;
      const inserted = await transaction.query(
        INSERT_MATCH_SQL,
        [
          state.matchId,
          state.ownerAccountId,
          state.createdAt,
          state.updatedAt,
          state.startsAt,
          state.durationMinutes,
          state.courtId,
          state.courtName,
          state.courtType,
          state.kind,
          state.visibility,
          state.scenario,
          state.status,
          state.title ?? null,
          state.description,
          state.ratingMin ?? null,
          state.ratingMax ?? null,
          state.isRatingMatch,
          state.pricePerPersonSnapshot ?? null,
          state.version,
        ],
      );
      exactOne(inserted.rowCount, inserted.rows);
      const commandInserted = await transaction.query(
        INSERT_COMMAND_SQL,
        commandValues(transition.command),
      );
      exactOne(commandInserted.rowCount, commandInserted.rows);
      return Object.freeze({
        outcome: 'match_created',
        persistence: 'applied',
        match: matchDetailFromState(state),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async listPublicFeed(
    transaction: PostgresTransaction,
    input: ListPublicMatchFeedInput,
  ): Promise<readonly MatchFeedRecord[]> {
    const validated = assertFeedInput(input);
    try {
      const selected = await transaction.query<FeedRow>(
        SELECT_PUBLIC_FEED_SQL,
        [validated.now, validated.limit],
      );
      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length > validated.limit
      ) {
        throw invalidPersistedState();
      }
      const result = selected.rows.map(hydrateFeed);
      if (
        new Set(result.map((match) => match.matchId)).size !==
        result.length
      ) {
        throw invalidPersistedState();
      }
      return Object.freeze(result);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async listAccountFeed(
    transaction: PostgresTransaction,
    input: ListAccountMatchFeedInput,
  ): Promise<readonly MatchFeedRecord[]> {
    const validated = assertAccountFeedInput(input);
    try {
      const selected = await transaction.query<FeedRow>(
        SELECT_ACCOUNT_FEED_SQL,
        [validated.now, validated.accountId, validated.limit],
      );
      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length > validated.limit
      ) {
        throw invalidPersistedState();
      }
      const result = selected.rows.map(hydrateFeed);
      if (
        new Set(result.map((match) => match.matchId)).size !==
        result.length ||
        result.some(
          (match) =>
            match.ownerAccountId !== validated.accountId &&
            !match.participants.some(
              (participant) =>
                participant.playerId === validated.accountId,
            ),
        )
      ) {
        throw invalidPersistedState();
      }
      return Object.freeze(result);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async findVisibleById(
    transaction: PostgresTransaction,
    input: FindVisibleMatchInput,
  ): Promise<MatchDetailRecord | null> {
    const validated = assertFindInput(input);
    try {
      const selected = await transaction.query<VisibleMatchRow>(
        SELECT_VISIBLE_MATCH_SQL,
        [validated.matchId, validated.viewerAccountId],
      );
      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length > 3
      ) {
        throw invalidPersistedState();
      }
      if (selected.rows.length === 0) {
        return null;
      }
      const base = hydrateMatchBase(selected.rows[0]);
      const participants = selected.rows.flatMap((row) => {
        const participantRow = participantRowFromVisible(row);
        return participantRow === null
          ? []
          : [hydrateParticipant(participantRow, base.matchId)];
      });
      if (
        new Set(
          participants.map((participant) => participant.participantId),
        ).size !== participants.length ||
        participants.some(
          (participant) => participant.status !== 'active',
        )
      ) {
        throw invalidPersistedState();
      }
      return Object.freeze({
        ...base,
        participants: Object.freeze(
          participants.map((participant) =>
            Object.freeze({
              playerId: participant.accountId,
              slotNumber: participant.slotNumber,
            }),
          ),
        ),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async join(
    transaction: PostgresTransaction,
    command: JoinMatchInput,
  ): Promise<JoinMatchResult> {
    return this.applyParticipantCommand(transaction, command);
  }

  async leave(
    transaction: PostgresTransaction,
    command: LeaveMatchCommand,
  ): Promise<LeaveMatchResult> {
    return this.applyParticipantCommand(transaction, command);
  }

  async updateDescription(
    transaction: PostgresTransaction,
    command: UpdateMatchDescriptionCommand,
  ): Promise<UpdateMatchDescriptionResult> {
    assertCommand(command);
    try {
      const previous = await this.lockAndHydrate(
        transaction,
        command.matchId,
      );
      if (previous === null) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'match_not_found',
        });
      }
      const transition = transitionMatch(previous, command);
      if (transition.outcome === 'rejected') {
        return Object.freeze({
          outcome: 'rejected',
          reason: mapRejection(transition.reason),
        });
      }
      if (transition.outcome === 'idempotent_retry') {
        return Object.freeze({
          outcome: 'match_description_updated',
          persistence: 'idempotent_retry',
          matchId: command.matchId,
          description: command.description,
          matchVersion: transition.originalCommand.matchVersion,
        });
      }
      if (transition.transition !== 'match_description_updated') {
        throw invalidPersistedState();
      }
      const updated = await transaction.query(
        UPDATE_MATCH_DESCRIPTION_SQL,
        [
          command.matchId,
          transition.state.updatedAt,
          transition.state.version,
          transition.state.description,
          previous.version,
        ],
      );
      exactOne(updated.rowCount, updated.rows);
      const commandInserted = await transaction.query(
        INSERT_COMMAND_SQL,
        commandValues(transition.command),
      );
      exactOne(commandInserted.rowCount, commandInserted.rows);
      return Object.freeze({
        outcome: 'match_description_updated',
        persistence: 'applied',
        matchId: command.matchId,
        description: transition.state.description,
        matchVersion: transition.state.version,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  private async applyParticipantCommand(
    transaction: PostgresTransaction,
    command: JoinMatchInput,
  ): Promise<JoinMatchResult>;
  private async applyParticipantCommand(
    transaction: PostgresTransaction,
    command: LeaveMatchCommand,
  ): Promise<LeaveMatchResult>;
  private async applyParticipantCommand(
    transaction: PostgresTransaction,
    command: JoinMatchInput | LeaveMatchCommand,
  ): Promise<JoinMatchResult | LeaveMatchResult> {
    if (command.type === 'join_match') {
      assertJoinInput(command);
    } else {
      assertCommand(command);
    }
    try {
      const previous = await this.lockAndHydrate(
        transaction,
        command.matchId,
      );
      if (previous === null) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'match_not_found',
        });
      }
      let stateMachineCommand: JoinMatchCommand | LeaveMatchCommand;
      if (command.type === 'leave_match') {
        stateMachineCommand = command;
      } else if (
        !previous.appliedCommands.some(
          (candidate) =>
            candidate.commandId === command.commandId,
        )
      ) {
        const pending = await transaction.query<PendingInvitationRow>(
          SELECT_PENDING_INVITATIONS_FOR_UPDATE_SQL,
          [command.matchId],
        );
        if (
          pending.rowCount !== pending.rows.length ||
          pending.rows.length > 3
        ) {
          throw invalidPersistedState();
        }
        const reservations = pending.rows.map((row) => {
          if (
            !isMatchInvitationId(row.id) ||
            !isAccountId(row.invited_account_id) ||
            ![2, 3, 4].includes(row.slot_number as number)
          ) {
            throw invalidPersistedState();
          }
          return Object.freeze({
            invitationId: row.id as MatchInvitationId,
            invitedAccountId: row.invited_account_id as AccountId,
            slotNumber: row.slot_number as 2 | 3 | 4,
          });
        });
        const requestedInvitation =
          command.invitationId === undefined
            ? undefined
            : reservations.find(
                (candidate) =>
                  candidate.invitationId === command.invitationId,
              );
        if (
          command.invitationId === undefined &&
          reservations.some(
            (candidate) =>
              candidate.invitedAccountId === command.actorAccountId,
          )
        ) {
          return Object.freeze({
            outcome: 'rejected',
            reason: 'invitation_pending',
          });
        }
        if (
          command.invitationId !== undefined &&
          (requestedInvitation === undefined ||
            requestedInvitation.invitedAccountId !==
              command.actorAccountId)
        ) {
          return Object.freeze({
            outcome: 'rejected',
            reason: 'match_not_joinable',
          });
        }
        const rating = await transaction.query<ActorRatingRow>(
          SELECT_ACTOR_RATING_SQL,
          [command.actorAccountId],
        );
        exactOne(rating.rowCount, rating.rows);
        stateMachineCommand = Object.freeze({
          ...command,
          actorRatingLevel: readPlayerRatingLevel(
            rating.rows[0].rating,
          ),
          actorIsVerified:
            typeof rating.rows[0].is_verified === 'boolean'
              ? rating.rows[0].is_verified
              : (() => {
                  throw invalidPersistedState();
                })(),
          ...(requestedInvitation === undefined
            ? {}
            : {
                requestedSlotNumber:
                  requestedInvitation.slotNumber,
              }),
          reservedSlotNumbers: Object.freeze(
            reservations
              .filter(
                (candidate) =>
                  candidate.invitationId !== command.invitationId,
              )
              .map((candidate) => candidate.slotNumber),
          ),
        });
      } else {
        stateMachineCommand = Object.freeze({
          ...command,
          actorRatingLevel: 0,
          actorIsVerified: false,
          reservedSlotNumbers: Object.freeze([]),
        });
      }
      const transition = transitionMatch(
        previous,
        stateMachineCommand,
      );
      if (transition.outcome === 'rejected') {
        return Object.freeze({
          outcome: 'rejected',
          reason: mapRejection(transition.reason),
        });
      }
      if (transition.outcome === 'idempotent_retry') {
        const participantId = transition.originalCommand.participantId;
        const participant = previous.participants.find(
          (candidate) => candidate.participantId === participantId,
        );
        if (participant === undefined) {
          throw invalidPersistedState();
        }
        return Object.freeze({
          outcome:
            command.type === 'join_match'
              ? 'participant_joined'
              : 'participant_left',
          persistence: 'idempotent_retry',
          participant: participantForIdempotentRetry(
            transition.originalCommand,
            participant,
          ),
          matchVersion: transition.originalCommand.matchVersion,
        }) as JoinMatchResult | LeaveMatchResult;
      }
      if (transition.participant === undefined) {
        throw invalidPersistedState();
      }
      if (transition.transition === 'participant_joined') {
        const inserted = await transaction.query(
          INSERT_PARTICIPANT_SQL,
          [
            transition.participant.participantId,
            command.matchId,
            transition.participant.accountId,
            transition.participant.slotNumber,
            transition.participant.status,
            transition.participant.joinedAt,
            transition.participant.updatedAt,
            transition.participant.version,
          ],
        );
        exactOne(inserted.rowCount, inserted.rows);
      } else if (transition.transition === 'participant_left') {
        const previousParticipant = previous.participants.find(
          (candidate) =>
            candidate.participantId ===
            transition.participant?.participantId,
        );
        if (previousParticipant === undefined) {
          throw invalidPersistedState();
        }
        const updated = await transaction.query(
          UPDATE_PARTICIPANT_SQL,
          [
            transition.participant.participantId,
            command.matchId,
            transition.participant.status,
            transition.participant.updatedAt,
            transition.participant.leftAt,
            transition.participant.version,
            previousParticipant.version,
          ],
        );
        exactOne(updated.rowCount, updated.rows);
      } else {
        throw invalidPersistedState();
      }
      const matchUpdated = await transaction.query(
        UPDATE_MATCH_VERSION_SQL,
        [
          command.matchId,
          transition.state.updatedAt,
          transition.state.version,
          transition.state.status,
          previous.version,
        ],
      );
      exactOne(matchUpdated.rowCount, matchUpdated.rows);
      const commandInserted = await transaction.query(
        INSERT_COMMAND_SQL,
        commandValues(transition.command),
      );
      exactOne(commandInserted.rowCount, commandInserted.rows);
      return Object.freeze({
        outcome:
          transition.transition === 'participant_joined'
            ? 'participant_joined'
            : 'participant_left',
        persistence: 'applied',
        participant: transition.participant,
        matchVersion: transition.state.version,
      }) as JoinMatchResult | LeaveMatchResult;
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
