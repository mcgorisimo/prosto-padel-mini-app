-- 027_backend_admin_rating_state.sql
-- Adds immutable command/audit storage for later backend admin rating changes.
-- This migration does not change any player's rating or verification state.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_relation record;
  v_update_columns text[];
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

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_auth'
     )) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth schema is missing or owner differs';
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
      raise exception 'MIGRATION_PRECONDITION_FAILED: %.% differs from %',
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
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 027 target object already exists';
  end if;

  if pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'CREATE') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_app schema CREATE is unsafe';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'UPDATE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: player_rating_states table UPDATE is unsafe';
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
    raise exception 'MIGRATION_PRECONDITION_FAILED: rating writer column boundary differs';
  end if;

  if (select pg_catalog.count(*) from backend_auth.player_profiles) <>
     (select pg_catalog.count(*) from backend_auth.player_rating_states) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: player rating state coverage differs';
  end if;

  if exists (
    select 1
    from backend_auth.player_rating_states state
    where state.rating < 0.00
       or state.rating > 10.00
       or state.updated_at < state.created_at
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: player rating state data is invalid';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_auth.player_rating_admin_commands (
  command_id uuid not null,
  actor_account_id uuid not null,
  target_account_id uuid not null,
  request_digest bytea not null,
  command_type text not null,
  result_type text not null,
  rating_before numeric(4,2) not null,
  rating_after numeric(4,2) not null,
  is_verified_before boolean not null,
  is_verified_after boolean not null,
  applied_at bigint not null,
  constraint player_rating_admin_commands_pkey primary key (command_id),
  constraint player_rating_admin_commands_actor_account_id_fkey
    foreign key (actor_account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint player_rating_admin_commands_target_account_id_fkey
    foreign key (target_account_id)
    references backend_auth.player_rating_states (account_id)
    on update no action on delete no action not deferrable,
  constraint player_rating_admin_commands_request_digest_check check (
    pg_catalog.octet_length(request_digest) = 32
  ),
  constraint player_rating_admin_commands_command_type_check check (
    command_type = 'set_player_rating_state'
  ),
  constraint player_rating_admin_commands_result_type_check check (
    result_type = any (array[
      'rating_updated',
      'verification_updated',
      'rating_and_verification_updated',
      'rating_state_unchanged'
    ]::text[])
  ),
  constraint player_rating_admin_commands_rating_check check (
    rating_before between 0.00 and 10.00
    and rating_after between 0.00 and 10.00
  ),
  constraint player_rating_admin_commands_time_check check (
    applied_at between 0 and 9007199254740991
  ),
  constraint player_rating_admin_commands_result_shape_check check (
    (
      result_type = 'rating_updated'
      and rating_before <> rating_after
      and is_verified_before = is_verified_after
    )
    or (
      result_type = 'verification_updated'
      and rating_before = rating_after
      and is_verified_before <> is_verified_after
    )
    or (
      result_type = 'rating_and_verification_updated'
      and rating_before <> rating_after
      and is_verified_before <> is_verified_after
    )
    or (
      result_type = 'rating_state_unchanged'
      and rating_before = rating_after
      and is_verified_before = is_verified_after
    )
  )
);

create index player_rating_admin_commands_actor_applied_idx
  on backend_auth.player_rating_admin_commands (
    actor_account_id,
    applied_at,
    command_id
  );

create index player_rating_admin_commands_target_applied_idx
  on backend_auth.player_rating_admin_commands (
    target_account_id,
    applied_at,
    command_id
  );

revoke all on table backend_auth.player_rating_admin_commands
  from public, backend_auth_app;

grant select, insert on table backend_auth.player_rating_admin_commands
  to backend_auth_app;

grant update (is_verified)
  on backend_auth.player_rating_states
  to backend_auth_app;

do $comments$
begin
  execute pg_catalog.format(
    'comment on table backend_auth.player_rating_admin_commands is %L',
    '027_backend_admin_rating_state:'
      || backend_auth.relation_fingerprint(
        'backend_auth.player_rating_admin_commands'::pg_catalog.regclass
      )
  );

  execute pg_catalog.format(
    'comment on table backend_auth.player_rating_states is %L',
    '027_backend_admin_rating_state:'
      || backend_auth.relation_fingerprint(
        'backend_auth.player_rating_states'::pg_catalog.regclass
      )
  );
end;
$comments$;

do $assertions$
declare
  v_command_oid oid :=
    'backend_auth.player_rating_admin_commands'::pg_catalog.regclass;
  v_rating_state_oid oid :=
    'backend_auth.player_rating_states'::pg_catalog.regclass;
  v_update_columns text[];
begin
  if pg_catalog.pg_get_userbyid((
       select relation.relowner
       from pg_catalog.pg_class relation
       where relation.oid = v_command_oid
     )) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_ASSERTION_FAILED: admin command owner differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = v_command_oid
        and attribute.attnum > 0
        and not attribute.attisdropped) <> 11 then
    raise exception 'MIGRATION_ASSERTION_FAILED: admin command column count differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = v_command_oid) <> 9 then
    raise exception 'MIGRATION_ASSERTION_FAILED: admin command constraint count differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_index index_row
      where index_row.indrelid = v_command_oid) <> 3 then
    raise exception 'MIGRATION_ASSERTION_FAILED: admin command index count differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = v_command_oid
      and not trigger_row.tgisinternal
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: admin command has an unexpected trigger';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app', v_command_oid, 'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app', v_command_oid, 'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_command_oid,
       'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: admin command privileges differ';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app', v_rating_state_oid, 'UPDATE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_rating_states table UPDATE is unsafe';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_update_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = v_rating_state_oid
    and attribute.attnum > 0
    and not attribute.attisdropped
    and pg_catalog.has_column_privilege(
      'backend_auth_app',
      v_rating_state_oid,
      attribute.attname,
      'UPDATE'
    );

  if v_update_columns is distinct from
     array['rating', 'is_verified', 'updated_at']::text[] then
    raise exception 'MIGRATION_ASSERTION_FAILED: admin rating writer column boundary differs';
  end if;

  if exists (select 1 from backend_auth.player_rating_admin_commands) then
    raise exception 'MIGRATION_ASSERTION_FAILED: admin command storage is not empty';
  end if;

  if pg_catalog.obj_description(v_command_oid, 'pg_class') <>
     '027_backend_admin_rating_state:'
       || backend_auth.relation_fingerprint(v_command_oid::pg_catalog.regclass)
     or pg_catalog.obj_description(v_rating_state_oid, 'pg_class') <>
     '027_backend_admin_rating_state:'
       || backend_auth.relation_fingerprint(v_rating_state_oid::pg_catalog.regclass) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 027 fingerprint differs';
  end if;
end;
$assertions$;

reset role;
commit;

select '027_backend_admin_rating_state applied; run POSTCHECK before backend admin rollout'
  as result;
