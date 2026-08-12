import { QueryResultRow } from 'pg';
import { AccountId, isAccountId } from '../accounts/account.types';
import {
  UnixEpochSeconds,
  isUnixEpochSeconds,
} from '../auth/auth.types';
import {
  MatchInvitationId,
  MatchParticipantState,
  MatchSlotNumber,
  isMatchCommandId,
  isMatchId,
  isMatchInvitationId,
  isMatchParticipantId,
  isMatchRequestDigest,
} from '../matches/match.types';
import {
  AppliedMatchInvitationCommand,
  MatchInvitationCommandId,
  MatchInvitationCommandType,
  MatchInvitationMatchSnapshot,
  MatchInvitationRecord,
  MatchInvitationRequestDigest,
  MatchInvitationResultType,
  MatchInvitationStatus,
  isMatchInvitationCommandId,
  isMatchInvitationRequestDigest,
} from '../matches/match-invitation.types';
import {
  AcceptMatchInvitationInput,
  CreateMatchInvitationInput,
  ListIncomingMatchInvitationsInput,
  ListMatchInvitationsResult,
  ListOutgoingMatchInvitationsInput,
  MatchInvitationMutationResult,
  MatchInvitationPersistenceError,
  MatchInvitationPersistenceFailure,
  MatchInvitationRepository,
  RespondMatchInvitationInput,
} from './match-invitation.repository';
import {
  MatchPersistenceError,
  MatchRepository,
} from './match.repository';
import {
  decodePostgresByteaDigest,
  decodePostgresNonNegativeBigint,
  encodePostgresByteaDigest,
} from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { readPlayerRatingLevel } from './postgres-match.repository';
import { PostgresTransaction } from './postgres-transaction';

const ACTIVE_STATUSES = new Set([
  'open',
  'searching',
  'confirmed',
  'upcoming',
]);
const PRICE_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{2})?$/u;
const MAX_LIST_RESULTS = 20;

const LOCK_COMMAND_SQL = `
  SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'backend_match:match_invitation_command:'::text || $1::text,
      0::bigint
    )
  ) AS locked
`;

const SELECT_COMMAND_SQL = `
  SELECT
    command_id,
    invitation_id,
    match_id,
    actor_account_id,
    request_digest,
    command_type,
    result_type,
    applied_at,
    invitation_version,
    match_status,
    participant_id,
    match_version
  FROM backend_match.match_invitation_commands
  WHERE command_id = $1
`;

const MATCH_COLUMNS = `
  matches.id AS match_id_value,
  matches.owner_account_id,
  matches.starts_at,
  matches.duration_minutes,
  matches.court_id,
  matches.court_name,
  matches.court_type,
  matches.scenario,
  matches.status AS match_status,
  matches.title,
  matches.rating_min,
  matches.rating_max,
  matches.is_rating_match,
  matches.price_per_person_snapshot
`;

const INVITATION_COLUMNS = `
  invitations.id AS invitation_id,
  invitations.match_id,
  invitations.invited_by_account_id,
  invitations.invited_account_id,
  invitations.slot_number,
  invitations.status AS invitation_status,
  invitations.created_at,
  invitations.updated_at,
  invitations.responded_at,
  invitations.version
`;

const SELECT_INVITATION_RECORD_SQL = `
  SELECT ${INVITATION_COLUMNS}, ${MATCH_COLUMNS}
  FROM backend_match.match_invitations AS invitations
  JOIN backend_match.matches AS matches
    ON matches.id = invitations.match_id
  WHERE invitations.id = $1
`;

const SELECT_MATCH_FOR_UPDATE_SQL = `
  SELECT
    id,
    owner_account_id,
    starts_at,
    scenario,
    status,
    rating_min,
    rating_max,
    is_rating_match
  FROM backend_match.matches
  WHERE id = $1
  FOR UPDATE
`;

const SELECT_MATCH_OWNER_SQL = `
  SELECT id, owner_account_id
  FROM backend_match.matches
  WHERE id = $1
`;

const SELECT_INVITATION_FOR_UPDATE_SQL = `
  SELECT ${INVITATION_COLUMNS}, ${MATCH_COLUMNS}
  FROM backend_match.match_invitations AS invitations
  JOIN backend_match.matches AS matches
    ON matches.id = invitations.match_id
  WHERE invitations.id = $1
  FOR UPDATE OF invitations
`;

const SELECT_ACTIVE_PARTICIPANTS_FOR_UPDATE_SQL = `
  SELECT account_id, slot_number
  FROM backend_match.match_participants
  WHERE match_id = $1
    AND status = 'active'
  ORDER BY slot_number, id
  FOR UPDATE
`;

const SELECT_PENDING_INVITATIONS_FOR_UPDATE_SQL = `
  SELECT id, invited_account_id, slot_number
  FROM backend_match.match_invitations
  WHERE match_id = $1
    AND status = 'pending'
  ORDER BY slot_number, id
  FOR UPDATE
`;

