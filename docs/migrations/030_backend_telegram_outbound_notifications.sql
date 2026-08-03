-- 030_backend_telegram_outbound_notifications.sql
-- Adds private delivery destinations and a durable Telegram delivery outbox.
-- This storage-only migration does not contact Telegram or change runtime behavior.

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
      ('backend_match', 'match_invitations', '021_backend_match_invitations'),
      ('backend_match', 'match_notifications', '029_backend_match_notifications')
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
    where (namespace.nspname, relation.relname) in (
      ('backend_auth', 'telegram_notification_destinations'),
      ('backend_auth', 'telegram_notification_destinations_pkey'),
      ('backend_auth', 'telegram_notification_destinations_chat_key'),
      ('backend_match', 'telegram_notification_outbox'),
      ('backend_match', 'telegram_notification_outbox_pkey'),
      ('backend_match', 'telegram_notification_outbox_notification_key'),
      ('backend_match', 'telegram_notification_outbox_invitation_key'),
      ('backend_match', 'telegram_notification_outbox_pending_idx')
    )
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 030 target object already exists';
  end if;

  if pg_catalog.has_schema_privilege('backend_auth_app', 'backend_match', 'CREATE')
     or pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'CREATE') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: application schema CREATE is unsafe';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_auth.telegram_notification_destinations (
  account_id uuid not null,
  telegram_chat_id bigint not null,
  status text not null,
  permission_granted_at bigint not null,
  updated_at bigint not null,
  disabled_at bigint,
  disable_reason text,
  version bigint not null,
  constraint telegram_notification_destinations_pkey primary key (account_id),
  constraint telegram_notification_destinations_chat_key unique (telegram_chat_id),
  constraint telegram_notification_destinations_account_id_fkey
    foreign key (account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint telegram_notification_destinations_chat_check check (
    telegram_chat_id between 1 and 9007199254740991
  ),
  constraint telegram_notification_destinations_status_check check (
    status = 'enabled' or status = 'disabled'
  ),
  constraint telegram_notification_destinations_reason_check check (
    disable_reason is null
    or disable_reason = 'user_revoked'
    or disable_reason = 'telegram_forbidden'
    or disable_reason = 'invalid_destination'
  ),
  constraint telegram_notification_destinations_time_check check (
    permission_granted_at between 0 and 9007199254740991
    and updated_at between permission_granted_at and 9007199254740991
    and (
      disabled_at is null
      or disabled_at between permission_granted_at and updated_at
    )
  ),
  constraint telegram_notification_destinations_state_check check (
    (status = 'enabled' and disabled_at is null and disable_reason is null)
    or (
      status = 'disabled'
      and disabled_at is not null
      and disable_reason is not null
    )
  ),
  constraint telegram_notification_destinations_version_check check (
    version between 1 and 9007199254740991
  )
);

create table backend_match.telegram_notification_outbox (
  id uuid not null,
  source_type text not null,
  match_notification_id uuid,
  invitation_id uuid,
  created_at bigint not null,
  available_at bigint not null,
  status text not null,
  attempt_count integer not null,
  updated_at bigint not null,
  sent_at bigint,
  telegram_message_id bigint,
  failure_code text,
  version bigint not null,
  constraint telegram_notification_outbox_pkey primary key (id),
  constraint telegram_notification_outbox_match_notification_fkey
    foreign key (match_notification_id)
    references backend_match.match_notifications (id)
    on update no action on delete no action not deferrable,
  constraint telegram_notification_outbox_invitation_fkey
    foreign key (invitation_id)
    references backend_match.match_invitations (id)
    on update no action on delete no action not deferrable,
  constraint telegram_notification_outbox_source_check check (
    (
      source_type = 'match_notification'
      and match_notification_id is not null
      and invitation_id is null
    )
    or (
      source_type = 'match_invitation'
      and match_notification_id is null
      and invitation_id is not null
    )
  ),
  constraint telegram_notification_outbox_status_check check (
    status = 'pending' or status = 'sent' or status = 'abandoned'
  ),
  constraint telegram_notification_outbox_attempt_check check (
    attempt_count between 0 and 20
  ),
  constraint telegram_notification_outbox_time_check check (
    created_at between 0 and 9007199254740991
    and available_at between created_at and 9007199254740991
    and updated_at between created_at and 9007199254740991
    and (sent_at is null or sent_at between created_at and updated_at)
  ),
  constraint telegram_notification_outbox_message_check check (
    telegram_message_id is null
    or telegram_message_id between 1 and 9007199254740991
  ),
  constraint telegram_notification_outbox_failure_check check (
    failure_code is null
    or failure_code = 'destination_unavailable'
    or failure_code = 'telegram_forbidden'
    or failure_code = 'telegram_bad_request'
    or failure_code = 'telegram_rate_limited'
    or failure_code = 'telegram_unavailable'
    or failure_code = 'network_error'
    or failure_code = 'invalid_response'
    or failure_code = 'retry_exhausted'
  ),
  constraint telegram_notification_outbox_state_check check (
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
        or failure_code = 'telegram_forbidden'
        or failure_code = 'telegram_bad_request'
        or failure_code = 'retry_exhausted'
      )
    )
  ),
  constraint telegram_notification_outbox_version_check check (
    version between 1 and 9007199254740991
  )
);

