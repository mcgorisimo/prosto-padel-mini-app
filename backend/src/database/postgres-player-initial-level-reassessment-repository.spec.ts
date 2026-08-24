import { inspect } from 'node:util';
import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { unixEpochSeconds } from '../auth/auth.types';
import {
  CompletePlayerInitialLevelReassessmentInput,
  PlayerInitialLevelReassessmentPersistenceError,
  PlayerInitialLevelReassessmentPersistenceFailure,
} from './player-initial-level-reassessment-repository';
import { PostgresPlayerInitialLevelReassessmentRepository } from './postgres-player-initial-level-reassessment-repository';
import { PostgresTransaction } from './postgres-transaction';

const ACCOUNT_ID = deterministicUuid(
  'postgres-player-initial-level-reassessment',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'postgres-player-initial-level-reassessment-other',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_REASSESSMENT_REPOSITORY_PRIVATE';
const ANSWERS = Object.freeze({
  match_count: 'thirty_one_to_ninety_nine',
  rally_stability: 'steady_under_pressure',
  glass_play: 'confident_returns',
  serve_return_net: 'confident_patterns',
  match_experience_year: 'league_or_club',
});

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

type QueuedQuery =
  QueryResult<QueryResultRow> | Error | Record<string, unknown>;

class FakeTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];

  constructor(private readonly queued: QueuedQuery[]) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    const next = this.queued.shift();
    if (next === undefined) throw new Error('Unexpected query');
    if (next instanceof Error || !('rows' in next)) throw next;
    return next as unknown as QueryResult<Row>;
  }
}

function queryResult<Row extends QueryResultRow>(
  rows: readonly Row[],
  rowCount: number | null = rows.length,
): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    account_id: ACCOUNT_ID,
    flow_version: 'tma_v1',
    status: 'completed',
    current_step: 'completed',
    survey_version: 'initial_level_v1',
    revision: '4',
    completed_at: '1799999900',
    ...overrides,
  };
}

function readRow(overrides: Record<string, unknown> = {}) {
  return {
    ...sourceRow(),
    source_completed_at: '1799999900',
    reassessment_account_id: null,
    source_flow_version: null,
    source_survey_version: null,
    source_revision: null,
    reassessment_survey_version: null,
    survey_answers: null,
    initial_level_score: null,
    initial_level_label: null,
    ...overrides,
  };
}

function reassessmentRow(overrides: Record<string, unknown> = {}) {
  return {
    account_id: ACCOUNT_ID,
    source_flow_version: 'tma_v1',
    source_survey_version: 'initial_level_v1',
    source_revision: '4',
    survey_version: 'initial_level_v2',
    survey_answers: ANSWERS,
    initial_level_score: 15,
    initial_level_label: 'B+',
    ...overrides,
  };
}

function completedReadRow(overrides: Record<string, unknown> = {}) {
  return readRow({
    reassessment_account_id: ACCOUNT_ID,
    source_flow_version: 'tma_v1',
    source_survey_version: 'initial_level_v1',
    source_revision: '4',
    reassessment_survey_version: 'initial_level_v2',
    survey_answers: ANSWERS,
    initial_level_score: 15,
    initial_level_label: 'B+',
    ...overrides,
  });
}

function validInput(
  overrides: Partial<CompletePlayerInitialLevelReassessmentInput> = {},
): CompletePlayerInitialLevelReassessmentInput {
  return {
    accountId: ACCOUNT_ID,
    source: {
      flowVersion: 'tma_v1',
      surveyVersion: 'initial_level_v1',
      revision: 4,
    },
    surveyVersion: 'initial_level_v2',
    surveyAnswers: ANSWERS,
    completedAt: NOW,
    ...overrides,
  };
}

function postgresError(code: string): Record<string, unknown> {
  return {
    code,
    message: `${PRIVATE_MARKER}:${ACCOUNT_ID}`,
    detail: `${PRIVATE_MARKER}:private@example.test`,
    constraint: 'private_constraint',
  };
}

