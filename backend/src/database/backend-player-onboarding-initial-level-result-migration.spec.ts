import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migrationFile(suffix: string): string {
  return readFileSync(
    resolve(
      __dirname,
      `../../../docs/migrations/039_backend_player_onboarding_initial_level_result${suffix}`,
    ),
    'utf8',
  );
}

const MIGRATION = migrationFile('.sql');
const PRECHECK = migrationFile('_PRECHECK.sql');
const POSTCHECK = migrationFile('_POSTCHECK.sql');
const ROLLBACK = migrationFile('_ROLLBACK.sql');
const PROGRESS_MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../../docs/migrations/037_backend_player_onboarding_progress_transition.sql',
  ),
  'utf8',
);

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
}

function terminalStatement(value: string): string {
  const statements = value
    .split(';')
    .map((statement) => statement.replace(/--[^\n]*/gu, '').trim().toLowerCase())
    .filter(Boolean);
  return statements.at(-1) ?? '';
}

const ARTIFACTS = [MIGRATION, PRECHECK, POSTCHECK, ROLLBACK];

describe('migration 039 onboarding initial-level result contract', () => {
  it('adds exactly the two nullable result columns without a backfill', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain('add column initial_level_score smallint');
    expect(sql).toContain('add column initial_level_label text');
    expect(sql).not.toMatch(
      /add column initial_level_(?:score|label)[^,;]*\bnot null\b/u,
    );
    expect(sql).not.toMatch(
      /add column initial_level_(?:score|label)[^,;]*\bdefault\b/u,
    );
    expect(sql.match(/\badd column initial_level_/gu)).toHaveLength(2);
    expect(sql).not.toMatch(
      /\b(insert\s+into|update\s+backend_auth\.|delete\s+from|truncate\s+table)\b/u,
    );
    expect(sql).not.toContain('backfill');
  });

  it('constrains score, canonical label and the exact initial_level_v2 shape', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      'constraint player_onboarding_states_initial_level_score_check check ( initial_level_score is null or initial_level_score between 0 and 20 )',
    );
    expect(sql).toContain(
      "array['d', 'd+', 'c', 'c+', 'b', 'b+', 'a']::text[]",
    );
    expect(sql).toContain(
      "status = 'completed' and survey_version = 'initial_level_v2' and initial_level_score is not null and initial_level_label is not null",
    );
    expect(sql).toContain(
      "( status <> 'completed' or survey_version <> 'initial_level_v2' ) and initial_level_score is null and initial_level_label is null",
    );
    expect(sql).not.toContain('initial_level_v1');
  });

  it('preserves legacy completed rows and the existing completed-state immutability', () => {
    const migration = compact(MIGRATION);
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const progressMigration = compact(PROGRESS_MIGRATION);

    expect(precheck).toContain("state.survey_version <> 'initial_level_v2'");
    expect(postcheck).toContain("state.survey_version <> 'initial_level_v2'");
    expect(precheck).toContain("'legacy_completed_rows_observed'");
    expect(postcheck).toContain("'legacy_completed_rows_observed'");
    expect(migration).not.toMatch(
      /\bupdate\s+backend_auth\.player_onboarding_states\s+set\b/u,
    );
    expect(progressMigration).toContain("if old.status = 'completed' then");
    expect(progressMigration).toContain(
      'backend_player_onboarding_completed_immutable',
    );
    expect(migration).not.toMatch(/create\s+or\s+replace\s+function/u);
  });

  it('grants only column-level UPDATE for the new private result fields', () => {
    const migration = compact(MIGRATION);
    const postcheck = compact(POSTCHECK);

    expect(migration).toContain(
      'revoke update ( initial_level_score, initial_level_label ) on backend_auth.player_onboarding_states from public, backend_auth_app',
    );
    expect(migration).toContain(
      'grant update ( initial_level_score, initial_level_label ) on backend_auth.player_onboarding_states to backend_auth_app',
    );
    expect(migration).not.toMatch(
      /grant\s+(?:all|insert|delete|truncate)\b/u,
    );
    expect(migration).not.toMatch(
      /grant\s+update\s+on\s+backend_auth\.player_onboarding_states/u,
    );
    expect(postcheck).toContain(
      "acl_row.privilege_type = 'update' and acl_row.grantee = 'backend_auth_app'::pg_catalog.regrole::oid and not acl_row.is_grantable and acl_row.grantor = relation.relowner",
    );
    expect(postcheck).toContain(
      "acl_row.privilege_type <> 'update' or acl_row.grantee <> 'backend_auth_app'::pg_catalog.regrole::oid or acl_row.is_grantable or acl_row.grantor <> relation.relowner",
    );
    expect(postcheck).toContain(') <> 2 or exists (');
    expect(postcheck).toContain(
      "pg_catalog.has_table_privilege( 'backend_auth_app', v_state_oid, 'update' )",
    );
    expect(postcheck).toContain(
      "pg_catalog.has_column_privilege( 'public', v_state_oid, 'initial_level_score', 'update' )",
    );
  });

  it('pins the applied 035 relation and 037 transition guard fingerprints', () => {
    const migration = compact(MIGRATION);
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const rollback = compact(ROLLBACK);

    for (const sql of [migration, precheck]) {
      expect(sql).toContain(
        "'035_backend_player_onboarding_foundation:' || backend_auth.relation_fingerprint",
      );
    }
    for (const sql of [migration, precheck, postcheck, rollback]) {
      expect(sql).toContain(
        "'037_backend_player_onboarding_progress_transition:' || pg_catalog.md5(pg_catalog.pg_get_functiondef",
      );
      expect(sql).not.toContain('019_backend_auth_player_rating_state');
    }
    for (const sql of [migration, postcheck, rollback]) {
      expect(sql).toContain(
        "'039_backend_player_onboarding_initial_level_result:' || backend_auth.relation_fingerprint",
      );
    }
    expect(rollback).toContain(
      "'035_backend_player_onboarding_foundation:' || backend_auth.relation_fingerprint",
    );
  });

  it('provides read-only gates and a fail-closed rollback', () => {
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const rollback = compact(ROLLBACK);

    expect(precheck).toContain('begin read only');
    expect(postcheck).toContain('begin read only');
    expect(terminalStatement(PRECHECK)).toBe('rollback');
    expect(terminalStatement(POSTCHECK)).toBe('rollback');
    expect(precheck).toContain(
      "'base_commit', '9dbac1669a046900bef6290ae6b83fd4fdf533de'",
    );
    expect(rollback).toContain(
      "where state.survey_version = 'initial_level_v2'",
    );
    expect(rollback).toContain(
      'rollback_blocked: computed initial-level data exists; use a forward migration',
    );
    expect(rollback).toContain('drop column initial_level_label');
    expect(rollback).toContain('drop column initial_level_score');
    expect(rollback).not.toContain('cascade');
    expect(terminalStatement(ROLLBACK)).toContain(
      '039_backend_player_onboarding_initial_level_result rolled back before runtime use',
    );
  });

  it('keeps survey answers, rating, verification and Supabase outside migration 039', () => {
    for (const artifact of ARTIFACTS) {
      const sql = compact(artifact);
      expect(sql).not.toContain('player_rating_states');
      expect(sql).not.toContain('isverified');
      expect(sql).not.toContain('is_verified');
      expect(sql).not.toContain('supabase');
      expect(sql).not.toContain('ratingengine');
      expect(sql).not.toMatch(/alter\s+column\s+survey_answers/u);
      expect(sql).not.toMatch(/drop\s+column\s+survey_answers/u);
    }
    expect(compact(PRECHECK)).toContain("'synthetic_fixture_compatible', true");
    expect(compact(POSTCHECK)).toContain(
      "'synthetic_fixture_compatible', true",
    );
  });
});
