import { QueryResult, QueryResultRow } from 'pg';
import { PostgresTransaction } from './postgres-transaction';
import { PostgresYclientsWebhookSignalRepository } from './postgres-yclients-webhook-signal.repository';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class FakeTransaction implements PostgresTransaction {
  readonly calls: QueryCall[] = [];

  constructor(private readonly upsertRowCount = 1) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    this.calls.push({ text, values });
    const isUpsert = normalizeSql(text).startsWith(
      'INSERT INTO BACKEND_MATCH.YCLIENTS_RECORD_WEBHOOK_SIGNALS',
    );
    return {
      command: isUpsert ? 'INSERT' : 'SELECT',
      rowCount: isUpsert ? this.upsertRowCount : 1,
      oid: 0,
      fields: [],
      rows: [],
    } as QueryResult<Row>;
  }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/gu, ' ').trim().toUpperCase();
}

describe('PostgresYclientsWebhookSignalRepository', () => {
  it('locks the company and uses a bounded parameterized coalescing upsert', async () => {
    const transaction = new FakeTransaction();
    const repository = new PostgresYclientsWebhookSignalRepository();

    await expect(
      repository.recordSignal(transaction, {
        companyId: 123,
        recordId: 456,
        eventType: 'update',
        receivedAt: 1_800_000_000,
      }),
    ).resolves.toBe('recorded');

    expect(transaction.calls).toHaveLength(2);
    const lockCall = transaction.calls[0];
    const call = transaction.calls[1];
    expect(lockCall.values).toEqual([123]);
    expect(normalizeSql(lockCall.text)).toContain(
      'PG_CATALOG.PG_ADVISORY_XACT_LOCK',
    );
    expect(call.values).toEqual([
      123,
      456,
      'update',
      1_800_000_000,
      100_000,
    ]);
    const sql = normalizeSql(call.text);
    expect(sql).toContain(
      'INSERT INTO BACKEND_MATCH.YCLIENTS_RECORD_WEBHOOK_SIGNALS',
    );
    expect(sql).toContain('ON CONFLICT (COMPANY_ID, RECORD_ID) DO UPDATE');
    expect(sql).toContain(
      'DELIVERY_COUNT = BACKEND_MATCH.YCLIENTS_RECORD_WEBHOOK_SIGNALS.DELIVERY_COUNT + 1',
    );
    expect(sql).toContain(
      'VERSION = BACKEND_MATCH.YCLIENTS_RECORD_WEBHOOK_SIGNALS.VERSION + 1',
    );
    expect(sql).toContain('SELECT PG_CATALOG.COUNT(*)');
    expect(sql).toContain('RETURNING COMPANY_ID');
    expect(sql).not.toContain('DATA');
    expect(sql).not.toContain('PHONE');
    expect(sql).not.toContain('DELETE ');
    expect(call.text).not.toContain('123');
    expect(call.text).not.toContain('456');
  });

  it('reports capacity exhaustion without writing a new row', async () => {
    const transaction = new FakeTransaction(0);
    const repository = new PostgresYclientsWebhookSignalRepository();

    await expect(
      repository.recordSignal(transaction, {
        companyId: 123,
        recordId: 789,
        eventType: 'create',
        receivedAt: 1_800_000_000,
      }),
    ).resolves.toBe('capacity_exceeded');
  });
});
