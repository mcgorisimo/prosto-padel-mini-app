import { QueryResultRow } from 'pg';
import { AccountId, isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  MatchResultMutationRecord,
  MatchResultRecord,
  MatchResultSetRecord,
  MatchResultStatus,
  isMatchResultCommandId,
  isMatchResultId,
  isMatchResultRequestDigest,
  isMatchResultStatus,
  isMatchResultTeamNumber,
} from '../matches/match-result.types';
import { isMatchId } from '../matches/match.types';
import {
  ConfirmMatchResultInput,
  DisputeMatchResultInput,
  MatchResultPersistenceError,
  MatchResultPersistenceFailure,
  MatchResultRepository,
  MutateMatchResultResult,
  ReadMatchResultInput,
  ReadMatchResultResult,
  SubmitMatchResultInput,
} from './match-result.repository';
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

const SELECT_MATCH_CONTEXT_SQL = `
  SELECT
    matches.id,
    matches.owner_account_id,
    matches.starts_at,
    matches.duration_minutes,
    matches.kind,
    matches.visibility,
    matches.scenario,
    matches.status,
    matches.updated_at,
    matches.version
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
  FOR UPDATE OF matches
`;

const SELECT_MATCH_CONTEXT_FOR_SHARE_SQL = SELECT_MATCH_CONTEXT_SQL.replace(
  'FOR UPDATE OF matches',
  'FOR SHARE OF matches',
);

const SELECT_LINEUP_FOR_UPDATE_SQL = `
  SELECT match_id, status, updated_at, version
  FROM backend_match.match_lineups
  WHERE match_id = $1
  FOR UPDATE
`;

const SELECT_ASSIGNMENTS_SQL = `
  SELECT account_id, team_number, court_side
  FROM backend_match.match_lineup_assignments
  WHERE match_id = $1
    AND status = 'active'
  ORDER BY team_number, court_side, id
`;

const SELECT_ELIGIBLE_ACCOUNTS_SQL = `
  SELECT selected.account_id
  FROM (
    SELECT matches.owner_account_id AS account_id
    FROM backend_match.matches AS matches
    WHERE matches.id = $1
    UNION ALL
    SELECT participants.account_id
    FROM backend_match.match_participants AS participants
    WHERE participants.match_id = $1
      AND participants.status = 'active'
  ) AS selected
  ORDER BY selected.account_id
`;

const SELECT_RESULT_SQL = `
  SELECT
    id,
    match_id,
    lineup_version,
    team1_left_account_id,
    team1_right_account_id,
    team2_left_account_id,
    team2_right_account_id,
    team1_set1_games,
    team2_set1_games,
    team1_set2_games,
    team2_set2_games,
    team1_set3_games,
    team2_set3_games,
    winning_team,
    status,
    submitted_by_account_id,
    submitted_at,
    confirmed_by_account_id,
    confirmed_at,
    disputed_by_account_id,
    disputed_at,
    version
  FROM backend_match.match_results
  WHERE match_id = $1
`;

const SELECT_RESULT_FOR_UPDATE_SQL = `${SELECT_RESULT_SQL} FOR UPDATE`;

const SELECT_COMMAND_SQL = `
  SELECT
    command_id,
    result_id,
    match_id,
    actor_account_id,
    request_digest,
    command_type,
    result_type,
    applied_at,
    result_status,
    result_version
  FROM backend_match.match_result_commands
  WHERE command_id = $1
`;

const LOCK_LINEUP_SQL = `
  UPDATE backend_match.match_lineups
  SET status = 'locked', updated_at = $2, locked_at = $2, version = version + 1
  WHERE match_id = $1
    AND status = 'draft'
    AND updated_at <= $2
  RETURNING version
`;

