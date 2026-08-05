import { Injectable } from '@nestjs/common';
import { YclientsRecordWebhookSignal } from '../integrations/yclients/yclients-webhook.types';
import { PostgresTransaction } from './postgres-transaction';
import {
  RecordYclientsWebhookSignalOutcome,
  YclientsWebhookSignalRepository,
} from './yclients-webhook-signal.repository';

const MAX_SIGNALS_PER_COMPANY = 100_000;

const LOCK_COMPANY_INBOX_SQL = `
  SELECT pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'backend_match:yclients_record_webhook_signals:'::text || $1::text,
      0::bigint
    )
  ) AS locked
`;

const RECORD_SIGNAL_SQL = `
  INSERT INTO backend_match.yclients_record_webhook_signals (
    company_id,
    record_id,
    latest_event_type,
    first_received_at,
    last_received_at,
    delivery_count,
    version
  )
  SELECT $1, $2, $3, $4, $4, 1, 1
  WHERE
    EXISTS (
      SELECT 1
      FROM backend_match.yclients_record_webhook_signals existing
      WHERE existing.company_id = $1
        AND existing.record_id = $2
    )
    OR (
      SELECT pg_catalog.count(*)
      FROM backend_match.yclients_record_webhook_signals existing
      WHERE existing.company_id = $1
    ) < $5
  ON CONFLICT (company_id, record_id) DO UPDATE
  SET
    latest_event_type = EXCLUDED.latest_event_type,
    last_received_at = pg_catalog.greatest(
      backend_match.yclients_record_webhook_signals.last_received_at,
      EXCLUDED.last_received_at
    ),
    delivery_count =
      backend_match.yclients_record_webhook_signals.delivery_count + 1,
    version = backend_match.yclients_record_webhook_signals.version + 1
  RETURNING company_id
`;

@Injectable()
export class PostgresYclientsWebhookSignalRepository
  implements YclientsWebhookSignalRepository
{
  async recordSignal(
    transaction: PostgresTransaction,
    signal: YclientsRecordWebhookSignal,
  ): Promise<RecordYclientsWebhookSignalOutcome> {
    await transaction.query(LOCK_COMPANY_INBOX_SQL, [signal.companyId]);
    const result = await transaction.query(RECORD_SIGNAL_SQL, [
      signal.companyId,
      signal.recordId,
      signal.eventType,
      signal.receivedAt,
      MAX_SIGNALS_PER_COMPANY,
    ]);

    return result.rowCount === 1 ? 'recorded' : 'capacity_exceeded';
  }
}
