-- Read-only postcheck for 032_backend_yclients_record_webhook_signals.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_relation_oid oid := pg_catalog.to_regclass(
    'backend_match.yclients_record_webhook_signals'
  );
  v_expected_columns text[] := array[
    'company_id:bigint:NO:',
    'record_id:bigint:NO:',
    'latest_event_type:text:NO:',
    'first_received_at:bigint:NO:',
    'last_received_at:bigint:NO:',
    'delivery_count:bigint:NO:',
    'version:bigint:NO:',
    'reconciled_version:bigint:NO:0',
    'last_reconciled_at:bigint:YES:'
  ];
  v_actual_columns text[];
  v_expected_constraints text[] := array[
    'yclients_record_webhook_signals_count_check:c',
    'yclients_record_webhook_signals_event_check:c',
    'yclients_record_webhook_signals_id_check:c',
    'yclients_record_webhook_signals_pkey:p',
    'yclients_record_webhook_signals_time_check:c',
    'yclients_record_webhook_signals_version_check:c'
  ];
  v_actual_constraints text[];
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
  if v_relation_oid is null then
    raise exception 'POSTCHECK_FAILED: migration 032 table is missing';
  end if;

  select pg_catalog.array_agg(
    attribute.attname || ':'
      || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':'
      || case when attribute.attnotnull then 'NO' else 'YES' end || ':'
      || coalesce(pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid), '')
    order by attribute.attnum
  )
  into v_actual_columns
  from pg_catalog.pg_attribute attribute
  left join pg_catalog.pg_attrdef default_row
    on default_row.adrelid = attribute.attrelid
   and default_row.adnum = attribute.attnum
  where attribute.attrelid = v_relation_oid
    and attribute.attnum > 0
    and not attribute.attisdropped;

  select pg_catalog.array_agg(
    constraint_row.conname || ':' || constraint_row.contype
    order by constraint_row.conname
  )
  into v_actual_constraints
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_relation_oid;

  if v_actual_columns is distinct from v_expected_columns then
    raise exception 'POSTCHECK_FAILED: migration 032 columns differ';
  end if;

  if v_actual_constraints is distinct from v_expected_constraints then
    raise exception 'POSTCHECK_FAILED: migration 032 constraint allowlist differs';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_class relation
       where relation.oid = v_relation_oid
         and relation.relkind = 'r'
         and relation.relpersistence = 'p'
         and not relation.relrowsecurity
         and not relation.relforcerowsecurity
         and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
     )
     or pg_catalog.obj_description(v_relation_oid, 'pg_class') <>
       '032_backend_yclients_record_webhook_signals:'
         || backend_auth.relation_fingerprint(v_relation_oid::pg_catalog.regclass) then
    raise exception 'POSTCHECK_FAILED: migration 032 relation boundary differs';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_index index_row
      where index_row.indrelid = v_relation_oid) <> 2
     or not exists (
       select 1
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_class index_relation
         on index_relation.oid = index_row.indexrelid
       join pg_catalog.pg_am access_method
         on access_method.oid = index_relation.relam
       where index_row.indrelid = v_relation_oid
         and index_relation.relname =
           'yclients_record_webhook_signals_pending_idx'
         and access_method.amname = 'btree'
         and not index_row.indisunique
         and not index_row.indisprimary
         and index_row.indisvalid
         and index_row.indisready
         and index_row.indkey::text = '5 1 2'
         and index_row.indoption::text = '0 0 0'
         and pg_catalog.pg_get_expr(
           index_row.indpred,
           index_row.indrelid
         ) in (
           'reconciled_version < version',
           '(reconciled_version < version)'
         )
     ) then
    raise exception 'POSTCHECK_FAILED: migration 032 index allowlist differs';
  end if;

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

  if not pg_catalog.has_table_privilege(
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
    raise exception 'POSTCHECK_FAILED: migration 032 ACL boundary differs';
  end if;

  if exists (
    select 1 from backend_match.yclients_record_webhook_signals
  ) then
    raise exception 'POSTCHECK_FAILED: migration 032 target must start empty';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '032_backend_yclients_record_webhook_signals',
  'row_counts', pg_catalog.jsonb_build_object(
    'accounts', (select pg_catalog.count(*) from backend_auth.accounts),
    'matches', (select pg_catalog.count(*) from backend_match.matches),
    'yclients_record_webhook_signals', (
      select pg_catalog.count(*)
      from backend_match.yclients_record_webhook_signals
    )
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'accounts', backend_auth.relation_fingerprint(
      'backend_auth.accounts'::pg_catalog.regclass
    ),
    'matches', backend_auth.relation_fingerprint(
      'backend_match.matches'::pg_catalog.regclass
    ),
    'yclients_record_webhook_signals', backend_auth.relation_fingerprint(
      'backend_match.yclients_record_webhook_signals'::pg_catalog.regclass
    )
  ),
  'backend_match_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', (
      select pg_catalog.count(*)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match' and relation.relkind = 'r'
    ),
    'constraints', (
      select pg_catalog.count(*)
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
    ),
    'indexes', (
      select pg_catalog.count(*)
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
    )
  )
) as backend_yclients_record_webhook_signals_postcheck;

rollback;
