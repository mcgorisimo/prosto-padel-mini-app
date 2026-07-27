import { TransactionExecutor } from '../auth/telegram-login.ports';
import {
  PostgresTransaction,
  PostgresTransactionCommitObserver,
  PostgresTransactionRunner,
} from './postgres-transaction';

export class PostgresTransactionExecutorAdapter implements TransactionExecutor {
  constructor(private readonly runner: PostgresTransactionRunner) {}

  run<T>(
    operation: (transaction: PostgresTransaction) => Promise<T>,
    commitObserver?: PostgresTransactionCommitObserver,
  ): Promise<T> {
    return this.runner.runInTransaction(operation, commitObserver);
  }
}