const INSERT_RESULT_SQL = `
  INSERT INTO backend_match.match_results (
    id, match_id, lineup_version,
    team1_left_account_id, team1_right_account_id,
    team2_left_account_id, team2_right_account_id,
    team1_set1_games, team2_set1_games,
    team1_set2_games, team2_set2_games,
    team1_set3_games, team2_set3_games,
    winning_team, status, submitted_by_account_id, submitted_at, version
  )
  VALUES (
    $1, $2, $3,
    $4, $5, $6, $7,
    $8, $9, $10, $11, $12, $13,
    $14, 'submitted', $15, $16, 1
  )
  RETURNING *
`;

const CONFIRM_RESULT_SQL = `
  UPDATE backend_match.match_results
  SET
    status = 'confirmed',
    confirmed_by_account_id = $2,
    confirmed_at = $3,
    version = version + 1
  WHERE id = $1
    AND status = 'submitted'
  RETURNING *
`;

const DISPUTE_RESULT_SQL = `
  UPDATE backend_match.match_results
  SET
    status = 'disputed',
    disputed_by_account_id = $2,
    disputed_at = $3,
    version = version + 1
  WHERE id = $1
    AND status = 'submitted'
  RETURNING *
`;

const COMPLETE_MATCH_SQL = `
  UPDATE backend_match.matches
  SET updated_at = $2, status = 'completed', version = version + 1, terminal_at = $2
  WHERE id = $1
    AND status IN ('open', 'searching', 'confirmed', 'upcoming')
    AND starts_at + duration_minutes::bigint * 60 <= $2
    AND updated_at <= $2
  RETURNING version
`;

const INSERT_COMMAND_SQL = `
  INSERT INTO backend_match.match_result_commands (
    command_id, result_id, match_id, actor_account_id, request_digest,
    command_type, result_type, applied_at, result_status, result_version
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  RETURNING command_id
`;

interface MatchContextRow extends QueryResultRow {
  readonly id: unknown;
  readonly owner_account_id: unknown;
  readonly starts_at: unknown;
  readonly duration_minutes: unknown;
  readonly kind: unknown;
  readonly visibility: unknown;
  readonly scenario: unknown;
  readonly status: unknown;
  readonly updated_at: unknown;
  readonly version: unknown;
}

interface LineupRow extends QueryResultRow {
  readonly match_id: unknown;
  readonly status: unknown;
  readonly updated_at: unknown;
  readonly version: unknown;
}

interface AssignmentRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly team_number: unknown;
  readonly court_side: unknown;
}

interface EligibleAccountRow extends QueryResultRow {
  readonly account_id: unknown;
}

interface ResultRow extends QueryResultRow {
  readonly id: unknown;
  readonly match_id: unknown;
  readonly lineup_version: unknown;
  readonly team1_left_account_id: unknown;
  readonly team1_right_account_id: unknown;
  readonly team2_left_account_id: unknown;
  readonly team2_right_account_id: unknown;
  readonly team1_set1_games: unknown;
  readonly team2_set1_games: unknown;
  readonly team1_set2_games: unknown;
  readonly team2_set2_games: unknown;
  readonly team1_set3_games: unknown;
  readonly team2_set3_games: unknown;
  readonly winning_team: unknown;
  readonly status: unknown;
  readonly submitted_by_account_id: unknown;
  readonly submitted_at: unknown;
  readonly confirmed_by_account_id: unknown;
  readonly confirmed_at: unknown;
  readonly disputed_by_account_id: unknown;
  readonly disputed_at: unknown;
  readonly version: unknown;
}

interface CommandRow extends QueryResultRow {
  readonly command_id: unknown;
  readonly result_id: unknown;
  readonly match_id: unknown;
  readonly actor_account_id: unknown;
  readonly request_digest: unknown;
  readonly command_type: unknown;
  readonly result_type: unknown;
  readonly applied_at: unknown;
  readonly result_status: unknown;
  readonly result_version: unknown;
}

function invalidState(): MatchResultPersistenceError {
  return new MatchResultPersistenceError('invalid_persisted_state');
}

function exactOne(rowCount: number | null, rows: readonly unknown[]): void {
  if (rowCount !== 1 || rows.length !== 1) throw invalidState();
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw invalidState();
  }
  return value as number;
}

