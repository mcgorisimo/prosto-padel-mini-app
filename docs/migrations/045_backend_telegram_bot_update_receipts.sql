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
    raise exception 'MIGRATION_PRECONDITION_FAILED: unexpected database';
  end if;
  if pg_catalog.to_regclass(
       'backend_notification.telegram_delivery_intents'
     ) is null
     or pg_catalog.to_regclass(
       'backend_auth.telegram_notification_destinations'
     ) is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: foundation is missing';
  end if;
  if pg_catalog.obj_description(
       'backend_notification.telegram_delivery_intents'::pg_catalog.regclass,
       'pg_class'
     ) is distinct from '043_backend_telegram_notification_intents:'
       || backend_auth.relation_fingerprint(
         'backend_notification.telegram_delivery_intents'::pg_catalog.regclass
       ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 043 differs';
  end if;
  if pg_catalog.to_regclass(
       'backend_notification.telegram_bot_update_receipts'
     ) is not null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: target exists';
  end if;
  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null
     or not pg_catalog.pg_has_role(
       current_user,'backend_auth_owner','MEMBER'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: role boundary differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_notification.telegram_bot_update_receipts (
  bot_namespace uuid not null,
  update_id bigint not null,
  received_at bigint not null,
  constraint telegram_bot_update_receipts_pkey
    primary key (bot_namespace,update_id),
  constraint telegram_bot_update_receipts_numbers_check check (
    update_id between 0 and 2147483647
    and received_at between 0 and 9007199254740991
  )
);

revoke all on table backend_notification.telegram_bot_update_receipts
  from public, backend_auth_app;
grant select on table backend_notification.telegram_bot_update_receipts
  to backend_auth_app;
grant insert (bot_namespace,update_id,received_at)
  on backend_notification.telegram_bot_update_receipts to backend_auth_app;
grant delete on table backend_notification.telegram_bot_update_receipts
  to backend_auth_app;

do $comments$
begin
  execute pg_catalog.format(
    'comment on table %s is %L',
    'backend_notification.telegram_bot_update_receipts',
    '045_backend_telegram_bot_update_receipts:'
      || backend_auth.relation_fingerprint(
        'backend_notification.telegram_bot_update_receipts'::pg_catalog.regclass
      )
  );
end;
$comments$;

commit;
