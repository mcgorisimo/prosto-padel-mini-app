-- Fail-closed rollback for an unused migration 028.
-- Once a capability event exists, preserve the audit and use a forward migration.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
begin
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot assume backend_auth_owner';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_auth'
      and relation.relname = 'admin_capability_events'
      and relation.relkind = 'r'
      and relation.relpersistence = 'p'
      and not relation.relrowsecurity
      and not relation.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(relation.oid, 'pg_class') =
        '028_backend_admin_capability_grants:'
          || backend_auth.relation_fingerprint(relation.oid::pg_catalog.regclass)
  ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 028 relation differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table
  backend_auth.accounts,
  backend_auth.admin_capability_events
in access exclusive mode;

do $empty_guard$
begin
  if exists (select 1 from backend_auth.admin_capability_events) then
    raise exception 'ROLLBACK_REFUSED: capability audit exists; use a forward migration';
  end if;
end;
$empty_guard$;

drop table backend_auth.admin_capability_events;

do $assertions$
begin
  if pg_catalog.to_regclass('backend_auth.admin_capability_events') is not null
     or pg_catalog.to_regclass(
       'backend_auth.admin_capability_events_event_order_seq'
     ) is not null then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 028 objects remain';
  end if;
end;
$assertions$;

reset role;
commit;

select '028_backend_admin_capability_grants rolled back before first capability event'
  as result;