function nullableAccount(value: unknown): AccountId | undefined {
  if (value === null) return undefined;
  if (!isAccountId(value)) throw invalidState();
  return value;
}

function nullableEpoch(value: unknown): MatchResultRecord['confirmedAt'] {
  if (value === null) return undefined;
  const epoch = decodePostgresNonNegativeBigint(value);
  if (!isUnixEpochSeconds(epoch)) throw invalidState();
  return epoch;
}

function score(team1Games: unknown, team2Games: unknown): MatchResultSetRecord {
  return Object.freeze({
    team1Games: integer(team1Games, 0, 7),
    team2Games: integer(team2Games, 0, 7),
  });
}

function hydrateResult(row: ResultRow): MatchResultRecord {
  if (
    !isMatchResultId(row.id) ||
    !isMatchId(row.match_id) ||
    !isAccountId(row.team1_left_account_id) ||
    !isAccountId(row.team1_right_account_id) ||
    !isAccountId(row.team2_left_account_id) ||
    !isAccountId(row.team2_right_account_id) ||
    !isMatchResultTeamNumber(row.winning_team) ||
    !isMatchResultStatus(row.status) ||
    !isAccountId(row.submitted_by_account_id)
  ) {
    throw invalidState();
  }
  const lineupVersion = decodePostgresNonNegativeBigint(row.lineup_version);
  const submittedAt = decodePostgresNonNegativeBigint(row.submitted_at);
  const version = decodePostgresNonNegativeBigint(row.version);
  if (
    lineupVersion < 1 ||
    version < 1 ||
    !isUnixEpochSeconds(submittedAt)
  ) {
    throw invalidState();
  }
  const sets = [
    score(row.team1_set1_games, row.team2_set1_games),
    score(row.team1_set2_games, row.team2_set2_games),
  ];
  if ((row.team1_set3_games === null) !== (row.team2_set3_games === null)) {
    throw invalidState();
  }
  if (row.team1_set3_games !== null) {
    sets.push(score(row.team1_set3_games, row.team2_set3_games));
  }
  const confirmedByAccountId = nullableAccount(row.confirmed_by_account_id);
  const confirmedAt = nullableEpoch(row.confirmed_at);
  const disputedByAccountId = nullableAccount(row.disputed_by_account_id);
  const disputedAt = nullableEpoch(row.disputed_at);
  if (
    (confirmedByAccountId === undefined) !== (confirmedAt === undefined) ||
    (disputedByAccountId === undefined) !== (disputedAt === undefined) ||
    new Set([
      row.team1_left_account_id,
      row.team1_right_account_id,
      row.team2_left_account_id,
      row.team2_right_account_id,
    ]).size !== 4 ||
    winningTeam(sets) !== row.winning_team ||
    ![
      row.team1_left_account_id,
      row.team1_right_account_id,
      row.team2_left_account_id,
      row.team2_right_account_id,
    ].includes(row.submitted_by_account_id) ||
    (confirmedAt !== undefined && confirmedAt < submittedAt) ||
    (disputedAt !== undefined && disputedAt < submittedAt)
  ) {
    throw invalidState();
  }
  const submitterIsTeam1 =
    row.submitted_by_account_id === row.team1_left_account_id ||
    row.submitted_by_account_id === row.team1_right_account_id;
  const confirmerIsOpposingTeam = confirmedByAccountId === undefined
    ? false
    : submitterIsTeam1
      ? confirmedByAccountId === row.team2_left_account_id ||
        confirmedByAccountId === row.team2_right_account_id
      : confirmedByAccountId === row.team1_left_account_id ||
        confirmedByAccountId === row.team1_right_account_id;
  const disputerIsParticipant = disputedByAccountId !== undefined && [
    row.team1_left_account_id,
    row.team1_right_account_id,
    row.team2_left_account_id,
    row.team2_right_account_id,
  ].includes(disputedByAccountId);
  if (
    (row.status === 'submitted' &&
      (confirmedByAccountId !== undefined || disputedByAccountId !== undefined)) ||
    (row.status === 'confirmed' &&
      (!confirmerIsOpposingTeam || disputedByAccountId !== undefined)) ||
    (row.status === 'disputed' &&
      (!disputerIsParticipant ||
        disputedByAccountId === row.submitted_by_account_id ||
        confirmedByAccountId !== undefined))
  ) {
    throw invalidState();
  }
  return Object.freeze({
    resultId: row.id,
    matchId: row.match_id,
    lineupVersion,
    team1LeftAccountId: row.team1_left_account_id,
    team1RightAccountId: row.team1_right_account_id,
    team2LeftAccountId: row.team2_left_account_id,
    team2RightAccountId: row.team2_right_account_id,
    sets: Object.freeze(sets),
    winningTeam: row.winning_team,
    status: row.status,
    submittedByAccountId: row.submitted_by_account_id,
    submittedAt,
    ...(confirmedByAccountId === undefined ? {} : { confirmedByAccountId }),
    ...(confirmedAt === undefined ? {} : { confirmedAt }),
    ...(disputedByAccountId === undefined ? {} : { disputedByAccountId }),
    ...(disputedAt === undefined ? {} : { disputedAt }),
    version,
  });
}

