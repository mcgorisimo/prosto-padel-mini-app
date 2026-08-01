-- 026_backend_match_rating_applications.sql
-- Adds immutable storage for server-calculated rating applications.
-- This migration does not calculate or apply ratings by itself.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
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
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_owner attributes are unsafe';
  end if;

  if v_app.rolname is null
     or not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_app attributes are unsafe';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
     or pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: role membership boundary differs';
  end if;

  if pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_match'
     )) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_match schema is missing or owner differs';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_match'
      and relation.relname = 'match_results'
      and relation.relkind = 'r'
      and relation.relpersistence = 'p'
      and not relation.relrowsecurity
      and not relation.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(relation.oid, 'pg_class') =
        '025_backend_match_lineups_results:'
          || backend_auth.relation_fingerprint(relation.oid::pg_catalog.regclass)
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_match.match_results differs from migration 025';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_auth'
      and relation.relname = 'player_rating_states'
      and relation.relkind = 'r'
      and relation.relpersistence = 'p'
      and not relation.relrowsecurity
      and not relation.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(relation.oid, 'pg_class') =
        '019_backend_auth_player_rating_state:'
          || backend_auth.relation_fingerprint(relation.oid::pg_catalog.regclass)
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth.player_rating_states differs from migration 019';
  end if;

  if pg_catalog.to_regclass('backend_match.match_rating_applications') is not null
     or pg_catalog.to_regclass('backend_match.match_rating_changes') is not null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 026 target relation already exists';
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
    raise exception 'MIGRATION_PRECONDITION_FAILED: rating writer privilege already exists';
  end if;

  if (select pg_catalog.count(*) from backend_auth.player_profiles) <>
     (select pg_catalog.count(*) from backend_auth.player_rating_states) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: player rating state coverage differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

-- Close the in-transaction race with the already deployed result writer.
-- The operational confirmation freeze documented in the README must remain
-- active after this transaction until the rating-aware backend is healthy.
lock table
  backend_match.matches,
  backend_match.match_results
in access exclusive mode;

