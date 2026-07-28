-- 018_backend_auth_player_profile_editable_fields_ROLLBACK.sql
-- Data-safe rollback. It refuses to drop either new field after it is used.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $role_precheck$
begin
  if pg_catalog.to_regrole('backend_auth_owner') is null
     or not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: owner role boundary is unavailable';
  end if;
end;
$role_precheck$;

set local role backend_auth_owner;

do $preconditions$
declare
  v_relation_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
begin
  if v_relation_oid is null
     or pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
       '018_backend_auth_player_profile_editable_fields:'
         || backend_auth.relation_fingerprint(
           v_relation_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 018 relation differs';
  end if;

  if exists (
    select 1
    from backend_auth.player_profile_details
    where phone is not null or side_preference is not null
  ) then
    raise exception 'ROLLBACK_BLOCKED: editable profile fields contain data';
  end if;
end;
$preconditions$;

revoke update (
  first_name,
  last_name,
  phone,
  side_preference,
  updated_at
) on backend_auth.player_profile_details from backend_auth_app;

alter table backend_auth.player_profile_details
  drop constraint player_profile_details_phone_check,
  drop constraint player_profile_details_side_preference_check,
  drop column phone,
  drop column side_preference;

do $comment$
begin
  execute pg_catalog.format(
    'comment on table backend_auth.player_profile_details is %L',
    '017_backend_auth_player_profile_details:'
      || backend_auth.relation_fingerprint(
        'backend_auth.player_profile_details'::pg_catalog.regclass
      )
  );
end;
$comment$;

do $assertions$
declare
  v_relation_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
begin
  if (select pg_catalog.count(*)
      from pg_catalog.pg_attribute a
      where a.attrelid = v_relation_oid
        and a.attnum > 0
        and not a.attisdropped) <> 8
     or (select pg_catalog.count(*)
         from pg_catalog.pg_constraint c
         where c.conrelid = v_relation_oid) <> 8
     or pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
       '017_backend_auth_player_profile_details:'
         || backend_auth.relation_fingerprint(
           v_relation_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 017 relation was not restored';
  end if;
end;
$assertions$;

reset role;
commit;

select '018_backend_auth_player_profile_editable_fields rolled back before editable data was stored'
  as result;
