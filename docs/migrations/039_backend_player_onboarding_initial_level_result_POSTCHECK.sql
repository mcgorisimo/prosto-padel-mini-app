-- 039_backend_player_onboarding_initial_level_result_POSTCHECK.sql
-- Read-only verification for an applied migration 039. Must end with ROLLBACK.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local statement_timeout = '30s';

do $postcheck$
declare
  v_state_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_onboarding_states')::oid;
  v_guard_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.guard_player_onboarding_state_transition()'
  )::oid;
begin
  if v_state_oid is null
     or pg_catalog.obj_description(v_state_oid, 'pg_class') is distinct from
       '039_backend_player_onboarding_initial_level_result:'
         || backend_auth.relation_fingerprint(
           v_state_oid::pg_catalog.regclass
         ) then
    raise exception 'POSTCHECK_FAILED: onboarding state relation differs from migration 039';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_attribute attribute
       left join pg_catalog.pg_attrdef default_row
         on default_row.adrelid = attribute.attrelid
        and default_row.adnum = attribute.attnum
       where attribute.attrelid = v_state_oid
         and not attribute.attisdropped
         and not attribute.attnotnull
         and default_row.oid is null
         and (
           (
             attribute.attname = 'initial_level_score'
             and pg_catalog.format_type(
               attribute.atttypid,
               attribute.atttypmod
             ) = 'smallint'
           )
           or (
             attribute.attname = 'initial_level_label'
             and pg_catalog.format_type(
               attribute.atttypid,
               attribute.atttypmod
             ) = 'text'
           )
         )
     ) <> 2 then
    raise exception 'POSTCHECK_FAILED: initial-level result columns differ';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_state_oid
         and constraint_row.contype = 'c'
         and constraint_row.convalidated
         and constraint_row.conname in (
           'player_onboarding_states_initial_level_score_check',
           'player_onboarding_states_initial_level_label_check',
           'player_onboarding_states_initial_level_result_check'
         )
     ) <> 3 then
    raise exception 'POSTCHECK_FAILED: initial-level result constraints differ';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_state_oid
         and constraint_row.conname =
           'player_onboarding_states_initial_level_score_check'
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), 'initial_level_score is null') > 0
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), 'initial_level_score >= 0') > 0
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), 'initial_level_score <= 20') > 0
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_state_oid
         and constraint_row.conname =
           'player_onboarding_states_initial_level_label_check'
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), 'initial_level_label is null') > 0
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), '= any') > 0
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), 'array[''d''::text, ''d+''::text, ''c''::text, ''c+''::text, ''b''::text, ''b+''::text, ''a''::text]') > 0
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_state_oid
         and constraint_row.conname =
           'player_onboarding_states_initial_level_result_check'
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), 'survey_version = ''initial_level_v2''::text') > 0
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), 'survey_version <> ''initial_level_v2''::text') > 0
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), 'initial_level_score is not null') > 0
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), 'initial_level_label is not null') > 0
     ) then
    raise exception 'POSTCHECK_FAILED: initial-level constraint definitions differ';
  end if;

  if not pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_state_oid,
       'initial_level_score',
       'UPDATE'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_state_oid,
       'initial_level_label',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_state_oid,
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'public',
       v_state_oid,
       'initial_level_score',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'public',
       v_state_oid,
       'initial_level_label',
       'UPDATE'
     ) then
    raise exception 'POSTCHECK_FAILED: initial-level result ACL differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_attribute attribute
       join pg_catalog.pg_class relation
         on relation.oid = attribute.attrelid
       join lateral pg_catalog.aclexplode(
         coalesce(attribute.attacl, '{}'::pg_catalog.aclitem[])
       ) acl_row on true
       where attribute.attrelid = v_state_oid
         and attribute.attname in (
           'initial_level_score',
           'initial_level_label'
         )
         and not attribute.attisdropped
         and acl_row.privilege_type = 'UPDATE'
         and acl_row.grantee =
           'backend_auth_app'::pg_catalog.regrole::oid
         and not acl_row.is_grantable
         and acl_row.grantor = relation.relowner
     ) <> 2
     or exists (
       select 1
       from pg_catalog.pg_attribute attribute
       join pg_catalog.pg_class relation
         on relation.oid = attribute.attrelid
       join lateral pg_catalog.aclexplode(
         coalesce(attribute.attacl, '{}'::pg_catalog.aclitem[])
       ) acl_row on true
       where attribute.attrelid = v_state_oid
         and attribute.attname in (
           'initial_level_score',
           'initial_level_label'
         )
         and not attribute.attisdropped
         and (
           acl_row.privilege_type <> 'UPDATE'
           or acl_row.grantee <>
             'backend_auth_app'::pg_catalog.regrole::oid
           or acl_row.is_grantable
           or acl_row.grantor <> relation.relowner
         )
     ) then
    raise exception 'POSTCHECK_FAILED: initial-level column ACL has an unexpected grant';
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
    raise exception 'POSTCHECK_FAILED: migration-037 transition guard changed';
  end if;

  if exists (
    select 1
    from backend_auth.player_onboarding_states state
    where not (
      (
        state.status = 'completed'
        and state.survey_version = 'initial_level_v2'
        and state.initial_level_score is not null
        and state.initial_level_label is not null
      )
      or (
        (
          state.status <> 'completed'
          or state.survey_version <> 'initial_level_v2'
        )
        and state.initial_level_score is null
        and state.initial_level_label is null
      )
    )
  ) then
    raise exception 'POSTCHECK_FAILED: persisted initial-level result shape differs';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'migration', '039_backend_player_onboarding_initial_level_result',
  'applied', true,
  'relation_fingerprint', '039_backend_player_onboarding_initial_level_result',
  'source_guard_migration', '037_backend_player_onboarding_progress_transition',
  'score_column_nullable', true,
  'label_column_nullable', true,
  'backend_auth_app_column_update', true,
  'backend_auth_app_table_update', false,
  'public_update', false,
  'legacy_completed_rows_observed', (
    select pg_catalog.count(*)
    from backend_auth.player_onboarding_states state
    where state.status = 'completed'
      and state.survey_version <> 'initial_level_v2'
  ),
  'initial_level_v2_rows_observed', (
    select pg_catalog.count(*)
    from backend_auth.player_onboarding_states state
    where state.survey_version = 'initial_level_v2'
  ),
  'synthetic_fixture_compatible', true
) as backend_player_onboarding_initial_level_result_postcheck;

rollback;
