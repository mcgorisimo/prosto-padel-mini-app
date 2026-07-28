-- 019_backend_auth_player_rating_state_ROLLBACK.sql
-- Safe rollback while the relation contains only reproducible default state.

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
    pg_catalog.to_regclass('backend_auth.player_rating_states')::oid;
begin
  if v_relation_oid is null
     or pg_catalog.pg_get_userbyid(
       (select c.relowner
        from pg_catalog.pg_class c
        where c.oid = v_relation_oid)
     ) <> 'backend_auth_owner'
     or pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
       '019_backend_auth_player_rating_state:'
         || backend_auth.relation_fingerprint(
           v_relation_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 019 relation differs';
  end if;

  if exists (
    select 1
    from backend_auth.player_rating_states states
    join backend_auth.accounts accounts on accounts.id = states.account_id
    where states.rating <> 3.00
       or states.is_verified
       or states.created_at <> accounts.created_at
       or states.updated_at <> accounts.updated_at
  )
     or exists (
       select profiles.account_id
       from backend_auth.player_profiles profiles
       except
       select states.account_id
       from backend_auth.player_rating_states states
     )
     or exists (
       select states.account_id
       from backend_auth.player_rating_states states
       except
       select profiles.account_id
       from backend_auth.player_profiles profiles
     ) then
    raise exception 'ROLLBACK_BLOCKED: player_rating_states contains non-default or incomplete state';
  end if;
end;
$preconditions$;

drop table backend_auth.player_rating_states;

do $assertions$
declare
  v_expected record;
  v_count bigint;
  v_details_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
begin
  if pg_catalog.to_regclass('backend_auth.player_rating_states') is not null
     or pg_catalog.to_regclass('backend_auth.player_rating_states_pkey') is not null
     or exists (
       select 1
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'backend_auth'
         and c.relname = 'player_rating_states'
     ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: player_rating_states still exists';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and c.relkind = 'r';

  if v_count <> 15 then
    raise exception 'ROLLBACK_ASSERTION_FAILED: expected 15 backend_auth tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth';

  if v_count <> 156 then
    raise exception 'ROLLBACK_ASSERTION_FAILED: expected 156 backend_auth constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and not t.tgisinternal;

  if v_count <> 33 then
    raise exception 'ROLLBACK_ASSERTION_FAILED: expected 33 backend_auth user triggers, found %',
      v_count;
  end if;

  for v_expected in
    select *
    from (values
      ('accounts'),
      ('player_profiles'),
      ('external_identities'),
      ('external_identity_lookup_digests'),
      ('authentication_operations'),
      ('telegram_proof_consumptions'),
      ('auth_session_families'),
      ('auth_session_credentials'),
      ('auth_session_commands'),
      ('fresh_authentication_evidence'),
      ('reauthentication_grants'),
      ('otp_challenges'),
      ('otp_commands'),
      ('security_audit_events')
    ) expected(table_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'backend_auth'
        and c.relname = v_expected.table_name
        and c.relkind = 'r'
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '015_backend_auth_foundation:'
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'ROLLBACK_ASSERTION_FAILED: existing backend_auth.% structure changed',
        v_expected.table_name;
    end if;
  end loop;

  if v_details_oid is null
     or pg_catalog.obj_description(v_details_oid, 'pg_class') is distinct from
       '018_backend_auth_player_profile_editable_fields:'
         || backend_auth.relation_fingerprint(
           v_details_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: player_profile_details changed';
  end if;
end;
$assertions$;

reset role;
commit;

select '019_backend_auth_player_rating_state rolled back while only neutral defaults existed'
  as result;
