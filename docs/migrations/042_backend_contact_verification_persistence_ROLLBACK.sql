-- 042_backend_contact_verification_persistence_ROLLBACK.sql
-- Non-destructive rollback boundary: migration 042 is forward-only.
-- This artifact never drops or mutates schema/data and is not an apply step.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $rollback_boundary$
begin
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
    raise exception 'ROLLBACK_UNSUPPORTED: migration 042 requires a reviewed forward migration';
  end if;
end;
$rollback_boundary$;

select pg_catalog.jsonb_build_object(
  'migration', '042_backend_contact_verification_persistence',
  'rollback', 'not_required_target_absent',
  'destructive_actions', false
) as backend_contact_verification_persistence_rollback_boundary;

rollback;
