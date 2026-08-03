-- Fail-closed rollback for an unused migration 029.
-- Once a notification exists, preserve it and use a forward migration.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
begin
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot assume backend_auth_owner';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_match'
      and relation.relname = 'match_notifications'
      and relation.relkind = 'r'
      and relation.relpersistence = 'p'
      and not relation.relrowsecurity
      and not relation.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(relation.oid, 'pg_class') =
        '029_backend_match_notifications:'
          || backend_auth.relation_fingerprint(relation.oid::pg_catalog.regclass)
  ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 029 relation differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table
  backend_match.match_waitlist_entries,
  backend_match.match_notifications
in access exclusive mode;

do $empty_guard$
begin
  if exists (select 1 from backend_match.match_notifications) then
    raise exception 'ROLLBACK_REFUSED: notification history exists; use a forward migration';
  end if;
end;
$empty_guard$;

drop table backend_match.match_notifications;

do $assertions$
begin
  if pg_catalog.to_regclass('backend_match.match_notifications') is not null
     or pg_catalog.to_regclass('backend_match.match_notifications_pkey') is not null
     or pg_catalog.to_regclass(
       'backend_match.match_notifications_waitlist_entry_key'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.match_notifications_recipient_feed_idx'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.match_notifications_recipient_unread_idx'
     ) is not null then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 029 objects remain';
  end if;
end;
$assertions$;

reset role;
commit;

select '029_backend_match_notifications rolled back before first notification'
  as result;
