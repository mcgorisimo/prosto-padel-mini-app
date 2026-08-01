import { QueryResultRow } from 'pg';
import { AccountId, isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  ActiveMatchLineupAssignmentRecord,
  MatchLineupMutationRecord,
  MatchLineupRecord,
  isMatchLineupAssignmentId,
  isMatchLineupCommandId,
  isMatchLineupCourtSide,
  isMatchLineupRequestDigest,
  isMatchLineupTeamNumber,
} from '../matches/match-lineup.types';
import { isMatchId } from '../matches/match.types';
import {
  AssignMatchLineupSlotInput,
  MatchLineupPersistenceError,
  MatchLineupPersistenceFailure,
  MatchLineupRepository,
  MutateMatchLineupResult,
  ReadMatchLineupInput,
  ReadMatchLineupResult,
  ReleaseMatchLineupSlotInput,
} from './match-lineup.repository';
import {
  decodePostgresByteaDigest,
  decodePostgresNonNegativeBigint,
  encodePostgresByteaDigest,
} from './postgres-codecs';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';

const ACTIVE_MATCH_STATUSES = new Set([
  'open',
  'searching',
  'confirmed',
  'upcoming',
]);

const INITIALIZE_LINEUP_SQL = `
  INSERT INTO backend_match.match_lineups (
    match_id, status, created_at, updated_at, version
  )
  SELECT matches.id, 'draft', $3, $3, 1
  FROM backend_match.matches AS matches
  WHERE matches.id = $1
    AND matches.kind = 'match'
    AND matches.scenario <> 'private'
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
  ON CONFLICT (match_id) DO NOTHING
  RETURNING match_id
`;

const SELECT_LINEUP_FOR_SHARE_SQL = `
  SELECT
    lineups.match_id,
    lineups.status AS lineup_status,
    lineups.created_at,
    lineups.updated_at,
    lineups.version AS lineup_version,
    matches.owner_account_id,
    matches.starts_at,
    matches.kind,
    matches.visibility,
    matches.scenario,
    matches.status AS match_status
  FROM backend_match.match_lineups AS lineups
  JOIN backend_match.matches AS matches ON matches.id = lineups.match_id
  WHERE lineups.match_id = $1
    AND matches.kind = 'match'
    AND matches.scenario <> 'private'
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
  FOR SHARE OF lineups
`;

const SELECT_LINEUP_FOR_UPDATE_SQL = SELECT_LINEUP_FOR_SHARE_SQL.replace(
  'FOR SHARE OF lineups',
  'FOR UPDATE OF lineups',
);

const SELECT_ELIGIBLE_ACCOUNTS_SQL = `
  SELECT selected.account_id, selected.slot_number
  FROM (
    SELECT matches.owner_account_id AS account_id, 1::smallint AS slot_number
    FROM backend_match.matches AS matches
    WHERE matches.id = $1
    UNION ALL
    SELECT participants.account_id, participants.slot_number
    FROM backend_match.match_participants AS participants
    WHERE participants.match_id = $1
      AND participants.status = 'active'
  ) AS selected
  ORDER BY selected.slot_number, selected.account_id
`;

const SELECT_ACTIVE_ASSIGNMENTS_SQL = `
  SELECT
    id,
    match_id,
    account_id,
    team_number,
    court_side,
    status,
    assigned_at,
    updated_at,
    released_at,
    version
  FROM backend_match.match_lineup_assignments
  WHERE match_id = $1
    AND status = 'active'
  ORDER BY team_number, court_side, id
`;

const SELECT_COMMAND_SQL = `
  SELECT
    commands.command_id,
    commands.match_id,
    commands.actor_account_id,
    commands.request_digest,
    commands.command_type,
    commands.result_type,
    commands.applied_at,
    commands.lineup_version,
    commands.assignment_id,
    assignments.account_id,
    assignments.team_number,
    assignments.court_side
  FROM backend_match.match_lineup_commands AS commands
  LEFT JOIN backend_match.match_lineup_assignments AS assignments
    ON assignments.id = commands.assignment_id
   AND assignments.match_id = commands.match_id
  WHERE commands.command_id = $1
`;

const INSERT_ASSIGNMENT_SQL = `
  INSERT INTO backend_match.match_lineup_assignments (
    id, match_id, account_id, team_number, court_side,
    status, assigned_at, updated_at, version
  )
  VALUES ($1, $2, $3, $4, $5, 'active', $6, $6, 1)
  RETURNING
    id, match_id, account_id, team_number, court_side, status,
    assigned_at, updated_at, released_at, version
`;

