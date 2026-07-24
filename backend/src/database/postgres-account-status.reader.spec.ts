import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  PostgresAccountStatusReader,
  PostgresAccountStatusReaderError,
  PostgresAccountStatusReaderFailure,
} from './postgres-account-status.reader';
import { PostgresTransaction } from './postgres-transaction';

const ACCOUNT_ID = deterministicUuid('account-status-reader') as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'account-status-reader-other',
) as AccountId;
const CREATED_AT = '1800000000';
const UPDATED_AT = '1800000010';

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
    command: 'SELECT',
    rowCount,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function accountRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    id: ACCOUNT_ID,
    role: 'player',
    status: 'active',
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

function postgresError(
  code: string,
  marker = 'postgres-account-status-secret',
): Record<string, unknown> {
  return {
    code,
    message: marker,
    detail: `${marker}-detail`,
    hint: `${marker}-hint`,
    where: `${marker}-where`,
    query: `SELECT '${marker}'`,
    parameters: [ACCOUNT_ID, marker],
    constraint: 'secret_constraint',
    schema: 'secret_schema',
    table: 'secret_table',
    column: 'secret_column',
    cause: new Error(`${marker}-cause`),
  };
}

function expectReaderError(
  error: unknown,
  reason: PostgresAccountStatusReaderFailure,
): PostgresAccountStatusReaderError {
  expect(error).toBeInstanceOf(PostgresAccountStatusReaderError);
  const safe = error as PostgresAccountStatusReaderError;
  expect(safe.reason).toBe(reason);
  return safe;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

describe('PostgresAccountStatusReader', () => {
  it.each([
    'not-a-uuid',
    123,
    null,
    {},
  ])('rejects invalid account ID %p before SQL', async (accountId) => {
    const transaction = new FakeTransaction([]);
    const reader = new PostgresAccountStatusReader();

    await expect(
      reader.findById(transaction, accountId as AccountId),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(0);
  });

  it('uses one static parameterized SELECT through the provided transaction', async () => {
    const transaction = new FakeTransaction([queryResult([])]);
    const reader = new PostgresAccountStatusReader();

    await reader.findById(transaction, ACCOUNT_ID);

    expect(transaction.calls).toHaveLength(1);
    const call = transaction.calls[0];
    expect(normalizeSql(call.text)).toBe(
      'SELECT id, role, status, created_at, updated_at FROM backend_auth.accounts WHERE id = $1',
    );
    expect(call.values).toEqual([ACCOUNT_ID]);
    expect(call.text).not.toContain(ACCOUNT_ID);
  });

  it('contains no lock, write SQL, limit, or transaction lifecycle command', async () => {
    const transaction = new FakeTransaction([queryResult([])]);
    await new PostgresAccountStatusReader().findById(
      transaction,
      ACCOUNT_ID,
    );

    const sql = normalizeSql(transaction.calls[0].text).toUpperCase();
    for (const forbidden of [
      'FOR UPDATE',
      'LIMIT ',
      'INSERT ',
      'UPDATE ',
      'DELETE ',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('returns not_found for zero rows', async () => {
    const reader = new PostgresAccountStatusReader();
    await expect(
      reader.findById(new FakeTransaction([queryResult([])]), ACCOUNT_ID),
    ).resolves.toEqual({ outcome: 'not_found' });
  });

  it.each([
    ['active player', 'player', 'active'],
    ['blocked player', 'player', 'blocked'],
    ['pending-deletion player', 'player', 'pending_deletion'],
    ['anonymized player', 'player', 'anonymized'],
    ['active club admin', 'club_admin', 'active'],
  ] as const)('hydrates %s', async (_name, role, status) => {
    const reader = new PostgresAccountStatusReader();
    await expect(
      reader.findById(
        new FakeTransaction([
          queryResult([accountRow({ role, status })]),
        ]),
        ACCOUNT_ID,
      ),
    ).resolves.toEqual({
      outcome: 'found',
      accountId: ACCOUNT_ID,
      role,
      status,
    });
  });

  it.each([
    ['malformed UUID', { id: 'not-a-uuid' }],
    ['different UUID', { id: OTHER_ACCOUNT_ID }],
    ['unknown role', { role: 'owner' }],
    ['unknown status', { status: 'deleted' }],
    ['numeric created_at', { created_at: 1_800_000_000 }],
    ['non-canonical created_at', { created_at: '01' }],
    ['negative created_at', { created_at: '-1' }],
    ['malformed updated_at', { updated_at: 'not-bigint' }],
    ['unsafe updated_at', { updated_at: '9007199254740992' }],
    [
      'updated before created',
      { created_at: UPDATED_AT, updated_at: CREATED_AT },
    ],
  ] as const)('rejects persisted row with %s', async (_name, overrides) => {
    const transaction = new FakeTransaction([
      queryResult([accountRow({ ...overrides })]),
    ]);

    await expect(
      new PostgresAccountStatusReader().findById(
        transaction,
        ACCOUNT_ID,
      ),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });

  it('rejects more than one row as invalid persisted state', async () => {
    const transaction = new FakeTransaction([
      queryResult([accountRow(), accountRow()]),
    ]);

    await expect(
      new PostgresAccountStatusReader().findById(
        transaction,
        ACCOUNT_ID,
      ),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });

  it('rejects inconsistent PostgreSQL rowCount', async () => {
    const transaction = new FakeTransaction([
      queryResult([accountRow()], 0),
    ]);

    await expect(
      new PostgresAccountStatusReader().findById(
        transaction,
        ACCOUNT_ID,
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
    ['99999', 'storage_failure'],
  ] as const)('maps SQLSTATE %s to %s', async (code, reason) => {
    const transaction = new FakeTransaction([postgresError(code)]);

    await expect(
      new PostgresAccountStatusReader().findById(
        transaction,
        ACCOUNT_ID,
      ),
    ).rejects.toMatchObject({ reason });
  });

  it('maps an ordinary Error to storage_failure', async () => {
    const transaction = new FakeTransaction([
      new Error('ordinary account status secret'),
    ]);

    await expect(
      new PostgresAccountStatusReader().findById(
        transaction,
        ACCOUNT_ID,
      ),
    ).rejects.toMatchObject({ reason: 'storage_failure' });
  });

  it('does not return timestamps or the raw row', async () => {
    const transaction = new FakeTransaction([
      queryResult([accountRow({ storage_marker: 'raw-row-secret' })]),
    ]);

    const result = await new PostgresAccountStatusReader().findById(
      transaction,
      ACCOUNT_ID,
    );
    expect(Object.keys(result)).toEqual([
      'outcome',
      'accountId',
      'role',
      'status',
    ]);
    expect(JSON.stringify(result)).not.toContain(CREATED_AT);
    expect(JSON.stringify(result)).not.toContain('raw-row-secret');
  });

  it('creates a new safe error without PostgreSQL data or account ID', async () => {
    const marker = 'unique-postgres-account-status-leak-marker';
    const raw = postgresError('42501', marker);
    const transaction = new FakeTransaction([raw]);

    let caught: unknown;
    try {
      await new PostgresAccountStatusReader().findById(
        transaction,
        ACCOUNT_ID,
      );
    } catch (error) {
      caught = error;
    }

    const safe = expectReaderError(caught, 'permission_denied');
    expect(safe).not.toBe(raw);
    expect(Object.getOwnPropertyNames(safe).sort()).toEqual(
      ['message', 'name', 'reason', 'stack'].sort(),
    );
    expect('cause' in safe).toBe(false);
    const serialized = JSON.stringify({
      own: Object.getOwnPropertyNames(safe).map((key) => [
        key,
        (safe as unknown as Record<string, unknown>)[key],
      ]),
      json: safe,
    });
    for (const forbidden of [
      marker,
      ACCOUNT_ID,
      'secret_constraint',
      'secret_schema',
      'secret_table',
      'secret_column',
    ]) {
      expect(safe.message).not.toContain(forbidden);
      expect(safe.stack).not.toContain(forbidden);
      expect(serialized).not.toContain(forbidden);
    }
  });
});
