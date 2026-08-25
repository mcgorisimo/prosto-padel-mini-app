import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function migrationFile(suffix: string): string {
  return readFileSync(
    resolve(
      __dirname,
      '../../../docs/migrations/' +
        '041_backend_personal_data_processing_consent' +
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
const MIGRATION_037 = readFileSync(
  resolve(
    __dirname,
    '../../../docs/migrations/037_backend_player_onboarding_progress_transition.sql',
  ),
  'utf8',
);
const SQL_ARTIFACTS = [MIGRATION, PRECHECK, POSTCHECK, ROLLBACK];
const POSTGRESQL_14_IMMUTABLE_TRIGGER_DEFINITION =
  'CREATE TRIGGER account_consent_acceptances_immutable_guard ' +
  'BEFORE DELETE OR UPDATE ON backend_auth.account_consent_acceptances ' +
  'FOR EACH ROW EXECUTE FUNCTION backend_auth.reject_immutable_mutation()';

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

function guardDefinition(value: string): string {
  return compact(
    between(
      value,
      'create or replace function ' +
        'backend_auth.guard_player_onboarding_state_transition()',
      'revoke all on function',
    ),
  );
}

describe('migration 041 personal data processing consent contract', () => {
  it('changes only the consent kind constraint and transition guard without row DML', () => {
    const migration = compact(MIGRATION);

    expect(
      migration.match(
        /alter table backend_auth\.account_consent_acceptances/gu,
      ),
    ).toHaveLength(1);
    expect(
      migration.match(
        /create or replace function backend_auth\.guard_player_onboarding_state_transition\(\)/gu,
      ),
    ).toHaveLength(1);
    expect(migration).not.toMatch(
      /\b(?:create|alter|drop)\s+table\s+backend_auth\.(?!account_consent_acceptances)/u,
    );
    expect(migration).not.toMatch(
      /\b(?:insert\s+into|update\s+backend_auth\.|delete\s+from|truncate\s+table)\b/u,
    );
    expect(migration).not.toContain('alter table public.');
    expect(migration).not.toContain('supabase');
    expect(migration).not.toContain('http://');
    expect(migration).not.toContain('https://');
  });

  it('widens the ledger with a distinct kind and restores the exact legacy kind set', () => {
    const migratedConstraint = compact(
      between(
        MIGRATION,
        'alter table backend_auth.account_consent_acceptances',
        'create or replace function',
      ),
    );
    const restoredConstraint = compact(
      between(
        ROLLBACK,
        'alter table backend_auth.account_consent_acceptances',
        'create or replace function',
      ),
    );

    expect(migratedConstraint).toContain(
      "consent_kind = any (array[ 'terms', 'privacy', 'cancellation', 'personal_data_processing' ]::text[])",
    );
    expect(restoredConstraint).toContain(
      "consent_kind = any (array[ 'terms', 'privacy', 'cancellation' ]::text[])",
    );
    expect(restoredConstraint).not.toContain(
      "'personal_data_processing' ]::text[]",
    );
    expect(compact(MIGRATION)).not.toMatch(
      /\b(?:rename|update|delete)\b[^;]*\bprivacy\b/u,
    );
  });

  it('accepts only legacy, new, and all-four transition evidence sets', () => {
    const definition = guardDefinition(MIGRATION);
    const expectedSets = [
      "array['cancellation', 'privacy', 'terms']::text[]",
      "array['cancellation', 'personal_data_processing', 'terms']::text[]",
      "array[ 'cancellation', 'personal_data_processing', 'privacy', 'terms' ]::text[]",
    ];

    expect(definition).toContain('v_consent_kinds text[]');
    expect(definition).not.toContain('v_consent_kind_count');
    expect(definition).not.toContain('count(distinct acceptance.consent_kind)');
    for (const expectedSet of expectedSets) {
      expect(definition.split(expectedSet)).toHaveLength(3);
    }
    for (const invalidSet of [
      "array['cancellation', 'personal_data_processing', 'privacy']::text[]",
      "array['personal_data_processing', 'privacy', 'terms']::text[]",
      "array['cancellation', 'terms']::text[]",
    ]) {
      expect(definition).not.toContain(invalidSet);
    }
  });

  it('binds both guard windows to the account, flow, and original timestamps', () => {
    const definition = guardDefinition(MIGRATION);

    expect(
      definition.split('acceptance.account_id = new.account_id'),
    ).toHaveLength(3);
    expect(
      definition.split('acceptance.flow_version = new.flow_version'),
    ).toHaveLength(3);
    expect(definition).toContain(
      'acceptance.accepted_at between new.created_at and new.updated_at',
    );
    expect(definition).toContain(
      'acceptance.accepted_at between new.created_at and new.completed_at',
    );
    expect(
      definition.split('order by consent_set.consent_kind collate "c"'),
    ).toHaveLength(3);
  });

  it('preserves transition, revision, contact, completion, and immutable guards', () => {
    const definition = guardDefinition(MIGRATION);

    for (const marker of [
      'backend_player_onboarding_insert_invalid',
      'backend_player_onboarding_state_immutable',
      'backend_player_onboarding_identity_immutable',
      'backend_player_onboarding_completed_immutable',
      'backend_player_onboarding_revision_conflict',
      'backend_player_onboarding_progress_survey_invalid',
      'backend_player_onboarding_step_invalid',
      'backend_player_onboarding_contacts_required',
      'backend_player_onboarding_completion_invalid',
      'backend_player_onboarding_consents_required',
    ]) {
      expect(definition).toContain(marker);
    }
    expect(definition).toContain(
      "old.current_step = 'contacts' and new.current_step = 'consents'",
    );
    expect(definition).toContain(
      "old.current_step = 'consents' and new.current_step = 'level_survey'",
    );
    expect(definition).toContain('new.revision <> old.revision + 1');
  });

  it('pins current dependencies, fingerprints, immutable trigger, and least privilege', () => {
    const migration = compact(MIGRATION);
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);
    const rollback = compact(ROLLBACK);

    for (const artifact of SQL_ARTIFACTS.map(compact)) {
      expect(artifact).toContain(
        "'039_backend_player_onboarding_initial_level_result:' || backend_auth.relation_fingerprint",
      );
      expect(artifact).toContain(
        "'040_backend_player_initial_level_reassessment:' || backend_auth.relation_fingerprint",
      );
      expect(artifact).toContain(
        "'015_backend_auth_foundation:' || pg_catalog.md5",
      );
    }
    expect(precheck).toContain(
      "'035_backend_player_onboarding_foundation:' || backend_auth.relation_fingerprint",
    );
    expect(precheck).toContain(
      "'037_backend_player_onboarding_progress_transition:' || pg_catalog.md5",
    );
    for (const artifact of [migration, postcheck, rollback]) {
      expect(artifact).toContain('account_consent_acceptances_immutable_guard');
      expect(artifact).toContain("'backend_auth_app'::pg_catalog.regrole::oid");
      expect(artifact).toContain('v_execute_acl_count <> 2');
    }
    expect(migration).toContain(
      "'041_backend_personal_data_processing_consent:' || backend_auth.relation_fingerprint",
    );
    expect(migration).toContain(
      "'041_backend_personal_data_processing_consent:' || pg_catalog.md5",
    );
    expect(rollback).toContain(
      "'035_backend_player_onboarding_foundation:' || backend_auth.relation_fingerprint",
    );
    expect(rollback).toContain(
      "'037_backend_player_onboarding_progress_transition:' || pg_catalog.md5",
    );
  });

  it('validates the immutable trigger structurally for PostgreSQL canonical event order', () => {
    expect(POSTGRESQL_14_IMMUTABLE_TRIGGER_DEFINITION).toContain(
      'BEFORE DELETE OR UPDATE',
    );

    const structurallyCheckedArtifacts = [MIGRATION, PRECHECK, POSTCHECK].map(
      compact,
    );
    for (const artifact of structurallyCheckedArtifacts) {
      expect(artifact).toContain('trigger_row.tgtype = 27');
      expect(artifact).toContain('trigger_row.tgfoid = v_immutable_oid');
      expect(artifact).toContain("trigger_row.tgenabled = 'o'");
      expect(artifact).toContain('trigger_row.tgconstraint = 0');
      expect(artifact).not.toContain('before update or delete');
      expect(artifact).not.toContain('before delete or update');
      expect(artifact).not.toContain(
        'pg_catalog.pg_get_triggerdef(trigger_row.oid',
      );
    }
    expect(compact(MIGRATION).split('trigger_row.tgtype = 27')).toHaveLength(3);

    for (const applyBlock of [
      between(MIGRATION, 'do $preconditions$', '$preconditions$;'),
      between(MIGRATION, 'do $assertions$', '$assertions$;'),
    ].map(compact)) {
      expect(applyBlock).toContain('v_immutable_oid oid :=');
      expect(applyBlock).toContain('backend_auth.reject_immutable_mutation()');
      expect(applyBlock).toContain('trigger_row.tgfoid = v_immutable_oid');
    }
  });

  it('provides read-only evidence gates with deterministic comparison data', () => {
    const precheck = compact(PRECHECK);
    const postcheck = compact(POSTCHECK);

    for (const gate of [precheck, postcheck]) {
      expect(gate).toContain('begin read only');
      expect(gate).toMatch(/rollback;\s*$/u);
      expect(gate).toContain("'consent_rows_observed'");
      expect(gate).toContain("'consent_rows_by_kind'");
      expect(gate).toContain("'consent_evidence_digest'");
      expect(gate).toContain('pg_catalog.string_agg');
    }
    expect(precheck).toContain(
      "'base_commit', '4d07f4099d5f48088ee3fc33f8b08c19181d7dc6'",
    );
    expect(postcheck).toContain("'accepted_evidence_sets'");
    expect(postcheck).toContain("'historical_privacy_preserved', true");
    expect(postcheck).toContain("'personal_data_processing_rows_observed', 0");
    expect(compact(MIGRATION)).toContain(
      'migration_assertion_failed: new consent evidence appeared during migration',
    );
    expect(postcheck).toContain(
      'postcheck_failed: new consent evidence appeared before runtime wiring',
    );
  });

  it('locks and fails closed instead of deleting immutable new evidence on rollback', () => {
    const rollback = compact(ROLLBACK);
    const restoredDefinition = guardDefinition(ROLLBACK);
    const sourceDefinition = compact(
      between(
        MIGRATION_037,
        'create or replace function ' +
          'backend_auth.guard_player_onboarding_state_transition()',
        'do $comments$',
      ),
    );

    expect(rollback).toContain(
      'lock table backend_auth.player_onboarding_states, backend_auth.account_consent_acceptances in access exclusive mode',
    );
    expect(rollback).toContain(
      'rollback_blocked: personal-data-processing evidence exists; use a forward migration',
    );
    expect(rollback).toContain(
      'rollback_blocked: personal-data-processing evidence appeared while locking; use a forward migration',
    );
    expect(rollback).not.toMatch(
      /\b(?:delete\s+from|update\s+backend_auth\.|truncate\s+table)\b/u,
    );
    expect(rollback).not.toContain('cascade');
    expect(restoredDefinition).toContain('v_consent_kind_count bigint');
    expect(restoredDefinition).not.toContain('v_consent_kinds text[]');
    expect(restoredDefinition).not.toContain('personal_data_processing');
    expect(restoredDefinition).toBe(sourceDefinition);
  });

  it('documents distinct schema, runtime, integration, and rollback gates', () => {
    const readme = compact(README);

    expect(readme).toContain('candidate_not_applied_runtime_disconnected');
    expect(readme).toContain(
      'this candidate must not be applied during local implementation review',
    );
    expect(readme).toContain('stop the unchanged backend');
    expect(readme).toContain('create and verify a backup');
    expect(readme).toContain('apply only');
    expect(readme).toContain(
      'new two-checkbox consent ui, policy versions, re-consent endpoints, and runtime writes',
    );
    expect(readme).toContain(
      'the auth-integration catalog intentionally remains unchanged',
    );
    expect(readme).toContain(
      'it refuses before and after acquiring locks if any `personal_data_processing` evidence exists',
    );
  });
});