function validateReadInput<T extends ReadMatchResultInput>(input: T): T {
  if (
    !isMatchId(input.matchId) ||
    !isAccountId(input.actorAccountId) ||
    !isUnixEpochSeconds(input.now)
  ) {
    throw new MatchResultPersistenceError('invalid_input');
  }
  return input;
}

function validateMutationInput<
  T extends ConfirmMatchResultInput | DisputeMatchResultInput,
>(input: T): T {
  validateReadInput(input);
  if (
    !isMatchResultCommandId(input.commandId) ||
    !isMatchResultRequestDigest(input.requestDigest)
  ) {
    throw new MatchResultPersistenceError('invalid_input');
  }
  return input;
}

function validSet(set: unknown): set is MatchResultSetRecord {
  if (
    typeof set !== 'object' ||
    set === null ||
    Array.isArray(set)
  ) {
    return false;
  }
  const record = set as Record<string, unknown>;
  if (
    !Object.prototype.hasOwnProperty.call(record, 'team1Games') ||
    !Object.prototype.hasOwnProperty.call(record, 'team2Games') ||
    !Number.isInteger(record.team1Games) ||
    !Number.isInteger(record.team2Games) ||
    record.team1Games === record.team2Games
  ) {
    return false;
  }
  const winner = Math.max(record.team1Games as number, record.team2Games as number);
  const loser = Math.min(record.team1Games as number, record.team2Games as number);
  return (winner === 6 && loser >= 0 && loser <= 4) ||
    (winner === 7 && loser >= 5 && loser <= 6);
}

function winningTeam(sets: unknown): 1 | 2 | undefined {
  if (
    !Array.isArray(sets) ||
    (sets.length !== 2 && sets.length !== 3) ||
    sets.some((set) => !validSet(set))
  ) {
    return undefined;
  }
  const team1Wins = sets.filter((set) => set.team1Games > set.team2Games).length;
  const team2Wins = sets.length - team1Wins;
  if (sets.length === 2) {
    if (team1Wins === 2) return 1;
    if (team2Wins === 2) return 2;
    return undefined;
  }
  if (team1Wins === 2 && team2Wins === 1) return 1;
  if (team2Wins === 2 && team1Wins === 1) return 2;
  return undefined;
}

function validateSubmitInput(input: SubmitMatchResultInput): SubmitMatchResultInput {
  validateMutationInput(input);
  if (!isMatchResultId(input.resultId) || winningTeam(input.sets) === undefined) {
    throw new MatchResultPersistenceError('invalid_input');
  }
  return input;
}

