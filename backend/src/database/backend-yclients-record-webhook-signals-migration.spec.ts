import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migrationFile(suffix: string): string {
  return readFileSync(
    resolve(
      __dirname,
      `../../../docs/migrations/032_backend_yclients_record_webhook_signals${suffix}`,
    ),
    'utf8',
  );
}

const MIGRATION = migrationFile('.sql');
const PRECHECK = migrationFile('_PRECHECK.sql');
const POSTCHECK = migrationFile('_POSTCHECK.sql');
const ROLLBACK = migrationFile('_ROLLBACK.sql');
const README = migrationFile('_README.md');

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
}

describe('migration 032 YCLIENTS record webhook signal inbox', () => {
  it('creates only the bounded PII-free coalescing signal relation', () => {
    const sql = compact(MIGRATION);
    const tableDefinition = sql.slice(
      sql.indexOf('create table backend_match.yclients_record_webhook_signals'),
      sql.indexOf('create index yclients_record_webhook_signals_pending_idx'),
    );

    expect(tableDefinition).toContain('primary key (company_id, record_id)');
    expect(tableDefinition).toContain("latest_event_type = 'create'");
    expect(tableDefinition).toContain("latest_event_type = 'update'");
    expect(tableDefinition).toContain("latest_event_type = 'delete'");
    expect(sql).toContain('where reconciled_version < version');
    expect(tableDefinition).not.toMatch(
      /\b(data|client|phone|comment|service|visit|token|header|payload)\b/u,
    );
    expect(sql).not.toMatch(/\b(create|alter|drop)\s+table\s+public\./u);
  });

  it('grants only the exact application columns needed by ingest and reconciliation', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'grant select on table backend_match.yclients_record_webhook_signals to backend_auth_app',
    );
    expect(sql).toContain(
      'grant insert ( company_id, record_id, latest_event_type, first_received_at, last_received_at, delivery_count, version ) on backend_match.yclients_record_webhook_signals to backend_auth_app',
    );
    expect(sql).toContain(
      'grant update ( latest_event_type, last_received_at, delivery_count, version, reconciled_version, last_reconciled_at ) on backend_match.yclients_record_webhook_signals to backend_auth_app',
    );
    expect(sql).not.toContain(
      'grant insert on table backend_match.yclients_record_webhook_signals',
    );
    expect(sql).not.toContain(
      'grant update on table backend_match.yclients_record_webhook_signals',
    );
    expect(sql).not.toContain(
      'grant delete on table backend_match.yclients_record_webhook_signals',
    );
    expect(sql).toContain(
      'v_actual_insert_columns is distinct from v_expected_insert_columns',
    );
    expect(sql).toContain(
      'v_actual_update_columns is distinct from v_expected_update_columns',
    );
  });

  it('keeps PRECHECK and POSTCHECK read-only and validates exact catalog boundaries', () => {
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);

    expect(precheck).toContain('begin read only');
    expect(precheck).toContain('migration 032 target already exists');
    expect(postcheck).toContain('begin read only');
    expect(postcheck).toContain('v_actual_columns is distinct from v_expected_columns');
    expect(postcheck).toContain(
      'v_actual_constraints is distinct from v_expected_constraints',
    );
    expect(postcheck).toContain('index_row.indkey::text = \'5 1 2\'');
    expect(postcheck).toContain(
      'v_actual_insert_columns is distinct from v_expected_insert_columns',
    );
    expect(postcheck).toContain(
      'v_actual_update_columns is distinct from v_expected_update_columns',
    );
    expect(postcheck).toContain('migration 032 target must start empty');
  });

  it('refuses rollback after any webhook signal is stored', () => {
    const sql = compact(ROLLBACK);

    expect(sql).toContain(
      'lock table backend_match.yclients_record_webhook_signals in access exclusive mode',
    );
    expect(sql).toContain(
      'rollback_refused: yclients webhook history exists; use a forward migration',
    );
    expect(sql).not.toContain('cascade');
  });

  it('documents disabled-first rollout and authenticated reconciliation', () => {
    const runbook = compact(README);

    expect(runbook).toContain('yclients_webhook_enabled=false');
    expect(runbook).toContain(
      'https://app.prostopdl.ru/api/v1/integrations/yclients/webhook',
    );
    expect(runbook).toContain('untrusted hint');
    expect(runbook).toContain('authenticated yclients api reads');
    expect(README).toContain('The webhook `data` object is deliberately discarded');
    expect(runbook).toContain('100,000-row safety limit');
    expect(runbook).toContain('backup');
    expect(runbook).toContain('precheck');
    expect(runbook).toContain('postcheck');
  });
});
