-- 017_backend_auth_player_profile_details.sql
-- Adds a private backend-owned profile-details relation.
-- Creates no profile rows and does not map Supabase user IDs to backend accounts.

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

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.pg_get_userbyid(
       (select n.nspowner from pg_catalog.pg_namespace n where n.nspname = 'backend_auth')
     ) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth schema is missing or has an unexpected owner';
  end if;

  if pg_catalog.to_regclass('backend_auth.player_profiles') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth.player_profiles is missing';
  end if;

  if pg_catalog.to_regclass('backend_auth.player_profile_details') is not null then
    raise exception 'MIGRATION_CONFLICT: backend_auth.player_profile_details already exists';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_proc p on p.oid = t.tgfoid
    join pg_catalog.pg_namespace pn on pn.oid = p.pronamespace
    where n.nspname = 'backend_auth'
      and c.relname = 'player_profiles'
      and t.tgname = 'player_profiles_immutable_guard'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and t.tgtype = 27
      and pn.nspname = 'backend_auth'
      and p.proname = 'reject_immutable_mutation'
      and pg_catalog.pg_get_function_identity_arguments(p.oid) = ''
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: player_profiles immutable binding is not canonical';
  end if;

  if pg_catalog.to_regprocedure(
       'backend_auth.relation_fingerprint(pg_catalog.regclass)'
     ) is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: relation_fingerprint helper is missing';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

do $foundation$
declare
  v_expected record;
  v_count bigint;
begin
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
            || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
    ) then
      raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth.% structure, owner, or fingerprint differs',
        v_expected.table_name;
    end if;
  end loop;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r';

  if v_count <> 14 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: expected 14 backend_auth tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth';

  if v_count <> 146 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: expected 146 backend_auth constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and not t.tgisinternal;

  if v_count <> 33 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: expected 33 backend_auth user triggers, found %',
      v_count;
  end if;
end;
$foundation$;

create table backend_auth.player_profile_details (
  account_id uuid not null,
  first_name text not null,
  last_name text,
  username text,
  photo_url text,
  language_code text,
  created_at bigint not null,
  updated_at bigint not null,
  constraint player_profile_details_pkey primary key (account_id),
  constraint player_profile_details_account_id_fkey foreign key (account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint player_profile_details_first_name_check check (
    char_length(first_name) between 1 and 256
  ),
  constraint player_profile_details_last_name_check check (
    last_name is null or char_length(last_name) between 1 and 256
  ),
  constraint player_profile_details_username_check check (
    username is null or char_length(username) between 1 and 64
  ),
  constraint player_profile_details_photo_url_check check (
    photo_url is null
    or (
      char_length(photo_url) between 1 and 2048
      and pg_catalog.lower(pg_catalog.left(pg_catalog.btrim(photo_url), 6)) = 'https:'
    )
  ),
  constraint player_profile_details_language_code_check check (
    language_code is null or char_length(language_code) between 1 and 64
  ),
  constraint player_profile_details_time_check check (
    created_at between 0 and 9007199254740991
    and updated_at between created_at and 9007199254740991
  )
);

revoke all on table backend_auth.player_profile_details
  from public, backend_auth_app;

grant select on table backend_auth.player_profile_details
  to backend_auth_app;

grant insert (
  account_id,
  first_name,
  last_name,
  username,
  photo_url,
  language_code,
  created_at,
  updated_at
) on backend_auth.player_profile_details to backend_auth_app;

do $comment$
begin
  execute pg_catalog.format(
    'comment on table backend_auth.player_profile_details is %L',
    '017_backend_auth_player_profile_details:'
      || backend_auth.relation_fingerprint(
        'backend_auth.player_profile_details'::pg_catalog.regclass
      )
  );
end;
$comment$;

do $assertions$
declare
  v_relation_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
  v_count bigint;
  v_column text;
begin
  if v_relation_oid is null then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_profile_details was not created';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r';

  if v_count <> 15 then
    raise exception 'MIGRATION_ASSERTION_FAILED: expected 15 backend_auth tables, found %',
      v_count;
  end if;

  if pg_catalog.pg_get_userbyid(
       (select c.relowner from pg_catalog.pg_class c where c.oid = v_relation_oid)
     ) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_profile_details owner differs';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = v_relation_oid
      and not c.relrowsecurity
      and not c.relforcerowsecurity
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_profile_details access mode differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_attribute a
      where a.attrelid = v_relation_oid
        and a.attnum > 0
        and not a.attisdropped) <> 8 then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_profile_details column count differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_constraint c
      where c.conrelid = v_relation_oid) <> 8 then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_profile_details constraint count differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = v_relation_oid and not t.tgisinternal
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_profile_details has an unexpected trigger';
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
    raise exception 'MIGRATION_ASSERTION_FAILED: player_profile_details table privileges are unsafe';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    where c.oid = v_relation_oid
      and acl.grantee not in (
        c.relowner,
        'backend_auth_app'::pg_catalog.regrole
      )
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_profile_details has an unexpected ACL grantee';
  end if;

  foreach v_column in array array[
    'account_id',
    'first_name',
    'last_name',
    'username',
    'photo_url',
    'language_code',
    'created_at',
    'updated_at'
  ]::text[]
  loop
    if not pg_catalog.has_column_privilege(
      'backend_auth_app',
      v_relation_oid,
      v_column,
      'INSERT'
    )
       or pg_catalog.has_column_privilege(
         'backend_auth_app',
         v_relation_oid,
         v_column,
         'UPDATE'
       ) then
      raise exception 'MIGRATION_ASSERTION_FAILED: column privileges differ for %',
        v_column;
    end if;
  end loop;

  if (select pg_catalog.count(*) from backend_auth.player_profile_details) <> 0 then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration must not create profile rows';
  end if;

  if pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
     '017_backend_auth_player_profile_details:'
       || backend_auth.relation_fingerprint(v_relation_oid::pg_catalog.regclass) then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_profile_details fingerprint differs';
  end if;
end;
$assertions$;

reset role;
commit;

select '017_backend_auth_player_profile_details applied; run POSTCHECK before backend rollout'
  as result;
