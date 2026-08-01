-- Read-only precheck for 025_backend_match_lineups_results.sql.

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

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
     or pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'PRECHECK_FAILED: role membership boundary differs';
  end if;

  if pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.pg_get_userbyid(
       (
         select namespace.nspowner
         from pg_catalog.pg_namespace namespace
         where namespace.nspname = 'backend_match'
       )
     ) <> 'backend_auth_owner' then
    raise exception 'PRECHECK_FAILED: backend_match schema is missing or owner differs';
  end if;

  foreach v_table in array array['matches', 'match_commands']::text[]
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
          '023_backend_match_description_updates:'
            || backend_auth.relation_fingerprint(
              relation.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'PRECHECK_FAILED: backend_match.% differs from migration 023',
        v_table;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_match'
      and relation.relname = 'match_participants'
      and relation.relkind = 'r'
      and relation.relpersistence = 'p'
      and not relation.relrowsecurity
      and not relation.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(relation.oid, 'pg_class') =
        '020_backend_match_storage:'
          || backend_auth.relation_fingerprint(
            relation.oid::pg_catalog.regclass
          )
  ) then
    raise exception 'PRECHECK_FAILED: backend_match.match_participants differs from migration 020';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_auth'
      and relation.relname = 'player_profiles'
      and relation.relkind = 'r'
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(relation.oid, 'pg_class') =
        '015_backend_auth_foundation:'
          || backend_auth.relation_fingerprint(
            relation.oid::pg_catalog.regclass
          )
  ) then
    raise exception 'PRECHECK_FAILED: backend_auth.player_profiles differs from migration 015';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_auth'
      and relation.relname = 'player_rating_states'
      and relation.relkind = 'r'
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(relation.oid, 'pg_class') =
        '019_backend_auth_player_rating_state:'
          || backend_auth.relation_fingerprint(
            relation.oid::pg_catalog.regclass
          )
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
        'match_lineups',
        'match_lineups_pkey',
        'match_lineups_status_updated_idx',
        'match_lineup_assignments',
        'match_lineup_assignments_pkey',
        'match_lineup_assignments_identity_key',
        'match_lineup_assignments_active_slot_key',
        'match_lineup_assignments_active_account_key',
        'match_lineup_assignments_match_history_idx',
        'match_lineup_assignments_account_history_idx',
        'match_lineup_change_requests',
        'match_lineup_change_requests_pkey',
        'match_lineup_change_requests_identity_key',
        'match_lineup_change_requests_one_pending_match',
        'match_lineup_change_requests_match_history_idx',
        'match_lineup_change_requests_requester_history_idx',
        'match_lineup_change_members',
        'match_lineup_change_members_pkey',
        'match_lineup_change_members_from_slot_key',
        'match_lineup_change_members_to_slot_key',
        'match_lineup_change_members_pending_account_idx',
        'match_lineup_change_members_account_history_idx',
        'match_lineup_commands',
        'match_lineup_commands_pkey',
        'match_lineup_commands_actor_applied_idx',
        'match_lineup_commands_match_applied_idx',
        'match_lineup_commands_assignment_id_idx',
        'match_lineup_commands_change_request_id_idx',
        'match_results',
        'match_results_pkey',
        'match_results_match_id_key',
        'match_results_identity_key',
        'match_results_status_submitted_idx',
        'match_results_team1_left_account_idx',
        'match_results_team1_right_account_idx',
        'match_results_team2_left_account_idx',
        'match_results_team2_right_account_idx',
        'match_results_submitted_by_account_idx',
        'match_results_confirmed_by_account_idx',
        'match_results_disputed_by_account_idx',
        'match_result_commands',
        'match_result_commands_pkey',
        'match_result_commands_actor_applied_idx',
        'match_result_commands_result_applied_idx'
      ]::text[])
  ) then
    raise exception 'PRECHECK_FAILED: migration 025 target object already exists';
  end if;

  if pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     ) then
    raise exception 'PRECHECK_FAILED: backend_auth_app schema CREATE is unsafe';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_auth.player_rating_states',
       'UPDATE'
     ) then
    raise exception 'PRECHECK_FAILED: backend_auth_app rating update boundary is unsafe';
  end if;
end;
$precheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '025_backend_match_lineups_results',
  'backend_match_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', (
      select pg_catalog.count(*)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
        and relation.relkind = 'r'
    ),
    'constraints', (
      select pg_catalog.count(*)
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation
        on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
    ),
    'user_triggers', (
      select pg_catalog.count(*)
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation
        on relation.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
        and not trigger_row.tgisinternal
    )
  ),
  'row_counts', pg_catalog.jsonb_build_object(
    'matches', (select pg_catalog.count(*) from backend_match.matches),
    'match_participants', (
      select pg_catalog.count(*) from backend_match.match_participants
    ),
    'match_commands', (
      select pg_catalog.count(*) from backend_match.match_commands
    ),
    'player_profiles', (
      select pg_catalog.count(*) from backend_auth.player_profiles
    ),
    'player_rating_states', (
      select pg_catalog.count(*) from backend_auth.player_rating_states
    )
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'matches', backend_auth.relation_fingerprint(
      'backend_match.matches'::pg_catalog.regclass
    ),
    'match_participants', backend_auth.relation_fingerprint(
      'backend_match.match_participants'::pg_catalog.regclass
    ),
    'match_commands', backend_auth.relation_fingerprint(
      'backend_match.match_commands'::pg_catalog.regclass
    ),
    'player_profiles', backend_auth.relation_fingerprint(
      'backend_auth.player_profiles'::pg_catalog.regclass
    ),
    'player_rating_states', backend_auth.relation_fingerprint(
      'backend_auth.player_rating_states'::pg_catalog.regclass
    )
  )
) as backend_match_lineups_results_precheck;

rollback;
