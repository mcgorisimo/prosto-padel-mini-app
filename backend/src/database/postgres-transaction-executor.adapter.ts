import { TransactionExecutor } from '../auth/telegram-login.ports';
import {
  PostgresTransaction,
  PostgresTransactionRunner,
} from './postgres-transaction';

export class PostgresTransactionExecutorAdapter implements TransactionExecutor {
  constructor(private readonly runner: PostgresTransactionRunner) {}

  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> {
    return this.runner.runInTransaction(operation);
  }
}
