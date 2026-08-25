-- 041_backend_personal_data_processing_consent_POSTCHECK.sql
-- Read-only exact verification after a separately approved migration 041 apply.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_acceptance_oid oid := pg_catalog.to_regclass(
    'backend_auth.account_consent_acceptances'
  )::oid;
  v_state_oid oid := pg_catalog.to_regclass(
    'backend_auth.player_onboarding_states'
  )::oid;
  v_reassessment_oid oid := pg_catalog.to_regclass(
    'backend_auth.player_initial_level_reassessments'
  )::oid;
  v_guard_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.guard_player_onboarding_state_transition()'
  )::oid;
  v_immutable_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.reject_immutable_mutation()'
  )::oid;
  v_guard_definition text;
  v_column text;
  v_execute_acl_count bigint;
begin
  if v_acceptance_oid is null
     or pg_catalog.obj_description(v_acceptance_oid, 'pg_class') is distinct from
       '041_backend_personal_data_processing_consent:'
         || backend_auth.relation_fingerprint(
           v_acceptance_oid::pg_catalog.regclass
         ) then
    raise exception 'POSTCHECK_FAILED: consent ledger differs from migration 041';
  end if;

  if v_state_oid is null
     or pg_catalog.obj_description(v_state_oid, 'pg_class') is distinct from
       '039_backend_player_onboarding_initial_level_result:'
         || backend_auth.relation_fingerprint(
           v_state_oid::pg_catalog.regclass
         )
     or v_reassessment_oid is null
     or pg_catalog.obj_description(v_reassessment_oid, 'pg_class') is distinct from
       '040_backend_player_initial_level_reassessment:'
         || backend_auth.relation_fingerprint(
           v_reassessment_oid::pg_catalog.regclass
         ) then
    raise exception 'POSTCHECK_FAILED: unrelated onboarding relation changed';
  end if;

  if v_guard_oid is null
     or pg_catalog.obj_description(v_guard_oid, 'pg_proc') is distinct from
       '041_backend_personal_data_processing_consent:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_guard_oid)
         ) then
    raise exception 'POSTCHECK_FAILED: transition guard differs from migration 041';
  end if;

  if v_immutable_oid is null
     or pg_catalog.obj_description(v_immutable_oid, 'pg_proc') is distinct from
       '015_backend_auth_foundation:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_immutable_oid)
         ) then
    raise exception 'POSTCHECK_FAILED: immutable guard differs from migration 015';
  end if;

  if (
       select pg_catalog.array_agg(
         constraint_row.conname::text
         order by constraint_row.conname::text collate "C"
       )
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_acceptance_oid
     ) is distinct from array[
       'account_consent_acceptances_account_id_fkey',
       'account_consent_acceptances_kind_check',
       'account_consent_acceptances_pkey',
       'account_consent_acceptances_time_check',
       'account_consent_acceptances_version_check'
     ]::text[] then
    raise exception 'POSTCHECK_FAILED: consent constraint set differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_acceptance_oid
         and constraint_row.conname =
           'account_consent_acceptances_kind_check'
         and constraint_row.contype = 'c'
         and constraint_row.convalidated
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           '''terms'''
         ) > 0
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           '''privacy'''
         ) > 0
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           '''cancellation'''
         ) > 0
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           '''personal_data_processing'''
         ) > 0
     ) <> 1 then
    raise exception 'POSTCHECK_FAILED: exact four-kind consent constraint differs';
  end if;

  if (
       select pg_catalog.array_agg(
         index_relation.relname::text
         order by index_relation.relname::text collate "C"
       )
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_class index_relation
         on index_relation.oid = index_row.indexrelid
       where index_row.indrelid = v_acceptance_oid
         and index_row.indisvalid
         and index_row.indisready
     ) is distinct from array[
       'account_consent_acceptances_pkey'
     ]::text[] then
    raise exception 'POSTCHECK_FAILED: consent index set differs';
  end if;

  if (
       select pg_catalog.array_agg(
         trigger_row.tgname::text
         order by trigger_row.tgname::text collate "C"
       )
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = v_acceptance_oid
         and not trigger_row.tgisinternal
     ) is distinct from array[
       'account_consent_acceptances_immutable_guard'
     ]::text[] then
    raise exception 'POSTCHECK_FAILED: consent immutability trigger set differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = v_acceptance_oid
         and not trigger_row.tgisinternal
         and trigger_row.tgname =
           'account_consent_acceptances_immutable_guard'
         -- pg_trigger.tgtype = ROW (1) | BEFORE (2) | DELETE (8) | UPDATE (16).
         and trigger_row.tgtype = 27
         and trigger_row.tgfoid = v_immutable_oid
         and trigger_row.tgenabled = 'O'
         and trigger_row.tgconstraint = 0
     ) <> 1 then
    raise exception 'POSTCHECK_FAILED: consent immutability trigger differs';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_acceptance_oid,
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_acceptance_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'public',
       v_acceptance_oid,
       'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     ) then
    raise exception 'POSTCHECK_FAILED: consent table ACL differs';
  end if;

  foreach v_column in array array[
    'account_id',
    'consent_kind',
    'document_version',
    'flow_version',
    'accepted_at'
  ]::text[] loop
    if not pg_catalog.has_column_privilege(
      'backend_auth_app',
      v_acceptance_oid,
      v_column,
      'INSERT'
    )
       or pg_catalog.has_column_privilege(
         'backend_auth_app',
         v_acceptance_oid,
         v_column,
         'UPDATE'
       ) then
      raise exception 'POSTCHECK_FAILED: consent column ACL differs for %',
        v_column;
    end if;
  end loop;

  select pg_catalog.count(*) into v_execute_acl_count
  from pg_catalog.pg_proc procedure_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      procedure_row.proacl,
      pg_catalog.acldefault('f', procedure_row.proowner)
    )
  ) acl_row
  where procedure_row.oid = v_guard_oid
    and acl_row.privilege_type = 'EXECUTE';

  if not pg_catalog.has_function_privilege(
       'backend_auth_app',
       v_guard_oid,
       'EXECUTE'
     )
     or v_execute_acl_count <> 2
     or exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) acl_row
       where procedure_row.oid = v_guard_oid
         and (
           acl_row.privilege_type <> 'EXECUTE'
           or acl_row.grantee not in (
             procedure_row.proowner,
             'backend_auth_app'::pg_catalog.regrole::oid
           )
           or acl_row.grantor <> procedure_row.proowner
           or acl_row.is_grantable
         )
     ) then
    raise exception 'POSTCHECK_FAILED: transition guard ACL differs';
  end if;

  v_guard_definition := pg_catalog.pg_get_functiondef(v_guard_oid);
  if pg_catalog.strpos(v_guard_definition, 'v_consent_kinds text[]') = 0
     or pg_catalog.strpos(
       v_guard_definition,
       'personal_data_processing'
     ) = 0
     or pg_catalog.strpos(
       v_guard_definition,
       'BACKEND_PLAYER_ONBOARDING_CONSENTS_REQUIRED'
     ) = 0
     or pg_catalog.strpos(v_guard_definition, 'v_consent_kind_count') <> 0 then
    raise exception 'POSTCHECK_FAILED: compatible consent guard differs';
  end if;

  if exists (
    select 1
    from backend_auth.account_consent_acceptances acceptance
    where acceptance.consent_kind <> all (array[
      'terms',
      'privacy',
      'cancellation',
      'personal_data_processing'
    ]::text[])
  ) then
    raise exception 'POSTCHECK_FAILED: unsupported consent evidence exists';
  end if;

  if exists (
    select 1
    from backend_auth.account_consent_acceptances
    where consent_kind = 'personal_data_processing'
  ) then
    raise exception 'POSTCHECK_FAILED: new consent evidence appeared before runtime wiring';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'migration', '041_backend_personal_data_processing_consent',
  'verified', true,
  'runtime_connected', false,
  'historical_privacy_preserved', true,
  'personal_data_processing_rows_observed', 0,
  'accepted_evidence_sets', pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_array('cancellation', 'privacy', 'terms'),
    pg_catalog.jsonb_build_array(
      'cancellation',
      'personal_data_processing',
      'terms'
    ),
    pg_catalog.jsonb_build_array(
      'cancellation',
      'personal_data_processing',
      'privacy',
      'terms'
    )
  ),
  'consent_rows_observed', (
    select pg_catalog.count(*)
    from backend_auth.account_consent_acceptances
  ),
  'consent_rows_by_kind', (
    select coalesce(
      pg_catalog.jsonb_object_agg(
        counts.consent_kind,
        counts.row_count
        order by counts.consent_kind
      ),
      '{}'::pg_catalog.jsonb
    )
    from (
      select consent_kind, pg_catalog.count(*) as row_count
      from backend_auth.account_consent_acceptances
      group by consent_kind
    ) counts
  ),
  'consent_evidence_digest', (
    select pg_catalog.md5(coalesce(
      pg_catalog.string_agg(
        pg_catalog.concat_ws(
          '|',
          account_id::text,
          consent_kind,
          document_version,
          flow_version,
          accepted_at::text
        ),
        E'\n'
        order by
          account_id,
          consent_kind collate "C",
          document_version collate "C",
          flow_version collate "C",
          accepted_at
      ),
      ''
    ))
    from backend_auth.account_consent_acceptances
  )
) as backend_personal_data_processing_consent_postcheck;

rollback;