const RELEASE_ASSIGNMENT_SQL = `
  UPDATE backend_match.match_lineup_assignments
  SET
    status = 'released',
    updated_at = $3,
    released_at = $3,
    version = version + 1
  WHERE id = $1
    AND match_id = $2
    AND status = 'active'
  RETURNING
    id, match_id, account_id, team_number, court_side, status,
    assigned_at, updated_at, released_at, version
`;

const UPDATE_LINEUP_VERSION_SQL = `
  UPDATE backend_match.match_lineups
  SET updated_at = $2, version = version + 1
  WHERE match_id = $1
    AND status = 'draft'
    AND updated_at <= $2
  RETURNING version
`;

const INSERT_COMMAND_SQL = `
  INSERT INTO backend_match.match_lineup_commands (
    command_id, match_id, actor_account_id, request_digest,
    command_type, result_type, applied_at, lineup_version,
    assignment_id, change_request_id
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
  RETURNING command_id
`;

interface LineupRow extends QueryResultRow {
  readonly match_id: unknown;
  readonly lineup_status: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly lineup_version: unknown;
  readonly owner_account_id: unknown;
  readonly starts_at: unknown;
  readonly kind: unknown;
  readonly visibility: unknown;
  readonly scenario: unknown;
  readonly match_status: unknown;
}

interface EligibleAccountRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly slot_number: unknown;
}

interface AssignmentRow extends QueryResultRow {
  readonly id: unknown;
  readonly match_id: unknown;
  readonly account_id: unknown;
  readonly team_number: unknown;
  readonly court_side: unknown;
  readonly status: unknown;
  readonly assigned_at: unknown;
  readonly updated_at: unknown;
  readonly released_at: unknown;
  readonly version: unknown;
}

interface CommandRow extends QueryResultRow {
  readonly command_id: unknown;
  readonly match_id: unknown;
  readonly actor_account_id: unknown;
  readonly request_digest: unknown;
  readonly command_type: unknown;
  readonly result_type: unknown;
  readonly applied_at: unknown;
  readonly lineup_version: unknown;
  readonly assignment_id: unknown;
  readonly account_id: unknown;
  readonly team_number: unknown;
  readonly court_side: unknown;
}

function failure(reason: MatchLineupPersistenceFailure) {
  return new MatchLineupPersistenceError(reason);
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
  const result = decodePostgresNonNegativeBigint(value);
  if (!isUnixEpochSeconds(result)) throw invalidState();
  return result;
}

function readPositiveInteger(value: unknown) {
  const result = decodePostgresNonNegativeBigint(value);
  if (!Number.isSafeInteger(result) || result < 1) throw invalidState();
  return result;
}

function hydrateLineup(row: LineupRow) {
  if (
    !isMatchId(row.match_id) ||
    !isAccountId(row.owner_account_id) ||
    !['draft', 'locked'].includes(String(row.lineup_status)) ||
    typeof row.kind !== 'string' ||
    typeof row.visibility !== 'string' ||
    typeof row.scenario !== 'string' ||
    typeof row.match_status !== 'string'
  ) {
    throw invalidState();
  }
  const createdAt = readEpoch(row.created_at);
  const updatedAt = readEpoch(row.updated_at);
  if (updatedAt < createdAt) throw invalidState();
  return Object.freeze({
    matchId: row.match_id,
    status: row.lineup_status as 'draft' | 'locked',
    createdAt,
    updatedAt,
    version: readPositiveInteger(row.lineup_version),
    ownerAccountId: row.owner_account_id,
    startsAt: readEpoch(row.starts_at),
    kind: row.kind,
    visibility: row.visibility,
    scenario: row.scenario,
    matchStatus: row.match_status,
  });
}

function hydrateAssignment(row: AssignmentRow): ActiveMatchLineupAssignmentRecord {
  if (
    !isMatchLineupAssignmentId(row.id) ||
    !isMatchId(row.match_id) ||
    !isAccountId(row.account_id) ||
    !isMatchLineupTeamNumber(row.team_number) ||
    !isMatchLineupCourtSide(row.court_side) ||
    row.status !== 'active' ||
    row.released_at !== null
  ) {
    throw invalidState();
  }
  const assignedAt = readEpoch(row.assigned_at);
  const updatedAt = readEpoch(row.updated_at);
  if (updatedAt < assignedAt) throw invalidState();
  return Object.freeze({
    assignmentId: row.id,
    matchId: row.match_id,
    accountId: row.account_id,
    teamNumber: row.team_number,
    courtSide: row.court_side,
    assignedAt,
    updatedAt,
    version: readPositiveInteger(row.version),
  });
}

