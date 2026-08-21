import { inspect } from 'node:util';
import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  PlayerOnboardingDraftWritePersistenceError,
  PlayerOnboardingDraftWritePersistenceFailure,
  SavePlayerOnboardingDraftInput,
} from './player-onboarding-draft-writer';
import { PostgresPlayerOnboardingDraftWriter } from './postgres-player-onboarding-draft-writer';
import { PostgresTransaction } from './postgres-transaction';

const ACCOUNT_ID = deterministicUuid(
  'player-onboarding-draft-writer',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_ONBOARDING_DRAFT_PRIVATE';

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

function validInput(
  overrides: Partial<SavePlayerOnboardingDraftInput> = {},
): SavePlayerOnboardingDraftInput {
  return {
    accountId: ACCOUNT_ID,
    expectedRevision: null,
    firstName: 'Synthetic',
    lastName: 'Player',
    phone: '+79990000000',
    normalizedEmail: 'player@example.test',
    flowVersion: 'tma_v1',
    surveyVersion: 'initial_level_v1',
    updatedAt: NOW,
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
  reason: PlayerOnboardingDraftWritePersistenceFailure,
): PlayerOnboardingDraftWritePersistenceError {
  expect(value).toBeInstanceOf(PlayerOnboardingDraftWritePersistenceError);
  const error = value as PlayerOnboardingDraftWritePersistenceError;
  expect(error.reason).toBe(reason);
  expect(error.message).toBe(
    'Player onboarding draft write persistence failed',
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
    '+79990000000',
    'player@example.test',
    'private_constraint',
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  return error;
}

describe('PostgresPlayerOnboardingDraftWriter', () => {
  it('creates a first-run draft only after locking the owner profile and absent state', async () => {
    const transaction = new FakeTransaction([
      queryResult([{ account_id: ACCOUNT_ID }]),
      queryResult([]),
      queryResult([{ account_id: ACCOUNT_ID }]),
      queryResult([{ account_id: ACCOUNT_ID, revision: '1' }]),
    ]);

    await expect(
      new PostgresPlayerOnboardingDraftWriter().saveDraft(
        transaction,
        validInput(),
      ),
    ).resolves.toEqual({ outcome: 'saved', revision: 1 });

    expect(transaction.calls).toHaveLength(4);
    expect(normalizeSql(transaction.calls[0].text)).toBe(
      'SELECT account_id FROM backend_auth.player_profile_details WHERE account_id = $1::uuid FOR UPDATE',
    );
    expect(normalizeSql(transaction.calls[1].text)).toBe(
      'SELECT account_id, status, revision, updated_at FROM backend_auth.player_onboarding_states WHERE account_id = $1::uuid FOR UPDATE',
    );
    expect(normalizeSql(transaction.calls[2].text)).toBe(
      'UPDATE backend_auth.player_profile_details SET first_name = $2::text, last_name = $3::text, phone = $4::text, normalized_email = $5::text, updated_at = GREATEST(updated_at, $6::bigint) WHERE account_id = $1::uuid RETURNING account_id',
    );
    expect(transaction.calls[2].values).toEqual([
      ACCOUNT_ID,
      'Synthetic',
      'Player',
      '+79990000000',
      'player@example.test',
      NOW,
    ]);
    expect(normalizeSql(transaction.calls[3].text)).toBe(
      "INSERT INTO backend_auth.player_onboarding_states ( account_id, flow_version, current_step, survey_version, created_at, updated_at ) VALUES ($1::uuid, $2::text, 'profile', $3::text, $4::bigint, $4::bigint) RETURNING account_id, revision",
    );
    expect(transaction.calls[3].values).toEqual([
      ACCOUNT_ID,
      'tma_v1',
      'initial_level_v1',
      NOW,
    ]);
  });

  it('resumes a draft by preserving state fields and incrementing its exact revision', async () => {
    const transaction = new FakeTransaction([
      queryResult([{ account_id: ACCOUNT_ID }]),
      queryResult([
        {
          account_id: ACCOUNT_ID,
          status: 'in_progress',
          revision: '4',
          updated_at: String(NOW - 10),
        },
      ]),
      queryResult([{ account_id: ACCOUNT_ID }]),
      queryResult([{ account_id: ACCOUNT_ID, revision: '5' }]),
    ]);

    await expect(
      new PostgresPlayerOnboardingDraftWriter().saveDraft(
        transaction,
        validInput({ expectedRevision: 4 }),
      ),
    ).resolves.toEqual({ outcome: 'saved', revision: 5 });

    expect(transaction.calls).toHaveLength(4);
    expect(normalizeSql(transaction.calls[3].text)).toBe(
      "UPDATE backend_auth.player_onboarding_states SET revision = revision + 1, updated_at = GREATEST(updated_at, $3::bigint) WHERE account_id = $1::uuid AND status = 'in_progress' AND revision = $2::bigint RETURNING account_id, revision",
    );
    expect(transaction.calls[3].values).toEqual([ACCOUNT_ID, 4, NOW]);
    expect(transaction.calls[3].text).not.toMatch(
      /current_step|flow_version|survey_version|survey_answers|completed_at/u,
    );
  });

  it.each([
    ['expected an existing revision', 4, []],
    [
      'expected first run but state exists',
      null,
      [
        {
          account_id: ACCOUNT_ID,
          status: 'in_progress',
          revision: '4',
          updated_at: String(NOW),
        },
      ],
    ],
    [
      'revision is stale',
      3,
      [
        {
          account_id: ACCOUNT_ID,
          status: 'in_progress',
          revision: '4',
          updated_at: String(NOW),
        },
      ],
    ],
  ] as const)(
    'returns stale before any write when %s',
    async (_label, expectedRevision, rows) => {
      const transaction = new FakeTransaction([
        queryResult([{ account_id: ACCOUNT_ID }]),
        queryResult(rows),
      ]);
      await expect(
        new PostgresPlayerOnboardingDraftWriter().saveDraft(
          transaction,
          validInput({ expectedRevision }),
        ),
      ).resolves.toEqual({ outcome: 'stale_revision' });
      expect(transaction.calls).toHaveLength(2);
    },
  );

  it('rejects completed onboarding before any profile write', async () => {
    const transaction = new FakeTransaction([
      queryResult([{ account_id: ACCOUNT_ID }]),
      queryResult([
        {
          account_id: ACCOUNT_ID,
          status: 'completed',
          revision: '7',
          updated_at: String(NOW),
        },
      ]),
    ]);
    await expect(
      new PostgresPlayerOnboardingDraftWriter().saveDraft(
        transaction,
        validInput({ expectedRevision: 7 }),
      ),
    ).resolves.toEqual({ outcome: 'closed' });
    expect(transaction.calls).toHaveLength(2);
  });

  it('hides a missing owner and performs no state or profile mutation', async () => {
    const transaction = new FakeTransaction([queryResult([])]);
    await expect(
      new PostgresPlayerOnboardingDraftWriter().saveDraft(
        transaction,
        validInput(),
      ),
    ).resolves.toEqual({ outcome: 'not_found' });
    expect(transaction.calls).toHaveLength(1);
  });

  it('throws after a post-profile-write anomaly so the transaction cannot commit partially', async () => {
    const transaction = new FakeTransaction([
      queryResult([{ account_id: ACCOUNT_ID }]),
      queryResult([]),
      queryResult([{ account_id: ACCOUNT_ID }]),
      queryResult([]),
    ]);
    await expect(
      new PostgresPlayerOnboardingDraftWriter().saveDraft(
        transaction,
        validInput(),
      ),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
    expect(transaction.calls).toHaveLength(4);
  });

  it.each([
    { status: 'draft', revision: '1', updated_at: String(NOW) },
    { status: 'in_progress', revision: '0', updated_at: String(NOW) },
    { status: 'in_progress', revision: '1', updated_at: '-1' },
  ])('rejects malformed locked state before any write %#', async (state) => {
    const transaction = new FakeTransaction([
      queryResult([{ account_id: ACCOUNT_ID }]),
      queryResult([{ account_id: ACCOUNT_ID, ...state }]),
    ]);
    await expect(
      new PostgresPlayerOnboardingDraftWriter().saveDraft(
        transaction,
        validInput({ expectedRevision: 1 }),
      ),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
    expect(transaction.calls).toHaveLength(2);
  });

  it.each([
    null,
    {},
    validInput({ expectedRevision: 0 }),
    validInput({ firstName: ' Synthetic' }),
    validInput({ phone: '79990000000' }),
    validInput({ normalizedEmail: 'Player@Example.test' }),
    { ...validInput(), accountId: ACCOUNT_ID, verification: true },
  ])('rejects invalid or expanded input before SQL %#', async (input) => {
    const transaction = new FakeTransaction([]);
    await expect(
      new PostgresPlayerOnboardingDraftWriter().saveDraft(
        transaction,
        input as never,
      ),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(0);
  });

  it.each([
    ['42501', 'permission_denied'],
    ['40001', 'transaction_conflict'],
    ['40P01', 'transaction_conflict'],
    ['23505', 'transaction_conflict'],
    ['08006', 'database_unavailable'],
    ['57P01', 'database_unavailable'],
    ['57014', 'database_unavailable'],
    ['23514', 'storage_failure'],
  ] as const)('maps PostgreSQL %s to safe %s', async (code, reason) => {
    let caught: unknown;
    try {
      await new PostgresPlayerOnboardingDraftWriter().saveDraft(
        new FakeTransaction([postgresError(code)]),
        validInput(),
      );
    } catch (error) {
      caught = error;
    }
    expectSafeError(caught, reason);
  });
});
