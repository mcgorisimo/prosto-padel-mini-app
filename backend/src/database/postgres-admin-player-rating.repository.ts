import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import { isInternalUuid } from '../common/internal-uuid';
import {
  AdminPlayerRatingPersistenceError,
  AdminPlayerRatingPersistenceFailure,
  AdminPlayerRatingRepository,
  AdminPlayerRecord,
  AdminRatingStateCommandRecord,
  AdminRatingStateResultType,
  ListAdminPlayersInput,
  ListAdminPlayersResult,
  SetAdminPlayerRatingStateInput,
  SetAdminPlayerRatingStateResult,
} from './admin-player-rating.repository';
import { classifyPostgresError } from './postgres-error-classifier';
import { PostgresTransaction } from './postgres-transaction';

const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const RATING_PATTERN = /^(?:[0-9]\.[0-9]{2}|10\.00)$/u;
const PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/u;
const SIDE_PREFERENCES = Object.freeze(['Left', 'Both', 'Right'] as const);
const RESULT_TYPES = Object.freeze([
  'rating_updated',
  'verification_updated',
  'rating_and_verification_updated',
  'rating_state_unchanged',
] as const);

const SELECT_ACTOR_FOR_SHARE_SQL = `
  SELECT id, role, status
  FROM backend_auth.accounts
  WHERE id = $1
  FOR SHARE
`;

const LIST_PLAYERS_SQL = `
  SELECT
    accounts.id AS account_id,
    details.first_name,
    details.last_name,
    details.username,
    details.phone,
    details.side_preference,
    rating_states.rating,
    rating_states.is_verified
  FROM backend_auth.accounts AS accounts
  JOIN backend_auth.player_profiles AS profiles
    ON profiles.account_id = accounts.id
  JOIN backend_auth.player_profile_details AS details
    ON details.account_id = profiles.account_id
  JOIN backend_auth.player_rating_states AS rating_states
    ON rating_states.account_id = profiles.account_id
  WHERE accounts.role = 'player'
    AND accounts.status = 'active'
    AND ($1::uuid IS NULL OR accounts.id > $1::uuid)
    AND (
      $2::text IS NULL
      OR details.first_name ILIKE $2::text ESCAPE E'\\\\'
      OR details.last_name ILIKE $2::text ESCAPE E'\\\\'
      OR details.username ILIKE $2::text ESCAPE E'\\\\'
      OR details.phone ILIKE $2::text ESCAPE E'\\\\'
      OR pg_catalog.concat_ws(' ', details.first_name, details.last_name)
        ILIKE $2::text ESCAPE E'\\\\'
    )
    AND ($3::boolean IS NULL OR rating_states.is_verified = $3::boolean)
  ORDER BY accounts.id
  LIMIT $4::integer
`;

const LOCK_ACCOUNTS_SQL = `
  SELECT id, role, status
  FROM backend_auth.accounts
  WHERE id = ANY($1::uuid[])
  ORDER BY id
  FOR UPDATE
`;

const LOCK_TARGET_RATING_STATE_SQL = `
  SELECT rating_states.account_id, rating_states.rating, rating_states.is_verified, rating_states.updated_at
  FROM backend_auth.player_rating_states AS rating_states
  JOIN backend_auth.player_profiles AS profiles
    ON profiles.account_id = rating_states.account_id
  JOIN backend_auth.player_profile_details AS details
    ON details.account_id = profiles.account_id
  WHERE rating_states.account_id = $1
  FOR UPDATE OF rating_states
`;

const SELECT_COMMAND_SQL = `
  SELECT
    command_id,
    actor_account_id,
    target_account_id,
    request_digest,
    result_type,
    rating_before,
    rating_after,
    is_verified_before,
    is_verified_after,
    applied_at
  FROM backend_auth.player_rating_admin_commands
  WHERE command_id = $1
`;

const UPDATE_RATING_STATE_SQL = `
  UPDATE backend_auth.player_rating_states
  SET rating = $2, is_verified = $3, updated_at = GREATEST(updated_at, $4)
  WHERE account_id = $1
    AND rating = $5
    AND is_verified = $6
  RETURNING account_id, rating, is_verified, updated_at
`;

const INSERT_COMMAND_SQL = `
  INSERT INTO backend_auth.player_rating_admin_commands (
    command_id,
    actor_account_id,
    target_account_id,
    request_digest,
    command_type,
    result_type,
    rating_before,
    rating_after,
    is_verified_before,
    is_verified_after,
    applied_at
  )
  VALUES ($1, $2, $3, $4, 'set_player_rating_state', $5, $6, $7, $8, $9, $10)
  RETURNING
    command_id,
    actor_account_id,
    target_account_id,
    request_digest,
    result_type,
    rating_before,
    rating_after,
    is_verified_before,
    is_verified_after,
    applied_at
`;

