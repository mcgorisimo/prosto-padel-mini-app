import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  PlayerProfileReadPersistenceError,
  PlayerProfileReadPersistenceFailure,
} from './player-profile-reader';
import { PostgresPlayerProfileReader } from './postgres-player-profile-reader';
import { PostgresTransaction } from './postgres-transaction';
import { PlayerProfilePhotoUrlResolver } from '../config/player-profile-photo.config';

const ACCOUNT_ID = deterministicUuid(
  'player-profile-reader-account',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'player-profile-reader-other-account',
) as AccountId;
const PHOTO_ASSET_ID = deterministicUuid(
  'player-profile-reader-photo-asset',
);
const PRIVATE_MARKER = 'SYNTHETIC_PLAYER_PROFILE_READER_PRIVATE';

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

function profileRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    account_id: ACCOUNT_ID,
    first_name: 'Synthetic',
    last_name: 'Player',
    username: 'synthetic_player',
    photo_url: 'https://example.test/avatar.svg',
    photo_state_account_id: null,
    photo_state_active_asset_id: null,
    photo_state_version: null,
    photo_asset_account_id: null,
    photo_asset_id: null,
    photo_asset_generation: null,
    photo_storage_prefix: null,
    language_code: 'ru',
    phone: '+79990000000',
    side_preference: 'Right',
    rating: '3.00',
    is_verified: false,
    has_club_admin_capability: false,
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
  reason: PlayerProfileReadPersistenceFailure,
): PlayerProfileReadPersistenceError {
  expect(value).toBeInstanceOf(PlayerProfileReadPersistenceError);
  const error = value as PlayerProfileReadPersistenceError;
  expect(error.reason).toBe(reason);
  expect(error.message).toBe('Player profile read persistence failed');
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

describe('PostgresPlayerProfileReader', () => {
  it('returns an exact allowlisted profile for the authenticated account', async () => {
    const transaction = new FakeTransaction([
      queryResult([profileRow()]),
    ]);

    const result = await new PostgresPlayerProfileReader().findByAccountId(
      transaction,
      { accountId: ACCOUNT_ID },
    );

    expect(result).toEqual({
      outcome: 'found',
      profile: {
        accountId: ACCOUNT_ID,
        firstName: 'Synthetic',
        lastName: 'Player',
        username: 'synthetic_player',
        photoUrl: 'https://example.test/avatar.svg',
        languageCode: 'ru',
        phone: '+79990000000',
        sidePreference: 'Right',
        rating: 3,
        isVerified: false,
        capabilities: [],
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.outcome === 'found') {
      expect(Object.isFrozen(result.profile)).toBe(true);
      expect(Object.keys(result.profile).sort()).toEqual(
        [
          'accountId',
          'firstName',
          'languageCode',
          'lastName',
          'photoUrl',
          'phone',
          'rating',
          'sidePreference',
          'username',
          'isVerified',
          'capabilities',
        ].sort(),
      );
    }
  });

  it('uses one static parameterized read in backend_auth', async () => {
    const transaction = new FakeTransaction([
      queryResult([profileRow()]),
    ]);

    await new PostgresPlayerProfileReader().findByAccountId(transaction, {
      accountId: ACCOUNT_ID,
    });

    expect(transaction.calls).toHaveLength(1);
    const call = transaction.calls[0];
    expect(normalizeSql(call.text)).toBe(
      "SELECT details.account_id, details.first_name, details.last_name, details.username, details.photo_url, photo_states.account_id AS photo_state_account_id, photo_states.active_asset_id AS photo_state_active_asset_id, photo_states.version AS photo_state_version, photo_assets.account_id AS photo_asset_account_id, photo_assets.asset_id AS photo_asset_id, photo_assets.generation AS photo_asset_generation, photo_assets.storage_prefix AS photo_storage_prefix, details.language_code, details.phone, details.side_preference, rating_states.rating, rating_states.is_verified, COALESCE(( SELECT capability_events.event_type = 'granted' FROM backend_auth.admin_capability_events AS capability_events WHERE capability_events.account_id = details.account_id AND capability_events.capability = 'club_admin' ORDER BY capability_events.event_order DESC LIMIT 1 ), false) AS has_club_admin_capability FROM backend_auth.player_profile_details AS details LEFT JOIN backend_auth.player_rating_states AS rating_states ON rating_states.account_id = details.account_id LEFT JOIN backend_auth.player_profile_photo_states AS photo_states ON photo_states.account_id = details.account_id LEFT JOIN backend_auth.player_profile_photo_assets AS photo_assets ON photo_assets.account_id = photo_states.account_id AND photo_assets.generation = photo_states.version AND photo_assets.asset_id = photo_states.active_asset_id WHERE details.account_id = $1",
    );
    expect(call.values).toEqual([ACCOUNT_ID]);
    const upperSql = normalizeSql(call.text).toUpperCase();
    for (const forbidden of [
      'INSERT ',
      'UPDATE ',
      'DELETE ',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
    ]) {
      expect(upperSql).not.toContain(forbidden);
    }
  });

  it('maps an absent row to not_found', async () => {
    const result = await new PostgresPlayerProfileReader().findByAccountId(
      new FakeTransaction([queryResult([])]),
      { accountId: ACCOUNT_ID },
    );
    expect(result).toEqual({ outcome: 'not_found' });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('omits optional fields persisted as null', async () => {
    const result = await new PostgresPlayerProfileReader().findByAccountId(
      new FakeTransaction([
        queryResult([
          profileRow({
            last_name: null,
            username: null,
            photo_url: null,
            language_code: null,
            phone: null,
            side_preference: null,
          }),
        ]),
      ]),
      { accountId: ACCOUNT_ID },
    );

    expect(result).toEqual({
      outcome: 'found',
      profile: {
        accountId: ACCOUNT_ID,
        firstName: 'Synthetic',
        rating: 3,
        isVerified: false,
        capabilities: [],
      },
    });
  });

  it('uses the account-owned custom photo instead of the Telegram fallback', async () => {
    const storagePrefix =
      `profile-photos/${ACCOUNT_ID}/2/${PHOTO_ASSET_ID}`;
    const result = await new PostgresPlayerProfileReader(
      new PlayerProfilePhotoUrlResolver('https://photos.example.test'),
    ).findByAccountId(
      new FakeTransaction([
        queryResult([
          profileRow({
            photo_state_account_id: ACCOUNT_ID,
            photo_state_active_asset_id: PHOTO_ASSET_ID,
            photo_state_version: '2',
            photo_asset_account_id: ACCOUNT_ID,
            photo_asset_id: PHOTO_ASSET_ID,
            photo_asset_generation: '2',
            photo_storage_prefix: storagePrefix,
          }),
        ]),
      ]),
      { accountId: ACCOUNT_ID },
    );

    expect(result).toMatchObject({
      outcome: 'found',
      profile: {
        accountId: ACCOUNT_ID,
        photoUrl:
          `https://photos.example.test/${storagePrefix}/avatar.webp`,
        fullPhotoUrl:
          `https://photos.example.test/${storagePrefix}/full.webp`,
      },
    });
    if (result.outcome === 'found') {
      expect(result.profile.photoUrl).toBe(
        `https://photos.example.test/${storagePrefix}/avatar.webp`,
      );
      expect(result.profile.fullPhotoUrl).toBe(
        `https://photos.example.test/${storagePrefix}/full.webp`,
      );
    }
  });

  it('keeps an explicit deletion from falling back to the Telegram photo', async () => {
    const result = await new PostgresPlayerProfileReader(
      new PlayerProfilePhotoUrlResolver('https://photos.example.test'),
    ).findByAccountId(
      new FakeTransaction([
        queryResult([
          profileRow({
            photo_state_account_id: ACCOUNT_ID,
            photo_state_active_asset_id: null,
            photo_state_version: '3',
          }),
        ]),
      ]),
      { accountId: ACCOUNT_ID },
    );

    expect(result.outcome).toBe('found');
    if (result.outcome === 'found') {
      expect(result.profile).not.toHaveProperty('photoUrl');
    }
  });

  it.each([
    [
      'state owned by another account',
      {
        photo_state_account_id: OTHER_ACCOUNT_ID,
        photo_state_active_asset_id: null,
        photo_state_version: '1',
      },
    ],
    [
      'asset owned by another account',
      {
        photo_state_account_id: ACCOUNT_ID,
        photo_state_active_asset_id: PHOTO_ASSET_ID,
        photo_state_version: '1',
        photo_asset_account_id: OTHER_ACCOUNT_ID,
        photo_asset_id: PHOTO_ASSET_ID,
        photo_asset_generation: '1',
        photo_storage_prefix:
          `profile-photos/${OTHER_ACCOUNT_ID}/1/${PHOTO_ASSET_ID}`,
      },
    ],
    [
      'prefix belonging to another account',
      {
        photo_state_account_id: ACCOUNT_ID,
        photo_state_active_asset_id: PHOTO_ASSET_ID,
        photo_state_version: '1',
        photo_asset_account_id: ACCOUNT_ID,
        photo_asset_id: PHOTO_ASSET_ID,
        photo_asset_generation: '1',
        photo_storage_prefix:
          `profile-photos/${OTHER_ACCOUNT_ID}/1/${PHOTO_ASSET_ID}`,
      },
    ],
  ])('rejects a cross-account photo binding: %s', async (_label, overrides) => {
    await expect(
      new PostgresPlayerProfileReader(
        new PlayerProfilePhotoUrlResolver('https://photos.example.test'),
      ).findByAccountId(
        new FakeTransaction([queryResult([profileRow(overrides)])]),
        { accountId: ACCOUNT_ID },
      ),
    ).rejects.toMatchObject({
      name: 'PlayerProfileReadPersistenceError',
      reason: 'invalid_persisted_state',
    });
  });

  it('decodes a canonical two-decimal rating and verification flag', async () => {
    const result = await new PostgresPlayerProfileReader().findByAccountId(
      new FakeTransaction([
        queryResult([
          profileRow({ rating: '0.29', is_verified: true }),
        ]),
      ]),
      { accountId: ACCOUNT_ID },
    );

    expect(result).toMatchObject({
      outcome: 'found',
      profile: {
        accountId: ACCOUNT_ID,
        rating: 0.29,
        isVerified: true,
      },
    });
  });

  it('projects the latest granted club-admin capability', async () => {
    const result = await new PostgresPlayerProfileReader().findByAccountId(
      new FakeTransaction([
        queryResult([
          profileRow({ has_club_admin_capability: true }),
        ]),
      ]),
      { accountId: ACCOUNT_ID },
    );

    expect(result).toMatchObject({
      outcome: 'found',
      profile: { capabilities: ['club_admin'] },
    });
    if (result.outcome === 'found') {
      expect(Object.isFrozen(result.profile.capabilities)).toBe(true);
    }
  });

  it.each([
    ['unexpected account', { account_id: OTHER_ACCOUNT_ID }],
    ['missing account', { account_id: null }],
    ['empty first name', { first_name: '' }],
    ['invalid first name', { first_name: 42 }],
    ['empty optional field', { last_name: '' }],
    ['overlong username', { username: 'u'.repeat(65) }],
    ['invalid photo URL', { photo_url: 'http://example.test/avatar' }],
    ['non-string language', { language_code: false }],
    ['invalid phone', { phone: '79990000000' }],
    ['invalid side', { side_preference: 'Center' }],
    ['missing rating state', { rating: null, is_verified: null }],
    ['invalid rating scale', { rating: '3.001' }],
    ['out-of-range rating', { rating: '10.01' }],
    ['invalid verification', { is_verified: 'false' }],
    ['invalid capability state', { has_club_admin_capability: null }],
  ])('rejects invalid persisted state: %s', async (_label, overrides) => {
    await expect(
      new PostgresPlayerProfileReader().findByAccountId(
        new FakeTransaction([queryResult([profileRow(overrides)])]),
        { accountId: ACCOUNT_ID },
      ),
    ).rejects.toMatchObject({
      name: 'PlayerProfileReadPersistenceError',
      reason: 'invalid_persisted_state',
    });
  });

  it.each([
    [queryResult([profileRow()], 0)],
    [queryResult([profileRow(), profileRow()], 2)],
    [queryResult([], 1)],
  ])('rejects inconsistent SELECT cardinality', async (selected) => {
    await expect(
      new PostgresPlayerProfileReader().findByAccountId(
        new FakeTransaction([selected]),
        { accountId: ACCOUNT_ID },
      ),
    ).rejects.toMatchObject({
      reason: 'invalid_persisted_state',
    });
  });

  it.each([
    null,
    {},
    { accountId: 'invalid' },
    { accountId: ACCOUNT_ID, extra: true },
  ])('fails closed before SQL for invalid input %p', async (input) => {
    const transaction = new FakeTransaction([]);
    await expect(
      new PostgresPlayerProfileReader().findByAccountId(
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
        await new PostgresPlayerProfileReader().findByAccountId(
          new FakeTransaction([postgresError(code)]),
          { accountId: ACCOUNT_ID },
        );
        throw new Error('Expected repository failure');
      } catch (error) {
        expectSafeError(error, reason);
      }
    },
  );

  it('maps non-PostgreSQL errors to a fixed storage failure', async () => {
    try {
      await new PostgresPlayerProfileReader().findByAccountId(
        new FakeTransaction([new Error(PRIVATE_MARKER)]),
        { accountId: ACCOUNT_ID },
      );
      throw new Error('Expected repository failure');
    } catch (error) {
      expectSafeError(error, 'storage_failure');
    }
  });
});
