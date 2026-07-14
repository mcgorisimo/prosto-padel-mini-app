-- 004_profiles_read_api_PRECHECK.sql
-- Read-only precheck for additive profile read API.
-- Returns one jsonb column and reads PostgreSQL catalogs only.

with expected_profile_columns(column_name, data_type) as (
  values
    ('id', 'uuid'),
    ('first_name', 'text'),
    ('last_name', 'text'),
    ('phone', 'text'),
    ('rating', 'numeric(4,2)'),
    ('is_verified', 'boolean'),
    ('role', 'text'),
    ('side_preference', 'text'),
    ('created_at', 'timestamp with time zone')
),
expected_public_view_columns(column_name, ordinal_position) as (
  values
    ('id', 1),
    ('first_name', 2),
    ('last_name', 3),
    ('username', 4),
    ('photo_url', 5),
    ('rating', 6),
    ('is_verified', 7),
    ('side_preference', 8)
),
private_public_view_columns(column_name) as (
  values
    ('email'),
    ('phone'),
    ('birthday'),
    ('gender'),
    ('role'),
    ('language'),
    ('created_at'),
    ('updated_at')
),
profile_columns as (
  select
    a.attname::text as column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
    a.attnotnull as not_null
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'profiles'
    and a.attnum > 0
    and not a.attisdropped
),
view_columns as (
  select
    a.attname::text as column_name,
    a.attnum as ordinal_position,
    pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'player_public_profiles'
    and a.attnum > 0
    and not a.attisdropped
),
view_relation as (
  select
    c.relkind,
    c.relowner,
    pg_catalog.pg_get_userbyid(c.relowner) as owner,
    c.reloptions,
    c.relacl
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'player_public_profiles'
),
view_acl as (
  select
    bool_or(a.grantee = 0 and a.privilege_type = 'SELECT') as public_select,
    bool_or(r.rolname = 'anon' and a.privilege_type = 'SELECT') as anon_select,
    bool_or(r.rolname = 'authenticated' and a.privilege_type = 'SELECT') as authenticated_select
  from view_relation v
  cross join lateral pg_catalog.aclexplode(coalesce(v.relacl, pg_catalog.acldefault('r', v.relowner))) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
),
profile_policies as (
  select
    policyname as policy_name,
    cmd as command,
    roles,
    qual as using_expression,
    with_check as with_check_expression
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
),
functions as (
  select
    p.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    p.prosecdef as security_definer,
    p.proconfig as config
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('is_admin', 'admin_list_profiles')
)
select jsonb_build_object(
  'precheck',
  jsonb_build_object(
    'is_admin_functions',
      coalesce((select jsonb_agg(to_jsonb(functions) order by identity_arguments) from functions where function_name = 'is_admin'), '[]'::jsonb),
    'admin_list_profiles_existing_overloads',
      coalesce((select jsonb_agg(to_jsonb(functions) order by identity_arguments) from functions where function_name = 'admin_list_profiles'), '[]'::jsonb),
    'profiles_columns',
      coalesce((select jsonb_agg(to_jsonb(profile_columns) order by column_name) from profile_columns), '[]'::jsonb),
    'profiles_expected_columns_present',
      not exists (
        select 1
        from expected_profile_columns e
        left join profile_columns c on c.column_name = e.column_name and c.data_type = e.data_type
        where c.column_name is null
      ),
    'profiles_policies',
      coalesce((select jsonb_agg(to_jsonb(profile_policies) order by policy_name) from profile_policies), '[]'::jsonb),
    'profiles_select_authenticated_exists',
      exists (
        select 1
        from profile_policies
        where policy_name = 'profiles_select_authenticated'
          and command = 'SELECT'
      ),
    'player_public_profiles_relation',
      coalesce((select jsonb_agg(to_jsonb(view_relation)) from view_relation), '[]'::jsonb),
    'player_public_profiles_columns',
      coalesce((select jsonb_agg(to_jsonb(view_columns) order by ordinal_position) from view_columns), '[]'::jsonb),
    'player_public_profiles_exact_columns',
      (
        select array_agg(column_name order by ordinal_position)
        from view_columns
      ) = (
        select array_agg(column_name order by ordinal_position)
        from expected_public_view_columns
      ),
    'player_public_profiles_private_column_count',
      (
        select count(*)
        from view_columns v
        join private_public_view_columns p on p.column_name = v.column_name
      ),
    'player_public_profiles_grants',
      jsonb_build_object(
        'public_select', coalesce((select public_select from view_acl), false),
        'anon_select', coalesce((select anon_select from view_acl), false),
        'authenticated_select', coalesce((select authenticated_select from view_acl), false)
      ),
    'precheck_ok',
      (
        exists (select 1 from functions where function_name = 'is_admin' and identity_arguments = '')
        and not exists (select 1 from functions where function_name = 'admin_list_profiles')
        and not exists (
          select 1
          from expected_profile_columns e
          left join profile_columns c on c.column_name = e.column_name and c.data_type = e.data_type
          where c.column_name is null
        )
        and exists (
          select 1
          from profile_policies
          where policy_name = 'profiles_select_authenticated'
            and command = 'SELECT'
        )
        and (
          select array_agg(column_name order by ordinal_position)
          from view_columns
        ) = (
          select array_agg(column_name order by ordinal_position)
          from expected_public_view_columns
        )
        and (
          select count(*)
          from view_columns v
          join private_public_view_columns p on p.column_name = v.column_name
        ) = 0
        and not coalesce((select public_select from view_acl), false)
        and not coalesce((select anon_select from view_acl), false)
        and coalesce((select authenticated_select from view_acl), false)
      )
  )
) as profiles_read_api_precheck;
