import { QueryResult, QueryResultRow } from 'pg';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  MatchWaitlistCommandId,
  MatchWaitlistEntryId,
  MatchWaitlistRequestDigest,
} from '../matches/match-waitlist.types';
import { MatchId } from '../matches/match.types';
import { JoinMatchWaitlistInput } from './match-waitlist.repository';
import { PostgresMatchWaitlistRepository } from './postgres-match-waitlist.repository';
import { PostgresTransaction } from './postgres-transaction';

const MATCH_ID = deterministicUuid('waitlist-repository-match') as MatchId;
const OWNER_ID = deterministicUuid('waitlist-repository-owner') as AccountId;
const ACTOR_ID = deterministicUuid('waitlist-repository-actor') as AccountId;
const ENTRY_ID = deterministicUuid('waitlist-repository-entry') as MatchWaitlistEntryId;
const COMMAND_ID = deterministicUuid('waitlist-repository-command') as MatchWaitlistCommandId;
const DIGEST = 'a'.repeat(64) as MatchWaitlistRequestDigest;
const NOW = unixEpochSeconds(1_800_000_000);

class FakeTransaction implements PostgresTransaction {
  readonly calls: { readonly text: string; readonly values: readonly unknown[] }[] = [];
  constructor(private readonly queued: readonly (QueryResult<QueryResultRow> | Error)[]) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.queued[this.calls.length - 1];
    if (response === undefined) throw new Error('Unexpected query');
    if (response instanceof Error) throw response;
    return response as QueryResult<Row>;
  }
}

function result<Row extends QueryResultRow>(rows: readonly Row[], command = 'SELECT'): QueryResult<Row> {
  return { command, rowCount: rows.length, oid: 0, fields: [], rows: [...rows] };
}

function matchRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    id: MATCH_ID,
    owner_account_id: OWNER_ID,
    starts_at: String(Number(NOW) + 3_600),
    kind: 'match',
    visibility: 'public',
    scenario: 'social',
    status: 'confirmed',
    rating_min: 2,
    rating_max: 4,
    is_rating_match: true,
    ...overrides,
  };
}

function entryRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    id: ENTRY_ID,
    match_id: MATCH_ID,
    account_id: ACTOR_ID,
    status: 'waiting',
    joined_at: String(NOW),
    updated_at: String(NOW),
    resolved_at: null,
    version: '1',
    ...overrides,
  };
}

function commandRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    command_id: COMMAND_ID,
    entry_id: ENTRY_ID,
    match_id: MATCH_ID,
    actor_account_id: ACTOR_ID,
    request_digest: Buffer.from(DIGEST, 'hex'),
    command_type: 'join_waitlist',
    result_type: 'waitlist_joined',
    applied_at: String(NOW),
    entry_status: 'waiting',
    entry_version: '1',
    ...overrides,
  };
}

function joinInput(overrides: Partial<JoinMatchWaitlistInput> = {}): JoinMatchWaitlistInput {
  return {
    commandId: COMMAND_ID,
    entryId: ENTRY_ID,
    matchId: MATCH_ID,
    actorAccountId: ACTOR_ID,
    requestDigest: DIGEST,
    now: NOW,
    ...overrides,
  };
}

