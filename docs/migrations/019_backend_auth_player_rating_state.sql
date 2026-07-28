-- 019_backend_auth_player_rating_state.sql
-- Creates a private backend-owned rating state with neutral defaults.
-- It does not read, copy, map, or modify any Supabase data.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_details_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
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

  if pg_catalog.to_regclass('backend_auth.accounts') is null
     or pg_catalog.to_regclass('backend_auth.player_profiles') is null
     or v_details_oid is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: required backend profile relations are missing';
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

  if pg_catalog.obj_description(v_details_oid, 'pg_class') is distinct from
     '018_backend_auth_player_profile_editable_fields:'
       || backend_auth.relation_fingerprint(
         v_details_oid::pg_catalog.regclass
       ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: player_profile_details is not the canonical migration 018 relation';
  end if;

  if pg_catalog.to_regclass('backend_auth.player_rating_states') is not null
     or pg_catalog.to_regclass('backend_auth.player_rating_states_pkey') is not null
     or exists (
       select 1
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'backend_auth'
         and c.relname = 'player_rating_states'
     ) then
    raise exception 'MIGRATION_CONFLICT: migration 019 relation or index name is already occupied';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and c.relkind = 'r';

  if v_count <> 15 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: expected 15 backend_auth tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth';

  if v_count <> 156 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: expected 156 backend_auth constraints, found %',
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

create table backend_auth.player_rating_states (
  account_id uuid not null,
  rating numeric(4,2) not null default 3.00,
  is_verified boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  constraint player_rating_states_pkey primary key (account_id),
  constraint player_rating_states_account_id_fkey foreign key (account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint player_rating_states_rating_check check (
    rating between 0.00 and 10.00
  ),
  constraint player_rating_states_time_check check (
    created_at between 0 and 9007199254740991
    and updated_at between created_at and 9007199254740991
  )
);

revoke all on table backend_auth.player_rating_states
  from public, backend_auth_app;

grant select on table backend_auth.player_rating_states
  to backend_auth_app;

grant insert (
  account_id,
  created_at,
  updated_at
) on backend_auth.player_rating_states to backend_auth_app;

insert into backend_auth.player_rating_states (
  account_id,
  created_at,
  updated_at
)
select
  profiles.account_id,
  accounts.created_at,
  accounts.updated_at
from backend_auth.player_profiles profiles
join backend_auth.accounts accounts
  on accounts.id = profiles.account_id
order by profiles.account_id;

do $comment$
begin
  execute pg_catalog.format(
    'comment on table backend_auth.player_rating_states is %L',
    '019_backend_auth_player_rating_state:'
      || backend_auth.relation_fingerprint(
        'backend_auth.player_rating_states'::pg_catalog.regclass
      )
  );
end;
$comment$;

do $assertions$
declare
  v_relation_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_rating_states')::oid;
  v_count bigint;
begin
  if v_relation_oid is null then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_rating_states was not created';
  end if;

  if pg_catalog.pg_get_userbyid(
       (select c.relowner
        from pg_catalog.pg_class c
        where c.oid = v_relation_oid)
     ) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_rating_states owner differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_attribute a
      where a.attrelid = v_relation_oid
        and a.attnum > 0
        and not a.attisdropped) <> 5 then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_rating_states column count differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_constraint c
      where c.conrelid = v_relation_oid) <> 4 then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_rating_states constraint count differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = v_relation_oid
      and not t.tgisinternal
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_rating_states has an unexpected trigger';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'TRUNCATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'REFERENCES'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'TRIGGER'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_rating_states table privileges are unsafe';
  end if;

  if not pg_catalog.has_column_privilege(
       'backend_auth_app', v_relation_oid, 'account_id', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_relation_oid, 'created_at', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_relation_oid, 'updated_at', 'INSERT'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', v_relation_oid, 'rating', 'INSERT'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', v_relation_oid, 'is_verified', 'INSERT'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_rating_states INSERT boundary differs';
  end if;

  if exists (
    select 1
    from backend_auth.player_rating_states states
    join backend_auth.accounts accounts on accounts.id = states.account_id
    where states.rating <> 3.00
       or states.is_verified
       or states.created_at <> accounts.created_at
       or states.updated_at <> accounts.updated_at
  )
     or exists (
       select profiles.account_id
       from backend_auth.player_profiles profiles
       except
       select states.account_id
       from backend_auth.player_rating_states states
     )
     or exists (
       select states.account_id
       from backend_auth.player_rating_states states
       except
       select profiles.account_id
       from backend_auth.player_profiles profiles
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: default backend rating state differs';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and c.relkind = 'r';

  if v_count <> 16 then
    raise exception 'MIGRATION_ASSERTION_FAILED: expected 16 backend_auth tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth';

  if v_count <> 160 then
    raise exception 'MIGRATION_ASSERTION_FAILED: expected 160 backend_auth constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and not t.tgisinternal;

  if v_count <> 33 then
    raise exception 'MIGRATION_ASSERTION_FAILED: expected 33 backend_auth user triggers, found %',
      v_count;
  end if;

  if pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
     '019_backend_auth_player_rating_state:'
       || backend_auth.relation_fingerprint(
         v_relation_oid::pg_catalog.regclass
       ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_rating_states fingerprint differs';
  end if;
end;
$assertions$;

reset role;
commit;

select '019_backend_auth_player_rating_state applied; run POSTCHECK before any backend rating rollout'
  as result;
