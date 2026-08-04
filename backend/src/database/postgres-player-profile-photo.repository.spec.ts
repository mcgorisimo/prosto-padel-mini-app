import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { InternalUuid } from '../common/internal-uuid';
import { deterministicUuid } from '../../test/deterministic-uuid';
import { PostgresPlayerProfilePhotoRepository } from './postgres-player-profile-photo.repository';
import { PostgresTransaction } from './postgres-transaction';

const ACCOUNT_ID = deterministicUuid(
  'postgres-player-profile-photo-account',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'postgres-player-profile-photo-other-account',
) as AccountId;
const ASSET_ID = deterministicUuid(
  'postgres-player-profile-photo-asset',
) as InternalUuid;
const OLDER_ASSET_ID = deterministicUuid(
  'postgres-player-profile-photo-older-asset',
) as InternalUuid;

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class FakeTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];

  constructor(private readonly queued: QueryResult<QueryResultRow>[]) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    const result = this.queued.shift();
    if (result === undefined) {
      throw new Error('Unexpected query');
    }
    return result as QueryResult<Row>;
  }
}

function result(
  rows: readonly QueryResultRow[],
  rowCount: number | null = rows.length,
  command = 'SELECT',
): QueryResult<QueryResultRow> {
  return {
    command,
    rowCount,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

describe('PostgresPlayerProfilePhotoRepository', () => {
  const repository = new PostgresPlayerProfilePhotoRepository();

  it('returns the next account-owned generation', async () => {
    const transaction = new FakeTransaction([
      result([{ account_id: ACCOUNT_ID, version: '7' }]),
    ]);

    await expect(
      repository.readNextGeneration(transaction, ACCOUNT_ID),
    ).resolves.toEqual({ outcome: 'found', nextGeneration: 8 });
    expect(transaction.calls).toHaveLength(1);
    expect(transaction.calls[0].values).toEqual([ACCOUNT_ID]);
  });

  it('creates an immutable asset and state for the same account', async () => {
    const transaction = new FakeTransaction([
      result([{ locked: null }]),
      result([
        {
          account_id: ACCOUNT_ID,
          version: null,
          active_asset_id: null,
          active_storage_prefix: null,
          previous_asset_id: null,
          previous_storage_prefix: null,
        },
      ]),
      result([], 1, 'INSERT'),
      result([], 1, 'INSERT'),
      result([]),
    ]);

    await expect(
      repository.activate(transaction, {
        assetId: ASSET_ID,
        accountId: ACCOUNT_ID,
        generation: 1,
        storagePrefix:
          `profile-photos/${ACCOUNT_ID}/1/${ASSET_ID}`,
        fullDimension: 1_200,
        fullByteSize: 123_456,
        contentSha256: Buffer.alloc(32, 0x51),
        createdAt: 1_800_000_000,
      }),
    ).resolves.toEqual({
      outcome: 'activated',
      storagePrefixesToRemove: [],
    });

    expect(transaction.calls).toHaveLength(5);
    expect(transaction.calls[0].values).toEqual([ACCOUNT_ID]);
    expect(normalizeSql(transaction.calls[0].text)).toContain(
      'pg_advisory_xact_lock',
    );
    expect(transaction.calls[1].values).toEqual([ACCOUNT_ID]);
    expect(transaction.calls[2].values.slice(0, 4)).toEqual([
      ASSET_ID,
      ACCOUNT_ID,
      1,
      `profile-photos/${ACCOUNT_ID}/1/${ASSET_ID}`,
    ]);
    expect(transaction.calls[3].values).toEqual([
      ACCOUNT_ID,
      ASSET_ID,
      1,
      1_800_000_000,
    ]);
    expect(transaction.calls[4].values).toEqual([
      ACCOUNT_ID,
      ASSET_ID,
    ]);
    expect(normalizeSql(transaction.calls[1].text)).not.toContain(
      'FOR UPDATE',
    );
  });

  it('returns every inactive account-owned prefix after replacing a photo', async () => {
    const nextAssetId = deterministicUuid(
      'postgres-player-profile-photo-replacement',
    ) as InternalUuid;
    const transaction = new FakeTransaction([
      result([{ locked: null }]),
      result([{
        account_id: ACCOUNT_ID,
        version: '2',
        active_asset_id: ASSET_ID,
        active_storage_prefix:
          `profile-photos/${ACCOUNT_ID}/2/${ASSET_ID}`,
        previous_asset_id: null,
        previous_storage_prefix: null,
      }]),
      result([], 1, 'INSERT'),
      result([], 1, 'UPDATE'),
      result([
        {
          account_id: ACCOUNT_ID,
          asset_id: OLDER_ASSET_ID,
          generation: '1',
          storage_prefix:
            `profile-photos/${ACCOUNT_ID}/1/${OLDER_ASSET_ID}`,
        },
        {
          account_id: ACCOUNT_ID,
          asset_id: ASSET_ID,
          generation: '2',
          storage_prefix:
            `profile-photos/${ACCOUNT_ID}/2/${ASSET_ID}`,
        },
      ]),
    ]);

    await expect(repository.activate(transaction, {
      assetId: nextAssetId,
      accountId: ACCOUNT_ID,
      generation: 3,
      storagePrefix:
        `profile-photos/${ACCOUNT_ID}/3/${nextAssetId}`,
      fullDimension: 1_200,
      fullByteSize: 123_456,
      contentSha256: Buffer.alloc(32, 0x51),
      createdAt: 1_800_000_000,
    })).resolves.toEqual({
      outcome: 'activated',
      storagePrefixesToRemove: [
        `profile-photos/${ACCOUNT_ID}/1/${OLDER_ASSET_ID}`,
        `profile-photos/${ACCOUNT_ID}/2/${ASSET_ID}`,
      ],
    });
    expect(transaction.calls[4].values).toEqual([
      ACCOUNT_ID,
      nextAssetId,
    ]);
  });

  it('rejects a storage prefix belonging to another account before SQL', async () => {
    const transaction = new FakeTransaction([]);

    await expect(
      repository.activate(transaction, {
        assetId: ASSET_ID,
        accountId: ACCOUNT_ID,
        generation: 1,
        storagePrefix:
          `profile-photos/${OTHER_ACCOUNT_ID}/1/${ASSET_ID}`,
        fullDimension: 1_200,
        fullByteSize: 123_456,
        contentSha256: Buffer.alloc(32, 0x51),
        createdAt: 1_800_000_000,
      }),
    ).rejects.toMatchObject({
      name: 'PlayerProfilePhotoPersistenceError',
      reason: 'invalid_input',
    });
    expect(transaction.calls).toHaveLength(0);
  });

  it('throws when a state update loses its compare-and-swap after asset insertion', async () => {
    const transaction = new FakeTransaction([
      result([{ locked: null }]),
      result([
        {
          account_id: ACCOUNT_ID,
          version: '1',
          active_asset_id: ASSET_ID,
          active_storage_prefix:
            `profile-photos/${ACCOUNT_ID}/1/${ASSET_ID}`,
          previous_asset_id: null,
          previous_storage_prefix: null,
        },
      ]),
      result([], 1, 'INSERT'),
      result([], 0, 'UPDATE'),
    ]);
    const nextAssetId = deterministicUuid(
      'postgres-player-profile-photo-next-asset',
    ) as InternalUuid;

    await expect(
      repository.activate(transaction, {
        assetId: nextAssetId,
        accountId: ACCOUNT_ID,
        generation: 2,
        storagePrefix:
          `profile-photos/${ACCOUNT_ID}/2/${nextAssetId}`,
        fullDimension: 1_200,
        fullByteSize: 123_456,
        contentSha256: Buffer.alloc(32, 0x51),
        createdAt: 1_800_000_000,
      }),
    ).rejects.toMatchObject({
      name: 'PlayerProfilePhotoPersistenceError',
      reason: 'transaction_conflict',
    });
    expect(transaction.calls).toHaveLength(4);
  });

  it('advances only the authenticated account state when clearing a photo', async () => {
    const transaction = new FakeTransaction([
      result([{ locked: null }]),
      result([
        {
          account_id: ACCOUNT_ID,
          version: '3',
          active_asset_id: ASSET_ID,
          active_storage_prefix:
            `profile-photos/${ACCOUNT_ID}/3/${ASSET_ID}`,
          previous_asset_id: null,
          previous_storage_prefix: null,
        },
      ]),
      result([], 1, 'UPDATE'),
      result([{
        account_id: ACCOUNT_ID,
        asset_id: ASSET_ID,
        generation: '3',
        storage_prefix:
          `profile-photos/${ACCOUNT_ID}/3/${ASSET_ID}`,
      }]),
    ]);

    await expect(
      repository.clear(transaction, ACCOUNT_ID, 1_800_000_000),
    ).resolves.toEqual({
      outcome: 'cleared',
      changed: true,
      storagePrefixesToRemove: [
        `profile-photos/${ACCOUNT_ID}/3/${ASSET_ID}`,
      ],
    });
    expect(transaction.calls[0].values).toEqual([ACCOUNT_ID]);
    expect(normalizeSql(transaction.calls[0].text)).toContain(
      'pg_advisory_xact_lock',
    );
    expect(transaction.calls[1].values).toEqual([ACCOUNT_ID]);
    expect(transaction.calls[2].values).toEqual([
      ACCOUNT_ID,
      null,
      4,
      1_800_000_000,
      3,
    ]);
    expect(transaction.calls.flatMap((call) => call.values)).not.toContain(
      OTHER_ACCOUNT_ID,
    );
  });

  it('returns the previous generation prefix when retrying an already cleared photo', async () => {
    const transaction = new FakeTransaction([
      result([{ locked: null }]),
      result([
        {
          account_id: ACCOUNT_ID,
          version: '4',
          active_asset_id: null,
          active_storage_prefix: null,
          previous_asset_id: ASSET_ID,
          previous_storage_prefix:
            `profile-photos/${ACCOUNT_ID}/3/${ASSET_ID}`,
        },
      ]),
      result([
        {
          account_id: ACCOUNT_ID,
          asset_id: OLDER_ASSET_ID,
          generation: '1',
          storage_prefix:
            `profile-photos/${ACCOUNT_ID}/1/${OLDER_ASSET_ID}`,
        },
        {
          account_id: ACCOUNT_ID,
          asset_id: ASSET_ID,
          generation: '3',
          storage_prefix:
            `profile-photos/${ACCOUNT_ID}/3/${ASSET_ID}`,
        },
      ]),
    ]);

    await expect(
      repository.clear(transaction, ACCOUNT_ID, 1_800_000_001),
    ).resolves.toEqual({
      outcome: 'cleared',
      changed: false,
      storagePrefixesToRemove: [
        `profile-photos/${ACCOUNT_ID}/1/${OLDER_ASSET_ID}`,
        `profile-photos/${ACCOUNT_ID}/3/${ASSET_ID}`,
      ],
    });
    expect(transaction.calls).toHaveLength(3);
    expect(transaction.calls[0].values).toEqual([ACCOUNT_ID]);
    expect(transaction.calls[1].values).toEqual([ACCOUNT_ID]);
    expect(transaction.calls[2].values).toEqual([ACCOUNT_ID, null]);
  });
});
