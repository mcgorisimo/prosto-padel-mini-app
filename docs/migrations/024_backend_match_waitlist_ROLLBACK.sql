-- Safe rollback for 024_backend_match_waitlist.sql.
-- Refuses to remove either relation when waitlist history exists.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
begin
  if not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot SET ROLE backend_auth_owner';
  end if;

  if pg_catalog.to_regclass(
       'backend_match.match_waitlist_entries'
     ) is null
     or pg_catalog.to_regclass(
       'backend_match.match_waitlist_commands'
     ) is null then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 024 relations are missing';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table backend_match.match_waitlist_entries
  in access exclusive mode;
lock table backend_match.match_waitlist_commands
  in access exclusive mode;

do $identity_guard$
declare
  v_table text;
begin
  foreach v_table in array array[
    'match_waitlist_entries',
    'match_waitlist_commands'
  ]::text[]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'backend_match'
        and c.relname = v_table
        and c.relkind = 'r'
        and c.relpersistence = 'p'
        and not c.relrowsecurity
        and not c.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '024_backend_match_waitlist:'
            || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
    ) then
      raise exception 'ROLLBACK_PRECONDITION_FAILED: backend_match.% is not a canonical migration 024 relation',
        v_table;
    end if;
  end loop;
end;
$identity_guard$;

do $empty_guard$
begin
  if exists (
       select 1
       from backend_match.match_waitlist_entries
       limit 1
     )
     or exists (
       select 1
       from backend_match.match_waitlist_commands
       limit 1
     ) then
    raise exception 'ROLLBACK_BLOCKED: migration 024 contains waitlist history';
  end if;
end;
$empty_guard$;

drop table backend_match.match_waitlist_commands;
drop table backend_match.match_waitlist_entries;

reset role;
commit;

select '024_backend_match_waitlist rolled back safely' as result;
