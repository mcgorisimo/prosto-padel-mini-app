-- 032_backend_yclients_record_webhook_signals.sql
-- Adds a coalescing inbox for untrusted YCLIENTS record webhook signals.
-- The table deliberately stores no client, phone, comment, service, or visit data.

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
     or pg_catalog.to_regprocedure(
       'backend_auth.relation_fingerprint(regclass)'
     ) is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend schema boundary differs';
  end if;

  if pg_catalog.to_regclass(
       'backend_match.yclients_record_webhook_signals'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.yclients_record_webhook_signals_pkey'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.yclients_record_webhook_signals_pending_idx'
     ) is not null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 032 target already exists';
  end if;

  if pg_catalog.has_schema_privilege('backend_auth_app', 'backend_match', 'CREATE') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: application schema CREATE is unsafe';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_match.yclients_record_webhook_signals (
  company_id bigint not null,
  record_id bigint not null,
  latest_event_type text not null,
  first_received_at bigint not null,
  last_received_at bigint not null,
  delivery_count bigint not null,
  version bigint not null,
  reconciled_version bigint not null default 0,
  last_reconciled_at bigint,
  constraint yclients_record_webhook_signals_pkey
    primary key (company_id, record_id),
  constraint yclients_record_webhook_signals_id_check check (
    company_id between 1 and 9007199254740991
    and record_id between 1 and 9007199254740991
  ),
  constraint yclients_record_webhook_signals_event_check check (
    latest_event_type = 'create'
    or latest_event_type = 'update'
    or latest_event_type = 'delete'
  ),
  constraint yclients_record_webhook_signals_time_check check (
    first_received_at between 0 and 9007199254740991
    and last_received_at between first_received_at and 9007199254740991
    and (
      last_reconciled_at is null
      or last_reconciled_at between first_received_at and 9007199254740991
    )
  ),
  constraint yclients_record_webhook_signals_count_check check (
    delivery_count between 1 and 9007199254740991
  ),
  constraint yclients_record_webhook_signals_version_check check (
    version = delivery_count
    and reconciled_version between 0 and version
    and (
      (reconciled_version = 0 and last_reconciled_at is null)
      or (reconciled_version > 0 and last_reconciled_at is not null)
    )
  )
);

create index yclients_record_webhook_signals_pending_idx
  on backend_match.yclients_record_webhook_signals (
    last_received_at,
    company_id,
    record_id
  )
  where reconciled_version < version;

revoke all on table backend_match.yclients_record_webhook_signals
  from public, backend_auth_app;

grant select on table backend_match.yclients_record_webhook_signals
  to backend_auth_app;

grant insert (
  company_id,
  record_id,
  latest_event_type,
  first_received_at,
  last_received_at,
  delivery_count,
  version
) on backend_match.yclients_record_webhook_signals to backend_auth_app;

grant update (
  latest_event_type,
  last_received_at,
  delivery_count,
  version,
  reconciled_version,
  last_reconciled_at
) on backend_match.yclients_record_webhook_signals to backend_auth_app;

do $fingerprint$
begin
  execute pg_catalog.format(
    'comment on table backend_match.yclients_record_webhook_signals is %L',
    '032_backend_yclients_record_webhook_signals:'
      || backend_auth.relation_fingerprint(
        'backend_match.yclients_record_webhook_signals'::pg_catalog.regclass
      )
  );
end;
$fingerprint$;

do $assertions$
declare
  v_relation_oid oid := pg_catalog.to_regclass(
    'backend_match.yclients_record_webhook_signals'
  );
  v_expected_insert_columns text[] := array[
    'company_id',
    'record_id',
    'latest_event_type',
    'first_received_at',
    'last_received_at',
    'delivery_count',
    'version'
  ];
  v_actual_insert_columns text[];
  v_expected_update_columns text[] := array[
    'latest_event_type',
    'last_received_at',
    'delivery_count',
    'version',
    'reconciled_version',
    'last_reconciled_at'
  ];
  v_actual_update_columns text[];
begin
  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_actual_insert_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = v_relation_oid
    and attribute.attnum > 0
    and not attribute.attisdropped
    and pg_catalog.has_column_privilege(
      'backend_auth_app',
      v_relation_oid,
      attribute.attname,
      'INSERT'
    );

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_actual_update_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = v_relation_oid
    and attribute.attnum > 0
    and not attribute.attisdropped
    and pg_catalog.has_column_privilege(
      'backend_auth_app',
      v_relation_oid,
      attribute.attname,
      'UPDATE'
    );

  if v_relation_oid is null
     or pg_catalog.pg_get_userbyid((
       select relation.relowner
       from pg_catalog.pg_class relation
       where relation.oid = v_relation_oid
     )) <> 'backend_auth_owner'
     or pg_catalog.obj_description(v_relation_oid, 'pg_class') <>
       '032_backend_yclients_record_webhook_signals:'
         || backend_auth.relation_fingerprint(v_relation_oid::pg_catalog.regclass)
     or not pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or pg_catalog.has_table_privilege('public', v_relation_oid, 'SELECT')
     or pg_catalog.has_table_privilege(
       'public',
       v_relation_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or v_actual_insert_columns is distinct from v_expected_insert_columns
     or v_actual_update_columns is distinct from v_expected_update_columns then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 032 boundary differs';
  end if;
end;
$assertions$;

reset role;
commit;

select '032_backend_yclients_record_webhook_signals applied; run POSTCHECK before enabling the YCLIENTS webhook'
  as result;
