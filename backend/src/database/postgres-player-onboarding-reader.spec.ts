import { inspect } from 'node:util';
import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  PlayerOnboardingReadPersistenceError,
  PlayerOnboardingReadPersistenceFailure,
} from './player-onboarding-reader';
import { PostgresPlayerOnboardingReader } from './postgres-player-onboarding-reader';
import { PostgresTransaction } from './postgres-transaction';

const ACCOUNT_ID = deterministicUuid('player-onboarding-reader') as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-onboarding-reader-other',
) as AccountId;
const PRIVATE_MARKER = 'SYNTHETIC_ONBOARDING_PERSISTENCE_PRIVATE';

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

function firstRunRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    account_id: ACCOUNT_ID,
    first_name: 'Synthetic',
    last_name: 'Player',
    phone: '+79990000000',
    normalized_email: 'player@example.test',
    state_account_id: null,
    flow_version: null,
    status: null,
    current_step: null,
    survey_version: null,
    survey_answers: null,
    initial_level_label: null,
    revision: null,
    consents: [],
    ...overrides,
  };
}

function completedV2Row(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return draftRow({
    status: 'completed',
    current_step: 'completed',
    survey_version: 'initial_level_v2',
    survey_answers: {
      match_count: 'one_hundred_plus',
      rally_stability: 'controls_pace',
      glass_play: 'uses_tactically',
      serve_return_net: 'advanced_patterns',
      match_experience_year: 'tournament',
    },
    initial_level_label: 'A',
    revision: '4',
    ...overrides,
  });
}

function draftRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return firstRunRow({
    state_account_id: ACCOUNT_ID,
    flow_version: 'tma_v1',
    status: 'in_progress',
    current_step: 'consents',
    survey_version: 'initial_level_v1',
    survey_answers: { experience: 'beginner' },
    revision: '3',
    consents: [
      { kind: 'cancellation', documentVersion: '2026-08-01' },
      { kind: 'privacy', documentVersion: '2026-08-01' },
      { kind: 'terms', documentVersion: '2026-08-01' },
    ],
    ...overrides,
  });
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

function postgresError(
  code: string,
  marker = PRIVATE_MARKER,
): Record<string, unknown> {
  return {
    code,
    message: marker,
    detail: `${marker}-detail`,
    query: `SELECT '${marker}'`,
    parameters: [ACCOUNT_ID, marker],
    constraint: 'private_constraint',
    schema: 'private_schema',
    table: 'private_table',
    column: 'private_column',
    cause: new Error(`${marker}-cause`),
  };
}

function expectSafeError(
  error: unknown,
  reason: PlayerOnboardingReadPersistenceFailure,
): PlayerOnboardingReadPersistenceError {
  expect(error).toBeInstanceOf(PlayerOnboardingReadPersistenceError);
  const safe = error as PlayerOnboardingReadPersistenceError;
  expect(safe.reason).toBe(reason);
  return safe;
}

