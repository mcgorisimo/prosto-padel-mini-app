\set ON_ERROR_STOP on
\if :{?expected_database}
\else
  \echo 'expected_database is required'
  \quit 3
\endif

begin;
set local search_path=pg_catalog,pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
select pg_catalog.set_config(
  'prostopadel.expected_database', :'expected_database', true
);

do $preconditions$
declare
  dependency record;
begin
  if current_database() <>
     pg_catalog.current_setting('prostopadel.expected_database') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: unexpected database';
  end if;
  if pg_catalog.to_regclass(
       'backend_auth.account_notification_preferences'
     ) is null
     or pg_catalog.to_regclass(
       'backend_auth.telegram_notification_destinations'
     ) is null
     or pg_catalog.to_regclass(
       'backend_match.telegram_notification_outbox'
     ) is null
     or pg_catalog.to_regclass(
       'backend_reservation.court_reservations'
     ) is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: foundation is missing';
  end if;
  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null
     or not pg_catalog.pg_has_role(
       current_user,'backend_auth_owner','MEMBER'
     )
     or pg_catalog.pg_has_role(
       'backend_auth_app','backend_auth_owner','MEMBER'
     )
     or pg_catalog.has_database_privilege(
       'backend_auth_app',current_database(),'CREATE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: role boundary differs';
  end if;
  for dependency in
    select * from (values
      ('backend_auth.account_notification_preferences',
       '038_backend_account_notification_preferences'),
      ('backend_auth.telegram_notification_destinations',
       '030_backend_telegram_outbound_notifications'),
      ('backend_match.telegram_notification_outbox',
       '038_backend_account_notification_preferences'),
      ('backend_reservation.court_reservations',
       '034_backend_match_reservation_links')
    ) expected(relation_name,migration_name)
  loop
    if pg_catalog.obj_description(
         dependency.relation_name::pg_catalog.regclass,'pg_class'
       ) is distinct from dependency.migration_name || ':'
         || backend_auth.relation_fingerprint(
           dependency.relation_name::pg_catalog.regclass
         ) then
      raise exception 'MIGRATION_PRECONDITION_FAILED: % differs from %',
        dependency.relation_name,dependency.migration_name;
    end if;
  end loop;
  if pg_catalog.to_regnamespace('backend_notification') is not null
     or exists (
       select 1 from pg_catalog.pg_attribute attribute
       where attribute.attrelid =
         'backend_auth.account_notification_preferences'::pg_catalog.regclass
         and attribute.attname = 'telegram_match_activity_enabled'
         and not attribute.attisdropped
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 043 target exists';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table backend_auth.account_notification_preferences
  in access exclusive mode;
lock table backend_match.telegram_notification_outbox
  in access exclusive mode;

alter table backend_auth.account_notification_preferences
  add column telegram_match_activity_enabled boolean,
  add column telegram_chat_messages_enabled boolean,
  add column telegram_match_reminders_enabled boolean,
  add column telegram_booking_updates_enabled boolean,
  add column telegram_payment_updates_enabled boolean;

alter table backend_match.telegram_notification_outbox
  drop constraint telegram_notification_outbox_failure_check,
  drop constraint telegram_notification_outbox_state_check;

alter table backend_match.telegram_notification_outbox
  add constraint telegram_notification_outbox_failure_check check (
    failure_code is null
    or failure_code = any (array[
      'destination_unavailable','preference_disabled',
      'telegram_forbidden','telegram_bad_request','telegram_unauthorized',
      'telegram_rate_limited','telegram_unavailable','network_error',
      'invalid_response','delivery_unknown','retry_exhausted'
    ]::text[])
  ),
  add constraint telegram_notification_outbox_state_check check (
    (
      status='pending' and sent_at is null and telegram_message_id is null
      and attempt_count <= 20
      and (
        failure_code is null
        or failure_code = any (array[
          'telegram_rate_limited','telegram_unavailable',
          'network_error','invalid_response'
        ]::text[])
      )
    ) or (
      status='sent' and sent_at is not null
      and telegram_message_id is not null and failure_code is null
      and attempt_count > 0
    ) or (
      status='abandoned' and sent_at is null and telegram_message_id is null
      and failure_code = any (array[
        'destination_unavailable','preference_disabled',
        'telegram_forbidden','telegram_bad_request','telegram_unauthorized',
        'delivery_unknown','retry_exhausted'
      ]::text[])
    )
  );

create schema backend_notification authorization backend_auth_owner;
revoke all on schema backend_notification from public, backend_auth_app;
grant usage on schema backend_notification to backend_auth_app;

create table backend_notification.telegram_delivery_intents (
  event_key text not null,
  event_type text not null,
  category text not null,
  source_id uuid not null,
  source_version bigint not null,
  recipient_account_id uuid not null,
  match_id uuid,
  reservation_id uuid,
  occurred_at bigint not null,
  available_at bigint not null,
  status text not null,
  attempt_count integer not null,
  updated_at bigint not null,
  sent_at bigint,
  telegram_message_id bigint,
  failure_code text,
  version bigint not null,
  constraint telegram_delivery_intents_pkey
    primary key (event_key, recipient_account_id),
  constraint telegram_delivery_intents_recipient_fkey
    foreign key (recipient_account_id) references backend_auth.accounts(id)
    on update no action on delete no action not deferrable,
  constraint telegram_delivery_intents_match_fkey
    foreign key (match_id) references backend_match.matches(id)
    on update no action on delete no action not deferrable,
  constraint telegram_delivery_intents_reservation_fkey
    foreign key (reservation_id)
    references backend_reservation.court_reservations(reservation_id)
    on update no action on delete no action not deferrable,
  constraint telegram_delivery_intents_event_key_check check (
    pg_catalog.length(event_key) between 1 and 256
    and event_key ~ '^[a-z0-9][a-z0-9:_-]{0,255}$'
  ),
  constraint telegram_delivery_intents_type_check check (
    event_type = any (array[
      'match_invited','waitlist_slot_available','match_schedule_changed',
      'match_cancelled','participant_joined','participant_left',
      'chat_message_created','match_reminder_24h','match_reminder_2h',
      'reservation_confirmed','reservation_rescheduled',
      'reservation_cancelled'
    ]::text[])
  ),
  constraint telegram_delivery_intents_category_check check (
    (category='match_activity' and event_type = any (array[
      'match_invited','waitlist_slot_available','match_schedule_changed',
      'match_cancelled','participant_joined','participant_left'
    ]::text[]))
    or (category='chat_messages' and event_type='chat_message_created')
    or (category='match_reminders' and event_type = any (array[
      'match_reminder_24h','match_reminder_2h'
    ]::text[]))
    or (category='booking_updates' and event_type = any (array[
      'reservation_confirmed','reservation_rescheduled',
      'reservation_cancelled'
    ]::text[]))
  ),
  constraint telegram_delivery_intents_target_check check (
    (category='booking_updates' and reservation_id is not null)
    or (category<>'booking_updates' and match_id is not null)
  ),
  constraint telegram_delivery_intents_status_check check (
    status = any (array['pending','sent','abandoned','superseded']::text[])
  ),
  constraint telegram_delivery_intents_failure_check check (
    failure_code is null or failure_code = any (array[
      'destination_unavailable','preference_disabled','stale_event',
      'telegram_forbidden','telegram_bad_request','telegram_unauthorized',
      'telegram_rate_limited','delivery_unknown','retry_exhausted'
    ]::text[])
  ),
  constraint telegram_delivery_intents_state_check check (
    (
      status='pending' and sent_at is null and telegram_message_id is null
      and (failure_code is null or failure_code='telegram_rate_limited')
    ) or (
      status='sent' and sent_at is not null and telegram_message_id is not null
      and failure_code is null and attempt_count > 0
    ) or (
      status='abandoned' and sent_at is null and telegram_message_id is null
      and failure_code is not null and failure_code <> 'stale_event'
    ) or (
      status='superseded' and sent_at is null and telegram_message_id is null
      and failure_code='stale_event'
    )
  ),
  constraint telegram_delivery_intents_numbers_check check (
    source_version between 1 and 9007199254740991
    and occurred_at between 0 and 9007199254740991
    and available_at between 0 and 9007199254740991
    and updated_at between 0 and 9007199254740991
    and attempt_count between 0 and 20
    and version between 1 and 9007199254740991
    and (sent_at is null or sent_at between 0 and 9007199254740991)
    and (
      telegram_message_id is null
      or telegram_message_id between 1 and 9007199254740991
    )
  )
);

create index telegram_delivery_intents_pending_idx
  on backend_notification.telegram_delivery_intents (
    available_at, occurred_at, event_key, recipient_account_id
  ) where status='pending';
create index telegram_delivery_intents_match_idx
  on backend_notification.telegram_delivery_intents (match_id, occurred_at)
  where match_id is not null;
create index telegram_delivery_intents_reservation_idx
  on backend_notification.telegram_delivery_intents (
    reservation_id, occurred_at
  ) where reservation_id is not null;

create table backend_notification.telegram_delivery_rate_budget (
  singleton boolean not null,
  next_send_at bigint not null,
  updated_at bigint not null,
  version bigint not null,
  constraint telegram_delivery_rate_budget_pkey primary key (singleton),
  constraint telegram_delivery_rate_budget_singleton_check check (singleton),
  constraint telegram_delivery_rate_budget_numbers_check check (
    next_send_at between 0 and 9007199254740991
    and updated_at between 0 and 9007199254740991
    and version between 1 and 9007199254740991
  )
);
insert into backend_notification.telegram_delivery_rate_budget
  (singleton,next_send_at,updated_at,version) values (true,0,0,1);

create table backend_notification.yclients_reconciliation_leases (
  reservation_id uuid not null,
  lease_owner uuid not null,
  lease_until bigint not null,
  last_checked_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  version bigint not null,
  constraint yclients_reconciliation_leases_pkey primary key (reservation_id),
  constraint yclients_reconciliation_leases_reservation_fkey
    foreign key (reservation_id)
    references backend_reservation.court_reservations(reservation_id)
    on update no action on delete no action not deferrable,
  constraint yclients_reconciliation_leases_time_check check (
    lease_until between 0 and 9007199254740991
    and (last_checked_at is null or last_checked_at between 0 and 9007199254740991)
    and created_at between 0 and 9007199254740991
    and updated_at between created_at and 9007199254740991
    and version between 1 and 9007199254740991
  )
);
create index yclients_reconciliation_leases_due_idx
  on backend_notification.yclients_reconciliation_leases (
    lease_until, last_checked_at, reservation_id
  );

revoke all on all tables in schema backend_notification
  from public, backend_auth_app;
grant select on all tables in schema backend_notification to backend_auth_app;
grant insert (
  event_key,event_type,category,source_id,source_version,
  recipient_account_id,match_id,reservation_id,occurred_at,available_at,
  status,attempt_count,updated_at,version
) on backend_notification.telegram_delivery_intents to backend_auth_app;
grant update (
  available_at,status,attempt_count,updated_at,sent_at,
  telegram_message_id,failure_code,version
) on backend_notification.telegram_delivery_intents to backend_auth_app;
grant update (next_send_at,updated_at,version)
  on backend_notification.telegram_delivery_rate_budget to backend_auth_app;
grant insert (
  reservation_id,lease_owner,lease_until,last_checked_at,
  created_at,updated_at,version
) on backend_notification.yclients_reconciliation_leases to backend_auth_app;
grant update (lease_owner,lease_until,last_checked_at,updated_at,version)
  on backend_notification.yclients_reconciliation_leases to backend_auth_app;
grant select on table backend_auth.account_notification_preferences
  to backend_auth_app;
grant update (
  telegram_match_activity_enabled,
  telegram_chat_messages_enabled,
  telegram_match_reminders_enabled,
  telegram_booking_updates_enabled,
  telegram_payment_updates_enabled,
  updated_at,
  version
) on backend_auth.account_notification_preferences to backend_auth_app;

do $comments$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'backend_notification.telegram_delivery_intents',
    'backend_notification.telegram_delivery_rate_budget',
    'backend_notification.yclients_reconciliation_leases',
    'backend_auth.account_notification_preferences',
    'backend_match.telegram_notification_outbox'
  ] loop
    execute pg_catalog.format(
      'comment on table %s is %L',
      relation_name,
      '043_backend_telegram_notification_intents:'
        || backend_auth.relation_fingerprint(relation_name::pg_catalog.regclass)
    );
  end loop;
end;
$comments$;

do $assertions$
begin
  if pg_catalog.has_schema_privilege(
       'backend_auth_app','backend_notification','CREATE'
     )
     or not pg_catalog.has_schema_privilege(
       'backend_auth_app','backend_notification','USAGE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: schema privileges differ';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='backend_notification'
      and relation.relkind='r'
      and (relation.relrowsecurity or relation.relforcerowsecurity)
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: unexpected RLS';
  end if;
  if (select pg_catalog.count(*)
      from backend_notification.telegram_delivery_rate_budget) <> 1 then
    raise exception 'MIGRATION_ASSERTION_FAILED: rate singleton differs';
  end if;
end;
$assertions$;

commit;
