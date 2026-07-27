import {
  Pool,
  PoolClient,
  QueryResult,
  QueryResultRow,
} from 'pg';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { DatabaseModule } from './database.module';
import { PostgresService } from './postgres.service';
import {
  PostgresTransactionRunner,
} from './postgres-transaction';
import { PostgresTransactionExecutorAdapter } from './postgres-transaction-executor.adapter';
import { PostgresSecurityAuditRepository } from './postgres-security-audit.repository';

function emptyQueryResult<Row extends QueryResultRow = QueryResultRow>(
  rows: Row[] = [],
): QueryResult<Row> {
  return {
    command: '',
    rowCount: rows.length,
    oid: 0,
    rows,
    fields: [],
  };
}

interface TestContext {
  readonly events: string[];
  readonly query: jest.Mock;
  readonly release: jest.Mock;
  readonly connect: jest.Mock;
  readonly runner: PostgresTransactionRunner;
}

function createTestContext(
  queryImplementation: (
    text: string,
    values?: unknown[],
  ) => Promise<QueryResult> = async () => emptyQueryResult(),
): TestContext {
  const events: string[] = [];
  const query = jest.fn(
    async (text: string, values?: unknown[]): Promise<QueryResult> => {
      events.push(text);
      return queryImplementation(text, values);
    },
  );
  const release = jest.fn(() => {
    events.push('release');
  });
  const client = {
    query,
    release,
  } as unknown as PoolClient;
  const connect = jest.fn(async () => {
    events.push('connect');
    return client;
  });
  const pool = { connect } as unknown as Pool;
  const postgres = {
    getPool: jest.fn(() => pool),
  } as unknown as PostgresService;

  return {
    events,
    query,
    release,
    connect,
    runner: new PostgresTransactionRunner(postgres),
  };
}

