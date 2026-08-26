import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migrationFile(suffix: string): string {
  return readFileSync(
    resolve(
      __dirname,
      '../../../docs/migrations/' +
        '042_backend_contact_verification_persistence' +
        suffix,
    ),
    'utf8',
  );
}

const MIGRATION = migrationFile('.sql');
const PRECHECK = migrationFile('_PRECHECK.sql');
const POSTCHECK = migrationFile('_POSTCHECK.sql');
const ROLLBACK = migrationFile('_ROLLBACK.sql');
const README = migrationFile('_README.md');
const SQL_ARTIFACTS = [MIGRATION, PRECHECK, POSTCHECK, ROLLBACK];

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
}

function between(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex <= startIndex) {
    throw new Error(`Migration section is missing: ${start}`);
  }
  return value.slice(startIndex, endIndex);
}

function tableDefinition(table: string, nextMarker: string): string {
  return compact(
    between(
      MIGRATION,
      `create table backend_auth.${table}`,
      nextMarker,
    ),
  );
}

function tableColumns(table: string, nextMarker: string): readonly string[] {
  const definition = between(
    MIGRATION,
    `create table backend_auth.${table}`,
    nextMarker,
  );
  return Array.from(
    definition.matchAll(
      /^  (?!constraint\b)([a-z][a-z0-9_]*)\s+[a-z][a-z0-9_.]*(?:\[\])?\b/gmu,
    ),
    (match) => match[1],
  );
}

