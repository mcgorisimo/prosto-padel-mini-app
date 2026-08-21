import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migrationFile(suffix: string): string {
  return readFileSync(
    resolve(
      __dirname,
      `../../../docs/migrations/035_backend_player_onboarding_foundation${suffix}`,
    ),
    'utf8',
  );
}

const MIGRATION = migrationFile('.sql');
const PRECHECK = migrationFile('_PRECHECK.sql');
const POSTCHECK = migrationFile('_POSTCHECK.sql');
const ROLLBACK = migrationFile('_ROLLBACK.sql');

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
}

describe('migration 035 backend player onboarding foundation contract', () => {
  it('adds only private runtime-disconnected onboarding storage on the approved base', () => {
    const sql = compact(MIGRATION);
    const precheck = compact(PRECHECK);

    expect(precheck).toContain(
      "'base_commit', 'a3c2fe0c2b03f3e4f18b30001c7ceb780969fdf8'",
    );
    expect(sql).toContain(
      'alter table backend_auth.player_profile_details add column normalized_email text',
    );
    expect(sql.match(/create table backend_auth\./gu)).toHaveLength(2);
    expect(sql).toContain('create table backend_auth.player_onboarding_states');
    expect(sql).toContain(
      'create table backend_auth.account_consent_acceptances',
    );
    expect(sql).not.toMatch(/\b(create|alter|drop)\s+table\s+public\./u);
    expect(sql).not.toContain('supabase');
    expect(sql).not.toMatch(
      /\b(payment_status|owner_paid|hold_amount|prepay)\b/u,
    );
    expect(sql).not.toContain('alter table backend_auth.player_rating_states');
    expect(compact(POSTCHECK)).toContain("'runtime_connected', false");
  });

  it('stores declared canonical contacts without claiming contact verification', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'constraint player_profile_details_normalized_email_check check',
    );
    expect(sql).toContain(
      'pg_catalog.btrim(normalized_email) = normalized_email',
    );
    expect(sql).toContain(
      'pg_catalog.lower(normalized_email) = normalized_email',
    );
    expect(sql).toContain('details.phone is not null');
    expect(sql).toContain('details.normalized_email is not null');
    expect(sql).not.toMatch(
      /\b(phone_verified|email_verified|contact_verified|normalized_email_verified)\b/u,
    );
    expect(sql).not.toMatch(/unique\s*(index)?[^;]*normalized_email/u);
    expect(compact(POSTCHECK)).toContain("'contact_verification_added', false");
    expect(compact(POSTCHECK)).toContain("'rating_state_unchanged', true");
  });

  it('persists a versioned resumable state with bounded code-only survey answers', () => {
    const sql = compact(MIGRATION);

    for (const field of [
      'account_id uuid not null',
      'flow_version text not null',
      "status text not null default 'in_progress'::text",
      'current_step text not null',
      'survey_version text not null',
      "survey_answers jsonb not null default '{}'::jsonb",
      'revision bigint not null default 1',
      'completed_at bigint',
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain(
      'create function backend_auth.is_onboarding_survey_answer_codes',
    );
    expect(sql).toContain(
      'select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(value) ) <= 16',
    );
    expect(sql).toContain('pg_catalog.pg_column_size(value) <= 4096');
    expect(sql).not.toContain('jsonb_object_length');
    expect(sql).toContain("'^[a-z][a-z0-9_]{0,63}$'");
    expect(sql).not.toMatch(/create\s+(unique\s+)?index[^;]*using gin/u);
  });

  it('enforces first-run, ordered resume, completion ownership, and immutable completion', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'create trigger player_onboarding_states_transition_guard before insert or update or delete on backend_auth.player_onboarding_states',
    );
    expect(sql).toContain('backend_player_onboarding_insert_invalid');
    expect(sql).toContain('backend_player_onboarding_identity_immutable');
    expect(sql).toContain('backend_player_onboarding_completed_immutable');
    expect(sql).toContain('backend_player_onboarding_revision_conflict');
    expect(sql).toContain('backend_player_onboarding_step_invalid');
    expect(sql).toContain('backend_player_onboarding_contacts_required');
    expect(sql).toContain('backend_player_onboarding_consents_required');
    expect(sql).toContain("old.current_step <> 'level_survey'");
    expect(sql).toContain('new.revision <> old.revision + 1');
  });

  it('records exact append-only consent document versions without delete authority', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'primary key ( account_id, consent_kind, document_version )',
    );
    expect(sql).toContain(
      "consent_kind = any (array[ 'terms', 'privacy', 'cancellation' ]::text[])",
    );
    expect(sql).toContain('document_version text not null');
    expect(sql).toContain('flow_version text not null');
    expect(sql).toContain(
      'create trigger account_consent_acceptances_immutable_guard before update or delete on backend_auth.account_consent_acceptances',
    );
    expect(sql).toContain(
      'execute function backend_auth.reject_immutable_mutation()',
    );
    expect(sql).not.toMatch(/grant\s+(delete|truncate)/u);
    expect(sql).not.toContain('cascade');
  });

  it('keeps application privileges column-scoped and functions non-executable', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'revoke all on table backend_auth.player_onboarding_states, backend_auth.account_consent_acceptances from public, backend_auth_app',
    );
    expect(sql).toContain(
      'grant select on table backend_auth.player_onboarding_states, backend_auth.account_consent_acceptances to backend_auth_app',
    );
    expect(sql).toContain(
      'grant insert ( account_id, flow_version, current_step, survey_version, created_at, updated_at ) on backend_auth.player_onboarding_states to backend_auth_app',
    );
    expect(sql).toContain(
      'grant update ( status, current_step, survey_answers, revision, updated_at, completed_at ) on backend_auth.player_onboarding_states to backend_auth_app',
    );
    expect(sql).toContain(
      'grant update ( normalized_email ) on backend_auth.player_profile_details to backend_auth_app',
    );
    expect(sql).toContain(
      'revoke all on function backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb), backend_auth.guard_player_onboarding_state_transition() from public, backend_auth_app',
    );
    expect(sql).not.toMatch(
      /grant\s+(insert|update)\s+on\s+(table\s+)?backend_auth\.(player_onboarding_states|account_consent_acceptances)/u,
    );
  });

  it('provides read-only exact checks and a locked fail-closed rollback', () => {
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const rollback = compact(ROLLBACK);

    expect(precheck).toContain('set transaction read only');
    expect(precheck).toContain('migration 035 target already exists');
    expect(precheck).toContain(
      "'018_backend_auth_player_profile_editable_fields'",
    );
    expect(precheck).toContain("'027_backend_admin_rating_state'");
    expect(postcheck).toContain('set transaction read only');
    expect(postcheck).toContain(
      'postcheck_failed: migration 035 target must start empty',
    );
    expect(postcheck).toContain(
      'player_profile_details_normalized_email_check',
    );
    expect(postcheck).toContain('player_onboarding_states_transition_guard');
    expect(postcheck).toContain('account_consent_acceptances_immutable_guard');
    expect(rollback).toContain('lock table');
    expect(rollback).toContain('in access exclusive mode');
    expect(rollback).toContain(
      'rollback_refused: onboarding/contact data exists; use a forward migration',
    );
    expect(rollback).toContain(
      "'018_backend_auth_player_profile_editable_fields:' || backend_auth.relation_fingerprint",
    );
    expect(rollback).not.toContain('cascade');
  });

  it('pins the rating-state fingerprint to migration 027 and rejects obsolete migration 019', () => {
    for (const artifact of [MIGRATION, PRECHECK, POSTCHECK, ROLLBACK]) {
      const sql = compact(artifact);

      expect(sql).toMatch(/'027_backend_admin_rating_state:?'/u);
      expect(sql).not.toContain('019_backend_auth_player_rating_state');
    }
  });
});
