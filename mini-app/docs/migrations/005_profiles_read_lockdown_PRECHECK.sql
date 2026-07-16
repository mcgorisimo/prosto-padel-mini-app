-- 005_profiles_read_lockdown_PRECHECK.sql
-- Read-only precheck before replacing broad profiles SELECT with own-row SELECT.
-- Returns one jsonb column and reads PostgreSQL catalogs only.

with profile_policies as (
  select
    policyname as policy_name,
    cmd as command,
    roles,
    permissive,
    qual as using_expression,
    with_check as with_check_expression
  from pg_catalog.pg_policies
  where schemaname = 'public'
    and tablename = 'profiles'
),
admin_function_catalog as (
  select
    p.oid,
    p.proowner,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    p.prosecdef as security_definer,
    p.proconfig as config,
    p.proacl,
    pg_catalog.pg_get_functiondef(p.oid) as function_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'admin_list_profiles'
),
admin_function_acl as (
  select
    f.identity_arguments,
    bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute,
    bool_or(r.rolname = 'anon' and a.privilege_type = 'EXECUTE') as anon_execute,
    bool_or(r.rolname = 'authenticated' and a.privilege_type = 'EXECUTE') as authenticated_execute
  from admin_function_catalog f
  cross join lateral pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  group by f.identity_arguments
),
get_my_profile_catalog as (
  select
    p.oid,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_my_profile'
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
expected_view_columns(column_name, ordinal_position) as (
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
),
view_acl as (
  select
    bool_or(a.grantee = 0 and a.privilege_type = 'SELECT') as public_select,
    bool_or(r.rolname = 'anon' and a.privilege_type = 'SELECT') as anon_select,
    bool_or(r.rolname = 'authenticated' and a.privilege_type = 'SELECT') as authenticated_select
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join lateral pg_catalog.aclexplode(coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  where n.nspname = 'public'
    and c.relname = 'player_public_profiles'
)
select jsonb_build_object(
  'precheck',
  jsonb_build_object(
    'profiles_select_authenticated_exists',
      exists (
        select 1
        from profile_policies
        where policy_name = 'profiles_select_authenticated'
          and command = 'SELECT'
          and exists (select 1 from unnest(roles) role_name where role_name::text = 'authenticated')
      ),
    'profiles_select_own_absent',
      not exists (
        select 1
        from profile_policies
        where policy_name = 'profiles_select_own'
      ),
    'profiles_insert_own_exists',
      exists (
        select 1
        from profile_policies
        where policy_name = 'profiles_insert_own'
          and command = 'INSERT'
      ),
    'profiles_update_own_or_admin_exists',
      exists (
        select 1
        from profile_policies
        where policy_name = 'profiles_update_own_or_admin'
          and command = 'UPDATE'
      ),
    'admin_list_profiles',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'identity_arguments', f.identity_arguments,
              'result_type', f.result_type,
              'security_definer', f.security_definer,
              'fixed_search_path', coalesce(f.config @> array['search_path=public, pg_temp'], false),
              'public_execute', coalesce(a.public_execute, false),
              'anon_execute', coalesce(a.anon_execute, false),
              'authenticated_execute', coalesce(a.authenticated_execute, false),
              'checks_public_is_admin', f.function_definition ilike '%public.is_admin()%'
            )
            order by f.identity_arguments
          )
          from admin_function_catalog f
          left join admin_function_acl a on a.identity_arguments = f.identity_arguments
        ),
        '[]'::jsonb
      ),
    'get_my_profile_exists',
      exists (
        select 1
        from get_my_profile_catalog
        where identity_arguments = ''
      ),
    'player_public_profiles_columns',
      coalesce(
        (
          select jsonb_agg(to_jsonb(view_columns) order by ordinal_position)
          from view_columns
        ),
        '[]'::jsonb
      ),
    'player_public_profiles_exact_public_columns',
      (
        select array_agg(column_name order by ordinal_position)
        from view_columns
      ) = (
        select array_agg(column_name order by ordinal_position)
        from expected_view_columns
      ),
    'player_public_profiles_private_column_count',
      (
        select count(*)
        from view_columns v
        join private_view_columns p on p.column_name = v.column_name
      ),
    'player_public_profiles_grants',
      jsonb_build_object(
        'public_select', coalesce((select public_select from view_acl), false),
        'anon_select', coalesce((select anon_select from view_acl), false),
        'authenticated_select', coalesce((select authenticated_select from view_acl), false)
      ),
    'frontend_profiles_select_audit',
      jsonb_build_object(
        'machine_checked_by_sql', false,
        'expected_manual_result', 'No direct profiles SELECT in src; AuthGate keeps only INSERT ... select(''id'').'
      ),
    'precheck_ok',
      (
        exists (
          select 1
          from profile_policies
          where policy_name = 'profiles_select_authenticated'
            and command = 'SELECT'
            and exists (select 1 from unnest(roles) role_name where role_name::text = 'authenticated')
        )
        and not exists (
          select 1
          from profile_policies
          where policy_name = 'profiles_select_own'
        )
        and exists (
          select 1
          from profile_policies
          where policy_name = 'profiles_insert_own'
            and command = 'INSERT'
        )
        and exists (
          select 1
          from profile_policies
          where policy_name = 'profiles_update_own_or_admin'
            and command = 'UPDATE'
        )
        and exists (
          select 1
          from admin_function_catalog f
          left join admin_function_acl a on a.identity_arguments = f.identity_arguments
          where f.identity_arguments = 'p_search text, p_filter text'
            and f.security_definer
            and coalesce(f.config @> array['search_path=public, pg_temp'], false)
            and not coalesce(a.public_execute, false)
            and not coalesce(a.anon_execute, false)
            and coalesce(a.authenticated_execute, false)
            and f.function_definition ilike '%public.is_admin()%'
        )
        and exists (
          select 1
          from get_my_profile_catalog
          where identity_arguments = ''
        )
        and (
          select array_agg(column_name order by ordinal_position)
          from view_columns
        ) = (
          select array_agg(column_name order by ordinal_position)
          from expected_view_columns
        )
        and (
          select count(*)
          from view_columns v
          join private_view_columns p on p.column_name = v.column_name
        ) = 0
        and coalesce((select authenticated_select from view_acl), false)
      )
  )
) as profiles_read_lockdown_precheck;
