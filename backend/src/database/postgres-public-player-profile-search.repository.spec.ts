import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { PostgresPublicPlayerProfileSearchRepository } from './postgres-public-player-profile-search.repository';
import { PostgresTransaction } from './postgres-transaction';
import {
  PublicPlayerProfileSearchPersistenceError,
  PublicPlayerProfileSearchPersistenceFailure,
} from './public-player-profile-search.repository';

const PLAYER_ID = deterministicUuid(
  'public-player-profile-search-player',
) as AccountId;
const OTHER_PLAYER_ID = deterministicUuid(
  'public-player-profile-search-other',
) as AccountId;
const PRIVATE_MARKER =
  'SYNTHETIC_PUBLIC_PLAYER_PROFILE_SEARCH_PRIVATE';

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

function playerRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    account_id: PLAYER_ID,
    first_name: 'Synthetic',
    last_name: 'Player',
    username: 'synthetic_player',
    rating: '3.00',
    is_verified: false,
    ...overrides,
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
    query: `SELECT '${PRIVATE_MARKER}'`,
    constraint: 'private_constraint',
    schema: 'private_schema',
    table: 'private_table',
    cause: new Error(`${PRIVATE_MARKER}-cause`),
  };
}

function expectSafeError(
  value: unknown,
  reason: PublicPlayerProfileSearchPersistenceFailure,
): PublicPlayerProfileSearchPersistenceError {
  expect(value).toBeInstanceOf(
    PublicPlayerProfileSearchPersistenceError,
  );
  const error =
    value as PublicPlayerProfileSearchPersistenceError;
  expect(error.reason).toBe(reason);
  expect(error.message).toBe(
    'Public player profile search persistence failed',
  );
  expect('cause' in error).toBe(false);
  const serialized = JSON.stringify(error);
  const inspected = String(error.stack);
  for (const marker of [
    PRIVATE_MARKER,
    'private_constraint',
    'private_schema',
    'private_table',
  ]) {
    expect(error.message).not.toContain(marker);
    expect(inspected).not.toContain(marker);
    expect(serialized).not.toContain(marker);
  }
  return error;
}

