import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migrationFile(suffix: string): string {
  return readFileSync(
    resolve(
      __dirname,
      `../../../docs/migrations/037_backend_player_onboarding_progress_transition${suffix}`,
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

function functionDefinition(value: string): string {
  const start = value.indexOf(
    'create or replace function backend_auth.guard_player_onboarding_state_transition()',
  );
  const end = value.indexOf('do $comments$', start);
  if (start < 0 || end <= start) {
    throw new Error('Transition guard definition is missing');
  }
  return compact(value.slice(start, end));
}

const TRANSITION_GUARD =
  'backend_auth.guard_player_onboarding_state_transition()';

describe('migration 037 onboarding progress transition contract', () => {
  it('replaces only the transition guard without relation or data mutation', () => {
    const sql = compact(MIGRATION);

    expect(
      sql.match(
        /create or replace function backend_auth\.guard_player_onboarding_state_transition\(\)/gu,
      ),
    ).toHaveLength(1);
    expect(sql).not.toMatch(/\b(create|alter|drop|truncate)\s+table\b/u);
    expect(sql).not.toMatch(
      /\b(insert\s+into|update\s+backend_auth\.|delete\s+from|truncate\s+table)\b/u,
    );
    expect(sql).not.toMatch(
      /create or replace function backend_auth\.(?!guard_player_onboarding_state_transition)/u,
    );
    expect(sql).not.toContain('supabase');
  });

  it('implements the exact product-visible and legacy-resume transition matrix', () => {
    const definition = functionDefinition(MIGRATION);

    expect(definition).toContain(
      'if new.current_step = old.current_step then null;',
    );
    expect(definition).toContain(
      "elsif old.current_step = 'profile' and new.current_step = 'consents' and new.status = 'in_progress' then null;",
    );
    expect(definition).toContain(
      "elsif old.current_step = 'contacts' and new.current_step = 'consents' and new.status = 'in_progress' then null;",
    );
    expect(definition).toContain(
      "elsif old.current_step = 'consents' and new.current_step = 'level_survey' and new.status = 'in_progress' then null;",
    );
    expect(definition).toContain(
      "elsif old.current_step = 'level_survey' and new.current_step = 'completed' and new.status = 'completed' then null;",
    );
    expect(definition).not.toMatch(
      /old\.current_step = 'profile' and new\.current_step = 'contacts'/u,
    );
    expect(definition).not.toContain('v_old_step');
    expect(definition).not.toContain('v_new_step');
    expect(definition).toContain('backend_player_onboarding_step_invalid');
  });

  it('requires canonical declared profile contacts before consents', () => {
    const definition = functionDefinition(MIGRATION);

    expect(definition).toContain(
      "new.current_step = 'consents' and old.current_step in ('profile', 'contacts')",
    );
    expect(definition).toContain(
      "old.current_step = 'consents' and new.current_step = 'level_survey'",
    );
    expect(definition).toContain(
      "pg_catalog.btrim(details.first_name) <> ''",
    );
    expect(definition).toContain(
      "details.phone ~ '^\\+[1-9][0-9]{6,14}$'",
    );
    expect(definition).toContain(
      'pg_catalog.btrim(details.normalized_email) = details.normalized_email',
    );
    expect(definition).toContain(
      'pg_catalog.lower(details.normalized_email) = details.normalized_email',
    );
    expect(definition).toContain(
      'backend_player_onboarding_contacts_required',
    );
  });

  it('requires all consent kinds before level survey without hardcoding legal versions', () => {
    const definition = functionDefinition(MIGRATION);

    expect(definition).toContain(
      "old.current_step = 'consents' and new.current_step = 'level_survey'",
    );
    expect(definition).toContain(
      'pg_catalog.count(distinct acceptance.consent_kind)',
    );
    expect(definition).toContain(
      'acceptance.flow_version = new.flow_version',
    );
    expect(definition).toContain(
      'acceptance.accepted_at between new.created_at and new.updated_at',
    );
    expect(definition).toContain('v_consent_kind_count <> 3');
    expect(definition).toContain(
      'backend_player_onboarding_consents_required',
    );
    for (const artifact of [MIGRATION, PRECHECK, POSTCHECK, ROLLBACK]) {
      expect(artifact).not.toContain('2026-08-01');
    }
  });

  it('preserves revision, immutability and completion guards', () => {
    const definition = functionDefinition(MIGRATION);

    for (const marker of [
      'backend_player_onboarding_insert_invalid',
      'backend_player_onboarding_state_immutable',
      'backend_player_onboarding_identity_immutable',
      'backend_player_onboarding_completed_immutable',
      'backend_player_onboarding_revision_conflict',
      'backend_player_onboarding_completion_invalid',
      'backend_player_onboarding_contacts_required',
      'backend_player_onboarding_consents_required',
    ]) {
      expect(definition).toContain(marker);
    }
    expect(definition).toContain('new.revision <> old.revision + 1');
    expect(definition).toContain(
      "new.status = 'in_progress' and new.survey_answers <> '{}'::pg_catalog.jsonb",
    );
    expect(definition).toContain(
      'backend_player_onboarding_progress_survey_invalid',
    );
  });

  it('pins canonical fingerprints and preserves the post-036 ACL boundary', () => {
    const migration = compact(MIGRATION);
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const rollback = compact(ROLLBACK);

    for (const sql of [migration, precheck, postcheck, rollback]) {
      expect(sql).toContain("'035_backend_player_onboarding_foundation'");
      expect(sql).toContain("'027_backend_admin_rating_state'");
      expect(sql).not.toContain('019_backend_auth_player_rating_state');
      expect(sql).toContain("acl_row.privilege_type = 'execute'");
      expect(sql).toContain("'backend_auth_app'::pg_catalog.regrole::oid");
      expect(sql).toContain('v_acl_count <> 2');
    }
    expect(migration).toContain(
      `'037_backend_player_onboarding_progress_transition:' || pg_catalog.md5( pg_catalog.pg_get_functiondef`,
    );
    expect(postcheck).toContain(
      `'037_backend_player_onboarding_progress_transition'`,
    );
    expect(migration).toContain(
      `revoke all on function ${TRANSITION_GUARD} from public`,
    );
    expect(migration).toContain(
      `grant execute on function ${TRANSITION_GUARD} to backend_auth_app`,
    );
    expect(postcheck).toContain(
      "'backend_auth_app_execute', true, 'public_execute', false",
    );
    expect(rollback).toContain(
      `grant execute on function ${TRANSITION_GUARD} to backend_auth_app`,
    );
    expect(rollback).not.toContain(`from public, backend_auth_app`);
  });

  it('provides read-only gates and restores the 035 definition with 036 ACL', () => {
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const rollback = compact(ROLLBACK);
    const restoredDefinition = functionDefinition(ROLLBACK);

    expect(precheck).toContain('begin read only');
    expect(precheck).toContain('rollback');
    expect(precheck).toContain(
      "'base_commit', '596e2ab86569403db65c227abe084aef7fa934cc'",
    );
    expect(postcheck).toContain('begin read only');
    expect(postcheck).toContain('rollback');
    expect(restoredDefinition).toContain('v_old_step smallint');
    expect(restoredDefinition).toContain('v_new_step smallint');
    expect(restoredDefinition).toContain(
      'v_new_step < v_old_step or v_new_step > v_old_step + 1',
    );
    expect(rollback).toContain(
      `'035_backend_player_onboarding_foundation:' || pg_catalog.md5( pg_catalog.pg_get_functiondef`,
    );
    expect(rollback).toContain(
      'migration-036 function acl was not preserved',
    );
    expect(rollback).not.toContain('cascade');
  });

  it('is compatible with retained synthetic and legacy fixtures without cleanup', () => {
    for (const artifact of [MIGRATION, PRECHECK, POSTCHECK, ROLLBACK]) {
      const sql = compact(artifact);
      expect(sql).not.toMatch(
        /\b(insert\s+into|update\s+backend_auth\.|delete\s+from|truncate\s+table)\b/u,
      );
      expect(sql).not.toContain('must start empty');
      expect(sql).not.toContain('onboarding/contact data exists');
    }
    expect(compact(PRECHECK)).toContain(
      "'synthetic_fixture_compatible', true",
    );
    expect(compact(POSTCHECK)).toContain(
      "'synthetic_fixture_compatible', true",
    );
    expect(compact(PRECHECK)).toContain("'legacy_contacts_rows_observed'");
    expect(compact(POSTCHECK)).toContain("'legacy_contacts_rows_observed'");
    expect(compact(POSTCHECK)).toContain(
      "'relation_definitions_changed', false, 'persisted_data_changed', false",
    );
  });
});
