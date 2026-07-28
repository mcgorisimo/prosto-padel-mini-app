import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migrationFile(suffix: string): string {
  return readFileSync(
    resolve(
      __dirname,
      `../../../docs/migrations/018_backend_auth_player_profile_editable_fields${suffix}`,
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

describe('migration 018 editable player-profile contract', () => {
  it('changes only the existing private profile relation and narrow ACL', () => {
    const sql = compact(MIGRATION);
    expect(sql).toContain(
      'alter table backend_auth.player_profile_details add column phone text, add column side_preference text',
    );
    expect(sql).toContain(
      "phone ~ '^\\+[1-9][0-9]{6,14}$'",
    );
    expect(sql).toContain(
      "side_preference in ('left', 'both', 'right')",
    );
    expect(sql).toContain(
      'grant update ( first_name, last_name, phone, side_preference, updated_at ) on backend_auth.player_profile_details to backend_auth_app',
    );
    expect(sql).not.toMatch(/\b(create|drop)\s+table\b/u);
    expect(sql).not.toMatch(/\b(insert|delete)\s+(into|from)\b/u);
    expect(sql).not.toContain('public.profiles');
    expect(sql).not.toContain('rating');
    expect(sql).not.toContain('verification');
    expect(sql).not.toContain('grant update on table');
  });

  it('keeps PRECHECK and POSTCHECK read-only and exact', () => {
    expect(compact(PRECHECK)).toContain('set transaction read only');
    expect(compact(PRECHECK)).toContain(
      "'017_backend_auth_player_profile_details:' || backend_auth.relation_fingerprint",
    );
    expect(compact(POSTCHECK)).toContain('set transaction read only');
    expect(compact(POSTCHECK)).toContain(
      'cross join lateral pg_catalog.aclexplode(a.attacl)',
    );
    expect(compact(POSTCHECK)).toContain(
      '(select * from expected except select * from actual)',
    );
    expect(compact(POSTCHECK)).toContain(
      '(select * from actual except select * from expected)',
    );
    expect(compact(POSTCHECK)).toContain(
      "check (side_preference is null or (side_preference = any (array[''left''::text, ''both''::text, ''right''::text])))",
    );
    expect(compact(POSTCHECK)).not.toMatch(/\b(like|strpos|position)\s*\(/u);
  });

  it('fails rollback closed after editable data is stored', () => {
    const sql = compact(ROLLBACK);
    expect(sql).toContain(
      'where phone is not null or side_preference is not null',
    );
    expect(sql).toContain(
      'rollback_blocked: editable profile fields contain data',
    );
    expect(sql).toContain(
      'revoke update ( first_name, last_name, phone, side_preference, updated_at )',
    );
    expect(sql).not.toContain('cascade');
  });

  it('documents manual test-first rollout and no automatic SQL apply', () => {
    expect(README).toContain('backup test-базы');
    expect(README).toContain('PRECHECK');
    expect(README).toContain('POSTCHECK');
    expect(README).toContain('Команды не выполняются автоматически');
    expect(README).toContain('rating');
    expect(README).toContain('verification');
  });
});
