import { inspect } from 'node:util';
import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  PlayerProfileDetailsPersistenceError,
  PlayerProfileDetailsPersistenceFailure,
} from './player-profile-details.repository';
import { PostgresPlayerProfileDetailsRepository } from './postgres-player-profile-details.repository';
import { PostgresTransaction } from './postgres-transaction';

const ACCOUNT_ID = deterministicUuid(
  'player-profile-details-account',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-profile-details-other',
) as AccountId;
const OBSERVED_AT = unixEpochSeconds(1_800_000_100);
const CREDENTIAL_MARKER = 'synthetic-credential-must-not-reach-writer';
const INIT_DATA_MARKER = 'synthetic-init-data-must-not-reach-writer';

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
    command: 'INSERT',
    rowCount,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT_ID,
    profile: {
      firstName: 'First',
      lastName: 'Last',
      username: 'verified_player',
      languageCode: 'ru',
      photoUrl: 'https://example.test/avatar.svg',
    },
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

function postgresError(
  code: string,
  marker = 'player-profile-details-postgres-secret',
): Record<string, unknown> {
  return {
    code,
    message: marker,
    detail: `${marker}-detail`,
    hint: `${marker}-hint`,
    where: `${marker}-where`,
    query: `INSERT '${marker}'`,
    parameters: [ACCOUNT_ID, marker],
    constraint: 'secret_constraint',
    schema: 'secret_schema',
    table: 'secret_table',
    column: 'secret_column',
    cause: new Error(`${marker}-cause`),
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

function expectPersistenceError(
  error: unknown,
  reason: PlayerProfileDetailsPersistenceFailure,
): PlayerProfileDetailsPersistenceError {
  expect(error).toBeInstanceOf(PlayerProfileDetailsPersistenceError);
  const safe = error as PlayerProfileDetailsPersistenceError;
  expect(safe.reason).toBe(reason);
  return safe;
}

describe('PostgresPlayerProfileDetailsRepository', () => {
  it('uses one static parameterized insert through the provided transaction', async () => {
    const transaction = new FakeTransaction([
      queryResult([{ account_id: ACCOUNT_ID }]),
    ]);

    await new PostgresPlayerProfileDetailsRepository().createIfAbsent(
      transaction,
      input(),
    );

    expect(transaction.calls).toHaveLength(1);
    const call = transaction.calls[0];
    expect(normalizeSql(call.text)).toBe(
      'INSERT INTO backend_auth.player_profile_details ( account_id, first_name, last_name, username, photo_url, language_code, created_at, updated_at ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT (account_id) DO NOTHING RETURNING account_id',
    );
    expect(call.values).toEqual([
      ACCOUNT_ID,
      'First',
      'Last',
      'verified_player',
      'https://example.test/avatar.svg',
      'ru',
      String(OBSERVED_AT),
    ]);
    expect(call.text).not.toContain(ACCOUNT_ID);
    expect(call.text).not.toContain('First');
  });

  it('does not contain update, delete, dynamic identifiers, or transaction lifecycle SQL', async () => {
    const transaction = new FakeTransaction([queryResult([])]);
    await new PostgresPlayerProfileDetailsRepository().createIfAbsent(
      transaction,
      input(),
    );

    const sql = normalizeSql(transaction.calls[0].text).toUpperCase();
    expect(sql).toContain('ON CONFLICT (ACCOUNT_ID) DO NOTHING');
    expect(sql).not.toContain('DO UPDATE');
    for (const forbidden of [
      'UPDATE BACKEND_AUTH',
      'DELETE ',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
      'PUBLIC.',
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it('returns created only for the expected returned account ID', async () => {
    await expect(
      new PostgresPlayerProfileDetailsRepository().createIfAbsent(
        new FakeTransaction([
          queryResult([{ account_id: ACCOUNT_ID }]),
        ]),
        input(),
      ),
    ).resolves.toEqual({
      outcome: 'created',
      accountId: ACCOUNT_ID,
    });
  });

  it('returns existing when ON CONFLICT inserts no row', async () => {
    await expect(
      new PostgresPlayerProfileDetailsRepository().createIfAbsent(
        new FakeTransaction([queryResult([], 0)]),
        input(),
      ),
    ).resolves.toEqual({
      outcome: 'existing',
      accountId: ACCOUNT_ID,
    });
  });

  it('writes null for every absent optional profile field', async () => {
    const transaction = new FakeTransaction([
      queryResult([{ account_id: ACCOUNT_ID }]),
    ]);

    await new PostgresPlayerProfileDetailsRepository().createIfAbsent(
      transaction,
      input({ profile: { firstName: 'Required only' } }),
    );

    expect(transaction.calls[0].values).toEqual([
      ACCOUNT_ID,
      'Required only',
      null,
      null,
      null,
      null,
      String(OBSERVED_AT),
    ]);
  });

  it.each([
    ['malformed account ID', { accountId: 'not-a-uuid' }],
    ['malformed timestamp', { observedAt: -1 }],
    ['missing first name', { profile: {} }],
    ['empty first name', { profile: { firstName: '' } }],
    ['empty optional field', { profile: { firstName: 'First', lastName: '' } }],
    [
      'too long username',
      { profile: { firstName: 'First', username: 'u'.repeat(65) } },
    ],
    [
      'non-HTTPS photo URL',
      { profile: { firstName: 'First', photoUrl: 'http://example.test/a' } },
    ],
    [
      'extra profile field',
      { profile: { firstName: 'First', telegramId: 123 } },
    ],
    ['extra input field', { unexpected: true }],
  ] as const)('rejects %s before SQL', async (_name, overrides) => {
    const transaction = new FakeTransaction([]);

    await expect(
      new PostgresPlayerProfileDetailsRepository().createIfAbsent(
        transaction,
        input(overrides),
      ),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(0);
  });

  it.each([
    ['different returned account', [{ account_id: OTHER_ACCOUNT_ID }], 1],
    ['malformed returned account', [{ account_id: 'not-a-uuid' }], 1],
    ['missing returned account', [{}], 1],
    [
      'multiple returned rows',
      [{ account_id: ACCOUNT_ID }, { account_id: ACCOUNT_ID }],
      2,
    ],
    ['inconsistent row count', [{ account_id: ACCOUNT_ID }], 0],
    ['null row count', [{ account_id: ACCOUNT_ID }], null],
  ] as const)(
    'rejects %s as invalid persisted state',
    async (_name, rows, rowCount) => {
      await expect(
        new PostgresPlayerProfileDetailsRepository().createIfAbsent(
          new FakeTransaction([queryResult(rows, rowCount)]),
          input(),
        ),
      ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
    },
  );

  it.each([
    ['23503', 'referential_integrity'],
    ['23514', 'invalid_input'],
    ['23502', 'invalid_input'],
    ['22P02', 'invalid_input'],
    ['42501', 'permission_denied'],
    ['40001', 'transaction_conflict'],
    ['40P01', 'transaction_conflict'],
    ['08006', 'database_unavailable'],
    ['57P01', 'database_unavailable'],
    ['57014', 'database_unavailable'],
    ['23505', 'storage_failure'],
    ['99999', 'storage_failure'],
  ] as const)('maps SQLSTATE %s to %s', async (code, reason) => {
    await expect(
      new PostgresPlayerProfileDetailsRepository().createIfAbsent(
        new FakeTransaction([postgresError(code)]),
        input(),
      ),
    ).rejects.toMatchObject({ reason });
  });

  it('does not leak PostgreSQL details through its safe error', async () => {
    const marker = 'unique-player-profile-details-leak-marker';
    const raw = postgresError('42501', marker);
    let caught: unknown;

    try {
      await new PostgresPlayerProfileDetailsRepository().createIfAbsent(
        new FakeTransaction([raw]),
        input(),
      );
    } catch (error) {
      caught = error;
    }

    const safe = expectPersistenceError(caught, 'permission_denied');
    expect(safe).not.toBe(raw);
    expect(Object.getOwnPropertyNames(safe).sort()).toEqual(
      ['message', 'name', 'reason', 'stack'].sort(),
    );
    expect('cause' in safe).toBe(false);
    const serialized = inspect({
      own: Object.getOwnPropertyNames(safe).map((key) => [
        key,
        (safe as unknown as Record<string, unknown>)[key],
      ]),
      json: JSON.stringify(safe),
    });
    for (const forbidden of [
      marker,
      ACCOUNT_ID,
      'secret_constraint',
      'secret_schema',
      'secret_table',
      'secret_column',
      CREDENTIAL_MARKER,
      INIT_DATA_MARKER,
    ]) {
      expect(safe.message).not.toContain(forbidden);
      expect(safe.stack).not.toContain(forbidden);
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('never receives or persists credential and initData markers', async () => {
    const transaction = new FakeTransaction([
      queryResult([{ account_id: ACCOUNT_ID }]),
    ]);
    const result =
      await new PostgresPlayerProfileDetailsRepository().createIfAbsent(
        transaction,
        input(),
      );

    const persistenceBoundary = inspect({
      calls: transaction.calls,
      result,
    });
    expect(persistenceBoundary).not.toContain(CREDENTIAL_MARKER);
    expect(persistenceBoundary).not.toContain(INIT_DATA_MARKER);
  });
});
