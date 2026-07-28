-- 020_backend_match_storage.sql
-- Creates empty private storage for the first backend-owned match aggregate.
-- It does not read, copy, map, or modify Supabase match data.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_extension_schema text;
  v_count bigint;
  v_expected record;
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

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: current user cannot SET ROLE backend_auth_owner';
  end if;

  if pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_app must not inherit the owner role';
  end if;

  if not pg_catalog.has_database_privilege(
       'backend_auth_owner',
       pg_catalog.current_database(),
       'CREATE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_owner lacks database CREATE';
  end if;

  if pg_catalog.has_database_privilege(
       'backend_auth_app',
       pg_catalog.current_database(),
       'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_app CREATE privileges are unsafe';
  end if;

  if pg_catalog.to_regnamespace('backend_match') is not null then
    raise exception 'MIGRATION_CONFLICT: backend_match schema already exists';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.pg_get_userbyid(
       (select n.nspowner
        from pg_catalog.pg_namespace n
        where n.nspname = 'backend_auth')
     ) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth schema is missing or has an unexpected owner';
  end if;

  if pg_catalog.to_regprocedure(
       'backend_auth.relation_fingerprint(pg_catalog.regclass)'
     ) is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: relation_fingerprint helper is missing';
  end if;

  for v_expected in
    select *
    from (values
      ('accounts'),
      ('player_profiles'),
      ('external_identities'),
      ('external_identity_lookup_digests'),
      ('authentication_operations'),
      ('telegram_proof_consumptions'),
      ('auth_session_families'),
      ('auth_session_credentials'),
      ('auth_session_commands'),
      ('fresh_authentication_evidence'),
      ('reauthentication_grants'),
      ('otp_challenges'),
      ('otp_commands'),
      ('security_audit_events')
    ) expected(table_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'backend_auth'
        and c.relname = v_expected.table_name
        and c.relkind = 'r'
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '015_backend_auth_foundation:'
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth.% structure, owner, or fingerprint differs',
        v_expected.table_name;
    end if;
  end loop;

  if not exists (
       select 1
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'backend_auth'
         and c.relname = 'player_profile_details'
         and c.relkind = 'r'
         and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
         and pg_catalog.obj_description(c.oid, 'pg_class') =
           '018_backend_auth_player_profile_editable_fields:'
             || backend_auth.relation_fingerprint(
               c.oid::pg_catalog.regclass
             )
     )
     or not exists (
       select 1
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'backend_auth'
         and c.relname = 'player_rating_states'
         and c.relkind = 'r'
         and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
         and pg_catalog.obj_description(c.oid, 'pg_class') =
           '019_backend_auth_player_rating_state:'
             || backend_auth.relation_fingerprint(
               c.oid::pg_catalog.regclass
             )
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: canonical backend player profile storage is missing';
  end if;

  select n.nspname into v_extension_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'btree_gist';

  if v_extension_schema is null
     or not pg_catalog.has_schema_privilege(
       'backend_auth_owner',
       v_extension_schema,
       'USAGE'
     )
     or not exists (
       select 1
       from pg_catalog.pg_opclass opc
       join pg_catalog.pg_namespace n on n.oid = opc.opcnamespace
       join pg_catalog.pg_am am on am.oid = opc.opcmethod
       where n.nspname = v_extension_schema
         and am.amname = 'gist'
         and opc.opcname = 'gist_text_ops'
         and opc.opcintype = 'pg_catalog.text'::pg_catalog.regtype
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: canonical btree_gist text operator class is unavailable';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and c.relkind = 'r';

  if v_count <> 16 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: expected 16 backend_auth tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth';

  if v_count <> 160 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: expected 160 backend_auth constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and not t.tgisinternal;

  if v_count <> 33 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: expected 33 backend_auth user triggers, found %',
      v_count;
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create schema backend_match authorization backend_auth_owner;
revoke all on schema backend_match from public, backend_auth_app;
grant usage on schema backend_match to backend_auth_app;

create table backend_match.matches (
  id uuid not null,
  owner_account_id uuid not null,
  created_at bigint not null,
  updated_at bigint not null,
  starts_at bigint not null,
  duration_minutes smallint not null,
  court_id text not null,
  court_name text not null,
  court_type text not null,
  kind text not null,
  visibility text not null,
  scenario text not null,
  status text not null,
  title text,
  description text not null default ''::text,
  rating_min smallint,
  rating_max smallint,
  is_rating_match boolean not null default false,
  price_per_person_snapshot numeric(12,2),
  version bigint not null default 1,
  terminal_at bigint,
  constraint matches_pkey primary key (id),
  constraint matches_owner_account_id_fkey foreign key (owner_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint matches_time_check check (
    created_at between 0 and 9007199254740991
    and updated_at between created_at and 9007199254740991
    and starts_at between created_at and 9007199254740991
  ),
  constraint matches_duration_minutes_check check (
    duration_minutes = 60
    or duration_minutes = 90
    or duration_minutes = 120
    or duration_minutes = 150
  ),
  constraint matches_court_id_check check (
    char_length(court_id) between 1 and 64
    and pg_catalog.btrim(court_id) = court_id
    and court_id !~ '[[:cntrl:]]'
  ),
  constraint matches_court_name_check check (
    char_length(court_name) between 1 and 128
    and pg_catalog.btrim(court_name) = court_name
    and court_name !~ '[[:cntrl:]]'
  ),
  constraint matches_court_type_check check (
    char_length(court_type) between 1 and 64
    and pg_catalog.btrim(court_type) = court_type
    and court_type !~ '[[:cntrl:]]'
  ),
  constraint matches_kind_check check (
    kind = 'match' or kind = 'private'
  ),
  constraint matches_visibility_check check (
    visibility = 'public' or visibility = 'private'
  ),
  constraint matches_scenario_check check (
    scenario = 'community' or scenario = 'social' or scenario = 'private'
  ),
  constraint matches_status_check check (
    status = 'open'
    or status = 'searching'
    or status = 'confirmed'
    or status = 'upcoming'
    or status = 'completed'
    or status = 'cancelled'
  ),
  constraint matches_title_check check (
    title is null
    or (
      char_length(title) between 1 and 160
      and pg_catalog.btrim(title) = title
      and title !~ '[[:cntrl:]]'
    )
  ),
  constraint matches_description_check check (
    char_length(description) <= 2000
  ),
  constraint matches_rating_range_check check (
    (
      rating_min is null
      and rating_max is null
    )
    or (
      rating_min is not null
      and rating_max is not null
      and rating_min between 0 and 6
      and rating_max between 0 and 6
      and rating_min <= rating_max
    )
  ),
  constraint matches_price_per_person_snapshot_check check (
    price_per_person_snapshot is null
    or (
      price_per_person_snapshot <> 'NaN'::numeric
      and price_per_person_snapshot > 0
      and price_per_person_snapshot <= 1000000
    )
  ),
  constraint matches_version_check check (
    version between 1 and 9007199254740991
  ),
  constraint matches_terminal_check check (
    (
      status = 'completed'
      and terminal_at between starts_at and 9007199254740991
    )
    or (
      status = 'cancelled'
      and terminal_at between created_at and 9007199254740991
    )
    or (
      status <> 'completed'
      and status <> 'cancelled'
      and terminal_at is null
    )
  ),
  constraint matches_format_check check (
    (
      kind = 'match'
      and visibility = 'public'
      and (scenario = 'community' or scenario = 'social')
      and rating_min is not null
      and rating_max is not null
      and (
        status = 'open'
        or status = 'searching'
        or status = 'confirmed'
        or status = 'upcoming'
        or status = 'completed'
        or status = 'cancelled'
      )
    )
    or (
      kind = 'private'
      and visibility = 'private'
      and scenario = 'private'
      and rating_min is null
      and rating_max is null
      and not is_rating_match
      and (
        status = 'upcoming'
        or status = 'completed'
        or status = 'cancelled'
      )
    )
  )
);

do $overlap_constraint$
declare
  v_extension_schema text;
begin
  select n.nspname into strict v_extension_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'btree_gist';

  execute pg_catalog.format(
    'alter table backend_match.matches ' ||
    'add constraint matches_no_active_court_overlap ' ||
    'exclude using gist (' ||
    'court_id %1$I.gist_text_ops with =, ' ||
    'pg_catalog.int8range(' ||
    'starts_at, starts_at + duration_minutes::bigint * 60, ''[)''::text' ||
    ') with &&' ||
    ') where (status = any (' ||
    'array[''open'', ''searching'', ''confirmed'', ''upcoming'']::text[]' ||
    '))',
    v_extension_schema
  );
end;
$overlap_constraint$;

create index matches_owner_starts_at_idx
  on backend_match.matches (owner_account_id, starts_at, id);

create index matches_feed_idx
  on backend_match.matches (
    visibility,
    kind,
    status,
    starts_at,
    id
  );

create table backend_match.match_participants (
  id uuid not null,
  match_id uuid not null,
  account_id uuid not null,
  slot_number smallint not null,
  status text not null default 'active'::text,
  joined_at bigint not null,
  updated_at bigint not null,
  left_at bigint,
  version bigint not null default 1,
  constraint match_participants_pkey primary key (id),
  constraint match_participants_match_id_fkey foreign key (match_id)
    references backend_match.matches (id)
    on update no action on delete no action not deferrable,
  constraint match_participants_account_id_fkey foreign key (account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_participants_slot_number_check check (
    slot_number between 2 and 4
  ),
  constraint match_participants_status_check check (
    status = 'active' or status = 'left' or status = 'removed'
  ),
  constraint match_participants_time_check check (
    joined_at between 0 and 9007199254740991
    and updated_at between joined_at and 9007199254740991
    and (
      left_at is null
      or left_at between joined_at and 9007199254740991
    )
  ),
  constraint match_participants_lifecycle_check check (
    (status = 'active' and left_at is null)
    or (status <> 'active' and left_at is not null)
  ),
  constraint match_participants_version_check check (
    version between 1 and 9007199254740991
  )
);

create unique index match_participants_active_slot_key
  on backend_match.match_participants (match_id, slot_number)
  where status = 'active';

create unique index match_participants_active_account_key
  on backend_match.match_participants (match_id, account_id)
  where status = 'active';

create index match_participants_match_history_idx
  on backend_match.match_participants (match_id, joined_at, id);

create index match_participants_account_history_idx
  on backend_match.match_participants (account_id, joined_at, id);

create table backend_match.match_commands (
  command_id uuid not null,
  match_id uuid not null,
  actor_account_id uuid not null,
  command_sequence bigint not null,
  request_digest bytea not null,
  command_type text not null,
  applied_at bigint not null,
  participant_id uuid,
  result_type text not null,
  match_version bigint not null,
  constraint match_commands_pkey primary key (command_id),
  constraint match_commands_match_sequence_key unique (
    match_id,
    command_sequence
  ),
  constraint match_commands_match_id_fkey foreign key (match_id)
    references backend_match.matches (id)
    on update no action on delete no action not deferrable,
  constraint match_commands_actor_account_id_fkey foreign key (actor_account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint match_commands_participant_id_fkey foreign key (participant_id)
    references backend_match.match_participants (id)
    on update no action on delete no action not deferrable,
  constraint match_commands_request_digest_check check (
    pg_catalog.octet_length(request_digest) = 32
  ),
  constraint match_commands_sequence_check check (
    command_sequence between 1 and 9007199254740991
    and match_version = command_sequence
  ),
  constraint match_commands_applied_at_check check (
    applied_at between 0 and 9007199254740991
  ),
  constraint match_commands_result_check check (
    (
      command_type = 'create_match'
      and result_type = 'match_created'
      and participant_id is null
    )
    or (
      command_type = 'join_match'
      and result_type = 'participant_joined'
      and participant_id is not null
    )
    or (
      command_type = 'leave_match'
      and result_type = 'participant_left'
      and participant_id is not null
    )
  )
);

create index match_commands_actor_applied_at_idx
  on backend_match.match_commands (actor_account_id, applied_at, command_id);

create index match_commands_participant_id_idx
  on backend_match.match_commands (participant_id)
  where participant_id is not null;

revoke all on all tables in schema backend_match
  from public, backend_auth_app;

grant select on table
  backend_match.matches,
  backend_match.match_participants,
  backend_match.match_commands
to backend_auth_app;

grant insert (
  id,
  owner_account_id,
  created_at,
  updated_at,
  starts_at,
  duration_minutes,
  court_id,
  court_name,
  court_type,
  kind,
  visibility,
  scenario,
  status,
  title,
  description,
  rating_min,
  rating_max,
  is_rating_match,
  price_per_person_snapshot,
  version
) on backend_match.matches to backend_auth_app;

grant update (
  updated_at,
  status,
  version,
  terminal_at
) on backend_match.matches to backend_auth_app;

grant insert (
  id,
  match_id,
  account_id,
  slot_number,
  status,
  joined_at,
  updated_at,
  version
) on backend_match.match_participants to backend_auth_app;

grant update (
  status,
  updated_at,
  left_at,
  version
) on backend_match.match_participants to backend_auth_app;

grant insert (
  command_id,
  match_id,
  actor_account_id,
  command_sequence,
  request_digest,
  command_type,
  applied_at,
  participant_id,
  result_type,
  match_version
) on backend_match.match_commands to backend_auth_app;

comment on schema backend_match is
  '020_backend_match_storage:private backend-owned match aggregate';

do $comments$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'matches',
    'match_participants',
    'match_commands'
  ]::text[]
  loop
    execute pg_catalog.format(
      'comment on table backend_match.%I is %L',
      v_table_name,
      '020_backend_match_storage:'
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
  v_count bigint;
  v_expected record;
begin
  if pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.pg_get_userbyid(
       (select n.nspowner
        from pg_catalog.pg_namespace n
        where n.nspname = 'backend_match')
     ) <> 'backend_auth_owner'
     or pg_catalog.obj_description(
       pg_catalog.to_regnamespace('backend_match'),
       'pg_namespace'
     ) is distinct from
       '020_backend_match_storage:private backend-owned match aggregate'
     or not pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'USAGE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'CREATE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: backend_match schema boundary differs';
  end if;

  for v_expected in
    select *
    from (values
      ('matches', 19),
      ('match_participants', 8),
      ('match_commands', 9)
    ) expected(table_name, constraint_count)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'backend_match'
        and c.relname = v_expected.table_name
        and c.relkind = 'r'
        and c.relpersistence = 'p'
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and not c.relrowsecurity
        and not c.relforcerowsecurity
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '020_backend_match_storage:'
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'MIGRATION_ASSERTION_FAILED: backend_match.% structure, owner, or fingerprint differs',
        v_expected.table_name;
    end if;

    if (
      select pg_catalog.count(*)
      from pg_catalog.pg_constraint c
      where c.conrelid = pg_catalog.to_regclass(
        pg_catalog.format('backend_match.%I', v_expected.table_name)
      )
    ) <> v_expected.constraint_count then
      raise exception 'MIGRATION_ASSERTION_FAILED: backend_match.% constraint count differs',
        v_expected.table_name;
    end if;
  end loop;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_match'
    and c.relkind = 'r';

  if v_count <> 3 then
    raise exception 'MIGRATION_ASSERTION_FAILED: expected 3 backend_match tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_match';

  if v_count <> 36 then
    raise exception 'MIGRATION_ASSERTION_FAILED: expected 36 backend_match constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_match';

  if v_count <> 13 then
    raise exception 'MIGRATION_ASSERTION_FAILED: expected 13 backend_match indexes, found %',
      v_count;
  end if;

  if exists (
       select 1
       from pg_catalog.pg_trigger t
       join pg_catalog.pg_class c on c.oid = t.tgrelid
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'backend_match'
         and not t.tgisinternal
     )
     or exists (
       select 1
       from pg_catalog.pg_proc p
       join pg_catalog.pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'backend_match'
     )
     or exists (
       select 1
       from backend_match.matches
     )
     or exists (
       select 1
       from backend_match.match_participants
     )
     or exists (
       select 1
       from backend_match.match_commands
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: backend_match must contain only empty storage relations';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_match.matches',
       'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_match.match_participants',
       'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_match.match_commands',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_match.match_commands',
       'DELETE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: backend_match runtime privileges are unsafe';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and c.relkind = 'r';

  if v_count <> 16 then
    raise exception 'MIGRATION_ASSERTION_FAILED: existing backend_auth table count changed';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth';

  if v_count <> 160 then
    raise exception 'MIGRATION_ASSERTION_FAILED: existing backend_auth constraint count changed';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and not t.tgisinternal;

  if v_count <> 33 then
    raise exception 'MIGRATION_ASSERTION_FAILED: existing backend_auth trigger count changed';
  end if;
end;
$assertions$;

reset role;
commit;

select '020_backend_match_storage applied; run POSTCHECK before any backend match writer rollout'
  as result;
