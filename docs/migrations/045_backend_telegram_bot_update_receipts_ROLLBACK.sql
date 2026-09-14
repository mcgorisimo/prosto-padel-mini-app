\set ON_ERROR_STOP on
\if :{?expected_database}
\else
  \echo 'expected_database is required'
  \quit 3
\endif

begin;
set local search_path=pg_catalog,pg_temp;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_catalog.set_config(
  'prostopadel.expected_database', :'expected_database', true
);

do $preconditions$
begin
  if current_database() <>
     pg_catalog.current_setting('prostopadel.expected_database') then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: unexpected database';
  end if;
  if pg_catalog.to_regclass(
       'backend_notification.telegram_bot_update_receipts'
     ) is null then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: target is missing';
  end if;
  if pg_catalog.obj_description(
       'backend_notification.telegram_bot_update_receipts'::pg_catalog.regclass,
       'pg_class'
     ) is distinct from '045_backend_telegram_bot_update_receipts:'
       || backend_auth.relation_fingerprint(
         'backend_notification.telegram_bot_update_receipts'::pg_catalog.regclass
       ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: target differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;
drop table backend_notification.telegram_bot_update_receipts;
commit;