do $rating_gap_guard$
begin
  if exists (
    select 1
    from backend_match.match_results result_row
    join backend_match.matches match_row on match_row.id = result_row.match_id
    where match_row.is_rating_match
      and result_row.status = 'confirmed'
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: confirmed rating result has no backend rating application';
  end if;
end;
$rating_gap_guard$;

create table backend_match.match_rating_applications (
  result_id uuid not null,
  match_id uuid not null,
  result_version bigint not null,
  winning_team smallint not null,
  team1_average_before numeric(5,3) not null,
  team2_average_before numeric(5,3) not null,
  expected_team1 numeric(7,6) not null,
  formula_version text not null,
  applied_by_account_id uuid not null,
  applied_at bigint not null,
  constraint match_rating_applications_pkey primary key (result_id),
  constraint match_rating_applications_match_id_key unique (match_id),
  constraint match_rating_applications_identity_key unique (result_id, match_id),
  constraint match_rating_applications_result_fkey
    foreign key (result_id, match_id)
    references backend_match.match_results (id, match_id)
    on update no action on delete no action not deferrable,
  constraint match_rating_applications_actor_fkey
    foreign key (applied_by_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_rating_applications_result_version_check check (
    result_version between 2 and 9007199254740991
  ),
  constraint match_rating_applications_winning_team_check check (
    winning_team = 1 or winning_team = 2
  ),
  constraint match_rating_applications_averages_check check (
    team1_average_before between 0.000 and 10.000
    and team2_average_before between 0.000 and 10.000
  ),
  constraint match_rating_applications_expected_check check (
    expected_team1 > 0.000000 and expected_team1 < 1.000000
  ),
  constraint match_rating_applications_formula_check check (
    formula_version = 'doubles_elo_v1'
  ),
  constraint match_rating_applications_time_check check (
    applied_at between 0 and 9007199254740991
  )
);

create index match_rating_applications_actor_history_idx
  on backend_match.match_rating_applications (
    applied_by_account_id,
    applied_at,
    result_id
  );

create index match_rating_applications_applied_at_idx
  on backend_match.match_rating_applications (applied_at, result_id);

create table backend_match.match_rating_changes (
  result_id uuid not null,
  match_id uuid not null,
  account_id uuid not null,
  team_number smallint not null,
  court_side text not null,
  rating_before numeric(4,2) not null,
  rating_delta numeric(4,2) not null,
  rating_after numeric(4,2) not null,
  rated_matches_before bigint not null,
  k_factor numeric(2,1) not null,
  expected_score numeric(7,6) not null,
  applied_at bigint not null,
  constraint match_rating_changes_pkey primary key (result_id, account_id),
  constraint match_rating_changes_slot_key unique (
    result_id,
    team_number,
    court_side
  ),
  constraint match_rating_changes_application_fkey
    foreign key (result_id, match_id)
    references backend_match.match_rating_applications (result_id, match_id)
    on update no action on delete no action not deferrable,
  constraint match_rating_changes_account_fkey
    foreign key (account_id)
    references backend_auth.player_rating_states (account_id)
    on update no action on delete no action not deferrable,
  constraint match_rating_changes_team_check check (
    team_number = 1 or team_number = 2
  ),
  constraint match_rating_changes_side_check check (
    court_side = 'left' or court_side = 'right'
  ),
  constraint match_rating_changes_rating_check check (
    rating_before between 0.00 and 10.00
    and rating_after between 0.00 and 10.00
    and rating_delta between -10.00 and 10.00
    and rating_after = rating_before + rating_delta
  ),
  constraint match_rating_changes_count_check check (
    rated_matches_before between 0 and 9007199254740991
  ),
  constraint match_rating_changes_k_factor_check check (
    (
      rated_matches_before < 10
      and k_factor = 0.4
    )
    or (
      rated_matches_before >= 10
      and k_factor = 0.1
    )
  ),
  constraint match_rating_changes_expected_check check (
    expected_score > 0.000000 and expected_score < 1.000000
  ),
  constraint match_rating_changes_time_check check (
    applied_at between 0 and 9007199254740991
  )
);

create index match_rating_changes_account_history_idx
  on backend_match.match_rating_changes (
    account_id,
    applied_at,
    result_id
  );

create index match_rating_changes_match_idx
  on backend_match.match_rating_changes (match_id, result_id, account_id);

revoke all on table backend_match.match_rating_applications
  from public, backend_auth_app;
revoke all on table backend_match.match_rating_changes
  from public, backend_auth_app;

grant select, insert on table backend_match.match_rating_applications
  to backend_auth_app;
grant select, insert on table backend_match.match_rating_changes
  to backend_auth_app;

grant update (rating, updated_at)
  on backend_auth.player_rating_states
  to backend_auth_app;

do $comments$
declare
  v_table text;
begin
  foreach v_table in array array[
    'match_rating_applications',
    'match_rating_changes'
  ]::text[]
  loop
    execute pg_catalog.format(
      'comment on table backend_match.%I is %L',
      v_table,
      '026_backend_match_rating_applications:'
        || backend_auth.relation_fingerprint(
          pg_catalog.to_regclass(pg_catalog.format('backend_match.%I', v_table))
        )
    );
  end loop;

  execute pg_catalog.format(
    'comment on table backend_auth.player_rating_states is %L',
    '026_backend_match_rating_applications:'
      || backend_auth.relation_fingerprint(
        'backend_auth.player_rating_states'::pg_catalog.regclass
      )
  );
end;
$comments$;

do $assertions$
declare
  v_table text;
begin
  foreach v_table in array array[
    'match_rating_applications',
    'match_rating_changes'
  ]::text[]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
        and relation.relname = v_table
        and relation.relkind = 'r'
        and relation.relpersistence = 'p'
        and not relation.relrowsecurity
        and not relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          '026_backend_match_rating_applications:'
            || backend_auth.relation_fingerprint(relation.oid::pg_catalog.regclass)
    ) then
      raise exception 'MIGRATION_ASSERTION_FAILED: backend_match.% differs', v_table;
    end if;
  end loop;

  if pg_catalog.obj_description(
       'backend_auth.player_rating_states'::pg_catalog.regclass,
       'pg_class'
     ) <>
     '026_backend_match_rating_applications:'
       || backend_auth.relation_fingerprint(
         'backend_auth.player_rating_states'::pg_catalog.regclass
       ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_rating_states fingerprint differs';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_match.match_rating_applications', 'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_match.match_rating_applications', 'INSERT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_match.match_rating_changes', 'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_match.match_rating_changes', 'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_match.match_rating_applications', 'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_match.match_rating_changes', 'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: rating audit privileges differ';
  end if;

  if not pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'rating', 'UPDATE'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'updated_at', 'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'account_id', 'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'is_verified', 'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'created_at', 'UPDATE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: rating writer column boundary differs';
  end if;

  if exists (select 1 from backend_match.match_rating_applications)
     or exists (select 1 from backend_match.match_rating_changes) then
    raise exception 'MIGRATION_ASSERTION_FAILED: rating audit storage is not empty';
  end if;
end;
$assertions$;

reset role;
commit;

select '026_backend_match_rating_applications applied; run POSTCHECK before backend rating rollout' as result;
