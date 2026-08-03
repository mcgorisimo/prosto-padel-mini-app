-- 029_backend_match_notifications.sql
-- Adds private backend-owned storage for durable waitlist promotion notifications.
-- This storage-only migration does not create notifications or change runtime behavior.

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

  if pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_match'
     )) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_auth'
     )) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend schema boundary differs';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_auth', 'accounts', '015_backend_auth_foundation'),
      ('backend_match', 'matches', '023_backend_match_description_updates'),
      ('backend_match', 'match_waitlist_entries', '024_backend_match_waitlist')
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
    where namespace.nspname = 'backend_match'
      and relation.relname = any (array[
        'match_notifications',
        'match_notifications_pkey',
        'match_notifications_waitlist_entry_key',
        'match_notifications_recipient_feed_idx',
        'match_notifications_recipient_unread_idx'
      ]::text[])
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 029 target object already exists';
  end if;

  if pg_catalog.has_schema_privilege('backend_auth_app', 'backend_match', 'CREATE')
     or pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'CREATE') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: application schema CREATE is unsafe';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_match.match_notifications (
  id uuid not null,
  waitlist_entry_id uuid not null,
  match_id uuid not null,
  recipient_account_id uuid not null,
  notification_type text not null,
  created_at bigint not null,
  read_at bigint,
  version bigint not null,
  constraint match_notifications_pkey primary key (id),
  constraint match_notifications_waitlist_entry_key unique (waitlist_entry_id),
  constraint match_notifications_waitlist_entry_binding_fkey
    foreign key (waitlist_entry_id, match_id, recipient_account_id)
    references backend_match.match_waitlist_entries (id, match_id, account_id)
    on update no action on delete no action not deferrable,
  constraint match_notifications_type_check check (
    notification_type = 'waitlist_promoted'
  ),
  constraint match_notifications_time_check check (
    created_at between 0 and 9007199254740991
    and (
      read_at is null
      or read_at between created_at and 9007199254740991
    )
  ),
  constraint match_notifications_version_check check (version = 1 or version = 2),
  constraint match_notifications_read_shape_check check (
    (read_at is null and version = 1)
    or (read_at is not null and version = 2)
  )
);

create index match_notifications_recipient_feed_idx
  on backend_match.match_notifications (
    recipient_account_id,
    created_at desc,
    id desc
  );

create index match_notifications_recipient_unread_idx
  on backend_match.match_notifications (
    recipient_account_id,
    created_at desc,
    id desc
  )
  where read_at is null;

revoke all on table backend_match.match_notifications
  from public, backend_auth_app;

grant select on table backend_match.match_notifications
  to backend_auth_app;

grant insert (
  id,
  waitlist_entry_id,
  match_id,
  recipient_account_id,
  notification_type,
  created_at,
  version
) on backend_match.match_notifications to backend_auth_app;

grant update (
  read_at,
  version
) on backend_match.match_notifications to backend_auth_app;

do $comments$
begin
  execute pg_catalog.format(
    'comment on table backend_match.match_notifications is %L',
    '029_backend_match_notifications:'
      || backend_auth.relation_fingerprint(
        'backend_match.match_notifications'::pg_catalog.regclass
      )
  );
end;
$comments$;

do $assertions$
declare
  v_notification_oid oid := 'backend_match.match_notifications'::pg_catalog.regclass;
begin
  if pg_catalog.pg_get_userbyid((
       select relation.relowner
       from pg_catalog.pg_class relation
       where relation.oid = v_notification_oid
     )) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_ASSERTION_FAILED: notification relation owner differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = v_notification_oid
        and attribute.attnum > 0
        and not attribute.attisdropped) <> 8 then
    raise exception 'MIGRATION_ASSERTION_FAILED: notification column count differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = v_notification_oid) <> 7 then
    raise exception 'MIGRATION_ASSERTION_FAILED: notification constraint count differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_index index_row
      where index_row.indrelid = v_notification_oid) <> 4 then
    raise exception 'MIGRATION_ASSERTION_FAILED: notification index count differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = v_notification_oid
      and not trigger_row.tgisinternal
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: notification relation has an unexpected trigger';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app', v_notification_oid, 'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_notification_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_notification_oid, 'id', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_notification_oid, 'read_at', 'UPDATE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: notification privileges differ';
  end if;

  if exists (select 1 from backend_match.match_notifications) then
    raise exception 'MIGRATION_ASSERTION_FAILED: notification storage is not empty';
  end if;

  if pg_catalog.obj_description(v_notification_oid, 'pg_class') <>
     '029_backend_match_notifications:'
       || backend_auth.relation_fingerprint(v_notification_oid::pg_catalog.regclass) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 029 fingerprint differs';
  end if;
end;
$assertions$;

reset role;
commit;

select '029_backend_match_notifications applied; run POSTCHECK before backend rollout'
  as result;
