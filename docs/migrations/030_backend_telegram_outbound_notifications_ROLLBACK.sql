-- Fail-closed rollback for an unused migration 030.
-- Once a destination or outbox row exists, preserve it and use a forward migration.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_destination_oid oid := pg_catalog.to_regclass(
    'backend_auth.telegram_notification_destinations'
  );
  v_outbox_oid oid := pg_catalog.to_regclass(
    'backend_match.telegram_notification_outbox'
  );
begin
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot assume backend_auth_owner';
  end if;

  if v_destination_oid is null
     or v_outbox_oid is null
     or pg_catalog.obj_description(v_destination_oid, 'pg_class') <>
       '030_backend_telegram_outbound_notifications:'
         || backend_auth.relation_fingerprint(v_destination_oid::pg_catalog.regclass)
     or pg_catalog.obj_description(v_outbox_oid, 'pg_class') <>
       '030_backend_telegram_outbound_notifications:'
         || backend_auth.relation_fingerprint(v_outbox_oid::pg_catalog.regclass) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 030 relation differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table
  backend_auth.accounts,
  backend_match.match_invitations,
  backend_match.match_notifications,
  backend_auth.telegram_notification_destinations,
  backend_match.telegram_notification_outbox
in access exclusive mode;

do $empty_guard$
begin
  if exists (select 1 from backend_auth.telegram_notification_destinations)
     or exists (select 1 from backend_match.telegram_notification_outbox) then
    raise exception 'ROLLBACK_REFUSED: Telegram delivery history exists; use a forward migration';
  end if;
end;
$empty_guard$;

drop table backend_match.telegram_notification_outbox;
drop table backend_auth.telegram_notification_destinations;

do $assertions$
begin
  if pg_catalog.to_regclass(
       'backend_auth.telegram_notification_destinations'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.telegram_notification_destinations_pkey'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.telegram_notification_destinations_chat_key'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.telegram_notification_outbox'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.telegram_notification_outbox_pkey'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.telegram_notification_outbox_notification_key'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.telegram_notification_outbox_invitation_key'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.telegram_notification_outbox_pending_idx'
     ) is not null then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 030 objects remain';
  end if;
end;
$assertions$;

reset role;
commit;

select '030_backend_telegram_outbound_notifications rolled back before first delivery'
  as result;
