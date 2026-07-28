import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { PostgresTransaction } from './postgres-transaction';
import {
  PlayerProfileWritePersistenceError,
  PlayerProfileWritePersistenceFailure,
} from './player-profile-writer';
import { PostgresPlayerProfileWriter } from './postgres-player-profile-writer';

const ACCOUNT_ID = deterministicUuid(
  'player-profile-writer-account',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_PLAYER_PROFILE_WRITER_PRIVATE';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

type QueuedQuery =
  | QueryResult<QueryResultRow>
  | Error
  | Record<string, unknown>;

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
    command: 'UPDATE',
    rowCount,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

function postgresError(code: string): Record<string, unknown> {
  return {
    code,
    message: PRIVATE_MARKER,
    detail: `${PRIVATE_MARKER}-detail`,
    query: `UPDATE '${PRIVATE_MARKER}'`,
    constraint: 'private_constraint',
    schema: 'private_schema',
    table: 'private_table',
    cause: new Error(`${PRIVATE_MARKER}-cause`),
  };
}

function expectSafeError(
  value: unknown,
  reason: PlayerProfileWritePersistenceFailure,
): void {
  expect(value).toBeInstanceOf(PlayerProfileWritePersistenceError);
  const error = value as PlayerProfileWritePersistenceError;
  expect(error.reason).toBe(reason);
  expect(error.message).toBe('Player profile write persistence failed');
  expect('cause' in error).toBe(false);
  const output = `${JSON.stringify(error)} ${String(error.stack)}`;
  expect(output).not.toContain(PRIVATE_MARKER);
  expect(output).not.toContain('private_constraint');
  expect(output).not.toContain('private_schema');
  expect(output).not.toContain('private_table');
}

describe('PostgresPlayerProfileWriter', () => {
  it('updates only allowlisted columns using one static parameterized statement', async () => {
    const transaction = new FakeTransaction([
      queryResult([{ account_id: ACCOUNT_ID }]),
    ]);

    await expect(
      new PostgresPlayerProfileWriter().updateByAccountId(transaction, {
        accountId: ACCOUNT_ID,
        changes: {
          firstName: 'Updated',
          lastName: null,
          phone: '+79990000000',
          sidePreference: 'Left',
        },
        updatedAt: NOW,
      }),
    ).resolves.toEqual({ outcome: 'updated' });

    expect(transaction.calls).toHaveLength(1);
    const call = transaction.calls[0];
    expect(normalizeSql(call.text)).toBe(
      'UPDATE backend_auth.player_profile_details SET first_name = CASE WHEN $2::boolean THEN $3::text ELSE first_name END, last_name = CASE WHEN $4::boolean THEN $5::text ELSE last_name END, phone = CASE WHEN $6::boolean THEN $7::text ELSE phone END, side_preference = CASE WHEN $8::boolean THEN $9::text ELSE side_preference END, updated_at = $10::bigint WHERE account_id = $1::uuid RETURNING account_id',
    );
    expect(call.values).toEqual([
      ACCOUNT_ID,
      true,
      'Updated',
      true,
      null,
      true,
      '+79990000000',
      true,
      'Left',
      NOW,
    ]);
    expect(call.text).not.toContain('public.');
  });

  it('preserves omitted values and can clear nullable values', async () => {
    const transaction = new FakeTransaction([
      queryResult([{ account_id: ACCOUNT_ID }]),
    ]);

    await new PostgresPlayerProfileWriter().updateByAccountId(
      transaction,
      {
        accountId: ACCOUNT_ID,
        changes: { phone: null },
        updatedAt: NOW,
      },
    );

    expect(transaction.calls[0].values).toEqual([
      ACCOUNT_ID,
      false,
      null,
      false,
      null,
      true,
      null,
      false,
      null,
      NOW,
    ]);
  });

  it('returns not_found without exposing an account identifier', async () => {
    const result = await new PostgresPlayerProfileWriter().updateByAccountId(
      new FakeTransaction([queryResult([])]),
      {
        accountId: ACCOUNT_ID,
        changes: { firstName: 'Updated' },
        updatedAt: NOW,
      },
    );
    expect(result).toEqual({ outcome: 'not_found' });
    expect(JSON.stringify(result)).not.toContain(ACCOUNT_ID);
  });

  it.each([
    null,
    {},
    {
      accountId: ACCOUNT_ID,
      changes: {},
      updatedAt: NOW,
    },
    {
      accountId: ACCOUNT_ID,
      changes: { firstName: '' },
      updatedAt: NOW,
    },
    {
      accountId: ACCOUNT_ID,
      changes: { phone: '79990000000' },
      updatedAt: NOW,
    },
    {
      accountId: ACCOUNT_ID,
      changes: { sidePreference: 'Center' },
      updatedAt: NOW,
    },
    {
      accountId: ACCOUNT_ID,
      changes: { username: PRIVATE_MARKER },
      updatedAt: NOW,
    },
  ])('rejects invalid input before SQL %#', async (input) => {
    const transaction = new FakeTransaction([]);
    await expect(
      new PostgresPlayerProfileWriter().updateByAccountId(
        transaction,
        input as never,
      ),
    ).rejects.toMatchObject({
      name: 'PlayerProfileWritePersistenceError',
      reason: 'invalid_input',
    });
    expect(transaction.calls).toHaveLength(0);
  });

  it.each([
    [queryResult([{ account_id: ACCOUNT_ID }], 0)],
    [queryResult([{ account_id: 'wrong' }])],
    [queryResult([{ account_id: ACCOUNT_ID }, { account_id: ACCOUNT_ID }], 2)],
  ])('rejects inconsistent UPDATE cardinality', async (updated) => {
    await expect(
      new PostgresPlayerProfileWriter().updateByAccountId(
        new FakeTransaction([updated]),
        {
          accountId: ACCOUNT_ID,
          changes: { firstName: 'Updated' },
          updatedAt: NOW,
        },
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
    ['23514', 'storage_failure'],
  ] as const)('maps PostgreSQL %s to %s safely', async (code, reason) => {
    try {
      await new PostgresPlayerProfileWriter().updateByAccountId(
        new FakeTransaction([postgresError(code)]),
        {
          accountId: ACCOUNT_ID,
          changes: { firstName: 'Updated' },
          updatedAt: NOW,
        },
      );
      throw new Error('Expected repository failure');
    } catch (error) {
      expectSafeError(error, reason);
    }
  });
});
