-- 028_backend_admin_capability_grants.sql
-- Adds append-only capability events for player accounts that also administer the club.
-- This storage-only migration does not grant a capability to any account.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_relation record;
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
      ('backend_auth', 'player_rating_states', '027_backend_admin_rating_state'),
      ('backend_auth', 'player_rating_admin_commands', '027_backend_admin_rating_state')
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
        'admin_capability_events',
        'admin_capability_events_event_order_seq',
        'admin_capability_events_pkey',
        'admin_capability_events_event_order_key',
        'admin_capability_events_account_id_fkey',
        'admin_capability_events_account_latest_idx'
      ]::text[])
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 028 target object already exists';
  end if;

  if pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'CREATE') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_app schema CREATE is unsafe';
  end if;

  if exists (
    select 1
    from backend_auth.accounts account
    where account.role <> all (array['player', 'club_admin']::text[])
       or account.status <> all (array[
         'active', 'blocked', 'pending_deletion', 'anonymized'
       ]::text[])
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: account role or status data differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_auth.admin_capability_events (
  event_id uuid not null,
  event_order bigint generated always as identity,
  account_id uuid not null,
  capability text not null,
  event_type text not null,
  reason_code text not null,
  occurred_at bigint not null,
  constraint admin_capability_events_pkey primary key (event_id),
  constraint admin_capability_events_event_order_key unique (event_order),
  constraint admin_capability_events_account_id_fkey
    foreign key (account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint admin_capability_events_capability_check check (
    capability = 'club_admin'
  ),
  constraint admin_capability_events_event_type_check check (
    event_type = any (array['granted', 'revoked']::text[])
  ),
  constraint admin_capability_events_reason_code_check check (
    reason_code = any (array[
      'bootstrap_admin',
      'admin_access_granted',
      'admin_access_revoked'
    ]::text[])
  ),
  constraint admin_capability_events_reason_shape_check check (
    (
      event_type = 'granted'
      and reason_code = any (array[
        'bootstrap_admin',
        'admin_access_granted'
      ]::text[])
    )
    or (
      event_type = 'revoked'
      and reason_code = 'admin_access_revoked'
    )
  ),
  constraint admin_capability_events_time_check check (
    occurred_at between 0 and 9007199254740991
  )
);

create index admin_capability_events_account_latest_idx
  on backend_auth.admin_capability_events (
    account_id,
    capability,
    event_order desc
  );

revoke all on table backend_auth.admin_capability_events
  from public, backend_auth_app;

revoke all on sequence backend_auth.admin_capability_events_event_order_seq
  from public, backend_auth_app;

grant select on table backend_auth.admin_capability_events
  to backend_auth_app;

do $comments$
begin
  execute pg_catalog.format(
    'comment on table backend_auth.admin_capability_events is %L',
    '028_backend_admin_capability_grants:'
      || backend_auth.relation_fingerprint(
        'backend_auth.admin_capability_events'::pg_catalog.regclass
      )
  );
end;
$comments$;

do $assertions$
declare
  v_event_oid oid := 'backend_auth.admin_capability_events'::pg_catalog.regclass;
  v_sequence_oid oid := 'backend_auth.admin_capability_events_event_order_seq'::pg_catalog.regclass;
begin
  if pg_catalog.pg_get_userbyid((
       select relation.relowner
       from pg_catalog.pg_class relation
       where relation.oid = v_event_oid
     )) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((
       select relation.relowner
       from pg_catalog.pg_class relation
       where relation.oid = v_sequence_oid
     )) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_ASSERTION_FAILED: capability event owner differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = v_event_oid
        and attribute.attnum > 0
        and not attribute.attisdropped) <> 7 then
    raise exception 'MIGRATION_ASSERTION_FAILED: capability event column count differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = v_event_oid) <> 8 then
    raise exception 'MIGRATION_ASSERTION_FAILED: capability event constraint count differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_index index_row
      where index_row.indrelid = v_event_oid) <> 3 then
    raise exception 'MIGRATION_ASSERTION_FAILED: capability event index count differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = v_event_oid
      and not trigger_row.tgisinternal
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: capability event has an unexpected trigger';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app', v_event_oid, 'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_event_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or pg_catalog.has_sequence_privilege(
       'backend_auth_app', v_sequence_oid, 'USAGE, SELECT, UPDATE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: capability event privileges differ';
  end if;

  if exists (select 1 from backend_auth.admin_capability_events) then
    raise exception 'MIGRATION_ASSERTION_FAILED: capability event storage is not empty';
  end if;

  if pg_catalog.obj_description(v_event_oid, 'pg_class') <>
     '028_backend_admin_capability_grants:'
       || backend_auth.relation_fingerprint(v_event_oid::pg_catalog.regclass) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 028 fingerprint differs';
  end if;
end;
$assertions$;

reset role;
commit;

select '028_backend_admin_capability_grants applied; run POSTCHECK before backend rollout'
  as result;
