import { QueryResult, QueryResultRow } from 'pg';
import { AccountId } from '../accounts/account.types';
import { unixEpochSeconds } from '../auth/auth.types';
import { deterministicUuid } from '../../test/deterministic-uuid';
import {
  PostgresTelegramNotificationDestinationRepository,
} from './postgres-telegram-notification-destination.repository';
import { PostgresTransaction } from './postgres-transaction';
import {
  SynchronizeTelegramNotificationDestinationInput,
  TelegramNotificationDestinationPersistenceError,
  TelegramNotificationDestinationPersistenceFailure,
} from './telegram-notification-destination.repository';

const ACCOUNT_ID = deterministicUuid(
  'telegram-notification-destination-account',
) as AccountId;
const OTHER_ACCOUNT_ID = deterministicUuid(
  'telegram-notification-destination-other-account',
) as AccountId;
const OBSERVED_AT = unixEpochSeconds(1_800_000_000);
const TELEGRAM_CHAT_ID = '4503599627370495';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

type QueuedQuery = QueryResult<QueryResultRow> | Error | object;

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
    return next as QueryResult<Row>;
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

function stateRow(
  overrides: Record<string, unknown> = {},
): QueryResultRow {
  return {
    account_id: ACCOUNT_ID,
    status: 'enabled',
    changed: true,
    ...overrides,
  };
}

function grantedInput(): SynchronizeTelegramNotificationDestinationInput {
  return {
    accountId: ACCOUNT_ID,
    permission: {
      status: 'granted',
      telegramChatId: TELEGRAM_CHAT_ID,
    },
    observedAt: OBSERVED_AT,
  };
}

function notGrantedInput(): SynchronizeTelegramNotificationDestinationInput {
  return {
    accountId: ACCOUNT_ID,
    permission: { status: 'not_granted' },
    observedAt: OBSERVED_AT,
  };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim();
}

function postgresError(
  code: string,
  marker = 'telegram-destination-postgres-secret',
): object {
  return {
    code,
    message: marker,
    detail: `${marker}-detail`,
    hint: `${marker}-hint`,
    where: `${marker}-where`,
    query: `SELECT '${marker}'`,
    parameters: [ACCOUNT_ID, TELEGRAM_CHAT_ID, marker],
    constraint: 'secret_constraint',
    schema: 'secret_schema',
    table: 'secret_table',
    column: 'secret_column',
    cause: new Error(`${marker}-cause`),
  };
}

function expectSafeError(
  error: unknown,
  reason: TelegramNotificationDestinationPersistenceFailure,
): TelegramNotificationDestinationPersistenceError {
  expect(error).toBeInstanceOf(
    TelegramNotificationDestinationPersistenceError,
  );
  const safe = error as TelegramNotificationDestinationPersistenceError;
  expect(safe.reason).toBe(reason);
  return safe;
}