function hydrateContext(row: MatchContextRow) {
  if (
    !isMatchId(row.id) ||
    !isAccountId(row.owner_account_id) ||
    !['match', 'private'].includes(String(row.kind)) ||
    !['public', 'private'].includes(String(row.visibility)) ||
    !['community', 'social', 'private'].includes(String(row.scenario)) ||
    ![
      'open',
      'searching',
      'confirmed',
      'upcoming',
      'completed',
      'cancelled',
    ].includes(String(row.status))
  ) {
    throw invalidState();
  }
  const startsAt = decodePostgresNonNegativeBigint(row.starts_at);
  const updatedAt = decodePostgresNonNegativeBigint(row.updated_at);
  const durationMinutes = integer(row.duration_minutes, 1, 1440);
  const version = decodePostgresNonNegativeBigint(row.version);
  if (!isUnixEpochSeconds(startsAt) || !isUnixEpochSeconds(updatedAt) || version < 1) {
    throw invalidState();
  }
  return Object.freeze({
    matchId: row.id,
    startsAt,
    durationMinutes,
    kind: row.kind as 'match' | 'private',
    scenario: row.scenario as 'community' | 'social' | 'private',
    status: row.status as string,
  });
}

async function readContext(
  transaction: PostgresTransaction,
  input: ReadMatchResultInput,
  mode: 'share' | 'update',
) {
  const selected = await transaction.query<MatchContextRow>(
    mode === 'update' ? SELECT_MATCH_CONTEXT_SQL : SELECT_MATCH_CONTEXT_FOR_SHARE_SQL,
    [input.matchId, input.actorAccountId],
  );
  if (selected.rowCount === 0 && selected.rows.length === 0) return undefined;
  exactOne(selected.rowCount, selected.rows);
  return hydrateContext(selected.rows[0]);
}

async function readResult(
  transaction: PostgresTransaction,
  matchId: string,
  lock: boolean,
): Promise<MatchResultRecord | undefined> {
  const selected = await transaction.query<ResultRow>(
    lock ? SELECT_RESULT_FOR_UPDATE_SQL : SELECT_RESULT_SQL,
    [matchId],
  );
  if (selected.rowCount === 0 && selected.rows.length === 0) return undefined;
  exactOne(selected.rowCount, selected.rows);
  return hydrateResult(selected.rows[0]);
}

async function readCommand(
  transaction: PostgresTransaction,
  commandId: string,
): Promise<CommandRow | undefined> {
  const selected = await transaction.query<CommandRow>(SELECT_COMMAND_SQL, [commandId]);
  if (selected.rowCount === 0 && selected.rows.length === 0) return undefined;
  exactOne(selected.rowCount, selected.rows);
  return selected.rows[0];
}

function commandMutation(
  row: CommandRow,
  input: ConfirmMatchResultInput | DisputeMatchResultInput,
  commandType: 'submit_result' | 'confirm_result' | 'dispute_result',
) {
  if (
    !isMatchResultCommandId(row.command_id) ||
    row.command_id !== input.commandId ||
    !isMatchId(row.match_id) ||
    !isAccountId(row.actor_account_id)
  ) {
    throw invalidState();
  }
  const persistedDigest = decodePostgresByteaDigest(row.request_digest);
  if (
    row.match_id !== input.matchId ||
    row.actor_account_id !== input.actorAccountId ||
    row.command_type !== commandType ||
    persistedDigest !== input.requestDigest
  ) {
    return undefined;
  }
  if (!isMatchResultId(row.result_id) || !isMatchResultStatus(row.result_status)) {
    throw invalidState();
  }
  const appliedAt = decodePostgresNonNegativeBigint(row.applied_at);
  const resultVersion = decodePostgresNonNegativeBigint(row.result_version);
  if (!isUnixEpochSeconds(appliedAt) || resultVersion < 1) throw invalidState();
  const expectedResultType = commandType === 'submit_result'
    ? 'result_submitted'
    : commandType === 'confirm_result'
      ? 'result_confirmed'
      : 'result_disputed';
  const expectedStatus = commandType === 'submit_result'
    ? 'submitted'
    : commandType === 'confirm_result'
      ? 'confirmed'
      : 'disputed';
  if (row.result_type !== expectedResultType || row.result_status !== expectedStatus) {
    throw invalidState();
  }
  const result: MatchResultMutationRecord = Object.freeze({
    resultId: row.result_id,
    matchId: row.match_id,
    status: row.result_status,
    appliedAt,
    resultVersion,
  });
  return Object.freeze({
    outcome: expectedResultType,
    persistence: 'idempotent_retry' as const,
    result,
  });
}

