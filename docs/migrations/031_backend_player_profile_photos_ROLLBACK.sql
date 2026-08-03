-- Fail-closed rollback for an unused migration 031.
-- Once profile photo metadata exists, preserve it and use a forward migration.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_asset_oid oid := pg_catalog.to_regclass(
    'backend_auth.player_profile_photo_assets'
  );
  v_state_oid oid := pg_catalog.to_regclass(
    'backend_auth.player_profile_photo_states'
  );
  v_function_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.guard_player_profile_photo_state_transition()'
  );
begin
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot assume backend_auth_owner';
  end if;

  if v_asset_oid is null
     or v_state_oid is null
     or pg_catalog.obj_description(v_asset_oid, 'pg_class') <>
       '031_backend_player_profile_photos:'
         || backend_auth.relation_fingerprint(v_asset_oid::pg_catalog.regclass)
     or pg_catalog.obj_description(v_state_oid, 'pg_class') <>
       '031_backend_player_profile_photos:'
         || backend_auth.relation_fingerprint(v_state_oid::pg_catalog.regclass)
     or v_function_oid is null
     or not exists (
       select 1
       from pg_catalog.pg_proc routine
       join pg_catalog.pg_language language on language.oid = routine.prolang
       where routine.oid = v_function_oid
         and pg_catalog.pg_get_userbyid(routine.proowner) = 'backend_auth_owner'
         and language.lanname = 'plpgsql'
         and not routine.prosecdef
         and not routine.proretset
         and routine.provolatile = 'v'
         and routine.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
     )
     or exists (
       select 1
       from pg_catalog.pg_proc routine
       cross join lateral pg_catalog.aclexplode(
         coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
       ) acl
       where routine.oid = v_function_oid
         and acl.grantee <> routine.proowner
     )
     or (select pg_catalog.count(*)
         from pg_catalog.pg_trigger trigger_row
         where trigger_row.tgrelid = v_state_oid
           and not trigger_row.tgisinternal
           and trigger_row.tgname = 'player_profile_photo_states_transition_guard'
           and trigger_row.tgenabled = 'O'
           and trigger_row.tgtype = 23
           and trigger_row.tgfoid = v_function_oid) <> 1
     or exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid in (v_asset_oid, v_state_oid)
         and not trigger_row.tgisinternal
         and not (
           trigger_row.tgrelid = v_state_oid
           and trigger_row.tgname = 'player_profile_photo_states_transition_guard'
           and trigger_row.tgenabled = 'O'
           and trigger_row.tgtype = 23
           and trigger_row.tgfoid = v_function_oid
         )
     ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 031 object differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table
  backend_auth.player_profiles,
  backend_auth.player_profile_photo_assets,
  backend_auth.player_profile_photo_states
in access exclusive mode;

do $empty_guard$
begin
  if exists (select 1 from backend_auth.player_profile_photo_assets)
     or exists (select 1 from backend_auth.player_profile_photo_states) then
    raise exception 'ROLLBACK_REFUSED: profile photo history exists; use a forward migration';
  end if;
end;
$empty_guard$;

drop table backend_auth.player_profile_photo_states;
drop table backend_auth.player_profile_photo_assets;
drop function backend_auth.guard_player_profile_photo_state_transition();

do $assertions$
begin
  if pg_catalog.to_regclass(
       'backend_auth.player_profile_photo_assets'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.player_profile_photo_assets_pkey'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.player_profile_photo_assets_account_generation_key'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.player_profile_photo_assets_account_generation_asset_key'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.player_profile_photo_assets_storage_prefix_key'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.player_profile_photo_states'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.player_profile_photo_states_pkey'
     ) is not null
     or pg_catalog.to_regprocedure(
       'backend_auth.guard_player_profile_photo_state_transition()'
     ) is not null then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 031 object remains';
  end if;
end;
$assertions$;

reset role;
commit;

select '031_backend_player_profile_photos rolled back before first photo upload'
  as result;
