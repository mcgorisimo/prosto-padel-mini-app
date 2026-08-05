-- Fail-closed rollback for an unused migration 032.
-- Once a YCLIENTS signal exists, preserve it and use a forward migration.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_relation_oid oid := pg_catalog.to_regclass(
    'backend_match.yclients_record_webhook_signals'
  );
begin
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot assume backend_auth_owner';
  end if;

  if v_relation_oid is null
     or pg_catalog.obj_description(v_relation_oid, 'pg_class') <>
       '032_backend_yclients_record_webhook_signals:'
         || backend_auth.relation_fingerprint(v_relation_oid::pg_catalog.regclass) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 032 relation differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table backend_match.yclients_record_webhook_signals
  in access exclusive mode;

do $empty_guard$
begin
  if exists (select 1 from backend_match.yclients_record_webhook_signals) then
    raise exception 'ROLLBACK_REFUSED: YCLIENTS webhook history exists; use a forward migration';
  end if;
end;
$empty_guard$;

drop table backend_match.yclients_record_webhook_signals;

do $assertions$
begin
  if pg_catalog.to_regclass(
       'backend_match.yclients_record_webhook_signals'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.yclients_record_webhook_signals_pkey'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.yclients_record_webhook_signals_pending_idx'
     ) is not null then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 032 object remains';
  end if;
end;
$assertions$;

reset role;
commit;

select '032_backend_yclients_record_webhook_signals rolled back before first webhook signal'
  as result;