function expectSafeError(
  value: unknown,
  reason: PlayerInitialLevelReassessmentPersistenceFailure,
): PlayerInitialLevelReassessmentPersistenceError {
  expect(value).toBeInstanceOf(PlayerInitialLevelReassessmentPersistenceError);
  const error = value as PlayerInitialLevelReassessmentPersistenceError;
  expect(error.reason).toBe(reason);
  expect(error.message).toBe(
    'Player initial level reassessment persistence failed',
  );
  expect('cause' in error).toBe(false);
  const serialized = inspect({
    own: Object.getOwnPropertyNames(error).map((key) => [
      key,
      (error as unknown as Record<string, unknown>)[key],
    ]),
    json: JSON.stringify(error),
  });
  for (const forbidden of [
    PRIVATE_MARKER,
    ACCOUNT_ID,
    'private@example.test',
    'private_constraint',
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  return error;
}

describe('PostgresPlayerInitialLevelReassessmentRepository', () => {
  const repository = new PostgresPlayerInitialLevelReassessmentRepository();

  it('reads required only for a completed initial_level_v1 source', async () => {
    const transaction = new FakeTransaction([queryResult([readRow()])]);
    await expect(
      repository.read(transaction, { accountId: ACCOUNT_ID }),
    ).resolves.toEqual({
      status: 'required',
      source: {
        flowVersion: 'tma_v1',
        surveyVersion: 'initial_level_v1',
        revision: 4,
      },
      surveyVersion: 'initial_level_v2',
    });
    expect(normalizeSql(transaction.calls[0].text)).toContain(
      'LEFT JOIN backend_auth.player_initial_level_reassessments',
    );
    expect(transaction.calls[0].values).toEqual([ACCOUNT_ID]);
  });

  it.each([
    { rows: [] as QueryResultRow[] },
    {
      rows: [
        readRow({ status: 'in_progress', current_step: 'level_survey' }),
      ] as QueryResultRow[],
    },
    {
      rows: [
        readRow({ survey_version: 'initial_level_v2' }),
      ] as QueryResultRow[],
    },
  ])(
    'reads not_eligible for a missing or non-v1-completed source',
    async ({ rows }) => {
      const transaction = new FakeTransaction([queryResult(rows)]);
      await expect(
        repository.read(transaction, { accountId: ACCOUNT_ID }),
      ).resolves.toEqual({ status: 'not_eligible' });
    },
  );

  it('reads completed evidence but keeps scoring internals inside persistence', async () => {
    const transaction = new FakeTransaction([
      queryResult([completedReadRow()]),
    ]);
    await expect(
      repository.read(transaction, { accountId: ACCOUNT_ID }),
    ).resolves.toMatchObject({
      status: 'completed',
      surveyVersion: 'initial_level_v2',
      initialLevelScore: 15,
      initialLevelLabel: 'B+',
    });
  });

  it('locks the source and inserts one immutable v2 evidence row', async () => {
    const transaction = new FakeTransaction([
      queryResult([sourceRow()]),
      queryResult([]),
      queryResult([reassessmentRow()]),
    ]);
    await expect(
      repository.complete(transaction, validInput()),
    ).resolves.toEqual({
      outcome: 'completed',
      replayed: false,
      initialLevelScore: 15,
      initialLevelLabel: 'B+',
    });
    expect(transaction.calls).toHaveLength(3);
    expect(normalizeSql(transaction.calls[0].text)).toContain('FOR UPDATE');
    expect(normalizeSql(transaction.calls[1].text)).toContain(
      'FROM backend_auth.player_initial_level_reassessments',
    );
    expect(normalizeSql(transaction.calls[2].text)).toContain(
      'ON CONFLICT (account_id) DO NOTHING',
    );
    expect(normalizeSql(transaction.calls[2].text)).not.toMatch(
      /UPDATE|DELETE/u,
    );
    expect(transaction.calls[2].values).toEqual([
      ACCOUNT_ID,
      'tma_v1',
      'initial_level_v1',
      4,
      'initial_level_v2',
      ANSWERS,
      15,
      'B+',
      NOW,
    ]);
  });

  it('returns an exact idempotent replay without another insert', async () => {
    const transaction = new FakeTransaction([
      queryResult([sourceRow()]),
      queryResult([reassessmentRow()]),
    ]);
    await expect(
      repository.complete(transaction, validInput()),
    ).resolves.toEqual({
      outcome: 'completed',
      replayed: true,
      initialLevelScore: 15,
      initialLevelLabel: 'B+',
    });
    expect(transaction.calls).toHaveLength(2);
  });

  it('rejects a different completed request and never mutates evidence', async () => {
    const transaction = new FakeTransaction([
      queryResult([sourceRow()]),
      queryResult([
        reassessmentRow({
          survey_answers: { ...ANSWERS, match_experience_year: 'tournament' },
          initial_level_score: 16,
          initial_level_label: 'B+',
        }),
      ]),
    ]);
    await expect(
      repository.complete(transaction, validInput()),
    ).resolves.toEqual({
      outcome: 'conflict',
    });
    expect(transaction.calls).toHaveLength(2);
  });

  it('detects a stale source revision before reading or inserting evidence', async () => {
    const transaction = new FakeTransaction([
      queryResult([sourceRow({ revision: '5' })]),
    ]);
    await expect(
      repository.complete(transaction, validInput()),
    ).resolves.toEqual({
      outcome: 'stale_source',
    });
    expect(transaction.calls).toHaveLength(1);
  });

  it('does not complete for another owner or a non-v1 source', async () => {
    const wrongOwner = new FakeTransaction([
      queryResult([sourceRow({ account_id: OTHER_ACCOUNT_ID })]),
    ]);
    await expect(
      repository.complete(wrongOwner, validInput()),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });

    const v2 = new FakeTransaction([
      queryResult([sourceRow({ survey_version: 'initial_level_v2' })]),
    ]);
    await expect(repository.complete(v2, validInput())).resolves.toEqual({
      outcome: 'not_eligible',
    });
  });

  it('rejects incomplete five-question answers before any query', async () => {
    const transaction = new FakeTransaction([]);
    await expect(
      repository.complete(
        transaction,
        validInput({ surveyAnswers: { match_count: 'none' } }),
      ),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(0);
  });

  it('fails a concurrent zero-row insert closed as a retryable transaction conflict', async () => {
    const transaction = new FakeTransaction([
      queryResult([sourceRow()]),
      queryResult([]),
      queryResult([], 0),
    ]);
    await expect(
      repository.complete(transaction, validInput()),
    ).rejects.toMatchObject({
      reason: 'transaction_conflict',
    });
  });

  it.each([
    ['42501', 'permission_denied'],
    ['40001', 'transaction_conflict'],
    ['08006', 'database_unavailable'],
  ] as const)(
    'maps postgres %s to a PII-safe %s error',
    async (code, reason) => {
      const transaction = new FakeTransaction([postgresError(code)]);
      const error = await repository
        .read(transaction, { accountId: ACCOUNT_ID })
        .catch((caught) => caught);
      expectSafeError(error, reason);
    },
  );
});
