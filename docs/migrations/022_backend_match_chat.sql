-- 022_backend_match_chat.sql
-- Adds private append-only backend-owned match chat storage.
-- Apply manually only after PRECHECK succeeds.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_table text;
  v_object_name text;
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

  if pg_catalog.to_regclass('backend_auth.accounts') is null
     or pg_catalog.to_regclass('backend_auth.player_profiles') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: required backend_auth relations are missing';
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
      raise exception 'MIGRATION_PRECONDITION_FAILED: backend_match.% differs from migration 020',
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
      raise exception 'MIGRATION_PRECONDITION_FAILED: backend_match.% differs from migration 021',
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
      raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth.% differs from migration 015',
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
      raise exception 'MIGRATION_CONFLICT: backend_match.% already exists',
        v_object_name;
    end if;
  end loop;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_match.match_messages (
  id uuid not null,
  match_id uuid not null,
  sender_account_id uuid not null,
  body text not null,
  created_at bigint not null,
  constraint match_messages_pkey primary key (id),
  constraint match_messages_identity_key unique (
    id,
    match_id,
    sender_account_id
  ),
  constraint match_messages_match_id_fkey
    foreign key (match_id)
    references backend_match.matches (id)
    on update no action on delete no action not deferrable,
  constraint match_messages_sender_account_id_fkey
    foreign key (sender_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_messages_body_check
    check (
      pg_catalog.char_length(body) between 1 and 2000
      and body !~ '^[[:space:]]'
      and body !~ '[[:space:]]$'
    ),
  constraint match_messages_created_at_check
    check (created_at between 0 and 9007199254740991)
);

create index match_messages_match_created_idx
  on backend_match.match_messages (
    match_id,
    created_at desc,
    id desc
  );

create index match_messages_sender_created_idx
  on backend_match.match_messages (
    sender_account_id,
    created_at desc,
    id
  );

create table backend_match.match_message_commands (
  command_id uuid not null,
  message_id uuid not null,
  match_id uuid not null,
  actor_account_id uuid not null,
  request_digest bytea not null,
  command_type text not null,
  result_type text not null,
  applied_at bigint not null,
  constraint match_message_commands_pkey primary key (command_id),
  constraint match_message_commands_message_match_key unique (
    message_id,
    match_id
  ),
  constraint match_message_commands_message_actor_fkey
    foreign key (
      message_id,
      match_id,
      actor_account_id
    )
    references backend_match.match_messages (
      id,
      match_id,
      sender_account_id
    )
    on update no action on delete no action not deferrable,
  constraint match_message_commands_request_digest_check
    check (pg_catalog.octet_length(request_digest) = 32),
  constraint match_message_commands_result_shape_check
    check (
      command_type = 'send_message'
      and result_type = 'message_sent'
    ),
  constraint match_message_commands_applied_at_check
    check (applied_at between 0 and 9007199254740991)
);

create index match_message_commands_actor_applied_idx
  on backend_match.match_message_commands (
    actor_account_id,
    applied_at desc,
    command_id
  );

revoke all on table
  backend_match.match_messages,
  backend_match.match_message_commands
from public, backend_auth_app;

grant select on table
  backend_match.match_messages,
  backend_match.match_message_commands
to backend_auth_app;

grant insert (
  id,
  match_id,
  sender_account_id,
  body,
  created_at
) on backend_match.match_messages to backend_auth_app;

grant insert (
  command_id,
  message_id,
  match_id,
  actor_account_id,
  request_digest,
  command_type,
  result_type,
  applied_at
) on backend_match.match_message_commands to backend_auth_app;

do $comments$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'match_messages',
    'match_message_commands'
  ]::text[]
  loop
    execute pg_catalog.format(
      'comment on table backend_match.%I is %L',
      v_table_name,
      '022_backend_match_chat:'
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
  if (select pg_catalog.count(*) from backend_match.match_messages) <> 0
     or (
       select pg_catalog.count(*)
       from backend_match.match_message_commands
     ) <> 0 then
    raise exception 'MIGRATION_ASSERTION_FAILED: new relations are not empty';
  end if;

  if pg_catalog.pg_get_userbyid(
       (
         select c.relowner
         from pg_catalog.pg_class c
         where c.oid =
           'backend_match.match_messages'::pg_catalog.regclass
       )
     ) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid(
       (
         select c.relowner
         from pg_catalog.pg_class c
         where c.oid =
           'backend_match.match_message_commands'::pg_catalog.regclass
       )
     ) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_ASSERTION_FAILED: relation owner differs';
  end if;
end;
$assertions$;

reset role;
commit;

select
  '022_backend_match_chat applied; run POSTCHECK before backend rollout'
  as result;
