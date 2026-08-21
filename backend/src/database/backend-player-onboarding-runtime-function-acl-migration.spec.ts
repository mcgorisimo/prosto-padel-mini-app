import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migrationFile(suffix: string): string {
  return readFileSync(
    resolve(
      __dirname,
      `../../../docs/migrations/036_backend_player_onboarding_runtime_function_acl${suffix}`,
    ),
    'utf8',
  );
}

const MIGRATION = migrationFile('.sql');
const PRECHECK = migrationFile('_PRECHECK.sql');
const POSTCHECK = migrationFile('_POSTCHECK.sql');
const ROLLBACK = migrationFile('_ROLLBACK.sql');
const FOUNDATION = readFileSync(
  resolve(
    __dirname,
    '../../../docs/migrations/035_backend_player_onboarding_foundation.sql',
  ),
  'utf8',
);

function compact(value: string): string {
  return value.replace(/\s+/gu, ' ').trim().toLowerCase();
}

const SURVEY_VALIDATOR =
  'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)';
const TRANSITION_GUARD =
  'backend_auth.guard_player_onboarding_state_transition()';

describe('migration 036 onboarding runtime function ACL contract', () => {
  it('is an ACL-only forward migration for exactly the two approved functions', () => {
    const sql = compact(MIGRATION);

    expect(sql).toContain(
      `grant execute on function ${SURVEY_VALIDATOR}, ${TRANSITION_GUARD} to backend_auth_app`,
    );
    expect(sql.match(/grant execute on function/gu)).toHaveLength(1);
    expect(sql).toContain(
      `revoke all on function ${SURVEY_VALIDATOR}, ${TRANSITION_GUARD} from public`,
    );
    expect(sql).not.toMatch(/\b(create|alter|drop|replace)\s+function\b/u);
    expect(sql).not.toMatch(/\b(create|alter|drop|truncate)\s+table\b/u);
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+backend_auth\.|delete\s+from)\b/u);
    expect(sql).not.toContain('comment on');
    expect(sql).not.toContain('supabase');
  });

  it('preserves the original migration-035 prohibition as the exact pre-state', () => {
    const foundation = compact(FOUNDATION);
    const precheck = compact(PRECHECK);

    expect(foundation).toContain(
      `revoke all on function ${SURVEY_VALIDATOR}, ${TRANSITION_GUARD} from public, backend_auth_app`,
    );
    expect(precheck).toContain(
      'expected migration-035 function prohibition differs',
    );
    expect(precheck).toContain(
      "'source_acl', 'backend_auth_app_execute_forbidden'",
    );
    expect(precheck).toContain(
      "'base_commit', '5259274ccab022fe5b536fdcadc6d3e3b457addc'",
    );
  });

  it('pins canonical function definitions and relation fingerprints', () => {
    for (const artifact of [MIGRATION, PRECHECK, POSTCHECK, ROLLBACK]) {
      const sql = compact(artifact);

      expect(sql).toContain(SURVEY_VALIDATOR);
      expect(sql).toContain(TRANSITION_GUARD);
      expect(sql).toContain(
        "'035_backend_player_onboarding_foundation:' || pg_catalog.md5( pg_catalog.pg_get_functiondef",
      );
      expect(sql).toContain(
        "'035_backend_player_onboarding_foundation'",
      );
      expect(sql).toContain("'027_backend_admin_rating_state'");
      expect(sql).not.toContain('019_backend_auth_player_rating_state');
    }
  });

  it('requires exact direct ACLs and keeps PUBLIC without EXECUTE', () => {
    const migration = compact(MIGRATION);
    const postcheck = compact(POSTCHECK);

    for (const sql of [migration, postcheck]) {
      expect(sql).toContain("acl_row.privilege_type = 'execute'");
      expect(sql).toContain("'backend_auth_app'::pg_catalog.regrole::oid");
      expect(sql).toContain('acl_row.grantee not in');
      expect(sql).toContain('and acl_row.is_grantable');
      expect(sql).toContain('acl_row.grantor <> procedure_row.proowner');
      expect(sql).toContain('v_acl_count <> 2');
    }
    expect(postcheck).toContain(
      "'backend_auth_app_execute', true, 'public_execute', false",
    );
    expect(migration).not.toMatch(/to\s+public/u);
  });

  it('provides read-only gates and a fail-closed rollback to the exact 035 ACL', () => {
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const rollback = compact(ROLLBACK);

    expect(precheck).toContain('begin read only');
    expect(precheck).toContain('rollback');
    expect(postcheck).toContain('begin read only');
    expect(postcheck).toContain('rollback');
    expect(rollback).toContain(
      `revoke all on function ${SURVEY_VALIDATOR}, ${TRANSITION_GUARD} from public, backend_auth_app`,
    );
    expect(rollback).toContain(
      'migration-035 function acl or fingerprint was not restored',
    );
    expect(rollback).toContain('v_acl_count <> 1');
    expect(rollback).not.toContain('cascade');
  });

  it('remains compatible with existing synthetic fixtures and does no data cleanup', () => {
    const artifacts = [MIGRATION, PRECHECK, POSTCHECK, ROLLBACK].map(compact);

    for (const sql of artifacts) {
      expect(sql).not.toMatch(/\b(insert\s+into|update\s+backend_auth\.|delete\s+from|truncate\s+table)\b/u);
      expect(sql).not.toContain('must start empty');
      expect(sql).not.toContain('onboarding/contact data exists');
    }
    expect(compact(PRECHECK)).toContain("'synthetic_fixture_compatible', true");
    expect(compact(POSTCHECK)).toContain("'synthetic_fixture_compatible', true");
    expect(compact(PRECHECK)).toContain("'onboarding_rows_observed'");
    expect(compact(POSTCHECK)).toContain("'onboarding_rows_observed'");
  });
});
