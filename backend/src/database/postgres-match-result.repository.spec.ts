import { QueryResult, QueryResultRow } from 'pg';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  MatchResultCommandId,
  MatchResultId,
  MatchResultRequestDigest,
} from '../matches/match-result.types';
import { MatchId } from '../matches/match.types';
import {
  ConfirmMatchResultInput,
  DisputeMatchResultInput,
  SubmitMatchResultInput,
} from './match-result.repository';
import { PostgresMatchResultRepository } from './postgres-match-result.repository';
import { PostgresTransaction } from './postgres-transaction';

const MATCH_ID = deterministicUuid('result-repository-match') as MatchId;
const RESULT_ID = deterministicUuid('result-repository-result') as MatchResultId;
const COMMAND_ID = deterministicUuid('result-repository-command') as MatchResultCommandId;
const TEAM1_LEFT = deterministicUuid('result-repository-team1-left') as AccountId;
const TEAM1_RIGHT = deterministicUuid('result-repository-team1-right') as AccountId;
const TEAM2_LEFT = deterministicUuid('result-repository-team2-left') as AccountId;
const TEAM2_RIGHT = deterministicUuid('result-repository-team2-right') as AccountId;
const DIGEST = 'a'.repeat(64) as MatchResultRequestDigest;
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

function result<Row extends QueryResultRow>(
  rows: readonly Row[],
  command = 'SELECT',
): QueryResult<Row> {
  return { command, rowCount: rows.length, oid: 0, fields: [], rows: [...rows] };
}

function contextRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    id: MATCH_ID,
    owner_account_id: TEAM1_LEFT,
    starts_at: String(Number(NOW) - 7_200),
    duration_minutes: 90,
    kind: 'match',
    visibility: 'public',
    scenario: 'social',
    status: 'upcoming',
    is_rating_match: false,
    updated_at: String(Number(NOW) - 7_200),
    version: '4',
    ...overrides,
  };
}

function assignmentRows(): QueryResultRow[] {
  return [
    { account_id: TEAM1_LEFT, team_number: 1, court_side: 'left' },
    { account_id: TEAM1_RIGHT, team_number: 1, court_side: 'right' },
    { account_id: TEAM2_LEFT, team_number: 2, court_side: 'left' },
    { account_id: TEAM2_RIGHT, team_number: 2, court_side: 'right' },
  ];
}

function resultRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    id: RESULT_ID,
    match_id: MATCH_ID,
    lineup_version: '7',
    team1_left_account_id: TEAM1_LEFT,
    team1_right_account_id: TEAM1_RIGHT,
    team2_left_account_id: TEAM2_LEFT,
    team2_right_account_id: TEAM2_RIGHT,
    team1_set1_games: 6,
    team2_set1_games: 3,
    team1_set2_games: 6,
    team2_set2_games: 4,
    team1_set3_games: null,
    team2_set3_games: null,
    winning_team: 1,
    status: 'submitted',
    submitted_by_account_id: TEAM1_LEFT,
    submitted_at: String(NOW),
    confirmed_by_account_id: null,
    confirmed_at: null,
    disputed_by_account_id: null,
    disputed_at: null,
    version: '1',
    ...overrides,
  };
}

function commandRow(
  operation: 'submit_result' | 'confirm_result' | 'dispute_result',
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  const suffix = operation === 'submit_result'
    ? ['result_submitted', 'submitted', '1']
    : operation === 'confirm_result'
      ? ['result_confirmed', 'confirmed', '2']
      : ['result_disputed', 'disputed', '2'];
  return {
    command_id: COMMAND_ID,
    result_id: RESULT_ID,
    match_id: MATCH_ID,
    actor_account_id: operation === 'submit_result' ? TEAM1_LEFT : TEAM2_LEFT,
    request_digest: Buffer.from(DIGEST, 'hex'),
    command_type: operation,
    result_type: suffix[0],
    applied_at: String(NOW),
    result_status: suffix[1],
    result_version: suffix[2],
    ...overrides,
  };
}

const RATING_BY_ACCOUNT = new Map<AccountId, string>([
  [TEAM1_LEFT, '3.00'],
  [TEAM1_RIGHT, '3.00'],
  [TEAM2_LEFT, '3.00'],
  [TEAM2_RIGHT, '3.00'],
]);

function orderedAccountIds(): AccountId[] {
  return [TEAM1_LEFT, TEAM1_RIGHT, TEAM2_LEFT, TEAM2_RIGHT].sort();
}

function ratingStateRows(
  overrides: Partial<Record<AccountId, Record<string, unknown>>> = {},
): QueryResultRow[] {
  return orderedAccountIds().map((accountId) => ({
    account_id: accountId,
    rating: RATING_BY_ACCOUNT.get(accountId),
    is_verified: true,
    ...(overrides[accountId] ?? {}),
  }));
}

