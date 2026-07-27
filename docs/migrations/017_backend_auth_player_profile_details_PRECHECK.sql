-- 017_backend_auth_player_profile_details_PRECHECK.sql
-- Read-only preflight for the private backend profile-details relation.

begin;
set transaction read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $role_precheck$
begin
  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null then
    raise exception 'PRECHECK_FAILED: required backend_auth roles are missing';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'PRECHECK_FAILED: migration principal cannot SET ROLE backend_auth_owner';
  end if;
end;
$role_precheck$;

set local role backend_auth_owner;

do $precheck$
declare
  v_expected record;
  v_count bigint;
  v_player_profiles_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profiles')::oid;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'PRECHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'PRECHECK_FAILED: backend_auth_app can inherit the owner role';
  end if;

  if pg_catalog.has_database_privilege(
    'backend_auth_app', pg_catalog.current_database(), 'CREATE'
  ) then
    raise exception 'PRECHECK_FAILED: backend_auth_app has database CREATE';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.pg_get_userbyid(
       (select n.nspowner from pg_catalog.pg_namespace n where n.nspname = 'backend_auth')
     ) <> 'backend_auth_owner' then
    raise exception 'PRECHECK_FAILED: backend_auth schema is missing or has an unexpected owner';
  end if;

  if pg_catalog.has_schema_privilege(
    'backend_auth_app', 'backend_auth', 'CREATE'
  ) then
    raise exception 'PRECHECK_FAILED: backend_auth_app has schema CREATE';
  end if;

  if pg_catalog.to_regclass('backend_auth.player_profile_details') is not null then
    raise exception 'PRECHECK_FAILED: backend_auth.player_profile_details already exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'backend_auth'
      and c.relname = 'player_profile_details'
  ) then
    raise exception 'PRECHECK_FAILED: player_profile_details name is already occupied';
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
      raise exception 'PRECHECK_FAILED: backend_auth.% structure, owner, or fingerprint differs',
        v_expected.table_name;
    end if;
  end loop;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r';

  if v_count <> 14 then
    raise exception 'PRECHECK_FAILED: expected 14 backend_auth tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth';

  if v_count <> 146 then
    raise exception 'PRECHECK_FAILED: expected 146 backend_auth constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and not t.tgisinternal;

  if v_count <> 33 then
    raise exception 'PRECHECK_FAILED: expected 33 backend_auth user triggers, found %',
      v_count;
  end if;

  if v_player_profiles_oid is null
     or pg_catalog.pg_get_userbyid(
       (select c.relowner from pg_catalog.pg_class c where c.oid = v_player_profiles_oid)
     ) <> 'backend_auth_owner' then
    raise exception 'PRECHECK_FAILED: player_profiles binding is missing or has an unexpected owner';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_attribute a
      where a.attrelid = v_player_profiles_oid
        and a.attnum > 0
        and not a.attisdropped) <> 1
     or not exists (
       select 1
       from pg_catalog.pg_attribute a
       where a.attrelid = v_player_profiles_oid
         and a.attname = 'account_id'
         and a.atttypid = 'pg_catalog.uuid'::pg_catalog.regtype
         and a.attnotnull
         and not a.attisdropped
     ) then
    raise exception 'PRECHECK_FAILED: player_profiles is not the canonical one-column binding';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_constraint c
      where c.conrelid = v_player_profiles_oid
        and c.contype in ('p', 'u', 'f', 'c')) <> 2
     or not exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = v_player_profiles_oid
         and c.conname = 'player_profiles_pkey'
         and c.contype = 'p'
         and c.convalidated
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = v_player_profiles_oid
         and c.conname = 'player_profiles_account_id_fkey'
         and c.contype = 'f'
         and c.confrelid = 'backend_auth.accounts'::pg_catalog.regclass
         and not c.condeferrable
         and not c.condeferred
         and c.confupdtype = 'a'
         and c.confdeltype = 'a'
         and c.convalidated
     ) then
    raise exception 'PRECHECK_FAILED: player_profiles key constraints differ';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = v_player_profiles_oid
      and t.tgname = 'player_profiles_immutable_guard'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and t.tgtype = 27
      and n.nspname = 'backend_auth'
      and p.proname = 'reject_immutable_mutation'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
  ) then
    raise exception 'PRECHECK_FAILED: player_profiles immutable guard differs';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = v_player_profiles_oid
      and t.tgname = 'player_profiles_account_consistency'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and t.tgconstraint <> 0
      and t.tgdeferrable
      and t.tginitdeferred
      and t.tgtype = 29
      and n.nspname = 'backend_auth'
      and p.proname = 'assert_player_profile_consistency'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
  ) then
    raise exception 'PRECHECK_FAILED: player_profiles consistency trigger differs';
  end if;
end;
$precheck$;

with row_counts(table_name, row_count) as (
  select 'accounts', pg_catalog.count(*) from backend_auth.accounts
  union all select 'player_profiles', pg_catalog.count(*) from backend_auth.player_profiles
  union all select 'external_identities', pg_catalog.count(*) from backend_auth.external_identities
  union all select 'external_identity_lookup_digests', pg_catalog.count(*) from backend_auth.external_identity_lookup_digests
  union all select 'authentication_operations', pg_catalog.count(*) from backend_auth.authentication_operations
  union all select 'telegram_proof_consumptions', pg_catalog.count(*) from backend_auth.telegram_proof_consumptions
  union all select 'auth_session_families', pg_catalog.count(*) from backend_auth.auth_session_families
  union all select 'auth_session_credentials', pg_catalog.count(*) from backend_auth.auth_session_credentials
  union all select 'auth_session_commands', pg_catalog.count(*) from backend_auth.auth_session_commands
  union all select 'fresh_authentication_evidence', pg_catalog.count(*) from backend_auth.fresh_authentication_evidence
  union all select 'reauthentication_grants', pg_catalog.count(*) from backend_auth.reauthentication_grants
  union all select 'otp_challenges', pg_catalog.count(*) from backend_auth.otp_challenges
  union all select 'otp_commands', pg_catalog.count(*) from backend_auth.otp_commands
  union all select 'security_audit_events', pg_catalog.count(*) from backend_auth.security_audit_events
),
relation_state as (
  select
    c.relname as table_name,
    backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass) as fingerprint
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r'
)
select pg_catalog.jsonb_build_object(
  'precheck_ok', true,
  'catalog_counts', pg_catalog.jsonb_build_object(
    'tables', 14,
    'constraints', 146,
    'user_triggers', 33
  ),
  'row_counts', (
    select pg_catalog.jsonb_object_agg(
      row_counts.table_name,
      row_counts.row_count
      order by row_counts.table_name
    )
    from row_counts
  ),
  'relation_fingerprints', (
    select pg_catalog.jsonb_object_agg(
      relation_state.table_name,
      relation_state.fingerprint
      order by relation_state.table_name
    )
    from relation_state
  )
) as backend_auth_player_profile_details_precheck;

reset role;
rollback;
