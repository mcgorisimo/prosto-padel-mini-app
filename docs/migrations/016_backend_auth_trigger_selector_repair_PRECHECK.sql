-- 016_backend_auth_trigger_selector_repair_PRECHECK.sql
-- Read-only preflight for the backend_auth shared-trigger selector repair.

begin;
set transaction read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
declare
  v_expected record;
  v_function_oid oid;
  v_count bigint;
  v_schema_owner text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'PRECHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  select pg_catalog.pg_get_userbyid(n.nspowner)
  into v_schema_owner
  from pg_catalog.pg_namespace n
  where n.nspname = 'backend_auth';

  if not found then
    raise exception 'PRECHECK_FAILED: schema backend_auth is missing';
  end if;
  if v_schema_owner <> 'backend_auth_owner' then
    raise exception 'PRECHECK_FAILED: schema backend_auth owner differs';
  end if;
  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null then
    raise exception 'PRECHECK_FAILED: required backend_auth roles are missing';
  end if;
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'PRECHECK_FAILED: migration principal cannot SET ROLE backend_auth_owner';
  end if;
  if pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'PRECHECK_FAILED: backend_auth_app can inherit or SET ROLE backend_auth_owner';
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
    ) then
      raise exception 'PRECHECK_FAILED: required table backend_auth.% is missing or has an unexpected kind',
        v_expected.table_name;
    end if;
  end loop;

  select pg_catalog.count(*)
  into v_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'backend_auth'
    and p.proname = any (array[
      'assert_player_profile_consistency',
      'assert_external_identity_aliases',
      'assert_session_consistency',
      'assert_otp_consistency'
    ]::text[]);

  if v_count <> 4 then
    raise exception 'PRECHECK_FAILED: target functions are missing or have unexpected overloads';
  end if;

  foreach v_function_oid in array array[
    pg_catalog.to_regprocedure('backend_auth.assert_player_profile_consistency()')::oid,
    pg_catalog.to_regprocedure('backend_auth.assert_external_identity_aliases()')::oid,
    pg_catalog.to_regprocedure('backend_auth.assert_session_consistency()')::oid,
    pg_catalog.to_regprocedure('backend_auth.assert_otp_consistency()')::oid
  ]::oid[]
  loop
    if v_function_oid is null then
      raise exception 'PRECHECK_FAILED: a target function is missing';
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_language l on l.oid = p.prolang
      where p.oid = v_function_oid
        and p.prokind = 'f'
        and p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
        and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
        and l.lanname = 'plpgsql'
        and p.provolatile = 'v'
        and not p.prosecdef
        and p.proconfig is not distinct from
          array['search_path=pg_catalog, pg_temp']::text[]
        and pg_catalog.pg_get_userbyid(p.proowner) = 'backend_auth_owner'
    ) then
      raise exception 'PRECHECK_FAILED: target function signature, owner, language, volatility, invoker mode, or search_path differs';
    end if;

    if exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where p.oid = v_function_oid
        and acl.privilege_type = 'EXECUTE'
        and acl.grantee <> p.proowner
    ) or pg_catalog.has_function_privilege(
      'backend_auth_app',
      v_function_oid,
      'EXECUTE'
    ) then
      raise exception 'PRECHECK_FAILED: target function ACL exceeds the migration 015 boundary';
    end if;
  end loop;

  for v_expected in
    select *
    from (values
      (
        'accounts_player_profile_consistency',
        'accounts',
        'assert_player_profile_consistency'
      ),
      (
        'player_profiles_account_consistency',
        'player_profiles',
        'assert_player_profile_consistency'
      ),
      (
        'external_identities_alias_required',
        'external_identities',
        'assert_external_identity_aliases'
      ),
      (
        'external_identity_lookup_digests_identity_required',
        'external_identity_lookup_digests',
        'assert_external_identity_aliases'
      ),
      (
        'auth_session_families_state_consistency',
        'auth_session_families',
        'assert_session_consistency'
      ),
      (
        'auth_session_credentials_state_consistency',
        'auth_session_credentials',
        'assert_session_consistency'
      ),
      (
        'auth_session_commands_state_consistency',
        'auth_session_commands',
        'assert_session_consistency'
      ),
      (
        'otp_challenges_state_consistency',
        'otp_challenges',
        'assert_otp_consistency'
      ),
      (
        'otp_commands_state_consistency',
        'otp_commands',
        'assert_otp_consistency'
      )
    ) expected(trigger_name, table_name, function_name)
  loop
    select pg_catalog.count(*)
    into v_count
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
    where not t.tgisinternal
      and n.nspname = 'backend_auth'
      and c.relname = v_expected.table_name
      and t.tgname = v_expected.trigger_name
      and pn.nspname = 'backend_auth'
      and p.proname = v_expected.function_name
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
      and t.tgenabled = 'O'
      and t.tgconstraint <> 0
      and t.tgdeferrable
      and t.tginitdeferred
      and t.tgtype = 29;

    if v_count <> 1 then
      raise exception 'PRECHECK_FAILED: trigger attachment % differs',
        v_expected.trigger_name;
    end if;
  end loop;

  select pg_catalog.count(*)
  into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where not t.tgisinternal
    and n.nspname = 'backend_auth'
    and p.proname = any (array[
      'assert_player_profile_consistency',
      'assert_external_identity_aliases',
      'assert_session_consistency',
      'assert_otp_consistency'
    ]::text[]);

  if v_count <> 9 then
    raise exception 'PRECHECK_FAILED: expected exactly 9 target trigger attachments, found %',
      v_count;
  end if;

  select pg_catalog.count(*)
  into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r';
  if v_count <> 14 then
    raise exception 'PRECHECK_FAILED: expected 14 backend_auth tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*)
  into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth';
  if v_count <> 146 then
    raise exception 'PRECHECK_FAILED: expected 146 backend_auth constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*)
  into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth'
    and c.contype in ('p', 'u', 'f', 'c');
  if v_count <> 131 then
    raise exception 'PRECHECK_FAILED: expected 131 backend_auth table constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*)
  into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth' and c.contype = 't';
  if v_count <> 15 then
    raise exception 'PRECHECK_FAILED: expected 15 backend_auth constraint-trigger constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*)
  into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and not t.tgisinternal;
  if v_count <> 33 then
    raise exception 'PRECHECK_FAILED: expected 33 backend_auth user triggers, found %',
      v_count;
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
function_state as (
  select
    p.proname,
    pg_catalog.pg_get_userbyid(p.proowner) as owner,
    p.proacl::text as acl,
    pg_catalog.obj_description(p.oid, 'pg_proc') as comment,
    pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) as definition_md5
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'backend_auth'
    and p.proname = any (array[
      'assert_player_profile_consistency',
      'assert_external_identity_aliases',
      'assert_session_consistency',
      'assert_otp_consistency'
    ]::text[])
)
select pg_catalog.jsonb_build_object(
  'precheck_ok', true,
  'catalog_counts', pg_catalog.jsonb_build_object(
    'tables', 14,
    'constraints', 146,
    'table_constraints', 131,
    'constraint_trigger_constraints', 15,
    'user_triggers', 33,
    'target_trigger_attachments', 9
  ),
  'function_state', (
    select pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(function_state)
      order by function_state.proname
    )
    from function_state
  ),
  'row_counts', (
    select pg_catalog.jsonb_object_agg(
      row_counts.table_name,
      row_counts.row_count
      order by row_counts.table_name
    )
    from row_counts
  )
) as backend_auth_trigger_selector_repair_precheck;

rollback;
