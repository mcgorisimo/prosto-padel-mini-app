import { inspect } from 'node:util';
import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  AdvancePlayerOnboardingInput,
  PlayerOnboardingProgressPersistenceError,
  PlayerOnboardingProgressPersistenceFailure,
} from './player-onboarding-progress-writer';
import { PostgresPlayerOnboardingProgressWriter } from './postgres-player-onboarding-progress-writer';
import { PostgresTransaction } from './postgres-transaction';

const ACCOUNT_ID = deterministicUuid(
  'player-onboarding-progress-writer',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-onboarding-progress-writer-other',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_ONBOARDING_PROGRESS_PRIVATE';

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
    current_step: 'profile',
    survey_version: 'initial_level_v1',
    survey_answers: {},
    revision: '1',
    created_at: '1799999900',
    updated_at: '1799999950',
    completed_at: null,
    ...overrides,
  };
}

function consentRows(version = '2026-08-01') {
  return [
    {
      consent_kind: 'cancellation',
      document_version: version,
      flow_version: 'tma_v1',
      accepted_at: '1800000000',
    },
    {
      consent_kind: 'personal_data_processing',
      document_version: version,
      flow_version: 'tma_v1',
      accepted_at: '1800000000',
    },
    {
      consent_kind: 'terms',
      document_version: version,
      flow_version: 'tma_v1',
      accepted_at: '1800000000',
    },
  ];
}

function input(
  overrides: Partial<AdvancePlayerOnboardingInput> = {},
): AdvancePlayerOnboardingInput {
  return {
    accountId: ACCOUNT_ID,
    expectedRevision: 1,
    flowVersion: 'tma_v1',
    nextStep: 'consents',
    consents: [],
    advancedAt: NOW,
    ...overrides,
  };
}

