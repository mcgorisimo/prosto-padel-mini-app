-- Fail-closed rollback for an unused migration 038.
-- Once a preference row or preference_disabled outbox outcome exists, preserve
-- the evidence and use a reviewed forward migration.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_preference_oid oid := pg_catalog.to_regclass(
    'backend_auth.account_notification_preferences'
  );
  v_outbox_oid oid := pg_catalog.to_regclass(
    'backend_match.telegram_notification_outbox'
  );
begin
  if not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot assume backend_auth_owner';
  end if;

  if v_preference_oid is null
     or v_outbox_oid is null
     or pg_catalog.obj_description(v_preference_oid, 'pg_class') <>
       '038_backend_account_notification_preferences:'
         || backend_auth.relation_fingerprint(
           v_preference_oid::pg_catalog.regclass
         )
     or pg_catalog.obj_description(v_outbox_oid, 'pg_class') <>
       '038_backend_account_notification_preferences:'
         || backend_auth.relation_fingerprint(
           v_outbox_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 038 relation differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table backend_auth.accounts in row share mode;
lock table
  backend_auth.account_notification_preferences,
  backend_match.telegram_notification_outbox
in access exclusive mode;

do $history_guard$
begin
  if exists (
       select 1
       from backend_auth.account_notification_preferences
     ) then
    raise exception 'ROLLBACK_REFUSED: notification preference history exists; use a forward migration';
  end if;

  if exists (
       select 1
       from backend_match.telegram_notification_outbox
       where failure_code = 'preference_disabled'
     ) then
    raise exception 'ROLLBACK_REFUSED: preference-disabled delivery evidence exists; use a forward migration';
  end if;
end;
$history_guard$;

alter table backend_match.telegram_notification_outbox
  drop constraint telegram_notification_outbox_failure_check,
  drop constraint telegram_notification_outbox_state_check;

alter table backend_match.telegram_notification_outbox
  add constraint telegram_notification_outbox_failure_check check (
    failure_code is null
    or failure_code = 'destination_unavailable'
    or failure_code = 'telegram_forbidden'
    or failure_code = 'telegram_bad_request'
    or failure_code = 'telegram_rate_limited'
    or failure_code = 'telegram_unavailable'
    or failure_code = 'network_error'
    or failure_code = 'invalid_response'
    or failure_code = 'retry_exhausted'
  ),
  add constraint telegram_notification_outbox_state_check check (
    (
      status = 'pending'
      and sent_at is null
      and telegram_message_id is null
      and attempt_count <= 20
      and (
        failure_code is null
        or failure_code = 'telegram_rate_limited'
        or failure_code = 'telegram_unavailable'
        or failure_code = 'network_error'
        or failure_code = 'invalid_response'
      )
    )
    or (
      status = 'sent'
      and sent_at is not null
      and telegram_message_id is not null
      and failure_code is null
      and attempt_count > 0
    )
    or (
      status = 'abandoned'
      and sent_at is null
      and telegram_message_id is null
      and (
        failure_code = 'destination_unavailable'
        or failure_code = 'telegram_forbidden'
        or failure_code = 'telegram_bad_request'
        or failure_code = 'retry_exhausted'
      )
    )
  );

do $restore_comment$
begin
  execute pg_catalog.format(
    'comment on table backend_match.telegram_notification_outbox is %L',
    '030_backend_telegram_outbound_notifications:'
      || backend_auth.relation_fingerprint(
        'backend_match.telegram_notification_outbox'::pg_catalog.regclass
      )
  );
end;
$restore_comment$;

drop table backend_auth.account_notification_preferences;

do $assertions$
declare
  v_outbox_oid oid :=
    'backend_match.telegram_notification_outbox'::pg_catalog.regclass;
begin
  if pg_catalog.to_regclass(
       'backend_auth.account_notification_preferences'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.account_notification_preferences_pkey'
     ) is not null then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 038 preference object remains';
  end if;

  if exists (
    with expected(constraint_name, normalized_definition) as (
      values
        (
          'telegram_notification_outbox_failure_check',
          'check (failure_code is null or failure_code = ''destination_unavailable''::text or failure_code = ''telegram_forbidden''::text or failure_code = ''telegram_bad_request''::text or failure_code = ''telegram_rate_limited''::text or failure_code = ''telegram_unavailable''::text or failure_code = ''network_error''::text or failure_code = ''invalid_response''::text or failure_code = ''retry_exhausted''::text)'
        ),
        (
          'telegram_notification_outbox_state_check',
          'check (status = ''pending''::text and sent_at is null and telegram_message_id is null and attempt_count <= 20 and (failure_code is null or failure_code = ''telegram_rate_limited''::text or failure_code = ''telegram_unavailable''::text or failure_code = ''network_error''::text or failure_code = ''invalid_response''::text) or status = ''sent''::text and sent_at is not null and telegram_message_id is not null and failure_code is null and attempt_count > 0 or status = ''abandoned''::text and sent_at is null and telegram_message_id is null and (failure_code = ''destination_unavailable''::text or failure_code = ''telegram_forbidden''::text or failure_code = ''telegram_bad_request''::text or failure_code = ''retry_exhausted''::text))'
        )
    ), actual as (
      select
        constraint_row.conname::text,
        pg_catalog.lower(
          pg_catalog.regexp_replace(
            pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
            '[[:space:]]+',
            ' ',
            'g'
          )
        )::text
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = v_outbox_oid
        and constraint_row.conname in (
          'telegram_notification_outbox_failure_check',
          'telegram_notification_outbox_state_check'
        )
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 030 outbox failure contract was not restored';
  end if;

  if pg_catalog.obj_description(v_outbox_oid, 'pg_class') <>
       '030_backend_telegram_outbound_notifications:'
         || backend_auth.relation_fingerprint(
           v_outbox_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 030 outbox fingerprint was not restored';
  end if;
end;
$assertions$;

reset role;
commit;

select '038_backend_account_notification_preferences rolled back before first preference write'
  as result;
