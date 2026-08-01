-- Read-only precheck for 026_backend_match_rating_applications.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_relation record;
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

  if pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_match'
     )) <> 'backend_auth_owner' then
    raise exception 'PRECHECK_FAILED: backend_match schema is missing or owner differs';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_match', 'matches', '023_backend_match_description_updates'),
      ('backend_match', 'match_results', '025_backend_match_lineups_results'),
      ('backend_match', 'match_result_commands', '025_backend_match_lineups_results'),
      ('backend_auth', 'player_profiles', '015_backend_auth_foundation'),
      ('backend_auth', 'player_rating_states', '019_backend_auth_player_rating_state')
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
    where namespace.nspname = 'backend_match'
      and relation.relname = any (array[
        'match_rating_applications',
        'match_rating_applications_pkey',
        'match_rating_applications_match_id_key',
        'match_rating_applications_identity_key',
        'match_rating_applications_actor_history_idx',
        'match_rating_applications_applied_at_idx',
        'match_rating_changes',
        'match_rating_changes_pkey',
        'match_rating_changes_slot_key',
        'match_rating_changes_account_history_idx',
        'match_rating_changes_match_idx'
      ]::text[])
  ) then
    raise exception 'PRECHECK_FAILED: migration 026 target object already exists';
  end if;

  if pg_catalog.has_schema_privilege('backend_auth_app', 'backend_match', 'CREATE')
     or pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'CREATE') then
    raise exception 'PRECHECK_FAILED: backend_auth_app schema CREATE is unsafe';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'rating', 'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'updated_at', 'UPDATE'
     ) then
    raise exception 'PRECHECK_FAILED: rating writer privilege already exists';
  end if;

  if (select pg_catalog.count(*) from backend_auth.player_profiles) <>
     (select pg_catalog.count(*) from backend_auth.player_rating_states) then
    raise exception 'PRECHECK_FAILED: player rating state coverage differs';
  end if;

  if exists (
    select 1
    from backend_match.match_results result_row
    join backend_match.matches match_row on match_row.id = result_row.match_id
    where match_row.is_rating_match
      and result_row.status = 'confirmed'
  ) then
    raise exception 'PRECHECK_FAILED: confirmed rating result requires reconciliation';
  end if;
end;
$precheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '026_backend_match_rating_applications',
  'backend_match_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', (
      select pg_catalog.count(*)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match' and relation.relkind = 'r'
    ),
    'constraints', (
      select pg_catalog.count(*)
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
    ),
    'user_triggers', (
      select pg_catalog.count(*)
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match' and not trigger_row.tgisinternal
    )
  ),
  'row_counts', pg_catalog.jsonb_build_object(
    'matches', (select pg_catalog.count(*) from backend_match.matches),
    'match_results', (select pg_catalog.count(*) from backend_match.match_results),
    'match_result_commands', (
      select pg_catalog.count(*) from backend_match.match_result_commands
    ),
    'confirmed_rating_results', (
      select pg_catalog.count(*)
      from backend_match.match_results result_row
      join backend_match.matches match_row on match_row.id = result_row.match_id
      where match_row.is_rating_match
        and result_row.status = 'confirmed'
    ),
    'player_profiles', (select pg_catalog.count(*) from backend_auth.player_profiles),
    'player_rating_states', (
      select pg_catalog.count(*) from backend_auth.player_rating_states
    )
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'matches', backend_auth.relation_fingerprint(
      'backend_match.matches'::pg_catalog.regclass
    ),
    'match_results', backend_auth.relation_fingerprint(
      'backend_match.match_results'::pg_catalog.regclass
    ),
    'match_result_commands', backend_auth.relation_fingerprint(
      'backend_match.match_result_commands'::pg_catalog.regclass
    ),
    'player_profiles', backend_auth.relation_fingerprint(
      'backend_auth.player_profiles'::pg_catalog.regclass
    ),
    'player_rating_states', backend_auth.relation_fingerprint(
      'backend_auth.player_rating_states'::pg_catalog.regclass
    )
  )
) as backend_match_rating_applications_precheck;

rollback;