describe('PostgresTelegramNotificationDestinationRepository', () => {
  it.each([
    ['invalid account', { ...grantedInput(), accountId: 'bad-id' }],
    ['invalid time', { ...grantedInput(), observedAt: -1 }],
    [
      'numeric chat ID',
      {
        ...grantedInput(),
        permission: { status: 'granted', telegramChatId: 123 },
      },
    ],
    [
      'zero chat ID',
      {
        ...grantedInput(),
        permission: { status: 'granted', telegramChatId: '0' },
      },
    ],
    [
      'unsafe chat ID',
      {
        ...grantedInput(),
        permission: {
          status: 'granted',
          telegramChatId: '9007199254740992',
        },
      },
    ],
    [
      'extra permission field',
      {
        ...grantedInput(),
        permission: {
          status: 'not_granted',
          telegramChatId: TELEGRAM_CHAT_ID,
        },
      },
    ],
  ])('rejects %s before SQL', async (_description, input) => {
    const transaction = new FakeTransaction([]);

    await expect(
      new PostgresTelegramNotificationDestinationRepository().synchronize(
        transaction,
        input as SynchronizeTelegramNotificationDestinationInput,
      ),
    ).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(transaction.calls).toHaveLength(0);
  });

  it('uses one static parameterized upsert for granted permission', async () => {
    const transaction = new FakeTransaction([
      queryResult([stateRow()]),
    ]);

    await expect(
      new PostgresTelegramNotificationDestinationRepository().synchronize(
        transaction,
        grantedInput(),
      ),
    ).resolves.toEqual({
      outcome: 'synchronized',
      accountId: ACCOUNT_ID,
      state: 'enabled',
      changed: true,
    });

    expect(transaction.calls).toHaveLength(1);
    const call = transaction.calls[0];
    expect(call.values).toEqual([
      ACCOUNT_ID,
      TELEGRAM_CHAT_ID,
      String(OBSERVED_AT),
    ]);
    expect(call.text).not.toContain(ACCOUNT_ID);
    expect(call.text).not.toContain(TELEGRAM_CHAT_ID);
    const sql = normalizeSql(call.text).toUpperCase();
    expect(sql).toContain(
      'INSERT INTO BACKEND_AUTH.TELEGRAM_NOTIFICATION_DESTINATIONS',
    );
    expect(sql).toContain(
      'INSERT INTO BACKEND_AUTH.TELEGRAM_NOTIFICATION_DESTINATIONS ( ACCOUNT_ID, TELEGRAM_CHAT_ID, STATUS, PERMISSION_GRANTED_AT, UPDATED_AT, VERSION ) VALUES ($1, $2, \'ENABLED\', $3, $3, 1)',
    );
    expect(sql).toContain('ON CONFLICT (ACCOUNT_ID) DO UPDATE');
    expect(sql).toContain('STATUS = \'ENABLED\'');
    expect(sql).toContain('UPDATED_AT <=' );
    expect(sql).not.toContain('DELETE ');
    expect(sql).not.toContain('BEGIN');
    expect(sql).not.toContain('COMMIT');
    expect(sql).not.toContain('ROLLBACK');
  });

  it('uses one static update without a chat ID when permission is absent', async () => {
    const transaction = new FakeTransaction([
      queryResult([
        stateRow({ status: 'disabled', changed: true }),
      ]),
    ]);

    await expect(
      new PostgresTelegramNotificationDestinationRepository().synchronize(
        transaction,
        notGrantedInput(),
      ),
    ).resolves.toEqual({
      outcome: 'synchronized',
      accountId: ACCOUNT_ID,
      state: 'disabled',
      changed: true,
    });

    const call = transaction.calls[0];
    expect(call.values).toEqual([ACCOUNT_ID, String(OBSERVED_AT)]);
    expect(call.values).not.toContain(TELEGRAM_CHAT_ID);
    const sql = normalizeSql(call.text).toUpperCase();
    expect(sql).toContain(
      'UPDATE BACKEND_AUTH.TELEGRAM_NOTIFICATION_DESTINATIONS',
    );
    expect(sql).toContain("DISABLE_REASON = 'USER_REVOKED'");
    expect(sql).not.toContain('INSERT INTO');
    expect(sql).not.toContain('DELETE ');
  });

  it.each([
    ['unchanged enabled', 'enabled', false],
    ['unchanged disabled', 'disabled', false],
    ['absent', 'absent', false],
  ] as const)('hydrates %s state', async (_description, status, changed) => {
    const transaction = new FakeTransaction([
      queryResult([stateRow({ status, changed })]),
    ]);

    await expect(
      new PostgresTelegramNotificationDestinationRepository().synchronize(
        transaction,
        status === 'enabled' ? grantedInput() : notGrantedInput(),
      ),
    ).resolves.toEqual({
      outcome: 'synchronized',
      accountId: ACCOUNT_ID,
      state: status,
      changed,
    });
  });

  it.each([
    ['zero rows', [], 0],
    ['multiple rows', [stateRow(), stateRow()], 2],
    ['inconsistent rowCount', [stateRow()], 0],
    ['wrong account', [stateRow({ account_id: OTHER_ACCOUNT_ID })], 1],
    ['bad status', [stateRow({ status: 'pending' })], 1],
    ['bad changed flag', [stateRow({ changed: 'true' })], 1],
  ] as const)(
    'rejects invalid persisted result: %s',
    async (_description, rows, rowCount) => {
      const transaction = new FakeTransaction([
        queryResult(rows, rowCount),
      ]);

      await expect(
        new PostgresTelegramNotificationDestinationRepository().synchronize(
          transaction,
          grantedInput(),
        ),
      ).rejects.toMatchObject({ reason: 'invalid_persisted_state' });
    },
  );

  it.each([
    ['23505', 'binding_conflict'],
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
    ['99999', 'storage_failure'],
  ] as const)('maps SQLSTATE %s to %s', async (code, reason) => {
    const transaction = new FakeTransaction([postgresError(code)]);

    await expect(
      new PostgresTelegramNotificationDestinationRepository().synchronize(
        transaction,
        grantedInput(),
      ),
    ).rejects.toMatchObject({ reason });
  });

  it('returns a safe error without PostgreSQL data or Telegram identifiers', async () => {
    const marker = 'unique-telegram-destination-leak-marker';
    const raw = postgresError('23505', marker);
    const transaction = new FakeTransaction([raw]);
    let caught: unknown;

    try {
      await new PostgresTelegramNotificationDestinationRepository().synchronize(
        transaction,
        grantedInput(),
      );
    } catch (error) {
      caught = error;
    }

    const safe = expectSafeError(caught, 'binding_conflict');
    expect(safe).not.toBe(raw);
    expect(Object.getOwnPropertyNames(safe).sort()).toEqual(
      ['message', 'name', 'reason', 'stack'].sort(),
    );
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
      TELEGRAM_CHAT_ID,
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