create unique index telegram_notification_outbox_notification_key
  on backend_match.telegram_notification_outbox (match_notification_id)
  where match_notification_id is not null;

create unique index telegram_notification_outbox_invitation_key
  on backend_match.telegram_notification_outbox (invitation_id)
  where invitation_id is not null;

create index telegram_notification_outbox_pending_idx
  on backend_match.telegram_notification_outbox (available_at, created_at, id)
  where status = 'pending';

revoke all on table backend_auth.telegram_notification_destinations
  from public, backend_auth_app;
revoke all on table backend_match.telegram_notification_outbox
  from public, backend_auth_app;

grant select on table backend_auth.telegram_notification_destinations
  to backend_auth_app;
grant insert (
  account_id,
  telegram_chat_id,
  status,
  permission_granted_at,
  updated_at,
  version
) on backend_auth.telegram_notification_destinations to backend_auth_app;
grant update (
  telegram_chat_id,
  status,
  permission_granted_at,
  updated_at,
  disabled_at,
  disable_reason,
  version
) on backend_auth.telegram_notification_destinations to backend_auth_app;

grant select on table backend_match.telegram_notification_outbox
  to backend_auth_app;
grant insert (
  id,
  source_type,
  match_notification_id,
  invitation_id,
  created_at,
  available_at,
  status,
  attempt_count,
  updated_at,
  version
) on backend_match.telegram_notification_outbox to backend_auth_app;
grant update (
  available_at,
  status,
  attempt_count,
  updated_at,
  sent_at,
  telegram_message_id,
  failure_code,
  version
) on backend_match.telegram_notification_outbox to backend_auth_app;

do $comments$
begin
  execute pg_catalog.format(
    'comment on table backend_auth.telegram_notification_destinations is %L',
    '030_backend_telegram_outbound_notifications:'
      || backend_auth.relation_fingerprint(
        'backend_auth.telegram_notification_destinations'::pg_catalog.regclass
      )
  );
  execute pg_catalog.format(
    'comment on table backend_match.telegram_notification_outbox is %L',
    '030_backend_telegram_outbound_notifications:'
      || backend_auth.relation_fingerprint(
        'backend_match.telegram_notification_outbox'::pg_catalog.regclass
      )
  );
end;
$comments$;

do $assertions$
declare
  v_destination_oid oid :=
    'backend_auth.telegram_notification_destinations'::pg_catalog.regclass;
  v_outbox_oid oid :=
    'backend_match.telegram_notification_outbox'::pg_catalog.regclass;
begin
  if pg_catalog.pg_get_userbyid((
       select relation.relowner from pg_catalog.pg_class relation
       where relation.oid = v_destination_oid
     )) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((
       select relation.relowner from pg_catalog.pg_class relation
       where relation.oid = v_outbox_oid
     )) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_ASSERTION_FAILED: relation owner differs';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_attribute attribute
      where attribute.attrelid = v_destination_oid
        and attribute.attnum > 0 and not attribute.attisdropped) <> 8
     or (select pg_catalog.count(*) from pg_catalog.pg_attribute attribute
      where attribute.attrelid = v_outbox_oid
        and attribute.attnum > 0 and not attribute.attisdropped) <> 13 then
    raise exception 'MIGRATION_ASSERTION_FAILED: column count differs';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = v_destination_oid) <> 9
     or (select pg_catalog.count(*) from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = v_outbox_oid) <> 11 then
    raise exception 'MIGRATION_ASSERTION_FAILED: constraint count differs';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_index index_row
      where index_row.indrelid = v_destination_oid) <> 2
     or (select pg_catalog.count(*) from pg_catalog.pg_index index_row
      where index_row.indrelid = v_outbox_oid) <> 4 then
    raise exception 'MIGRATION_ASSERTION_FAILED: index count differs';
  end if;

  if exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid in (v_destination_oid, v_outbox_oid)
      and not trigger_row.tgisinternal
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: unexpected user trigger exists';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app', v_destination_oid, 'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_destination_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_destination_oid, 'account_id', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_destination_oid, 'disable_reason', 'UPDATE'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app', v_outbox_oid, 'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_outbox_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_outbox_oid, 'id', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_outbox_oid, 'failure_code', 'UPDATE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: application privileges differ';
  end if;

  if exists (select 1 from backend_auth.telegram_notification_destinations)
     or exists (select 1 from backend_match.telegram_notification_outbox) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 030 storage is not empty';
  end if;

  if pg_catalog.obj_description(v_destination_oid, 'pg_class') <>
       '030_backend_telegram_outbound_notifications:'
         || backend_auth.relation_fingerprint(v_destination_oid::pg_catalog.regclass)
     or pg_catalog.obj_description(v_outbox_oid, 'pg_class') <>
       '030_backend_telegram_outbound_notifications:'
         || backend_auth.relation_fingerprint(v_outbox_oid::pg_catalog.regclass) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 030 fingerprint differs';
  end if;
end;
$assertions$;

reset role;
commit;

select '030_backend_telegram_outbound_notifications applied; run POSTCHECK before backend rollout'
  as result;
