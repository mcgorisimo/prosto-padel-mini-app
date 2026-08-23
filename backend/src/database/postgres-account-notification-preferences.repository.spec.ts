import { inspect } from 'node:util';
import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  AccountNotificationPreferencesPersistenceError,
  SaveAccountNotificationPreferenceInput,
} from './account-notification-preferences.repository';
import { PostgresAccountNotificationPreferencesRepository } from './postgres-account-notification-preferences.repository';
import { PostgresTransaction } from './postgres-transaction';

const ACCOUNT_ID = deterministicUuid(
  'account-notification-preferences-repository',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'account-notification-preferences-repository-other',
) as AccountId;
const NOW = unixEpochSeconds(1_800_000_000);
const PRIVATE_MARKER = 'SYNTHETIC_NOTIFICATION_PREFERENCES_PRIVATE';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class FakeTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly queued: readonly (
      QueryResult<QueryResultRow> | Error | Record<string, unknown>
    )[],
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    const next = this.queued[this.calls.length - 1];
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
): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: [...rows],
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    account_id: ACCOUNT_ID,
    telegram_match_notifications_enabled: false,
    created_at: String(NOW - 10),
    updated_at: String(NOW),
    version: '3',
    ...overrides,
  };
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function saveInput(
  overrides: Partial<SaveAccountNotificationPreferenceInput> = {},
): SaveAccountNotificationPreferenceInput {
  return {
    accountId: ACCOUNT_ID,
    telegramMatchNotificationsEnabled: false,
    expectedVersion: null,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('PostgresAccountNotificationPreferencesRepository', () => {
  const repository = new PostgresAccountNotificationPreferencesRepository();

  it('reads an absent row as missing with an account-scoped query', async () => {
    const transaction = new FakeTransaction([queryResult([])]);

    await expect(
      repository.findByAccountId(transaction, { accountId: ACCOUNT_ID }),
    ).resolves.toEqual({ outcome: 'missing' });

    expect(transaction.calls).toHaveLength(1);
    expect(transaction.calls[0].values).toEqual([ACCOUNT_ID]);
    expect(normalizeSql(transaction.calls[0].text)).toContain(
      'FROM backend_auth.account_notification_preferences WHERE account_id = $1',
    );
  });

  it('hydrates the exact stored boolean and optimistic version', async () => {
    const transaction = new FakeTransaction([queryResult([row()])]);

    await expect(
      repository.findByAccountId(transaction, { accountId: ACCOUNT_ID }),
    ).resolves.toEqual({
      outcome: 'found',
      preference: {
        accountId: ACCOUNT_ID,
        telegramMatchNotificationsEnabled: false,
        createdAt: NOW - 10,
        updatedAt: NOW,
        version: 3,
      },
    });
  });

  it('inserts the first explicit value only when expectedVersion is null', async () => {
    const transaction = new FakeTransaction([
      queryResult([
        row({
          telegram_match_notifications_enabled: true,
          created_at: String(NOW),
          version: '1',
        }),
      ]),
    ]);

    await expect(
      repository.save(
        transaction,
        saveInput({ telegramMatchNotificationsEnabled: true }),
      ),
    ).resolves.toMatchObject({
      outcome: 'saved',
      preference: {
        telegramMatchNotificationsEnabled: true,
        version: 1,
      },
    });

    expect(transaction.calls[0].values).toEqual([ACCOUNT_ID, true, NOW]);
    const sql = normalizeSql(transaction.calls[0].text);
    expect(sql).toContain(
      'INSERT INTO backend_auth.account_notification_preferences',
    );
    expect(sql).toContain(
      'ON CONFLICT ON CONSTRAINT account_notification_preferences_pkey DO NOTHING',
    );
  });

  it('updates only the observed version and increments it atomically', async () => {
    const transaction = new FakeTransaction([
      queryResult([row({ version: '8' })]),
    ]);

    await expect(
      repository.save(transaction, saveInput({ expectedVersion: 7 })),
    ).resolves.toMatchObject({
      outcome: 'saved',
      preference: { version: 8 },
    });

    expect(transaction.calls[0].values).toEqual([ACCOUNT_ID, false, 7, NOW]);
    const sql = normalizeSql(transaction.calls[0].text);
    expect(sql).toContain('AND version = $3');
    expect(sql).toContain('version = version + 1');
    expect(sql).toContain('updated_at = GREATEST(updated_at, $4)');
  });

  it.each([null, 4] as const)(
    'returns conflict without guessing current state for expectedVersion %p',
    async (expectedVersion) => {
      const transaction = new FakeTransaction([queryResult([])]);
      await expect(
        repository.save(transaction, saveInput({ expectedVersion })),
      ).resolves.toEqual({ outcome: 'conflict' });
    },
  );

  it('never reads or writes Telegram destination, login, or outbox state', async () => {
    const transaction = new FakeTransaction([queryResult([]), queryResult([])]);
    await repository.findByAccountId(transaction, { accountId: ACCOUNT_ID });
    await repository.save(transaction, saveInput());
    const sql = transaction.calls.map((call) => call.text).join(' ');
    expect(sql).not.toMatch(/destination|external_identities|outbox/iu);
    expect(sql.match(/account_notification_preferences/gu)).not.toBeNull();
  });

  it.each([
    null,
    {},
    { accountId: 'invalid' },
    { accountId: ACCOUNT_ID, extra: true },
  ])('rejects invalid read input before querying: %p', async (input) => {
    const transaction = new FakeTransaction([]);
    await expect(
      repository.findByAccountId(transaction, input as never),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(0);
  });

  it('rejects a row bound to a different account', async () => {
    const transaction = new FakeTransaction([
      queryResult([row({ account_id: OTHER_ACCOUNT_ID })]),
    ]);
    await expect(
      repository.findByAccountId(transaction, { accountId: ACCOUNT_ID }),
    ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
  });

  it.each([
    ['08006', 'database_unavailable'],
    ['40001', 'transaction_conflict'],
    ['42501', 'permission_denied'],
    ['23503', 'storage_failure'],
  ] as const)('maps PostgreSQL %s to a safe %s error', async (code, reason) => {
    const transaction = new FakeTransaction([
      {
        code,
        message: `${PRIVATE_MARKER}:${ACCOUNT_ID}`,
        detail: `${PRIVATE_MARKER}:telegram-chat-id`,
      },
    ]);
    let captured: unknown;
    try {
      await repository.findByAccountId(transaction, {
        accountId: ACCOUNT_ID,
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(
      AccountNotificationPreferencesPersistenceError,
    );
    expect(captured).toMatchObject({ reason });
    expect(inspect(captured)).not.toContain(PRIVATE_MARKER);
    expect(inspect(captured)).not.toContain(ACCOUNT_ID);
  });
});
