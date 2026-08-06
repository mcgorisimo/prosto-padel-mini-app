import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migrationFile(suffix: string): string {
  return readFileSync(
    resolve(
      __dirname,
      `../../../docs/migrations/033_backend_reservation_persistence${suffix}`,
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

function tableDefinition(sql: string, table: string, nextMarker: string): string {
  return sql.slice(
    sql.indexOf(`create table backend_reservation.${table}`),
    sql.indexOf(nextMarker),
  );
}

describe('migration 033 backend reservation persistence contract', () => {
  it('is expand-only and creates exactly the approved isolated relations', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'create schema backend_reservation authorization backend_auth_owner',
    );
    expect(sql.match(/create table backend_reservation\./gu)).toHaveLength(4);
    for (const table of [
      'court_reservations',
      'reservation_operations',
      'reservation_operation_client_snapshots',
      'reservation_admin_read_audit_events',
    ]) {
      expect(sql).toContain(`create table backend_reservation.${table}`);
    }
    expect(sql).not.toMatch(/\balter\s+table\b/u);
    expect(sql).not.toMatch(
      /\b(create|alter|drop)\s+(table|schema)\s+(public|backend_auth|backend_match)\b/u,
    );
    expect(sql).not.toMatch(
      /\b(payment_status|owner_paid|hold_amount|prepay|match_id)\b/u,
    );
  });

  it('encodes ownership, idempotency, active-operation, and slot-hold invariants', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'unique (reservation_id, owner_account_id)',
    );
    expect(sql).toContain(
      'foreign key (reservation_id, owner_account_id) references backend_reservation.court_reservations ( reservation_id, owner_account_id )',
    );
    expect(sql).toContain(
      'unique (owner_account_id, idempotency_key)',
    );
    expect(sql).toContain(
      'foreign key (operation_id, owner_account_id, digest_key_version) references backend_reservation.reservation_operations ( operation_id, owner_account_id, client_snapshot_digest_key_version )',
    );
    expect(sql).toContain(
      "create unique index reservation_operations_active_reservation_uq on backend_reservation.reservation_operations (reservation_id) where status = any (array['pending', 'unknown']::text[])",
    );
    expect(sql).toContain('create unique index court_reservations_slot_hold_uq');
    expect(sql).toContain(
      "'pending_confirmation', 'confirmed', 'reschedule_pending', 'cancel_pending', 'unknown'",
    );
    expect(sql).toContain('version bigint not null');
    expect(sql.match(
      /target_datetime = target_datetime_text::pg_catalog\.timestamptz/gu,
    )).toHaveLength(2);
    expect(sql).toContain('reservation_operations_unknown_reconciliation_idx');
  });

  it('keeps provider lookup claims bounded to confirmed contracts', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain('create unique index court_reservations_record_binding_uq');
    expect(sql).toContain(
      'create unique index court_reservations_record_hash_binding_uq',
    );
    expect(sql).toContain(
      'create index reservation_operations_external_api_lookup_idx',
    );
    expect(sql).not.toContain(
      'create unique index reservation_operations_external_api_lookup_idx',
    );
    expect(sql).toContain('create index court_reservations_appointment_lookup_idx');
    expect(sql).not.toContain(
      'create unique index court_reservations_appointment_lookup_idx',
    );
    expect(sql).toContain('external_api_id bigint not null');
    expect(README).toContain('positive server-derived value');
    expect(compact(README)).toContain('non-unique lookup index only');
  });

  it('stores client data and record hashes only as AEAD material and keyed digests', () => {
    const sql = compact(MIGRATION);
    const snapshot = tableDefinition(
      sql,
      'reservation_operation_client_snapshots',
      'create table backend_reservation.reservation_admin_read_audit_events',
    );

    expect(snapshot).toContain('ciphertext bytea not null');
    expect(snapshot).toContain('nonce bytea not null');
    expect(snapshot).toContain('auth_tag bytea not null');
    expect(snapshot).toContain('algorithm text not null');
    expect(snapshot).toContain('encryption_key_version integer not null');
    expect(snapshot).toContain('digest_key_version integer not null');
    expect(snapshot).toContain('aad_version integer not null');
    expect(snapshot).not.toMatch(/\b(full_name|fullname|phone|email)\s+/u);
    expect(sql).not.toMatch(/\b(full_name|fullname|phone|email)\s+(text|bytea)/u);
    expect(sql).not.toMatch(/\brecord_hash\s+(text|bytea)/u);
    expect(sql).not.toMatch(/\b(encryption_key|hmac_key)\s+(text|bytea)/u);
    expect(sql).toContain('pg_catalog.octet_length(client_snapshot_digest) = 32');
    expect(sql).toContain('pg_catalog.octet_length(yclients_record_hash_digest) = 32');
    expect(sql).toContain('pg_catalog.octet_length(provider_record_hash_digest) = 32');
  });

  it('adds a separate PII-free append-only ledger for every admin snapshot read', () => {
    const sql = compact(MIGRATION);
    const audit = tableDefinition(
      sql,
      'reservation_admin_read_audit_events',
      'create index reservation_admin_read_audit_events_actor_time_idx',
    );

    expect(audit).toContain(
      "event_type = 'reservation_client_snapshot_admin_read'",
    );
    expect(audit).toContain("actor_role = 'club_admin'");
    expect(audit).toContain('actor_account_id uuid not null');
    expect(audit).toContain('reservation_id uuid not null');
    expect(audit).toContain('operation_id uuid not null');
    expect(audit).toContain('occurred_at bigint not null');
    expect(audit).toContain('purpose_code text not null');
    expect(audit).toContain('endpoint_code text not null');
    expect(audit).toContain("purpose_code = 'reservation_administration'");
    expect(audit).toContain("endpoint_code = 'admin_reservation_details'");
    expect(audit).toContain('request_id uuid not null');
    expect(audit).toContain('correlation_id uuid');
    expect(audit).not.toMatch(
      /\b(full_name|fullname|phone|email|ciphertext|nonce|auth_tag|payload|json)\b/u,
    );
    expect(sql).toContain(
      'reservation_admin_read_audit_events_update_delete_guard',
    );
    expect(sql).toContain('reservation_admin_read_audit_events_truncate_guard');
    expect(sql).toContain(
      'grant insert ( event_id, event_type, actor_account_id, actor_role, reservation_id, operation_id, occurred_at, purpose_code, endpoint_code, request_id, correlation_id ) on backend_reservation.reservation_admin_read_audit_events to backend_auth_app',
    );
    expect(sql).not.toContain(
      'grant select on table backend_reservation.reservation_admin_read_audit_events',
    );
    expect(sql).not.toMatch(
      /grant update \([^)]*\) on backend_reservation\.reservation_admin_read_audit_events/u,
    );
    expect(sql).not.toContain(
      'grant update on table backend_reservation.reservation_admin_read_audit_events',
    );
    expect(sql).not.toContain(
      'grant delete on table backend_reservation.reservation_admin_read_audit_events',
    );
    expect(sql).not.toMatch(/alter table backend_auth\.security_audit_events/u);
  });

  it('keeps checks read-only and rollback fail-closed after the first write', () => {
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const rollback = compact(ROLLBACK);

    expect(precheck).toContain('begin read only');
    expect(precheck).toContain('migration 033 target already exists');
    expect(postcheck).toContain('begin read only');
    expect(postcheck).toContain(
      'v_actual_columns is distinct from v_expected.columns',
    );
    expect(postcheck).toContain(
      'v_actual_constraints is distinct from v_expected.constraints',
    );
    expect(postcheck).toContain(
      'v_actual_indexes is distinct from v_expected.indexes',
    );
    expect(postcheck).toContain('migration 033 target must start empty');
    expect(rollback).toContain('lock table');
    expect(rollback).toContain(
      'rollback_refused: reservation or audit history exists; use a forward migration',
    );
    expect(rollback).not.toContain('cascade');
  });

  it('documents unapplied review-only ordering and deferred runtime wiring', () => {
    const runbook = compact(README);

    expect(runbook).toContain('prepared_for_review');
    expect(runbook).toContain('not_applied');
    expect(runbook).toContain('must not be run');
    expect(runbook).toContain('precheck');
    expect(runbook).toContain('postcheck');
    expect(runbook).toContain('backup');
    expect(runbook).toContain('backend rbac');
    expect(runbook).toContain('fail-closed insertion');
    expect(runbook).toContain('no `cascade`');
    expect(runbook).toContain('runtime remains disconnected');
  });
});
