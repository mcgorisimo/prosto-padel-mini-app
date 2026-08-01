-- Safe rollback for 025_backend_match_lineups_results.sql.
-- Refuses to remove any migration 025 relation after domain data exists.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_table text;
begin
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot SET ROLE backend_auth_owner';
  end if;

  foreach v_table in array array[
    'match_lineups',
    'match_lineup_assignments',
    'match_lineup_change_requests',
    'match_lineup_change_members',
    'match_lineup_commands',
    'match_results',
    'match_result_commands'
  ]::text[]
  loop
    if pg_catalog.to_regclass(
         pg_catalog.format('backend_match.%I', v_table)
       ) is null then
      raise exception 'ROLLBACK_PRECONDITION_FAILED: backend_match.% is missing',
        v_table;
    end if;
  end loop;
end;
$preconditions$;

set local role backend_auth_owner;

-- Fixed parent-to-child lock order. ACCESS EXCLUSIVE prevents a writer from
-- inserting after the empty checks and before DROP.
lock table backend_match.match_lineups in access exclusive mode;
lock table backend_match.match_lineup_assignments in access exclusive mode;
lock table backend_match.match_lineup_change_requests in access exclusive mode;
lock table backend_match.match_lineup_change_members in access exclusive mode;
lock table backend_match.match_lineup_commands in access exclusive mode;
lock table backend_match.match_results in access exclusive mode;
lock table backend_match.match_result_commands in access exclusive mode;

do $identity_guard$
declare
  v_table text;
begin
  foreach v_table in array array[
    'match_lineups',
    'match_lineup_assignments',
    'match_lineup_change_requests',
    'match_lineup_change_members',
    'match_lineup_commands',
    'match_results',
    'match_result_commands'
  ]::text[]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
        and relation.relname = v_table
        and relation.relkind = 'r'
        and relation.relpersistence = 'p'
        and not relation.relrowsecurity
        and not relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          '025_backend_match_lineups_results:'
            || backend_auth.relation_fingerprint(
              relation.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'ROLLBACK_PRECONDITION_FAILED: backend_match.% is not a canonical migration 025 relation',
        v_table;
    end if;
  end loop;
end;
$identity_guard$;

do $empty_guard$
begin
  if exists (select 1 from backend_match.match_lineups limit 1)
     or exists (
       select 1 from backend_match.match_lineup_assignments limit 1
     )
     or exists (
       select 1 from backend_match.match_lineup_change_requests limit 1
     )
     or exists (
       select 1 from backend_match.match_lineup_change_members limit 1
     )
     or exists (
       select 1 from backend_match.match_lineup_commands limit 1
     )
     or exists (select 1 from backend_match.match_results limit 1)
     or exists (
       select 1 from backend_match.match_result_commands limit 1
     ) then
    raise exception 'ROLLBACK_BLOCKED: migration 025 contains lineup or result history';
  end if;
end;
$empty_guard$;

drop table backend_match.match_result_commands;
drop table backend_match.match_results;
drop table backend_match.match_lineup_commands;
drop table backend_match.match_lineup_change_members;
drop table backend_match.match_lineup_change_requests;
drop table backend_match.match_lineup_assignments;
drop table backend_match.match_lineups;

do $postcheck$
declare
  v_table text;
begin
  foreach v_table in array array[
    'match_lineups',
    'match_lineup_assignments',
    'match_lineup_change_requests',
    'match_lineup_change_members',
    'match_lineup_commands',
    'match_results',
    'match_result_commands'
  ]::text[]
  loop
    if pg_catalog.to_regclass(
         pg_catalog.format('backend_match.%I', v_table)
       ) is not null then
      raise exception 'ROLLBACK_POSTCHECK_FAILED: backend_match.% remains',
        v_table;
    end if;
  end loop;

  if pg_catalog.obj_description(
       'backend_match.matches'::pg_catalog.regclass,
       'pg_class'
     ) <> '023_backend_match_description_updates:'
       || backend_auth.relation_fingerprint(
         'backend_match.matches'::pg_catalog.regclass
       )
     or pg_catalog.obj_description(
       'backend_match.match_commands'::pg_catalog.regclass,
       'pg_class'
     ) <> '023_backend_match_description_updates:'
       || backend_auth.relation_fingerprint(
         'backend_match.match_commands'::pg_catalog.regclass
       )
     or pg_catalog.obj_description(
       'backend_match.match_participants'::pg_catalog.regclass,
       'pg_class'
     ) <> '020_backend_match_storage:'
       || backend_auth.relation_fingerprint(
         'backend_match.match_participants'::pg_catalog.regclass
       ) then
    raise exception 'ROLLBACK_POSTCHECK_FAILED: prerequisite relations changed';
  end if;
end;
$postcheck$;

reset role;
commit;

select '025_backend_match_lineups_results rolled back safely' as result;
