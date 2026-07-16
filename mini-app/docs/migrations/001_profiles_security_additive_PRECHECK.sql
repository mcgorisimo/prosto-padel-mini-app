-- 001_profiles_security_additive_PRECHECK.sql
-- Read-only precheck for the additive profiles security stage.
-- Run before 001_profiles_security_additive.sql. This query reads PostgreSQL
-- catalogs only and returns one jsonb column.

with expected_columns(column_name, expected_data_type, expected_nullable, expected_default) as (
  values
    ('id', 'uuid', false, null),
    ('created_at', 'timestamp with time zone', false, 'now()'),
    ('updated_at', 'timestamp with time zone', false, 'now()'),
    ('first_name', 'text', false, null),
    ('last_name', 'text', false, $q$''::text$q$),
    ('email', 'text', true, null),
    ('phone', 'text', true, null),
    ('username', 'text', true, null),
    ('photo_url', 'text', true, null),
    ('role', 'text', false, $q$'user'::text$q$),
    ('rating', 'numeric(4,2)', false, '3.00'),
    ('is_verified', 'boolean', false, 'false'),
    ('side_preference', 'text', true, null),
    ('birthday', 'date', true, null),
    ('gender', 'text', true, null),
    ('language', 'text', true, $q$'RU'::text$q$)
),
actual_columns as (
  select
    a.attname as column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
    not a.attnotnull as nullable,
    pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) as default_value
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  left join pg_catalog.pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
  where n.nspname = 'public'
    and c.relname = 'profiles'
    and a.attnum > 0
    and not a.attisdropped
),
column_checks as (
  select
    e.column_name,
    e.expected_data_type,
    a.data_type as actual_data_type,
    e.expected_nullable,
    a.nullable as actual_nullable,
    e.expected_default,
    a.default_value as actual_default,
    a.column_name is not null as exists,
    (
      a.column_name is not null
      and a.data_type = e.expected_data_type
      and a.nullable = e.expected_nullable
      and (
        e.expected_default is null
        or a.default_value = e.expected_default
      )
    ) as ok
  from expected_columns e
  left join actual_columns a on a.column_name = e.column_name
),
constraint_checks as (
  select
    con.conname as constraint_name,
    case con.contype
      when 'p' then 'primary_key'
      when 'f' then 'foreign_key'
      when 'c' then 'check'
      else con.contype::text
    end as constraint_type,
    pg_catalog.pg_get_constraintdef(con.oid, true) as definition
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class c on c.oid = con.conrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'profiles'
),
policy_checks as (
  select
    p.policyname,
    p.cmd,
    p.roles,
    p.qual,
    p.with_check
  from pg_catalog.pg_policies p
  where p.schemaname = 'public'
    and p.tablename = 'profiles'
),
function_checks as (
  select
    p.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.prosecdef as security_definer,
    p.proconfig as config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'is_admin',
      'get_my_profile',
      'update_my_profile',
      'admin_update_profile_security',
      'profiles_security_is_privileged',
      'profiles_security_guard_insert',
      'profiles_security_guard_update'
    )
),
trigger_checks as (
  select
    t.tgname as trigger_name,
    t.tgenabled as enabled_status,
    pg_catalog.pg_get_triggerdef(t.oid, true) as definition
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'profiles'
    and not t.tgisinternal
)
select jsonb_build_object(
  'precheck',
  jsonb_build_object(
    'profiles_table_exists', to_regclass('public.profiles') is not null,
    'profiles_rls_enabled', coalesce(
      (
        select c.relrowsecurity
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'profiles'
      ),
      false
    ),
    'columns',
      coalesce(
        (
          select jsonb_agg(to_jsonb(column_checks) order by column_name)
          from column_checks
        ),
        '[]'::jsonb
      ),
    'constraints',
      coalesce(
        (
          select jsonb_agg(to_jsonb(constraint_checks) order by constraint_name)
          from constraint_checks
        ),
        '[]'::jsonb
      ),
    'existing_policies',
      coalesce(
        (
          select jsonb_agg(to_jsonb(policy_checks) order by policyname)
          from policy_checks
        ),
        '[]'::jsonb
      ),
    'existing_relevant_functions',
      coalesce(
        (
          select jsonb_agg(to_jsonb(function_checks) order by function_name, identity_arguments)
          from function_checks
        ),
        '[]'::jsonb
      ),
    'existing_profiles_triggers',
      coalesce(
        (
          select jsonb_agg(to_jsonb(trigger_checks) order by trigger_name)
          from trigger_checks
        ),
        '[]'::jsonb
      ),
    'player_public_profiles_exists', to_regclass('public.player_public_profiles') is not null,
    'migration_can_be_reviewed', (
      to_regclass('public.profiles') is not null
      and not exists (select 1 from column_checks where not ok)
      and exists (
        select 1
        from constraint_checks
        where constraint_name = 'profiles_rating_check'
          and definition = 'CHECK (rating >= 0::numeric AND rating <= 10::numeric)'
      )
      and exists (
        select 1
        from constraint_checks
        where constraint_name = 'profiles_role_check'
          and definition = 'CHECK (role = ANY (ARRAY[''user''::text, ''admin''::text]))'
      )
      and exists (
        select 1
        from function_checks
        where function_name = 'is_admin'
          and identity_arguments = ''
          and security_definer = true
      )
    )
  )
) as profiles_security_additive_precheck;
