import { inspect } from 'node:util';
import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  CompletePlayerOnboardingInput,
  PlayerOnboardingCompletionPersistenceError,
  PlayerOnboardingCompletionPersistenceFailure,
} from './player-onboarding-completion-writer';
import { PostgresPlayerOnboardingCompletionWriter } from './postgres-player-onboarding-completion-writer';
import { PostgresTransaction } from './postgres-transaction';

const ACCOUNT_ID = deterministicUuid(
  'player-onboarding-completion-writer',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_ONBOARDING_COMPLETION_PRIVATE';
const SURVEY_ANSWERS = Object.freeze({
  match_count: 'thirty_one_to_ninety_nine',
  rally_stability: 'steady_under_pressure',
  glass_play: 'confident_returns',
  serve_return_net: 'confident_patterns',
  match_experience_year: 'league_or_club',
});
const INITIAL_LEVEL_RESULT = Object.freeze({
  initialLevelScore: 15,
  initialLevelLabel: 'B+' as const,
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
    if (next === undefined) {
      throw new Error('Unexpected query');
    }
    if (next instanceof Error || !('rows' in next)) {
      throw next;
    }
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

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    account_id: ACCOUNT_ID,
    first_name: 'Synthetic',
    phone: '+79990000000',
    normalized_email: 'player@example.test',
    ...overrides,
  };
}

function stateRow(overrides: Record<string, unknown> = {}) {
  return {
    account_id: ACCOUNT_ID,
    flow_version: 'tma_v1',
    status: 'in_progress',
    current_step: 'level_survey',
    survey_version: 'initial_level_v2',
    survey_answers: {},
    initial_level_score: null,
    initial_level_label: null,
    revision: '4',
    created_at: '1799999900',
    updated_at: '1799999950',
    completed_at: null,
    ...overrides,
  };
}

function consentRows(acceptedAt = '1800000000') {
  return [
    {
      consent_kind: 'cancellation',
      document_version: '2026-08-01',
      flow_version: 'tma_v1',
      accepted_at: acceptedAt,
    },
    {
      consent_kind: 'privacy',
      document_version: '2026-08-01',
      flow_version: 'tma_v1',
      accepted_at: acceptedAt,
    },
    {
      consent_kind: 'terms',
      document_version: '2026-08-01',
      flow_version: 'tma_v1',
      accepted_at: acceptedAt,
    },
  ];
}

function validInput(
  overrides: Partial<CompletePlayerOnboardingInput> = {},
): CompletePlayerOnboardingInput {
  return {
    accountId: ACCOUNT_ID,
    expectedRevision: 4,
    flowVersion: 'tma_v1',
    consents: [
      { kind: 'cancellation', documentVersion: '2026-08-01' },
      { kind: 'privacy', documentVersion: '2026-08-01' },
      { kind: 'terms', documentVersion: '2026-08-01' },
    ],
    surveyVersion: 'initial_level_v2',
    surveyAnswers: SURVEY_ANSWERS,
    completedAt: NOW,
    ...overrides,
  };
}

function postgresError(code: string): Record<string, unknown> {
  return {
    code,
    message: `${PRIVATE_MARKER}:${ACCOUNT_ID}`,
    detail: `${PRIVATE_MARKER}:+79990000000:player@example.test`,
    constraint: 'private_constraint',
    cause: new Error(`${PRIVATE_MARKER}-cause`),
  };
}

function expectSafeError(
  value: unknown,
  reason: PlayerOnboardingCompletionPersistenceFailure,
): PlayerOnboardingCompletionPersistenceError {
  expect(value).toBeInstanceOf(PlayerOnboardingCompletionPersistenceError);
  const error = value as PlayerOnboardingCompletionPersistenceError;
  expect(error.reason).toBe(reason);
  expect(error.message).toBe('Player onboarding completion persistence failed');
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
    '+79990000000',
    'player@example.test',
    'private_constraint',
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  return error;
}

describe('PostgresPlayerOnboardingCompletionWriter', () => {
  it('locks owner then state and atomically inserts exact consents before one completion update', async () => {
    const transaction = new FakeTransaction([
      queryResult([profileRow()]),
      queryResult([stateRow()]),
      queryResult([], 0),
      queryResult([
        {
          account_id: ACCOUNT_ID,
          revision: '5',
          initial_level_score: 15,
          initial_level_label: 'B+',
        },
      ]),
    ]);

    await expect(
      new PostgresPlayerOnboardingCompletionWriter().complete(
        transaction,
        validInput(),
      ),
    ).resolves.toEqual({
      outcome: 'completed',
      revision: 5,
      replayed: false,
      ...INITIAL_LEVEL_RESULT,
    });

    expect(transaction.calls).toHaveLength(4);
    const sql = transaction.calls.map((call) => normalizeSql(call.text));
    expect(sql[0]).toMatch(
      /^SELECT account_id, first_name, phone, normalized_email FROM backend_auth\.player_profile_details/u,
    );
    expect(sql[0]).toContain('FOR UPDATE');
    expect(sql[1]).toContain('FROM backend_auth.player_onboarding_states');
    expect(sql[1]).toContain('FOR UPDATE');
    expect(sql[2]).toContain(
      'INSERT INTO backend_auth.account_consent_acceptances',
    );
    expect(sql[2]).toContain('ON CONFLICT');
    expect(sql[3]).toContain("status = 'completed'");
    expect(sql[3]).toContain("current_step = 'completed'");
    expect(sql[3]).toContain('initial_level_score = $7::smallint');
    expect(sql[3]).toContain('initial_level_label = $8::text');
    expect(sql[3]).toContain('revision = revision + 1');
    expect(sql[3]).not.toMatch(/phone|normalized_email|is_verified|rating/iu);
    expect(transaction.calls[2].values).toEqual([
      ACCOUNT_ID,
      'cancellation',
      '2026-08-01',
      'privacy',
      '2026-08-01',
      'terms',
      '2026-08-01',
      'tma_v1',
      NOW,
    ]);
    expect(transaction.calls[3].values).toEqual([
      ACCOUNT_ID,
      4,
      SURVEY_ANSWERS,
      NOW,
      'tma_v1',
      'initial_level_v2',
      15,
      'B+',
    ]);
  });

  it('returns an exact completed retry read-only when revision and final payload match', async () => {
    const transaction = new FakeTransaction([
      queryResult([profileRow({ phone: '+78880000000' })]),
      queryResult([
        stateRow({
          status: 'completed',
          current_step: 'completed',
          survey_answers: SURVEY_ANSWERS,
          initial_level_score: 15,
          initial_level_label: 'B+',
          revision: '5',
          updated_at: '1800000000',
          completed_at: '1800000000',
        }),
      ]),
      queryResult(consentRows()),
    ]);

    await expect(
      new PostgresPlayerOnboardingCompletionWriter().complete(
        transaction,
        validInput(),
      ),
    ).resolves.toEqual({
      outcome: 'completed',
      revision: 5,
      replayed: true,
      ...INITIAL_LEVEL_RESULT,
    });
    expect(transaction.calls).toHaveLength(3);
    expect(normalizeSql(transaction.calls[2].text)).toMatch(/^SELECT/u);
    expect(
      transaction.calls.some((call) =>
        /^(?:INSERT|UPDATE|DELETE)\b/iu.test(normalizeSql(call.text)),
      ),
    ).toBe(false);
  });

  it.each([
    ['different expected revision', validInput({ expectedRevision: 3 })],
    [
      'different survey answers',
      validInput({
        surveyAnswers: { ...SURVEY_ANSWERS, glass_play: 'uses_tactically' },
      }),
    ],
  ])(
    'conflicts on a completed %s request without writes',
    async (_label, input) => {
      const transaction = new FakeTransaction([
        queryResult([profileRow()]),
        queryResult([
          stateRow({
            status: 'completed',
            current_step: 'completed',
            survey_answers: SURVEY_ANSWERS,
            initial_level_score: 15,
            initial_level_label: 'B+',
            revision: '5',
            updated_at: '1800000000',
            completed_at: '1800000000',
          }),
        ]),
      ]);

      await expect(
        new PostgresPlayerOnboardingCompletionWriter().complete(
          transaction,
          input,
        ),
      ).resolves.toEqual({ outcome: 'conflict' });
      expect(transaction.calls).toHaveLength(2);
    },
  );

  it('conflicts when an otherwise matching retry lacks an exact mandatory consent version', async () => {
    const rows = consentRows().filter((row) => row.consent_kind !== 'privacy');
    const transaction = new FakeTransaction([
      queryResult([profileRow()]),
      queryResult([
        stateRow({
          status: 'completed',
          current_step: 'completed',
          survey_answers: SURVEY_ANSWERS,
          initial_level_score: 15,
          initial_level_label: 'B+',
          revision: '5',
          updated_at: '1800000000',
          completed_at: '1800000000',
        }),
      ]),
      queryResult(rows),
    ]);

    await expect(
      new PostgresPlayerOnboardingCompletionWriter().complete(
        transaction,
        validInput(),
      ),
    ).resolves.toEqual({ outcome: 'conflict' });
  });

  it('conflicts read-only when a completed retry has a different stored result', async () => {
    const transaction = new FakeTransaction([
      queryResult([profileRow()]),
      queryResult([
        stateRow({
          status: 'completed',
          current_step: 'completed',
          survey_answers: SURVEY_ANSWERS,
          initial_level_score: 14,
          initial_level_label: 'B',
          revision: '5',
          updated_at: '1800000000',
          completed_at: '1800000000',
        }),
      ]),
    ]);

    await expect(
      new PostgresPlayerOnboardingCompletionWriter().complete(
        transaction,
        validInput(),
      ),
    ).resolves.toEqual({ outcome: 'conflict' });
    expect(transaction.calls).toHaveLength(2);
  });

  it('preserves a legacy completed row and returns a read-only conflict', async () => {
    const transaction = new FakeTransaction([
      queryResult([profileRow()]),
      queryResult([
        stateRow({
          status: 'completed',
          current_step: 'completed',
          survey_version: 'initial_level_v1',
          survey_answers: { experience: 'beginner' },
          initial_level_score: null,
          initial_level_label: null,
          revision: '5',
          updated_at: '1800000000',
          completed_at: '1800000000',
        }),
      ]),
    ]);

    await expect(
      new PostgresPlayerOnboardingCompletionWriter().complete(
        transaction,
        validInput(),
      ),
    ).resolves.toEqual({ outcome: 'conflict' });
    expect(transaction.calls).toHaveLength(2);
  });

  it('rejects stale and incomplete drafts before consent or state mutation', async () => {
    for (const [row, expected] of [
      [stateRow({ revision: '5' }), { outcome: 'stale_revision' }],
      [stateRow({ current_step: 'consents' }), { outcome: 'incomplete' }],
      [stateRow(), { outcome: 'incomplete' }],
    ] as const) {
      const profile =
        expected.outcome === 'incomplete' && row.current_step === 'level_survey'
          ? profileRow({ phone: null })
          : profileRow();
      const transaction = new FakeTransaction([
        queryResult([profile]),
        queryResult([row]),
      ]);
      await expect(
        new PostgresPlayerOnboardingCompletionWriter().complete(
          transaction,
          validInput(),
        ),
      ).resolves.toEqual(expected);
      expect(transaction.calls).toHaveLength(2);
    }
  });

  it('hides a missing owner and never selects caller-provided ownership', async () => {
    const transaction = new FakeTransaction([queryResult([], 0)]);
    await expect(
      new PostgresPlayerOnboardingCompletionWriter().complete(
        transaction,
        validInput(),
      ),
    ).resolves.toEqual({ outcome: 'not_found' });
    expect(transaction.calls).toHaveLength(1);
    expect(transaction.calls[0].values).toEqual([ACCOUNT_ID]);
  });

  it('throws after consent insertion when the guarded update is anomalous so the transaction rolls back', async () => {
    const transaction = new FakeTransaction([
      queryResult([profileRow()]),
      queryResult([stateRow()]),
      queryResult([], 0),
      queryResult([], 0),
    ]);
    await expect(
      new PostgresPlayerOnboardingCompletionWriter().complete(
        transaction,
        validInput(),
      ),
    ).rejects.toMatchObject({
      name: 'PlayerOnboardingCompletionPersistenceError',
      reason: 'invalid_persisted_state',
    });
    expect(transaction.calls).toHaveLength(4);
  });

  it('throws after update when PostgreSQL returns a different computed result so the transaction rolls back', async () => {
    const transaction = new FakeTransaction([
      queryResult([profileRow()]),
      queryResult([stateRow()]),
      queryResult([], 0),
      queryResult([
        {
          account_id: ACCOUNT_ID,
          revision: '5',
          initial_level_score: 14,
          initial_level_label: 'B',
        },
      ]),
    ]);

    await expect(
      new PostgresPlayerOnboardingCompletionWriter().complete(
        transaction,
        validInput(),
      ),
    ).rejects.toMatchObject({
      name: 'PlayerOnboardingCompletionPersistenceError',
      reason: 'invalid_persisted_state',
    });
    expect(transaction.calls).toHaveLength(4);
  });

  it('rejects malformed input before SQL and never copies it into a public error', async () => {
    const transaction = new FakeTransaction([]);
    let caught: unknown;
    try {
      await new PostgresPlayerOnboardingCompletionWriter().complete(
        transaction,
        {
          ...validInput(),
          expectedRevision: 0,
          privateBody: PRIVATE_MARKER,
        } as unknown as CompletePlayerOnboardingInput,
      );
    } catch (error) {
      caught = error;
    }
    expectSafeError(caught, 'invalid_input');
    expect(transaction.calls).toHaveLength(0);
  });

  it.each([
    [
      'superseded survey version',
      validInput({ surveyVersion: 'initial_level_v1' }),
    ],
    [
      'partial five-question survey',
      validInput({
        surveyAnswers: {
          match_count: 'one_hundred_plus',
          rally_stability: 'controls_pace',
        },
      }),
    ],
  ])('rejects %s before SQL', async (_label, input) => {
    const transaction = new FakeTransaction([]);
    await expect(
      new PostgresPlayerOnboardingCompletionWriter().complete(
        transaction,
        input,
      ),
    ).rejects.toMatchObject({
      name: 'PlayerOnboardingCompletionPersistenceError',
      reason: 'invalid_input',
    });
    expect(transaction.calls).toHaveLength(0);
  });

  it.each([
    ['42501', 'permission_denied'],
    ['40001', 'transaction_conflict'],
    ['40P01', 'transaction_conflict'],
    ['08006', 'database_unavailable'],
  ] as const)(
    'maps PostgreSQL %s to a fixed PII-safe %s error',
    async (code, reason) => {
      const transaction = new FakeTransaction([postgresError(code)]);
      let caught: unknown;
      try {
        await new PostgresPlayerOnboardingCompletionWriter().complete(
          transaction,
          validInput(),
        );
      } catch (error) {
        caught = error;
      }
      expectSafeError(caught, reason);
    },
  );
});
