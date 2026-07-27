-- 017_backend_auth_player_profile_details_ROLLBACK.sql
-- Safe rollback before a writer is deployed. Refuses to drop persisted profiles.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $role_precheck$
begin
  if pg_catalog.to_regrole('backend_auth_owner') is null then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: backend_auth_owner is missing';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot SET ROLE backend_auth_owner';
  end if;
end;
$role_precheck$;

set local role backend_auth_owner;

do $preconditions$
declare
  v_relation_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
begin
  if v_relation_oid is null then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: backend_auth.player_profile_details is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = v_relation_oid
      and c.relkind = 'r'
      and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(c.oid, 'pg_class') =
        '017_backend_auth_player_profile_details:'
          || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
  ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: player_profile_details structure, owner, or fingerprint differs';
  end if;

  if (select pg_catalog.count(*) from backend_auth.player_profile_details) <> 0 then
    raise exception 'ROLLBACK_BLOCKED: player_profile_details contains rows; use a reviewed data-preserving migration';
  end if;
end;
$preconditions$;

drop table backend_auth.player_profile_details;

do $assertions$
declare
  v_expected record;
  v_count bigint;
begin
  if pg_catalog.to_regclass('backend_auth.player_profile_details') is not null then
    raise exception 'ROLLBACK_ASSERTION_FAILED: player_profile_details still exists';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r';

  if v_count <> 14 then
    raise exception 'ROLLBACK_ASSERTION_FAILED: expected 14 backend_auth tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth';

  if v_count <> 146 then
    raise exception 'ROLLBACK_ASSERTION_FAILED: expected 146 backend_auth constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and not t.tgisinternal;

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
            || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
    ) then
      raise exception 'ROLLBACK_ASSERTION_FAILED: existing backend_auth.% structure changed',
        v_expected.table_name;
    end if;
  end loop;
end;
$assertions$;

reset role;
commit;

select '017_backend_auth_player_profile_details rolled back before profile persistence'
  as result;
