-- 023_backend_match_description_updates.sql
-- Enables owner-only, state-machine-backed updates of match descriptions.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_matches oid := pg_catalog.to_regclass('backend_match.matches')::oid;
  v_commands oid := pg_catalog.to_regclass('backend_match.match_commands')::oid;
  v_definition text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
  end if;
  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null
     or not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: required role boundary is unavailable';
  end if;
  if v_matches is null or v_commands is null
     or pg_catalog.pg_get_userbyid((select c.relowner from pg_catalog.pg_class c where c.oid = v_matches)) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((select c.relowner from pg_catalog.pg_class c where c.oid = v_commands)) <> 'backend_auth_owner'
     or pg_catalog.obj_description(v_matches, 'pg_class') is distinct from
       '020_backend_match_storage:' || backend_auth.relation_fingerprint(v_matches::pg_catalog.regclass)
     or pg_catalog.obj_description(v_commands, 'pg_class') is distinct from
       '020_backend_match_storage:' || backend_auth.relation_fingerprint(v_commands::pg_catalog.regclass) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: canonical match relations differ';
  end if;
  if pg_catalog.has_column_privilege('backend_auth_app', v_matches, 'description', 'UPDATE') then
    raise exception 'MIGRATION_CONFLICT: description update privilege already exists';
  end if;
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
    'check (command_type = ''create_match''::text and result_type = ''match_created''::text and participant_id is null or command_type = ''join_match''::text and result_type = ''participant_joined''::text and participant_id is not null or command_type = ''leave_match''::text and result_type = ''participant_left''::text and participant_id is not null)' then
    raise exception 'MIGRATION_PRECONDITION_FAILED: match command taxonomy differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

alter table backend_match.match_commands
  drop constraint match_commands_result_check,
  add constraint match_commands_result_check check (
    (command_type = 'create_match' and result_type = 'match_created' and participant_id is null)
    or (command_type = 'update_match_description' and result_type = 'match_description_updated' and participant_id is null)
    or (command_type = 'join_match' and result_type = 'participant_joined' and participant_id is not null)
    or (command_type = 'leave_match' and result_type = 'participant_left' and participant_id is not null)
  );

grant update (description)
  on backend_match.matches
  to backend_auth_app;

do $comments$
begin
  execute pg_catalog.format(
    'comment on table backend_match.matches is %L',
    '023_backend_match_description_updates:' || backend_auth.relation_fingerprint('backend_match.matches'::pg_catalog.regclass)
  );
  execute pg_catalog.format(
    'comment on table backend_match.match_commands is %L',
    '023_backend_match_description_updates:' || backend_auth.relation_fingerprint('backend_match.match_commands'::pg_catalog.regclass)
  );
end;
$comments$;

do $assertions$
declare
  v_matches oid := pg_catalog.to_regclass('backend_match.matches')::oid;
  v_commands oid := pg_catalog.to_regclass('backend_match.match_commands')::oid;
begin
  if not pg_catalog.has_column_privilege('backend_auth_app', v_matches, 'description', 'UPDATE')
     or pg_catalog.has_table_privilege('backend_auth_app', v_matches, 'UPDATE') then
    raise exception 'MIGRATION_ASSERTION_FAILED: description update boundary differs';
  end if;
  if pg_catalog.obj_description(v_matches, 'pg_class') is distinct from
       '023_backend_match_description_updates:' || backend_auth.relation_fingerprint(v_matches::pg_catalog.regclass)
     or pg_catalog.obj_description(v_commands, 'pg_class') is distinct from
       '023_backend_match_description_updates:' || backend_auth.relation_fingerprint(v_commands::pg_catalog.regclass) then
    raise exception 'MIGRATION_ASSERTION_FAILED: relation fingerprint differs';
  end if;
end;
$assertions$;

reset role;
commit;

select '023_backend_match_description_updates applied; run POSTCHECK before backend rollout' as result;