function ratedMatchCountRows(): QueryResultRow[] {
  return orderedAccountIds().map((accountId) => ({
    account_id: accountId,
    rated_matches_before: '0',
  }));
}

function updatedRatingRow(accountId: AccountId): QueryResultRow {
  const isTeam1 = accountId === TEAM1_LEFT || accountId === TEAM1_RIGHT;
  return {
    account_id: accountId,
    rating: isTeam1 ? '3.20' : '2.80',
    updated_at: String(NOW),
  };
}

function submitInput(overrides: Partial<SubmitMatchResultInput> = {}): SubmitMatchResultInput {
  return {
    commandId: COMMAND_ID,
    resultId: RESULT_ID,
    matchId: MATCH_ID,
    actorAccountId: TEAM1_LEFT,
    requestDigest: DIGEST,
    now: NOW,
    sets: [
      { team1Games: 6, team2Games: 3 },
      { team1Games: 6, team2Games: 4 },
    ],
    ...overrides,
  };
}

function resolveInput(
  overrides: Partial<ConfirmMatchResultInput> = {},
): ConfirmMatchResultInput {
  return {
    commandId: COMMAND_ID,
    matchId: MATCH_ID,
    actorAccountId: TEAM2_LEFT,
    requestDigest: DIGEST,
    now: NOW,
    ...overrides,
  };
}

