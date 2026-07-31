-- 024_backend_match_waitlist.sql
-- Adds private backend-owned FIFO match waitlist storage.
-- Apply manually only after PRECHECK succeeds.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_table text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: current user cannot SET ROLE backend_auth_owner';
  end if;

  if pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.to_regnamespace('backend_auth') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend schemas are missing';
  end if;

  if pg_catalog.to_regclass('backend_match.matches') is null
     or pg_catalog.to_regclass('backend_match.match_participants') is null
     or pg_catalog.to_regclass('backend_match.match_commands') is null
     or pg_catalog.to_regclass('backend_match.match_invitations') is null
     or pg_catalog.to_regclass('backend_match.match_invitation_commands') is null
     or pg_catalog.to_regclass('backend_match.match_messages') is null
     or pg_catalog.to_regclass('backend_match.match_message_commands') is null
     or pg_catalog.to_regclass('backend_auth.accounts') is null
     or pg_catalog.to_regclass('backend_auth.player_profiles') is null
     or pg_catalog.to_regclass('backend_auth.player_rating_states') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: required relations are missing';
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
    raise exception 'MIGRATION_CONFLICT: migration 024 target object already exists';
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
        and pg_catalog.pg_get_userbyid(c.relowner) =
          'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '023_backend_match_description_updates:'
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'MIGRATION_PRECONDITION_FAILED: backend_match.% differs from migration 023',
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
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_match.match_participants differs from migration 020';
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
      raise exception 'MIGRATION_PRECONDITION_FAILED: backend_match.% differs from migration 021',
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
      raise exception 'MIGRATION_PRECONDITION_FAILED: backend_match.% differs from migration 022',
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
      raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth.% differs from migration 015',
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
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth.player_rating_states differs from migration 019';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_match.match_waitlist_entries (
  id uuid not null,
  match_id uuid not null,
  account_id uuid not null,
  status text not null,
  joined_at bigint not null,
  updated_at bigint not null,
  resolved_at bigint,
  version bigint not null,
  constraint match_waitlist_entries_pkey primary key (id),
  constraint match_waitlist_entries_identity_key
    unique (id, match_id, account_id),
  constraint match_waitlist_entries_match_id_fkey
    foreign key (match_id)
    references backend_match.matches (id)
    on update no action on delete no action not deferrable,
  constraint match_waitlist_entries_account_id_fkey
    foreign key (account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint match_waitlist_entries_status_check
    check (
      status = 'waiting'
      or status = 'promoted'
      or status = 'left'
      or status = 'skipped'
    ),
  constraint match_waitlist_entries_time_check
    check (
      joined_at between 0 and 9007199254740991
      and updated_at between joined_at and 9007199254740991
      and (
        resolved_at is null
        or resolved_at between joined_at and updated_at
      )
    ),
  constraint match_waitlist_entries_version_check
    check (version = 1 or version = 2),
  constraint match_waitlist_entries_lifecycle_shape_check
    check (
      (
        status = 'waiting'
        and resolved_at is null
        and version = 1
      )
      or
      (
        status <> 'waiting'
        and resolved_at is not null
        and version = 2
      )
    )
);

create unique index match_waitlist_entries_one_waiting_account
  on backend_match.match_waitlist_entries (match_id, account_id)
  where status = 'waiting';

create index match_waitlist_entries_fifo_idx
  on backend_match.match_waitlist_entries (match_id, joined_at, id)
  where status = 'waiting';

create index match_waitlist_entries_match_history_idx
  on backend_match.match_waitlist_entries (match_id, joined_at, id);

create index match_waitlist_entries_account_history_idx
  on backend_match.match_waitlist_entries (
    account_id,
    joined_at desc,
    id
  );

