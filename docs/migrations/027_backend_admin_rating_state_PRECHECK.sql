-- Read-only precheck for 027_backend_admin_rating_state.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_relation record;
  v_update_columns text[];
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'PRECHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  select * into v_owner from pg_catalog.pg_roles where rolname = 'backend_auth_owner';
  select * into v_app from pg_catalog.pg_roles where rolname = 'backend_auth_app';

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

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
     or pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'PRECHECK_FAILED: role membership boundary differs';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_auth'
     )) <> 'backend_auth_owner' then
    raise exception 'PRECHECK_FAILED: backend_auth schema is missing or owner differs';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_auth', 'accounts', '015_backend_auth_foundation'),
      ('backend_auth', 'player_profiles', '015_backend_auth_foundation'),
      ('backend_auth', 'player_rating_states', '026_backend_match_rating_applications'),
      ('backend_match', 'match_rating_applications', '026_backend_match_rating_applications'),
      ('backend_match', 'match_rating_changes', '026_backend_match_rating_applications')
    ) expected(schema_name, relation_name, migration_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = v_relation.schema_name
        and relation.relname = v_relation.relation_name
        and relation.relkind = 'r'
        and relation.relpersistence = 'p'
        and not relation.relrowsecurity
        and not relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          v_relation.migration_name || ':'
            || backend_auth.relation_fingerprint(relation.oid::pg_catalog.regclass)
    ) then
      raise exception 'PRECHECK_FAILED: %.% differs from %',
        v_relation.schema_name,
        v_relation.relation_name,
        v_relation.migration_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_auth'
      and relation.relname = any (array[
        'player_rating_admin_commands',
        'player_rating_admin_commands_pkey',
        'player_rating_admin_commands_actor_account_id_fkey',
        'player_rating_admin_commands_target_account_id_fkey',
        'player_rating_admin_commands_actor_applied_idx',
        'player_rating_admin_commands_target_applied_idx'
      ]::text[])
  ) then
    raise exception 'PRECHECK_FAILED: migration 027 target object already exists';
  end if;

  if pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'CREATE') then
    raise exception 'PRECHECK_FAILED: backend_auth_app schema CREATE is unsafe';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'UPDATE'
     ) then
    raise exception 'PRECHECK_FAILED: player_rating_states table UPDATE is unsafe';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_update_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'backend_auth.player_rating_states'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and pg_catalog.has_column_privilege(
      'backend_auth_app',
      'backend_auth.player_rating_states',
      attribute.attname,
      'UPDATE'
    );

  if v_update_columns is distinct from array['rating', 'updated_at']::text[] then
    raise exception 'PRECHECK_FAILED: rating writer column boundary differs';
  end if;

  if (select pg_catalog.count(*) from backend_auth.player_profiles) <>
     (select pg_catalog.count(*) from backend_auth.player_rating_states) then
    raise exception 'PRECHECK_FAILED: player rating state coverage differs';
  end if;

  if exists (
    select 1
    from backend_auth.player_rating_states state
    where state.rating < 0.00
       or state.rating > 10.00
       or state.updated_at < state.created_at
  ) then
    raise exception 'PRECHECK_FAILED: player rating state data is invalid';
  end if;
end;
$precheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '027_backend_admin_rating_state',
  'backend_auth_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', (
      select pg_catalog.count(*)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth' and relation.relkind = 'r'
    ),
    'constraints', (
      select pg_catalog.count(*)
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth'
    ),
    'user_triggers', (
      select pg_catalog.count(*)
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth' and not trigger_row.tgisinternal
    )
  ),
  'row_counts', pg_catalog.jsonb_build_object(
    'accounts', (select pg_catalog.count(*) from backend_auth.accounts),
    'player_profiles', (select pg_catalog.count(*) from backend_auth.player_profiles),
    'player_rating_states', (
      select pg_catalog.count(*) from backend_auth.player_rating_states
    ),
    'match_rating_applications', (
      select pg_catalog.count(*) from backend_match.match_rating_applications
    ),
    'match_rating_changes', (
      select pg_catalog.count(*) from backend_match.match_rating_changes
    )
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'accounts', backend_auth.relation_fingerprint(
      'backend_auth.accounts'::pg_catalog.regclass
    ),
    'player_profiles', backend_auth.relation_fingerprint(
      'backend_auth.player_profiles'::pg_catalog.regclass
    ),
    'player_rating_states', backend_auth.relation_fingerprint(
      'backend_auth.player_rating_states'::pg_catalog.regclass
    ),
    'match_rating_applications', backend_auth.relation_fingerprint(
      'backend_match.match_rating_applications'::pg_catalog.regclass
    ),
    'match_rating_changes', backend_auth.relation_fingerprint(
      'backend_match.match_rating_changes'::pg_catalog.regclass
    )
  )
) as backend_admin_rating_state_precheck;

rollback;
