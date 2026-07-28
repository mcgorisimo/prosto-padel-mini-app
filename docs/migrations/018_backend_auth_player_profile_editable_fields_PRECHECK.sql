-- 018_backend_auth_player_profile_editable_fields_PRECHECK.sql
-- Read-only preflight for migration 018.

begin;
set transaction read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
declare
  v_relation_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
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
     ) then
    raise exception 'PRECHECK_FAILED: required role boundary is unavailable';
  end if;

  if pg_catalog.pg_has_role(
       'backend_auth_app',
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     ) then
    raise exception 'PRECHECK_FAILED: backend_auth_app privileges are unsafe';
  end if;

  if v_relation_oid is null
     or pg_catalog.pg_get_userbyid(
       (select c.relowner from pg_catalog.pg_class c where c.oid = v_relation_oid)
     ) <> 'backend_auth_owner'
     or pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
       '017_backend_auth_player_profile_details:'
         || backend_auth.relation_fingerprint(
           v_relation_oid::pg_catalog.regclass
         ) then
    raise exception 'PRECHECK_FAILED: player_profile_details is not the canonical migration 017 relation';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_attribute a
      where a.attrelid = v_relation_oid
        and a.attnum > 0
        and not a.attisdropped) <> 8
     or (select pg_catalog.count(*)
         from pg_catalog.pg_constraint c
         where c.conrelid = v_relation_oid) <> 8 then
    raise exception 'PRECHECK_FAILED: migration 017 relation shape differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = v_relation_oid
      and a.attname in ('phone', 'side_preference')
      and not a.attisdropped
  )
     or exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = v_relation_oid
         and c.conname in (
           'player_profile_details_phone_check',
           'player_profile_details_side_preference_check'
         )
     ) then
    raise exception 'PRECHECK_FAILED: migration 018 is already or partially applied';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_relation_oid,
       'UPDATE'
     )
     or exists (
       select 1
       from pg_catalog.pg_attribute a
       where a.attrelid = v_relation_oid
         and a.attnum > 0
         and not a.attisdropped
         and pg_catalog.has_column_privilege(
           'backend_auth_app',
           v_relation_oid,
           a.attname,
           'UPDATE'
         )
     ) then
    raise exception 'PRECHECK_FAILED: migration 017 UPDATE boundary differs';
  end if;
end;
$precheck$;

select pg_catalog.jsonb_build_object(
  'migration', '018_backend_auth_player_profile_editable_fields',
  'relation', 'backend_auth.player_profile_details',
  'row_count', (
    select pg_catalog.count(*)
    from backend_auth.player_profile_details
  ),
  'ready', true
) as backend_auth_player_profile_editable_fields_precheck;

rollback;