async function insertCommand(
  transaction: PostgresTransaction,
  input: ConfirmMatchResultInput | DisputeMatchResultInput,
  result: MatchResultRecord,
  commandType: 'submit_result' | 'confirm_result' | 'dispute_result',
): Promise<void> {
  const resultType = commandType === 'submit_result'
    ? 'result_submitted'
    : commandType === 'confirm_result'
      ? 'result_confirmed'
      : 'result_disputed';
  const inserted = await transaction.query(INSERT_COMMAND_SQL, [
    input.commandId,
    result.resultId,
    input.matchId,
    input.actorAccountId,
    encodePostgresByteaDigest(input.requestDigest),
    commandType,
    resultType,
    input.now,
    result.status,
    result.version,
  ]);
  exactOne(inserted.rowCount, inserted.rows);
  if (inserted.rows[0]?.command_id !== input.commandId) throw invalidState();
}

function applied(
  outcome: 'result_submitted' | 'result_confirmed' | 'result_disputed',
  result: MatchResultRecord,
  now: MatchResultMutationRecord['appliedAt'],
): MutateMatchResultResult {
  return Object.freeze({
    outcome,
    persistence: 'applied',
    result: Object.freeze({
      resultId: result.resultId,
      matchId: result.matchId,
      status: result.status,
      appliedAt: now,
      resultVersion: result.version,
    }),
  });
}

function participantTeam(result: MatchResultRecord, accountId: AccountId): 1 | 2 | undefined {
  if (result.team1LeftAccountId === accountId || result.team1RightAccountId === accountId) return 1;
  if (result.team2LeftAccountId === accountId || result.team2RightAccountId === accountId) return 2;
  return undefined;
}

function mapPersistenceError(error: unknown): MatchResultPersistenceError {
  if (error instanceof MatchResultPersistenceError) return error;
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') {
    return new MatchResultPersistenceError('storage_failure');
  }
  let reason: MatchResultPersistenceFailure;
  switch (classified.category) {
    case 'unique_violation':
      reason = classified.metadata.constraint === 'match_result_commands_pkey'
        ? 'command_conflict'
        : 'result_conflict';
      break;
    case 'foreign_key_violation': reason = 'referential_integrity'; break;
    case 'check_violation':
    case 'not_null_violation':
    case 'invalid_text_representation': reason = 'invalid_persisted_state'; break;
    case 'serialization_failure':
    case 'deadlock_detected': reason = 'transaction_conflict'; break;
    case 'insufficient_privilege': reason = 'permission_denied'; break;
    case 'query_canceled':
    case 'admin_shutdown':
    case 'connection_exception': reason = 'database_unavailable'; break;
    case 'object_not_in_prerequisite_state':
    case 'unknown_postgres_error': reason = 'storage_failure'; break;
  }
  return new MatchResultPersistenceError(reason);
}

