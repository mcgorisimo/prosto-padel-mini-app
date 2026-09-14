\set ON_ERROR_STOP on
\if :{?expected_database}
\else
  \echo 'expected_database is required'
  \quit 3
\endif

set search_path=pg_catalog,pg_temp;
select current_database() = :'expected_database' as expected_database;
select pg_catalog.to_regclass(
  'backend_notification.telegram_bot_update_receipts'
) is not null as migration_045_present;
select pg_catalog.obj_description(
  'backend_notification.telegram_bot_update_receipts'::pg_catalog.regclass,
  'pg_class'
) = '045_backend_telegram_bot_update_receipts:'
  || backend_auth.relation_fingerprint(
    'backend_notification.telegram_bot_update_receipts'::pg_catalog.regclass
  ) as migration_045_fingerprint_matches;
select not pg_catalog.has_table_privilege(
  'public','backend_notification.telegram_bot_update_receipts','SELECT'
) as public_cannot_select;
select pg_catalog.has_table_privilege(
  'backend_auth_app',
  'backend_notification.telegram_bot_update_receipts',
  'SELECT'
) and pg_catalog.has_column_privilege(
  'backend_auth_app',
  'backend_notification.telegram_bot_update_receipts',
  'bot_namespace',
  'INSERT'
) and pg_catalog.has_column_privilege(
  'backend_auth_app',
  'backend_notification.telegram_bot_update_receipts',
  'update_id',
  'INSERT'
) and pg_catalog.has_column_privilege(
  'backend_auth_app',
  'backend_notification.telegram_bot_update_receipts',
  'received_at',
  'INSERT'
) as backend_app_has_bounded_access;
select pg_catalog.has_table_privilege(
  'backend_auth_app',
  'backend_notification.telegram_bot_update_receipts',
  'DELETE'
) and not pg_catalog.has_table_privilege(
  'backend_auth_app',
  'backend_notification.telegram_bot_update_receipts',
  'TRUNCATE'
) as backend_app_has_bounded_cleanup_only;
select pg_catalog.count(*) = 0 as receipts_start_empty
from backend_notification.telegram_bot_update_receipts;
