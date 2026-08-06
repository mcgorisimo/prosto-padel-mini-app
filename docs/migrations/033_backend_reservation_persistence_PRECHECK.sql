-- Read-only precheck for 033_backend_reservation_persistence.sql.
-- This file never creates the schema or applies the migration.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'PRECHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  select * into v_owner from pg_catalog.pg_roles where rolname = 'backend_auth_owner';
  select * into v_app from pg_catalog.pg_roles where rolname = 'backend_auth_app';

  if v_owner.rolname is null
     or v_owner.rolcanlogin
     or v_owner.rolsuper
     or v_owner.rolcreaterole
     or v_owner.rolcreatedb
     or v_owner.rolreplication
     or v_owner.rolbypassrls
     or v_app.rolname is null
     or not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'PRECHECK_FAILED: backend role attributes are unsafe';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
     or pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER')
     or not pg_catalog.has_database_privilege(
       'backend_auth_owner', pg_catalog.current_database(), 'CREATE'
     )
     or pg_catalog.has_database_privilege(
       'backend_auth_app', pg_catalog.current_database(), 'CREATE'
     ) then
    raise exception 'PRECHECK_FAILED: backend role boundary differs';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.to_regclass('backend_auth.accounts') is null
     or pg_catalog.to_regclass('backend_auth.security_audit_events') is null
     or pg_catalog.to_regprocedure(
       'backend_auth.relation_fingerprint(regclass)'
     ) is null then
    raise exception 'PRECHECK_FAILED: backend auth foundation is missing';
  end if;

  if pg_catalog.obj_description(
       'backend_auth.accounts'::pg_catalog.regclass,
       'pg_class'
     ) <> '015_backend_auth_foundation:'
       || backend_auth.relation_fingerprint(
         'backend_auth.accounts'::pg_catalog.regclass
       )
     or pg_catalog.obj_description(
       'backend_auth.security_audit_events'::pg_catalog.regclass,
       'pg_class'
     ) <> '015_backend_auth_foundation:'
       || backend_auth.relation_fingerprint(
         'backend_auth.security_audit_events'::pg_catalog.regclass
       ) then
    raise exception 'PRECHECK_FAILED: backend auth foundation differs';
  end if;

  if pg_catalog.to_regnamespace('backend_reservation') is not null then
    raise exception 'PRECHECK_FAILED: migration 033 target already exists';
  end if;
end;
$precheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '033_backend_reservation_persistence',
  'target_schema_absent',
    pg_catalog.to_regnamespace('backend_reservation') is null,
  'row_counts', pg_catalog.jsonb_build_object(
    'accounts', (select pg_catalog.count(*) from backend_auth.accounts),
    'existing_security_audit_events', (
      select pg_catalog.count(*)
      from backend_auth.security_audit_events
    )
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'accounts', backend_auth.relation_fingerprint(
      'backend_auth.accounts'::pg_catalog.regclass
    ),
    'existing_security_audit_events', backend_auth.relation_fingerprint(
      'backend_auth.security_audit_events'::pg_catalog.regclass
    )
  )
) as backend_reservation_persistence_precheck;

rollback;
