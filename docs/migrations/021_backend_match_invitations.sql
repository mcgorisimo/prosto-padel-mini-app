-- 021_backend_match_invitations.sql
-- Adds private backend-owned match invitation storage.
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
     or pg_catalog.to_regclass('backend_auth.accounts') is null
     or pg_catalog.to_regclass('backend_auth.player_profiles') is null
     or pg_catalog.to_regclass('backend_auth.player_rating_states') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: required relations are missing';
  end if;

  if pg_catalog.to_regclass(
       'backend_match.match_invitations'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.match_invitation_commands'
     ) is not null then
    raise exception 'MIGRATION_CONFLICT: migration 021 target relations already exist';
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

  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'backend_auth'
      and c.relname = 'player_rating_states'
      and c.relkind = 'r'
      and pg_catalog.pg_get_userbyid(c.relowner) =
        'backend_auth_owner'
      and pg_catalog.obj_description(c.oid, 'pg_class') =
        '019_backend_auth_player_rating_state:'
          || backend_auth.relation_fingerprint(
            c.oid::pg_catalog.regclass
          )
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth.player_rating_states differs from migration 019';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_match.match_invitations (
  id uuid not null,
  match_id uuid not null,
  invited_by_account_id uuid not null,
  invited_account_id uuid not null,
  slot_number smallint not null,
  status text not null,
  created_at bigint not null,
  updated_at bigint not null,
  responded_at bigint,
  version bigint not null,
  constraint match_invitations_pkey primary key (id),
  constraint match_invitations_id_match_key unique (id, match_id),
  constraint match_invitations_match_id_fkey
    foreign key (match_id)
    references backend_match.matches (id)
    on update no action on delete no action not deferrable,
  constraint match_invitations_invited_by_account_id_fkey
    foreign key (invited_by_account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint match_invitations_invited_account_id_fkey
    foreign key (invited_account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint match_invitations_distinct_accounts_check
    check (invited_by_account_id <> invited_account_id),
  constraint match_invitations_slot_number_check
    check (
      slot_number = 2
      or slot_number = 3
      or slot_number = 4
    ),
  constraint match_invitations_status_check
    check (
      status = 'pending'
      or status = 'accepted'
      or status = 'declined'
      or status = 'cancelled'
    ),
  constraint match_invitations_time_check
    check (
      created_at between 0 and 9007199254740991
      and updated_at between created_at and 9007199254740991
      and (
        responded_at is null
        or responded_at between created_at and updated_at
      )
    ),
  constraint match_invitations_version_check
    check (version = 1 or version = 2),
  constraint match_invitations_terminal_shape_check
    check (
      (
        status = 'pending'
        and responded_at is null
        and version = 1
      )
      or
      (
        status <> 'pending'
        and responded_at is not null
        and version = 2
      )
    )
);

create unique index match_invitations_one_pending_player
  on backend_match.match_invitations (
    match_id,
    invited_account_id
  )
  where status = 'pending';

create unique index match_invitations_one_pending_slot
  on backend_match.match_invitations (
    match_id,
    slot_number
  )
  where status = 'pending';

create index match_invitations_incoming_pending_idx
  on backend_match.match_invitations (
    invited_account_id,
    created_at desc,
    id
  )
  where status = 'pending';

create index match_invitations_match_pending_idx
  on backend_match.match_invitations (
    match_id,
    slot_number,
    created_at,
    id
  )
  where status = 'pending';

create table backend_match.match_invitation_commands (
  command_id uuid not null,
  invitation_id uuid not null,
  match_id uuid not null,
  actor_account_id uuid not null,
  request_digest bytea not null,
  command_type text not null,
  result_type text not null,
  applied_at bigint not null,
  invitation_version bigint not null,
  match_status text not null,
  participant_id uuid,
  match_version bigint,
  constraint match_invitation_commands_pkey primary key (command_id),
  constraint match_invitation_commands_invitation_match_fkey
    foreign key (invitation_id, match_id)
    references backend_match.match_invitations (id, match_id)
    on update no action on delete no action not deferrable,
  constraint match_invitation_commands_actor_account_id_fkey
    foreign key (actor_account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint match_invitation_commands_participant_id_fkey
    foreign key (participant_id)
    references backend_match.match_participants (id)
    on update no action on delete no action not deferrable,
  constraint match_invitation_commands_request_digest_check
    check (pg_catalog.octet_length(request_digest) = 32),
  constraint match_invitation_commands_command_type_check
    check (
      command_type = 'create_invitation'
      or command_type = 'accept_invitation'
      or command_type = 'decline_invitation'
      or command_type = 'cancel_invitation'
    ),
  constraint match_invitation_commands_result_type_check
    check (
      result_type = 'invitation_created'
      or result_type = 'invitation_accepted'
      or result_type = 'invitation_declined'
      or result_type = 'invitation_cancelled'
    ),
  constraint match_invitation_commands_applied_at_check
    check (applied_at between 0 and 9007199254740991),
  constraint match_invitation_commands_invitation_version_check
    check (invitation_version = 1 or invitation_version = 2),
  constraint match_invitation_commands_match_status_check
    check (
      match_status = 'open'
      or match_status = 'searching'
      or match_status = 'confirmed'
      or match_status = 'upcoming'
      or match_status = 'completed'
      or match_status = 'cancelled'
    ),
  constraint match_invitation_commands_result_shape_check
    check (
      (
        command_type = 'create_invitation'
        and result_type = 'invitation_created'
        and invitation_version = 1
        and participant_id is null
        and match_version is null
      )
      or
      (
        command_type = 'accept_invitation'
        and result_type = 'invitation_accepted'
        and invitation_version = 2
        and participant_id is not null
        and match_version > 0
      )
      or
      (
        command_type = 'decline_invitation'
        and result_type = 'invitation_declined'
        and invitation_version = 2
        and participant_id is null
        and match_version is null
      )
      or
      (
        command_type = 'cancel_invitation'
        and result_type = 'invitation_cancelled'
        and invitation_version = 2
        and participant_id is null
        and match_version is null
      )
    )
);

create index match_invitation_commands_invitation_applied_idx
  on backend_match.match_invitation_commands (
    invitation_id,
    applied_at,
    command_id
  );

create index match_invitation_commands_actor_applied_idx
  on backend_match.match_invitation_commands (
    actor_account_id,
    applied_at,
    command_id
  );

revoke all on table
  backend_match.match_invitations,
  backend_match.match_invitation_commands
from public, backend_auth_app;

grant select on table
  backend_match.match_invitations,
  backend_match.match_invitation_commands
to backend_auth_app;

grant insert (
  id,
  match_id,
  invited_by_account_id,
  invited_account_id,
  slot_number,
  status,
  created_at,
  updated_at,
  version
) on backend_match.match_invitations to backend_auth_app;

grant update (
  status,
  updated_at,
  responded_at,
  version
) on backend_match.match_invitations to backend_auth_app;

grant insert (
  command_id,
  invitation_id,
  match_id,
  actor_account_id,
  request_digest,
  command_type,
  result_type,
  applied_at,
  invitation_version,
  match_status,
  participant_id,
  match_version
) on backend_match.match_invitation_commands to backend_auth_app;

do $comments$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'match_invitations',
    'match_invitation_commands'
  ]::text[]
  loop
    execute pg_catalog.format(
      'comment on table backend_match.%I is %L',
      v_table_name,
      '021_backend_match_invitations:'
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
  if (select pg_catalog.count(*) from backend_match.match_invitations) <> 0
     or (
       select pg_catalog.count(*)
       from backend_match.match_invitation_commands
     ) <> 0 then
    raise exception 'MIGRATION_ASSERTION_FAILED: new relations are not empty';
  end if;

  if pg_catalog.pg_get_userbyid(
       (
         select c.relowner
         from pg_catalog.pg_class c
         where c.oid = 'backend_match.match_invitations'::pg_catalog.regclass
       )
     ) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid(
       (
         select c.relowner
         from pg_catalog.pg_class c
         where c.oid =
           'backend_match.match_invitation_commands'::pg_catalog.regclass
       )
     ) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_ASSERTION_FAILED: relation owner differs';
  end if;
end;
$assertions$;

reset role;
commit;

select
  '021_backend_match_invitations applied; run POSTCHECK before backend rollout'
  as result;