describe('PostgresMatchResultRepository', () => {
  it('returns only a participant-owned persisted result under a shared match lock', async () => {
    const transaction = new FakeTransaction([
      result([contextRow()]),
      result([resultRow()]),
    ]);
    const response = await new PostgresMatchResultRepository().read(transaction, {
      matchId: MATCH_ID,
      actorAccountId: TEAM1_LEFT,
      now: NOW,
    });
    expect(response).toMatchObject({
      outcome: 'found',
      result: {
        resultId: RESULT_ID,
        status: 'submitted',
        winningTeam: 1,
        version: 1,
      },
    });
    expect(transaction.calls[0].text).toContain('FOR SHARE OF matches');
  });

  it('locks match then lineup, snapshots four eligible positions and submits once', async () => {
    const transaction = new FakeTransaction([
      result([contextRow()]),
      result([]),
      result([]),
      result([{ match_id: MATCH_ID, status: 'draft', updated_at: String(NOW), version: '6' }]),
      result(assignmentRows()),
      result(assignmentRows().map(({ account_id }) => ({ account_id }))),
      result([{ version: '7' }], 'UPDATE'),
      result([resultRow()], 'INSERT'),
      result([{ command_id: COMMAND_ID }], 'INSERT'),
    ]);

    await expect(
      new PostgresMatchResultRepository().submit(transaction, submitInput()),
    ).resolves.toEqual({
      outcome: 'result_submitted',
      persistence: 'applied',
      result: {
        resultId: RESULT_ID,
        matchId: MATCH_ID,
        status: 'submitted',
        appliedAt: NOW,
        resultVersion: 1,
      },
    });

    expect(transaction.calls[0].text).toContain('FOR UPDATE OF matches');
    expect(transaction.calls[3].text).toContain('FOR UPDATE');
    expect(transaction.calls[6].text).toContain("status = 'locked'");
    expect(transaction.calls[7].values.slice(3, 7)).toEqual([
      TEAM1_LEFT,
      TEAM1_RIGHT,
      TEAM2_LEFT,
      TEAM2_RIGHT,
    ]);
    expect(transaction.calls[8].values.slice(5, 7)).toEqual([
      'submit_result',
      'result_submitted',
    ]);
  });

  it('rejects submission before the scheduled end without locking the lineup', async () => {
    const transaction = new FakeTransaction([
      result([contextRow({ starts_at: String(Number(NOW) - 60) })]),
      result([]),
      result([]),
    ]);

    await expect(
      new PostgresMatchResultRepository().submit(transaction, submitInput()),
    ).resolves.toEqual({ outcome: 'rejected', reason: 'match_not_finished' });
    expect(transaction.calls).toHaveLength(3);
  });

  it('reconstructs the immutable submit outcome after the result changed', async () => {
    const transaction = new FakeTransaction([
      result([contextRow({ status: 'completed' })]),
      result([commandRow('submit_result')]),
    ]);

    await expect(
      new PostgresMatchResultRepository().submit(transaction, submitInput()),
    ).resolves.toEqual({
      outcome: 'result_submitted',
      persistence: 'idempotent_retry',
      result: {
        resultId: RESULT_ID,
        matchId: MATCH_ID,
        status: 'submitted',
        appliedAt: NOW,
        resultVersion: 1,
      },
    });
    expect(transaction.calls).toHaveLength(2);
  });

  it('requires an opposing team confirmation and completes the match atomically', async () => {
    const sameTeam = new FakeTransaction([
      result([contextRow()]),
      result([]),
      result([resultRow()]),
    ]);
    await expect(
      new PostgresMatchResultRepository().confirm(
        sameTeam,
        resolveInput({ actorAccountId: TEAM1_RIGHT }),
      ),
    ).resolves.toEqual({ outcome: 'rejected', reason: 'same_team_confirmation' });

    const transaction = new FakeTransaction([
      result([contextRow()]),
      result([]),
      result([resultRow()]),
      result([resultRow({
        status: 'confirmed',
        confirmed_by_account_id: TEAM2_LEFT,
        confirmed_at: String(NOW),
        version: '2',
      })], 'UPDATE'),
      result([{ version: '5' }], 'UPDATE'),
      result([{ command_id: COMMAND_ID }], 'INSERT'),
    ]);
    await expect(
      new PostgresMatchResultRepository().confirm(transaction, resolveInput()),
    ).resolves.toEqual({
      outcome: 'result_confirmed',
      persistence: 'applied',
      result: {
        resultId: RESULT_ID,
        matchId: MATCH_ID,
        status: 'confirmed',
        appliedAt: NOW,
        resultVersion: 2,
      },
    });
    expect(transaction.calls[4].text).toContain("status = 'completed'");
    expect(transaction.calls[5].values.slice(5, 7)).toEqual([
      'confirm_result',
      'result_confirmed',
    ]);
    expect(
      transaction.calls.some((call) =>
        call.text.includes('match_rating_applications'),
      ),
    ).toBe(false);
  });

  it('locks four verified states, writes immutable audit and updates ratings before confirmation', async () => {
    const updatedByAccount = new Map(
      orderedAccountIds().map((accountId) => [
        accountId,
        updatedRatingRow(accountId),
      ]),
    );
    const transaction = new FakeTransaction([
      result([contextRow({ is_rating_match: true })]),
      result([]),
      result([resultRow()]),
      result(ratingStateRows()),
      result(ratedMatchCountRows()),
      result([{ result_id: RESULT_ID, match_id: MATCH_ID }], 'INSERT'),
      result([{ result_id: RESULT_ID, account_id: TEAM1_LEFT }], 'INSERT'),
      result([{ result_id: RESULT_ID, account_id: TEAM1_RIGHT }], 'INSERT'),
      result([{ result_id: RESULT_ID, account_id: TEAM2_LEFT }], 'INSERT'),
      result([{ result_id: RESULT_ID, account_id: TEAM2_RIGHT }], 'INSERT'),
      ...orderedAccountIds().map((accountId) =>
        result([updatedByAccount.get(accountId) as QueryResultRow], 'UPDATE'),
      ),
      result([resultRow({
        status: 'confirmed',
        confirmed_by_account_id: TEAM2_LEFT,
        confirmed_at: String(NOW),
        version: '2',
      })], 'UPDATE'),
      result([{ version: '5' }], 'UPDATE'),
      result([{ command_id: COMMAND_ID }], 'INSERT'),
    ]);

    await expect(
      new PostgresMatchResultRepository().confirm(transaction, resolveInput()),
    ).resolves.toEqual({
      outcome: 'result_confirmed',
      persistence: 'applied',
      result: {
        resultId: RESULT_ID,
        matchId: MATCH_ID,
        status: 'confirmed',
        appliedAt: NOW,
        resultVersion: 2,
      },
    });

    expect(transaction.calls[3].text).toContain(
      'FROM backend_auth.player_rating_states',
    );
    expect(transaction.calls[3].text).toContain('ORDER BY account_id');
    expect(transaction.calls[3].text).toContain('FOR UPDATE');
    expect(transaction.calls[4].text).toContain(
      'backend_match.match_rating_changes',
    );
    expect(transaction.calls[5].values).toEqual([
      RESULT_ID,
      MATCH_ID,
      2,
      1,
      '3.000',
      '3.000',
      '0.500000',
      'doubles_elo_v1',
      TEAM2_LEFT,
      NOW,
    ]);
    expect(transaction.calls.slice(6, 10).map((call) => call.values.slice(2, 9))).toEqual([
      [TEAM1_LEFT, 1, 'left', '3.00', '0.20', '3.20', 0],
      [TEAM1_RIGHT, 1, 'right', '3.00', '0.20', '3.20', 0],
      [TEAM2_LEFT, 2, 'left', '3.00', '-0.20', '2.80', 0],
      [TEAM2_RIGHT, 2, 'right', '3.00', '-0.20', '2.80', 0],
    ]);
    expect(transaction.calls.slice(10, 14).map((call) => call.values[0])).toEqual(
      orderedAccountIds(),
    );
    expect(transaction.calls[14].text).toContain(
      'UPDATE backend_match.match_results',
    );
    expect(transaction.calls[15].text).toContain("status = 'completed'");
    expect(transaction.calls[16].values.slice(5, 7)).toEqual([
      'confirm_result',
      'result_confirmed',
    ]);
  });

  it('fails closed on an unverified rating state before writing audit or result state', async () => {
    const transaction = new FakeTransaction([
      result([contextRow({ is_rating_match: true })]),
      result([]),
      result([resultRow()]),
      result(ratingStateRows({
        [TEAM2_RIGHT]: { is_verified: false },
      })),
    ]);

    await expect(
      new PostgresMatchResultRepository().confirm(transaction, resolveInput()),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
    expect(transaction.calls).toHaveLength(4);
  });

  it.each([
    ['missing', ratingStateRows().slice(0, 3)],
    [
      'malformed',
      ratingStateRows({ [TEAM2_RIGHT]: { rating: '3.000' } }),
    ],
  ])(
    'fails closed on a %s rating state before writing audit or result state',
    async (_case, states) => {
      const transaction = new FakeTransaction([
        result([contextRow({ is_rating_match: true })]),
        result([]),
        result([resultRow()]),
        result(states),
      ]);

      await expect(
        new PostgresMatchResultRepository().confirm(
          transaction,
          resolveInput(),
        ),
      ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
      expect(transaction.calls).toHaveLength(4);
    },
  );

  it('returns an immutable rating confirmation retry without applying ratings again', async () => {
    const transaction = new FakeTransaction([
      result([contextRow({ status: 'completed', is_rating_match: true })]),
      result([commandRow('confirm_result')]),
    ]);

    await expect(
      new PostgresMatchResultRepository().confirm(transaction, resolveInput()),
    ).resolves.toEqual({
      outcome: 'result_confirmed',
      persistence: 'idempotent_retry',
      result: {
        resultId: RESULT_ID,
        matchId: MATCH_ID,
        status: 'confirmed',
        appliedAt: NOW,
        resultVersion: 2,
      },
    });
    expect(transaction.calls).toHaveLength(2);
  });

  it('lets a non-submitting participant dispute without completing the match', async () => {
    const transaction = new FakeTransaction([
      result([contextRow()]),
      result([]),
      result([resultRow()]),
      result([resultRow({
        status: 'disputed',
        disputed_by_account_id: TEAM2_LEFT,
        disputed_at: String(NOW),
        version: '2',
      })], 'UPDATE'),
      result([{ command_id: COMMAND_ID }], 'INSERT'),
    ]);
    await expect(
      new PostgresMatchResultRepository().dispute(
        transaction,
        resolveInput() as DisputeMatchResultInput,
      ),
    ).resolves.toMatchObject({
      outcome: 'result_disputed',
      persistence: 'applied',
      result: { status: 'disputed', resultVersion: 2 },
    });
    expect(transaction.calls.some((call) => call.text.includes("status = 'completed'"))).toBe(false);
  });

  it('rejects the submitter attempting to dispute their own score', async () => {
    const transaction = new FakeTransaction([
      result([contextRow()]),
      result([]),
      result([resultRow()]),
    ]);
    await expect(
      new PostgresMatchResultRepository().dispute(
        transaction,
        resolveInput({ actorAccountId: TEAM1_LEFT }),
      ),
    ).resolves.toEqual({ outcome: 'rejected', reason: 'submitter_cannot_dispute' });
    expect(transaction.calls).toHaveLength(3);
  });

  it('fails closed when persisted lifecycle fields contradict the result status', async () => {
    const transaction = new FakeTransaction([
      result([contextRow()]),
      result([resultRow({
        status: 'confirmed',
        confirmed_by_account_id: TEAM1_RIGHT,
        confirmed_at: String(NOW),
        version: '2',
      })]),
    ]);
    await expect(
      new PostgresMatchResultRepository().read(transaction, {
        matchId: MATCH_ID,
        actorAccountId: TEAM1_LEFT,
        now: NOW,
      }),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });

  it('rejects command reuse with a different digest before any result mutation', async () => {
    const transaction = new FakeTransaction([
      result([contextRow()]),
      result([commandRow('confirm_result', { request_digest: Buffer.from('b'.repeat(64), 'hex') })]),
    ]);
    await expect(
      new PostgresMatchResultRepository().confirm(transaction, resolveInput()),
    ).resolves.toEqual({ outcome: 'rejected', reason: 'command_reuse_conflict' });
    expect(transaction.calls).toHaveLength(2);
  });
});
