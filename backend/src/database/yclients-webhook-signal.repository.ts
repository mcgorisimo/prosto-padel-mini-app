import { PostgresTransaction } from './postgres-transaction';
import { YclientsRecordWebhookSignal } from '../integrations/yclients/yclients-webhook.types';

export type RecordYclientsWebhookSignalOutcome =
  | 'recorded'
  | 'capacity_exceeded';

export interface YclientsWebhookSignalRepository {
  recordSignal(
    transaction: PostgresTransaction,
    signal: YclientsRecordWebhookSignal,
  ): Promise<RecordYclientsWebhookSignalOutcome>;
}
