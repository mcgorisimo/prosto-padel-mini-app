-- 025_backend_match_lineups_results.sql
-- Adds backend-owned pair/side assignments, consented lineup changes, and
-- immutable score/result state. This migration does not calculate ratings.
-- Apply manually only after PRECHECK succeeds.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_table text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
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
     or v_owner.rolbypassrls
     or v_app.rolname is null
     or not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'MIGRATION_PRECONDITION_FAILED: required role attributes are unsafe';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
     or pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: role membership boundary differs';
  end if;

  if pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.to_regclass('backend_match.matches') is null
     or pg_catalog.to_regclass('backend_match.match_participants') is null
     or pg_catalog.to_regclass('backend_match.match_commands') is null
     or pg_catalog.to_regclass('backend_auth.player_profiles') is null
     or pg_catalog.to_regclass('backend_auth.player_rating_states') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: required backend relations are missing';
  end if;

  if pg_catalog.pg_get_userbyid(
       (
         select namespace.nspowner
         from pg_catalog.pg_namespace namespace
         where namespace.nspname = 'backend_match'
       )
     ) <> 'backend_auth_owner'
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: schema privilege boundary differs';
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
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          '023_backend_match_description_updates:'
            || backend_auth.relation_fingerprint(
              relation.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'MIGRATION_PRECONDITION_FAILED: backend_match.% differs from migration 023',
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
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(relation.oid, 'pg_class') =
        '020_backend_match_storage:'
          || backend_auth.relation_fingerprint(
            relation.oid::pg_catalog.regclass
          )
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_match.match_participants differs from migration 020';
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
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth.player_profiles differs from migration 015';
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
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth.player_rating_states differs from migration 019';
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
    raise exception 'MIGRATION_CONFLICT: migration 025 target object already exists';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_match.match_lineups (
  match_id uuid not null,
  status text not null,
  created_at bigint not null,
  updated_at bigint not null,
  locked_at bigint,
  version bigint not null,
  constraint match_lineups_pkey primary key (match_id),
  constraint match_lineups_match_id_fkey foreign key (match_id)
    references backend_match.matches (id)
    on update no action on delete no action not deferrable,
  constraint match_lineups_status_check check (
    status = 'draft' or status = 'locked'
  ),
  constraint match_lineups_time_check check (
    created_at between 0 and 9007199254740991
    and updated_at between created_at and 9007199254740991
    and (
      locked_at is null
      or locked_at between created_at and updated_at
    )
  ),
  constraint match_lineups_version_check check (
    version between 1 and 9007199254740991
  ),
  constraint match_lineups_lifecycle_check check (
    (status = 'draft' and locked_at is null)
    or (status = 'locked' and locked_at is not null)
  )
);

create index match_lineups_status_updated_idx
  on backend_match.match_lineups (status, updated_at, match_id);

create table backend_match.match_lineup_assignments (
  id uuid not null,
  match_id uuid not null,
  account_id uuid not null,
  team_number smallint not null,
  court_side text not null,
  status text not null,
  assigned_at bigint not null,
  updated_at bigint not null,
  released_at bigint,
  version bigint not null,
  constraint match_lineup_assignments_pkey primary key (id),
  constraint match_lineup_assignments_identity_key unique (id, match_id),
  constraint match_lineup_assignments_match_id_fkey foreign key (match_id)
    references backend_match.match_lineups (match_id)
    on update no action on delete no action not deferrable,
  constraint match_lineup_assignments_account_id_fkey foreign key (account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_lineup_assignments_team_check check (
    team_number = 1 or team_number = 2
  ),
  constraint match_lineup_assignments_side_check check (
    court_side = 'left' or court_side = 'right'
  ),
  constraint match_lineup_assignments_status_check check (
    status = 'active' or status = 'released'
  ),
  constraint match_lineup_assignments_time_check check (
    assigned_at between 0 and 9007199254740991
    and updated_at between assigned_at and 9007199254740991
    and (
      released_at is null
      or released_at between assigned_at and updated_at
    )
  ),
  constraint match_lineup_assignments_version_check check (
    version between 1 and 9007199254740991
  ),
  constraint match_lineup_assignments_lifecycle_check check (
    (status = 'active' and released_at is null)
    or (status = 'released' and released_at is not null)
  )
);

create unique index match_lineup_assignments_active_slot_key
  on backend_match.match_lineup_assignments (
    match_id,
    team_number,
    court_side
  )
  where status = 'active';

create unique index match_lineup_assignments_active_account_key
  on backend_match.match_lineup_assignments (match_id, account_id)
  where status = 'active';

create index match_lineup_assignments_match_history_idx
  on backend_match.match_lineup_assignments (
    match_id,
    assigned_at,
    id
  );

create index match_lineup_assignments_account_history_idx
  on backend_match.match_lineup_assignments (
    account_id,
    assigned_at desc,
    id
  );

create table backend_match.match_lineup_change_requests (
  id uuid not null,
  match_id uuid not null,
  requested_by_account_id uuid not null,
  base_lineup_version bigint not null,
  status text not null,
  created_at bigint not null,
  updated_at bigint not null,
  resolved_at bigint,
  version bigint not null,
  constraint match_lineup_change_requests_pkey primary key (id),
  constraint match_lineup_change_requests_identity_key unique (id, match_id),
  constraint match_lineup_change_requests_match_id_fkey foreign key (match_id)
    references backend_match.match_lineups (match_id)
    on update no action on delete no action not deferrable,
  constraint match_lineup_change_requests_requester_fkey
    foreign key (requested_by_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_lineup_change_requests_base_version_check check (
    base_lineup_version between 1 and 9007199254740991
  ),
  constraint match_lineup_change_requests_status_check check (
    status = 'pending'
    or status = 'accepted'
    or status = 'rejected'
    or status = 'cancelled'
    or status = 'stale'
  ),
  constraint match_lineup_change_requests_time_check check (
    created_at between 0 and 9007199254740991
    and updated_at between created_at and 9007199254740991
    and (
      resolved_at is null
      or resolved_at between created_at and updated_at
    )
  ),
  constraint match_lineup_change_requests_version_check check (
    version between 1 and 9007199254740991
  ),
  constraint match_lineup_change_requests_lifecycle_check check (
    (status = 'pending' and resolved_at is null)
    or (status <> 'pending' and resolved_at is not null)
  )
);

create unique index match_lineup_change_requests_one_pending_match
  on backend_match.match_lineup_change_requests (match_id)
  where status = 'pending';

create index match_lineup_change_requests_match_history_idx
  on backend_match.match_lineup_change_requests (
    match_id,
    created_at,
    id
  );

create index match_lineup_change_requests_requester_history_idx
  on backend_match.match_lineup_change_requests (
    requested_by_account_id,
    created_at desc,
    id
  );

create table backend_match.match_lineup_change_members (
  request_id uuid not null,
  match_id uuid not null,
  account_id uuid not null,
  from_team_number smallint not null,
  from_court_side text not null,
  to_team_number smallint not null,
  to_court_side text not null,
  approval_status text not null,
  responded_at bigint,
  constraint match_lineup_change_members_pkey primary key (
    request_id,
    account_id
  ),
  constraint match_lineup_change_members_from_slot_key unique (
    request_id,
    from_team_number,
    from_court_side
  ),
  constraint match_lineup_change_members_to_slot_key unique (
    request_id,
    to_team_number,
    to_court_side
  ),
  constraint match_lineup_change_members_request_binding_fkey
    foreign key (request_id, match_id)
    references backend_match.match_lineup_change_requests (id, match_id)
    on update no action on delete no action not deferrable,
  constraint match_lineup_change_members_account_id_fkey
    foreign key (account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_lineup_change_members_team_check check (
    (from_team_number = 1 or from_team_number = 2)
    and (to_team_number = 1 or to_team_number = 2)
  ),
  constraint match_lineup_change_members_side_check check (
    (from_court_side = 'left' or from_court_side = 'right')
    and (to_court_side = 'left' or to_court_side = 'right')
  ),
  constraint match_lineup_change_members_approval_check check (
    approval_status = 'pending'
    or approval_status = 'approved'
    or approval_status = 'rejected'
  ),
  constraint match_lineup_change_members_response_check check (
    (approval_status = 'pending' and responded_at is null)
    or (
      approval_status <> 'pending'
      and responded_at between 0 and 9007199254740991
    )
  )
);

create index match_lineup_change_members_pending_account_idx
  on backend_match.match_lineup_change_members (account_id, request_id)
  where approval_status = 'pending';

create index match_lineup_change_members_account_history_idx
  on backend_match.match_lineup_change_members (account_id, request_id);

create table backend_match.match_lineup_commands (
  command_id uuid not null,
  match_id uuid not null,
  actor_account_id uuid not null,
  request_digest bytea not null,
  command_type text not null,
  result_type text not null,
  applied_at bigint not null,
  lineup_version bigint not null,
  assignment_id uuid,
  change_request_id uuid,
  constraint match_lineup_commands_pkey primary key (command_id),
  constraint match_lineup_commands_match_id_fkey foreign key (match_id)
    references backend_match.match_lineups (match_id)
    on update no action on delete no action not deferrable,
  constraint match_lineup_commands_actor_account_id_fkey
    foreign key (actor_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_lineup_commands_assignment_binding_fkey
    foreign key (assignment_id, match_id)
    references backend_match.match_lineup_assignments (id, match_id)
    on update no action on delete no action not deferrable,
  constraint match_lineup_commands_request_binding_fkey
    foreign key (change_request_id, match_id)
    references backend_match.match_lineup_change_requests (id, match_id)
    on update no action on delete no action not deferrable,
  constraint match_lineup_commands_request_digest_check check (
    pg_catalog.octet_length(request_digest) = 32
  ),
  constraint match_lineup_commands_applied_at_check check (
    applied_at between 0 and 9007199254740991
  ),
  constraint match_lineup_commands_lineup_version_check check (
    lineup_version between 1 and 9007199254740991
  ),
  constraint match_lineup_commands_result_shape_check check (
    (
      command_type = 'claim_lineup_slot'
      and result_type = 'lineup_slot_claimed'
      and assignment_id is not null
      and change_request_id is null
    )
    or (
      command_type = 'release_lineup_slot'
      and result_type = 'lineup_slot_released'
      and assignment_id is not null
      and change_request_id is null
    )
    or (
      command_type = 'move_lineup_slot'
      and result_type = 'lineup_slot_moved'
      and assignment_id is not null
      and change_request_id is null
    )
    or (
      command_type = 'request_lineup_change'
      and result_type = 'lineup_change_requested'
      and assignment_id is null
      and change_request_id is not null
    )
    or (
      command_type = 'approve_lineup_change'
      and result_type = 'lineup_change_approved'
      and assignment_id is null
      and change_request_id is not null
    )
    or (
      command_type = 'reject_lineup_change'
      and result_type = 'lineup_change_rejected'
      and assignment_id is null
      and change_request_id is not null
    )
    or (
      command_type = 'cancel_lineup_change'
      and result_type = 'lineup_change_cancelled'
      and assignment_id is null
      and change_request_id is not null
    )
    or (
      command_type = 'lock_lineup'
      and result_type = 'lineup_locked'
      and assignment_id is null
      and change_request_id is null
    )
  )
);

create index match_lineup_commands_actor_applied_idx
  on backend_match.match_lineup_commands (
    actor_account_id,
    applied_at,
    command_id
  );

create index match_lineup_commands_match_applied_idx
  on backend_match.match_lineup_commands (
    match_id,
    applied_at,
    command_id
  );

create index match_lineup_commands_assignment_id_idx
  on backend_match.match_lineup_commands (assignment_id)
  where assignment_id is not null;

create index match_lineup_commands_change_request_id_idx
  on backend_match.match_lineup_commands (change_request_id)
  where change_request_id is not null;

create table backend_match.match_results (
  id uuid not null,
  match_id uuid not null,
  lineup_version bigint not null,
  team1_left_account_id uuid not null,
  team1_right_account_id uuid not null,
  team2_left_account_id uuid not null,
  team2_right_account_id uuid not null,
  team1_set1_games smallint not null,
  team2_set1_games smallint not null,
  team1_set2_games smallint not null,
  team2_set2_games smallint not null,
  team1_set3_games smallint,
  team2_set3_games smallint,
  winning_team smallint not null,
  status text not null,
  submitted_by_account_id uuid not null,
  submitted_at bigint not null,
  confirmed_by_account_id uuid,
  confirmed_at bigint,
  disputed_by_account_id uuid,
  disputed_at bigint,
  version bigint not null,
  constraint match_results_pkey primary key (id),
  constraint match_results_match_id_key unique (match_id),
  constraint match_results_identity_key unique (id, match_id),
  constraint match_results_match_id_fkey foreign key (match_id)
    references backend_match.match_lineups (match_id)
    on update no action on delete no action not deferrable,
  constraint match_results_team1_left_account_id_fkey
    foreign key (team1_left_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_results_team1_right_account_id_fkey
    foreign key (team1_right_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_results_team2_left_account_id_fkey
    foreign key (team2_left_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_results_team2_right_account_id_fkey
    foreign key (team2_right_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_results_submitted_by_account_id_fkey
    foreign key (submitted_by_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_results_confirmed_by_account_id_fkey
    foreign key (confirmed_by_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_results_disputed_by_account_id_fkey
    foreign key (disputed_by_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_results_lineup_version_check check (
    lineup_version between 1 and 9007199254740991
  ),
  constraint match_results_distinct_players_check check (
    team1_left_account_id <> team1_right_account_id
    and team1_left_account_id <> team2_left_account_id
    and team1_left_account_id <> team2_right_account_id
    and team1_right_account_id <> team2_left_account_id
    and team1_right_account_id <> team2_right_account_id
    and team2_left_account_id <> team2_right_account_id
  ),
  constraint match_results_set_shape_check check (
    (
      team1_set1_games between 0 and 7
      and team2_set1_games between 0 and 7
      and team1_set1_games <> team2_set1_games
      and (
        (greatest(team1_set1_games, team2_set1_games) = 6
          and least(team1_set1_games, team2_set1_games) between 0 and 4)
        or (greatest(team1_set1_games, team2_set1_games) = 7
          and least(team1_set1_games, team2_set1_games) between 5 and 6)
      )
    )
    and (
      team1_set2_games between 0 and 7
      and team2_set2_games between 0 and 7
      and team1_set2_games <> team2_set2_games
      and (
        (greatest(team1_set2_games, team2_set2_games) = 6
          and least(team1_set2_games, team2_set2_games) between 0 and 4)
        or (greatest(team1_set2_games, team2_set2_games) = 7
          and least(team1_set2_games, team2_set2_games) between 5 and 6)
      )
    )
    and (
      (team1_set3_games is null and team2_set3_games is null)
      or (
        team1_set3_games between 0 and 7
        and team2_set3_games between 0 and 7
        and team1_set3_games <> team2_set3_games
        and (
          (greatest(team1_set3_games, team2_set3_games) = 6
            and least(team1_set3_games, team2_set3_games) between 0 and 4)
          or (greatest(team1_set3_games, team2_set3_games) = 7
            and least(team1_set3_games, team2_set3_games) between 5 and 6)
        )
      )
    )
    and (
      (
        (
          team1_set1_games > team2_set1_games
          and team1_set2_games > team2_set2_games
        )
        or (
          team2_set1_games > team1_set1_games
          and team2_set2_games > team1_set2_games
        )
      )
      and team1_set3_games is null
      and team2_set3_games is null
      or (
        (
          team1_set1_games > team2_set1_games
          and team2_set2_games > team1_set2_games
        )
        or (
          team2_set1_games > team1_set1_games
          and team1_set2_games > team2_set2_games
        )
      )
      and team1_set3_games is not null
      and team2_set3_games is not null
    )
  ),
  constraint match_results_winner_check check (
    (
      winning_team = 1
      and (
        case when team1_set1_games > team2_set1_games then 1 else 0 end
        + case when team1_set2_games > team2_set2_games then 1 else 0 end
        + case when team1_set3_games > team2_set3_games then 1 else 0 end
      ) = 2
    )
    or (
      winning_team = 2
      and (
        case when team2_set1_games > team1_set1_games then 1 else 0 end
        + case when team2_set2_games > team1_set2_games then 1 else 0 end
        + case when team2_set3_games > team1_set3_games then 1 else 0 end
      ) = 2
    )
  ),
  constraint match_results_actor_membership_check check (
    submitted_by_account_id = team1_left_account_id
    or submitted_by_account_id = team1_right_account_id
    or submitted_by_account_id = team2_left_account_id
    or submitted_by_account_id = team2_right_account_id
  ),
  constraint match_results_status_check check (
    status = 'submitted' or status = 'confirmed' or status = 'disputed'
  ),
  constraint match_results_time_check check (
    submitted_at between 0 and 9007199254740991
    and (confirmed_at is null or confirmed_at between submitted_at and 9007199254740991)
    and (disputed_at is null or disputed_at between submitted_at and 9007199254740991)
  ),
  constraint match_results_version_check check (
    version between 1 and 9007199254740991
  ),
  constraint match_results_lifecycle_check check (
    (
      status = 'submitted'
      and confirmed_by_account_id is null
      and confirmed_at is null
      and disputed_by_account_id is null
      and disputed_at is null
    )
    or (
      status = 'confirmed'
      and confirmed_by_account_id is not null
      and confirmed_at is not null
      and disputed_by_account_id is null
      and disputed_at is null
      and (
        (
          submitted_by_account_id = team1_left_account_id
          or submitted_by_account_id = team1_right_account_id
        )
        and (
          confirmed_by_account_id = team2_left_account_id
          or confirmed_by_account_id = team2_right_account_id
        )
        or (
          submitted_by_account_id = team2_left_account_id
          or submitted_by_account_id = team2_right_account_id
        )
        and (
          confirmed_by_account_id = team1_left_account_id
          or confirmed_by_account_id = team1_right_account_id
        )
      )
    )
    or (
      status = 'disputed'
      and confirmed_by_account_id is null
      and confirmed_at is null
      and disputed_by_account_id is not null
      and disputed_at is not null
      and (
        disputed_by_account_id = team1_left_account_id
        or disputed_by_account_id = team1_right_account_id
        or disputed_by_account_id = team2_left_account_id
        or disputed_by_account_id = team2_right_account_id
      )
      and disputed_by_account_id <> submitted_by_account_id
    )
  )
);

create index match_results_status_submitted_idx
  on backend_match.match_results (status, submitted_at, match_id);

create index match_results_team1_left_account_idx
  on backend_match.match_results (team1_left_account_id, submitted_at, id);

create index match_results_team1_right_account_idx
  on backend_match.match_results (team1_right_account_id, submitted_at, id);

create index match_results_team2_left_account_idx
  on backend_match.match_results (team2_left_account_id, submitted_at, id);

create index match_results_team2_right_account_idx
  on backend_match.match_results (team2_right_account_id, submitted_at, id);

create index match_results_submitted_by_account_idx
  on backend_match.match_results (submitted_by_account_id, submitted_at, id);

create index match_results_confirmed_by_account_idx
  on backend_match.match_results (confirmed_by_account_id, confirmed_at, id)
  where confirmed_by_account_id is not null;

create index match_results_disputed_by_account_idx
  on backend_match.match_results (disputed_by_account_id, disputed_at, id)
  where disputed_by_account_id is not null;

create table backend_match.match_result_commands (
  command_id uuid not null,
  result_id uuid not null,
  match_id uuid not null,
  actor_account_id uuid not null,
  request_digest bytea not null,
  command_type text not null,
  result_type text not null,
  applied_at bigint not null,
  result_status text not null,
  result_version bigint not null,
  constraint match_result_commands_pkey primary key (command_id),
  constraint match_result_commands_result_binding_fkey
    foreign key (result_id, match_id)
    references backend_match.match_results (id, match_id)
    on update no action on delete no action not deferrable,
  constraint match_result_commands_actor_account_id_fkey
    foreign key (actor_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_result_commands_request_digest_check check (
    pg_catalog.octet_length(request_digest) = 32
  ),
  constraint match_result_commands_applied_at_check check (
    applied_at between 0 and 9007199254740991
  ),
  constraint match_result_commands_version_check check (
    result_version between 1 and 9007199254740991
  ),
  constraint match_result_commands_result_shape_check check (
    (
      command_type = 'submit_result'
      and result_type = 'result_submitted'
      and result_status = 'submitted'
    )
    or (
      command_type = 'confirm_result'
      and result_type = 'result_confirmed'
      and result_status = 'confirmed'
    )
    or (
      command_type = 'dispute_result'
      and result_type = 'result_disputed'
      and result_status = 'disputed'
    )
  )
);

create index match_result_commands_actor_applied_idx
  on backend_match.match_result_commands (
    actor_account_id,
    applied_at,
    command_id
  );

create index match_result_commands_result_applied_idx
  on backend_match.match_result_commands (
    result_id,
    applied_at,
    command_id
  );

revoke all on table
  backend_match.match_lineups,
  backend_match.match_lineup_assignments,
  backend_match.match_lineup_change_requests,
  backend_match.match_lineup_change_members,
  backend_match.match_lineup_commands,
  backend_match.match_results,
  backend_match.match_result_commands
from public, backend_auth_app;

grant select on table
  backend_match.match_lineups,
  backend_match.match_lineup_assignments,
  backend_match.match_lineup_change_requests,
  backend_match.match_lineup_change_members,
  backend_match.match_lineup_commands,
  backend_match.match_results,
  backend_match.match_result_commands
to backend_auth_app;

grant insert (match_id, status, created_at, updated_at, version)
  on backend_match.match_lineups to backend_auth_app;
grant update (status, updated_at, locked_at, version)
  on backend_match.match_lineups to backend_auth_app;

grant insert (
  id, match_id, account_id, team_number, court_side,
  status, assigned_at, updated_at, version
) on backend_match.match_lineup_assignments to backend_auth_app;
grant update (
  status, updated_at, released_at, version
) on backend_match.match_lineup_assignments to backend_auth_app;

grant insert (
  id, match_id, requested_by_account_id, base_lineup_version,
  status, created_at, updated_at, version
) on backend_match.match_lineup_change_requests to backend_auth_app;
grant update (status, updated_at, resolved_at, version)
  on backend_match.match_lineup_change_requests to backend_auth_app;

grant insert (
  request_id, match_id, account_id, from_team_number, from_court_side,
  to_team_number, to_court_side, approval_status, responded_at
) on backend_match.match_lineup_change_members to backend_auth_app;
grant update (approval_status, responded_at)
  on backend_match.match_lineup_change_members to backend_auth_app;

grant insert (
  command_id, match_id, actor_account_id, request_digest, command_type,
  result_type, applied_at, lineup_version, assignment_id, change_request_id
) on backend_match.match_lineup_commands to backend_auth_app;

grant insert (
  id, match_id, lineup_version,
  team1_left_account_id, team1_right_account_id,
  team2_left_account_id, team2_right_account_id,
  team1_set1_games, team2_set1_games,
  team1_set2_games, team2_set2_games,
  team1_set3_games, team2_set3_games,
  winning_team, status, submitted_by_account_id, submitted_at, version
) on backend_match.match_results to backend_auth_app;
grant update (
  status, confirmed_by_account_id, confirmed_at,
  disputed_by_account_id, disputed_at, version
) on backend_match.match_results to backend_auth_app;

grant insert (
  command_id, result_id, match_id, actor_account_id, request_digest,
  command_type, result_type, applied_at, result_status, result_version
) on backend_match.match_result_commands to backend_auth_app;

do $comments$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'match_lineups',
    'match_lineup_assignments',
    'match_lineup_change_requests',
    'match_lineup_change_members',
    'match_lineup_commands',
    'match_results',
    'match_result_commands'
  ]::text[]
  loop
    execute pg_catalog.format(
      'comment on table backend_match.%I is %L',
      v_table_name,
      '025_backend_match_lineups_results:'
        || backend_auth.relation_fingerprint(
          pg_catalog.to_regclass(
            pg_catalog.format('backend_match.%I', v_table_name)
          )
        )
    );
  end loop;
end;
$comments$;

do $assertions$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'match_lineups',
    'match_lineup_assignments',
    'match_lineup_change_requests',
    'match_lineup_change_members',
    'match_lineup_commands',
    'match_results',
    'match_result_commands'
  ]::text[]
  loop
    if pg_catalog.pg_get_userbyid(
         (
           select relation.relowner
           from pg_catalog.pg_class relation
           join pg_catalog.pg_namespace namespace
             on namespace.oid = relation.relnamespace
           where namespace.nspname = 'backend_match'
             and relation.relname = v_table_name
         )
       ) <> 'backend_auth_owner' then
      raise exception 'MIGRATION_ASSERTION_FAILED: backend_match.% owner differs',
        v_table_name;
    end if;
  end loop;

  if exists (select 1 from backend_match.match_lineups)
     or exists (select 1 from backend_match.match_lineup_assignments)
     or exists (select 1 from backend_match.match_lineup_change_requests)
     or exists (select 1 from backend_match.match_lineup_change_members)
     or exists (select 1 from backend_match.match_lineup_commands)
     or exists (select 1 from backend_match.match_results)
     or exists (select 1 from backend_match.match_result_commands) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 025 relations are not empty';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_match.match_results',
       'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_auth.player_rating_states',
       'UPDATE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: runtime privilege boundary differs';
  end if;
end;
$assertions$;

reset role;
commit;

select
  '025_backend_match_lineups_results applied; run POSTCHECK before backend rollout'
  as result;
