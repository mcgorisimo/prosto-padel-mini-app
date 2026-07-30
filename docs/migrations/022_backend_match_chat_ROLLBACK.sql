-- Safe rollback for 022_backend_match_chat.sql.
-- Refuses to remove either relation when chat history exists.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $role_precondition$
begin
  if not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot SET ROLE backend_auth_owner';
  end if;
end;
$role_precondition$;

set local role backend_auth_owner;

lock table backend_match.match_messages
  in access exclusive mode;
lock table backend_match.match_message_commands
  in access exclusive mode;

do $structure_guard$
declare
  v_table text;
begin
  foreach v_table in array array[
    'match_messages',
    'match_message_commands'
  ]::text[]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'backend_match'
        and c.relname = v_table
        and c.relkind = 'r'
        and pg_catalog.pg_get_userbyid(c.relowner) =
          'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '022_backend_match_chat:'
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'ROLLBACK_PRECONDITION_FAILED: backend_match.% differs from migration 022',
        v_table;
    end if;
  end loop;
end;
$structure_guard$;

do $empty_guard$
begin
  if exists (
       select 1
       from backend_match.match_messages
       limit 1
     )
     or exists (
       select 1
       from backend_match.match_message_commands
       limit 1
     ) then
    raise exception 'ROLLBACK_BLOCKED: migration 022 contains chat history';
  end if;
end;
$empty_guard$;

drop table backend_match.match_message_commands;
drop table backend_match.match_messages;

reset role;
commit;

select '022_backend_match_chat rolled back safely' as result;