const SELECT_CANDIDATE_SQL = `
  SELECT
    accounts.id,
    accounts.status,
    accounts.role,
    ratings.rating,
    ratings.is_verified
  FROM backend_auth.accounts AS accounts
  JOIN backend_auth.player_profiles AS profiles
    ON profiles.account_id = accounts.id
  JOIN backend_auth.player_rating_states AS ratings
    ON ratings.account_id = accounts.id
  WHERE accounts.id = $1
`;

const INSERT_INVITATION_SQL = `
  INSERT INTO backend_match.match_invitations (
    id,
    match_id,
    invited_by_account_id,
    invited_account_id,
    slot_number,
    status,
    created_at,
    updated_at,
    version
  )
  VALUES ($1, $2, $3, $4, $5, 'pending', $6, $6, 1)
  RETURNING id
`;

const UPDATE_INVITATION_SQL = `
  UPDATE backend_match.match_invitations
  SET
    status = $2,
    updated_at = $3,
    responded_at = $3,
    version = 2
  WHERE id = $1
    AND status = 'pending'
    AND responded_at IS NULL
    AND version = 1
  RETURNING id
`;

const INSERT_COMMAND_SQL = `
  INSERT INTO backend_match.match_invitation_commands (
    command_id,
    invitation_id,
    match_id,
    actor_account_id,
    request_digest,
    command_type,
    result_type,
    applied_at,
    invitation_version,
    match_status,
    participant_id,
    match_version
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  RETURNING command_id
`;

const LIST_INCOMING_SQL = `
  SELECT ${INVITATION_COLUMNS}, ${MATCH_COLUMNS}
  FROM backend_match.match_invitations AS invitations
  JOIN backend_match.matches AS matches
    ON matches.id = invitations.match_id
  WHERE invitations.invited_account_id = $1
    AND invitations.status = 'pending'
    AND matches.status = ANY (
      ARRAY['open', 'searching', 'confirmed', 'upcoming']::text[]
    )
    AND matches.starts_at > $2
  ORDER BY invitations.created_at DESC, invitations.id
  LIMIT $3::integer
`;

const LIST_OUTGOING_SQL = `
  SELECT ${INVITATION_COLUMNS}, ${MATCH_COLUMNS}
  FROM backend_match.match_invitations AS invitations
  JOIN backend_match.matches AS matches
    ON matches.id = invitations.match_id
  WHERE invitations.match_id = $1
    AND invitations.status = 'pending'
  ORDER BY invitations.slot_number, invitations.created_at, invitations.id
  LIMIT $2::integer
`;

interface CommandRow extends QueryResultRow {
  readonly command_id: unknown;
  readonly invitation_id: unknown;
  readonly match_id: unknown;
  readonly actor_account_id: unknown;
  readonly request_digest: unknown;
  readonly command_type: unknown;
  readonly result_type: unknown;
  readonly applied_at: unknown;
  readonly invitation_version: unknown;
  readonly match_status: unknown;
  readonly participant_id: unknown;
  readonly match_version: unknown;
}

interface MatchRow extends QueryResultRow {
  readonly id: unknown;
  readonly owner_account_id: unknown;
  readonly starts_at: unknown;
  readonly scenario: unknown;
  readonly status: unknown;
  readonly rating_min: unknown;
  readonly rating_max: unknown;
  readonly is_rating_match: unknown;
}

interface InvitationRecordRow extends QueryResultRow {
  readonly invitation_id: unknown;
  readonly match_id: unknown;
  readonly invited_by_account_id: unknown;
  readonly invited_account_id: unknown;
  readonly slot_number: unknown;
  readonly invitation_status: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly responded_at: unknown;
  readonly version: unknown;
  readonly match_id_value: unknown;
  readonly owner_account_id: unknown;
  readonly starts_at: unknown;
  readonly duration_minutes: unknown;
  readonly court_id: unknown;
  readonly court_name: unknown;
  readonly court_type: unknown;
  readonly scenario: unknown;
  readonly match_status: unknown;
  readonly title: unknown;
  readonly rating_min: unknown;
  readonly rating_max: unknown;
  readonly is_rating_match: unknown;
  readonly price_per_person_snapshot: unknown;
}

interface ParticipantReservationRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly slot_number: unknown;
}

interface PendingInvitationRow extends QueryResultRow {
  readonly id: unknown;
  readonly invited_account_id: unknown;
  readonly slot_number: unknown;
}

