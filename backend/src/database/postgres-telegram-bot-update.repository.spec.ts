import { unixEpochSeconds } from '../auth/auth.types';
import { internalUuid } from '../common/internal-uuid';
import { PostgresTransaction } from './postgres-transaction';
import {
  PostgresTelegramBotUpdateRepository,
  TELEGRAM_BOT_UPDATE_ID_MAXIMUM,
  TelegramBotUpdatePersistenceError,
} from './postgres-telegram-bot-update.repository';

const INPUT = Object.freeze({
  updateId: 123,
  receivedAt: unixEpochSeconds(1_800_000_000),
  botNamespace: internalUuid('22222222-2222-4222-8222-222222222222'),
});

function transaction(rowCount: number, rows: unknown[]) {
  const query = jest
    .fn()
    .mockResolvedValueOnce({ rowCount: 1, rows: [{ locked: null }] })
    .mockResolvedValueOnce({ rowCount, rows })
    .mockResolvedValueOnce({ rowCount: 0, rows: [] });
  return { value: { query } as unknown as PostgresTransaction, query };
}

describe('PostgresTelegramBotUpdateRepository', () => {
  const repository = new PostgresTelegramBotUpdateRepository();

  it.each([true, false])(
    'checks a durable receipt under the per-bot lock: %s',
    async (exists) => {
      const query = jest
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ locked: null }] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ update_exists: exists }],
        });
      const subject = { query } as unknown as PostgresTransaction;

      await expect(
        repository.exists(subject, {
          updateId: INPUT.updateId,
          botNamespace: INPUT.botNamespace,
        }),
      ).resolves.toBe(exists);

      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[0]?.[0]).toContain('pg_advisory_xact_lock');
      expect(query.mock.calls[1]?.[0]).toContain('SELECT EXISTS');
      expect(query.mock.calls[1]?.[1]).toEqual([
        INPUT.updateId,
        INPUT.botNamespace,
      ]);
    },
  );

  it('atomically claims one update and bounds receipts per internal bot namespace', async () => {
    const subject = transaction(1, [{ update_id: '123' }]);

    await expect(repository.claim(subject.value, INPUT)).resolves.toBe(
      'claimed',
    );

    const [lockSql, lockValues] = subject.query.mock.calls[0] as [
      string,
      unknown[],
    ];
    const [sql, values] = subject.query.mock.calls[1] as [string, unknown[]];
    const [trimSql, trimValues] = subject.query.mock.calls[2] as [
      string,
      unknown[],
    ];
    expect(lockSql).toContain('pg_advisory_xact_lock');
    expect(lockValues).toEqual([INPUT.botNamespace]);
    expect(sql).toContain('ON CONFLICT (bot_namespace, update_id) DO NOTHING');
    expect(values).toEqual([123, '1800000000', INPUT.botNamespace]);
    expect(trimSql).toContain('OFFSET $2');
    expect(trimValues).toEqual([INPUT.botNamespace, 1024]);
    expect(sql).not.toMatch(
      /username|first_name|last_name|message_text|body|token/iu,
    );
  });

  it('returns ignored for a replay', async () => {
    const subject = transaction(0, []);

    await expect(repository.claim(subject.value, INPUT)).resolves.toBe(
      'ignored',
    );
    expect(subject.query).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...INPUT, updateId: -1 },
    { ...INPUT, updateId: TELEGRAM_BOT_UPDATE_ID_MAXIMUM + 1 },
    { ...INPUT, botNamespace: 'not-a-namespace' },
  ])('rejects invalid input before PostgreSQL', async (input) => {
    const subject = transaction(1, [{}]);

    await expect(
      repository.claim(subject.value, input as never),
    ).rejects.toBeInstanceOf(TelegramBotUpdatePersistenceError);
    expect(subject.query).not.toHaveBeenCalled();
  });

  it('rejects an invalid durable receipt lookup before PostgreSQL', async () => {
    const subject = transaction(1, [{}]);

    await expect(
      repository.exists(subject.value, {
        updateId: -1,
        botNamespace: INPUT.botNamespace,
      }),
    ).rejects.toBeInstanceOf(TelegramBotUpdatePersistenceError);
    expect(subject.query).not.toHaveBeenCalled();
  });

  it('maps unexpected PostgreSQL result shapes to a safe failure', async () => {
    const subject = transaction(2, [{}, {}]);

    await expect(repository.claim(subject.value, INPUT)).rejects.toBeInstanceOf(
      TelegramBotUpdatePersistenceError,
    );
  });
});