export class PostgresMatchResultRepository implements MatchResultRepository {
  async read(
    transaction: PostgresTransaction,
    input: ReadMatchResultInput,
  ): Promise<ReadMatchResultResult> {
    try {
      const validated = validateReadInput(input);
      const context = await readContext(transaction, validated, 'share');
      if (context === undefined) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_not_found' });
      }
      const result = await readResult(transaction, validated.matchId, false);
      if (result === undefined) {
        return Object.freeze({ outcome: 'rejected', reason: 'result_not_found' });
      }
      if (participantTeam(result, validated.actorAccountId) === undefined) throw invalidState();
      return Object.freeze({ outcome: 'found', result });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async submit(
    transaction: PostgresTransaction,
    input: SubmitMatchResultInput,
  ): Promise<MutateMatchResultResult> {
    try {
      const validated = validateSubmitInput(input);
      const context = await readContext(transaction, validated, 'update');
      if (context === undefined) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_not_found' });
      }
      const command = await readCommand(transaction, validated.commandId);
      if (command !== undefined) {
        const retry = commandMutation(command, validated, 'submit_result');
        return retry ?? Object.freeze({ outcome: 'rejected', reason: 'command_reuse_conflict' });
      }
      if (await readResult(transaction, validated.matchId, true) !== undefined) {
        return Object.freeze({ outcome: 'rejected', reason: 'result_exists' });
      }
      if (
        context.kind !== 'match' ||
        context.scenario === 'private' ||
        !ACTIVE_MATCH_STATUSES.has(context.status)
      ) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_closed' });
      }
      const endsAt = context.startsAt + context.durationMinutes * 60;
      if (!Number.isSafeInteger(endsAt) || validated.now < endsAt) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_not_finished' });
      }
      const lineupRows = await transaction.query<LineupRow>(SELECT_LINEUP_FOR_UPDATE_SQL, [validated.matchId]);
      if (lineupRows.rowCount === 0 && lineupRows.rows.length === 0) {
        return Object.freeze({ outcome: 'rejected', reason: 'lineup_incomplete' });
      }
      exactOne(lineupRows.rowCount, lineupRows.rows);
      const lineup = lineupRows.rows[0];
      if (lineup.match_id !== validated.matchId || lineup.status !== 'draft') {
        throw invalidState();
      }
      const assignments = await transaction.query<AssignmentRow>(SELECT_ASSIGNMENTS_SQL, [validated.matchId]);
      if (assignments.rowCount !== 4 || assignments.rows.length !== 4) {
        return Object.freeze({ outcome: 'rejected', reason: 'lineup_incomplete' });
      }
      const eligibleRows = await transaction.query<EligibleAccountRow>(
        SELECT_ELIGIBLE_ACCOUNTS_SQL,
        [validated.matchId],
      );
      if (eligibleRows.rowCount !== 4 || eligibleRows.rows.length !== 4) {
        return Object.freeze({ outcome: 'rejected', reason: 'lineup_incomplete' });
      }
      const eligibleAccounts = eligibleRows.rows.map((row) => {
        if (!isAccountId(row.account_id)) throw invalidState();
        return row.account_id;
      });
      if (new Set(eligibleAccounts).size !== 4) throw invalidState();
      const slots = new Map<string, AccountId>();
      for (const assignment of assignments.rows) {
        if (
          !isAccountId(assignment.account_id) ||
          !isMatchResultTeamNumber(assignment.team_number) ||
          !['left', 'right'].includes(String(assignment.court_side))
        ) {
          throw invalidState();
        }
        slots.set(`${assignment.team_number}:${assignment.court_side}`, assignment.account_id);
      }
      const team1Left = slots.get('1:left');
      const team1Right = slots.get('1:right');
      const team2Left = slots.get('2:left');
      const team2Right = slots.get('2:right');
      if (
        team1Left === undefined || team1Right === undefined ||
        team2Left === undefined || team2Right === undefined ||
        new Set([team1Left, team1Right, team2Left, team2Right]).size !== 4
      ) {
        return Object.freeze({ outcome: 'rejected', reason: 'lineup_incomplete' });
      }
      if (
        [team1Left, team1Right, team2Left, team2Right]
          .some((accountId) => !eligibleAccounts.includes(accountId))
      ) {
        return Object.freeze({ outcome: 'rejected', reason: 'lineup_incomplete' });
      }
      if (![team1Left, team1Right, team2Left, team2Right].includes(validated.actorAccountId)) {
        return Object.freeze({ outcome: 'rejected', reason: 'participant_not_active' });
      }
      const locked = await transaction.query(LOCK_LINEUP_SQL, [validated.matchId, validated.now]);
      exactOne(locked.rowCount, locked.rows);
      const lineupVersion = decodePostgresNonNegativeBigint(locked.rows[0]?.version);
      if (lineupVersion < 1) throw invalidState();
      const winner = winningTeam(validated.sets);
      if (winner === undefined) throw new MatchResultPersistenceError('invalid_input');
      const inserted = await transaction.query<ResultRow>(INSERT_RESULT_SQL, [
        validated.resultId,
        validated.matchId,
        lineupVersion,
        team1Left,
        team1Right,
        team2Left,
        team2Right,
        validated.sets[0].team1Games,
        validated.sets[0].team2Games,
        validated.sets[1].team1Games,
        validated.sets[1].team2Games,
        validated.sets[2]?.team1Games ?? null,
        validated.sets[2]?.team2Games ?? null,
        winner,
        validated.actorAccountId,
        validated.now,
      ]);
      exactOne(inserted.rowCount, inserted.rows);
      const result = hydrateResult(inserted.rows[0]);
      await insertCommand(transaction, validated, result, 'submit_result');
      return applied('result_submitted', result, validated.now);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  confirm(
    transaction: PostgresTransaction,
    input: ConfirmMatchResultInput,
  ): Promise<MutateMatchResultResult> {
    return this.resolve(transaction, input, 'confirm_result');
  }

