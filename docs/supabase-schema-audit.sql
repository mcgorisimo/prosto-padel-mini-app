-- Supabase schema audit for Prosto Padel mini-app.
-- Read-only: this file contains SELECT statements against PostgreSQL system catalogs only.
-- It does not read table data and must not be used with db push/reset.

-- 1. Schemas.
select
  'schemas' as section,
  n.nspname as schema_name,
  pg_catalog.pg_get_userbyid(n.nspowner) as owner
from pg_catalog.pg_namespace n
where n.nspname not like 'pg_%'
  and n.nspname <> 'information_schema'
order by n.nspname;

-- 2. Tables and views, including RLS flags.
select
  'relations' as section,
  n.nspname as schema_name,
  c.relname as relation_name,
  case c.relkind
    when 'r' then 'table'
    when 'p' then 'partitioned_table'
    when 'v' then 'view'
    when 'm' then 'materialized_view'
    when 'f' then 'foreign_table'
    else c.relkind::text
  end as relation_type,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  obj_description(c.oid, 'pg_class') as comment
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm', 'f')
  and n.nspname not like 'pg_%'
  and n.nspname <> 'information_schema'
order by n.nspname, c.relname;

-- 3. Columns, types, nullable/default, generated and identity flags.
select
  'columns' as section,
  n.nspname as schema_name,
  c.relname as relation_name,
  a.attnum as ordinal_position,
  a.attname as column_name,
  pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
  not a.attnotnull as is_nullable,
  pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) as column_default,
  a.attidentity as identity_kind,
  a.attgenerated as generated_kind,
  col_description(a.attrelid, a.attnum) as comment
from pg_catalog.pg_attribute a
join pg_catalog.pg_class c on c.oid = a.attrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
left join pg_catalog.pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
where a.attnum > 0
  and not a.attisdropped
  and c.relkind in ('r', 'p', 'v', 'm', 'f')
  and n.nspname not like 'pg_%'
  and n.nspname <> 'information_schema'
order by n.nspname, c.relname, a.attnum;

-- 4. User-defined types, including enums/domains/composites.
select
  'types' as section,
  n.nspname as schema_name,
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
join pg_catalog.pg_namespace n on n.oid = t.typnamespace
left join pg_catalog.pg_enum e on e.enumtypid = t.oid
where n.nspname not like 'pg_%'
  and n.nspname <> 'information_schema'
  and t.typtype in ('e', 'd', 'c', 'r', 'm')
group by n.nspname, t.typname, t.typtype, t.typbasetype, t.typtypmod
order by n.nspname, t.typname;

-- 5. Constraints: primary keys, foreign keys, unique and check constraints.
select
  'constraints' as section,
  n.nspname as schema_name,
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
join pg_catalog.pg_namespace n on n.oid = con.connamespace
where n.nspname not like 'pg_%'
  and n.nspname <> 'information_schema'
order by n.nspname, c.relname, con.conname;

-- 6. Indexes.
select
  'indexes' as section,
  ns.nspname as schema_name,
  tbl.relname as relation_name,
  idx.relname as index_name,
  i.indisprimary as is_primary,
  i.indisunique as is_unique,
  i.indisvalid as is_valid,
  pg_catalog.pg_get_indexdef(i.indexrelid) as index_definition
from pg_catalog.pg_index i
join pg_catalog.pg_class idx on idx.oid = i.indexrelid
join pg_catalog.pg_class tbl on tbl.oid = i.indrelid
join pg_catalog.pg_namespace ns on ns.oid = tbl.relnamespace
where ns.nspname not like 'pg_%'
  and ns.nspname <> 'information_schema'
order by ns.nspname, tbl.relname, idx.relname;

-- 7. RLS policies.
select
  'policies' as section,
  schemaname as schema_name,
  tablename as relation_name,
  policyname as policy_name,
  permissive,
  roles,
  cmd,
  qual as using_expression,
  with_check as with_check_expression
from pg_catalog.pg_policies
where schemaname not like 'pg_%'
  and schemaname <> 'information_schema'
order by schemaname, tablename, policyname;

-- 8. Functions and RPC candidates.
select
  'functions' as section,
  n.nspname as schema_name,
  p.proname as function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
  pg_catalog.pg_get_function_arguments(p.oid) as arguments,
  pg_catalog.pg_get_function_result(p.oid) as return_type,
  l.lanname as language,
  p.provolatile as volatility,
  p.prosecdef as security_definer,
  p.prosrc as function_source
from pg_catalog.pg_proc p
join pg_catalog.pg_namespace n on n.oid = p.pronamespace
join pg_catalog.pg_language l on l.oid = p.prolang
where n.nspname not like 'pg_%'
  and n.nspname <> 'information_schema'
order by n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid);

-- 9. Triggers.
select
  'triggers' as section,
  n.nspname as schema_name,
  c.relname as relation_name,
  t.tgname as trigger_name,
  t.tgenabled as enabled_state,
  p.proname as function_name,
  pg_catalog.pg_get_triggerdef(t.oid, true) as trigger_definition
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
join pg_catalog.pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and n.nspname not like 'pg_%'
  and n.nspname <> 'information_schema'
order by n.nspname, c.relname, t.tgname;