function levelSurveyInput(
  overrides: Partial<AdvancePlayerOnboardingInput> = {},
): AdvancePlayerOnboardingInput {
  return input({
    expectedRevision: 2,
    nextStep: 'level_survey',
    consents: [
      { kind: 'cancellation', documentVersion: '2026-08-01' },
      { kind: 'personal_data_processing', documentVersion: '2026-08-01' },
      { kind: 'terms', documentVersion: '2026-08-01' },
    ],
    ...overrides,
  });
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
  reason: PlayerOnboardingProgressPersistenceFailure,
): PlayerOnboardingProgressPersistenceError {
  expect(value).toBeInstanceOf(PlayerOnboardingProgressPersistenceError);
  const error = value as PlayerOnboardingProgressPersistenceError;
  expect(error.reason).toBe(reason);
  expect(error.message).toBe('Player onboarding progress persistence failed');
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

describe('PostgresPlayerOnboardingProgressWriter', () => {
  it.each(['profile', 'contacts'] as const)(
    'advances %s to consents in one guarded revision without consent writes',
    async (currentStep) => {
      const transaction = new FakeTransaction([
        queryResult([profileRow()]),
        queryResult([stateRow({ current_step: currentStep })]),
        queryResult([{ account_id: ACCOUNT_ID, revision: '2' }]),
      ]);

      await expect(
        new PostgresPlayerOnboardingProgressWriter().advance(
          transaction,
          input(),
        ),
      ).resolves.toEqual({ outcome: 'advanced', revision: 2, replayed: false });

      expect(transaction.calls).toHaveLength(3);
      const sql = transaction.calls.map((call) => normalizeSql(call.text));
      expect(sql[0]).toContain('player_profile_details');
      expect(sql[0]).toContain('FOR UPDATE');
      expect(sql[1]).toContain('player_onboarding_states');
      expect(sql[1]).toContain('FOR UPDATE');
      expect(sql[2]).toContain("current_step = 'consents'");
      expect(sql[2]).toContain("current_step IN ('profile', 'contacts')");
      expect(sql[2]).toContain('revision = revision + 1');
      expect(sql.join(' ')).not.toContain(
        'INSERT INTO backend_auth.account_consent_acceptances',
      );
    },
  );

  it('atomically records exact policy consents before advancing to level_survey', async () => {
    const transaction = new FakeTransaction([
      queryResult([profileRow()]),
      queryResult([stateRow({ current_step: 'consents', revision: '2' })]),
      queryResult([], 0),
      queryResult([{ account_id: ACCOUNT_ID, revision: '3' }]),
    ]);

    await expect(
      new PostgresPlayerOnboardingProgressWriter().advance(
        transaction,
        levelSurveyInput(),
      ),
    ).resolves.toEqual({ outcome: 'advanced', revision: 3, replayed: false });

    expect(transaction.calls).toHaveLength(4);
    const sql = transaction.calls.map((call) => normalizeSql(call.text));
    expect(sql[2]).toContain(
      'INSERT INTO backend_auth.account_consent_acceptances',
    );
    expect(sql[2]).toContain('ON CONFLICT');
    expect(sql[3]).toContain("current_step = 'level_survey'");
    expect(sql[3]).toContain("current_step = 'consents'");
    expect(transaction.calls[2].values).toEqual([
      ACCOUNT_ID,
      'cancellation',
      '2026-08-01',
      'personal_data_processing',
      '2026-08-01',
      'terms',
      '2026-08-01',
      'tma_v1',
      NOW,
    ]);
  });

  it('returns an exact level_survey retry read-only when revision and consents match', async () => {
    const transaction = new FakeTransaction([
      queryResult([profileRow()]),
      queryResult([
        stateRow({
          current_step: 'level_survey',
          revision: '3',
          updated_at: String(NOW),
        }),
      ]),
      queryResult(consentRows()),
    ]);

    await expect(
      new PostgresPlayerOnboardingProgressWriter().advance(
        transaction,
        levelSurveyInput(),
      ),
    ).resolves.toEqual({ outcome: 'advanced', revision: 3, replayed: true });
    expect(transaction.calls).toHaveLength(3);
    expect(
      transaction.calls.some((call) =>
        /^(?:INSERT|UPDATE|DELETE)\b/iu.test(normalizeSql(call.text)),
      ),
    ).toBe(false);
  });

  it('conflicts on a same-revision replay with different consent versions', async () => {
    const transaction = new FakeTransaction([
      queryResult([profileRow()]),
      queryResult([
        stateRow({
          current_step: 'level_survey',
          revision: '3',
          updated_at: String(NOW),
        }),
      ]),
      queryResult(consentRows()),
    ]);
    const different = levelSurveyInput({
      consents: [
        { kind: 'cancellation', documentVersion: '2026-08-02' },
        { kind: 'personal_data_processing', documentVersion: '2026-08-02' },
        { kind: 'terms', documentVersion: '2026-08-02' },
      ],
    });

    await expect(
      new PostgresPlayerOnboardingProgressWriter().advance(
        transaction,
        different,
      ),
    ).resolves.toEqual({ outcome: 'conflict' });
    expect(transaction.calls).toHaveLength(3);
  });

  it.each([
    [
      'stale revision',
      profileRow(),
      stateRow({ revision: '4' }),
      input(),
      'stale_revision',
    ],
    [
      'silent skip',
      profileRow(),
      stateRow(),
      levelSurveyInput({ expectedRevision: 1 }),
      'conflict',
    ],
    [
      'missing profile requirements',
      profileRow({ normalized_email: null }),
      stateRow(),
      input(),
      'incomplete',
    ],
  ] as const)(
    'rejects %s before progress writes',
    async (_label, profile, state, progress, outcome) => {
      const transaction = new FakeTransaction([
        queryResult([profile]),
        queryResult([state]),
      ]);
      await expect(
        new PostgresPlayerOnboardingProgressWriter().advance(
          transaction,
          progress,
        ),
      ).resolves.toEqual({ outcome });
      expect(transaction.calls).toHaveLength(2);
    },
  );

  it('hides missing and foreign owners before progress mutation', async () => {
    const missing = new FakeTransaction([queryResult([], 0)]);
    await expect(
      new PostgresPlayerOnboardingProgressWriter().advance(missing, input()),
    ).resolves.toEqual({ outcome: 'not_found' });
    expect(missing.calls).toHaveLength(1);

    const foreign = new FakeTransaction([
      queryResult([profileRow({ account_id: OTHER_ACCOUNT_ID })]),
    ]);
    await new PostgresPlayerOnboardingProgressWriter()
      .advance(foreign, input())
      .then(
        () => {
          throw new Error('Expected foreign owner rejection');
        },
        (error: unknown) => {
          expectSafeError(error, 'invalid_persisted_state');
        },
      );
    expect(foreign.calls).toHaveLength(1);
  });

  it('throws after consent insertion when the guarded update is anomalous', async () => {
    const transaction = new FakeTransaction([
      queryResult([profileRow()]),
      queryResult([stateRow({ current_step: 'consents', revision: '2' })]),
      queryResult([], 0),
      queryResult([], 0),
    ]);

    await new PostgresPlayerOnboardingProgressWriter()
      .advance(transaction, levelSurveyInput())
      .then(
        () => {
          throw new Error('Expected guarded update rejection');
        },
        (error: unknown) => {
          expectSafeError(error, 'invalid_persisted_state');
        },
      );
    expect(transaction.calls).toHaveLength(4);
  });

  it('maps persistence diagnostics to a PII-free error', async () => {
    const transaction = new FakeTransaction([postgresError('42501')]);
    await new PostgresPlayerOnboardingProgressWriter()
      .advance(transaction, input())
      .then(
        () => {
          throw new Error('Expected persistence rejection');
        },
        (error: unknown) => {
          expectSafeError(error, 'permission_denied');
        },
      );
  });
});
