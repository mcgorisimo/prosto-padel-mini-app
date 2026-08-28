\set ON_ERROR_STOP on
begin;
set local search_path=pg_catalog,pg_temp;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $preconditions$
declare
  relation_name text;
begin
  if not pg_catalog.pg_has_role(
       current_user,'backend_auth_owner','MEMBER'
     ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: owner role unavailable';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_namespace namespace
    join pg_catalog.pg_roles owner on owner.oid=namespace.nspowner
    where namespace.nspname='backend_notification'
      and owner.rolname='backend_auth_owner'
  ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: schema owner differs';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid=relation.relnamespace
    where namespace.nspname='backend_notification'
      and relation.relkind=any (array['r','i']::"char"[])
      and relation.relname=any (array[
        'telegram_delivery_intents',
        'telegram_delivery_intents_pkey',
        'telegram_delivery_intents_pending_idx',
        'telegram_delivery_intents_match_idx',
        'telegram_delivery_intents_reservation_idx',
        'telegram_delivery_rate_budget',
        'telegram_delivery_rate_budget_pkey',
        'yclients_reconciliation_leases',
        'yclients_reconciliation_leases_pkey',
        'yclients_reconciliation_leases_due_idx'
      ]::text[])
  ) <> 10 or exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid=relation.relnamespace
    where namespace.nspname='backend_notification'
      and (
        relation.relkind<>all (array['r','i']::"char"[])
        or relation.relname<>all (array[
          'telegram_delivery_intents',
          'telegram_delivery_intents_pkey',
          'telegram_delivery_intents_pending_idx',
          'telegram_delivery_intents_match_idx',
          'telegram_delivery_intents_reservation_idx',
          'telegram_delivery_rate_budget',
          'telegram_delivery_rate_budget_pkey',
          'yclients_reconciliation_leases',
          'yclients_reconciliation_leases_pkey',
          'yclients_reconciliation_leases_due_idx'
        ]::text[])
      )
  ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: schema inventory differs';
  end if;

  foreach relation_name in array array[
    'backend_notification.telegram_delivery_intents',
    'backend_notification.telegram_delivery_rate_budget',
    'backend_notification.yclients_reconciliation_leases',
    'backend_auth.account_notification_preferences',
    'backend_match.telegram_notification_outbox'
  ] loop
    if pg_catalog.to_regclass(relation_name) is null
       or pg_catalog.obj_description(
         relation_name::pg_catalog.regclass,'pg_class'
       ) is distinct from '043_backend_telegram_notification_intents:'
         || backend_auth.relation_fingerprint(
           relation_name::pg_catalog.regclass
         ) then
      raise exception 'ROLLBACK_PRECONDITION_FAILED: % differs',
        relation_name;
    end if;
  end loop;
end;
$preconditions$;

set local role backend_auth_owner;

lock table
  backend_notification.telegram_delivery_intents,
  backend_notification.telegram_delivery_rate_budget,
  backend_notification.yclients_reconciliation_leases,
  backend_auth.account_notification_preferences,
  backend_match.telegram_notification_outbox
in access exclusive mode;

do $guard$
begin
  if exists (
    select 1 from backend_notification.telegram_delivery_intents
  ) then
    raise exception 'ROLLBACK_BLOCKED: notification intents are not empty';
  end if;
  if exists (
    select 1 from backend_notification.yclients_reconciliation_leases
  ) then
    raise exception 'ROLLBACK_BLOCKED: reconciliation leases are not empty';
  end if;
  if exists (
    select 1 from backend_auth.account_notification_preferences
    where telegram_match_activity_enabled is not null
       or telegram_chat_messages_enabled is not null
       or telegram_match_reminders_enabled is not null
       or telegram_booking_updates_enabled is not null
       or telegram_payment_updates_enabled is not null
  ) then
    raise exception 'ROLLBACK_BLOCKED: category preferences contain data';
  end if;
end;
$guard$;

drop table backend_notification.telegram_delivery_intents;
drop table backend_notification.telegram_delivery_rate_budget;
drop table backend_notification.yclients_reconciliation_leases;
drop schema backend_notification restrict;

alter table backend_auth.account_notification_preferences
  drop column telegram_match_activity_enabled,
  drop column telegram_chat_messages_enabled,
  drop column telegram_match_reminders_enabled,
  drop column telegram_booking_updates_enabled,
  drop column telegram_payment_updates_enabled;

alter table backend_match.telegram_notification_outbox
  drop constraint telegram_notification_outbox_failure_check,
  drop constraint telegram_notification_outbox_state_check;

alter table backend_match.telegram_notification_outbox
  add constraint telegram_notification_outbox_failure_check check (
    failure_code is null or failure_code = any (array[
      'destination_unavailable','preference_disabled','telegram_forbidden',
      'telegram_bad_request','telegram_rate_limited','telegram_unavailable',
      'network_error','invalid_response','retry_exhausted'
    ]::text[])
  ),
  add constraint telegram_notification_outbox_state_check check (
    (status='pending' and sent_at is null and telegram_message_id is null
      and attempt_count <= 20 and (
        failure_code is null or failure_code = any (array[
          'telegram_rate_limited','telegram_unavailable',
          'network_error','invalid_response'
        ]::text[])
      ))
    or (status='sent' and sent_at is not null
      and telegram_message_id is not null and failure_code is null
      and attempt_count > 0)
    or (status='abandoned' and sent_at is null
      and telegram_message_id is null and failure_code = any (array[
        'destination_unavailable','preference_disabled',
        'telegram_forbidden','telegram_bad_request','retry_exhausted'
      ]::text[]))
  );

do $comments$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'backend_auth.account_notification_preferences',
    'backend_match.telegram_notification_outbox'
  ] loop
    execute pg_catalog.format(
      'comment on table %s is %L',
      relation_name,
      '038_backend_account_notification_preferences:'
        || backend_auth.relation_fingerprint(
          relation_name::pg_catalog.regclass
        )
    );
  end loop;
end;
$comments$;
commit;
