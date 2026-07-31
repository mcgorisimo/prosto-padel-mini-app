-- Read-only verification for migration 023.
begin;
set transaction read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_matches oid := pg_catalog.to_regclass('backend_match.matches')::oid;
  v_commands oid := pg_catalog.to_regclass('backend_match.match_commands')::oid;
  v_definition text;
  v_differences bigint;
begin
  if v_matches is null or v_commands is null
     or pg_catalog.pg_get_userbyid((select c.relowner from pg_catalog.pg_class c where c.oid = v_matches)) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((select c.relowner from pg_catalog.pg_class c where c.oid = v_commands)) <> 'backend_auth_owner'
     or pg_catalog.obj_description(v_matches, 'pg_class') is distinct from
       '023_backend_match_description_updates:' || backend_auth.relation_fingerprint(v_matches::pg_catalog.regclass)
     or pg_catalog.obj_description(v_commands, 'pg_class') is distinct from
       '023_backend_match_description_updates:' || backend_auth.relation_fingerprint(v_commands::pg_catalog.regclass) then
    raise exception 'POSTCHECK_FAILED: owner or relation fingerprint differs';
  end if;

  select pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid, true), '[[:space:]]+', ' ', 'g'))
    into v_definition
  from pg_catalog.pg_constraint c
  where c.conrelid = v_commands and c.conname = 'match_commands_result_check' and c.contype = 'c';
  if v_definition is distinct from
    'check (command_type = ''create_match''::text and result_type = ''match_created''::text and participant_id is null or command_type = ''update_match_description''::text and result_type = ''match_description_updated''::text and participant_id is null or command_type = ''join_match''::text and result_type = ''participant_joined''::text and participant_id is not null or command_type = ''leave_match''::text and result_type = ''participant_left''::text and participant_id is not null)' then
    raise exception 'POSTCHECK_FAILED: exact command taxonomy differs';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = v_commands
      and constraint_row.conname = 'match_commands_result_check'
      and constraint_row.contype = 'c'
      and constraint_row.conkey = array(
        select attribute.attnum::smallint
        from pg_catalog.pg_attribute attribute
        where attribute.attrelid = v_commands
          and attribute.attname in (
            'command_type',
            'participant_id',
            'result_type'
          )
          and not attribute.attisdropped
        order by attribute.attnum
      )
      and not constraint_row.condeferrable
      and not constraint_row.condeferred
      and constraint_row.convalidated
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = v_commands
      and constraint_row.conname = 'match_commands_result_check'
  ) <> 1 then
    raise exception 'POSTCHECK_FAILED: exact command constraint metadata differs';
  end if;

  with expected(schema_name, table_name, column_name, grantor, grantee, privilege_type, is_grantable) as (
    values
      ('backend_match', 'matches', 'description', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'description', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false)
  ),
  actual as (
    select
      n.nspname::text,
      c.relname::text,
      a.attname::text,
      case
        when acl.grantor = 0 then 'PUBLIC'::text
        else grantor.rolname::text
      end,
      case
        when acl.grantee = 0 then 'PUBLIC'::text
        else grantee.rolname::text
      end,
      acl.privilege_type::text,
      acl.is_grantable
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(a.attacl) acl
    left join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
    left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where a.attrelid = v_matches and a.attname = 'description' and not a.attisdropped
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_differences from differences;
  if v_differences <> 0 or pg_catalog.has_table_privilege('backend_auth_app', v_matches, 'UPDATE') then
    raise exception 'POSTCHECK_FAILED: exact description ACL differs';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'migration', '023_backend_match_description_updates',
  'matches', (select pg_catalog.count(*) from backend_match.matches),
  'commands', (select pg_catalog.count(*) from backend_match.match_commands),
  'ready', true
) as backend_match_description_updates_postcheck;

rollback;
