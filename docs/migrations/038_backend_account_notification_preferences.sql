-- 038_backend_account_notification_preferences.sql
-- Adds account-owned Telegram match-notification preferences and the matching
-- terminal outbox failure code. This migration is runtime-disconnected.

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

  if not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.pg_has_role(
       'backend_auth_app',
       'backend_auth_owner',
       'MEMBER'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: role membership boundary differs';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_auth'
     )) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_match'
     )) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend schema boundary differs';
  end if;

  for v_relation in
    select *
    from (values
      (
        'backend_auth',
        'accounts',
        '015_backend_auth_foundation'
      ),
      (
        'backend_auth',
        'telegram_notification_destinations',
        '030_backend_telegram_outbound_notifications'
      ),
      (
        'backend_match',
        'telegram_notification_outbox',
        '030_backend_telegram_outbound_notifications'
      )
    ) expected(schema_name, relation_name, migration_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = v_relation.schema_name
        and relation.relname = v_relation.relation_name
        and relation.relkind = 'r'
        and relation.relpersistence = 'p'
        and not relation.relrowsecurity
        and not relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) =
          'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          v_relation.migration_name || ':'
            || backend_auth.relation_fingerprint(
              relation.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'MIGRATION_PRECONDITION_FAILED: %.% differs from %',
        v_relation.schema_name,
        v_relation.relation_name,
        v_relation.migration_name;
    end if;
  end loop;

  if pg_catalog.to_regclass(
       'backend_auth.account_notification_preferences'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.account_notification_preferences_pkey'
     ) is not null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 038 target object already exists';
  end if;

  if pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'CREATE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: application schema CREATE is unsafe';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table backend_auth.accounts in row share mode;
lock table backend_match.telegram_notification_outbox
  in access exclusive mode;

create table backend_auth.account_notification_preferences (
  account_id uuid not null,
  telegram_match_notifications_enabled boolean not null,
  created_at bigint not null,
  updated_at bigint not null,
  version bigint not null,
  constraint account_notification_preferences_pkey
    primary key (account_id),
  constraint account_notification_preferences_account_id_fkey
    foreign key (account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint account_notification_preferences_time_check check (
    created_at between 0 and 9007199254740991
    and updated_at between created_at and 9007199254740991
  ),
  constraint account_notification_preferences_version_check check (
    version between 1 and 9007199254740991
  )
);

alter table backend_match.telegram_notification_outbox
  drop constraint telegram_notification_outbox_failure_check,
  drop constraint telegram_notification_outbox_state_check;

alter table backend_match.telegram_notification_outbox
  add constraint telegram_notification_outbox_failure_check check (
    failure_code is null
    or failure_code = 'destination_unavailable'
    or failure_code = 'preference_disabled'
    or failure_code = 'telegram_forbidden'
    or failure_code = 'telegram_bad_request'
    or failure_code = 'telegram_rate_limited'
    or failure_code = 'telegram_unavailable'
    or failure_code = 'network_error'
    or failure_code = 'invalid_response'
    or failure_code = 'retry_exhausted'
  ),
  add constraint telegram_notification_outbox_state_check check (
    (
      status = 'pending'
      and sent_at is null
      and telegram_message_id is null
      and attempt_count <= 20
      and (
        failure_code is null
        or failure_code = 'telegram_rate_limited'
        or failure_code = 'telegram_unavailable'
        or failure_code = 'network_error'
        or failure_code = 'invalid_response'
      )
    )
    or (
      status = 'sent'
      and sent_at is not null
      and telegram_message_id is not null
      and failure_code is null
      and attempt_count > 0
    )
    or (
      status = 'abandoned'
      and sent_at is null
      and telegram_message_id is null
      and (
        failure_code = 'destination_unavailable'
        or failure_code = 'preference_disabled'
        or failure_code = 'telegram_forbidden'
        or failure_code = 'telegram_bad_request'
        or failure_code = 'retry_exhausted'
      )
    )
  );

revoke all on table backend_auth.account_notification_preferences
  from public, backend_auth_app;

grant select on table backend_auth.account_notification_preferences
  to backend_auth_app;

grant insert (
  account_id,
  telegram_match_notifications_enabled,
  created_at,
  updated_at,
  version
) on backend_auth.account_notification_preferences to backend_auth_app;

grant update (
  telegram_match_notifications_enabled,
  updated_at,
  version
) on backend_auth.account_notification_preferences to backend_auth_app;

do $comments$
begin
  execute pg_catalog.format(
    'comment on table backend_auth.account_notification_preferences is %L',
    '038_backend_account_notification_preferences:'
      || backend_auth.relation_fingerprint(
        'backend_auth.account_notification_preferences'::pg_catalog.regclass
      )
  );
  execute pg_catalog.format(
    'comment on table backend_match.telegram_notification_outbox is %L',
    '038_backend_account_notification_preferences:'
      || backend_auth.relation_fingerprint(
        'backend_match.telegram_notification_outbox'::pg_catalog.regclass
      )
  );
end;
$comments$;

do $assertions$
declare
  v_preference_oid oid :=
    'backend_auth.account_notification_preferences'::pg_catalog.regclass;
  v_outbox_oid oid :=
    'backend_match.telegram_notification_outbox'::pg_catalog.regclass;
begin
  if pg_catalog.pg_get_userbyid((
       select relation.relowner
       from pg_catalog.pg_class relation
       where relation.oid = v_preference_oid
     )) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((
       select relation.relowner
       from pg_catalog.pg_class relation
       where relation.oid = v_outbox_oid
     )) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_ASSERTION_FAILED: relation owner differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_attribute attribute
       where attribute.attrelid = v_preference_oid
         and attribute.attnum > 0
         and not attribute.attisdropped
     ) <> 5
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_preference_oid
     ) <> 4
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_index index_row
       where index_row.indrelid = v_preference_oid
     ) <> 1 then
    raise exception 'MIGRATION_ASSERTION_FAILED: preference catalog count differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = v_preference_oid
      and not trigger_row.tgisinternal
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: unexpected preference trigger exists';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_preference_oid,
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_preference_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_preference_oid,
       'account_id',
       'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_preference_oid,
       'telegram_match_notifications_enabled',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_preference_oid,
       'account_id',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_preference_oid,
       'created_at',
       'UPDATE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: preference application privileges differ';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = v_outbox_oid
      and constraint_row.conname in (
        'telegram_notification_outbox_failure_check',
        'telegram_notification_outbox_state_check'
      )
      and pg_catalog.strpos(
        pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
        'preference_disabled'
      ) = 0
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = v_outbox_oid
      and constraint_row.conname in (
        'telegram_notification_outbox_failure_check',
        'telegram_notification_outbox_state_check'
      )
  ) <> 2 then
    raise exception 'MIGRATION_ASSERTION_FAILED: outbox preference failure contract differs';
  end if;

  if exists (
       select 1
       from backend_auth.account_notification_preferences
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: preference storage is not empty';
  end if;

  if pg_catalog.obj_description(v_preference_oid, 'pg_class') <>
       '038_backend_account_notification_preferences:'
         || backend_auth.relation_fingerprint(
           v_preference_oid::pg_catalog.regclass
         )
     or pg_catalog.obj_description(v_outbox_oid, 'pg_class') <>
       '038_backend_account_notification_preferences:'
         || backend_auth.relation_fingerprint(
           v_outbox_oid::pg_catalog.regclass
         ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 038 fingerprint differs';
  end if;
end;
$assertions$;

reset role;
commit;

select '038_backend_account_notification_preferences applied; run POSTCHECK before any runtime writer'
  as result;