describe('PostgresMatchWaitlistRepository', () => {
  it('joins only a full public future match and writes the immutable command result', async () => {
    const transaction = new FakeTransaction([
      result([matchRow()]),
      result([]),
      result([
        { account_id: deterministicUuid('participant-a'), slot_number: 2 },
        { account_id: deterministicUuid('participant-b'), slot_number: 3 },
        { account_id: deterministicUuid('participant-c'), slot_number: 4 },
      ]),
      result([]),
      result([]),
      result([{
        id: ACTOR_ID,
        status: 'active',
        role: 'player',
        profile_account_id: ACTOR_ID,
        rating: '3.00',
        is_verified: true,
      }]),
      result([entryRow()], 'INSERT'),
      result([{ command_id: COMMAND_ID }], 'INSERT'),
    ]);

    await expect(new PostgresMatchWaitlistRepository().join(transaction, joinInput())).resolves.toEqual({
      outcome: 'waitlist_joined',
      persistence: 'applied',
      entry: {
        entryId: ENTRY_ID,
        matchId: MATCH_ID,
        status: 'waiting',
        appliedAt: NOW,
        version: 1,
      },
    });
    expect(transaction.calls).toHaveLength(8);
    expect(transaction.calls[0].text).toContain('FOR UPDATE');
    expect(transaction.calls[7].values).toEqual([
      COMMAND_ID,
      ENTRY_ID,
      MATCH_ID,
      ACTOR_ID,
      Buffer.from(DIGEST, 'hex'),
      'join_waitlist',
      'waitlist_joined',
      NOW,
      'waiting',
      1,
    ]);
  });

  it('reconstructs an idempotent join from immutable command data before current eligibility', async () => {
    const transaction = new FakeTransaction([result([matchRow({ status: 'completed' })]), result([commandRow()])]);
    await expect(new PostgresMatchWaitlistRepository().join(transaction, joinInput())).resolves.toEqual({
      outcome: 'waitlist_joined',
      persistence: 'idempotent_retry',
      entry: {
        entryId: ENTRY_ID,
        matchId: MATCH_ID,
        status: 'waiting',
        appliedAt: NOW,
        version: 1,
      },
    });
  });

  it('requires capacity to be fully reserved before joining the queue', async () => {
    const transaction = new FakeTransaction([
      result([matchRow()]),
      result([]),
      result([{ account_id: deterministicUuid('participant-a'), slot_number: 2 }]),
      result([{ invited_account_id: deterministicUuid('invited-a'), slot_number: 3 }]),
    ]);
    await expect(new PostgresMatchWaitlistRepository().join(transaction, joinInput())).resolves.toEqual({
      outcome: 'rejected',
      reason: 'match_not_full',
    });
  });

  it('returns a FIFO page plus the current player position beyond that page', async () => {
    const otherId = deterministicUuid('waitlist-repository-other') as AccountId;
    const otherEntry = deterministicUuid('waitlist-repository-other-entry') as MatchWaitlistEntryId;
    const transaction = new FakeTransaction([
      result([
        {
          authorized_match_id: MATCH_ID,
          ...entryRow({ id: otherEntry, account_id: otherId }),
          queue_position: '1',
          queue_count: '3',
        },
        {
          authorized_match_id: MATCH_ID,
          ...entryRow(),
          queue_position: '3',
          queue_count: '3',
        },
      ]),
    ]);
    await expect(new PostgresMatchWaitlistRepository().list(transaction, {
      matchId: MATCH_ID,
      actorAccountId: ACTOR_ID,
      limit: 1,
    })).resolves.toEqual({
      outcome: 'found',
      entries: [expect.objectContaining({ entryId: otherEntry, queuePosition: 1 })],
      current: expect.objectContaining({ entryId: ENTRY_ID, queuePosition: 3 }),
      count: 3,
    });
    expect(transaction.calls[0].text).toContain('row_number()');
    expect(transaction.calls[0].text).toContain('ORDER BY entries.joined_at, entries.id');
  });

  it('leaves the current waiting entry and persists a stable retry result', async () => {
    const leaveCommand = deterministicUuid('waitlist-repository-leave-command') as MatchWaitlistCommandId;
    const transaction = new FakeTransaction([
      result([matchRow()]),
      result([]),
      result([entryRow()]),
      result([entryRow({ status: 'left', updated_at: String(NOW), resolved_at: String(NOW), version: '2' })], 'UPDATE'),
      result([{ command_id: leaveCommand }], 'INSERT'),
    ]);
    await expect(new PostgresMatchWaitlistRepository().leave(transaction, {
      commandId: leaveCommand,
      matchId: MATCH_ID,
      actorAccountId: ACTOR_ID,
      requestDigest: DIGEST,
      now: NOW,
    })).resolves.toEqual({
      outcome: 'waitlist_left',
      persistence: 'applied',
      entry: { entryId: ENTRY_ID, matchId: MATCH_ID, status: 'left', appliedAt: NOW, version: 2 },
    });
  });

  it('keeps the waiting entry intact when an active offer owns the leave action', async () => {
    const leaveCommand = deterministicUuid('waitlist-repository-offered-leave-command') as MatchWaitlistCommandId;
    const transaction = new FakeTransaction([
      result([matchRow()]),
      result([]),
      result([{ id: deterministicUuid('waitlist-repository-active-offer') }]),
    ]);

    await expect(new PostgresMatchWaitlistRepository(true).leave(transaction, {
      commandId: leaveCommand,
      matchId: MATCH_ID,
      actorAccountId: ACTOR_ID,
      requestDigest: DIGEST,
      now: NOW,
    })).resolves.toEqual({ outcome: 'rejected', reason: 'not_waiting' });

    expect(transaction.calls[0].text).toContain('FOR UPDATE');
    expect(transaction.calls[2].text).toContain('match_waitlist_offers');
    expect(transaction.calls).toHaveLength(3);
  });

  it('locks and returns the oldest FIFO promotion candidate with trusted account availability', async () => {
    const transaction = new FakeTransaction([
      result([matchRow()]),
      result([]),
      result([]),
      result([], 'UPDATE'),
      result([{ ...entryRow(), queue_position: '1', player_is_active: true }]),
    ]);
    await expect(new PostgresMatchWaitlistRepository().readPromotionCandidate(transaction, {
      matchId: MATCH_ID,
      now: NOW,
    })).resolves.toEqual({
      outcome: 'candidate',
      entry: expect.objectContaining({ entryId: ENTRY_ID, queuePosition: 1 }),
      playerIsActive: true,
    });
    expect(transaction.calls[1].text).toContain('match_participants');
    expect(transaction.calls[2].text).toContain('match_invitations');
    expect(transaction.calls[3].text).toContain('UPDATE backend_match.match_waitlist_entries');
    expect(transaction.calls[3].text).toContain('backend_auth.player_rating_states');
    expect(transaction.calls[3].text).toContain('WHEN ratings.rating < 4.0 THEN 3');
    expect(transaction.calls[3].text).toContain('WHEN ratings.rating < 4.7 THEN 4');
    expect(transaction.calls[3].text).toContain('WHEN ratings.rating < 5.5 THEN 5');
    expect(transaction.calls[3].text).not.toContain('ratings.rating >= matches.rating_min');
    expect(transaction.calls[3].text).not.toContain('ratings.rating <= matches.rating_max');
    expect(transaction.calls[3].text).toContain("participants.status = 'active'");
    expect(transaction.calls[3].text).toContain("invitations.status = 'pending'");
    expect(transaction.calls[3].values).toEqual([MATCH_ID, NOW]);
    expect(transaction.calls[4].text).toContain('ORDER BY entries.joined_at, entries.id');
    expect(transaction.calls[4].text).toContain('FOR UPDATE OF entries');
  });

  it('atomically closes a waiting entry when the player joins through another backend path', async () => {
    const transaction = new FakeTransaction([
      result([matchRow()]),
      result([{ id: ENTRY_ID }], 'UPDATE'),
    ]);
    await expect(new PostgresMatchWaitlistRepository().resolveWaitingAccount(transaction, {
      matchId: MATCH_ID,
      accountId: ACTOR_ID,
      now: NOW,
    })).resolves.toBe(true);
    expect(transaction.calls[0].text).toContain('FOR UPDATE');
    expect(transaction.calls[1].text).toContain("status = 'promoted'");
    expect(transaction.calls[1].values).toEqual([MATCH_ID, ACTOR_ID, NOW]);
  });
});
