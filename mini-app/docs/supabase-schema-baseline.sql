with excluded_schemas(schema_name) as (
  values
    ('pg_catalog'),
    ('information_schema'),
    ('auth'),
    ('storage'),
    ('extensions'),
    ('realtime'),
    ('supabase_functions'),
    ('vault')
),
user_schemas as (
  select n.oid, n.nspname
  from pg_catalog.pg_namespace n
  where n.nspname not like 'pg_%'
    and not exists (
      select 1
      from excluded_schemas e
      where e.schema_name = n.nspname
    )
),
schema_rows as (
  select
    s.nspname as schema_name,
    pg_catalog.pg_get_userbyid(n.nspowner) as owner
  from user_schemas s
  join pg_catalog.pg_namespace n on n.oid = s.oid
),
relation_rows as (
  select
    s.nspname as schema_name,
    c.relname as relation_name,
    case c.relkind
      when 'r' then 'table'
      when 'p' then 'partitioned_table'
      when 'v' then 'view'
      when 'm' then 'materialized_view'
      when 'f' then 'foreign_table'
      else c.relkind::text
    end as relation_type,
    pg_catalog.pg_get_userbyid(c.relowner) as owner,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced
  from pg_catalog.pg_class c
  join user_schemas s on s.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
),
column_rows as (
  select
    s.nspname as schema_name,
    c.relname as relation_name,
    a.attname as column_name,
    a.attnum as ordinal_position,
    pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
    a.atttypid::regtype::text as database_type,
    not a.attnotnull as nullable,
    pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) as default_value,
    nullif(a.attidentity, '') as identity_kind,
    nullif(a.attgenerated, '') as generated_kind
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join user_schemas s on s.oid = c.relnamespace
  left join pg_catalog.pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  where a.attnum > 0
    and not a.attisdropped
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
),
custom_type_rows as (
  select
    s.nspname as schema_name,
    t.typname as type_name,
    case t.typtype
      when 'e' then 'enum'
      when 'd' then 'domain'
      when 'c' then 'composite'
      when 'r' then 'range'
      when 'm' then 'multirange'
      else t.typtype::text
    end as type_kind,
    pg_catalog.format_type(t.typbasetype, t.typtypmod) as base_type,
    array_agg(e.enumlabel order by e.enumsortorder) filter (where e.enumlabel is not null) as enum_values
  from pg_catalog.pg_type t
  join user_schemas s on s.oid = t.typnamespace
  left join pg_catalog.pg_class c on c.oid = t.typrelid
  left join pg_catalog.pg_enum e on e.enumtypid = t.oid
  where t.typtype in ('e', 'd', 'c', 'r', 'm')
    and (t.typtype <> 'c' or c.relkind = 'c')
  group by s.nspname, t.typname, t.typtype, t.typbasetype, t.typtypmod
),
constraint_rows as (
  select
    s.nspname as schema_name,
    c.relname as relation_name,
    con.conname as constraint_name,
    case con.contype
      when 'p' then 'primary_key'
      when 'f' then 'foreign_key'
      when 'u' then 'unique'
      when 'c' then 'check'
      when 'x' then 'exclusion'
      else con.contype::text
    end as constraint_type,
    pg_catalog.pg_get_constraintdef(con.oid, true) as constraint_definition
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class c on c.oid = con.conrelid
  join user_schemas s on s.oid = c.relnamespace
),
foreign_key_rows as (
  select
    src_schema.nspname as source_schema,
    src_table.relname as source_table,
    array_agg(src_column.attname order by key_position.ordinal_position) as source_columns,
    target_schema.nspname as target_schema,
    target_table.relname as target_table,
    array_agg(target_column.attname order by key_position.ordinal_position) as target_columns,
    case con.confupdtype
      when 'a' then 'no_action'
      when 'r' then 'restrict'
      when 'c' then 'cascade'
      when 'n' then 'set_null'
      when 'd' then 'set_default'
      else con.confupdtype::text
    end as update_rule,
    case con.confdeltype
      when 'a' then 'no_action'
      when 'r' then 'restrict'
      when 'c' then 'cascade'
      when 'n' then 'set_null'
      when 'd' then 'set_default'
      else con.confdeltype::text
    end as delete_rule,
    con.conname as constraint_name,
    pg_catalog.pg_get_constraintdef(con.oid, true) as constraint_definition
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class src_table on src_table.oid = con.conrelid
  join user_schemas src_schema on src_schema.oid = src_table.relnamespace
  join pg_catalog.pg_class target_table on target_table.oid = con.confrelid
  join pg_catalog.pg_namespace target_schema on target_schema.oid = target_table.relnamespace
  join lateral generate_subscripts(con.conkey, 1) as key_position(ordinal_position) on true
  join pg_catalog.pg_attribute src_column
    on src_column.attrelid = con.conrelid
   and src_column.attnum = con.conkey[key_position.ordinal_position]
  join pg_catalog.pg_attribute target_column
    on target_column.attrelid = con.confrelid
   and target_column.attnum = con.confkey[key_position.ordinal_position]
  where con.contype = 'f'
  group by
    src_schema.nspname,
    src_table.relname,
    target_schema.nspname,
    target_table.relname,
    con.conname,
    con.oid,
    con.confupdtype,
    con.confdeltype
),
index_rows as (
  select
    s.nspname as schema_name,
    tbl.relname as relation_name,
    idx.relname as index_name,
    i.indisunique as is_unique,
    i.indisprimary as is_primary,
    pg_catalog.pg_get_indexdef(i.indexrelid) as index_definition
  from pg_catalog.pg_index i
  join pg_catalog.pg_class idx on idx.oid = i.indexrelid
  join pg_catalog.pg_class tbl on tbl.oid = i.indrelid
  join user_schemas s on s.oid = tbl.relnamespace
),
rls_rows as (
  select
    s.nspname as schema_name,
    c.relname as relation_name,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced
  from pg_catalog.pg_class c
  join user_schemas s on s.oid = c.relnamespace
  where c.relkind in ('r', 'p')
),
policy_rows as (
  select
    p.schemaname as schema_name,
    p.tablename as relation_name,
    p.policyname as policy_name,
    p.cmd as command,
    p.roles,
    p.permissive,
    p.qual as using_expression,
    p.with_check as with_check_expression
  from pg_catalog.pg_policies p
  join user_schemas s on s.nspname = p.schemaname
),
function_rows as (
  select
    s.nspname as schema_name,
    p.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    l.lanname as language,
    p.prosecdef as security_definer,
    p.provolatile as volatility,
    pg_catalog.pg_get_functiondef(p.oid) as function_definition,
    p.oid as function_oid
  from pg_catalog.pg_proc p
  join user_schemas s on s.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.prokind in ('f', 'p')
),
function_argument_rows as (
  select
    s.nspname as schema_name,
    p.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    arg.ordinal_position,
    coalesce(p.proargnames[arg.ordinal_position], '') as argument_name,
    coalesce(p.proargmodes[arg.ordinal_position], 'i') as argument_mode,
    pg_catalog.format_type(
      case
        when p.proallargtypes is not null then p.proallargtypes[arg.ordinal_position]
        else p.proargtypes[arg.ordinal_position - 1]
      end,
      null::integer
    ) as data_type
  from pg_catalog.pg_proc p
  join user_schemas s on s.oid = p.pronamespace
  cross join lateral generate_series(
    1,
    greatest(
      coalesce(array_length(p.proallargtypes, 1), 0),
      coalesce(array_length(p.proargnames, 1), 0),
      coalesce(array_length(p.proargmodes, 1), 0),
      p.pronargs
    )
  ) as arg(ordinal_position)
  where p.prokind in ('f', 'p')
),
trigger_rows as (
  select
    s.nspname as schema_name,
    c.relname as relation_name,
    t.tgname as trigger_name,
    t.tgenabled as enabled_status,
    pg_catalog.pg_get_triggerdef(t.oid, true) as trigger_definition,
    trigger_schema.nspname as function_schema,
    trigger_function.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(trigger_function.oid) as function_identity_arguments
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join user_schemas s on s.oid = c.relnamespace
  join pg_catalog.pg_proc trigger_function on trigger_function.oid = t.tgfoid
  join pg_catalog.pg_namespace trigger_schema on trigger_schema.oid = trigger_function.pronamespace
  where not t.tgisinternal
)
select jsonb_build_object(
  'project_info',
    jsonb_build_object(
      'database_name', current_database(),
      'generated_at', now(),
      'source', 'postgres_system_catalogs',
      'included_schemas', coalesce(
        (
          select jsonb_agg(schema_name order by schema_name)
          from schema_rows
        ),
        '[]'::jsonb
      ),
      'excluded_schemas', coalesce(
        (
          select jsonb_agg(schema_name order by schema_name)
          from excluded_schemas
        ),
        '[]'::jsonb
      )
    ),
  'schemas',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', schema_name,
            'owner', owner
          )
          order by schema_name
        )
        from schema_rows
      ),
      '[]'::jsonb
    ),
  'tables',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', schema_name,
            'table_name', relation_name,
            'relation_type', relation_type,
            'owner', owner,
            'rls_enabled', rls_enabled,
            'rls_forced', rls_forced
          )
          order by schema_name, relation_name
        )
        from relation_rows
      ),
      '[]'::jsonb
    ),
  'columns',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', schema_name,
            'table', relation_name,
            'column', column_name,
            'ordinal_position', ordinal_position,
            'data_type', data_type,
            'database_type', database_type,
            'nullable', nullable,
            'default_value', default_value,
            'identity', identity_kind,
            'generated', generated_kind
          )
          order by schema_name, relation_name, ordinal_position
        )
        from column_rows
      ),
      '[]'::jsonb
    ),
  'custom_types',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', schema_name,
            'type_name', type_name,
            'type_kind', type_kind,
            'base_type', base_type,
            'enum_values', coalesce(to_jsonb(enum_values), '[]'::jsonb)
          )
          order by schema_name, type_name
        )
        from custom_type_rows
      ),
      '[]'::jsonb
    ),
  'constraints',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', schema_name,
            'table', relation_name,
            'constraint_name', constraint_name,
            'type', constraint_type,
            'definition', constraint_definition
          )
          order by schema_name, relation_name, constraint_name
        )
        from constraint_rows
      ),
      '[]'::jsonb
    ),
  'foreign_keys',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'constraint_name', constraint_name,
            'source_schema', source_schema,
            'source_table', source_table,
            'source_columns', to_jsonb(source_columns),
            'target_schema', target_schema,
            'target_table', target_table,
            'target_columns', to_jsonb(target_columns),
            'update_rule', update_rule,
            'delete_rule', delete_rule,
            'definition', constraint_definition
          )
          order by source_schema, source_table, constraint_name
        )
        from foreign_key_rows
      ),
      '[]'::jsonb
    ),
  'indexes',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', schema_name,
            'table', relation_name,
            'index_name', index_name,
            'unique', is_unique,
            'primary', is_primary,
            'definition', index_definition
          )
          order by schema_name, relation_name, index_name
        )
        from index_rows
      ),
      '[]'::jsonb
    ),
  'rls_status',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', schema_name,
            'table', relation_name,
            'rls_enabled', rls_enabled,
            'rls_forced', rls_forced
          )
          order by schema_name, relation_name
        )
        from rls_rows
      ),
      '[]'::jsonb
    ),
  'policies',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', schema_name,
            'table', relation_name,
            'policy_name', policy_name,
            'command', command,
            'roles', to_jsonb(roles),
            'permissive', permissive,
            'using_expression', using_expression,
            'with_check_expression', with_check_expression
          )
          order by schema_name, relation_name, policy_name
        )
        from policy_rows
      ),
      '[]'::jsonb
    ),
  'functions',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', schema_name,
            'function_name', function_name,
            'identity_arguments', identity_arguments,
            'result_type', result_type,
            'language', language,
            'security_definer', security_definer,
            'volatility', volatility,
            'definition', function_definition
          )
          order by schema_name, function_name, identity_arguments
        )
        from function_rows
      ),
      '[]'::jsonb
    ),
  'function_arguments',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', schema_name,
            'function_name', function_name,
            'identity_arguments', identity_arguments,
            'ordinal_position', ordinal_position,
            'argument_name', argument_name,
            'argument_mode', argument_mode,
            'data_type', data_type
          )
          order by schema_name, function_name, identity_arguments, ordinal_position
        )
        from function_argument_rows
      ),
      '[]'::jsonb
    ),
  'triggers',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', schema_name,
            'table', relation_name,
            'trigger_name', trigger_name,
            'enabled_status', enabled_status,
            'definition', trigger_definition,
            'linked_function', jsonb_build_object(
              'schema', function_schema,
              'function_name', function_name,
              'identity_arguments', function_identity_arguments
            )
          )
          order by schema_name, relation_name, trigger_name
        )
        from trigger_rows
      ),
      '[]'::jsonb
    )
) as schema_baseline;
