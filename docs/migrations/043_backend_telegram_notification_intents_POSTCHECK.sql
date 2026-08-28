\set ON_ERROR_STOP on
select pg_catalog.to_regclass(
    'backend_notification.telegram_delivery_intents'
  ) is not null as intents_ready,
  pg_catalog.to_regclass(
    'backend_notification.telegram_delivery_rate_budget'
  ) is not null as rate_budget_ready,
  pg_catalog.to_regclass(
    'backend_notification.yclients_reconciliation_leases'
  ) is not null as reconciliation_leases_ready;

select indexname, indexdef
from pg_catalog.pg_indexes
where schemaname='backend_notification'
order by indexname;

select event_type, category, status, pg_catalog.count(*)
from backend_notification.telegram_delivery_intents
group by event_type, category, status
order by event_type, category, status;

select pg_catalog.has_schema_privilege(
    'backend_auth_app','backend_notification','USAGE'
  ) as app_usage,
  pg_catalog.has_schema_privilege(
    'backend_auth_app','backend_notification','CREATE'
  ) as app_create;

do $assertions$
declare
  relation_name text;
  acl record;
  column_row record;
begin
  if not exists (
    select 1 from pg_catalog.pg_namespace namespace
    join pg_catalog.pg_roles owner on owner.oid=namespace.nspowner
    where namespace.nspname='backend_notification'
      and owner.rolname='backend_auth_owner'
  ) then
    raise exception 'POSTCHECK_FAILED: notification schema owner differs';
  end if;

  foreach relation_name in array array[
    'backend_notification.telegram_delivery_intents',
    'backend_notification.telegram_delivery_rate_budget',
    'backend_notification.yclients_reconciliation_leases',
    'backend_auth.account_notification_preferences',
    'backend_match.telegram_notification_outbox'
  ] loop
    if pg_catalog.obj_description(
         relation_name::pg_catalog.regclass,'pg_class'
       ) is distinct from '043_backend_telegram_notification_intents:'
         || backend_auth.relation_fingerprint(
           relation_name::pg_catalog.regclass
         ) then
      raise exception 'POSTCHECK_FAILED: % fingerprint differs',
        relation_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid=relation.relnamespace
    join pg_catalog.pg_roles owner on owner.oid=relation.relowner
    where namespace.nspname='backend_notification'
      and relation.relkind='r'
      and owner.rolname<>'backend_auth_owner'
  ) then
    raise exception 'POSTCHECK_FAILED: notification table owner differs';
  end if;

  for acl in
    select * from (values
      (
        'backend_notification.telegram_delivery_intents',
        array[
          'event_key','event_type','category','source_id','source_version',
          'recipient_account_id','match_id','reservation_id','occurred_at',
          'available_at','status','attempt_count','updated_at','version'
        ]::text[],
        array[
          'available_at','status','attempt_count','updated_at','sent_at',
          'telegram_message_id','failure_code','version'
        ]::text[]
      ),
      (
        'backend_notification.telegram_delivery_rate_budget',
        array[]::text[],
        array['next_send_at','updated_at','version']::text[]
      ),
      (
        'backend_notification.yclients_reconciliation_leases',
        array[
          'reservation_id','lease_owner','lease_until','last_checked_at',
          'created_at','updated_at','version'
        ]::text[],
        array[
          'lease_owner','lease_until','last_checked_at','updated_at','version'
        ]::text[]
      )
    ) expected(table_name,insert_columns,update_columns)
  loop
    if not pg_catalog.has_table_privilege(
         'backend_auth_app',acl.table_name,'SELECT'
       )
       or pg_catalog.has_table_privilege(
         'backend_auth_app',acl.table_name,'INSERT'
       )
       or pg_catalog.has_table_privilege(
         'backend_auth_app',acl.table_name,'UPDATE'
       )
       or pg_catalog.has_table_privilege(
         'backend_auth_app',acl.table_name,'DELETE'
       )
       or pg_catalog.has_table_privilege(
         'backend_auth_app',acl.table_name,'TRUNCATE'
       )
       or pg_catalog.has_table_privilege(
         'backend_auth_app',acl.table_name,'REFERENCES'
       )
       or pg_catalog.has_table_privilege(
         'backend_auth_app',acl.table_name,'TRIGGER'
       ) then
      raise exception 'POSTCHECK_FAILED: % table ACL differs',
        acl.table_name;
    end if;

    for column_row in
      select attribute.attname
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid=acl.table_name::pg_catalog.regclass
        and attribute.attnum>0 and not attribute.attisdropped
    loop
      if pg_catalog.has_column_privilege(
           'backend_auth_app',acl.table_name,column_row.attname,'INSERT'
         ) is distinct from (
           column_row.attname=any (acl.insert_columns)
         )
         or pg_catalog.has_column_privilege(
           'backend_auth_app',acl.table_name,column_row.attname,'UPDATE'
         ) is distinct from (
           column_row.attname=any (acl.update_columns)
         ) then
        raise exception 'POSTCHECK_FAILED: %.% column ACL differs',
          acl.table_name,column_row.attname;
      end if;
    end loop;
  end loop;

  if not pg_catalog.has_column_privilege(
       'backend_auth_app',
       'backend_auth.account_notification_preferences',
       'telegram_match_activity_enabled','UPDATE'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       'backend_auth.account_notification_preferences',
       'telegram_chat_messages_enabled','UPDATE'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       'backend_auth.account_notification_preferences',
       'telegram_match_reminders_enabled','UPDATE'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       'backend_auth.account_notification_preferences',
       'telegram_booking_updates_enabled','UPDATE'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       'backend_auth.account_notification_preferences',
       'telegram_payment_updates_enabled','UPDATE'
     ) then
    raise exception 'POSTCHECK_FAILED: preference ACL differs';
  end if;
end;
$assertions$;