interface AccountRow extends QueryResultRow {
  readonly id: unknown;
  readonly role: unknown;
  readonly status: unknown;
}

interface PlayerRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly first_name: unknown;
  readonly last_name: unknown;
  readonly username: unknown;
  readonly phone: unknown;
  readonly side_preference: unknown;
  readonly rating: unknown;
  readonly is_verified: unknown;
  readonly updated_at?: unknown;
}

interface CommandRow extends QueryResultRow {
  readonly command_id: unknown;
  readonly actor_account_id: unknown;
  readonly target_account_id: unknown;
  readonly request_digest: unknown;
  readonly result_type: unknown;
  readonly rating_before: unknown;
  readonly rating_after: unknown;
  readonly is_verified_before: unknown;
  readonly is_verified_after: unknown;
  readonly applied_at: unknown;
}

interface UpdatedRatingStateRow extends QueryResultRow {
  readonly account_id: unknown;
  readonly rating: unknown;
  readonly is_verified: unknown;
  readonly updated_at: unknown;
}

function failure(reason: AdminPlayerRatingPersistenceFailure) {
  return new AdminPlayerRatingPersistenceError(reason);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function validRating(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10 &&
    Math.abs(value * 100 - Math.round(value * 100)) <=
      Number.EPSILON * Math.max(1, Math.abs(value * 100)) * 4;
}

function validateListInput(value: unknown): ListAdminPlayersInput {
  if (
    !plainRecord(value) ||
    Object.keys(value).some((key) => ![
      'actorAccountId', 'afterAccountId', 'search', 'verification', 'limit',
    ].includes(key)) ||
    !isAccountId(value.actorAccountId) ||
    (value.afterAccountId !== undefined && !isAccountId(value.afterAccountId)) ||
    (value.search !== undefined && (
      typeof value.search !== 'string' || value.search.trim() !== value.search ||
      value.search.normalize('NFKC') !== value.search || value.search.length === 0 ||
      [...value.search].length > 64 || /[\u0000-\u001f\u007f-\u009f]/u.test(value.search)
    )) ||
    !['all', 'verified', 'unverified'].includes(String(value.verification)) ||
    !Number.isInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 50
  ) {
    throw failure('invalid_input');
  }
  return Object.freeze({ ...value }) as unknown as ListAdminPlayersInput;
}

function validateSetInput(value: unknown): SetAdminPlayerRatingStateInput {
  if (
    !plainRecord(value) || Object.keys(value).length !== 7 ||
    !isInternalUuid(value.commandId) || !isAccountId(value.actorAccountId) ||
    !isAccountId(value.targetAccountId) || value.actorAccountId === value.targetAccountId ||
    typeof value.requestDigest !== 'string' || !DIGEST_PATTERN.test(value.requestDigest) ||
    !validRating(value.rating) || typeof value.isVerified !== 'boolean' ||
    !isUnixEpochSeconds(value.appliedAt)
  ) {
    throw failure('invalid_input');
  }
  return Object.freeze({ ...value }) as unknown as SetAdminPlayerRatingStateInput;
}

function escapeLike(value: string): string {
  return `%${value.replace(/[\\%_]/gu, '\\$&')}%`;
}

function optionalString(value: unknown, max: number): string | undefined {
  if (value === null) return undefined;
  if (typeof value !== 'string' || value.length === 0 || [...value].length > max) {
    throw failure('invalid_persisted_state');
  }
  return value;
}

function rating(value: unknown): number {
  if (typeof value !== 'string' || !RATING_PATTERN.test(value)) {
    throw failure('invalid_persisted_state');
  }
  return Number(value);
}

function hydratePlayer(row: PlayerRow): AdminPlayerRecord {
  if (!isAccountId(row.account_id) || typeof row.first_name !== 'string' ||
      row.first_name.length === 0 || [...row.first_name].length > 256 ||
      typeof row.is_verified !== 'boolean') {
    throw failure('invalid_persisted_state');
  }
  const lastName = optionalString(row.last_name, 256);
  const username = optionalString(row.username, 64);
  const phone = optionalString(row.phone, 16);
  const sidePreference = optionalString(row.side_preference, 5);
  if (phone !== undefined && !PHONE_PATTERN.test(phone)) throw failure('invalid_persisted_state');
  if (sidePreference !== undefined && !SIDE_PREFERENCES.includes(sidePreference as (typeof SIDE_PREFERENCES)[number])) {
    throw failure('invalid_persisted_state');
  }
  return Object.freeze({
    accountId: row.account_id,
    firstName: row.first_name,
    ...(lastName === undefined ? {} : { lastName }),
    ...(username === undefined ? {} : { username }),
    ...(phone === undefined ? {} : { phone }),
    ...(sidePreference === undefined ? {} : { sidePreference: sidePreference as 'Left' | 'Both' | 'Right' }),
    rating: rating(row.rating),
    isVerified: row.is_verified,
  });
}

function digestHex(value: unknown): string {
  if (!Buffer.isBuffer(value) || value.length !== 32) throw failure('invalid_persisted_state');
  return value.toString('hex');
}

function hydrateCommand(row: CommandRow): AdminRatingStateCommandRecord {
  if (
    !isInternalUuid(row.command_id) || !isAccountId(row.actor_account_id) ||
    !isAccountId(row.target_account_id) ||
    typeof row.result_type !== 'string' || !RESULT_TYPES.includes(row.result_type as AdminRatingStateResultType) ||
    typeof row.is_verified_before !== 'boolean' || typeof row.is_verified_after !== 'boolean' ||
    typeof row.applied_at !== 'string' || !/^(?:0|[1-9][0-9]{0,15})$/u.test(row.applied_at)
  ) {
    throw failure('invalid_persisted_state');
  }
  const appliedAt = Number(row.applied_at);
  if (!isUnixEpochSeconds(appliedAt)) throw failure('invalid_persisted_state');
  const command = Object.freeze({
    commandId: row.command_id,
    actorAccountId: row.actor_account_id,
    targetAccountId: row.target_account_id,
    resultType: row.result_type as AdminRatingStateResultType,
    ratingBefore: rating(row.rating_before),
    ratingAfter: rating(row.rating_after),
    isVerifiedBefore: row.is_verified_before,
    isVerifiedAfter: row.is_verified_after,
    appliedAt,
  });
  if (resultType(command.ratingBefore, command.ratingAfter, command.isVerifiedBefore, command.isVerifiedAfter) !== command.resultType) {
    throw failure('invalid_persisted_state');
  }
  return command;
}

function resultType(beforeRating: number, afterRating: number, beforeVerified: boolean, afterVerified: boolean): AdminRatingStateResultType {
  const ratingChanged = beforeRating !== afterRating;
  const verificationChanged = beforeVerified !== afterVerified;
  if (ratingChanged && verificationChanged) return 'rating_and_verification_updated';
  if (ratingChanged) return 'rating_updated';
  if (verificationChanged) return 'verification_updated';
  return 'rating_state_unchanged';
}

function mapped(error: unknown): AdminPlayerRatingPersistenceError {
  if (error instanceof AdminPlayerRatingPersistenceError) return error;
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') return failure('storage_failure');
  switch (classified.category) {
    case 'insufficient_privilege': return failure('permission_denied');
    case 'serialization_failure':
    case 'deadlock_detected': return failure('transaction_conflict');
    case 'connection_exception':
    case 'admin_shutdown':
    case 'query_canceled': return failure('database_unavailable');
    default: return failure('storage_failure');
  }
}

function activeAdmin(rows: readonly AccountRow[], actorAccountId: string): boolean {
  return rows.length === 1 && rows[0].id === actorAccountId &&
    rows[0].role === 'club_admin' && rows[0].status === 'active';
}

export class PostgresAdminPlayerRatingRepository implements AdminPlayerRatingRepository {
  async listPlayers(transaction: PostgresTransaction, input: ListAdminPlayersInput): Promise<ListAdminPlayersResult> {
    try {
      const value = validateListInput(input);
      const actor = await transaction.query<AccountRow>(SELECT_ACTOR_FOR_SHARE_SQL, [value.actorAccountId]);
      if (actor.rowCount !== actor.rows.length) throw failure('invalid_persisted_state');
      if (!activeAdmin(actor.rows, value.actorAccountId)) return Object.freeze({ outcome: 'forbidden' });

      const verification = value.verification === 'all' ? null : value.verification === 'verified';
      const selected = await transaction.query<PlayerRow>(LIST_PLAYERS_SQL, [
        value.afterAccountId ?? null,
        value.search === undefined ? null : escapeLike(value.search),
        verification,
        value.limit + 1,
      ]);
      if (selected.rowCount !== selected.rows.length || selected.rows.length > value.limit + 1) {
        throw failure('invalid_persisted_state');
      }
      const hasMore = selected.rows.length > value.limit;
      const players = selected.rows.slice(0, value.limit).map(hydratePlayer);
      if (new Set(players.map((player) => player.accountId)).size !== players.length) {
        throw failure('invalid_persisted_state');
      }
      return Object.freeze({
        outcome: 'listed',
        players: Object.freeze(players),
        ...(hasMore && players.length > 0
          ? { nextAfterAccountId: players[players.length - 1].accountId }
          : {}),
      });
    } catch (error) {
      throw mapped(error);
    }
  }

  async setRatingState(transaction: PostgresTransaction, input: SetAdminPlayerRatingStateInput): Promise<SetAdminPlayerRatingStateResult> {
    try {
      const value = validateSetInput(input);
      const lockedAccounts = await transaction.query<AccountRow>(LOCK_ACCOUNTS_SQL, [[value.actorAccountId, value.targetAccountId]]);
      if (lockedAccounts.rowCount !== lockedAccounts.rows.length || lockedAccounts.rows.length > 2) {
        throw failure('invalid_persisted_state');
      }
      const actor = lockedAccounts.rows.find((row) => row.id === value.actorAccountId);
      if (!actor || actor.role !== 'club_admin' || actor.status !== 'active') {
        return Object.freeze({ outcome: 'forbidden' });
      }
      const target = lockedAccounts.rows.find((row) => row.id === value.targetAccountId);
      if (!target || target.role !== 'player' || target.status !== 'active') {
        return Object.freeze({ outcome: 'player_not_found' });
      }

      const state = await transaction.query<PlayerRow>(LOCK_TARGET_RATING_STATE_SQL, [value.targetAccountId]);
      if (state.rowCount === 0 && state.rows.length === 0) return Object.freeze({ outcome: 'player_not_found' });
      if (state.rowCount !== 1 || state.rows.length !== 1 || state.rows[0].account_id !== value.targetAccountId ||
          typeof state.rows[0].is_verified !== 'boolean') {
        throw failure('invalid_persisted_state');
      }
      const ratingBefore = rating(state.rows[0].rating);
      const verifiedBefore = state.rows[0].is_verified;
      if (typeof state.rows[0].updated_at !== 'string' || !/^(?:0|[1-9][0-9]{0,15})$/u.test(state.rows[0].updated_at)) {
        throw failure('invalid_persisted_state');
      }
      const previousUpdatedAt = Number(state.rows[0].updated_at);
      if (!isUnixEpochSeconds(previousUpdatedAt)) throw failure('invalid_persisted_state');

      const existing = await transaction.query<CommandRow>(SELECT_COMMAND_SQL, [value.commandId]);
      if (existing.rowCount !== existing.rows.length || existing.rows.length > 1) throw failure('invalid_persisted_state');
      if (existing.rows.length === 1) {
        const command = hydrateCommand(existing.rows[0]);
        const storedDigest = digestHex(existing.rows[0].request_digest);
        if (command.actorAccountId !== value.actorAccountId || command.targetAccountId !== value.targetAccountId || storedDigest !== value.requestDigest) {
          return Object.freeze({ outcome: 'request_conflict' });
        }
        return Object.freeze({ outcome: 'applied', command });
      }

      const type = resultType(ratingBefore, value.rating, verifiedBefore, value.isVerified);
      if (type !== 'rating_state_unchanged') {
        const updated = await transaction.query<UpdatedRatingStateRow>(UPDATE_RATING_STATE_SQL, [
          value.targetAccountId, value.rating.toFixed(2), value.isVerified,
          value.appliedAt, ratingBefore.toFixed(2), verifiedBefore,
        ]);
        if (updated.rowCount !== 1 || updated.rows.length !== 1 ||
            updated.rows[0].account_id !== value.targetAccountId ||
            updated.rows[0].rating !== value.rating.toFixed(2) ||
            updated.rows[0].is_verified !== value.isVerified ||
            updated.rows[0].updated_at !== String(Math.max(previousUpdatedAt, value.appliedAt))) {
          throw failure('invalid_persisted_state');
        }
      }

      const inserted = await transaction.query<CommandRow>(INSERT_COMMAND_SQL, [
        value.commandId, value.actorAccountId, value.targetAccountId,
        Buffer.from(value.requestDigest, 'hex'), type, ratingBefore.toFixed(2),
        value.rating.toFixed(2), verifiedBefore, value.isVerified, value.appliedAt,
      ]);
      if (inserted.rowCount !== 1 || inserted.rows.length !== 1 || digestHex(inserted.rows[0].request_digest) !== value.requestDigest) {
        throw failure('invalid_persisted_state');
      }
      const command = hydrateCommand(inserted.rows[0]);
      if (command.commandId !== value.commandId || command.actorAccountId !== value.actorAccountId ||
          command.targetAccountId !== value.targetAccountId || command.resultType !== type ||
          command.ratingBefore !== ratingBefore || command.ratingAfter !== value.rating ||
          command.isVerifiedBefore !== verifiedBefore || command.isVerifiedAfter !== value.isVerified ||
          command.appliedAt !== value.appliedAt) {
        throw failure('invalid_persisted_state');
      }
      return Object.freeze({ outcome: 'applied', command });
    } catch (error) {
      throw mapped(error);
    }
  }
}