function validateReleasedAssignment(
  row: AssignmentRow,
  expected: ActiveMatchLineupAssignmentRecord,
  releasedAt: number,
) {
  if (
    row.id !== expected.assignmentId ||
    row.match_id !== expected.matchId ||
    row.account_id !== expected.accountId ||
    row.team_number !== expected.teamNumber ||
    row.court_side !== expected.courtSide ||
    row.status !== 'released' ||
    readEpoch(row.assigned_at) !== expected.assignedAt ||
    readEpoch(row.updated_at) !== releasedAt ||
    readEpoch(row.released_at) !== releasedAt ||
    readPositiveInteger(row.version) !== expected.version + 1
  ) {
    throw invalidState();
  }
}

function validateReadInput(input: ReadMatchLineupInput) {
  if (
    !isMatchId(input.matchId) ||
    !isAccountId(input.actorAccountId) ||
    !isUnixEpochSeconds(input.now)
  ) {
    throw invalidInput();
  }
  return input;
}

function validateAssignInput(input: AssignMatchLineupSlotInput) {
  validateReadInput(input);
  if (
    !isMatchLineupCommandId(input.commandId) ||
    !isMatchLineupAssignmentId(input.assignmentId) ||
    !isMatchLineupRequestDigest(input.requestDigest) ||
    !isMatchLineupTeamNumber(input.teamNumber) ||
    !isMatchLineupCourtSide(input.courtSide)
  ) {
    throw invalidInput();
  }
  return input;
}

function validateReleaseInput(input: ReleaseMatchLineupSlotInput) {
  validateReadInput(input);
  if (
    !isMatchLineupCommandId(input.commandId) ||
    !isMatchLineupRequestDigest(input.requestDigest)
  ) {
    throw invalidInput();
  }
  return input;
}

