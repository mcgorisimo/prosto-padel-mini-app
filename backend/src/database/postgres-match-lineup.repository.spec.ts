import { QueryResult, QueryResultRow } from 'pg';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  MatchLineupAssignmentId,
  MatchLineupCommandId,
  MatchLineupRequestDigest,
} from '../matches/match-lineup.types';
import { MatchId } from '../matches/match.types';
import {
  AssignMatchLineupSlotInput,
  ReleaseMatchLineupSlotInput,
} from './match-lineup.repository';
import { PostgresMatchLineupRepository } from './postgres-match-lineup.repository';
import { PostgresTransaction } from './postgres-transaction';

const MATCH_ID = deterministicUuid('lineup-repository-match') as MatchId;
const ACTOR_ID = deterministicUuid('lineup-repository-actor') as AccountId;
const OTHER_ID = deterministicUuid('lineup-repository-other') as AccountId;
const ASSIGNMENT_ID = deterministicUuid('lineup-repository-assignment') as MatchLineupAssignmentId;
const OLD_ASSIGNMENT_ID = deterministicUuid('lineup-repository-old-assignment') as MatchLineupAssignmentId;
const COMMAND_ID = deterministicUuid('lineup-repository-command') as MatchLineupCommandId;
const DIGEST = 'a'.repeat(64) as MatchLineupRequestDigest;
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

function lineupRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    match_id: MATCH_ID,
    lineup_status: 'draft',
    created_at: String(NOW),
    updated_at: String(NOW),
    lineup_version: '1',
    owner_account_id: ACTOR_ID,
    starts_at: String(Number(NOW) + 3_600),
    kind: 'match',
    visibility: 'public',
    scenario: 'social',
    match_status: 'confirmed',
    ...overrides,
  };
}

function assignmentRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    id: ASSIGNMENT_ID,
    match_id: MATCH_ID,
    account_id: ACTOR_ID,
    team_number: 1,
    court_side: 'left',
    status: 'active',
    assigned_at: String(NOW),
    updated_at: String(NOW),
    released_at: null,
    version: '1',
    ...overrides,
  };
}

function assignInput(overrides: Partial<AssignMatchLineupSlotInput> = {}): AssignMatchLineupSlotInput {
  return {
    commandId: COMMAND_ID,
    assignmentId: ASSIGNMENT_ID,
    matchId: MATCH_ID,
    actorAccountId: ACTOR_ID,
    requestDigest: DIGEST,
    now: NOW,
    teamNumber: 1,
    courtSide: 'left',
    ...overrides,
  };
}

function commandRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    command_id: COMMAND_ID,
    match_id: MATCH_ID,
    actor_account_id: ACTOR_ID,
    request_digest: Buffer.from(DIGEST, 'hex'),
    command_type: 'claim_lineup_slot',
    result_type: 'lineup_slot_claimed',
    applied_at: String(NOW),
    lineup_version: '2',
    assignment_id: ASSIGNMENT_ID,
    account_id: ACTOR_ID,
    team_number: 1,
    court_side: 'left',
    ...overrides,
  };
}

function releaseInput(
  overrides: Partial<ReleaseMatchLineupSlotInput> = {},
): ReleaseMatchLineupSlotInput {
  return {
    commandId: COMMAND_ID,
    matchId: MATCH_ID,
    actorAccountId: ACTOR_ID,
    requestDigest: DIGEST,
    now: NOW,
    ...overrides,
  };
}

