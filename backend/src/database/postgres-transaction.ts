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
  ): Promise<T> {
    const client = await this.postgres.getPool().connect();
    let releaseError: Error | undefined;

    try {
      await client.query('BEGIN');

      try {
        const transaction = new PoolClientPostgresTransaction(client);
        const result = await operation(transaction);
        await client.query('COMMIT');
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