function mapPersistenceError(error: unknown): MatchLineupPersistenceError {
  if (error instanceof MatchLineupPersistenceError) return error;
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') return failure('storage_failure');
  const { category, metadata } = classified;
  if (category === 'unique_violation') {
    if (metadata.constraint === 'match_lineup_commands_pkey') {
      return failure('command_conflict');
    }
    if (
      metadata.constraint === 'match_lineup_assignments_pkey' ||
      metadata.constraint === 'match_lineup_assignments_identity_key' ||
      metadata.constraint === 'match_lineup_assignments_active_slot_key' ||
      metadata.constraint === 'match_lineup_assignments_active_account_key'
    ) {
      return failure('assignment_conflict');
    }
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

async function initialize(
  transaction: PostgresTransaction,
  input: ReadMatchLineupInput,
) {
  const inserted = await transaction.query(INITIALIZE_LINEUP_SQL, [
    input.matchId,
    input.actorAccountId,
    input.now,
  ]);
  if (
    inserted.rowCount !== inserted.rows.length ||
    inserted.rows.length > 1 ||
    (inserted.rows.length === 1 && inserted.rows[0]?.match_id !== input.matchId)
  ) {
    throw invalidState();
  }
}

async function selectLineup(
  transaction: PostgresTransaction,
  input: ReadMatchLineupInput,
  mode: 'share' | 'update',
) {
  const selected = await transaction.query<LineupRow>(
    mode === 'share' ? SELECT_LINEUP_FOR_SHARE_SQL : SELECT_LINEUP_FOR_UPDATE_SQL,
    [input.matchId, input.actorAccountId],
  );
  if (selected.rowCount !== selected.rows.length || selected.rows.length > 1) {
    throw invalidState();
  }
  return selected.rows.length === 0 ? undefined : hydrateLineup(selected.rows[0]);
}

async function readEligibleAccounts(
  transaction: PostgresTransaction,
  matchId: string,
) {
  const selected = await transaction.query<EligibleAccountRow>(
    SELECT_ELIGIBLE_ACCOUNTS_SQL,
    [matchId],
  );
  if (
    selected.rowCount !== selected.rows.length ||
    selected.rows.length < 1 ||
    selected.rows.length > 4 ||
    selected.rows.some(
      (row) => !isAccountId(row.account_id) || ![1, 2, 3, 4].includes(row.slot_number as number),
    )
  ) {
    throw invalidState();
  }
  const accountIds = selected.rows.map((row) => row.account_id as AccountId);
  if (new Set(accountIds).size !== accountIds.length) throw invalidState();
  return Object.freeze(accountIds);
}

async function readAssignments(
  transaction: PostgresTransaction,
  matchId: string,
) {
  const selected = await transaction.query<AssignmentRow>(
    SELECT_ACTIVE_ASSIGNMENTS_SQL,
    [matchId],
  );
  if (selected.rowCount !== selected.rows.length || selected.rows.length > 4) {
    throw invalidState();
  }
  const assignments = selected.rows.map(hydrateAssignment);
  if (
    new Set(assignments.map((assignment) => assignment.assignmentId)).size !== assignments.length ||
    new Set(assignments.map((assignment) => assignment.accountId)).size !== assignments.length ||
    new Set(assignments.map((assignment) => `${assignment.teamNumber}:${assignment.courtSide}`)).size !== assignments.length
  ) {
    throw invalidState();
  }
  return Object.freeze(assignments);
}

async function readCommand(
  transaction: PostgresTransaction,
  commandId: string,
) {
  const selected = await transaction.query<CommandRow>(SELECT_COMMAND_SQL, [commandId]);
  if (selected.rowCount !== selected.rows.length || selected.rows.length > 1) {
    throw invalidState();
  }
  return selected.rows[0];
}

function mutationFromCommand(row: CommandRow): MatchLineupMutationRecord {
  if (
    !isMatchLineupAssignmentId(row.assignment_id) ||
    !isMatchId(row.match_id) ||
    !isAccountId(row.account_id) ||
    !isMatchLineupTeamNumber(row.team_number) ||
    !isMatchLineupCourtSide(row.court_side)
  ) {
    throw invalidState();
  }
  return Object.freeze({
    assignmentId: row.assignment_id,
    matchId: row.match_id,
    accountId: row.account_id,
    teamNumber: row.team_number,
    courtSide: row.court_side,
    appliedAt: readEpoch(row.applied_at),
    lineupVersion: readPositiveInteger(row.lineup_version),
  });
}

function commandMatches(
  row: CommandRow,
  input: AssignMatchLineupSlotInput | ReleaseMatchLineupSlotInput,
  allowedTypes: readonly string[],
) {
  return (
    row.command_id === input.commandId &&
    row.match_id === input.matchId &&
    row.actor_account_id === input.actorAccountId &&
    decodePostgresByteaDigest(row.request_digest) === input.requestDigest &&
    allowedTypes.includes(String(row.command_type)) &&
    (row.command_type === 'claim_lineup_slot'
      ? row.result_type === 'lineup_slot_claimed'
      : row.command_type === 'move_lineup_slot'
        ? row.result_type === 'lineup_slot_moved'
        : row.command_type === 'release_lineup_slot' && row.result_type === 'lineup_slot_released') &&
    (allowedTypes.length !== 2 || row.assignment_id === (input as AssignMatchLineupSlotInput).assignmentId)
  );
}

async function updateLineupVersion(
  transaction: PostgresTransaction,
  matchId: string,
  now: number,
) {
  const updated = await transaction.query(UPDATE_LINEUP_VERSION_SQL, [matchId, now]);
  exactOne(updated.rowCount, updated.rows);
  return readPositiveInteger(updated.rows[0]?.version);
}

async function insertCommand(
  transaction: PostgresTransaction,
  input: AssignMatchLineupSlotInput | ReleaseMatchLineupSlotInput,
  commandType: 'claim_lineup_slot' | 'move_lineup_slot' | 'release_lineup_slot',
  assignmentId: string,
  lineupVersion: number,
) {
  const resultType = commandType === 'claim_lineup_slot'
    ? 'lineup_slot_claimed'
    : commandType === 'move_lineup_slot'
      ? 'lineup_slot_moved'
      : 'lineup_slot_released';
  const inserted = await transaction.query(INSERT_COMMAND_SQL, [
    input.commandId,
    input.matchId,
    input.actorAccountId,
    encodePostgresByteaDigest(input.requestDigest),
    commandType,
    resultType,
    input.now,
    lineupVersion,
    assignmentId,
  ]);
  exactOne(inserted.rowCount, inserted.rows);
  if (inserted.rows[0]?.command_id !== input.commandId) throw invalidState();
}

function mutationFromAssignment(
  assignment: ActiveMatchLineupAssignmentRecord,
  appliedAt: number,
  lineupVersion: number,
): MatchLineupMutationRecord {
  return Object.freeze({
    assignmentId: assignment.assignmentId,
    matchId: assignment.matchId,
    accountId: assignment.accountId,
    teamNumber: assignment.teamNumber,
    courtSide: assignment.courtSide,
    appliedAt: appliedAt as MatchLineupMutationRecord['appliedAt'],
    lineupVersion,
  });
}

export class PostgresMatchLineupRepository implements MatchLineupRepository {
  async read(
    transaction: PostgresTransaction,
    input: ReadMatchLineupInput,
  ): Promise<ReadMatchLineupResult> {
    try {
      const validated = validateReadInput(input);
      await initialize(transaction, validated);
      const lineup = await selectLineup(transaction, validated, 'share');
      if (lineup === undefined) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_not_found' });
      }
      const eligibleAccountIds = await readEligibleAccounts(transaction, validated.matchId);
      const assignments = await readAssignments(transaction, validated.matchId);
      if (assignments.some((assignment) => !eligibleAccountIds.includes(assignment.accountId))) {
        throw invalidState();
      }
      const record: MatchLineupRecord = Object.freeze({
        matchId: lineup.matchId,
        status: lineup.status,
        createdAt: lineup.createdAt,
        updatedAt: lineup.updatedAt,
        version: lineup.version,
        eligibleAccountIds,
        assignments,
      });
      return Object.freeze({ outcome: 'found', lineup: record });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async assign(
    transaction: PostgresTransaction,
    input: AssignMatchLineupSlotInput,
  ): Promise<MutateMatchLineupResult> {
    try {
      const validated = validateAssignInput(input);
      await initialize(transaction, validated);
      const lineup = await selectLineup(transaction, validated, 'update');
      if (lineup === undefined) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_not_found' });
      }
      const existingCommand = await readCommand(transaction, validated.commandId);
      if (existingCommand !== undefined) {
        if (!commandMatches(existingCommand, validated, ['claim_lineup_slot', 'move_lineup_slot'])) {
          return Object.freeze({ outcome: 'rejected', reason: 'command_reuse_conflict' });
        }
        const mutation = mutationFromCommand(existingCommand);
        if (
          mutation.accountId !== validated.actorAccountId ||
          mutation.teamNumber !== validated.teamNumber ||
          mutation.courtSide !== validated.courtSide
        ) {
          throw invalidState();
        }
        return Object.freeze({
          outcome: existingCommand.command_type === 'claim_lineup_slot'
            ? 'lineup_slot_claimed'
            : 'lineup_slot_moved',
          persistence: 'idempotent_retry',
          assignment: mutation,
        });
      }
      if (lineup.status === 'locked') {
        return Object.freeze({ outcome: 'rejected', reason: 'lineup_locked' });
      }
      if (
        lineup.kind !== 'match' ||
        lineup.scenario === 'private' ||
        !ACTIVE_MATCH_STATUSES.has(lineup.matchStatus)
      ) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_closed' });
      }
      if (lineup.startsAt <= validated.now) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_started' });
      }
      const eligibleAccountIds = await readEligibleAccounts(transaction, validated.matchId);
      if (!eligibleAccountIds.includes(validated.actorAccountId)) {
        return Object.freeze({ outcome: 'rejected', reason: 'participant_not_active' });
      }
      const assignments = await readAssignments(transaction, validated.matchId);
      const current = assignments.find((assignment) => assignment.accountId === validated.actorAccountId);
      const target = assignments.find(
        (assignment) => assignment.teamNumber === validated.teamNumber && assignment.courtSide === validated.courtSide,
      );
      if (target !== undefined && target.accountId !== validated.actorAccountId) {
        return Object.freeze({ outcome: 'rejected', reason: 'slot_occupied' });
      }
      if (current !== undefined && target?.assignmentId === current.assignmentId) {
        return Object.freeze({ outcome: 'rejected', reason: 'already_assigned' });
      }
      if (current !== undefined) {
        const released = await transaction.query<AssignmentRow>(RELEASE_ASSIGNMENT_SQL, [
          current.assignmentId,
          validated.matchId,
          validated.now,
        ]);
        exactOne(released.rowCount, released.rows);
        validateReleasedAssignment(released.rows[0], current, validated.now);
      }
      const inserted = await transaction.query<AssignmentRow>(INSERT_ASSIGNMENT_SQL, [
        validated.assignmentId,
        validated.matchId,
        validated.actorAccountId,
        validated.teamNumber,
        validated.courtSide,
        validated.now,
      ]);
      exactOne(inserted.rowCount, inserted.rows);
      const assignment = hydrateAssignment(inserted.rows[0]);
      const commandType = current === undefined ? 'claim_lineup_slot' : 'move_lineup_slot';
      const lineupVersion = await updateLineupVersion(transaction, validated.matchId, validated.now);
      await insertCommand(
        transaction,
        validated,
        commandType,
        assignment.assignmentId,
        lineupVersion,
      );
      return Object.freeze({
        outcome: current === undefined ? 'lineup_slot_claimed' : 'lineup_slot_moved',
        persistence: 'applied',
        assignment: mutationFromAssignment(assignment, validated.now, lineupVersion),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async release(
    transaction: PostgresTransaction,
    input: ReleaseMatchLineupSlotInput,
  ): Promise<MutateMatchLineupResult> {
    try {
      const validated = validateReleaseInput(input);
      await initialize(transaction, validated);
      return await this.releaseInternal(transaction, validated, false);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async releaseForParticipantLeave(
    transaction: PostgresTransaction,
    input: ReleaseMatchLineupSlotInput,
  ): Promise<boolean> {
    try {
      const result = await this.releaseInternal(transaction, validateReleaseInput(input), true);
      if (result.outcome === 'rejected') {
        if (result.reason === 'not_assigned' || result.reason === 'match_not_found') return false;
        throw invalidState();
      }
      return true;
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  private async releaseInternal(
    transaction: PostgresTransaction,
    input: ReleaseMatchLineupSlotInput,
    participantLeave: boolean,
  ): Promise<MutateMatchLineupResult> {
    const lineup = await selectLineup(transaction, input, 'update');
    if (lineup === undefined) {
      return Object.freeze({ outcome: 'rejected', reason: 'match_not_found' });
    }
    const existingCommand = await readCommand(transaction, input.commandId);
    if (existingCommand !== undefined) {
      if (!commandMatches(existingCommand, input, ['release_lineup_slot'])) {
        return Object.freeze({ outcome: 'rejected', reason: 'command_reuse_conflict' });
      }
      const mutation = mutationFromCommand(existingCommand);
      if (mutation.accountId !== input.actorAccountId) throw invalidState();
      return Object.freeze({
        outcome: 'lineup_slot_released',
        persistence: 'idempotent_retry',
        assignment: mutation,
      });
    }
    if (!participantLeave) {
      if (lineup.status === 'locked') {
        return Object.freeze({ outcome: 'rejected', reason: 'lineup_locked' });
      }
      if (!ACTIVE_MATCH_STATUSES.has(lineup.matchStatus)) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_closed' });
      }
      if (lineup.startsAt <= input.now) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_started' });
      }
      const eligibleAccountIds = await readEligibleAccounts(transaction, input.matchId);
      if (!eligibleAccountIds.includes(input.actorAccountId)) {
        return Object.freeze({ outcome: 'rejected', reason: 'participant_not_active' });
      }
    }
    const assignments = await readAssignments(transaction, input.matchId);
    const current = assignments.find((assignment) => assignment.accountId === input.actorAccountId);
    if (current === undefined) {
      return Object.freeze({ outcome: 'rejected', reason: 'not_assigned' });
    }
    const released = await transaction.query<AssignmentRow>(RELEASE_ASSIGNMENT_SQL, [
      current.assignmentId,
      input.matchId,
      input.now,
    ]);
    exactOne(released.rowCount, released.rows);
    validateReleasedAssignment(released.rows[0], current, input.now);
    const lineupVersion = await updateLineupVersion(transaction, input.matchId, input.now);
    await insertCommand(
      transaction,
      input,
      'release_lineup_slot',
      current.assignmentId,
      lineupVersion,
    );
    return Object.freeze({
      outcome: 'lineup_slot_released',
      persistence: 'applied',
      assignment: mutationFromAssignment(current, input.now, lineupVersion),
    });
  }
}