describe('migration 042 backend contact verification persistence contract', () => {
  it('is one ordered expand-only package with exactly the six approved tables', () => {
    const sql = compact(MIGRATION);
    const orderedMarkers = [
      'do $preconditions$',
      'set local role backend_auth_owner',
      'create table backend_auth.account_contacts',
      'create table backend_auth.contact_verification_challenges',
      'create table backend_auth.contact_verification_commands',
      'create table backend_auth.contact_verification_dispatches',
      'alter table backend_auth.contact_verification_challenges',
      'create table backend_auth.contact_verification_rate_buckets',
      'create table backend_auth.contact_verification_audit',
      'create function backend_auth.guard_account_contact_transition()',
      'revoke all on table',
      'do $comments$',
      'do $assertions$',
      'commit',
    ];

    expect(sql.match(/create table backend_auth\./gu)).toHaveLength(6);
    expect(sql.match(/create function backend_auth\./gu)).toHaveLength(4);
    for (const table of [
      'account_contacts',
      'contact_verification_challenges',
      'contact_verification_commands',
      'contact_verification_dispatches',
      'contact_verification_rate_buckets',
      'contact_verification_audit',
    ]) {
      expect(sql).toContain(`create table backend_auth.${table}`);
    }
    for (let index = 1; index < orderedMarkers.length; index += 1) {
      expect(sql.indexOf(orderedMarkers[index - 1])).toBeLessThan(
        sql.indexOf(orderedMarkers[index]),
      );
    }
    expect(sql).not.toContain('create schema');
    expect(sql).not.toMatch(
      /\b(?:insert\s+into|update\s+backend_auth\.|delete\s+from|truncate\s+table)\b/u,
    );
    expect(sql).not.toMatch(
      /\b(?:create|alter|drop)\s+(?:table|schema)\s+(?:public|backend_match|backend_reservation)\b/u,
    );
    expect(sql.match(/alter table backend_auth\./gu)).toEqual([
      'alter table backend_auth.',
    ]);
    expect(sql).not.toMatch(/\b(?:drop|rename)\s+(?:table|schema|column)\b/u);
    expect(sql).not.toContain('cascade');
  });

  it('pins an exact privacy-reviewed column allowlist for every new table', () => {
    const expectedColumns = {
      account_contacts: [
        'account_id',
        'field',
        'contact_version',
        'subject_digest',
        'subject_digest_key_version',
        'value_ciphertext',
        'value_nonce',
        'value_auth_tag',
        'value_algorithm',
        'value_key_version',
        'lock_version',
        'created_at',
        'changed_at',
        'updated_at',
      ],
      contact_verification_challenges: [
        'challenge_id',
        'account_id',
        'field',
        'method',
        'purpose',
        'contact_version',
        'subject_digest',
        'subject_digest_key_version',
        'verifier_digest',
        'verifier_digest_key_version',
        'proof_ciphertext',
        'proof_nonce',
        'proof_auth_tag',
        'proof_algorithm',
        'proof_key_version',
        'proof_expires_at',
        'create_idempotency_key',
        'create_request_digest',
        'create_request_digest_key_version',
        'ttl_seconds',
        'max_attempts',
        'attempts_remaining',
        'resend_cooldown_seconds',
        'starts_per_15_minutes',
        'starts_per_24_hours',
        'state',
        'cancel_reason',
        'verified_command_id',
        'verified_at',
        'terminal_at',
        'last_dispatch_at',
        'resend_not_before_at',
        'resend_count',
        'last_command_sequence',
        'lock_version',
        'created_at',
        'expires_at',
        'status_changed_at',
        'updated_at',
      ],
      contact_verification_commands: [
        'challenge_id',
        'command_id',
        'sequence',
        'command_type',
        'request_digest',
        'request_digest_key_version',
        'presented_digest',
        'presented_digest_key_version',
        'resend_idempotency_key',
        'rate_limit_decision_id',
        'dispatch_id',
        'cancel_reason',
        'result_code',
        'result_attempts_remaining',
        'applied_at',
      ],
      contact_verification_dispatches: [
        'dispatch_id',
        'challenge_id',
        'account_id',
        'field',
        'method',
        'purpose',
        'challenge_expires_at',
        'dispatch_kind',
        'command_id',
        'status',
        'payload_ciphertext',
        'payload_nonce',
        'payload_auth_tag',
        'payload_algorithm',
        'payload_key_version',
        'payload_digest',
        'payload_digest_key_version',
        'payload_expires_at',
        'reconciliation_ref_ciphertext',
        'reconciliation_ref_nonce',
        'reconciliation_ref_auth_tag',
        'reconciliation_ref_algorithm',
        'reconciliation_ref_key_version',
        'reconciliation_ref_digest',
        'reconciliation_ref_digest_key_version',
        'reconciliation_ref_expires_at',
        'claim_digest',
        'claim_digest_key_version',
        'claimed_at',
        'claim_expires_at',
        'reconciliation_attempts',
        'last_reconciled_at',
        'retry_at',
        'reserved_at',
        'status_changed_at',
        'outcome_at',
        'invalidated_at',
        'lock_version',
        'created_at',
        'updated_at',
      ],
      contact_verification_rate_buckets: [
        'field',
        'method',
        'purpose',
        'scope',
        'subject_digest',
        'subject_digest_key_version',
        'operation',
        'window_started_at',
        'window_seconds',
        'limit_count',
        'consumed_count',
        'cooldown_until',
        'last_decision_id',
        'lock_version',
        'created_at',
        'updated_at',
      ],
      contact_verification_audit: [
        'event_id',
        'event_type',
        'occurred_at',
        'account_id',
        'challenge_id',
        'dispatch_id',
        'decision_id',
        'field',
        'method',
        'purpose',
        'operation',
        'contact_version',
        'outcome',
      ],
    } as const;
    const nextMarkers = {
      account_contacts: 'create table backend_auth.contact_verification_challenges',
      contact_verification_challenges:
        'create unique index contact_verification_challenges_one_active_uq',
      contact_verification_commands:
        'create unique index contact_verification_commands_resend_key_uq',
      contact_verification_dispatches:
        'create unique index contact_verification_dispatches_start_uq',
      contact_verification_rate_buckets:
        'create index contact_verification_rate_buckets_scope_window_idx',
      contact_verification_audit:
        'create index contact_verification_audit_account_time_idx',
    } as const;

    for (const table of Object.keys(expectedColumns) as Array<
      keyof typeof expectedColumns
    >) {
      expect(tableColumns(table, nextMarkers[table])).toEqual(
        expectedColumns[table],
      );
    }
  });

  it('binds current encrypted contacts to one owner, field and monotonic version', () => {
    const contacts = tableDefinition(
      'account_contacts',
      'create table backend_auth.contact_verification_challenges',
    );

    expect(contacts).toContain('primary key (account_id, field)');
    expect(contacts).toContain(
      'foreign key (account_id) references backend_auth.accounts (id)',
    );
    expect(contacts).toContain(
      "field = any (array['phone', 'email']::text[])",
    );
    expect(contacts).toContain(
      'contact_version between 1 and 9007199254740991',
    );
    expect(contacts).toContain('subject_digest bytea not null');
    expect(contacts).toContain(
      'subject_digest_key_version integer not null',
    );
    for (const column of [
      'value_ciphertext bytea not null',
      'value_nonce bytea not null',
      'value_auth_tag bytea not null',
      'value_algorithm text not null',
      'value_key_version integer not null',
    ]) {
      expect(contacts).toContain(column);
    }
    expect(contacts).not.toMatch(/\b(?:phone|email)\s+(?:text|varchar|bytea)\b/u);
    expect(contacts).not.toMatch(/\b(?:encryption_key|hmac_key|pepper)\s+/u);
  });

  it('pins closed phone/email methods, contact ownership purpose, policy and proof TTL', () => {
    const challenges = tableDefinition(
      'contact_verification_challenges',
      'create unique index contact_verification_challenges_one_active_uq',
    );
    const sql = compact(MIGRATION);

    expect(challenges).toContain(
      "field = 'phone' and method = 'phone_sms_otp'",
    );
    expect(challenges).toContain(
      "field = 'email' and method = any ( array['email_code', 'email_link']::text[] )",
    );
    expect(challenges).toContain("purpose = 'contact_ownership'");
    expect(challenges).toContain('contact_version bigint not null');
    expect(challenges).toContain('verifier_digest bytea not null');
    expect(challenges).toContain('verifier_digest_key_version integer not null');
    expect(challenges).toContain('create_request_digest bytea not null');
    expect(challenges).toContain(
      'create_request_digest_key_version integer not null',
    );
    expect(challenges).toContain('ttl_seconds between 1 and 600');
    expect(challenges).toContain('ttl_seconds between 1 and 900');
    expect(challenges).toContain('max_attempts between 1 and 5');
    expect(challenges).toContain('attempts_remaining between 0 and max_attempts');
    expect(challenges).toContain('resend_cooldown_seconds = 60');
    expect(challenges).toContain('starts_per_15_minutes = 3');
    expect(challenges).toContain('starts_per_24_hours = 10');
    expect(challenges).toContain(
      'proof_expires_at between created_at + 1 and expires_at',
    );
    expect(challenges).toContain('ttl_seconds = expires_at - created_at');
    expect(sql).toContain(
      'create unique index contact_verification_challenges_one_active_uq on backend_auth.contact_verification_challenges (account_id, field) where state = \'pending\'',
    );
    expect(sql).toContain(
      'unique (account_id, field, create_idempotency_key)',
    );
    expect(sql).not.toContain(
      'contact_verification_challenges_one_active_uq on backend_auth.contact_verification_challenges ( account_id, field, method',
    );
  });

  it('keeps terminal proof binding exact and erases encrypted active proof', () => {
    const challenges = tableDefinition(
      'contact_verification_challenges',
      'create unique index contact_verification_challenges_one_active_uq',
    );
    const sql = compact(MIGRATION);

    expect(challenges).toContain(
      "state = any (array[ 'pending', 'verified', 'expired', 'attempts_exhausted', 'cancelled' ]::text[])",
    );
    expect(challenges).toContain(
      "state = 'verified' and proof_ciphertext is null",
    );
    expect(challenges).toContain('verified_command_id is not null');
    expect(challenges).toContain('terminal_at = verified_at');
    expect(challenges).toContain('verified_at < expires_at');
    expect(challenges).toContain(
      "state = 'attempts_exhausted' and attempts_remaining = 0 and proof_ciphertext is null",
    );
    expect(sql).toContain(
      'foreign key (challenge_id, verified_command_id) references backend_auth.contact_verification_commands ( challenge_id, command_id )',
    );
    expect(sql).toContain('backend_contact_challenge_terminal_immutable');
    expect(sql).toContain('backend_contact_proof_envelope_immutable');
    expect(sql).toContain('backend_contact_proof_envelope_restore_forbidden');
    expect(sql).toContain('backend_contact_command_transition_binding_required');
    expect(sql).toContain(
      'backend_contact_recoverable_dispatch_must_be_invalidated',
    );
  });

  it('stores immutable command idempotency and exact retry results without plaintext', () => {
    const commands = tableDefinition(
      'contact_verification_commands',
      'create unique index contact_verification_commands_resend_key_uq',
    );
    const sql = compact(MIGRATION);

    expect(commands).toContain('primary key (challenge_id, command_id)');
    expect(commands).toContain('unique (challenge_id, sequence)');
    expect(commands).toContain('request_digest bytea not null');
    expect(commands).toContain('request_digest_key_version integer not null');
    expect(commands).toContain('presented_digest bytea');
    expect(commands).toContain('presented_digest_key_version integer');
    expect(commands).toContain(
      "command_type = any (array[ 'submit_proof', 'expire', 'reserve_resend', 'cancel' ]::text[])",
    );
    expect(commands).toContain('result_code text not null');
    expect(commands).toContain('result_attempts_remaining integer');
    expect(sql).toContain(
      'create unique index contact_verification_commands_resend_key_uq on backend_auth.contact_verification_commands ( challenge_id, resend_idempotency_key ) where resend_idempotency_key is not null',
    );
    expect(sql).toContain('contact_verification_commands_update_delete_guard');
    expect(sql).toContain('contact_verification_commands_truncate_guard');
    expect(commands).not.toMatch(
      /\b(?:plaintext|otp|token|destination|provider_body|provider_response)\s+(?:text|bytea|json|jsonb)\b/u,
    );
  });

  it('reserves one durable encrypted dispatch and models unknown recovery fail closed', () => {
    const dispatches = tableDefinition(
      'contact_verification_dispatches',
      'create unique index contact_verification_dispatches_start_uq',
    );
    const sql = compact(MIGRATION);

    expect(dispatches).toContain(
      "status = any (array[ 'reserved', 'pending', 'accepted', 'unavailable', 'rate_limited', 'unknown' ]::text[])",
    );
    expect(dispatches).not.toMatch(/'not_found'/u);
    expect(dispatches).toContain(
      "dispatch_kind = 'start' and command_id is null",
    );
    expect(dispatches).toContain(
      "dispatch_kind = 'resend' and command_id is not null",
    );
    expect(dispatches).toContain(
      'foreign key ( challenge_id, command_id, dispatch_id ) references backend_auth.contact_verification_commands',
    );
    for (const prefix of ['payload', 'reconciliation_ref']) {
      for (const suffix of [
        'ciphertext bytea',
        'nonce bytea',
        'auth_tag bytea',
        'algorithm text',
        'key_version integer',
        'digest bytea',
        'digest_key_version integer',
        'expires_at bigint',
      ]) {
        expect(dispatches).toContain(`${prefix}_${suffix}`);
      }
    }
    expect(dispatches).toContain(
      'payload_expires_at between created_at + 1 and challenge_expires_at',
    );
    expect(dispatches).toContain(
      "status = any (array['reserved', 'pending', 'unknown']::text[]) and payload_ciphertext is not null",
    );
    expect(dispatches).toContain(
      "status = any (array['accepted', 'unavailable']::text[]) and payload_ciphertext is null",
    );
    expect(dispatches).toContain('reconciliation_attempts integer not null default 0');
    expect(dispatches).toContain('claim_digest bytea');
    expect(dispatches).toContain('lock_version bigint not null default 1');
    expect(sql).toContain(
      'create unique index contact_verification_dispatches_start_uq on backend_auth.contact_verification_dispatches (challenge_id) where dispatch_kind = \'start\'',
    );
    expect(sql).toContain(
      'create unique index contact_verification_dispatches_resend_command_uq on backend_auth.contact_verification_dispatches (challenge_id, command_id) where command_id is not null',
    );
    expect(sql).toContain('backend_contact_dispatch_envelope_immutable');
    expect(sql).toContain('backend_contact_dispatch_envelope_restore_forbidden');
    expect(sql).toContain(
      'backend_contact_reconciliation_reference_immutable',
    );
  });

  it('pins durable account/contact/network buckets to the approved budgets', () => {
    const buckets = tableDefinition(
      'contact_verification_rate_buckets',
      'create index contact_verification_rate_buckets_scope_window_idx',
    );

    expect(buckets).toContain(
      "scope = any (array['account', 'contact', 'network']::text[])",
    );
    expect(buckets).toContain('subject_digest bytea not null');
    expect(buckets).toContain('subject_digest_key_version integer not null');
    expect(buckets).toContain(
      "operation = 'start' and ( (window_seconds = 900 and limit_count = 3) or (window_seconds = 86400 and limit_count = 10) )",
    );
    expect(buckets).toContain(
      "operation = 'resend' and window_seconds = 60 and limit_count = 1",
    );
    expect(buckets).toContain(
      "operation = 'submit' and limit_count = 5",
    );
    expect(buckets).toContain('consumed_count between 0 and limit_count');
    expect(buckets).toContain('last_decision_id uuid not null');
    expect(buckets).toContain('lock_version bigint not null default 1');
    expect(buckets).toContain(
      'primary key ( field, method, purpose, scope, subject_digest_key_version, subject_digest, operation, window_started_at, window_seconds )',
    );
    expect(buckets).not.toContain('account_id');
    expect(buckets).not.toMatch(/\b(?:ip|network_address|phone|email)\s+text\b/u);
  });

  it('keeps audit append-only, allowlisted and free of PII, proof and delivery material', () => {
    const audit = tableDefinition(
      'contact_verification_audit',
      'create index contact_verification_audit_account_time_idx',
    );
    const sql = compact(MIGRATION);

    for (const event of [
      'challenge_created',
      'delivery_outcome',
      'challenge_transition',
      'rate_limit_decision',
      'contact_invalidated',
    ]) {
      expect(audit).toContain(`event_type = '${event}'`);
    }
    expect(audit).toContain("purpose = 'contact_ownership'");
    expect(audit).toContain(
      "operation = any (array['start', 'resend', 'submit']::text[])",
    );
    expect(audit).toContain(
      'foreign key ( challenge_id, account_id, field, method, purpose ) references backend_auth.contact_verification_challenges',
    );
    expect(audit).toContain(
      'foreign key ( dispatch_id, challenge_id, account_id, field, method, purpose ) references backend_auth.contact_verification_dispatches',
    );
    expect(audit).not.toMatch(
      /\b(?:phone|email|destination|otp|token|digest|idempotency|ciphertext|nonce|auth_tag|provider|response|exception|body|payload|json|jsonb|key_version)\s+(?:text|bytea|json|jsonb|integer|bigint)\b/u,
    );
    expect(sql).toContain('contact_verification_audit_update_delete_guard');
    expect(sql).toContain('contact_verification_audit_truncate_guard');
  });

  it('enforces monotonic challenge/contact/dispatch state and exact resend invariants', () => {
    const sql = compact(MIGRATION);

    for (const marker of [
      'backend_contact_active_verification_must_be_invalidated',
      'backend_contact_challenge_current_contact_mismatch',
      'backend_contact_challenge_binding_immutable',
      'backend_contact_challenge_terminal_immutable',
      'backend_contact_challenge_version_conflict',
      'backend_contact_command_transition_binding_required',
      'backend_contact_command_after_expiry_forbidden',
      'backend_contact_verified_command_binding_invalid',
      'backend_contact_incorrect_proof_command_binding_invalid',
      'backend_contact_attempts_command_binding_invalid',
      'backend_contact_expired_command_binding_invalid',
      'backend_contact_cancel_command_binding_invalid',
      'backend_contact_resend_command_binding_invalid',
      'backend_contact_resend_state_invalid',
      'backend_contact_resend_cooldown_or_proof_invalid',
      'backend_contact_recoverable_dispatch_must_be_invalidated',
      'backend_contact_dispatch_binding_immutable',
      'backend_contact_dispatch_terminal_immutable',
      'backend_contact_dispatch_version_conflict',
      'backend_contact_dispatch_transition_invalid',
      'backend_contact_rate_bucket_binding_immutable',
      'backend_contact_rate_bucket_version_conflict',
      'backend_contact_rate_decision_binding_invalid',
    ]) {
      expect(sql).toContain(marker);
    }
    expect(sql).toContain('new.contact_version <> old.contact_version + 1');
    expect(sql).toContain('new.lock_version <> old.lock_version + 1');
    expect(sql).toContain(
      'before insert or update or delete on backend_auth.contact_verification_challenges',
    );
    expect(sql).toContain(
      'contact.contact_version = new.contact_version and contact.subject_digest = new.subject_digest and contact.subject_digest_key_version = new.subject_digest_key_version for share',
    );
    expect(sql).toContain(
      'command.sequence = new.last_command_sequence',
    );
    expect(sql).toContain(
      'new.last_command_sequence <> old.last_command_sequence + 1',
    );
    expect(sql).toContain(
      'v_command.presented_digest is distinct from old.verifier_digest',
    );
    expect(sql).toContain(
      "v_command.result_code <> 'expired' and v_command.applied_at >= old.expires_at",
    );
    expect(sql).toContain(
      'new.attempts_remaining not in ( old.attempts_remaining, old.attempts_remaining - 1 )',
    );
    expect(sql).toContain('new.resend_count <> old.resend_count + 1');
    expect(sql).toContain(
      'new.attempts_remaining <> old.attempts_remaining',
    );
    expect(sql).toContain(
      'new.verifier_digest is distinct from old.verifier_digest',
    );
  });

  it('leaves all runtime and provider privileges disconnected', () => {
    const sql = compact(MIGRATION);
    const postcheck = compact(POSTCHECK);

    expect(sql).not.toMatch(/\bgrant\b/u);
    expect(sql).toContain(
      'revoke all on table backend_auth.account_contacts, backend_auth.contact_verification_challenges, backend_auth.contact_verification_commands, backend_auth.contact_verification_dispatches, backend_auth.contact_verification_rate_buckets, backend_auth.contact_verification_audit from public, backend_auth_app',
    );
    expect(sql).toContain('do $acl_lockdown$');
    expect(sql).toContain(
      "'revoke all privileges on table %s from %i'",
    );
    expect(sql).toContain(
      "'revoke all privileges on function %s from %i'",
    );
    for (const artifact of [sql, postcheck]) {
      expect(artifact).toContain(
        "relation_row.relowner is distinct from pg_catalog.to_regrole('backend_auth_owner')::oid",
      );
      expect(artifact).toContain(
        'acl.grantee <> relation_row.relowner',
      );
      expect(artifact).toContain(
        'acl.grantee <> function_row.proowner',
      );
    }
    for (const artifact of SQL_ARTIFACTS.map(compact)) {
      expect(artifact).not.toContain('supabase');
      expect(artifact).not.toContain('yclients');
      expect(artifact).not.toMatch(
        /\b(?:payment_status|owner_paid|hold_amount|prepay)\b/u,
      );
      expect(artifact).not.toContain('http://');
      expect(artifact).not.toContain('https://');
    }
  });

  it('provides read-only gates and a strictly non-destructive rollback boundary', () => {
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const rollback = compact(ROLLBACK);

    for (const gate of [precheck, postcheck, rollback]) {
      expect(gate).toContain('begin read only');
      expect(gate).toMatch(/rollback;\s*$/u);
    }
    expect(precheck).toContain(
      "'base_commit', '0fe9cfde914703cb7c61fe8589f98f0bbdcde60c'",
    );
    expect(precheck).toContain('migration 042 target already exists');
    expect(postcheck).toContain('migration 042 target must remain empty');
    expect(postcheck).toContain("'runtime_connected', false");
    expect(postcheck).toContain("'provider_selected', false");
    expect(postcheck).toContain("'function_fingerprints'");
    expect(postcheck).toContain(
      "function_row.proowner is distinct from pg_catalog.to_regrole('backend_auth_owner')::oid",
    );
    expect(postcheck).toContain('function_row.prosecdef');
    expect(postcheck).toContain("function_row.provolatile <> 'v'");
    expect(postcheck).toContain(
      "array['search_path=pg_catalog, pg_temp']::text[]",
    );
    expect(postcheck).toContain(
      "pg_catalog.has_function_privilege( 'public', v_function_oid, 'execute' )",
    );
    expect(postcheck).toContain(
      "pg_catalog.has_function_privilege( 'backend_auth_app', v_function_oid, 'execute' )",
    );
    expect(rollback).toContain(
      'rollback_unsupported: migration 042 requires a reviewed forward migration',
    );
    expect(rollback).toContain("'destructive_actions', false");
    expect(rollback).not.toMatch(
      /\b(?:drop|alter|create|truncate|delete|update|insert|grant|revoke)\s+(?:table|schema|function|into|backend_auth\.)\b/u,
    );
    expect(rollback).not.toContain('cascade');
  });

  it('documents exact ordering, not-applied status and all deferred gates', () => {
    const readme = compact(README);

    expect(readme).toContain('prepared_for_review');
    expect(readme).toContain('not_applied');
    expect(readme).toContain('runtime_disconnected');
    expect(readme).toContain(
      'these artifacts are review-only and must not be run in this d5.2 slice',
    );
    expect(readme).toContain('precheck.sql');
    expect(readme).toContain('postcheck.sql');
    expect(readme).toContain('verified backup');
    expect(readme).toContain('separately reviewed forward migration');
    expect(readme).toContain('no cleanup or retention period is invented');
    expect(readme).toContain('deployment=not_needed');
  });
});
