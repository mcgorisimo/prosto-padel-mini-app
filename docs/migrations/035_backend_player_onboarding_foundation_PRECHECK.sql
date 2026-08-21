-- 035_backend_player_onboarding_foundation_PRECHECK.sql
-- Read-only catalog verification for the exact runtime-disconnected base.

begin;
set transaction read only;
set local search_path = pg_catalog, pg_temp;
set local statement_timeout = '30s';

do $precheck$
declare
  v_relation record;
  v_details_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
  v_immutable_function oid := pg_catalog.to_regprocedure(
    'backend_auth.reject_immutable_mutation()'
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
     ) then
    raise exception 'PRECHECK_FAILED: required role boundary is unavailable';
  end if;

  if pg_catalog.has_database_privilege(
       'backend_auth_app',
       pg_catalog.current_database(),
       'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     ) then
    raise exception 'PRECHECK_FAILED: application CREATE privileges are unsafe';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_auth', 'accounts', '015_backend_auth_foundation'),
      ('backend_auth', 'player_profiles', '015_backend_auth_foundation'),
      (
        'backend_auth',
        'player_profile_details',
        '018_backend_auth_player_profile_editable_fields'
      ),
      (
        'backend_auth',
        'player_rating_states',
        '019_backend_auth_player_rating_state'
      )
    ) expected(schema_name, relation_name, migration_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = v_relation.schema_name
        and relation.relname = v_relation.relation_name
        and relation.relkind = 'r'
        and relation.relpersistence = 'p'
        and not relation.relrowsecurity
        and not relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) =
          'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          v_relation.migration_name || ':'
            || backend_auth.relation_fingerprint(
              relation.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'PRECHECK_FAILED: %.% differs from %',
        v_relation.schema_name,
        v_relation.relation_name,
        v_relation.migration_name;
    end if;
  end loop;

  if v_immutable_function is null
     or pg_catalog.obj_description(
       v_immutable_function,
       'pg_proc'
     ) is distinct from
       '015_backend_auth_foundation:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_immutable_function)
         ) then
    raise exception 'PRECHECK_FAILED: immutable guard differs from migration 015';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = v_details_oid
      and attribute.attname = 'normalized_email'
      and not attribute.attisdropped
  )
     or exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_details_oid
         and constraint_row.conname =
           'player_profile_details_normalized_email_check'
     )
     or pg_catalog.to_regclass(
       'backend_auth.player_onboarding_states'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.account_consent_acceptances'
     ) is not null
     or pg_catalog.to_regprocedure(
       'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'backend_auth.guard_player_onboarding_state_transition()'
     ) is not null then
    raise exception 'PRECHECK_FAILED: migration 035 target already exists';
  end if;
end;
$precheck$;

select pg_catalog.jsonb_build_object(
  'migration', '035_backend_player_onboarding_foundation',
  'base_commit', 'a3c2fe0c2b03f3e4f18b30001c7ceb780969fdf8',
  'ready', true,
  'runtime_connected', false,
  'target_absent', true,
  'rating_state', 'unchanged_019',
  'contact_verification', false
) as precheck_result;

rollback;
