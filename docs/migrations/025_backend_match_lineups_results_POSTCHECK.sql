-- Read-only postcheck for 025_backend_match_lineups_results.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_difference_count bigint;
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_table text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'POSTCHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null
     or pg_catalog.to_regnamespace('backend_match') is null then
    raise exception 'POSTCHECK_FAILED: required role or schema is missing';
  end if;

  select * into v_owner
  from pg_catalog.pg_roles
  where rolname = 'backend_auth_owner';

  select * into v_app
  from pg_catalog.pg_roles
  where rolname = 'backend_auth_app';

  if v_owner.rolcanlogin
     or v_owner.rolsuper
     or v_owner.rolcreaterole
     or v_owner.rolcreatedb
     or v_owner.rolreplication
     or v_owner.rolbypassrls
     or not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls
     or not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.pg_has_role(
       'backend_auth_app',
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.pg_get_userbyid(
       (
         select namespace.nspowner
         from pg_catalog.pg_namespace namespace
         where namespace.nspname = 'backend_match'
       )
     ) <> 'backend_auth_owner' then
    raise exception 'POSTCHECK_FAILED: role or schema boundary differs';
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
      raise exception 'POSTCHECK_FAILED: backend_match.% identity differs',
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
    raise exception 'POSTCHECK_FAILED: prerequisite match relations changed';
  end if;

  if pg_catalog.obj_description(
       'backend_auth.player_profiles'::pg_catalog.regclass,
       'pg_class'
     ) <> '015_backend_auth_foundation:'
       || backend_auth.relation_fingerprint(
         'backend_auth.player_profiles'::pg_catalog.regclass
       )
     or pg_catalog.obj_description(
       'backend_auth.player_rating_states'::pg_catalog.regclass,
       'pg_class'
     ) <> '019_backend_auth_player_rating_state:'
       || backend_auth.relation_fingerprint(
         'backend_auth.player_rating_states'::pg_catalog.regclass
       ) then
    raise exception 'POSTCHECK_FAILED: profile or rating relation changed';
  end if;

  with expected(
    table_name,
    ordinal_position,
    column_name,
    data_type,
    is_not_null,
    default_expression
  ) as (
    values
      ('match_lineups', 1, 'match_id', 'uuid', true, null),
      ('match_lineups', 2, 'status', 'text', true, null),
      ('match_lineups', 3, 'created_at', 'bigint', true, null),
      ('match_lineups', 4, 'updated_at', 'bigint', true, null),
      ('match_lineups', 5, 'locked_at', 'bigint', false, null),
      ('match_lineups', 6, 'version', 'bigint', true, null),
      ('match_lineup_assignments', 1, 'id', 'uuid', true, null),
      ('match_lineup_assignments', 2, 'match_id', 'uuid', true, null),
      ('match_lineup_assignments', 3, 'account_id', 'uuid', true, null),
      ('match_lineup_assignments', 4, 'team_number', 'smallint', true, null),
      ('match_lineup_assignments', 5, 'court_side', 'text', true, null),
      ('match_lineup_assignments', 6, 'status', 'text', true, null),
      ('match_lineup_assignments', 7, 'assigned_at', 'bigint', true, null),
      ('match_lineup_assignments', 8, 'updated_at', 'bigint', true, null),
      ('match_lineup_assignments', 9, 'released_at', 'bigint', false, null),
      ('match_lineup_assignments', 10, 'version', 'bigint', true, null),
      ('match_lineup_change_requests', 1, 'id', 'uuid', true, null),
      ('match_lineup_change_requests', 2, 'match_id', 'uuid', true, null),
      ('match_lineup_change_requests', 3, 'requested_by_account_id', 'uuid', true, null),
      ('match_lineup_change_requests', 4, 'base_lineup_version', 'bigint', true, null),
      ('match_lineup_change_requests', 5, 'status', 'text', true, null),
      ('match_lineup_change_requests', 6, 'created_at', 'bigint', true, null),
      ('match_lineup_change_requests', 7, 'updated_at', 'bigint', true, null),
      ('match_lineup_change_requests', 8, 'resolved_at', 'bigint', false, null),
      ('match_lineup_change_requests', 9, 'version', 'bigint', true, null),
      ('match_lineup_change_members', 1, 'request_id', 'uuid', true, null),
      ('match_lineup_change_members', 2, 'match_id', 'uuid', true, null),
      ('match_lineup_change_members', 3, 'account_id', 'uuid', true, null),
      ('match_lineup_change_members', 4, 'from_team_number', 'smallint', true, null),
      ('match_lineup_change_members', 5, 'from_court_side', 'text', true, null),
      ('match_lineup_change_members', 6, 'to_team_number', 'smallint', true, null),
      ('match_lineup_change_members', 7, 'to_court_side', 'text', true, null),
      ('match_lineup_change_members', 8, 'approval_status', 'text', true, null),
      ('match_lineup_change_members', 9, 'responded_at', 'bigint', false, null),
      ('match_lineup_commands', 1, 'command_id', 'uuid', true, null),
      ('match_lineup_commands', 2, 'match_id', 'uuid', true, null),
      ('match_lineup_commands', 3, 'actor_account_id', 'uuid', true, null),
      ('match_lineup_commands', 4, 'request_digest', 'bytea', true, null),
      ('match_lineup_commands', 5, 'command_type', 'text', true, null),
      ('match_lineup_commands', 6, 'result_type', 'text', true, null),
      ('match_lineup_commands', 7, 'applied_at', 'bigint', true, null),
      ('match_lineup_commands', 8, 'lineup_version', 'bigint', true, null),
      ('match_lineup_commands', 9, 'assignment_id', 'uuid', false, null),
      ('match_lineup_commands', 10, 'change_request_id', 'uuid', false, null),
      ('match_results', 1, 'id', 'uuid', true, null),
      ('match_results', 2, 'match_id', 'uuid', true, null),
      ('match_results', 3, 'lineup_version', 'bigint', true, null),
      ('match_results', 4, 'team1_left_account_id', 'uuid', true, null),
      ('match_results', 5, 'team1_right_account_id', 'uuid', true, null),
      ('match_results', 6, 'team2_left_account_id', 'uuid', true, null),
      ('match_results', 7, 'team2_right_account_id', 'uuid', true, null),
      ('match_results', 8, 'team1_set1_games', 'smallint', true, null),
      ('match_results', 9, 'team2_set1_games', 'smallint', true, null),
      ('match_results', 10, 'team1_set2_games', 'smallint', true, null),
      ('match_results', 11, 'team2_set2_games', 'smallint', true, null),
      ('match_results', 12, 'team1_set3_games', 'smallint', false, null),
      ('match_results', 13, 'team2_set3_games', 'smallint', false, null),
      ('match_results', 14, 'winning_team', 'smallint', true, null),
      ('match_results', 15, 'status', 'text', true, null),
      ('match_results', 16, 'submitted_by_account_id', 'uuid', true, null),
      ('match_results', 17, 'submitted_at', 'bigint', true, null),
      ('match_results', 18, 'confirmed_by_account_id', 'uuid', false, null),
      ('match_results', 19, 'confirmed_at', 'bigint', false, null),
      ('match_results', 20, 'disputed_by_account_id', 'uuid', false, null),
      ('match_results', 21, 'disputed_at', 'bigint', false, null),
      ('match_results', 22, 'version', 'bigint', true, null),
      ('match_result_commands', 1, 'command_id', 'uuid', true, null),
      ('match_result_commands', 2, 'result_id', 'uuid', true, null),
      ('match_result_commands', 3, 'match_id', 'uuid', true, null),
      ('match_result_commands', 4, 'actor_account_id', 'uuid', true, null),
      ('match_result_commands', 5, 'request_digest', 'bytea', true, null),
      ('match_result_commands', 6, 'command_type', 'text', true, null),
      ('match_result_commands', 7, 'result_type', 'text', true, null),
      ('match_result_commands', 8, 'applied_at', 'bigint', true, null),
      ('match_result_commands', 9, 'result_status', 'text', true, null),
      ('match_result_commands', 10, 'result_version', 'bigint', true, null)
  ),
  actual as (
    select
      relation.relname::text,
      attribute.attnum::integer,
      attribute.attname::text,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      attribute.attnotnull,
      pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid, true)
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation
      on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    left join pg_catalog.pg_attrdef default_row
      on default_row.adrelid = attribute.attrelid
     and default_row.adnum = attribute.attnum
    where namespace.nspname = 'backend_match'
      and relation.relname = any (array[
        'match_lineups',
        'match_lineup_assignments',
        'match_lineup_change_requests',
        'match_lineup_change_members',
        'match_lineup_commands',
        'match_results',
        'match_result_commands'
      ]::text[])
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: migration 025 columns differ';
  end if;

  with expected(table_name, constraint_name, constraint_type) as (
    values
      ('match_lineups', 'match_lineups_pkey', 'p'),
      ('match_lineups', 'match_lineups_match_id_fkey', 'f'),
      ('match_lineups', 'match_lineups_status_check', 'c'),
      ('match_lineups', 'match_lineups_time_check', 'c'),
      ('match_lineups', 'match_lineups_version_check', 'c'),
      ('match_lineups', 'match_lineups_lifecycle_check', 'c'),
      ('match_lineup_assignments', 'match_lineup_assignments_pkey', 'p'),
      ('match_lineup_assignments', 'match_lineup_assignments_identity_key', 'u'),
      ('match_lineup_assignments', 'match_lineup_assignments_match_id_fkey', 'f'),
      ('match_lineup_assignments', 'match_lineup_assignments_account_id_fkey', 'f'),
      ('match_lineup_assignments', 'match_lineup_assignments_team_check', 'c'),
      ('match_lineup_assignments', 'match_lineup_assignments_side_check', 'c'),
      ('match_lineup_assignments', 'match_lineup_assignments_status_check', 'c'),
      ('match_lineup_assignments', 'match_lineup_assignments_time_check', 'c'),
      ('match_lineup_assignments', 'match_lineup_assignments_version_check', 'c'),
      ('match_lineup_assignments', 'match_lineup_assignments_lifecycle_check', 'c'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_pkey', 'p'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_identity_key', 'u'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_match_id_fkey', 'f'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_requester_fkey', 'f'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_base_version_check', 'c'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_status_check', 'c'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_time_check', 'c'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_version_check', 'c'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_lifecycle_check', 'c'),
      ('match_lineup_change_members', 'match_lineup_change_members_pkey', 'p'),
      ('match_lineup_change_members', 'match_lineup_change_members_from_slot_key', 'u'),
      ('match_lineup_change_members', 'match_lineup_change_members_to_slot_key', 'u'),
      ('match_lineup_change_members', 'match_lineup_change_members_request_binding_fkey', 'f'),
      ('match_lineup_change_members', 'match_lineup_change_members_account_id_fkey', 'f'),
      ('match_lineup_change_members', 'match_lineup_change_members_team_check', 'c'),
      ('match_lineup_change_members', 'match_lineup_change_members_side_check', 'c'),
      ('match_lineup_change_members', 'match_lineup_change_members_approval_check', 'c'),
      ('match_lineup_change_members', 'match_lineup_change_members_response_check', 'c'),
      ('match_lineup_commands', 'match_lineup_commands_pkey', 'p'),
      ('match_lineup_commands', 'match_lineup_commands_match_id_fkey', 'f'),
      ('match_lineup_commands', 'match_lineup_commands_actor_account_id_fkey', 'f'),
      ('match_lineup_commands', 'match_lineup_commands_assignment_binding_fkey', 'f'),
      ('match_lineup_commands', 'match_lineup_commands_request_binding_fkey', 'f'),
      ('match_lineup_commands', 'match_lineup_commands_request_digest_check', 'c'),
      ('match_lineup_commands', 'match_lineup_commands_applied_at_check', 'c'),
      ('match_lineup_commands', 'match_lineup_commands_lineup_version_check', 'c'),
      ('match_lineup_commands', 'match_lineup_commands_result_shape_check', 'c'),
      ('match_results', 'match_results_pkey', 'p'),
      ('match_results', 'match_results_match_id_key', 'u'),
      ('match_results', 'match_results_identity_key', 'u'),
      ('match_results', 'match_results_match_id_fkey', 'f'),
      ('match_results', 'match_results_team1_left_account_id_fkey', 'f'),
      ('match_results', 'match_results_team1_right_account_id_fkey', 'f'),
      ('match_results', 'match_results_team2_left_account_id_fkey', 'f'),
      ('match_results', 'match_results_team2_right_account_id_fkey', 'f'),
      ('match_results', 'match_results_submitted_by_account_id_fkey', 'f'),
      ('match_results', 'match_results_confirmed_by_account_id_fkey', 'f'),
      ('match_results', 'match_results_disputed_by_account_id_fkey', 'f'),
      ('match_results', 'match_results_lineup_version_check', 'c'),
      ('match_results', 'match_results_distinct_players_check', 'c'),
      ('match_results', 'match_results_set_shape_check', 'c'),
      ('match_results', 'match_results_winner_check', 'c'),
      ('match_results', 'match_results_actor_membership_check', 'c'),
      ('match_results', 'match_results_status_check', 'c'),
      ('match_results', 'match_results_time_check', 'c'),
      ('match_results', 'match_results_version_check', 'c'),
      ('match_results', 'match_results_lifecycle_check', 'c'),
      ('match_result_commands', 'match_result_commands_pkey', 'p'),
      ('match_result_commands', 'match_result_commands_result_binding_fkey', 'f'),
      ('match_result_commands', 'match_result_commands_actor_account_id_fkey', 'f'),
      ('match_result_commands', 'match_result_commands_request_digest_check', 'c'),
      ('match_result_commands', 'match_result_commands_applied_at_check', 'c'),
      ('match_result_commands', 'match_result_commands_version_check', 'c'),
      ('match_result_commands', 'match_result_commands_result_shape_check', 'c')
  ),
  actual as (
    select
      relation.relname::text,
      constraint_row.conname::text,
      constraint_row.contype::text
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class relation
      on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_match'
      and relation.relname = any (array[
        'match_lineups',
        'match_lineup_assignments',
        'match_lineup_change_requests',
        'match_lineup_change_members',
        'match_lineup_commands',
        'match_results',
        'match_result_commands'
      ]::text[])
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: migration 025 constraint allowlist differs';
  end if;

  with expected(
    table_name,
    constraint_name,
    constrained_columns,
    referenced_schema,
    referenced_table,
    referenced_columns
  ) as (
    values
      ('match_lineups', 'match_lineups_pkey', array['match_id'], null, null, null),
      ('match_lineups', 'match_lineups_match_id_fkey', array['match_id'], 'backend_match', 'matches', array['id']),
      ('match_lineup_assignments', 'match_lineup_assignments_pkey', array['id'], null, null, null),
      ('match_lineup_assignments', 'match_lineup_assignments_identity_key', array['id', 'match_id'], null, null, null),
      ('match_lineup_assignments', 'match_lineup_assignments_match_id_fkey', array['match_id'], 'backend_match', 'match_lineups', array['match_id']),
      ('match_lineup_assignments', 'match_lineup_assignments_account_id_fkey', array['account_id'], 'backend_auth', 'player_profiles', array['account_id']),
      ('match_lineup_change_requests', 'match_lineup_change_requests_pkey', array['id'], null, null, null),
      ('match_lineup_change_requests', 'match_lineup_change_requests_identity_key', array['id', 'match_id'], null, null, null),
      ('match_lineup_change_requests', 'match_lineup_change_requests_match_id_fkey', array['match_id'], 'backend_match', 'match_lineups', array['match_id']),
      ('match_lineup_change_requests', 'match_lineup_change_requests_requester_fkey', array['requested_by_account_id'], 'backend_auth', 'player_profiles', array['account_id']),
      ('match_lineup_change_members', 'match_lineup_change_members_pkey', array['request_id', 'account_id'], null, null, null),
      ('match_lineup_change_members', 'match_lineup_change_members_from_slot_key', array['request_id', 'from_team_number', 'from_court_side'], null, null, null),
      ('match_lineup_change_members', 'match_lineup_change_members_to_slot_key', array['request_id', 'to_team_number', 'to_court_side'], null, null, null),
      ('match_lineup_change_members', 'match_lineup_change_members_request_binding_fkey', array['request_id', 'match_id'], 'backend_match', 'match_lineup_change_requests', array['id', 'match_id']),
      ('match_lineup_change_members', 'match_lineup_change_members_account_id_fkey', array['account_id'], 'backend_auth', 'player_profiles', array['account_id']),
      ('match_lineup_commands', 'match_lineup_commands_pkey', array['command_id'], null, null, null),
      ('match_lineup_commands', 'match_lineup_commands_match_id_fkey', array['match_id'], 'backend_match', 'match_lineups', array['match_id']),
      ('match_lineup_commands', 'match_lineup_commands_actor_account_id_fkey', array['actor_account_id'], 'backend_auth', 'player_profiles', array['account_id']),
      ('match_lineup_commands', 'match_lineup_commands_assignment_binding_fkey', array['assignment_id', 'match_id'], 'backend_match', 'match_lineup_assignments', array['id', 'match_id']),
      ('match_lineup_commands', 'match_lineup_commands_request_binding_fkey', array['change_request_id', 'match_id'], 'backend_match', 'match_lineup_change_requests', array['id', 'match_id']),
      ('match_results', 'match_results_pkey', array['id'], null, null, null),
      ('match_results', 'match_results_match_id_key', array['match_id'], null, null, null),
      ('match_results', 'match_results_identity_key', array['id', 'match_id'], null, null, null),
      ('match_results', 'match_results_match_id_fkey', array['match_id'], 'backend_match', 'match_lineups', array['match_id']),
      ('match_results', 'match_results_team1_left_account_id_fkey', array['team1_left_account_id'], 'backend_auth', 'player_profiles', array['account_id']),
      ('match_results', 'match_results_team1_right_account_id_fkey', array['team1_right_account_id'], 'backend_auth', 'player_profiles', array['account_id']),
      ('match_results', 'match_results_team2_left_account_id_fkey', array['team2_left_account_id'], 'backend_auth', 'player_profiles', array['account_id']),
      ('match_results', 'match_results_team2_right_account_id_fkey', array['team2_right_account_id'], 'backend_auth', 'player_profiles', array['account_id']),
      ('match_results', 'match_results_submitted_by_account_id_fkey', array['submitted_by_account_id'], 'backend_auth', 'player_profiles', array['account_id']),
      ('match_results', 'match_results_confirmed_by_account_id_fkey', array['confirmed_by_account_id'], 'backend_auth', 'player_profiles', array['account_id']),
      ('match_results', 'match_results_disputed_by_account_id_fkey', array['disputed_by_account_id'], 'backend_auth', 'player_profiles', array['account_id']),
      ('match_result_commands', 'match_result_commands_pkey', array['command_id'], null, null, null),
      ('match_result_commands', 'match_result_commands_result_binding_fkey', array['result_id', 'match_id'], 'backend_match', 'match_results', array['id', 'match_id']),
      ('match_result_commands', 'match_result_commands_actor_account_id_fkey', array['actor_account_id'], 'backend_auth', 'player_profiles', array['account_id'])
  ),
  actual as (
    select
      relation.relname::text,
      constraint_row.conname::text,
      (
        select pg_catalog.array_agg(attribute.attname::text order by key_column.position)
        from pg_catalog.unnest(constraint_row.conkey)
          with ordinality key_column(attnum, position)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key_column.attnum
      ),
      referenced_namespace.nspname::text,
      referenced_relation.relname::text,
      (
        select pg_catalog.array_agg(attribute.attname::text order by key_column.position)
        from pg_catalog.unnest(constraint_row.confkey)
          with ordinality key_column(attnum, position)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.confrelid
         and attribute.attnum = key_column.attnum
      )
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class relation
      on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    left join pg_catalog.pg_class referenced_relation
      on referenced_relation.oid = constraint_row.confrelid
    left join pg_catalog.pg_namespace referenced_namespace
      on referenced_namespace.oid = referenced_relation.relnamespace
    where namespace.nspname = 'backend_match'
      and relation.relname = any (array[
        'match_lineups',
        'match_lineup_assignments',
        'match_lineup_change_requests',
        'match_lineup_change_members',
        'match_lineup_commands',
        'match_results',
        'match_result_commands'
      ]::text[])
      and constraint_row.contype in ('p', 'u', 'f')
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: migration 025 key constraints differ';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class relation
      on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_match'
      and relation.relname = any (array[
        'match_lineups',
        'match_lineup_assignments',
        'match_lineup_change_requests',
        'match_lineup_change_members',
        'match_lineup_commands',
        'match_results',
        'match_result_commands'
      ]::text[])
      and (
        constraint_row.condeferrable
        or constraint_row.condeferred
        or not constraint_row.convalidated
        or (
          constraint_row.contype = 'f'
          and (
            constraint_row.confupdtype <> 'a'
            or constraint_row.confdeltype <> 'a'
            or constraint_row.confmatchtype <> 's'
          )
        )
      )
  ) then
    raise exception 'POSTCHECK_FAILED: migration 025 constraint flags differ';
  end if;

  with expected(table_name, constraint_name, normalized_definition) as (
    values
      ('match_lineups', 'match_lineups_status_check', 'check (status = ''draft''::text or status = ''locked''::text)'),
      ('match_lineups', 'match_lineups_time_check', 'check (created_at >= 0 and created_at <= ''9007199254740991''::bigint and updated_at >= created_at and updated_at <= ''9007199254740991''::bigint and (locked_at is null or locked_at >= created_at and locked_at <= updated_at))'),
      ('match_lineups', 'match_lineups_version_check', 'check (version >= 1 and version <= ''9007199254740991''::bigint)'),
      ('match_lineups', 'match_lineups_lifecycle_check', 'check (status = ''draft''::text and locked_at is null or status = ''locked''::text and locked_at is not null)'),
      ('match_lineup_assignments', 'match_lineup_assignments_team_check', 'check (team_number = 1 or team_number = 2)'),
      ('match_lineup_assignments', 'match_lineup_assignments_side_check', 'check (court_side = ''left''::text or court_side = ''right''::text)'),
      ('match_lineup_assignments', 'match_lineup_assignments_status_check', 'check (status = ''active''::text or status = ''released''::text)'),
      ('match_lineup_assignments', 'match_lineup_assignments_time_check', 'check (assigned_at >= 0 and assigned_at <= ''9007199254740991''::bigint and updated_at >= assigned_at and updated_at <= ''9007199254740991''::bigint and (released_at is null or released_at >= assigned_at and released_at <= updated_at))'),
      ('match_lineup_assignments', 'match_lineup_assignments_version_check', 'check (version >= 1 and version <= ''9007199254740991''::bigint)'),
      ('match_lineup_assignments', 'match_lineup_assignments_lifecycle_check', 'check (status = ''active''::text and released_at is null or status = ''released''::text and released_at is not null)'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_base_version_check', 'check (base_lineup_version >= 1 and base_lineup_version <= ''9007199254740991''::bigint)'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_status_check', 'check (status = ''pending''::text or status = ''accepted''::text or status = ''rejected''::text or status = ''cancelled''::text or status = ''stale''::text)'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_time_check', 'check (created_at >= 0 and created_at <= ''9007199254740991''::bigint and updated_at >= created_at and updated_at <= ''9007199254740991''::bigint and (resolved_at is null or resolved_at >= created_at and resolved_at <= updated_at))'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_version_check', 'check (version >= 1 and version <= ''9007199254740991''::bigint)'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_lifecycle_check', 'check (status = ''pending''::text and resolved_at is null or status <> ''pending''::text and resolved_at is not null)'),
      ('match_lineup_change_members', 'match_lineup_change_members_team_check', 'check ((from_team_number = 1 or from_team_number = 2) and (to_team_number = 1 or to_team_number = 2))'),
      ('match_lineup_change_members', 'match_lineup_change_members_side_check', 'check ((from_court_side = ''left''::text or from_court_side = ''right''::text) and (to_court_side = ''left''::text or to_court_side = ''right''::text))'),
      ('match_lineup_change_members', 'match_lineup_change_members_approval_check', 'check (approval_status = ''pending''::text or approval_status = ''approved''::text or approval_status = ''rejected''::text)'),
      ('match_lineup_change_members', 'match_lineup_change_members_response_check', 'check (approval_status = ''pending''::text and responded_at is null or approval_status <> ''pending''::text and responded_at >= 0 and responded_at <= ''9007199254740991''::bigint)'),
      ('match_lineup_commands', 'match_lineup_commands_request_digest_check', 'check (octet_length(request_digest) = 32)'),
      ('match_lineup_commands', 'match_lineup_commands_applied_at_check', 'check (applied_at >= 0 and applied_at <= ''9007199254740991''::bigint)'),
      ('match_lineup_commands', 'match_lineup_commands_lineup_version_check', 'check (lineup_version >= 1 and lineup_version <= ''9007199254740991''::bigint)'),
      ('match_lineup_commands', 'match_lineup_commands_result_shape_check', 'check (command_type = ''claim_lineup_slot''::text and result_type = ''lineup_slot_claimed''::text and assignment_id is not null and change_request_id is null or command_type = ''release_lineup_slot''::text and result_type = ''lineup_slot_released''::text and assignment_id is not null and change_request_id is null or command_type = ''move_lineup_slot''::text and result_type = ''lineup_slot_moved''::text and assignment_id is not null and change_request_id is null or command_type = ''request_lineup_change''::text and result_type = ''lineup_change_requested''::text and assignment_id is null and change_request_id is not null or command_type = ''approve_lineup_change''::text and result_type = ''lineup_change_approved''::text and assignment_id is null and change_request_id is not null or command_type = ''reject_lineup_change''::text and result_type = ''lineup_change_rejected''::text and assignment_id is null and change_request_id is not null or command_type = ''cancel_lineup_change''::text and result_type = ''lineup_change_cancelled''::text and assignment_id is null and change_request_id is not null or command_type = ''lock_lineup''::text and result_type = ''lineup_locked''::text and assignment_id is null and change_request_id is null)'),
      ('match_results', 'match_results_lineup_version_check', 'check (lineup_version >= 1 and lineup_version <= ''9007199254740991''::bigint)'),
      ('match_results', 'match_results_distinct_players_check', 'check (team1_left_account_id <> team1_right_account_id and team1_left_account_id <> team2_left_account_id and team1_left_account_id <> team2_right_account_id and team1_right_account_id <> team2_left_account_id and team1_right_account_id <> team2_right_account_id and team2_left_account_id <> team2_right_account_id)'),
      ('match_results', 'match_results_set_shape_check', 'check (team1_set1_games >= 0 and team1_set1_games <= 7 and team2_set1_games >= 0 and team2_set1_games <= 7 and team1_set1_games <> team2_set1_games and (greatest(team1_set1_games, team2_set1_games) = 6 and least(team1_set1_games, team2_set1_games) >= 0 and least(team1_set1_games, team2_set1_games) <= 4 or greatest(team1_set1_games, team2_set1_games) = 7 and least(team1_set1_games, team2_set1_games) >= 5 and least(team1_set1_games, team2_set1_games) <= 6) and team1_set2_games >= 0 and team1_set2_games <= 7 and team2_set2_games >= 0 and team2_set2_games <= 7 and team1_set2_games <> team2_set2_games and (greatest(team1_set2_games, team2_set2_games) = 6 and least(team1_set2_games, team2_set2_games) >= 0 and least(team1_set2_games, team2_set2_games) <= 4 or greatest(team1_set2_games, team2_set2_games) = 7 and least(team1_set2_games, team2_set2_games) >= 5 and least(team1_set2_games, team2_set2_games) <= 6) and (team1_set3_games is null and team2_set3_games is null or team1_set3_games >= 0 and team1_set3_games <= 7 and team2_set3_games >= 0 and team2_set3_games <= 7 and team1_set3_games <> team2_set3_games and (greatest(team1_set3_games, team2_set3_games) = 6 and least(team1_set3_games, team2_set3_games) >= 0 and least(team1_set3_games, team2_set3_games) <= 4 or greatest(team1_set3_games, team2_set3_games) = 7 and least(team1_set3_games, team2_set3_games) >= 5 and least(team1_set3_games, team2_set3_games) <= 6)) and ((team1_set1_games > team2_set1_games and team1_set2_games > team2_set2_games or team2_set1_games > team1_set1_games and team2_set2_games > team1_set2_games) and team1_set3_games is null and team2_set3_games is null or (team1_set1_games > team2_set1_games and team2_set2_games > team1_set2_games or team2_set1_games > team1_set1_games and team1_set2_games > team2_set2_games) and team1_set3_games is not null and team2_set3_games is not null))'),
      ('match_results', 'match_results_winner_check', 'check (winning_team = 1 and ( case when team1_set1_games > team2_set1_games then 1 else 0 end + case when team1_set2_games > team2_set2_games then 1 else 0 end + case when team1_set3_games > team2_set3_games then 1 else 0 end) = 2 or winning_team = 2 and ( case when team2_set1_games > team1_set1_games then 1 else 0 end + case when team2_set2_games > team1_set2_games then 1 else 0 end + case when team2_set3_games > team1_set3_games then 1 else 0 end) = 2)'),
      ('match_results', 'match_results_actor_membership_check', 'check (submitted_by_account_id = team1_left_account_id or submitted_by_account_id = team1_right_account_id or submitted_by_account_id = team2_left_account_id or submitted_by_account_id = team2_right_account_id)'),
      ('match_results', 'match_results_status_check', 'check (status = ''submitted''::text or status = ''confirmed''::text or status = ''disputed''::text)'),
      ('match_results', 'match_results_time_check', 'check (submitted_at >= 0 and submitted_at <= ''9007199254740991''::bigint and (confirmed_at is null or confirmed_at >= submitted_at and confirmed_at <= ''9007199254740991''::bigint) and (disputed_at is null or disputed_at >= submitted_at and disputed_at <= ''9007199254740991''::bigint))'),
      ('match_results', 'match_results_version_check', 'check (version >= 1 and version <= ''9007199254740991''::bigint)'),
      ('match_results', 'match_results_lifecycle_check', 'check (status = ''submitted''::text and confirmed_by_account_id is null and confirmed_at is null and disputed_by_account_id is null and disputed_at is null or status = ''confirmed''::text and confirmed_by_account_id is not null and confirmed_at is not null and disputed_by_account_id is null and disputed_at is null and ((submitted_by_account_id = team1_left_account_id or submitted_by_account_id = team1_right_account_id) and (confirmed_by_account_id = team2_left_account_id or confirmed_by_account_id = team2_right_account_id) or (submitted_by_account_id = team2_left_account_id or submitted_by_account_id = team2_right_account_id) and (confirmed_by_account_id = team1_left_account_id or confirmed_by_account_id = team1_right_account_id)) or status = ''disputed''::text and confirmed_by_account_id is null and confirmed_at is null and disputed_by_account_id is not null and disputed_at is not null and (disputed_by_account_id = team1_left_account_id or disputed_by_account_id = team1_right_account_id or disputed_by_account_id = team2_left_account_id or disputed_by_account_id = team2_right_account_id) and disputed_by_account_id <> submitted_by_account_id)'),
      ('match_result_commands', 'match_result_commands_request_digest_check', 'check (octet_length(request_digest) = 32)'),
      ('match_result_commands', 'match_result_commands_applied_at_check', 'check (applied_at >= 0 and applied_at <= ''9007199254740991''::bigint)'),
      ('match_result_commands', 'match_result_commands_version_check', 'check (result_version >= 1 and result_version <= ''9007199254740991''::bigint)'),
      ('match_result_commands', 'match_result_commands_result_shape_check', 'check (command_type = ''submit_result''::text and result_type = ''result_submitted''::text and result_status = ''submitted''::text or command_type = ''confirm_result''::text and result_type = ''result_confirmed''::text and result_status = ''confirmed''::text or command_type = ''dispute_result''::text and result_type = ''result_disputed''::text and result_status = ''disputed''::text)')
  ),
  actual as (
    select
      relation.relname::text,
      constraint_row.conname::text,
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.lower(
            pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
          ),
          '[[:space:]]+',
          ' ',
          'g'
        )
      )
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class relation
      on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_match'
      and relation.relname = any (array[
        'match_lineups',
        'match_lineup_assignments',
        'match_lineup_change_requests',
        'match_lineup_change_members',
        'match_lineup_commands',
        'match_results',
        'match_result_commands'
      ]::text[])
      and constraint_row.contype = 'c'
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: migration 025 CHECK definitions differ';
  end if;

  with expected(
    table_name,
    index_name,
    access_method,
    is_unique,
    is_primary,
    indexed_columns,
    ordering_options,
    normalized_predicate
  ) as (
    values
      ('match_lineups', 'match_lineups_pkey', 'btree', true, true, array['match_id'], '0', null),
      ('match_lineups', 'match_lineups_status_updated_idx', 'btree', false, false, array['status', 'updated_at', 'match_id'], '0 0 0', null),
      ('match_lineup_assignments', 'match_lineup_assignments_pkey', 'btree', true, true, array['id'], '0', null),
      ('match_lineup_assignments', 'match_lineup_assignments_identity_key', 'btree', true, false, array['id', 'match_id'], '0 0', null),
      ('match_lineup_assignments', 'match_lineup_assignments_active_slot_key', 'btree', true, false, array['match_id', 'team_number', 'court_side'], '0 0 0', 'status = ''active''::text'),
      ('match_lineup_assignments', 'match_lineup_assignments_active_account_key', 'btree', true, false, array['match_id', 'account_id'], '0 0', 'status = ''active''::text'),
      ('match_lineup_assignments', 'match_lineup_assignments_match_history_idx', 'btree', false, false, array['match_id', 'assigned_at', 'id'], '0 0 0', null),
      ('match_lineup_assignments', 'match_lineup_assignments_account_history_idx', 'btree', false, false, array['account_id', 'assigned_at', 'id'], '0 3 0', null),
      ('match_lineup_change_requests', 'match_lineup_change_requests_pkey', 'btree', true, true, array['id'], '0', null),
      ('match_lineup_change_requests', 'match_lineup_change_requests_identity_key', 'btree', true, false, array['id', 'match_id'], '0 0', null),
      ('match_lineup_change_requests', 'match_lineup_change_requests_one_pending_match', 'btree', true, false, array['match_id'], '0', 'status = ''pending''::text'),
      ('match_lineup_change_requests', 'match_lineup_change_requests_match_history_idx', 'btree', false, false, array['match_id', 'created_at', 'id'], '0 0 0', null),
      ('match_lineup_change_requests', 'match_lineup_change_requests_requester_history_idx', 'btree', false, false, array['requested_by_account_id', 'created_at', 'id'], '0 3 0', null),
      ('match_lineup_change_members', 'match_lineup_change_members_pkey', 'btree', true, true, array['request_id', 'account_id'], '0 0', null),
      ('match_lineup_change_members', 'match_lineup_change_members_from_slot_key', 'btree', true, false, array['request_id', 'from_team_number', 'from_court_side'], '0 0 0', null),
      ('match_lineup_change_members', 'match_lineup_change_members_to_slot_key', 'btree', true, false, array['request_id', 'to_team_number', 'to_court_side'], '0 0 0', null),
      ('match_lineup_change_members', 'match_lineup_change_members_pending_account_idx', 'btree', false, false, array['account_id', 'request_id'], '0 0', 'approval_status = ''pending''::text'),
      ('match_lineup_change_members', 'match_lineup_change_members_account_history_idx', 'btree', false, false, array['account_id', 'request_id'], '0 0', null),
      ('match_lineup_commands', 'match_lineup_commands_pkey', 'btree', true, true, array['command_id'], '0', null),
      ('match_lineup_commands', 'match_lineup_commands_actor_applied_idx', 'btree', false, false, array['actor_account_id', 'applied_at', 'command_id'], '0 0 0', null),
      ('match_lineup_commands', 'match_lineup_commands_match_applied_idx', 'btree', false, false, array['match_id', 'applied_at', 'command_id'], '0 0 0', null),
      ('match_lineup_commands', 'match_lineup_commands_assignment_id_idx', 'btree', false, false, array['assignment_id'], '0', 'assignment_id is not null'),
      ('match_lineup_commands', 'match_lineup_commands_change_request_id_idx', 'btree', false, false, array['change_request_id'], '0', 'change_request_id is not null'),
      ('match_results', 'match_results_pkey', 'btree', true, true, array['id'], '0', null),
      ('match_results', 'match_results_match_id_key', 'btree', true, false, array['match_id'], '0', null),
      ('match_results', 'match_results_identity_key', 'btree', true, false, array['id', 'match_id'], '0 0', null),
      ('match_results', 'match_results_status_submitted_idx', 'btree', false, false, array['status', 'submitted_at', 'match_id'], '0 0 0', null),
      ('match_results', 'match_results_team1_left_account_idx', 'btree', false, false, array['team1_left_account_id', 'submitted_at', 'id'], '0 0 0', null),
      ('match_results', 'match_results_team1_right_account_idx', 'btree', false, false, array['team1_right_account_id', 'submitted_at', 'id'], '0 0 0', null),
      ('match_results', 'match_results_team2_left_account_idx', 'btree', false, false, array['team2_left_account_id', 'submitted_at', 'id'], '0 0 0', null),
      ('match_results', 'match_results_team2_right_account_idx', 'btree', false, false, array['team2_right_account_id', 'submitted_at', 'id'], '0 0 0', null),
      ('match_results', 'match_results_submitted_by_account_idx', 'btree', false, false, array['submitted_by_account_id', 'submitted_at', 'id'], '0 0 0', null),
      ('match_results', 'match_results_confirmed_by_account_idx', 'btree', false, false, array['confirmed_by_account_id', 'confirmed_at', 'id'], '0 0 0', 'confirmed_by_account_id is not null'),
      ('match_results', 'match_results_disputed_by_account_idx', 'btree', false, false, array['disputed_by_account_id', 'disputed_at', 'id'], '0 0 0', 'disputed_by_account_id is not null'),
      ('match_result_commands', 'match_result_commands_pkey', 'btree', true, true, array['command_id'], '0', null),
      ('match_result_commands', 'match_result_commands_actor_applied_idx', 'btree', false, false, array['actor_account_id', 'applied_at', 'command_id'], '0 0 0', null),
      ('match_result_commands', 'match_result_commands_result_applied_idx', 'btree', false, false, array['result_id', 'applied_at', 'command_id'], '0 0 0', null)
  ),
  actual as (
    select
      relation.relname::text,
      index_relation.relname::text,
      access_method.amname::text,
      index_row.indisunique,
      index_row.indisprimary,
      (
        select pg_catalog.array_agg(
          pg_catalog.pg_get_indexdef(index_row.indexrelid, position, true)
          order by position
        )
        from pg_catalog.generate_series(1, index_row.indnkeyatts) position
      ),
      index_row.indoption::text,
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.lower(
            pg_catalog.pg_get_expr(
              index_row.indpred,
              index_row.indrelid,
              true
            )
          ),
          '[[:space:]]+',
          ' ',
          'g'
        )
      )
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class relation
      on relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where namespace.nspname = 'backend_match'
      and relation.relname = any (array[
        'match_lineups',
        'match_lineup_assignments',
        'match_lineup_change_requests',
        'match_lineup_change_members',
        'match_lineup_commands',
        'match_results',
        'match_result_commands'
      ]::text[])
      and index_row.indisvalid
      and index_row.indisready
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: migration 025 index allowlist differs';
  end if;

  with expected(
    schema_name,
    table_name,
    grantor,
    grantee,
    privilege_type,
    is_grantable
  ) as (
    values
      ('backend_match', 'match_lineups', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
      ('backend_match', 'match_lineup_assignments', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
      ('backend_match', 'match_lineup_change_requests', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
      ('backend_match', 'match_lineup_change_members', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
      ('backend_match', 'match_lineup_commands', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
      ('backend_match', 'match_results', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
      ('backend_match', 'match_result_commands', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false)
  ),
  actual as (
    select
      namespace.nspname::text,
      relation.relname::text,
      grantor.rolname::text,
      case
        when acl.grantee = 0 then 'PUBLIC'::text
        else grantee.rolname::text
      end,
      acl.privilege_type::text,
      acl.is_grantable
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) acl
    join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
    left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where namespace.nspname = 'backend_match'
      and relation.relname = any (array[
        'match_lineups',
        'match_lineup_assignments',
        'match_lineup_change_requests',
        'match_lineup_change_members',
        'match_lineup_commands',
        'match_results',
        'match_result_commands'
      ]::text[])
      and acl.grantee <> relation.relowner
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: migration 025 table ACL differs';
  end if;

  with grant_contract(table_name, privilege_type, column_names) as (
    values
      ('match_lineups', 'INSERT', array['match_id', 'status', 'created_at', 'updated_at', 'version']),
      ('match_lineups', 'UPDATE', array['status', 'updated_at', 'locked_at', 'version']),
      ('match_lineup_assignments', 'INSERT', array['id', 'match_id', 'account_id', 'team_number', 'court_side', 'status', 'assigned_at', 'updated_at', 'version']),
      ('match_lineup_assignments', 'UPDATE', array['status', 'updated_at', 'released_at', 'version']),
      ('match_lineup_change_requests', 'INSERT', array['id', 'match_id', 'requested_by_account_id', 'base_lineup_version', 'status', 'created_at', 'updated_at', 'version']),
      ('match_lineup_change_requests', 'UPDATE', array['status', 'updated_at', 'resolved_at', 'version']),
      ('match_lineup_change_members', 'INSERT', array['request_id', 'match_id', 'account_id', 'from_team_number', 'from_court_side', 'to_team_number', 'to_court_side', 'approval_status', 'responded_at']),
      ('match_lineup_change_members', 'UPDATE', array['approval_status', 'responded_at']),
      ('match_lineup_commands', 'INSERT', array['command_id', 'match_id', 'actor_account_id', 'request_digest', 'command_type', 'result_type', 'applied_at', 'lineup_version', 'assignment_id', 'change_request_id']),
      ('match_results', 'INSERT', array['id', 'match_id', 'lineup_version', 'team1_left_account_id', 'team1_right_account_id', 'team2_left_account_id', 'team2_right_account_id', 'team1_set1_games', 'team2_set1_games', 'team1_set2_games', 'team2_set2_games', 'team1_set3_games', 'team2_set3_games', 'winning_team', 'status', 'submitted_by_account_id', 'submitted_at', 'version']),
      ('match_results', 'UPDATE', array['status', 'confirmed_by_account_id', 'confirmed_at', 'disputed_by_account_id', 'disputed_at', 'version']),
      ('match_result_commands', 'INSERT', array['command_id', 'result_id', 'match_id', 'actor_account_id', 'request_digest', 'command_type', 'result_type', 'applied_at', 'result_status', 'result_version'])
  ),
  expected as (
    select
      'backend_match'::text,
      contract.table_name::text,
      column_name::text,
      'backend_auth_owner'::text,
      'backend_auth_app'::text,
      contract.privilege_type::text,
      false
    from grant_contract contract
    cross join lateral pg_catalog.unnest(contract.column_names) column_name
  ),
  actual as (
    select
      namespace.nspname::text,
      relation.relname::text,
      attribute.attname::text,
      grantor.rolname::text,
      case
        when acl.grantee = 0 then 'PUBLIC'::text
        else grantee.rolname::text
      end,
      acl.privilege_type::text,
      acl.is_grantable
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation
      on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
    join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
    left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where namespace.nspname = 'backend_match'
      and relation.relname = any (array[
        'match_lineups',
        'match_lineup_assignments',
        'match_lineup_change_requests',
        'match_lineup_change_members',
        'match_lineup_commands',
        'match_results',
        'match_result_commands'
      ]::text[])
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: migration 025 column ACL differs';
  end if;

  if pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'CREATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_auth.player_rating_states',
       'UPDATE'
     )
     or exists (
       select 1
       from pg_catalog.pg_class relation
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
         and relation.relname = any (array[
           'match_lineups',
           'match_lineup_assignments',
           'match_lineup_change_requests',
           'match_lineup_change_members',
           'match_lineup_commands',
           'match_results',
           'match_result_commands'
         ]::text[])
         and (
           pg_catalog.has_table_privilege(
             'backend_auth_app',
             relation.oid,
             'DELETE'
           )
           or pg_catalog.has_table_privilege(
             'backend_auth_app',
             relation.oid,
             'TRUNCATE'
           )
           or pg_catalog.has_table_privilege(
             'backend_auth_app',
             relation.oid,
             'REFERENCES'
           )
           or pg_catalog.has_table_privilege(
             'backend_auth_app',
             relation.oid,
             'TRIGGER'
           )
         )
     ) then
    raise exception 'POSTCHECK_FAILED: migration 025 runtime privilege boundary differs';
  end if;

  if exists (select 1 from backend_match.match_lineups)
     or exists (select 1 from backend_match.match_lineup_assignments)
     or exists (select 1 from backend_match.match_lineup_change_requests)
     or exists (select 1 from backend_match.match_lineup_change_members)
     or exists (select 1 from backend_match.match_lineup_commands)
     or exists (select 1 from backend_match.match_results)
     or exists (select 1 from backend_match.match_result_commands) then
    raise exception 'POSTCHECK_FAILED: migration 025 relations are not empty';
  end if;
end;
$postcheck$;

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
    ),
    'match_lineups', (
      select pg_catalog.count(*) from backend_match.match_lineups
    ),
    'match_lineup_assignments', (
      select pg_catalog.count(*)
      from backend_match.match_lineup_assignments
    ),
    'match_lineup_change_requests', (
      select pg_catalog.count(*)
      from backend_match.match_lineup_change_requests
    ),
    'match_lineup_change_members', (
      select pg_catalog.count(*)
      from backend_match.match_lineup_change_members
    ),
    'match_lineup_commands', (
      select pg_catalog.count(*) from backend_match.match_lineup_commands
    ),
    'match_results', (
      select pg_catalog.count(*) from backend_match.match_results
    ),
    'match_result_commands', (
      select pg_catalog.count(*) from backend_match.match_result_commands
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
    ),
    'match_lineups', backend_auth.relation_fingerprint(
      'backend_match.match_lineups'::pg_catalog.regclass
    ),
    'match_lineup_assignments', backend_auth.relation_fingerprint(
      'backend_match.match_lineup_assignments'::pg_catalog.regclass
    ),
    'match_lineup_change_requests', backend_auth.relation_fingerprint(
      'backend_match.match_lineup_change_requests'::pg_catalog.regclass
    ),
    'match_lineup_change_members', backend_auth.relation_fingerprint(
      'backend_match.match_lineup_change_members'::pg_catalog.regclass
    ),
    'match_lineup_commands', backend_auth.relation_fingerprint(
      'backend_match.match_lineup_commands'::pg_catalog.regclass
    ),
    'match_results', backend_auth.relation_fingerprint(
      'backend_match.match_results'::pg_catalog.regclass
    ),
    'match_result_commands', backend_auth.relation_fingerprint(
      'backend_match.match_result_commands'::pg_catalog.regclass
    )
  )
) as backend_match_lineups_results_postcheck;

rollback;
