-- 039_backend_player_onboarding_initial_level_result_PRECHECK.sql
-- Read-only gate for migration 039. Must end with ROLLBACK.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local statement_timeout = '30s';

do $precheck$
declare
  v_state_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_onboarding_states')::oid;
  v_guard_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.guard_player_onboarding_state_transition()'
  )::oid;
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
       '035_backend_player_onboarding_foundation:'
         || backend_auth.relation_fingerprint(
           v_state_oid::pg_catalog.regclass
         ) then
    raise exception 'PRECHECK_FAILED: onboarding state relation differs from migration 035';
  end if;

  if v_guard_oid is null
     or pg_catalog.obj_description(v_guard_oid, 'pg_proc') is distinct from
       '037_backend_player_onboarding_progress_transition:'
         || pg_catalog.md5(pg_catalog.pg_get_functiondef(v_guard_oid))
     or not pg_catalog.has_function_privilege(
       'backend_auth_app',
       v_guard_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege('public', v_guard_oid, 'EXECUTE') then
    raise exception 'PRECHECK_FAILED: migration-037 transition guard differs';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_state_oid,
       'UPDATE'
     )
     or pg_catalog.has_table_privilege('public', v_state_oid, 'SELECT')
     or pg_catalog.has_table_privilege('public', v_state_oid, 'UPDATE') then
    raise exception 'PRECHECK_FAILED: onboarding state table ACL differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = v_state_oid
      and attribute.attname in (
        'initial_level_score',
        'initial_level_label'
      )
      and not attribute.attisdropped
  )
     or exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_state_oid
         and constraint_row.conname in (
           'player_onboarding_states_initial_level_score_check',
           'player_onboarding_states_initial_level_label_check',
           'player_onboarding_states_initial_level_result_check'
         )
     ) then
    raise exception 'PRECHECK_FAILED: migration 039 target already exists';
  end if;

  if exists (
    select 1
    from backend_auth.player_onboarding_states state
    where state.survey_version = 'initial_level_v2'
  ) then
    raise exception 'PRECHECK_FAILED: initial_level_v2 data predates its result contract';
  end if;
end;
$precheck$;

select pg_catalog.jsonb_build_object(
  'migration', '039_backend_player_onboarding_initial_level_result',
  'base_commit', '9dbac1669a046900bef6290ae6b83fd4fdf533de',
  'ready', true,
  'source_relation_migration', '035_backend_player_onboarding_foundation',
  'source_guard_migration', '037_backend_player_onboarding_progress_transition',
  'initial_level_v2_rows_observed', (
    select pg_catalog.count(*)
    from backend_auth.player_onboarding_states state
    where state.survey_version = 'initial_level_v2'
  ),
  'legacy_completed_rows_observed', (
    select pg_catalog.count(*)
    from backend_auth.player_onboarding_states state
    where state.status = 'completed'
      and state.survey_version <> 'initial_level_v2'
  ),
  'synthetic_fixture_compatible', true,
  'data_writes', false
) as backend_player_onboarding_initial_level_result_precheck;

rollback;
