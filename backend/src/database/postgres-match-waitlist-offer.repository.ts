import { Injectable } from '@nestjs/common';
import { QueryResultRow } from 'pg';
import { isAccountId } from '../accounts/account.types';
import { isUnixEpochSeconds } from '../auth/auth.types';
import {
  MatchWaitlistOfferMutationRecord,
  MatchWaitlistOfferRecord,
  isMatchWaitlistOfferCommandId,
  isMatchWaitlistOfferId,
  isMatchWaitlistOfferRequestDigest,
} from '../matches/match-waitlist-offer.types';
import { isMatchWaitlistEntryId } from '../matches/match-waitlist.types';
import { isMatchId } from '../matches/match.types';
import {
  CreateMatchWaitlistOfferInput,
  CreateMatchWaitlistOfferResult,
  ExpireMatchWaitlistOfferInput,
  ExpireMatchWaitlistOfferResult,
  MatchWaitlistOfferPersistenceError,
  MatchWaitlistOfferPersistenceFailure,
  MatchWaitlistOfferRepository,
  ReadMatchWaitlistOfferActionInput,
  ReadMatchWaitlistOfferActionResult,
  ResolveMatchWaitlistOfferInput,
} from './match-waitlist-offer.repository';
import {
  decodePostgresByteaDigest,
  decodePostgresNonNegativeBigint,
  decodePostgresPositiveInteger,
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

const LOCK_COMMAND_SQL = `
  SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'backend_match:match_waitlist_offer_command:'::text || $1::text,
      0::bigint
    )
  ) AS locked
`;

const LOCK_MATCH_SQL = `
  SELECT id, starts_at, kind, visibility, scenario, status
  FROM backend_match.matches
  WHERE id = $1
  FOR UPDATE
`;

const SELECT_ACTIVE_OFFER_SQL = `
  SELECT id, entry_id, match_id, account_id, slot_number, status,
    offered_at, expires_at, updated_at, resolved_at, version
  FROM backend_match.match_waitlist_offers
  WHERE match_id = $1 AND status = 'active'
  ORDER BY offered_at, id
  FOR UPDATE
`;

const SELECT_CURRENT_OFFER_SQL = `
  SELECT id, entry_id, match_id, account_id, slot_number, status,
    offered_at, expires_at, updated_at, resolved_at, version
  FROM backend_match.match_waitlist_offers
  WHERE match_id = $1
    AND account_id = $2
    AND status = 'active'
    AND expires_at > $3
  ORDER BY offered_at DESC, id
  LIMIT 1
`;

const SELECT_FREE_SLOT_SQL = `
  SELECT candidate.slot_number
  FROM (VALUES (2::smallint), (3::smallint), (4::smallint))
    AS candidate(slot_number)
  WHERE NOT EXISTS (
    SELECT 1
    FROM backend_match.match_participants AS participants
    WHERE participants.match_id = $1
      AND participants.status = 'active'
      AND participants.slot_number = candidate.slot_number
  )
    AND NOT EXISTS (
      SELECT 1
      FROM backend_match.match_invitations AS invitations
      WHERE invitations.match_id = $1
        AND invitations.status = 'pending'
        AND invitations.slot_number = candidate.slot_number
    )
    AND NOT EXISTS (
      SELECT 1
      FROM backend_match.match_waitlist_offers AS offers
      WHERE offers.match_id = $1
        AND offers.status = 'active'
        AND offers.slot_number = candidate.slot_number
    )
  ORDER BY candidate.slot_number
  LIMIT 1
`;

const INSERT_OFFER_SQL = `
  INSERT INTO backend_match.match_waitlist_offers (
    id, entry_id, match_id, account_id, slot_number, status,
    offered_at, expires_at, updated_at, version
  )
  SELECT $1, entries.id, entries.match_id, entries.account_id, $5,
    'active', $6, $7, $6, 1
  FROM backend_match.match_waitlist_entries AS entries
  WHERE entries.id = $2
    AND entries.match_id = $3
    AND entries.account_id = $4
    AND entries.status = 'waiting'
    AND entries.version = 1
    AND NOT EXISTS (
      SELECT 1
      FROM backend_match.match_participants AS participants
      WHERE participants.match_id = entries.match_id
        AND participants.account_id = entries.account_id
        AND participants.status = 'active'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM backend_match.match_invitations AS invitations
      WHERE invitations.match_id = entries.match_id
        AND invitations.invited_account_id = entries.account_id
        AND invitations.status = 'pending'
    )
  RETURNING id, entry_id, match_id, account_id, slot_number, status,
    offered_at, expires_at, updated_at, resolved_at, version
`;

const SELECT_COMMAND_SQL = `
  SELECT command_id, offer_id, match_id, actor_account_id, request_digest,
    command_type, result_type, applied_at, offer_status, offer_version
  FROM backend_match.match_waitlist_offer_commands
  WHERE command_id = $1
`;

const SELECT_OFFER_FOR_ACTION_SQL = `
  SELECT id, entry_id, match_id, account_id, slot_number, status,
    offered_at, expires_at, updated_at, resolved_at, version
  FROM backend_match.match_waitlist_offers
  WHERE id = $1 AND match_id = $2 AND account_id = $3
  FOR UPDATE
`;

const UPDATE_OFFER_SQL = `
  UPDATE backend_match.match_waitlist_offers
  SET status = $5, updated_at = $6, resolved_at = $6, version = 2
  WHERE id = $1 AND entry_id = $2 AND match_id = $3 AND account_id = $4
    AND status = 'active' AND version = 1
  RETURNING id
`;

const RESOLVE_ENTRY_SQL = `
  UPDATE backend_match.match_waitlist_entries
  SET status = $4, updated_at = $5, resolved_at = $5, version = 2
  WHERE id = $1 AND match_id = $2 AND account_id = $3
    AND status = 'waiting' AND version = 1
  RETURNING id
`;

const INSERT_COMMAND_SQL = `
  INSERT INTO backend_match.match_waitlist_offer_commands (
    command_id, offer_id, match_id, actor_account_id, request_digest,
    command_type, result_type, applied_at, offer_status, offer_version
  )
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$7,2)
  RETURNING command_id
`;

const SELECT_DUE_MATCH_IDS_SQL = `
  SELECT DISTINCT offers.match_id
  FROM backend_match.match_waitlist_offers AS offers
  JOIN backend_match.matches AS matches ON matches.id = offers.match_id
  WHERE offers.status = 'active'
    AND (
      offers.expires_at <= $1
      OR matches.starts_at <= $1
      OR matches.kind <> 'match'
      OR matches.visibility <> 'public'
      OR matches.scenario = 'private'
      OR matches.status NOT IN ('open','searching','confirmed','upcoming')
    )
  ORDER BY offers.match_id
  LIMIT $2
`;

interface MatchRow extends QueryResultRow {
  readonly id: unknown;
  readonly starts_at: unknown;
  readonly kind: unknown;
  readonly visibility: unknown;
  readonly scenario: unknown;
  readonly status: unknown;
}

interface SlotRow extends QueryResultRow {
  readonly slot_number: unknown;
}

interface OfferRow extends QueryResultRow {
  readonly id: unknown;
  readonly entry_id: unknown;
  readonly match_id: unknown;
  readonly account_id: unknown;
  readonly slot_number: unknown;
  readonly status: unknown;
  readonly offered_at: unknown;
  readonly expires_at: unknown;
  readonly updated_at: unknown;
  readonly resolved_at: unknown;
  readonly version: unknown;
}

interface CommandRow extends QueryResultRow {
  readonly command_id: unknown;
  readonly offer_id: unknown;
  readonly match_id: unknown;
  readonly actor_account_id: unknown;
  readonly request_digest: unknown;
  readonly command_type: unknown;
  readonly result_type: unknown;
  readonly applied_at: unknown;
  readonly offer_status: unknown;
  readonly offer_version: unknown;
}

function failure(reason: MatchWaitlistOfferPersistenceFailure) {
  return new MatchWaitlistOfferPersistenceError(reason);
}

function invalidInput() {
  return failure('invalid_input');
}

function invalidState() {
  return failure('invalid_persisted_state');
}

function readEpoch(value: unknown) {
  const decoded = decodePostgresNonNegativeBigint(value);
  if (!isUnixEpochSeconds(decoded)) throw invalidState();
  return decoded;
}

function readSmallInteger(value: unknown, allowed: readonly number[]) {
  const decoded = decodePostgresPositiveInteger(value);
  if (!allowed.includes(decoded)) throw invalidState();
  return decoded;
}

function readVersion(value: unknown, allowed: readonly number[]) {
  const decoded = decodePostgresNonNegativeBigint(value);
  if (!allowed.includes(decoded)) throw invalidState();
  return decoded;
}

function hydrateOffer(row: OfferRow): MatchWaitlistOfferRecord {
  if (
    !isMatchWaitlistOfferId(row.id) ||
    !isMatchWaitlistEntryId(row.entry_id) ||
    !isMatchId(row.match_id) ||
    !isAccountId(row.account_id) ||
    !['active', 'accepted', 'declined', 'expired', 'cancelled'].includes(
      String(row.status),
    )
  ) {
    throw invalidState();
  }
  const offeredAt = readEpoch(row.offered_at);
  const expiresAt = readEpoch(row.expires_at);
  const updatedAt = readEpoch(row.updated_at);
  const resolvedAt =
    row.resolved_at === null ? undefined : readEpoch(row.resolved_at);
  const version = readVersion(row.version, [1, 2]);
  if (
    expiresAt <= offeredAt ||
    updatedAt < offeredAt ||
    (row.status === 'active' &&
      (resolvedAt !== undefined || version !== 1)) ||
    (row.status !== 'active' &&
      (resolvedAt === undefined || resolvedAt > updatedAt || version !== 2))
  ) {
    throw invalidState();
  }
  return Object.freeze({
    offerId: row.id,
    entryId: row.entry_id,
    matchId: row.match_id,
    accountId: row.account_id,
    slotNumber: readSmallInteger(row.slot_number, [2, 3, 4]) as 2 | 3 | 4,
    status: row.status as MatchWaitlistOfferRecord['status'],
    offeredAt,
    expiresAt,
    updatedAt,
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    version: version as 1 | 2,
  });
}

function validateCreate(input: CreateMatchWaitlistOfferInput) {
  if (
    !isMatchWaitlistOfferId(input.offerId) ||
    !isMatchWaitlistEntryId(input.entryId) ||
    !isMatchId(input.matchId) ||
    !isAccountId(input.accountId) ||
    !isUnixEpochSeconds(input.now) ||
    !isUnixEpochSeconds(input.expiresAt) ||
    input.expiresAt <= input.now
  ) {
    throw invalidInput();
  }
  return input;
}

function validateAction(input: ReadMatchWaitlistOfferActionInput) {
  if (
    !isMatchWaitlistOfferCommandId(input.commandId) ||
    !isMatchWaitlistOfferId(input.offerId) ||
    !isMatchId(input.matchId) ||
    !isAccountId(input.accountId) ||
    !['accept', 'decline'].includes(input.action) ||
    !isMatchWaitlistOfferRequestDigest(input.requestDigest) ||
    !isUnixEpochSeconds(input.now)
  ) {
    throw invalidInput();
  }
  return input;
}

function readMatch(row: MatchRow, matchId: string) {
  if (
    row.id !== matchId ||
    typeof row.kind !== 'string' ||
    typeof row.visibility !== 'string' ||
    typeof row.scenario !== 'string' ||
    typeof row.status !== 'string'
  ) {
    throw invalidState();
  }
  return Object.freeze({
    startsAt: readEpoch(row.starts_at),
    kind: row.kind,
    visibility: row.visibility,
    scenario: row.scenario,
    status: row.status,
  });
}

function matchAvailable(match: ReturnType<typeof readMatch>, now: number) {
  return (
    match.kind === 'match' &&
    match.visibility === 'public' &&
    match.scenario !== 'private' &&
    ACTIVE_MATCH_STATUSES.has(match.status) &&
    match.startsAt > now
  );
}

function mutationFromCommand(row: CommandRow): MatchWaitlistOfferMutationRecord {
  if (
    !isMatchWaitlistOfferId(row.offer_id) ||
    !isMatchId(row.match_id) ||
    !['accepted', 'declined'].includes(String(row.offer_status)) ||
    row.result_type !== row.offer_status ||
    readVersion(row.offer_version, [2]) !== 2
  ) {
    throw invalidState();
  }
  return Object.freeze({
    offerId: row.offer_id,
    matchId: row.match_id,
    status: row.offer_status as 'accepted' | 'declined',
    appliedAt: readEpoch(row.applied_at),
    version: 2,
  });
}

function commandMatches(
  row: CommandRow,
  input: ReadMatchWaitlistOfferActionInput,
) {
  return (
    row.command_id === input.commandId &&
    row.offer_id === input.offerId &&
    row.match_id === input.matchId &&
    row.actor_account_id === input.accountId &&
    decodePostgresByteaDigest(row.request_digest) === input.requestDigest &&
    row.command_type === input.action &&
    row.result_type === (input.action === 'accept' ? 'accepted' : 'declined')
  );
}

function mapPersistenceError(error: unknown): MatchWaitlistOfferPersistenceError {
  if (error instanceof MatchWaitlistOfferPersistenceError) return error;
  const classified = classifyPostgresError(error);
  if (classified.kind === 'non_postgres_error') return failure('storage_failure');
  const { category, metadata } = classified;
  if (category === 'unique_violation') {
    if (metadata.constraint === 'match_waitlist_offer_commands_pkey') {
      return failure('command_conflict');
    }
    return failure('offer_conflict');
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

async function lockMatch(
  transaction: PostgresTransaction,
  matchId: string,
) {
  const selected = await transaction.query<MatchRow>(LOCK_MATCH_SQL, [matchId]);
  if (selected.rowCount !== selected.rows.length || selected.rows.length > 1) {
    throw invalidState();
  }
  return selected.rows[0];
}

@Injectable()
export class PostgresMatchWaitlistOfferRepository
  implements MatchWaitlistOfferRepository
{
  async create(
    transaction: PostgresTransaction,
    value: CreateMatchWaitlistOfferInput,
  ): Promise<CreateMatchWaitlistOfferResult> {
    try {
      const input = validateCreate(value);
      const matchRow = await lockMatch(transaction, input.matchId);
      if (matchRow === undefined) return Object.freeze({ outcome: 'match_unavailable' });
      if (!matchAvailable(readMatch(matchRow, input.matchId), input.now)) {
        return Object.freeze({ outcome: 'match_unavailable' });
      }
      const active = await transaction.query<OfferRow>(SELECT_ACTIVE_OFFER_SQL, [
        input.matchId,
      ]);
      if (active.rowCount !== active.rows.length || active.rows.length > 1) {
        throw invalidState();
      }
      if (active.rows.length === 1) {
        hydrateOffer(active.rows[0]);
        return Object.freeze({ outcome: 'active_offer_exists' });
      }
      const slot = await transaction.query<SlotRow>(SELECT_FREE_SLOT_SQL, [
        input.matchId,
      ]);
      if (slot.rowCount !== slot.rows.length || slot.rows.length > 1) {
        throw invalidState();
      }
      if (slot.rows.length === 0) return Object.freeze({ outcome: 'slot_unavailable' });
      const slotNumber = readSmallInteger(slot.rows[0].slot_number, [2, 3, 4]);
      const inserted = await transaction.query<OfferRow>(INSERT_OFFER_SQL, [
        input.offerId,
        input.entryId,
        input.matchId,
        input.accountId,
        slotNumber,
        input.now,
        input.expiresAt,
      ]);
      if (inserted.rowCount !== inserted.rows.length || inserted.rows.length > 1) {
        throw invalidState();
      }
      if (inserted.rows.length === 0) {
        return Object.freeze({ outcome: 'candidate_unavailable' });
      }
      return Object.freeze({
        outcome: 'created',
        offer: hydrateOffer(inserted.rows[0]),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async readCurrentForAccount(
    transaction: PostgresTransaction,
    input: {
      readonly matchId: import('../matches/match.types').MatchId;
      readonly accountId: import('../accounts/account.types').AccountId;
      readonly now: import('../auth/auth.types').UnixEpochSeconds;
    },
  ): Promise<MatchWaitlistOfferRecord | undefined> {
    try {
      if (
        !isMatchId(input.matchId) ||
        !isAccountId(input.accountId) ||
        !isUnixEpochSeconds(input.now)
      ) {
        throw invalidInput();
      }
      const selected = await transaction.query<OfferRow>(SELECT_CURRENT_OFFER_SQL, [
        input.matchId,
        input.accountId,
        input.now,
      ]);
      if (selected.rowCount !== selected.rows.length || selected.rows.length > 1) {
        throw invalidState();
      }
      return selected.rows[0] === undefined
        ? undefined
        : hydrateOffer(selected.rows[0]);
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async readAction(
    transaction: PostgresTransaction,
    value: ReadMatchWaitlistOfferActionInput,
  ): Promise<ReadMatchWaitlistOfferActionResult> {
    try {
      const input = validateAction(value);
      const locked = await transaction.query(LOCK_COMMAND_SQL, [input.commandId]);
      if (locked.rowCount !== 1 || locked.rows.length !== 1) throw invalidState();
      const command = await transaction.query<CommandRow>(SELECT_COMMAND_SQL, [
        input.commandId,
      ]);
      if (command.rowCount !== command.rows.length || command.rows.length > 1) {
        throw invalidState();
      }
      if (command.rows[0] !== undefined) {
        return commandMatches(command.rows[0], input)
          ? Object.freeze({
              outcome: 'idempotent_retry',
              mutation: mutationFromCommand(command.rows[0]),
            })
          : Object.freeze({ outcome: 'command_reuse_conflict' });
      }
      const matchRow = await lockMatch(transaction, input.matchId);
      if (matchRow === undefined) return Object.freeze({ outcome: 'match_unavailable' });
      const match = readMatch(matchRow, input.matchId);
      if (!matchAvailable(match, input.now)) {
        return Object.freeze({ outcome: 'match_unavailable' });
      }
      const selected = await transaction.query<OfferRow>(
        SELECT_OFFER_FOR_ACTION_SQL,
        [input.offerId, input.matchId, input.accountId],
      );
      if (selected.rowCount !== selected.rows.length || selected.rows.length > 1) {
        throw invalidState();
      }
      if (selected.rows[0] === undefined) {
        return Object.freeze({ outcome: 'offer_not_found' });
      }
      const offer = hydrateOffer(selected.rows[0]);
      if (offer.status !== 'active') {
        return Object.freeze({ outcome: 'offer_resolved' });
      }
      if (offer.expiresAt <= input.now) {
        return Object.freeze({ outcome: 'offer_expired' });
      }
      return Object.freeze({
        outcome: 'ready',
        offer: Object.freeze({ ...offer, status: 'active' as const }),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async resolve(
    transaction: PostgresTransaction,
    value: ResolveMatchWaitlistOfferInput,
  ): Promise<MatchWaitlistOfferMutationRecord> {
    try {
      const input = validateAction(value);
      const expectedStatus = input.action === 'accept' ? 'accepted' : 'declined';
      if (
        value.status !== expectedStatus ||
        !isMatchWaitlistEntryId(value.entryId)
      ) {
        throw invalidInput();
      }
      const offer = await transaction.query(UPDATE_OFFER_SQL, [
        input.offerId,
        value.entryId,
        input.matchId,
        input.accountId,
        value.status,
        input.now,
      ]);
      if (offer.rowCount !== 1 || offer.rows.length !== 1) throw invalidState();
      const entryStatus = value.status === 'accepted' ? 'promoted' : 'skipped';
      const entry = await transaction.query(RESOLVE_ENTRY_SQL, [
        value.entryId,
        input.matchId,
        input.accountId,
        entryStatus,
        input.now,
      ]);
      if (entry.rowCount !== 1 || entry.rows.length !== 1) throw invalidState();
      const inserted = await transaction.query(INSERT_COMMAND_SQL, [
        input.commandId,
        input.offerId,
        input.matchId,
        input.accountId,
        encodePostgresByteaDigest(input.requestDigest),
        input.action,
        value.status,
        input.now,
      ]);
      if (inserted.rowCount !== 1 || inserted.rows.length !== 1) throw invalidState();
      return Object.freeze({
        offerId: input.offerId,
        matchId: input.matchId,
        status: value.status,
        appliedAt: input.now,
        version: 2,
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async listDueMatchIds(
    transaction: PostgresTransaction,
    input: { readonly now: import('../auth/auth.types').UnixEpochSeconds; readonly limit: number },
  ): Promise<readonly import('../matches/match.types').MatchId[]> {
    try {
      if (
        !isUnixEpochSeconds(input.now) ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100
      ) {
        throw invalidInput();
      }
      const selected = await transaction.query<QueryResultRow & { match_id: unknown }>(
        SELECT_DUE_MATCH_IDS_SQL,
        [input.now, input.limit],
      );
      if (
        selected.rowCount !== selected.rows.length ||
        selected.rows.length > input.limit ||
        selected.rows.some((row) => !isMatchId(row.match_id))
      ) {
        throw invalidState();
      }
      return Object.freeze(selected.rows.map((row) => row.match_id as import('../matches/match.types').MatchId));
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }

  async expireForMatch(
    transaction: PostgresTransaction,
    value: ExpireMatchWaitlistOfferInput,
  ): Promise<ExpireMatchWaitlistOfferResult> {
    try {
      if (!isMatchId(value.matchId) || !isUnixEpochSeconds(value.now)) {
        throw invalidInput();
      }
      const matchRow = await lockMatch(transaction, value.matchId);
      if (matchRow === undefined) return Object.freeze({ outcome: 'none' });
      const match = readMatch(matchRow, value.matchId);
      const selected = await transaction.query<OfferRow>(SELECT_ACTIVE_OFFER_SQL, [
        value.matchId,
      ]);
      if (selected.rowCount !== selected.rows.length || selected.rows.length > 1) {
        throw invalidState();
      }
      if (selected.rows[0] === undefined) return Object.freeze({ outcome: 'none' });
      const offer = hydrateOffer(selected.rows[0]);
      const cancelled = !matchAvailable(match, value.now);
      if (!cancelled && offer.expiresAt > value.now) {
        return Object.freeze({ outcome: 'none' });
      }
      const status = cancelled ? 'cancelled' : 'expired';
      const updated = await transaction.query(UPDATE_OFFER_SQL, [
        offer.offerId,
        offer.entryId,
        offer.matchId,
        offer.accountId,
        status,
        value.now,
      ]);
      if (updated.rowCount !== 1 || updated.rows.length !== 1) throw invalidState();
      const entry = await transaction.query(RESOLVE_ENTRY_SQL, [
        offer.entryId,
        offer.matchId,
        offer.accountId,
        'skipped',
        value.now,
      ]);
      if (entry.rowCount !== 1 || entry.rows.length !== 1) throw invalidState();
      return Object.freeze({
        outcome: status,
        offer: Object.freeze({
          ...offer,
          status,
          updatedAt: value.now,
          resolvedAt: value.now,
          version: 2,
        }),
      });
    } catch (error) {
      throw mapPersistenceError(error);
    }
  }
}
