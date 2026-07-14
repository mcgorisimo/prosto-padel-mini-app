-- 004_profiles_read_api_POSTCHECK.sql
-- Read-only postcheck for public.admin_list_profiles(p_search text, p_filter text).
-- Returns one jsonb column and reads PostgreSQL catalogs only.

with expected_function(function_name, identity_arguments, result_type) as (
  values (
    'admin_list_profiles',
    'p_search text, p_filter text',
    'TABLE(id uuid, first_name text, last_name text, phone text, rating numeric, is_verified boolean, role text, side_preference text, created_at timestamp with time zone)'
  )
),
function_catalog as (
  select
    p.oid,
    p.proowner,
    p.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    p.prosecdef as security_definer,
    p.proconfig as config,
    p.proacl,
    p.pronargs
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'admin_list_profiles'
),
function_acl as (
  select
    f.function_name,
    f.identity_arguments,
    bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute,
    bool_or(r.rolname = 'anon' and a.privilege_type = 'EXECUTE') as anon_execute,
    bool_or(r.rolname = 'authenticated' and a.privilege_type = 'EXECUTE') as authenticated_execute
  from function_catalog f
  cross join lateral pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  group by f.function_name, f.identity_arguments
),
function_checks as (
  select
    e.function_name,
    e.identity_arguments,
    f.oid is not null as exists,
    coalesce(f.result_type, '') as result_type,
    coalesce(f.security_definer, false) as security_definer,
    coalesce(f.config @> array['search_path=public, pg_temp'], false) as fixed_search_path,
    coalesce(f.pronargs = 2, false) as two_arguments,
    coalesce(a.public_execute, false) as public_execute,
    coalesce(a.anon_execute, false) as anon_execute,
    coalesce(a.authenticated_execute, false) as authenticated_execute,
    (
      f.oid is not null
      and f.identity_arguments = e.identity_arguments
      and f.pronargs = 2
      and f.result_type = e.result_type
      and f.security_definer
      and coalesce(f.config @> array['search_path=public, pg_temp'], false)
      and not coalesce(a.public_execute, false)
      and not coalesce(a.anon_execute, false)
      and coalesce(a.authenticated_execute, false)
    ) as ok
  from expected_function e
  left join function_catalog f
    on f.function_name = e.function_name
   and f.identity_arguments = e.identity_arguments
  left join function_acl a
    on a.function_name = e.function_name
   and a.identity_arguments = e.identity_arguments
),
profile_policies as (
  select policyname as policy_name, cmd as command, roles, qual as using_expression
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
),
view_columns as (
  select
    a.attname::text as column_name,
    a.attnum as ordinal_position
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'player_public_profiles'
    and a.attnum > 0
    and not a.attisdropped
),
private_view_columns(column_name) as (
  values
    ('email'),
    ('phone'),
    ('birthday'),
    ('gender'),
    ('role'),
    ('language'),
    ('created_at'),
    ('updated_at')
)
select jsonb_build_object(
  'postcheck',
  jsonb_build_object(
    'function',
      coalesce((select jsonb_agg(to_jsonb(function_checks) order by function_name, identity_arguments) from function_checks), '[]'::jsonb),
    'extra_admin_list_profiles_overloads',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'function_name', function_name,
              'identity_arguments', identity_arguments,
              'result_type', result_type
            )
            order by identity_arguments
          )
          from function_catalog
          where identity_arguments <> 'p_search text, p_filter text'
        ),
        '[]'::jsonb
      ),
    'profiles_select_authenticated_exists',
      exists (
        select 1
        from profile_policies
        where policy_name = 'profiles_select_authenticated'
          and command = 'SELECT'
      ),
    'player_public_profiles_private_column_count',
      (
        select count(*)
        from view_columns v
        join private_view_columns p on p.column_name = v.column_name
      ),
    'postcheck_ok',
      (
        not exists (select 1 from function_checks where not ok)
        and not exists (
          select 1
          from function_catalog
          where identity_arguments <> 'p_search text, p_filter text'
        )
        and exists (
          select 1
          from profile_policies
          where policy_name = 'profiles_select_authenticated'
            and command = 'SELECT'
        )
        and (
          select count(*)
          from view_columns v
          join private_view_columns p on p.column_name = v.column_name
        ) = 0
      )
  )
) as profiles_read_api_postcheck;
