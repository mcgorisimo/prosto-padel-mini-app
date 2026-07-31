-- Read-only precheck for 024_backend_match_waitlist.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_table text;
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
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '023_backend_match_description_updates:'
            || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
    ) then
      raise exception 'PRECHECK_FAILED: backend_match.% differs from migration 023',
        v_table;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'backend_match'
      and c.relname = 'match_participants'
      and c.relkind = 'r'
      and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(c.oid, 'pg_class') =
        '020_backend_match_storage:'
          || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
  ) then
    raise exception 'PRECHECK_FAILED: backend_match.match_participants differs from migration 020';
  end if;

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
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '021_backend_match_invitations:'
            || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
    ) then
      raise exception 'PRECHECK_FAILED: backend_match.% differs from migration 021',
        v_table;
    end if;
  end loop;

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
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '022_backend_match_chat:'
            || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
    ) then
      raise exception 'PRECHECK_FAILED: backend_match.% differs from migration 022',
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
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '015_backend_auth_foundation:'
            || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
    ) then
      raise exception 'PRECHECK_FAILED: backend_auth.% differs from migration 015',
        v_table;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'backend_auth'
      and c.relname = 'player_rating_states'
      and c.relkind = 'r'
      and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(c.oid, 'pg_class') =
        '019_backend_auth_player_rating_state:'
          || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
  ) then
    raise exception 'PRECHECK_FAILED: backend_auth.player_rating_states differs from migration 019';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_match'
      and relation.relname = any (array[
        'match_waitlist_entries',
        'match_waitlist_entries_pkey',
        'match_waitlist_entries_identity_key',
        'match_waitlist_entries_one_waiting_account',
        'match_waitlist_entries_fifo_idx',
        'match_waitlist_entries_match_history_idx',
        'match_waitlist_entries_account_history_idx',
        'match_waitlist_commands',
        'match_waitlist_commands_pkey',
        'match_waitlist_commands_entry_applied_idx',
        'match_waitlist_commands_actor_applied_idx'
      ]::text[])
  ) then
    raise exception 'PRECHECK_FAILED: migration 024 target object already exists';
  end if;

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
     ) <> 7
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       join pg_catalog.pg_class relation
         on relation.oid = constraint_row.conrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
     ) <> 70
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_class relation
         on relation.oid = index_row.indrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
     ) <> 29
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
    raise exception 'PRECHECK_FAILED: migration 023 catalog boundary differs';
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
  'migration', '024_backend_match_waitlist',
  'backend_match_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', 7,
    'constraints', 70,
    'indexes', 29,
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
      ),
    'match_messages',
      (select pg_catalog.count(*) from backend_match.match_messages),
    'match_message_commands',
      (
        select pg_catalog.count(*)
        from backend_match.match_message_commands
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