describe('PostgresTransactionRunner', () => {
  it('runs the successful path in order and releases the client once', async () => {
    const context = createTestContext();

    await context.runner.runInTransaction(async (transaction) => {
      context.events.push('operation');
      await transaction.query('SELECT $1::text', ['value']);
    });

    expect(context.events).toEqual([
      'connect',
      'BEGIN',
      'operation',
      'SELECT $1::text',
      'COMMIT',
      'release',
    ]);
    expect(context.connect).toHaveBeenCalledTimes(1);
    expect(context.release).toHaveBeenCalledTimes(1);
  });

  it('returns the exact value produced by the operation', async () => {
    const context = createTestContext();
    const expected = Object.freeze({ status: 'completed' });

    const result = await context.runner.runInTransaction(async () => expected);

    expect(result).toBe(expected);
    expect(context.release).toHaveBeenCalledTimes(1);
  });

  it('reports successful COMMIT checkpoints in exact order', async () => {
    const context = createTestContext();
    const checkpoints: string[] = [];

    await context.runner.runInTransaction(
      async () => {
        context.events.push('operation');
      },
      (checkpoint) => {
        checkpoints.push(checkpoint);
        context.events.push(checkpoint);
      },
    );

    expect(checkpoints).toEqual([
      'transaction_before_commit',
      'transaction_commit_success',
    ]);
    expect(context.events).toEqual([
      'connect',
      'BEGIN',
      'operation',
      'transaction_before_commit',
      'COMMIT',
      'transaction_commit_success',
      'release',
    ]);
  });

  it('rolls back an operation error without committing', async () => {
    const context = createTestContext();
    const operationError = new Error('operation failed');

    await expect(
      context.runner.runInTransaction(async () => {
        context.events.push('operation');
        throw operationError;
      }),
    ).rejects.toBe(operationError);

    expect(context.events).toEqual([
      'connect',
      'BEGIN',
      'operation',
      'ROLLBACK',
      'release',
    ]);
    expect(context.query).not.toHaveBeenCalledWith('COMMIT');
    expect(context.release).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original operation error without replacing it', async () => {
    const context = createTestContext();
    const operationError = new TypeError('original error');

    const promise = context.runner.runInTransaction(async () => {
      throw operationError;
    });

    await expect(promise).rejects.toBe(operationError);
    expect(context.release).toHaveBeenCalledTimes(1);
  });

  it('releases the client without operation or transaction completion when BEGIN fails', async () => {
    const beginError = new Error('BEGIN failed');
    const operation = jest.fn(async () => undefined);
    const context = createTestContext(async (text) => {
      if (text === 'BEGIN') {
        throw beginError;
      }
      return emptyQueryResult();
    });

    await expect(
      context.runner.runInTransaction(operation),
    ).rejects.toBe(beginError);

    expect(context.events).toEqual(['connect', 'BEGIN', 'release']);
    expect(operation).not.toHaveBeenCalled();
    expect(context.query).not.toHaveBeenCalledWith('COMMIT');
    expect(context.query).not.toHaveBeenCalledWith('ROLLBACK');
    expect(context.release).toHaveBeenCalledTimes(1);
  });

  it('preserves a connect error without using or releasing a client', async () => {
    const connectError = new Error('connect failed');
    const operation = jest.fn(async () => undefined);
    const context = createTestContext();
    context.connect.mockRejectedValueOnce(connectError);

    await expect(
      context.runner.runInTransaction(operation),
    ).rejects.toBe(connectError);

    expect(context.connect).toHaveBeenCalledTimes(1);
    expect(operation).not.toHaveBeenCalled();
    expect(context.query).not.toHaveBeenCalled();
    expect(context.release).not.toHaveBeenCalled();
  });

  it('attempts rollback and releases the client when COMMIT fails', async () => {
    const sensitiveMarker = 'SYNTHETIC_COMMIT_FAILURE_SECRET';
    const commitError = new Error(sensitiveMarker);
    const checkpoints: string[] = [];
    const context = createTestContext(async (text) => {
      if (text === 'COMMIT') {
        throw commitError;
      }
      return emptyQueryResult();
    });

    await expect(
      context.runner.runInTransaction(
        async () => 'result',
        (checkpoint) => {
          checkpoints.push(checkpoint);
        },
      ),
    ).rejects.toBe(commitError);

    expect(checkpoints).toEqual([
      'transaction_before_commit',
      'transaction_commit_failed',
    ]);
    const exposed = JSON.stringify(checkpoints);
    for (const marker of [
      sensitiveMarker,
      'COMMIT',
      'SQLSTATE',
      '23514',
      'constraint',
      'account',
      'operation',
      'credential',
    ]) {
      expect(exposed.includes(marker)).toBe(false);
    }
    expect(context.events).toEqual([
      'connect',
      'BEGIN',
      'COMMIT',
      'ROLLBACK',
      'release',
    ]);
    expect(context.release).toHaveBeenCalledTimes(1);
  });

  it('isolates commit observer exceptions from success and failure', async () => {
    const successful = createTestContext();
    const observer = jest.fn(() => {
      throw new Error('SYNTHETIC_OBSERVER_FAILURE');
    });

    await expect(
      successful.runner.runInTransaction(async () => 'result', observer),
    ).resolves.toBe('result');
    expect(observer).toHaveBeenCalledTimes(2);
    expect(successful.query).toHaveBeenCalledWith('COMMIT');

    const commitError = new Error('SYNTHETIC_COMMIT_ERROR');
    const failing = createTestContext(async (text) => {
      if (text === 'COMMIT') {
        throw commitError;
      }
      return emptyQueryResult();
    });

    await expect(
      failing.runner.runInTransaction(async () => 'result', observer),
    ).rejects.toBe(commitError);
    expect(observer).toHaveBeenCalledTimes(4);
  });

  it('preserves a COMMIT error when the following ROLLBACK also fails', async () => {
    const commitError = new Error('COMMIT failed');
    const rollbackError = new Error('ROLLBACK failed');
    const context = createTestContext(async (text) => {
      if (text === 'COMMIT') {
        throw commitError;
      }
      if (text === 'ROLLBACK') {
        throw rollbackError;
      }
      return emptyQueryResult();
    });

    await expect(
      context.runner.runInTransaction(async () => {
        context.events.push('operation');
      }),
    ).rejects.toBe(commitError);

    expect(context.events).toEqual([
      'connect',
      'BEGIN',
      'operation',
      'COMMIT',
      'ROLLBACK',
      'release',
    ]);
    expect(context.release).toHaveBeenCalledTimes(1);
    expect(context.release).toHaveBeenCalledWith(rollbackError);
  });

  it('does not hide the operation error when ROLLBACK also fails', async () => {
    const operationError = new Error('operation failed');
    const rollbackError = new Error('ROLLBACK failed');
    const context = createTestContext(async (text) => {
      if (text === 'ROLLBACK') {
        throw rollbackError;
      }
      return emptyQueryResult();
    });

    await expect(
      context.runner.runInTransaction(async () => {
        context.events.push('operation');
        throw operationError;
      }),
    ).rejects.toBe(operationError);

    expect(context.events).toEqual([
      'connect',
      'BEGIN',
      'operation',
      'ROLLBACK',
      'release',
    ]);
    expect(context.query).not.toHaveBeenCalledWith('COMMIT');
    expect(context.release).toHaveBeenCalledTimes(1);
    expect(context.release).toHaveBeenCalledWith(rollbackError);
  });

  it('uses the same connected client for every operation query', async () => {
    const context = createTestContext();

    await context.runner.runInTransaction(async (transaction) => {
      await transaction.query('SELECT $1::integer', [1]);
      await transaction.query('SELECT $1::integer', [2]);
    });

    expect(context.connect).toHaveBeenCalledTimes(1);
    expect(context.query.mock.calls).toEqual([
      ['BEGIN'],
      ['SELECT $1::integer', [1]],
      ['SELECT $1::integer', [2]],
      ['COMMIT'],
    ]);
    expect(context.release).toHaveBeenCalledTimes(1);
  });
});

describe('DatabaseModule', () => {
  it('exports the transaction runner without exposing PostgresService', () => {
    const exportedProviders = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      DatabaseModule,
    ) as unknown[];

    expect(exportedProviders).toEqual(
      expect.arrayContaining([
        PostgresTransactionRunner,
        PostgresTransactionExecutorAdapter,
        PostgresSecurityAuditRepository,
      ]),
    );
    expect(exportedProviders).not.toContain(PostgresService);
  });
});