create table backend_match.match_waitlist_commands (
  command_id uuid not null,
  entry_id uuid not null,
  match_id uuid not null,
  actor_account_id uuid not null,
  request_digest bytea not null,
  command_type text not null,
  result_type text not null,
  applied_at bigint not null,
  entry_status text not null,
  entry_version bigint not null,
  constraint match_waitlist_commands_pkey primary key (command_id),
  constraint match_waitlist_commands_entry_binding_fkey
    foreign key (entry_id, match_id, actor_account_id)
    references backend_match.match_waitlist_entries (
      id,
      match_id,
      account_id
    )
    on update no action on delete no action not deferrable,
  constraint match_waitlist_commands_request_digest_check
    check (pg_catalog.octet_length(request_digest) = 32),
  constraint match_waitlist_commands_command_type_check
    check (
      command_type = 'join_waitlist'
      or command_type = 'leave_waitlist'
    ),
  constraint match_waitlist_commands_result_type_check
    check (
      result_type = 'waitlist_joined'
      or result_type = 'waitlist_left'
    ),
  constraint match_waitlist_commands_applied_at_check
    check (applied_at between 0 and 9007199254740991),
  constraint match_waitlist_commands_entry_status_check
    check (entry_status = 'waiting' or entry_status = 'left'),
  constraint match_waitlist_commands_entry_version_check
    check (entry_version = 1 or entry_version = 2),
  constraint match_waitlist_commands_result_shape_check
    check (
      (
        command_type = 'join_waitlist'
        and result_type = 'waitlist_joined'
        and entry_status = 'waiting'
        and entry_version = 1
      )
      or
      (
        command_type = 'leave_waitlist'
        and result_type = 'waitlist_left'
        and entry_status = 'left'
        and entry_version = 2
      )
    )
);

create index match_waitlist_commands_entry_applied_idx
  on backend_match.match_waitlist_commands (
    entry_id,
    applied_at,
    command_id
  );

create index match_waitlist_commands_actor_applied_idx
  on backend_match.match_waitlist_commands (
    actor_account_id,
    applied_at,
    command_id
  );

revoke all on table
  backend_match.match_waitlist_entries,
  backend_match.match_waitlist_commands
from public, backend_auth_app;

grant select on table
  backend_match.match_waitlist_entries,
  backend_match.match_waitlist_commands
to backend_auth_app;

grant insert (
  id,
  match_id,
  account_id,
  status,
  joined_at,
  updated_at,
  version
) on backend_match.match_waitlist_entries to backend_auth_app;

grant update (
  status,
  updated_at,
  resolved_at,
  version
) on backend_match.match_waitlist_entries to backend_auth_app;

grant insert (
  command_id,
  entry_id,
  match_id,
  actor_account_id,
  request_digest,
  command_type,
  result_type,
  applied_at,
  entry_status,
  entry_version
) on backend_match.match_waitlist_commands to backend_auth_app;

do $comments$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'match_waitlist_entries',
    'match_waitlist_commands'
  ]::text[]
  loop
    execute pg_catalog.format(
      'comment on table backend_match.%I is %L',
      v_table_name,
      '024_backend_match_waitlist:'
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
begin
  if (select pg_catalog.count(*) from backend_match.match_waitlist_entries) <> 0
     or (
       select pg_catalog.count(*)
       from backend_match.match_waitlist_commands
     ) <> 0 then
    raise exception 'MIGRATION_ASSERTION_FAILED: new relations are not empty';
  end if;

  if pg_catalog.pg_get_userbyid(
       (
         select c.relowner
         from pg_catalog.pg_class c
         where c.oid =
           'backend_match.match_waitlist_entries'::pg_catalog.regclass
       )
     ) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid(
       (
         select c.relowner
         from pg_catalog.pg_class c
         where c.oid =
           'backend_match.match_waitlist_commands'::pg_catalog.regclass
       )
     ) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_ASSERTION_FAILED: relation owner differs';
  end if;
end;
$assertions$;

reset role;
commit;

select
  '024_backend_match_waitlist applied; run POSTCHECK before backend rollout'
  as result;