describe('PostgresPublicPlayerProfileSearchRepository', () => {
  it('returns an exact frozen public player allowlist', async () => {
    const transaction = new FakeTransaction([
      queryResult([
        playerRow(),
        playerRow({
          account_id: OTHER_PLAYER_ID,
          last_name: null,
          username: null,
          rating: '0.00',
          is_verified: true,
        }),
      ]),
    ]);

    const result =
      await new PostgresPublicPlayerProfileSearchRepository().search(
        transaction,
        { query: 'Synthetic', limit: 8 },
      );

    expect(result).toEqual({
      outcome: 'found',
      players: [
        {
          playerId: PLAYER_ID,
          firstName: 'Synthetic',
          lastName: 'Player',
          username: 'synthetic_player',
          rating: 3,
          isVerified: false,
        },
        {
          playerId: OTHER_PLAYER_ID,
          firstName: 'Synthetic',
          rating: 0,
          isVerified: true,
        },
      ],
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.players)).toBe(true);
    expect(result.players.every(Object.isFrozen)).toBe(true);
    expect(Object.keys(result.players[0]).sort()).toEqual(
      [
        'playerId',
        'firstName',
        'lastName',
        'username',
        'rating',
        'isVerified',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('phone');
    expect(JSON.stringify(result)).not.toContain('photoUrl');
    expect(JSON.stringify(result)).not.toContain('languageCode');
  });

  it('batch-reads the same public allowlist without private fields', async () => {
    const transaction = new FakeTransaction([
      queryResult([
        playerRow(),
        playerRow({
          account_id: OTHER_PLAYER_ID,
          first_name: 'Other',
          last_name: null,
          username: null,
          rating: '4.25',
          is_verified: true,
        }),
      ]),
    ]);

    const result =
      await new PostgresPublicPlayerProfileSearchRepository()
        .findByPlayerIds(transaction, {
          playerIds: [PLAYER_ID, OTHER_PLAYER_ID],
        });

    expect(result).toEqual({
      outcome: 'found',
      players: [
        {
          playerId: PLAYER_ID,
          firstName: 'Synthetic',
          lastName: 'Player',
          username: 'synthetic_player',
          rating: 3,
          isVerified: false,
        },
        {
          playerId: OTHER_PLAYER_ID,
          firstName: 'Other',
          rating: 4.25,
          isVerified: true,
        },
      ],
    });
    expect(transaction.calls).toHaveLength(1);
    expect(transaction.calls[0].values).toEqual([
      [PLAYER_ID, OTHER_PLAYER_ID],
    ]);
    const sql = normalizeSql(transaction.calls[0].text);
    expect(sql).toContain(
      'accounts.id = ANY ($1::uuid[])',
    );
    expect(sql).not.toContain('phone');
    expect(sql).not.toContain('photo_url');
    expect(sql).not.toContain('language_code');
    expect(JSON.stringify(result)).not.toContain(PRIVATE_MARKER);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.players)).toBe(true);
    expect(result.players.every(Object.isFrozen)).toBe(true);
  });

  it.each([
    { playerIds: [] },
    { playerIds: [PLAYER_ID, PLAYER_ID] },
    { playerIds: ['invalid'] },
    { playerIds: Array.from({ length: 201 }, () => PLAYER_ID) },
    { playerIds: [PLAYER_ID], extra: true },
  ])('rejects invalid batch input before SQL: %p', async (input) => {
    const transaction = new FakeTransaction([]);

    await expect(
      new PostgresPublicPlayerProfileSearchRepository()
        .findByPlayerIds(transaction, input as never),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(0);
  });

  it('uses one static parameterized backend_auth-only query', async () => {
    const transaction = new FakeTransaction([queryResult([])]);

    await new PostgresPublicPlayerProfileSearchRepository().search(
      transaction,
      { query: '100%_\\player', limit: 20 },
    );

    expect(transaction.calls).toHaveLength(1);
    const call = transaction.calls[0];
    expect(call.values).toEqual(['%100\\%\\_\\\\player%', 20]);
    expect(normalizeSql(call.text)).toBe(
      "SELECT details.account_id, details.first_name, details.last_name, details.username, rating_states.rating, rating_states.is_verified FROM backend_auth.accounts AS accounts JOIN backend_auth.player_profiles AS profiles ON profiles.account_id = accounts.id JOIN backend_auth.player_profile_details AS details ON details.account_id = profiles.account_id JOIN backend_auth.player_rating_states AS rating_states ON rating_states.account_id = profiles.account_id WHERE accounts.role = 'player' AND accounts.status = 'active' AND ( details.first_name ILIKE $1 ESCAPE E'\\\\' OR details.last_name ILIKE $1 ESCAPE E'\\\\' OR details.username ILIKE $1 ESCAPE E'\\\\' OR pg_catalog.concat_ws( ' ', details.first_name, details.last_name ) ILIKE $1 ESCAPE E'\\\\' ) ORDER BY pg_catalog.lower(details.first_name), pg_catalog.lower(pg_catalog.coalesce(details.last_name, '')), details.account_id LIMIT $2::integer",
    );
    const upperSql = normalizeSql(call.text).toUpperCase();
    for (const forbidden of [
      ' PUBLIC.',
      ' AUTH.',
      'INSERT ',
      'UPDATE ',
      'DELETE ',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
    ]) {
      expect(` ${upperSql}`).not.toContain(forbidden);
    }
    expect(call.text).not.toContain('100%');
  });

  it('returns a frozen empty result when no player matches', async () => {
    const result =
      await new PostgresPublicPlayerProfileSearchRepository().search(
        new FakeTransaction([queryResult([])]),
        { query: 'Nobody', limit: 8 },
      );

    expect(result).toEqual({ outcome: 'found', players: [] });
    expect(Object.isFrozen(result.players)).toBe(true);
  });

  it.each([
    ['invalid id', { account_id: 'invalid' }],
    ['empty first name', { first_name: '' }],
    ['overlong first name', { first_name: 'a'.repeat(257) }],
    ['empty optional name', { last_name: '' }],
    ['overlong username', { username: 'u'.repeat(65) }],
    ['missing rating', { rating: null }],
    ['invalid rating scale', { rating: '3.001' }],
    ['out-of-range rating', { rating: '10.01' }],
    ['invalid verification', { is_verified: 'false' }],
  ])('rejects invalid persisted state: %s', async (_label, patch) => {
    await expect(
      new PostgresPublicPlayerProfileSearchRepository().search(
        new FakeTransaction([
          queryResult([playerRow(patch)]),
        ]),
        { query: 'Player', limit: 8 },
      ),
    ).rejects.toMatchObject({
      name: 'PublicPlayerProfileSearchPersistenceError',
      reason: 'invalid_persisted_state',
    });
  });

  it('rejects duplicate player identities and invalid cardinality', async () => {
    await expect(
      new PostgresPublicPlayerProfileSearchRepository().search(
        new FakeTransaction([
          queryResult([playerRow(), playerRow()]),
        ]),
        { query: 'Player', limit: 8 },
      ),
    ).rejects.toMatchObject({
      reason: 'invalid_persisted_state',
    });

    await expect(
      new PostgresPublicPlayerProfileSearchRepository().search(
        new FakeTransaction([queryResult([playerRow()], 0)]),
        { query: 'Player', limit: 8 },
      ),
    ).rejects.toMatchObject({
      reason: 'invalid_persisted_state',
    });
  });

  it('rejects a result exceeding the requested limit', async () => {
    await expect(
      new PostgresPublicPlayerProfileSearchRepository().search(
        new FakeTransaction([
          queryResult([
            playerRow(),
            playerRow({ account_id: OTHER_PLAYER_ID }),
          ]),
        ]),
        { query: 'Player', limit: 1 },
      ),
    ).rejects.toMatchObject({
      reason: 'invalid_persisted_state',
    });
  });

  it.each([
    null,
    {},
    { query: 'A', limit: 8 },
    { query: ' Player', limit: 8 },
    { query: 'Ｐlayer', limit: 8 },
    { query: `Pl${String.fromCharCode(0)}ayer`, limit: 8 },
    { query: 'Player', limit: 0 },
    { query: 'Player', limit: 21 },
    { query: 'Player', limit: 8, extra: true },
  ])('fails closed before SQL for invalid input %p', async (input) => {
    const transaction = new FakeTransaction([]);
    await expect(
      new PostgresPublicPlayerProfileSearchRepository().search(
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
    ['08006', 'database_unavailable'],
    ['57P01', 'database_unavailable'],
    ['57014', 'database_unavailable'],
    ['23514', 'storage_failure'],
  ] as const)(
    'maps PostgreSQL %s to %s without database detail leakage',
    async (code, reason) => {
      try {
        await new PostgresPublicPlayerProfileSearchRepository().search(
          new FakeTransaction([postgresError(code)]),
          { query: 'Player', limit: 8 },
        );
        throw new Error('Expected repository failure');
      } catch (error) {
        expectSafeError(error, reason);
      }
    },
  );

  it('maps non-PostgreSQL errors to a fixed storage failure', async () => {
    try {
      await new PostgresPublicPlayerProfileSearchRepository().search(
        new FakeTransaction([new Error(PRIVATE_MARKER)]),
        { query: 'Player', limit: 8 },
      );
      throw new Error('Expected repository failure');
    } catch (error) {
      expectSafeError(error, 'storage_failure');
    }
  });
});