interface CandidateRow extends QueryResultRow {
  readonly id: unknown;
  readonly status: unknown;
  readonly role: unknown;
  readonly rating: unknown;
  readonly is_verified: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(
  reason: MatchInvitationPersistenceFailure,
): MatchInvitationPersistenceError {
  return new MatchInvitationPersistenceError(reason);
}

function invalidInput(): MatchInvitationPersistenceError {
  return failure('invalid_input');
}

function invalidState(): MatchInvitationPersistenceError {
  return failure('invalid_persisted_state');
}

function exactOne(rowCount: number | null, rows: readonly unknown[]): void {
  if (rowCount !== 1 || rows.length !== 1) throw invalidState();
}

function readEpoch(value: unknown): UnixEpochSeconds {
  const decoded = decodePostgresNonNegativeBigint(value);
  if (!isUnixEpochSeconds(decoded)) throw invalidState();
  return decoded;
}

function readVersion(value: unknown): number {
  const decoded = decodePostgresNonNegativeBigint(value);
  if (!Number.isSafeInteger(decoded) || decoded < 1) throw invalidState();
  return decoded;
}

function readText(value: unknown, min: number, max: number): string {
  if (
    typeof value !== 'string' ||
    [...value].length < min ||
    [...value].length > max
  ) {
    throw invalidState();
  }
  return value;
}

function readPrice(value: unknown): number | undefined {
  if (value === null) return undefined;
  if (typeof value !== 'string' || !PRICE_PATTERN.test(value)) {
    throw invalidState();
  }
  const result = Number(value);
  if (
    !Number.isFinite(result) ||
    result <= 0 ||
    result > 1_000_000 ||
    Number(result.toFixed(2)) !== result
  ) {
    throw invalidState();
  }
  return result;
}

function hydrateMatch(row: InvitationRecordRow): MatchInvitationMatchSnapshot {
  if (
    !isMatchId(row.match_id_value) ||
    !isAccountId(row.owner_account_id) ||
    row.match_id_value !== row.match_id ||
    ![60, 90, 120, 150].includes(row.duration_minutes as number) ||
    !['community', 'social', 'private'].includes(row.scenario as string) ||
    ![
      'open',
      'searching',
      'confirmed',
      'upcoming',
      'completed',
      'cancelled',
    ].includes(row.match_status as string) ||
    typeof row.is_rating_match !== 'boolean'
  ) {
    throw invalidState();
  }
  const ratingMin =
    row.rating_min === null ? undefined : Number(row.rating_min);
  const ratingMax =
    row.rating_max === null ? undefined : Number(row.rating_max);
  if (
    (ratingMin !== undefined &&
      (!Number.isInteger(ratingMin) || ratingMin < 0 || ratingMin > 6)) ||
    (ratingMax !== undefined &&
      (!Number.isInteger(ratingMax) || ratingMax < 0 || ratingMax > 6)) ||
    (ratingMin !== undefined &&
      ratingMax !== undefined &&
      ratingMin > ratingMax)
  ) {
    throw invalidState();
  }
  const pricePerPersonSnapshot = readPrice(
    row.price_per_person_snapshot,
  );
  return Object.freeze({
    matchId: row.match_id_value,
    ownerAccountId: row.owner_account_id,
    startsAt: readEpoch(row.starts_at),
    durationMinutes: row.duration_minutes as 60 | 90 | 120 | 150,
    courtId: readText(row.court_id, 1, 64),
    courtName: readText(row.court_name, 1, 128),
    courtType: readText(row.court_type, 1, 64),
    scenario: row.scenario as MatchInvitationMatchSnapshot['scenario'],
    status: row.match_status as MatchInvitationMatchSnapshot['status'],
    ...(row.title === null
      ? {}
      : { title: readText(row.title, 1, 160) }),
    ...(ratingMin === undefined ? {} : { ratingMin }),
    ...(ratingMax === undefined ? {} : { ratingMax }),
    isRatingMatch: row.is_rating_match,
    ...(pricePerPersonSnapshot === undefined
      ? {}
      : { pricePerPersonSnapshot }),
  });
}

function hydrateInvitation(row: InvitationRecordRow): MatchInvitationRecord {
  if (
    !isMatchInvitationId(row.invitation_id) ||
    !isMatchId(row.match_id) ||
    !isAccountId(row.invited_by_account_id) ||
    !isAccountId(row.invited_account_id) ||
    ![2, 3, 4].includes(row.slot_number as number) ||
    !['pending', 'accepted', 'declined', 'cancelled'].includes(
      row.invitation_status as string,
    )
  ) {
    throw invalidState();
  }
  const status = row.invitation_status as MatchInvitationStatus;
  const respondedAt =
    row.responded_at === null ? undefined : readEpoch(row.responded_at);
  if (
    (status === 'pending' && respondedAt !== undefined) ||
    (status !== 'pending' && respondedAt === undefined)
  ) {
    throw invalidState();
  }
  return Object.freeze({
    invitationId: row.invitation_id,
    matchId: row.match_id,
    invitedByAccountId: row.invited_by_account_id,
    invitedAccountId: row.invited_account_id,
    slotNumber: row.slot_number as MatchSlotNumber,
    status,
    createdAt: readEpoch(row.created_at),
    updatedAt: readEpoch(row.updated_at),
    ...(respondedAt === undefined ? {} : { respondedAt }),
    version: readVersion(row.version),
    match: hydrateMatch(row),
  });
}

function hydrateCommand(row: CommandRow): AppliedMatchInvitationCommand {
  if (
    !isMatchInvitationCommandId(row.command_id) ||
    !isMatchInvitationId(row.invitation_id) ||
    !isMatchId(row.match_id) ||
    !isAccountId(row.actor_account_id) ||
    ![
      'create_invitation',
      'accept_invitation',
      'decline_invitation',
      'cancel_invitation',
    ].includes(row.command_type as string) ||
    ![
      'invitation_created',
      'invitation_accepted',
      'invitation_declined',
      'invitation_cancelled',
    ].includes(row.result_type as string) ||
    ![
      'open',
      'searching',
      'confirmed',
      'upcoming',
      'completed',
      'cancelled',
    ].includes(row.match_status as string)
  ) {
    throw invalidState();
  }
  const digest = decodePostgresByteaDigest(row.request_digest);
  if (!isMatchInvitationRequestDigest(digest)) throw invalidState();
  const participantId =
    row.participant_id === null
      ? undefined
      : isMatchParticipantId(row.participant_id)
        ? row.participant_id
        : (() => {
            throw invalidState();
          })();
  const matchVersion =
    row.match_version === null ? undefined : readVersion(row.match_version);
  if (
    (row.command_type === 'accept_invitation') !==
      (participantId !== undefined && matchVersion !== undefined)
  ) {
    throw invalidState();
  }
  return Object.freeze({
    commandId: row.command_id,
    invitationId: row.invitation_id,
    matchId: row.match_id,
    actorAccountId: row.actor_account_id,
    requestDigest: digest,
    commandType: row.command_type as MatchInvitationCommandType,
    resultType: row.result_type as MatchInvitationResultType,
    appliedAt: readEpoch(row.applied_at),
    invitationVersion: readVersion(row.invitation_version),
    matchStatus:
      row.match_status as AppliedMatchInvitationCommand['matchStatus'],
    ...(participantId === undefined ? {} : { participantId }),
    ...(matchVersion === undefined ? {} : { matchVersion }),
  });
}

function originalInvitation(
  current: MatchInvitationRecord,
  command: AppliedMatchInvitationCommand,
): MatchInvitationRecord {
  const statusByResult = {
    invitation_created: 'pending',
    invitation_accepted: 'accepted',
    invitation_declined: 'declined',
    invitation_cancelled: 'cancelled',
  } as const;
  const status = statusByResult[command.resultType];
  const { respondedAt, ...withoutResponse } = current;
  void respondedAt;
  return Object.freeze({
    ...withoutResponse,
    match: Object.freeze({
      ...current.match,
      status: command.matchStatus,
    }),
    status,
    updatedAt: command.appliedAt,
    ...(status === 'pending'
      ? {}
      : { respondedAt: command.appliedAt }),
    version: command.invitationVersion,
  });
}

function commandBindingMatches(
  command: AppliedMatchInvitationCommand,
  input: {
    readonly commandId: MatchInvitationCommandId;
    readonly invitationId: MatchInvitationId;
    readonly actorAccountId: AccountId;
    readonly requestDigest: MatchInvitationRequestDigest;
  },
  type: MatchInvitationCommandType,
): boolean {
  return (
    command.commandId === input.commandId &&
    command.invitationId === input.invitationId &&
    command.actorAccountId === input.actorAccountId &&
    command.requestDigest === input.requestDigest &&
    command.commandType === type
  );
}

function commandValues(
  command: AppliedMatchInvitationCommand,
): readonly unknown[] {
  return [
    command.commandId,
    command.invitationId,
    command.matchId,
    command.actorAccountId,
    encodePostgresByteaDigest(command.requestDigest),
    command.commandType,
    command.resultType,
    command.appliedAt,
    command.invitationVersion,
    command.matchStatus,
    command.participantId ?? null,
    command.matchVersion ?? null,
  ];
}

function validateCommonInput(input: {
  readonly commandId: MatchInvitationCommandId;
  readonly invitationId: MatchInvitationId;
  readonly actorAccountId: AccountId;
  readonly requestDigest: MatchInvitationRequestDigest;
  readonly now: UnixEpochSeconds;
}): void {
  if (
    !isRecord(input) ||
    !isMatchInvitationCommandId(input.commandId) ||
    !isMatchInvitationId(input.invitationId) ||
    !isAccountId(input.actorAccountId) ||
    !isMatchInvitationRequestDigest(input.requestDigest) ||
    !isUnixEpochSeconds(input.now)
  ) {
    throw invalidInput();
  }
}

function validateListInput(input: {
  readonly actorAccountId: AccountId;
  readonly limit: number;
}): void {
  if (
    !isRecord(input) ||
    !isAccountId(input.actorAccountId) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_LIST_RESULTS
  ) {
    throw invalidInput();
  }
}

function mapMatchRejection(reason: string) {
  switch (reason) {
    case 'command_reuse_conflict':
      return 'command_reuse_conflict' as const;
    case 'match_not_found':
      return 'match_not_found' as const;
    case 'match_closed':
    case 'match_not_joinable':
      return 'match_closed' as const;
    case 'match_started':
      return 'match_started' as const;
    case 'rating_verification_required':
      return 'rating_verification_required' as const;
    case 'rating_out_of_range':
      return 'rating_out_of_range' as const;
    case 'already_joined':
      return 'already_participant' as const;
    case 'match_full':
      return 'match_full' as const;
    default:
      return 'match_conflict' as const;
  }
}

function mapPersistenceError(error: unknown): MatchInvitationPersistenceError {
  if (error instanceof MatchInvitationPersistenceError) return error;
  if (error instanceof MatchPersistenceError) {
    switch (error.reason) {
      case 'invalid_input':
        return failure('invalid_input');
      case 'invalid_persisted_state':
        return failure('invalid_persisted_state');
      case 'match_conflict':
        return failure('invitation_conflict');
      case 'command_conflict':
        return failure('command_conflict');
      case 'referential_integrity':
        return failure('referential_integrity');
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
    if (metadata.constraint === 'match_invitation_commands_pkey') {
      return failure('command_conflict');
    }
    if (
      metadata.constraint === 'match_invitations_one_pending_player' ||
      metadata.constraint === 'match_invitations_one_pending_slot' ||
      metadata.constraint === 'match_invitations_pkey'
    ) {
      return failure('invitation_conflict');
    }
    return failure('storage_failure');
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
      return failure('invalid_persisted_state');
    case 'unknown_postgres_error':
      return failure('storage_failure');
  }
}

async function loadCommand(
  transaction: PostgresTransaction,
  commandId: MatchInvitationCommandId,
): Promise<AppliedMatchInvitationCommand | null> {
  const selected = await transaction.query<CommandRow>(
    SELECT_COMMAND_SQL,
    [commandId],
  );
  if (
    selected.rowCount !== selected.rows.length ||
    selected.rows.length > 1
  ) {
    throw invalidState();
  }
  return selected.rows.length === 0
    ? null
    : hydrateCommand(selected.rows[0]);
}

async function loadInvitation(
  transaction: PostgresTransaction,
  invitationId: MatchInvitationId,
  forUpdate = false,
): Promise<MatchInvitationRecord | null> {
  const selected = await transaction.query<InvitationRecordRow>(
    forUpdate
      ? SELECT_INVITATION_FOR_UPDATE_SQL
      : SELECT_INVITATION_RECORD_SQL,
    [invitationId],
  );
  if (
    selected.rowCount !== selected.rows.length ||
    selected.rows.length > 1
  ) {
    throw invalidState();
  }
  return selected.rows.length === 0
    ? null
    : hydrateInvitation(selected.rows[0]);
}

export class PostgresMatchInvitationRepository
  implements MatchInvitationRepository
{
  constructor(readonly matches: MatchRepository) {}

  async create(
    transaction: PostgresTransaction,
    input: CreateMatchInvitationInput,
  ): Promise<MatchInvitationMutationResult> {
    validateCommonInput(input);
    if (
      Object.keys(input).length !== 8 ||
      !isMatchId(input.matchId) ||
      !isAccountId(input.invitedAccountId) ||
      ![2, 3, 4].includes(input.slotNumber)
    ) {
      throw invalidInput();
    }
    try {
      const locked = await transaction.query(LOCK_COMMAND_SQL, [
        input.commandId,
      ]);
      exactOne(locked.rowCount, locked.rows);
      const existing = await loadCommand(transaction, input.commandId);
      if (existing !== null) {
        if (
          !commandBindingMatches(existing, input, 'create_invitation') ||
          existing.matchId !== input.matchId
        ) {
          return Object.freeze({
            outcome: 'rejected',
            reason: 'command_reuse_conflict',
          });
        }
        const invitation = await loadInvitation(
          transaction,
          input.invitationId,
        );
        if (invitation === null) throw invalidState();
        return Object.freeze({
          outcome: 'invitation_created',
          persistence: 'idempotent_retry',
          invitation: originalInvitation(invitation, existing),
        });
      }
      const match = await transaction.query<MatchRow>(
        SELECT_MATCH_FOR_UPDATE_SQL,
        [input.matchId],
      );
      if (match.rowCount !== match.rows.length || match.rows.length > 1) {
        throw invalidState();
      }
      if (match.rows.length === 0) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'match_not_found',
        });
      }
      const matchRow = match.rows[0];
      if (
        !isMatchId(matchRow.id) ||
        !isAccountId(matchRow.owner_account_id) ||
        !isUnixEpochSeconds(
          decodePostgresNonNegativeBigint(matchRow.starts_at),
        ) ||
        typeof matchRow.status !== 'string' ||
        typeof matchRow.is_rating_match !== 'boolean'
      ) {
        throw invalidState();
      }
      if (matchRow.owner_account_id !== input.actorAccountId) {
        return Object.freeze({ outcome: 'rejected', reason: 'forbidden' });
      }
      if (!ACTIVE_STATUSES.has(matchRow.status)) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'match_closed',
        });
      }
      if (readEpoch(matchRow.starts_at) <= input.now) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'match_started',
        });
      }
      if (input.invitedAccountId === input.actorAccountId) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'already_participant',
        });
      }
      const participants =
        await transaction.query<ParticipantReservationRow>(
          SELECT_ACTIVE_PARTICIPANTS_FOR_UPDATE_SQL,
          [input.matchId],
        );
      const pending = await transaction.query<PendingInvitationRow>(
        SELECT_PENDING_INVITATIONS_FOR_UPDATE_SQL,
        [input.matchId],
      );
      if (
        participants.rowCount !== participants.rows.length ||
        pending.rowCount !== pending.rows.length ||
        participants.rows.length > 3 ||
        pending.rows.length > 3
      ) {
        throw invalidState();
      }
      const active = participants.rows.map((row) => {
        if (
          !isAccountId(row.account_id) ||
          ![2, 3, 4].includes(row.slot_number as number)
        ) {
          throw invalidState();
        }
        return row;
      });
      const reservations = pending.rows.map((row) => {
        if (
          !isMatchInvitationId(row.id) ||
          !isAccountId(row.invited_account_id) ||
          ![2, 3, 4].includes(row.slot_number as number)
        ) {
          throw invalidState();
        }
        return row;
      });
      if (
        active.some(
          (row) => row.account_id === input.invitedAccountId,
        )
      ) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'already_participant',
        });
      }
      if (
        reservations.some(
          (row) => row.invited_account_id === input.invitedAccountId,
        )
      ) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'already_invited',
        });
      }
      if (
        active.some((row) => row.slot_number === input.slotNumber) ||
        reservations.some(
          (row) => row.slot_number === input.slotNumber,
        )
      ) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'slot_unavailable',
        });
      }
      if (active.length + reservations.length >= 3) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'match_full',
        });
      }
      const candidate = await transaction.query<CandidateRow>(
        SELECT_CANDIDATE_SQL,
        [input.invitedAccountId],
      );
      if (
        candidate.rowCount !== candidate.rows.length ||
        candidate.rows.length > 1
      ) {
        throw invalidState();
      }
      if (candidate.rows.length === 0) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'player_not_found',
        });
      }
      const candidateRow = candidate.rows[0];
      if (
        candidateRow.id !== input.invitedAccountId ||
        candidateRow.status !== 'active' ||
        candidateRow.role !== 'player' ||
        typeof candidateRow.is_verified !== 'boolean'
      ) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'player_not_found',
        });
      }
      if (matchRow.is_rating_match) {
        const level = readPlayerRatingLevel(candidateRow.rating);
        if (!candidateRow.is_verified) {
          return Object.freeze({
            outcome: 'rejected',
            reason: 'rating_verification_required',
          });
        }
        if (
          !Number.isInteger(matchRow.rating_min) ||
          !Number.isInteger(matchRow.rating_max) ||
          level < (matchRow.rating_min as number) ||
          level > (matchRow.rating_max as number)
        ) {
          return Object.freeze({
            outcome: 'rejected',
            reason: 'rating_out_of_range',
          });
        }
      }
      const inserted = await transaction.query(
        INSERT_INVITATION_SQL,
        [
          input.invitationId,
          input.matchId,
          input.actorAccountId,
          input.invitedAccountId,
          input.slotNumber,
          input.now,
        ],
      );
      exactOne(inserted.rowCount, inserted.rows);
      const invitation = await loadInvitation(
        transaction,
        input.invitationId,
      );
      if (invitation === null) throw invalidState();
      const command: AppliedMatchInvitationCommand = Object.freeze({
        commandId: input.commandId,
        invitationId: input.invitationId,
        matchId: input.matchId,
        actorAccountId: input.actorAccountId,
        requestDigest: input.requestDigest,
        commandType: 'create_invitation',
        resultType: 'invitation_created',
        appliedAt: input.now,
        invitationVersion: 1,
        matchStatus: invitation.match.status,
      });
      const commandInserted = await transaction.query(
        INSERT_COMMAND_SQL,
        commandValues(command),
      );
      exactOne(commandInserted.rowCount, commandInserted.rows);
      return Object.freeze({
        outcome: 'invitation_created',
        persistence: 'applied',
        invitation,
      });
    } catch (error) {
      const mapped = mapPersistenceError(error);
      if (mapped.reason === 'invitation_conflict') {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'match_conflict',
        });
      }
      throw mapped;
    }
  }

  async listIncoming(
    transaction: PostgresTransaction,
    input: ListIncomingMatchInvitationsInput,
  ): Promise<ListMatchInvitationsResult> {
    validateListInput(input);
    if (
      Object.keys(input).length !== 3 ||
      !isUnixEpochSeconds(input.now)
    ) {
      throw invalidInput();
    }
    try {
      const selected = await transaction.query<InvitationRecordRow>(
        LIST_INCOMING_SQL,
        [input.actorAccountId, input.now, input.limit],
      );
      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length > input.limit
      ) {
        throw invalidState();
      }
      const invitations = selected.rows.map(hydrateInvitation);
      return Object.freeze({
        outcome: 'found',
        invitations: Object.freeze(invitations),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async listOutgoing(
    transaction: PostgresTransaction,
    input: ListOutgoingMatchInvitationsInput,
  ): Promise<ListMatchInvitationsResult> {
    validateListInput(input);
    if (Object.keys(input).length !== 3 || !isMatchId(input.matchId)) {
      throw invalidInput();
    }
    try {
      const match = await transaction.query<MatchRow>(
        SELECT_MATCH_OWNER_SQL,
        [input.matchId],
      );
      if (match.rowCount !== match.rows.length || match.rows.length > 1) {
        throw invalidState();
      }
      if (match.rows.length === 0) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'match_not_found',
        });
      }
      if (
        match.rows[0].id !== input.matchId ||
        !isAccountId(match.rows[0].owner_account_id)
      ) {
        throw invalidState();
      }
      if (match.rows[0].owner_account_id !== input.actorAccountId) {
        return Object.freeze({ outcome: 'rejected', reason: 'forbidden' });
      }
      const selected = await transaction.query<InvitationRecordRow>(
        LIST_OUTGOING_SQL,
        [input.matchId, input.limit],
      );
      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length > input.limit
      ) {
        throw invalidState();
      }
      return Object.freeze({
        outcome: 'found',
        invitations: Object.freeze(
          selected.rows.map(hydrateInvitation),
        ),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async accept(
    transaction: PostgresTransaction,
    input: AcceptMatchInvitationInput,
  ): Promise<MatchInvitationMutationResult> {
    validateCommonInput(input);
    if (
      Object.keys(input).length !== 8 ||
      !isMatchCommandId(input.matchCommandId) ||
      !isMatchRequestDigest(input.matchRequestDigest) ||
      !isMatchParticipantId(input.participantId)
    ) {
      throw invalidInput();
    }
    try {
      const locked = await transaction.query(LOCK_COMMAND_SQL, [
        input.commandId,
      ]);
      exactOne(locked.rowCount, locked.rows);
      const existing = await loadCommand(transaction, input.commandId);
      if (existing !== null) {
        if (!commandBindingMatches(existing, input, 'accept_invitation')) {
          return Object.freeze({
            outcome: 'rejected',
            reason: 'command_reuse_conflict',
          });
        }
        const invitation = await loadInvitation(
          transaction,
          input.invitationId,
        );
        if (
          invitation === null ||
          existing.participantId === undefined ||
          existing.matchVersion === undefined
        ) {
          throw invalidState();
        }
        const original = originalInvitation(invitation, existing);
        const participant: MatchParticipantState = Object.freeze({
          participantId: existing.participantId,
          accountId: input.actorAccountId,
          slotNumber: original.slotNumber,
          status: 'active',
          joinedAt: existing.appliedAt,
          updatedAt: existing.appliedAt,
          version: 1,
        });
        return Object.freeze({
          outcome: 'invitation_accepted',
          persistence: 'idempotent_retry',
          invitation: original,
          participant,
          matchVersion: existing.matchVersion,
        });
      }
      const invitation = await loadInvitation(
        transaction,
        input.invitationId,
      );
      if (invitation === null) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'invitation_not_found',
        });
      }
      if (invitation.invitedAccountId !== input.actorAccountId) {
        return Object.freeze({ outcome: 'rejected', reason: 'forbidden' });
      }
      if (invitation.status !== 'pending') {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'invitation_closed',
        });
      }
      const joined = await this.matches.join(transaction, {
        type: 'join_match',
        matchId: invitation.matchId,
        commandId: input.matchCommandId,
        actorAccountId: input.actorAccountId,
        participantId: input.participantId,
        requestDigest: input.matchRequestDigest,
        now: input.now,
        invitationId: input.invitationId,
      });
      if (joined.outcome === 'rejected') {
        return Object.freeze({
          outcome: 'rejected',
          reason: mapMatchRejection(joined.reason),
        });
      }
      if (joined.persistence !== 'applied') {
        throw invalidState();
      }
      const updated = await transaction.query(UPDATE_INVITATION_SQL, [
        input.invitationId,
        'accepted',
        input.now,
      ]);
      exactOne(updated.rowCount, updated.rows);
      const resultInvitation = await loadInvitation(
        transaction,
        input.invitationId,
      );
      if (resultInvitation === null) throw invalidState();
      const command: AppliedMatchInvitationCommand = Object.freeze({
        commandId: input.commandId,
        invitationId: input.invitationId,
        matchId: invitation.matchId,
        actorAccountId: input.actorAccountId,
        requestDigest: input.requestDigest,
        commandType: 'accept_invitation',
        resultType: 'invitation_accepted',
        appliedAt: input.now,
        invitationVersion: 2,
        matchStatus: resultInvitation.match.status,
        participantId: joined.participant.participantId,
        matchVersion: joined.matchVersion,
      });
      const commandInserted = await transaction.query(
        INSERT_COMMAND_SQL,
        commandValues(command),
      );
      exactOne(commandInserted.rowCount, commandInserted.rows);
      return Object.freeze({
        outcome: 'invitation_accepted',
        persistence: 'applied',
        invitation: resultInvitation,
        participant: joined.participant,
        matchVersion: joined.matchVersion,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  decline(
    transaction: PostgresTransaction,
    input: RespondMatchInvitationInput,
  ): Promise<MatchInvitationMutationResult> {
    return this.terminalize(
      transaction,
      input,
      'decline_invitation',
      'invitation_declined',
      'declined',
    );
  }

  cancel(
    transaction: PostgresTransaction,
    input: RespondMatchInvitationInput,
  ): Promise<MatchInvitationMutationResult> {
    return this.terminalize(
      transaction,
      input,
      'cancel_invitation',
      'invitation_cancelled',
      'cancelled',
    );
  }

  private async terminalize(
    transaction: PostgresTransaction,
    input: RespondMatchInvitationInput,
    commandType: 'decline_invitation' | 'cancel_invitation',
    resultType: 'invitation_declined' | 'invitation_cancelled',
    status: 'declined' | 'cancelled',
  ): Promise<MatchInvitationMutationResult> {
    validateCommonInput(input);
    if (Object.keys(input).length !== 5) throw invalidInput();
    try {
      const locked = await transaction.query(LOCK_COMMAND_SQL, [
        input.commandId,
      ]);
      exactOne(locked.rowCount, locked.rows);
      const existing = await loadCommand(transaction, input.commandId);
      if (existing !== null) {
        if (!commandBindingMatches(existing, input, commandType)) {
          return Object.freeze({
            outcome: 'rejected',
            reason: 'command_reuse_conflict',
          });
        }
        const invitation = await loadInvitation(
          transaction,
          input.invitationId,
        );
        if (invitation === null) throw invalidState();
        return Object.freeze({
          outcome: resultType,
          persistence: 'idempotent_retry',
          invitation: originalInvitation(invitation, existing),
        });
      }
      const initial = await loadInvitation(
        transaction,
        input.invitationId,
      );
      if (initial === null) {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'invitation_not_found',
        });
      }
      const match = await transaction.query<MatchRow>(
        SELECT_MATCH_FOR_UPDATE_SQL,
        [initial.matchId],
      );
      exactOne(match.rowCount, match.rows);
      const invitation = await loadInvitation(
        transaction,
        input.invitationId,
        true,
      );
      if (invitation === null) throw invalidState();
      const authorized =
        commandType === 'decline_invitation'
          ? invitation.invitedAccountId === input.actorAccountId
          : invitation.match.ownerAccountId === input.actorAccountId;
      if (!authorized) {
        return Object.freeze({ outcome: 'rejected', reason: 'forbidden' });
      }
      if (invitation.status !== 'pending') {
        return Object.freeze({
          outcome: 'rejected',
          reason: 'invitation_closed',
        });
      }
      const updated = await transaction.query(UPDATE_INVITATION_SQL, [
        input.invitationId,
        status,
        input.now,
      ]);
      exactOne(updated.rowCount, updated.rows);
      const resultInvitation = await loadInvitation(
        transaction,
        input.invitationId,
      );
      if (resultInvitation === null) throw invalidState();
      const command: AppliedMatchInvitationCommand = Object.freeze({
        commandId: input.commandId,
        invitationId: input.invitationId,
        matchId: invitation.matchId,
        actorAccountId: input.actorAccountId,
        requestDigest: input.requestDigest,
        commandType,
        resultType,
        appliedAt: input.now,
        invitationVersion: 2,
        matchStatus: resultInvitation.match.status,
      });
      const commandInserted = await transaction.query(
        INSERT_COMMAND_SQL,
        commandValues(command),
      );
      exactOne(commandInserted.rowCount, commandInserted.rows);
      return Object.freeze({
        outcome: resultType,
        persistence: 'applied',
        invitation: resultInvitation,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
