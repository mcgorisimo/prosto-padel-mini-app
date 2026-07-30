-- Read-only precheck for 022_backend_match_chat.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_table text;
  v_object_name text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'PRECHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  select * into v_owner
  from pg_catalog.pg_roles
  where rolname = 'backend_auth_owner';

  select * into v_app
  from pg_catalog.pg_roles
  where rolname = 'backend_auth_app';

  if v_owner.rolname is null
     or v_owner.rolcanlogin
     or v_owner.rolsuper
     or v_owner.rolcreaterole
     or v_owner.rolcreatedb
     or v_owner.rolreplication
     or v_owner.rolbypassrls then
    raise exception 'PRECHECK_FAILED: backend_auth_owner attributes are unsafe';
  end if;

  if v_app.rolname is null
     or not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'PRECHECK_FAILED: backend_auth_app attributes are unsafe';
  end if;

  if not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.pg_has_role(
       'backend_auth_app',
       'backend_auth_owner',
       'MEMBER'
     ) then
    raise exception 'PRECHECK_FAILED: role membership boundary differs';
  end if;

  if pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.pg_get_userbyid(
       (
         select n.nspowner
         from pg_catalog.pg_namespace n
         where n.nspname = 'backend_match'
       )
     ) <> 'backend_auth_owner' then
    raise exception 'PRECHECK_FAILED: backend_match schema is missing or owner differs';
  end if;

  foreach v_table in array array[
    'matches',
    'match_participants',
    'match_commands'
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
          '020_backend_match_storage:'
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'PRECHECK_FAILED: backend_match.% differs from migration 020',
        v_table;
    end if;
  end loop;

  foreach v_table in array array[
    'match_invitations',
    'match_invitation_commands'
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
          '021_backend_match_invitations:'
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'PRECHECK_FAILED: backend_match.% differs from migration 021',
        v_table;
    end if;
  end loop;

  foreach v_table in array array[
    'accounts',
    'player_profiles'
  ]::text[]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'backend_auth'
        and c.relname = v_table
        and c.relkind = 'r'
        and pg_catalog.pg_get_userbyid(c.relowner) =
          'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '015_backend_auth_foundation:'
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'PRECHECK_FAILED: backend_auth.% differs from migration 015',
        v_table;
    end if;
  end loop;

  foreach v_object_name in array array[
    'match_messages',
    'match_messages_pkey',
    'match_messages_identity_key',
    'match_messages_match_created_idx',
    'match_messages_sender_created_idx',
    'match_message_commands',
    'match_message_commands_pkey',
    'match_message_commands_message_match_key',
    'match_message_commands_actor_applied_idx'
  ]::text[]
  loop
    if exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'backend_match'
        and c.relname = v_object_name
    ) then
      raise exception 'PRECHECK_FAILED: backend_match.% already exists',
        v_object_name;
    end if;
  end loop;

  if pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'CREATE'
     ) then
    raise exception 'PRECHECK_FAILED: backend_auth_app schema CREATE is unsafe';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_class relation
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
         and relation.relkind = 'r'
     ) <> 5
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       join pg_catalog.pg_class relation
         on relation.oid = constraint_row.conrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
     ) <> 58
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_class relation
         on relation.oid = index_row.indrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
     ) <> 22
     or exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       join pg_catalog.pg_class relation
         on relation.oid = trigger_row.tgrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
         and not trigger_row.tgisinternal
     ) then
    raise exception 'PRECHECK_FAILED: migrations 020-021 catalog boundary differs';
  end if;
end;
$precheck$;

with backend_match_relation_state as (
  select
    relation.relname as table_name,
    backend_auth.relation_fingerprint(
      relation.oid::pg_catalog.regclass
    ) as fingerprint
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'backend_match'
    and relation.relkind = 'r'
)
select pg_catalog.json_build_object(
  'ready', true,
  'migration', '022_backend_match_chat',
  'backend_match_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', 5,
    'constraints', 58,
    'indexes', 22,
    'user_triggers', 0
  ),
  'backend_match_row_counts', pg_catalog.json_build_object(
    'matches', (select pg_catalog.count(*) from backend_match.matches),
    'match_participants',
      (select pg_catalog.count(*) from backend_match.match_participants),
    'match_commands',
      (select pg_catalog.count(*) from backend_match.match_commands),
    'match_invitations',
      (select pg_catalog.count(*) from backend_match.match_invitations),
    'match_invitation_commands',
      (
        select pg_catalog.count(*)
        from backend_match.match_invitation_commands
      )
  ),
  'backend_match_relation_fingerprints', (
    select pg_catalog.jsonb_object_agg(
      table_name,
      fingerprint
      order by table_name
    )
    from backend_match_relation_state
  )
) as precheck;

rollback;
