-- 020_backend_match_storage_PRECHECK.sql
-- Read-only preflight for empty private backend-owned match storage.

begin;
set transaction read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $role_precheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'PRECHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  select * into v_owner
  from pg_catalog.pg_roles
  where rolname = 'backend_auth_owner';

  select * into v_app
  from pg_catalog.pg_roles
  where rolname = 'backend_auth_app';

  if v_owner.rolname is null
     or v_owner.rolcanlogin
     or v_owner.rolsuper
     or v_owner.rolcreaterole
     or v_owner.rolcreatedb
     or v_owner.rolreplication
     or v_owner.rolbypassrls then
    raise exception 'PRECHECK_FAILED: backend_auth_owner attributes are unsafe';
  end if;

  if v_app.rolname is null
     or not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'PRECHECK_FAILED: backend_auth_app attributes are unsafe';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'PRECHECK_FAILED: migration principal cannot SET ROLE backend_auth_owner';
  end if;

  if pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'PRECHECK_FAILED: backend_auth_app can inherit the owner role';
  end if;

  if not pg_catalog.has_database_privilege(
       'backend_auth_owner',
       pg_catalog.current_database(),
       'CREATE'
     )
     or pg_catalog.has_database_privilege(
       'backend_auth_app',
       pg_catalog.current_database(),
       'CREATE'
     ) then
    raise exception 'PRECHECK_FAILED: database CREATE privilege boundary differs';
  end if;
end;
$role_precheck$;

set local role backend_auth_owner;

do $precheck$
declare
  v_extension_schema text;
  v_expected record;
  v_count bigint;
begin
  if pg_catalog.to_regnamespace('backend_match') is not null then
    raise exception 'PRECHECK_FAILED: backend_match schema already exists';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.pg_get_userbyid(
       (select n.nspowner
        from pg_catalog.pg_namespace n
        where n.nspname = 'backend_auth')
     ) <> 'backend_auth_owner' then
    raise exception 'PRECHECK_FAILED: backend_auth schema is missing or has an unexpected owner';
  end if;

  if pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     ) then
    raise exception 'PRECHECK_FAILED: backend_auth_app schema CREATE privilege is unsafe';
  end if;

  if pg_catalog.to_regprocedure(
       'backend_auth.relation_fingerprint(pg_catalog.regclass)'
     ) is null then
    raise exception 'PRECHECK_FAILED: relation_fingerprint helper is missing';
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
      raise exception 'PRECHECK_FAILED: backend_auth.% structure, owner, or fingerprint differs',
        v_expected.table_name;
    end if;
  end loop;

  if not exists (
       select 1
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'backend_auth'
         and c.relname = 'player_profile_details'
         and c.relkind = 'r'
         and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
         and pg_catalog.obj_description(c.oid, 'pg_class') =
           '018_backend_auth_player_profile_editable_fields:'
             || backend_auth.relation_fingerprint(
               c.oid::pg_catalog.regclass
             )
     )
     or not exists (
       select 1
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'backend_auth'
         and c.relname = 'player_rating_states'
         and c.relkind = 'r'
         and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
         and pg_catalog.obj_description(c.oid, 'pg_class') =
           '019_backend_auth_player_rating_state:'
             || backend_auth.relation_fingerprint(
               c.oid::pg_catalog.regclass
             )
     ) then
    raise exception 'PRECHECK_FAILED: canonical backend player profile storage is missing';
  end if;

  select n.nspname into v_extension_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'btree_gist';

  if v_extension_schema is null
     or not pg_catalog.has_schema_privilege(
       'backend_auth_owner',
       v_extension_schema,
       'USAGE'
     )
     or not exists (
       select 1
       from pg_catalog.pg_opclass opc
       join pg_catalog.pg_namespace n on n.oid = opc.opcnamespace
       join pg_catalog.pg_am am on am.oid = opc.opcmethod
       where n.nspname = v_extension_schema
         and am.amname = 'gist'
         and opc.opcname = 'gist_text_ops'
         and opc.opcintype = 'pg_catalog.text'::pg_catalog.regtype
     ) then
    raise exception 'PRECHECK_FAILED: canonical btree_gist text operator class is unavailable';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and c.relkind = 'r';

  if v_count <> 16 then
    raise exception 'PRECHECK_FAILED: expected 16 backend_auth tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth';

  if v_count <> 160 then
    raise exception 'PRECHECK_FAILED: expected 160 backend_auth constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and not t.tgisinternal;

  if v_count <> 33 then
    raise exception 'PRECHECK_FAILED: expected 33 backend_auth user triggers, found %',
      v_count;
  end if;
end;
$precheck$;

with row_counts(table_name, row_count) as (
  select 'accounts', pg_catalog.count(*) from backend_auth.accounts
  union all select 'player_profiles', pg_catalog.count(*) from backend_auth.player_profiles
  union all select 'player_profile_details', pg_catalog.count(*) from backend_auth.player_profile_details
  union all select 'player_rating_states', pg_catalog.count(*) from backend_auth.player_rating_states
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
    backend_auth.relation_fingerprint(
      c.oid::pg_catalog.regclass
    ) as fingerprint
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and c.relkind = 'r'
)
select pg_catalog.jsonb_build_object(
  'migration', '020_backend_match_storage',
  'ready', true,
  'backend_auth_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', 16,
    'constraints', 160,
    'user_triggers', 33
  ),
  'backend_auth_row_counts', (
    select pg_catalog.jsonb_object_agg(
      row_counts.table_name,
      row_counts.row_count
      order by row_counts.table_name
    )
    from row_counts
  ),
  'backend_auth_relation_fingerprints', (
    select pg_catalog.jsonb_object_agg(
      relation_state.table_name,
      relation_state.fingerprint
      order by relation_state.table_name
    )
    from relation_state
  )
) as backend_match_storage_precheck;

reset role;
rollback;
