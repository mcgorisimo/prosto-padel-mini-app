-- 042_backend_contact_verification_persistence_PRECHECK.sql
-- Read-only gate. Run only under a separately approved Selectel schema gate.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $precheck$
declare
  v_accounts_oid oid := pg_catalog.to_regclass('backend_auth.accounts')::oid;
  v_immutable_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.reject_immutable_mutation()'
  )::oid;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'PRECHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null
     or not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.pg_has_role(
       'backend_auth_app',
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.has_database_privilege(
       'backend_auth_app',
       pg_catalog.current_database(),
       'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     ) then
    raise exception 'PRECHECK_FAILED: backend role boundary differs';
  end if;

  if v_accounts_oid is null
     or pg_catalog.obj_description(v_accounts_oid, 'pg_class') is distinct from
       '015_backend_auth_foundation:'
         || backend_auth.relation_fingerprint(
           v_accounts_oid::pg_catalog.regclass
         ) then
    raise exception 'PRECHECK_FAILED: backend accounts foundation differs';
  end if;

  if v_immutable_oid is null
     or pg_catalog.obj_description(v_immutable_oid, 'pg_proc') is distinct from
       '015_backend_auth_foundation:'
         || pg_catalog.md5(pg_catalog.pg_get_functiondef(v_immutable_oid)) then
    raise exception 'PRECHECK_FAILED: immutable guard differs';
  end if;

  if pg_catalog.to_regclass('backend_auth.account_contacts') is not null
     or pg_catalog.to_regclass(
       'backend_auth.contact_verification_challenges'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.contact_verification_commands'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.contact_verification_dispatches'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.contact_verification_rate_buckets'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.contact_verification_audit'
     ) is not null then
    raise exception 'PRECHECK_FAILED: migration 042 target already exists';
  end if;
end;
$precheck$;

select pg_catalog.jsonb_build_object(
  'migration', '042_backend_contact_verification_persistence',
  'base_commit', '0fe9cfde914703cb7c61fe8589f98f0bbdcde60c',
  'target_absent', true,
  'runtime_connected', false,
  'account_rows_observed', (
    select pg_catalog.count(*) from backend_auth.accounts
  ),
  'accounts_fingerprint', backend_auth.relation_fingerprint(
    'backend_auth.accounts'::pg_catalog.regclass
  )
) as backend_contact_verification_persistence_precheck;

rollback;
