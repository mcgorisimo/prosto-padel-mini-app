-- Data-safe rollback for migration 023.
begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $role_precheck$
begin
  if pg_catalog.to_regrole('backend_auth_owner') is null
     or not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: owner role boundary is unavailable';
  end if;
end;
$role_precheck$;

set local role backend_auth_owner;
lock table backend_match.matches in access exclusive mode;
lock table backend_match.match_commands in access exclusive mode;

do $preconditions$
begin
  if exists (
    select 1 from backend_match.match_commands
    where command_type = 'update_match_description'
       or result_type = 'match_description_updated'
  ) then
    raise exception 'ROLLBACK_BLOCKED: description update commands already exist';
  end if;
end;
$preconditions$;

revoke update (description) on backend_match.matches from backend_auth_app;

alter table backend_match.match_commands
  drop constraint match_commands_result_check,
  add constraint match_commands_result_check check (
    (command_type = 'create_match' and result_type = 'match_created' and participant_id is null)
    or (command_type = 'join_match' and result_type = 'participant_joined' and participant_id is not null)
    or (command_type = 'leave_match' and result_type = 'participant_left' and participant_id is not null)
  );

do $comments$
begin
  execute pg_catalog.format(
    'comment on table backend_match.matches is %L',
    '020_backend_match_storage:' || backend_auth.relation_fingerprint('backend_match.matches'::pg_catalog.regclass)
  );
  execute pg_catalog.format(
    'comment on table backend_match.match_commands is %L',
    '020_backend_match_storage:' || backend_auth.relation_fingerprint('backend_match.match_commands'::pg_catalog.regclass)
  );
end;
$comments$;

do $assertions$
declare
  v_matches oid := pg_catalog.to_regclass('backend_match.matches')::oid;
  v_commands oid := pg_catalog.to_regclass('backend_match.match_commands')::oid;
  v_definition text;
begin
  select pg_catalog.lower(
           pg_catalog.regexp_replace(
             pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
             '[[:space:]]+',
             ' ',
             'g'
           )
         )
    into v_definition
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_commands
    and constraint_row.conname = 'match_commands_result_check'
    and constraint_row.contype = 'c';
  if v_definition is distinct from
       'check (command_type = ''create_match''::text and result_type = ''match_created''::text and participant_id is null or command_type = ''join_match''::text and result_type = ''participant_joined''::text and participant_id is not null or command_type = ''leave_match''::text and result_type = ''participant_left''::text and participant_id is not null)'
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_matches,
       'description',
       'UPDATE'
     )
     or pg_catalog.obj_description(v_matches, 'pg_class') is distinct from
       '020_backend_match_storage:' || backend_auth.relation_fingerprint(v_matches::pg_catalog.regclass)
     or pg_catalog.obj_description(v_commands, 'pg_class') is distinct from
       '020_backend_match_storage:' || backend_auth.relation_fingerprint(v_commands::pg_catalog.regclass) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 020 boundary was not restored';
  end if;
end;
$assertions$;

reset role;
commit;

select '023_backend_match_description_updates rolled back before use' as result;
