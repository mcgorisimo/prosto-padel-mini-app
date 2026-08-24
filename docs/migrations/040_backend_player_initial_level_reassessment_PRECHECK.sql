-- 040_backend_player_initial_level_reassessment_PRECHECK.sql
-- Read-only gate for migration 040. Must end with ROLLBACK.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local statement_timeout = '30s';

do $precheck$
declare
  v_expected record;
  v_function_oid oid;
  v_execute_acl_count bigint;
  v_state_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_onboarding_states')::oid;
  v_rating_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_rating_states')::oid;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'PRECHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null
     or not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.pg_has_role(
       'backend_auth_app',
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.has_database_privilege(
       'backend_auth_app',
       pg_catalog.current_database(),
       'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     ) then
    raise exception 'PRECHECK_FAILED: backend role boundary differs';
  end if;

  if v_state_oid is null
     or pg_catalog.obj_description(v_state_oid, 'pg_class') is distinct from
       '039_backend_player_onboarding_initial_level_result:'
         || backend_auth.relation_fingerprint(
           v_state_oid::pg_catalog.regclass
         ) then
    raise exception 'PRECHECK_FAILED: onboarding state differs from migration 039';
  end if;

  if v_rating_oid is null
     or pg_catalog.obj_description(v_rating_oid, 'pg_class') is distinct from
       '027_backend_admin_rating_state:'
         || backend_auth.relation_fingerprint(
           v_rating_oid::pg_catalog.regclass
         ) then
    raise exception 'PRECHECK_FAILED: rating state differs from migration 027';
  end if;

  for v_expected in
    select *
    from (values
      (
        'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)',
        '035_backend_player_onboarding_foundation',
        'sql',
        'i'::text,
        true,
        'boolean',
        true,
        2::bigint
      ),
      (
        'backend_auth.guard_player_onboarding_state_transition()',
        '037_backend_player_onboarding_progress_transition',
        'plpgsql',
        'v'::text,
        false,
        'trigger',
        true,
        2::bigint
      ),
      (
        'backend_auth.reject_immutable_mutation()',
        '015_backend_auth_foundation',
        'plpgsql',
        'v'::text,
        false,
        'trigger',
        false,
        1::bigint
      )
    ) expected(
      signature,
      migration_name,
      language_name,
      volatility,
      is_strict,
      result_type,
      app_execute,
      expected_acl_count
    )
  loop
    v_function_oid :=
      pg_catalog.to_regprocedure(v_expected.signature)::oid;

    if v_function_oid is null
       or not exists (
         select 1
         from pg_catalog.pg_proc procedure_row
         join pg_catalog.pg_language language_row
           on language_row.oid = procedure_row.prolang
         where procedure_row.oid = v_function_oid
           and pg_catalog.pg_get_userbyid(procedure_row.proowner) =
             'backend_auth_owner'
           and procedure_row.prokind = 'f'
           and not procedure_row.prosecdef
           and not procedure_row.proleakproof
           and not procedure_row.proretset
           and procedure_row.provolatile::text = v_expected.volatility
           and procedure_row.proisstrict = v_expected.is_strict
           and procedure_row.proconfig is not distinct from
             array['search_path=pg_catalog, pg_temp']::text[]
           and language_row.lanname = v_expected.language_name
           and pg_catalog.pg_get_function_result(procedure_row.oid) =
             v_expected.result_type
           and pg_catalog.obj_description(
             procedure_row.oid,
             'pg_proc'
           ) = v_expected.migration_name || ':'
             || pg_catalog.md5(
               pg_catalog.pg_get_functiondef(procedure_row.oid)
             )
       ) then
      raise exception 'PRECHECK_FAILED: function boundary differs for %',
        v_expected.signature;
    end if;

    select pg_catalog.count(*) into v_execute_acl_count
    from pg_catalog.pg_proc procedure_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) acl_row
    where procedure_row.oid = v_function_oid
      and acl_row.privilege_type = 'EXECUTE';

    if v_execute_acl_count <> v_expected.expected_acl_count
       or exists (
         select 1
         from pg_catalog.pg_proc procedure_row
         cross join lateral pg_catalog.aclexplode(
           coalesce(
             procedure_row.proacl,
             pg_catalog.acldefault('f', procedure_row.proowner)
           )
         ) acl_row
         where procedure_row.oid = v_function_oid
           and (
             acl_row.privilege_type <> 'EXECUTE'
             or acl_row.grantor <> procedure_row.proowner
             or acl_row.grantee not in (
               procedure_row.proowner,
               case
                 when v_expected.app_execute then
                   'backend_auth_app'::pg_catalog.regrole::oid
                 else procedure_row.proowner
               end
             )
             or acl_row.is_grantable
           )
       ) then
      raise exception 'PRECHECK_FAILED: exact function ACL differs for %',
        v_expected.signature;
    end if;
  end loop;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_state_oid,
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'public',
       v_state_oid,
       'SELECT'
     ) then
    raise exception 'PRECHECK_FAILED: onboarding state read boundary differs';
  end if;

  if pg_catalog.to_regclass(
       'backend_auth.player_initial_level_reassessments'
     ) is not null
     or pg_catalog.to_regprocedure(
       'backend_auth.guard_player_initial_level_reassessment_insert()'
     ) is not null then
    raise exception 'PRECHECK_FAILED: migration 040 target already exists';
  end if;

  if exists (
    select 1
    from backend_auth.player_onboarding_states state
    where state.status = 'completed'
      and state.survey_version = 'initial_level_v1'
      and (
        state.initial_level_score is not null
        or state.initial_level_label is not null
      )
  ) then
    raise exception 'PRECHECK_FAILED: legacy initial_level_v1 evidence shape differs';
  end if;
end;
$precheck$;

select pg_catalog.jsonb_build_object(
  'migration', '040_backend_player_initial_level_reassessment',
  'base_commit', '7a087e754b4d2a3d56b3ed8ef7896c7d2f4c7872',
  'ready', true,
  'source_state_migration', '039_backend_player_onboarding_initial_level_result',
  'source_guard_migration', '037_backend_player_onboarding_progress_transition',
  'target_absent', true,
  'eligible_completed_initial_level_v1_rows_observed', (
    select pg_catalog.count(*)
    from backend_auth.player_onboarding_states state
    where state.status = 'completed'
      and state.current_step = 'completed'
      and state.survey_version = 'initial_level_v1'
  ),
  'completed_initial_level_v2_rows_observed', (
    select pg_catalog.count(*)
    from backend_auth.player_onboarding_states state
    where state.status = 'completed'
      and state.survey_version = 'initial_level_v2'
  ),
  'rating_state_unchanged', true,
  'runtime_connected', false,
  'synthetic_fixture_compatible', true
) as backend_player_initial_level_reassessment_precheck;

rollback;
