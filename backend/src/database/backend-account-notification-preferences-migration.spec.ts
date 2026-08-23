import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migrationFile(suffix: string): string {
  return readFileSync(
    resolve(
      __dirname,
      '../../../docs/migrations/038_backend_account_notification_preferences' +
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

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
}

function between(
  value: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) {
    throw new Error('Migration section is missing: ' + startMarker);
  }
  return value.slice(start, end);
}

describe('migration 038 account notification preferences contract', () => {
  it('is storage-only and does not mutate existing rows', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'create table backend_auth.account_notification_preferences',
    );
    expect(sql).toContain(
      'alter table backend_match.telegram_notification_outbox',
    );
    expect(sql).not.toMatch(
      /\b(insert\s+into|update\s+(?:backend_auth|backend_match)\.|delete\s+from|truncate\s+table)\b/u,
    );
    expect(sql).not.toContain('supabase');
    expect(sql).not.toContain('telegram bot api');
    expect(sql).not.toContain('http://');
    expect(sql).not.toContain('https://');
  });

  it('creates one PII-free account-owned boolean without defaults or backfill', () => {
    const definition = compact(
      between(
        MIGRATION,
        'create table backend_auth.account_notification_preferences',
        'alter table backend_match.telegram_notification_outbox',
      ),
    );

    for (const marker of [
      'account_id uuid not null',
      'telegram_match_notifications_enabled boolean not null',
      'created_at bigint not null',
      'updated_at bigint not null',
      'version bigint not null',
      'primary key (account_id)',
      'references backend_auth.accounts (id)',
      'on update no action on delete no action not deferrable',
    ]) {
      expect(definition).toContain(marker);
    }
    expect(definition).not.toContain('default');
    for (const forbidden of [
      'telegram_chat_id',
      'telegram_user_id',
      'phone',
      'email',
      'message_body',
      'provider_response',
      'external_identity',
    ]) {
      expect(definition).not.toContain(forbidden);
    }
  });

  it('keeps missing-row semantics explicit and independent from Telegram permission', () => {
    const readme = compact(README);

    expect(readme).toContain('missing preference row as effective enabled');
    expect(readme).toContain(
      'an explicit false row must remain false across later telegram logins',
    );
    expect(readme).toContain('the in-app feed remains unaffected');
    expect(readme).toContain(
      'there is deliberately no database default and no migration backfill',
    );
    expect(readme).toContain(
      'verified telegram private-message permission and usable destination',
    );
  });

  it('allows preference_disabled only as terminal abandoned outbox evidence', () => {
    const migration = compact(MIGRATION);
    const postcheck = compact(POSTCHECK);
    const stateConstraint = compact(
      between(
        MIGRATION,
        'add constraint telegram_notification_outbox_state_check check (',
        'revoke all on table backend_auth.account_notification_preferences',
      ),
    );
    const pendingBranch = between(
      stateConstraint,
      "status = 'pending'",
      "or ( status = 'sent'",
    );
    const sentBranch = between(
      stateConstraint,
      "status = 'sent'",
      "or ( status = 'abandoned'",
    );
    const abandonedBranch = stateConstraint.slice(
      stateConstraint.indexOf("status = 'abandoned'"),
    );
    const restoredConstraints = compact(
      between(
        ROLLBACK,
        'alter table backend_match.telegram_notification_outbox\n' +
          '  add constraint telegram_notification_outbox_failure_check',
        'do $restore_comment$',
      ),
    );

    expect(migration).toContain("failure_code = 'preference_disabled'");
    expect(migration).toContain("status = 'abandoned'");
    expect(postcheck).toContain("''preference_disabled''");
    expect(postcheck).toContain("status = ''abandoned''");
    expect(pendingBranch).not.toContain('preference_disabled');
    expect(sentBranch).not.toContain('preference_disabled');
    expect(abandonedBranch).toContain("failure_code = 'preference_disabled'");
    expect(restoredConstraints).not.toContain('preference_disabled');
    expect(compact(ROLLBACK)).toContain(
      "where failure_code = 'preference_disabled'",
    );
    expect(compact(README)).toContain('valid only for an abandoned delivery');
  });

  it('does not overload or revoke the Telegram transport destination', () => {
    const migration = compact(MIGRATION);

    expect(migration).not.toContain(
      'alter table backend_auth.telegram_notification_destinations',
    );
    expect(migration).not.toMatch(
      /update\s+backend_auth\.telegram_notification_destinations/u,
    );
    expect(migration).not.toContain("disable_reason = 'user_revoked'");
    expect(compact(README)).toContain(
      'newly verified telegram destination must not overwrite the product preference',
    );
  });

  it('grants only the bounded application column privileges', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'grant select on table backend_auth.account_notification_preferences to backend_auth_app',
    );
    expect(sql).toContain(
      'grant insert ( account_id, telegram_match_notifications_enabled, created_at, updated_at, version ) on backend_auth.account_notification_preferences to backend_auth_app',
    );
    expect(sql).toContain(
      'grant update ( telegram_match_notifications_enabled, updated_at, version ) on backend_auth.account_notification_preferences to backend_auth_app',
    );
    expect(sql).toContain(
      'revoke all on table backend_auth.account_notification_preferences from public, backend_auth_app',
    );
    expect(sql).not.toMatch(
      /grant\s+(?:delete|truncate|references|trigger)\b/u,
    );
  });

  it('pins the exact applied dependencies and migration fingerprints', () => {
    const precheck = compact(PRECHECK);
    const migration = compact(MIGRATION);
    const postcheck = compact(POSTCHECK);

    for (const artifact of [precheck, migration]) {
      expect(artifact).toContain("'015_backend_auth_foundation'");
      expect(artifact).toContain(
        "'030_backend_telegram_outbound_notifications'",
      );
      expect(artifact).toContain("'telegram_notification_destinations'");
      expect(artifact).toContain("'telegram_notification_outbox'");
    }
    for (const artifact of [migration, postcheck]) {
      expect(artifact).toContain(
        "'038_backend_account_notification_preferences:'",
      );
      expect(artifact).toContain('backend_auth.relation_fingerprint');
    }
  });

  it('provides read-only gates and a fail-closed exact rollback', () => {
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const rollback = compact(ROLLBACK);

    for (const gate of [precheck, postcheck]) {
      expect(gate).toContain('begin read only');
      expect(gate).toMatch(/rollback;\s*$/u);
    }
    expect(precheck).toContain(
      "'base_commit', '864727d02bec93a44e17491570667f65bc7fbe06'",
    );
    expect(rollback).toContain(
      'notification preference history exists; use a forward migration',
    );
    expect(rollback).toContain(
      'preference-disabled delivery evidence exists; use a forward migration',
    );
    expect(rollback).toContain(
      "'030_backend_telegram_outbound_notifications:'",
    );
    expect(rollback).not.toContain('cascade');
  });

  it('documents separate schema, runtime, frontend and deployment gates', () => {
    const readme = compact(README);

    expect(readme).toContain(
      'this candidate must not be applied as part of local implementation review',
    );
    expect(readme).toContain(
      'the exact auth-integration inventory currently models the pre-038 catalog',
    );
    expect(readme).toContain(
      'profile visibility settings remain outside this migration',
    );
    expect(readme).toContain(
      'add bearer-protected own-account get/patch endpoints',
    );
    expect(readme).toContain(
      'integrate a truthful frontend toggle in a later separate slice',
    );
  });
});