  dispute(
    transaction: PostgresTransaction,
    input: DisputeMatchResultInput,
  ): Promise<MutateMatchResultResult> {
    return this.resolve(transaction, input, 'dispute_result');
  }

  private async resolve(
    transaction: PostgresTransaction,
    input: ConfirmMatchResultInput | DisputeMatchResultInput,
    operation: 'confirm_result' | 'dispute_result',
  ): Promise<MutateMatchResultResult> {
    try {
      const validated = validateMutationInput(input);
      const context = await readContext(transaction, validated, 'update');
      if (context === undefined) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_not_found' });
      }
      const command = await readCommand(transaction, validated.commandId);
      if (command !== undefined) {
        const retry = commandMutation(command, validated, operation);
        return retry ?? Object.freeze({ outcome: 'rejected', reason: 'command_reuse_conflict' });
      }
      const current = await readResult(transaction, validated.matchId, true);
      if (current === undefined) {
        return Object.freeze({ outcome: 'rejected', reason: 'result_not_found' });
      }
      if (current.status !== 'submitted') {
        return Object.freeze({ outcome: 'rejected', reason: 'result_not_pending' });
      }
      const actorTeam = participantTeam(current, validated.actorAccountId);
      if (actorTeam === undefined) {
        return Object.freeze({ outcome: 'rejected', reason: 'participant_not_active' });
      }
      const submitterTeam = participantTeam(current, current.submittedByAccountId);
      if (submitterTeam === undefined) throw invalidState();
      if (operation === 'confirm_result' && actorTeam === submitterTeam) {
        return Object.freeze({ outcome: 'rejected', reason: 'same_team_confirmation' });
      }
      if (
        operation === 'dispute_result' &&
        validated.actorAccountId === current.submittedByAccountId
      ) {
        return Object.freeze({ outcome: 'rejected', reason: 'submitter_cannot_dispute' });
      }
      if (!ACTIVE_MATCH_STATUSES.has(context.status)) {
        return Object.freeze({ outcome: 'rejected', reason: 'match_closed' });
      }
      const updated = await transaction.query<ResultRow>(
        operation === 'confirm_result' ? CONFIRM_RESULT_SQL : DISPUTE_RESULT_SQL,
        [current.resultId, validated.actorAccountId, validated.now],
      );
      exactOne(updated.rowCount, updated.rows);
      const result = hydrateResult(updated.rows[0]);
      if (operation === 'confirm_result') {
        const completed = await transaction.query(COMPLETE_MATCH_SQL, [validated.matchId, validated.now]);
        exactOne(completed.rowCount, completed.rows);
      }
      await insertCommand(transaction, validated, result, operation);
      return applied(
        operation === 'confirm_result' ? 'result_confirmed' : 'result_disputed',
        result,
        validated.now,
      );
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