describe('PostgresMatchLineupRepository', () => {
  it('locks the lineup before reading assignments and claims a free cell idempotently', async () => {
    const transaction = new FakeTransaction([
      result([]),
      result([lineupRow()]),
      result([]),
      result([{ account_id: ACTOR_ID, slot_number: 1 }, { account_id: OTHER_ID, slot_number: 2 }]),
      result([]),
      result([assignmentRow()]),
      result([{ version: '2' }], 'UPDATE'),
      result([{ command_id: COMMAND_ID }], 'INSERT'),
    ]);

    await expect(
      new PostgresMatchLineupRepository().assign(transaction, assignInput()),
    ).resolves.toEqual({
      outcome: 'lineup_slot_claimed',
      persistence: 'applied',
      assignment: {
        assignmentId: ASSIGNMENT_ID,
        matchId: MATCH_ID,
        accountId: ACTOR_ID,
        teamNumber: 1,
        courtSide: 'left',
        appliedAt: NOW,
        lineupVersion: 2,
      },
    });

    expect(transaction.calls[1].text).toContain('FOR UPDATE OF lineups');
    expect(transaction.calls[4].text).toContain("status = 'active'");
    expect(transaction.calls[1].text).toContain("matches.visibility = 'public'");
    expect(transaction.calls[7].values.slice(4, 6)).toEqual([
      'claim_lineup_slot',
      'lineup_slot_claimed',
    ]);
  });

  it('releases the old assignment before inserting a move into a free cell', async () => {
    const old = assignmentRow({
      id: OLD_ASSIGNMENT_ID,
      team_number: 1,
      court_side: 'right',
    });
    const transaction = new FakeTransaction([
      result([]),
      result([lineupRow()]),
      result([]),
      result([{ account_id: ACTOR_ID, slot_number: 1 }]),
      result([old]),
      result([{ ...old, status: 'released', released_at: String(NOW), version: '2' }], 'UPDATE'),
      result([assignmentRow()]),
      result([{ version: '2' }], 'UPDATE'),
      result([{ command_id: COMMAND_ID }], 'INSERT'),
    ]);

    const response = await new PostgresMatchLineupRepository().assign(transaction, assignInput());

    expect(response.outcome).toBe('lineup_slot_moved');
    expect(transaction.calls[5].text).toContain("status = 'released'");
    expect(transaction.calls[6].text).toContain('INSERT INTO backend_match.match_lineup_assignments');
    expect(transaction.calls[8].values.slice(4, 6)).toEqual([
      'move_lineup_slot',
      'lineup_slot_moved',
    ]);
  });

  it('reconstructs the immutable claim result on an idempotent retry without writes', async () => {
    const transaction = new FakeTransaction([
      result([]),
      result([lineupRow()]),
      result([commandRow()]),
    ]);

    await expect(
      new PostgresMatchLineupRepository().assign(transaction, assignInput()),
    ).resolves.toEqual({
      outcome: 'lineup_slot_claimed',
      persistence: 'idempotent_retry',
      assignment: {
        assignmentId: ASSIGNMENT_ID,
        matchId: MATCH_ID,
        accountId: ACTOR_ID,
        teamNumber: 1,
        courtSide: 'left',
        appliedAt: NOW,
        lineupVersion: 2,
      },
    });
    expect(transaction.calls).toHaveLength(3);
  });

  it('rejects an occupied target without updating either assignment', async () => {
    const occupied = assignmentRow({ account_id: OTHER_ID });
    const transaction = new FakeTransaction([
      result([]),
      result([lineupRow()]),
      result([]),
      result([{ account_id: ACTOR_ID, slot_number: 1 }, { account_id: OTHER_ID, slot_number: 2 }]),
      result([occupied]),
    ]);

    await expect(
      new PostgresMatchLineupRepository().assign(transaction, assignInput()),
    ).resolves.toEqual({ outcome: 'rejected', reason: 'slot_occupied' });
    expect(transaction.calls).toHaveLength(5);
  });

  it('reads under a shared lineup lock so assignments come from one stable state', async () => {
    const transaction = new FakeTransaction([
      result([]),
      result([lineupRow()]),
      result([{ account_id: ACTOR_ID, slot_number: 1 }]),
      result([assignmentRow()]),
    ]);

    const response = await new PostgresMatchLineupRepository().read(transaction, {
      matchId: MATCH_ID,
      actorAccountId: ACTOR_ID,
      now: NOW,
    });

    expect(response.outcome).toBe('found');
    expect(transaction.calls[1].text).toContain('FOR SHARE OF lineups');
    expect(transaction.calls[3].text).toContain("status = 'active'");
  });

  it('releases a participant assignment under the existing leave transaction lock order', async () => {
    const current = assignmentRow();
    const transaction = new FakeTransaction([
      result([lineupRow()]),
      result([]),
      result([current]),
      result([{ ...current, status: 'released', released_at: String(NOW), version: '2' }], 'UPDATE'),
      result([{ version: '2' }], 'UPDATE'),
      result([{ command_id: COMMAND_ID }], 'INSERT'),
    ]);

    await expect(
      new PostgresMatchLineupRepository().releaseForParticipantLeave(
        transaction,
        releaseInput(),
      ),
    ).resolves.toBe(true);

    expect(transaction.calls[0].text).toContain('FOR UPDATE OF lineups');
    expect(transaction.calls[3].text).toContain("status = 'released'");
    expect(transaction.calls[5].values.slice(4, 6)).toEqual([
      'release_lineup_slot',
      'lineup_slot_released',
    ]);
  });
});