describe('PostgresPlayerOnboardingReader', () => {
  it('uses one static owner-parameterized read without locks or writes', async () => {
    const transaction = new FakeTransaction([queryResult([])]);

    await new PostgresPlayerOnboardingReader().findByAccountId(transaction, {
      accountId: ACCOUNT_ID,
    });

    expect(transaction.calls).toHaveLength(1);
    const call = transaction.calls[0];
    const sql = normalizeSql(call.text);
    expect(call.values).toEqual([ACCOUNT_ID]);
    expect(sql).toContain(
      'FROM backend_auth.player_profile_details AS details LEFT JOIN backend_auth.player_onboarding_states AS state',
    );
    expect(sql).toContain('WHERE details.account_id = $1');
    expect(sql).toContain('state.initial_level_label');
    expect(sql).toContain('acceptance.account_id = details.account_id');
    expect(sql).not.toContain('acceptance.flow_version = state.flow_version');
    expect(call.text).not.toContain(ACCOUNT_ID);
    for (const forbidden of [
      'FOR UPDATE',
      'INSERT ',
      'UPDATE ',
      'DELETE ',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
      'public.',
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('returns a profile with absent state for first-run without creating data', async () => {
    await expect(
      new PostgresPlayerOnboardingReader().findByAccountId(
        new FakeTransaction([queryResult([firstRunRow()])]),
        { accountId: ACCOUNT_ID },
      ),
    ).resolves.toEqual({
      outcome: 'found',
      onboarding: {
        accountId: ACCOUNT_ID,
        firstName: 'Synthetic',
        lastName: 'Player',
        phone: '+79990000000',
        normalizedEmail: 'player@example.test',
        state: null,
        consents: [],
      },
    });
  });

  it('hydrates a resumable draft and deterministic current-flow consents', async () => {
    const result = await new PostgresPlayerOnboardingReader().findByAccountId(
      new FakeTransaction([queryResult([draftRow()])]),
      { accountId: ACCOUNT_ID },
    );

    expect(result).toEqual({
      outcome: 'found',
      onboarding: {
        accountId: ACCOUNT_ID,
        firstName: 'Synthetic',
        lastName: 'Player',
        phone: '+79990000000',
        normalizedEmail: 'player@example.test',
        state: {
          flowVersion: 'tma_v1',
          status: 'in_progress',
          currentStep: 'consents',
          surveyVersion: 'initial_level_v1',
          surveyAnswers: { experience: 'beginner' },
          initialLevelLabel: null,
          revision: 3,
        },
        consents: [
          { kind: 'cancellation', documentVersion: '2026-08-01' },
          { kind: 'privacy', documentVersion: '2026-08-01' },
          { kind: 'terms', documentVersion: '2026-08-01' },
        ],
      },
    });
    if (result.outcome === 'found') {
      expect(Object.isFrozen(result.onboarding)).toBe(true);
      expect(Object.isFrozen(result.onboarding.consents)).toBe(true);
      expect(Object.isFrozen(result.onboarding.state?.surveyAnswers)).toBe(
        true,
      );
    }
  });

  it('hydrates only the persisted label for a completed initial-level v2 owner', async () => {
    const result = await new PostgresPlayerOnboardingReader().findByAccountId(
      new FakeTransaction([queryResult([completedV2Row()])]),
      { accountId: ACCOUNT_ID },
    );

    expect(result).toMatchObject({
      outcome: 'found',
      onboarding: {
        accountId: ACCOUNT_ID,
        state: {
          status: 'completed',
          currentStep: 'completed',
          surveyVersion: 'initial_level_v2',
          initialLevelLabel: 'A',
          revision: 4,
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain('initialLevelScore');
  });

  it('returns not_found only for a missing owner profile row', async () => {
    await expect(
      new PostgresPlayerOnboardingReader().findByAccountId(
        new FakeTransaction([queryResult([])]),
        { accountId: ACCOUNT_ID },
      ),
    ).resolves.toEqual({ outcome: 'not_found' });
  });

  it.each([
    ['invalid input', { accountId: 'not-a-uuid' }],
    ['extra input', { accountId: ACCOUNT_ID, other: true }],
  ])('rejects %s before SQL', async (_label, input) => {
    const transaction = new FakeTransaction([]);
    await expect(
      new PostgresPlayerOnboardingReader().findByAccountId(
        transaction,
        input as never,
      ),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(0);
  });

  it.each([
    ['different owner', { account_id: OTHER_ACCOUNT_ID }],
    ['different state owner', { state_account_id: OTHER_ACCOUNT_ID }],
    ['non-canonical phone', { phone: '79990000000' }],
    ['non-normalized email', { normalized_email: 'Player@Example.test' }],
    ['numeric revision', { revision: 3 }],
    ['completed step in draft', { current_step: 'completed' }],
    ['malformed survey', { survey_answers: { experience: 'Not Bounded' } }],
    ['label on draft', { initial_level_label: 'C' }],
    ['invalid v2 label', completedV2Row({ initial_level_label: 'S' })],
    ['missing v2 label', completedV2Row({ initial_level_label: null })],
    [
      'unsorted consents',
      {
        consents: [
          { kind: 'terms', documentVersion: 'v1' },
          { kind: 'privacy', documentVersion: 'v1' },
        ],
      },
    ],
  ] as const)('rejects persisted state with %s', async (_label, overrides) => {
    await expect(
      new PostgresPlayerOnboardingReader().findByAccountId(
        new FakeTransaction([queryResult([draftRow({ ...overrides })])]),
        { accountId: ACCOUNT_ID },
      ),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });

  it('rejects inconsistent cardinality', async () => {
    await expect(
      new PostgresPlayerOnboardingReader().findByAccountId(
        new FakeTransaction([queryResult([firstRunRow()], 0)]),
        { accountId: ACCOUNT_ID },
      ),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });

  it.each([
    ['42501', 'permission_denied'],
    ['40001', 'transaction_conflict'],
    ['40P01', 'transaction_conflict'],
    ['08006', 'database_unavailable'],
    ['57P01', 'database_unavailable'],
    ['57014', 'database_unavailable'],
    ['23505', 'storage_failure'],
  ] as const)('maps SQLSTATE %s to %s', async (code, reason) => {
    await expect(
      new PostgresPlayerOnboardingReader().findByAccountId(
        new FakeTransaction([postgresError(code)]),
        { accountId: ACCOUNT_ID },
      ),
    ).rejects.toMatchObject({ reason });
  });

  it('does not leak PostgreSQL, account, phone or email details through errors', async () => {
    const raw = postgresError('42501');
    let caught: unknown;
    try {
      await new PostgresPlayerOnboardingReader().findByAccountId(
        new FakeTransaction([raw]),
        { accountId: ACCOUNT_ID },
      );
    } catch (error) {
      caught = error;
    }

    const safe = expectSafeError(caught, 'permission_denied');
    const serialized = inspect({
      own: Object.getOwnPropertyNames(safe).map((key) => [
        key,
        (safe as unknown as Record<string, unknown>)[key],
      ]),
      json: JSON.stringify(safe),
    });
    for (const forbidden of [
      PRIVATE_MARKER,
      ACCOUNT_ID,
      '+79990000000',
      'player@example.test',
      'private_constraint',
    ]) {
      expect(safe.message).not.toContain(forbidden);
      expect(safe.stack).not.toContain(forbidden);
      expect(serialized).not.toContain(forbidden);
    }
  });
});
