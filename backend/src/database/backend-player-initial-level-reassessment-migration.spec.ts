import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migrationFile(suffix: string): string {
  return readFileSync(
    resolve(
      __dirname,
      `../../../docs/migrations/040_backend_player_initial_level_reassessment${suffix}`,
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

function terminalStatement(value: string): string {
  const statements = value
    .split(';')
    .map((statement) =>
      statement
        .replace(/--[^\n]*/gu, '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
  return statements.at(-1) ?? '';
}

const ARTIFACTS = [MIGRATION, PRECHECK, POSTCHECK, ROLLBACK];

describe('migration 040 player initial-level reassessment contract', () => {
  it('creates one separate immutable evidence relation without backfill', () => {
    const sql = compact(MIGRATION);

    expect(sql.match(/create table backend_auth\./gu)).toHaveLength(1);
    expect(sql).toContain(
      'create table backend_auth.player_initial_level_reassessments',
    );
    expect(sql).toContain(
      'constraint player_initial_level_reassessments_pkey primary key (account_id)',
    );
    expect(sql).toContain(
      'references backend_auth.player_onboarding_states (account_id) on update no action on delete no action not deferrable',
    );
    expect(sql).not.toMatch(
      /\b(insert\s+into|update\s+backend_auth\.|delete\s+from|truncate\s+table)\b/u,
    );
    expect(sql).not.toMatch(
      /alter\s+table\s+backend_auth\.player_onboarding_states/u,
    );
    expect(sql).not.toContain('backfill');
    expect(sql).not.toContain('cascade');
  });

  it('stores source identity, exact v2 answers and the private computed result', () => {
    const sql = compact(MIGRATION);

    for (const field of [
      'account_id uuid not null',
      'source_flow_version text not null',
      'source_survey_version text not null',
      'source_revision bigint not null',
      'survey_version text not null',
      'survey_answers jsonb not null',
      'initial_level_score smallint not null',
      'initial_level_label text not null',
      'completed_at bigint not null',
    ]) {
      expect(sql).toContain(field);
    }
    expect(sql).toContain("source_survey_version = 'initial_level_v1'");
    expect(sql).toContain("survey_version = 'initial_level_v2'");
    expect(sql).toContain('initial_level_score between 0 and 20');
    expect(sql).toContain(
      "array['d', 'd+', 'c', 'c+', 'b', 'b+', 'a']::text[]",
    );
    expect(sql).toContain(
      'backend_auth.is_onboarding_survey_answer_codes(survey_answers)',
    );
  });

  it('accepts only a completed immutable v1 source at the exact source revision', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'create function backend_auth.guard_player_initial_level_reassessment_insert()',
    );
    expect(sql).toContain("v_source.status <> 'completed'");
    expect(sql).toContain("v_source.current_step <> 'completed'");
    expect(sql).toContain("v_source.survey_version <> 'initial_level_v1'");
    expect(sql).toContain('new.source_flow_version <> v_source.flow_version');
    expect(sql).toContain(
      'new.source_survey_version <> v_source.survey_version',
    );
    expect(sql).toContain('new.source_revision <> v_source.revision');
    expect(sql).toContain('new.completed_at < v_source.completed_at');
    expect(sql).toContain(
      'backend_player_initial_level_reassessment_time_invalid',
    );
    expect(sql).toContain(
      'backend_player_initial_level_reassessment_source_conflict',
    );
    expect(compact(POSTCHECK)).toContain(
      'reassessment.completed_at < source.completed_at',
    );
  });

  it('pins the exact five question codes without duplicating scoring rules', () => {
    const migration = compact(MIGRATION);
    const postcheck = compact(POSTCHECK);

    for (const code of [
      'match_count',
      'rally_stability',
      'glass_play',
      'serve_return_net',
      'match_experience_year',
    ]) {
      expect(migration).toContain(`'${code}'`);
      expect(postcheck).toContain(`'${code}'`);
    }
    expect(migration).toContain('v_answer_count <> 5');
    expect(migration).toContain('v_unknown_answer_count <> 0');
    expect(migration).not.toContain('one_hundred_plus');
    expect(migration).not.toContain('controls_pace');
    expect(migration).not.toContain('uses_tactically');
    expect(migration).not.toContain('advanced_patterns');
    expect(migration).not.toContain('tournament');
  });

  it('enforces one-row concurrency and immutable completed evidence', () => {
    const migration = compact(MIGRATION);

    expect(migration).toContain(
      'constraint player_initial_level_reassessments_pkey primary key (account_id)',
    );
    expect(migration).toContain(
      'create trigger player_initial_level_reassessments_immutable_guard before update or delete on backend_auth.player_initial_level_reassessments',
    );
    expect(migration).toContain(
      'execute function backend_auth.reject_immutable_mutation()',
    );
    expect(migration).not.toMatch(/grant\s+(?:update|delete|truncate)\b/u);
  });

  it('grants only table SELECT and column-scoped INSERT to the backend role', () => {
    const migration = compact(MIGRATION);
    const postcheck = compact(POSTCHECK);

    expect(migration).toContain(
      'revoke all on table backend_auth.player_initial_level_reassessments from public, backend_auth_app',
    );
    expect(migration).toContain(
      'grant select on table backend_auth.player_initial_level_reassessments to backend_auth_app',
    );
    expect(migration).toContain(
      'grant insert ( account_id, source_flow_version, source_survey_version, source_revision, survey_version, survey_answers, initial_level_score, initial_level_label, completed_at ) on backend_auth.player_initial_level_reassessments to backend_auth_app',
    );
    expect(migration).not.toMatch(
      /grant\s+insert\s+on\s+(?:table\s+)?backend_auth\.player_initial_level_reassessments/u,
    );
    expect(migration).toContain(
      'revoke all on function backend_auth.guard_player_initial_level_reassessment_insert() from public, backend_auth_app',
    );
    expect(migration).toContain('do $normalize_acl$');
    expect(migration).toContain(
      "pg_catalog.acldefault('r', relation.relowner)",
    );
    expect(migration).toContain(
      "pg_catalog.acldefault('f', procedure_row.proowner)",
    );
    expect(postcheck).toContain(
      "acl_row.privilege_type = 'insert' and acl_row.grantee = 'backend_auth_app'::pg_catalog.regrole::oid and not acl_row.is_grantable and acl_row.grantor = relation.relowner",
    );
    expect(postcheck).toContain(') <> 9 or exists (');
    for (const privilege of ['truncate', 'references', 'trigger']) {
      expect(postcheck).toContain(
        `'backend_auth_app', v_relation_oid, '${privilege}'`,
      );
    }
    expect(postcheck).toContain(
      'postcheck_failed: migration 040 exact table acl differs',
    );
    expect(postcheck).toContain(
      'postcheck_failed: migration 040 exact function acl differs',
    );
  });

  it('pins canonical source, helper, immutable and rating fingerprints', () => {
    for (const artifact of ARTIFACTS) {
      const sql = compact(artifact);
      expect(sql).toContain(
        "'039_backend_player_onboarding_initial_level_result:' || backend_auth.relation_fingerprint",
      );
      expect(sql).toContain(
        "'027_backend_admin_rating_state:' || backend_auth.relation_fingerprint",
      );
      expect(sql).not.toContain('019_backend_auth_player_rating_state');
    }

    for (const sql of [
      compact(MIGRATION),
      compact(PRECHECK),
      compact(POSTCHECK),
    ]) {
      for (const [signature, migrationName] of [
        [
          'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)',
          '035_backend_player_onboarding_foundation',
        ],
        [
          'backend_auth.guard_player_onboarding_state_transition()',
          '037_backend_player_onboarding_progress_transition',
        ],
        [
          'backend_auth.reject_immutable_mutation()',
          '015_backend_auth_foundation',
        ],
      ]) {
        expect(sql).toContain(`'${signature}'`);
        expect(sql).toContain(`'${migrationName}'`);
      }
      expect(sql).toContain("array['search_path=pg_catalog, pg_temp']::text[]");
      expect(sql).toContain('acl_row.grantor <> procedure_row.proowner');
      expect(sql).toContain('or acl_row.is_grantable');
    }
  });

  it('provides read-only gates and blocks rollback after evidence exists', () => {
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const rollback = compact(ROLLBACK);

    expect(precheck).toContain('begin read only');
    expect(postcheck).toContain('begin read only');
    expect(terminalStatement(PRECHECK)).toBe('rollback');
    expect(terminalStatement(POSTCHECK)).toBe('rollback');
    expect(precheck).toContain(
      "'base_commit', '7a087e754b4d2a3d56b3ed8ef7896c7d2f4c7872'",
    );
    expect(rollback).toContain(
      'lock table backend_auth.player_initial_level_reassessments in access exclusive mode',
    );
    expect(rollback).toContain(
      'rollback_blocked: immutable reassessment evidence exists; use a forward migration',
    );
    expect(rollback).not.toContain('cascade');
    expect(terminalStatement(ROLLBACK)).toContain(
      '040_backend_player_initial_level_reassessment rolled back before evidence use',
    );
  });

  it('keeps rating, verification, PII, Supabase and runtime wiring outside migration 040', () => {
    for (const artifact of ARTIFACTS) {
      const sql = compact(artifact);
      expect(sql).not.toContain('isverified');
      expect(sql).not.toContain('is_verified');
      expect(sql).not.toContain('first_name');
      expect(sql).not.toContain('last_name');
      expect(sql).not.toContain('normalized_email');
      expect(sql).not.toContain('phone');
      expect(sql).not.toContain('supabase');
      expect(sql).not.toMatch(
        /\b(?:alter|update|insert\s+into|delete\s+from)\s+backend_auth\.player_rating_states/u,
      );
    }
    expect(compact(PRECHECK)).toContain("'runtime_connected', false");
    expect(compact(PRECHECK)).toContain("'synthetic_fixture_compatible', true");
    expect(compact(POSTCHECK)).toContain(
      "'synthetic_fixture_compatible', true",
    );
  });
});
