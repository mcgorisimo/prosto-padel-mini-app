-- TEST ONLY. NEVER RUN AGAINST PRODUCTION OR A SHARED PRODUCTION CLUSTER.
-- Provisions only the fixed PostgreSQL roles required by migration 015.
-- It does not create backend_auth, apply migration 015, or create business data.

\set ON_ERROR_STOP on

\if :{?backend_auth_app_password}
\else
  \set backend_auth_app_password ''
\endif

select pg_catalog.length(:'backend_auth_app_password') >= 16
  as test_password_is_valid
\gset

\if :test_password_is_valid
\else
  do $$
  begin
    raise exception using
      message = 'TEST_PROVISIONING_REFUSED: backend_auth_app_password must be supplied via psql and contain at least 16 characters';
  end;
  $$;
\endif

select
  pg_catalog.current_database() ~ '^prosto_padel_test_'
  and pg_catalog.lower(pg_catalog.current_database()) !~ '(production|prod|main|live)'
  as target_database_is_safe
\gset

\if :target_database_is_safe
\else
  do $$
  begin
    raise exception using
      message = 'TEST_PROVISIONING_REFUSED: current database is not an allowed prosto_padel_test_* database';
  end;
  $$;
\endif

select
  pg_catalog.inet_server_addr() is not null
  and not (
    pg_catalog.inet_server_addr() << '127.0.0.0/8'::pg_catalog.inet
  )
  and pg_catalog.inet_server_addr() <> '::1'::pg_catalog.inet
  as target_server_is_remote
\gset

\if :target_server_is_remote
\else
  do $$
  begin
    raise exception using
      message = 'TEST_PROVISIONING_REFUSED: localhost and loopback PostgreSQL servers are forbidden';
  end;
  $$;
\endif

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

select
  'create role backend_auth_owner nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls'
where not exists (
  select 1 from pg_catalog.pg_roles where rolname = 'backend_auth_owner'
)
\gexec

select pg_catalog.format(
  'create role backend_auth_app login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password %L',
  :'backend_auth_app_password'
)
where not exists (
  select 1 from pg_catalog.pg_roles where rolname = 'backend_auth_app'
)
\gexec

do $$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
begin
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
     or v_owner.rolinherit
     or v_owner.rolreplication
     or v_owner.rolbypassrls then
    raise exception 'TEST_PROVISIONING_REFUSED: existing backend_auth_owner attributes are unsafe';
  end if;

  if v_app.rolname is null
     or not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolinherit
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'TEST_PROVISIONING_REFUSED: existing backend_auth_app attributes are unsafe';
  end if;

  if pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'TEST_PROVISIONING_REFUSED: backend_auth_app must not be a member of backend_auth_owner';
  end if;
end;
$$;

select pg_catalog.format(
  'grant backend_auth_owner to %I',
  current_user
)
\gexec

select pg_catalog.format(
  'revoke create on database %I from public',
  pg_catalog.current_database()
)
\gexec

select pg_catalog.format(
  'revoke create on database %I from backend_auth_app',
  pg_catalog.current_database()
)
\gexec

select pg_catalog.format(
  'grant create on database %I to backend_auth_owner',
  pg_catalog.current_database()
)
\gexec

select pg_catalog.format(
  'grant connect on database %I to backend_auth_app',
  pg_catalog.current_database()
)
\gexec

commit;

select
  pg_catalog.current_database() as test_database,
  current_user as migration_principal,
  'backend_auth_owner NOLOGIN; backend_auth_app LOGIN' as roles,
  'backend_auth schema and migration 015 were not created or applied' as boundary;
