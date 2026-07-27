import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { PostgresService } from './postgres.service';
import {
  PostgresTransaction,
  PostgresTransactionRunner,
} from './postgres-transaction';
import { PostgresTransactionExecutorAdapter } from './postgres-transaction-executor.adapter';

function queryResult<Row extends QueryResultRow = QueryResultRow>(): QueryResult<Row> {
  return {
    command: '',
    rowCount: 0,
    oid: 0,
    rows: [],
    fields: [],
  };
}

function context() {
  const events: string[] = [];
  const query = jest.fn(async (text: string): Promise<QueryResult> => {
    events.push(text);
    return queryResult();
  });
  const release = jest.fn(() => events.push('release'));
  const client = { query, release } as unknown as PoolClient;
  const connect = jest.fn(async () => {
    events.push('connect');
    return client;
  });
  const pool = { connect } as unknown as Pool;
  const postgres = {
    getPool: jest.fn(() => pool),
  } as unknown as PostgresService;
  const runner = new PostgresTransactionRunner(postgres);

  return {
    events,
    query,
    release,
    connect,
    executor: new PostgresTransactionExecutorAdapter(runner),
  };
}

describe('PostgresTransactionExecutorAdapter', () => {
  it('does not connect or execute transaction SQL during construction', () => {
    const test = context();
    expect(test.connect).not.toHaveBeenCalled();
    expect(test.query).not.toHaveBeenCalled();
  });

  it('delegates the callback and returns its exact result', async () => {
    const test = context();
    const expected = Object.freeze({ outcome: 'completed' });
    let received: PostgresTransaction | undefined;
    const checkpoints: string[] = [];

    const result = await test.executor.run(
      async (transaction) => {
        received = transaction;
        test.events.push('callback');
        return expected;
      },
      (checkpoint) => {
        checkpoints.push(checkpoint);
      },
    );

    expect(result).toBe(expected);
    expect(received).toBeDefined();
    expect(checkpoints).toEqual([
      'transaction_before_commit',
      'transaction_commit_success',
    ]);
    expect(test.events).toEqual([
      'connect',
      'BEGIN',
      'callback',
      'COMMIT',
      'release',
    ]);
  });

  it('commits after a successful operation query', async () => {
    const test = context();
    await test.executor.run(async (transaction) => {
      await transaction.query('SELECT $1::integer', [1]);
    });
    expect(test.events).toEqual([
      'connect',
      'BEGIN',
      'SELECT $1::integer',
      'COMMIT',
      'release',
    ]);
  });

  it('rolls back and preserves the original callback error', async () => {
    const test = context();
    const original = new Error('original-operation-error');
    const promise = test.executor.run(async () => {
      test.events.push('callback');
      throw original;
    });

    await expect(promise).rejects.toBe(original);
    expect(test.events).toEqual([
      'connect',
      'BEGIN',
      'callback',
      'ROLLBACK',
      'release',
    ]);
    expect(test.query).not.toHaveBeenCalledWith('COMMIT');
  });

  it('contains no transaction lifecycle implementation of its own', () => {
    const source = PostgresTransactionExecutorAdapter.prototype.run.toString();
    expect(source).toContain('runInTransaction');
    for (const forbidden of ['BEGIN', 'COMMIT', 'ROLLBACK', 'connect', 'getPool']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
