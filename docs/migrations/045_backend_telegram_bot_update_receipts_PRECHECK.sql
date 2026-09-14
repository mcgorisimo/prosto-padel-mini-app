\set ON_ERROR_STOP on
\if :{?expected_database}
\else
  \echo 'expected_database is required'
  \quit 3
\endif

set search_path=pg_catalog,pg_temp;
select current_database() = :'expected_database' as expected_database;
select pg_catalog.to_regclass(
  'backend_notification.telegram_delivery_intents'
) is not null as migration_043_present;
select pg_catalog.obj_description(
  'backend_notification.telegram_delivery_intents'::pg_catalog.regclass,
  'pg_class'
) = '043_backend_telegram_notification_intents:'
  || backend_auth.relation_fingerprint(
    'backend_notification.telegram_delivery_intents'::pg_catalog.regclass
  ) as migration_043_fingerprint_matches;
select pg_catalog.to_regclass(
  'backend_notification.telegram_bot_update_receipts'
) is null as migration_045_target_absent;
select pg_catalog.pg_has_role(
  current_user,'backend_auth_owner','MEMBER'
) as operator_can_assume_owner;
