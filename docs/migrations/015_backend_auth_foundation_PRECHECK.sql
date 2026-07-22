-- 015_backend_auth_foundation_PRECHECK.sql
-- Read-only preflight. Creates no objects, roles, privileges, or data.

begin;
set transaction read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_marker_count bigint;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'PRECHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  select * into v_owner
  from pg_catalog.pg_roles
  where rolname = 'backend_auth_owner';
  if not found then
    raise exception 'PRECHECK_FAILED: backend_auth_owner is missing';
  end if;

  select * into v_app
  from pg_catalog.pg_roles
  where rolname = 'backend_auth_app';
  if not found then
    raise exception 'PRECHECK_FAILED: backend_auth_app is missing';
  end if;

  if v_owner.rolcanlogin
     or v_owner.rolsuper
     or v_owner.rolcreaterole
     or v_owner.rolcreatedb
     or v_owner.rolreplication
     or v_owner.rolbypassrls then
    raise exception 'PRECHECK_FAILED: backend_auth_owner must be a non-privileged NOLOGIN owner';
  end if;

  if not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'PRECHECK_FAILED: backend_auth_app role attributes are unsafe';
  end if;

  if pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'PRECHECK_FAILED: backend_auth_app must not inherit or SET ROLE backend_auth_owner';
  end if;

  if pg_catalog.has_database_privilege(
    'backend_auth_app', pg_catalog.current_database(), 'CREATE'
  ) then
    raise exception 'PRECHECK_FAILED: backend_auth_app must not have database CREATE';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'PRECHECK_FAILED: migration principal cannot SET ROLE backend_auth_owner';
  end if;

  if not pg_catalog.has_database_privilege(
    'backend_auth_owner', pg_catalog.current_database(), 'CREATE'
  ) then
    raise exception 'PRECHECK_FAILED: backend_auth_owner lacks CREATE on the current database';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_default_acl d
    cross join lateral pg_catalog.aclexplode(d.defaclacl) acl
    where d.defaclrole = 'backend_auth_owner'::pg_catalog.regrole
      and acl.grantee = 'backend_auth_app'::pg_catalog.regrole
  ) then
    raise exception 'PRECHECK_FAILED: owner defaults grant future objects to backend_auth_app';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is not null then
    raise exception 'PRECHECK_FAILED: schema backend_auth already exists (015 is present or partial)';
  end if;

  select pg_catalog.count(*) into v_marker_count
  from (
    select pg_catalog.obj_description(c.oid, 'pg_class') as marker
    from pg_catalog.pg_class c
    union all
    select pg_catalog.obj_description(p.oid, 'pg_proc') as marker
    from pg_catalog.pg_proc p
  ) marked
  where marked.marker like '015_backend_auth_foundation:%';

  if v_marker_count <> 0 then
    raise exception 'PRECHECK_FAILED: migration 015 object markers already exist';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_language where lanname = 'plpgsql'
  ) then
    raise exception 'PRECHECK_FAILED: standard PL/pgSQL language is unavailable';
  end if;

  if not exists (
       select 1 from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'pg_catalog' and p.proname = 'md5'
     ) or not exists (
       select 1 from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'pg_catalog' and p.proname = 'num_nonnulls'
     ) then
    raise exception 'PRECHECK_FAILED: required standard PostgreSQL built-ins are unavailable';
  end if;
end;
$$;

-- A transaction-local role switch proves the migration principal can assume
-- the pre-provisioned owner; it changes no catalog state or privileges.
set local role backend_auth_owner;
reset role;

select
  pg_catalog.current_database() as database_name,
  current_user as migration_principal,
  pg_catalog.current_setting('server_version') as server_version,
  'backend_auth_owner present and NOLOGIN' as owner_role,
  'backend_auth_app present, LOGIN, no dangerous attributes' as application_role,
  'backend_auth absent; migration 015 number/object namespace is free' as object_state,
  'standard PostgreSQL only; no Supabase schema, role, function, or extension required' as dependency_state;

rollback;
