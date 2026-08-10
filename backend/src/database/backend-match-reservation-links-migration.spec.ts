import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migrationFile(suffix: string): string {
  return readFileSync(
    resolve(
      __dirname,
      `../../../docs/migrations/034_backend_match_reservation_links${suffix}`,
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

function tableDefinition(
  sql: string,
  table: string,
  nextMarker: string,
): string {
  return sql.slice(
    sql.indexOf(`create table backend_match.${table}`),
    sql.indexOf(nextMarker),
  );
}

describe('migration 034 backend match reservation links contract', () => {
  it('creates only the approved PII-free D3 storage and leaves runtime disconnected', () => {
    const sql = compact(MIGRATION);

    expect(sql.match(/create table backend_match\./gu)).toHaveLength(3);
    for (const table of [
      'match_reservation_links',
      'match_reservation_events',
      'match_reservation_event_recipients',
    ]) {
      expect(sql).toContain(`create table backend_match.${table}`);
    }
    expect(sql).not.toMatch(
      /\b(full_name|fullname|phone|email|ciphertext|auth_tag|record_hash)\s+(text|bytea)/u,
    );
    expect(sql).not.toMatch(
      /\b(payment_status|owner_paid|hold_amount|prepay|supabase)\b/u,
    );
    expect(sql).not.toMatch(/\b(create|alter|drop)\s+table\s+public\./u);
    expect(compact(README)).toContain('runtime: `disconnected`');
    expect(compact(README)).toContain('no yclients call');
  });

  it('makes D2 the only court collision authority and enforces active one-to-one ownership', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'drop constraint matches_no_active_court_overlap',
    );
    expect(sql).toContain(
      'add constraint matches_id_owner_account_key unique (id, owner_account_id)',
    );
    expect(sql).toContain(
      'foreign key (match_id, owner_account_id) references backend_match.matches (id, owner_account_id)',
    );
    expect(sql).toContain(
      'foreign key (reservation_id, owner_account_id) references backend_reservation.court_reservations ( reservation_id, owner_account_id )',
    );
    expect(sql).toContain(
      "create unique index match_reservation_links_active_match_uq on backend_match.match_reservation_links (match_id) where state = 'active'",
    );
    expect(sql).toContain(
      "create unique index match_reservation_links_active_reservation_uq on backend_match.match_reservation_links (reservation_id) where state = 'active'",
    );
    expect(compact(README)).toContain(
      'd2 `reservation_slot_holds` remains the only database court-collision authority',
    );
  });

  it('requires canonical current D2 confirmation and full provider binding at commit', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain('guard_match_reservation_link_transition');
    expect(sql).toContain("v_reservation.status <> 'confirmed'");
    for (const field of [
      'yclients_appointment_id',
      'yclients_record_id',
      'yclients_record_hash_ciphertext',
      'yclients_record_hash_nonce',
      'yclients_record_hash_auth_tag',
      'yclients_record_hash_algorithm',
      'yclients_record_hash_encryption_key_version',
      'yclients_record_hash_digest',
      'yclients_record_hash_digest_key_version',
    ]) {
      expect(sql).toContain(`reservation_row.${field}`);
    }
    expect(sql).toContain(
      'link_row.observed_reservation_version <> reservation_row.version',
    );
    expect(sql).toContain(
      'create constraint trigger match_reservation_links_consistency',
    );
    expect(sql).toContain(
      'create constraint trigger matches_reservation_link_consistency',
    );
    expect(sql).toContain(
      'create constraint trigger court_reservations_match_link_consistency',
    );
    expect(sql.match(/deferrable initially deferred/gu)).toHaveLength(6);
  });

  it('keeps provider identity immutable and releases only from canonical bounded proof', () => {
    const sql = compact(MIGRATION);
    const links = tableDefinition(
      sql,
      'match_reservation_links',
      'create unique index match_reservation_links_active_match_uq',
    );

    expect(links).toContain(
      "release_reason is not null and release_reason = any (array[ 'canonical_reservation_cancelled', 'match_terminal' ]::text[])",
    );
    expect(sql).toContain(
      'new.released_at is null or new.release_reason is null',
    );
    expect(sql).toContain(
      'backend_match_reservation_link_identity_immutable',
    );
    expect(sql).toContain(
      'backend_match_reservation_link_released_immutable',
    );
    expect(sql).toContain(
      'backend_match_reservation_link_no_churn_required',
    );
    expect(sql).toContain(
      'backend_match_reservation_link_move_version_conflict',
    );
    expect(sql).toContain(
      "new.release_reason = 'canonical_reservation_cancelled'",
    );
    expect(sql).toContain("v_reservation.status <> 'cancelled'");
    expect(sql).toContain("new.release_reason = 'match_terminal'");
    expect(sql).toContain(
      "v_match_status <> all (array['completed', 'cancelled']::text[])",
    );
    expect(sql).not.toMatch(
      /grant update \([^)]*(provider_appointment_id|provider_record_id|match_id|reservation_id|owner_account_id)[^)]*\) on backend_match\.match_reservation_links/u,
    );
  });

  it('stores deduplicated immutable lifecycle events for organizer and active participants', () => {
    const sql = compact(MIGRATION);
    const events = tableDefinition(
      sql,
      'match_reservation_events',
      'create index match_reservation_events_match_time_idx',
    );

    expect(events).toContain(
      'unique ( link_id, event_type, reservation_version )',
    );
    expect(events).toContain(
      "event_type = any (array[ 'court_confirmed', 'court_moved', 'court_cancelled' ]::text[])",
    );
    expect(events).toContain('previous_service_id bigint');
    expect(events).toContain('current_service_id bigint');
    expect(events).toContain('expected_recipient_count smallint not null');
    expect(events).not.toMatch(
      /\b(full_name|fullname|phone|email|ciphertext|record_hash)\b/u,
    );
    expect(sql).toContain(
      'match_row.owner_account_id = new.recipient_account_id',
    );
    expect(sql).toContain("participant_row.status = 'active'");
    expect(sql).toContain(
      'backend_match_reservation_recipient_set_incomplete',
    );
    expect(sql.match(/recipients?_count_consistency/gu)).toHaveLength(2);
    expect(sql).toContain(
      'primary key ( event_id, recipient_account_id )',
    );
    expect(sql).toContain('backend_match_reservation_history_immutable');
    expect(sql).toContain('backend_match_reservation_event_chain_invalid');
    expect(sql).toContain(
      'backend_match_reservation_confirmed_event_required',
    );
    expect(sql).toContain(
      'backend_match_reservation_moved_event_required',
    );
    expect(sql).toContain(
      'backend_match_reservation_cancelled_event_required',
    );
    expect(sql).toContain(
      'backend_match_reservation_recipient_transition_invalid',
    );
  });

  it('grants narrow runtime columns and no delete/truncate authority', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'revoke all on table backend_match.match_reservation_links, backend_match.match_reservation_events, backend_match.match_reservation_event_recipients from public, backend_auth_app',
    );
    expect(sql).toContain(
      'grant select on table backend_match.match_reservation_links, backend_match.match_reservation_events, backend_match.match_reservation_event_recipients to backend_auth_app',
    );
    expect(sql).toContain('grant update ( read_at, version )');
    expect(sql).not.toContain(
      'grant delete on table backend_match.match_reservation_links',
    );
    expect(sql).not.toContain(
      'grant delete on table backend_match.match_reservation_events',
    );
    expect(sql).not.toContain(
      'grant truncate on table backend_match.match_reservation_event_recipients',
    );
    expect(sql).toContain(
      'revoke all on function backend_match.guard_match_reservation_link_transition()',
    );
  });

  it('provides read-only checks and a locked fail-closed rollback', () => {
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const rollback = compact(ROLLBACK);

    expect(precheck).toContain('begin read only');
    expect(precheck).toContain('migration 034 target already exists');
    expect(precheck).toContain('legacy match overlap constraint differs');
    expect(precheck).toContain('d2 canonical slot hold authority differs');
    expect(postcheck).toContain('begin read only');
    expect(postcheck).toContain('v_actual is distinct from v_expected.columns');
    expect(postcheck).toContain('v_actual is distinct from v_expected.constraints');
    expect(postcheck).toContain('v_actual is distinct from v_expected.indexes');
    expect(postcheck).toContain('migration 034 target must start empty');
    expect(postcheck).toContain("'runtime_connected', false");
    expect(rollback).toContain('lock table');
    expect(rollback).toContain('in access exclusive mode');
    expect(rollback).toContain(
      'rollback_refused: match-reservation history exists; use a forward migration',
    );
    expect(rollback).toContain(
      'add constraint matches_no_active_court_overlap',
    );
    expect(rollback).not.toContain('cascade');
  });

  it('documents review-only ordering, backup, and a separate runtime gate', () => {
    const runbook = compact(README);

    expect(runbook).toContain('prepared_for_review');
    expect(runbook).toContain('not_applied');
    expect(runbook).toContain('must not be run');
    expect(runbook).toContain('restorable postgresql backup');
    expect(runbook).toContain('precheck');
    expect(runbook).toContain('on_error_stop=1');
    expect(runbook).toContain('postcheck');
    expect(runbook).toContain('runtime remains disconnected');
    expect(runbook).toContain('do not combine migration application with backend deployment');
    expect(runbook).toContain('contains no `cascade`');
    expect(runbook).toContain('forward migration');
  });
});
