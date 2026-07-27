import { Injectable } from '@nestjs/common';
import {
  PoolClient,
  QueryResult,
  QueryResultRow,
} from 'pg';
import { PostgresService } from './postgres.service';

export interface PostgresTransaction {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export type PostgresTransactionCommitCheckpoint =
  | 'transaction_before_commit'
  | 'transaction_commit_success'
  | 'transaction_commit_failed';

export type PostgresTransactionCommitObserver = (
  checkpoint: PostgresTransactionCommitCheckpoint,
) => void;

function notifyCommitObserver(
  observer: PostgresTransactionCommitObserver | undefined,
  checkpoint: PostgresTransactionCommitCheckpoint,
): void {
  if (observer === undefined) {
    return;
  }

  try {
    observer(checkpoint);
  } catch {
    // Transaction diagnostics are best-effort and never alter persistence.
  }
}

class PoolClientPostgresTransaction implements PostgresTransaction {
  constructor(private readonly client: PoolClient) {}

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.client.query<Row, unknown[]>(text, [...values]);
  }
}

@Injectable()
export class PostgresTransactionRunner {
  constructor(private readonly postgres: PostgresService) {}

  async runInTransaction<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
    commitObserver?: PostgresTransactionCommitObserver,
  ): Promise<T> {
    const client = await this.postgres.getPool().connect();
    let releaseError: Error | undefined;

    try {
      await client.query('BEGIN');

      try {
        const transaction = new PoolClientPostgresTransaction(client);
        const result = await operation(transaction);
        notifyCommitObserver(commitObserver, 'transaction_before_commit');
        try {
          await client.query('COMMIT');
        } catch (error) {
          notifyCommitObserver(commitObserver, 'transaction_commit_failed');
          throw error;
        }
        notifyCommitObserver(commitObserver, 'transaction_commit_success');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          releaseError =
            rollbackError instanceof Error
              ? rollbackError
              : new Error('PostgreSQL rollback failed', {
                  cause: rollbackError,
                });
        }

        throw error;
      }
    } finally {
      client.release(releaseError);
    }
  }
}
