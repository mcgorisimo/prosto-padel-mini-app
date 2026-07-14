-- 005_profiles_read_lockdown_POSTCHECK.sql
-- Read-only postcheck after replacing broad profiles SELECT with own-row SELECT.
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
own_policy as (
  select
    policy_name,
    command,
    roles,
    using_expression,
    regexp_replace(lower(coalesce(using_expression, '')), '\s+', ' ', 'g') as normalized_using_expression
  from profile_policies
  where policy_name = 'profiles_select_own'
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
    'profiles_select_authenticated_absent',
      not exists (
        select 1
        from profile_policies
        where policy_name = 'profiles_select_authenticated'
      ),
    'profiles_select_own',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'policy_name', policy_name,
              'command', command,
              'roles', to_jsonb(roles),
              'using_expression', using_expression,
              'authenticated_only',
                exists (select 1 from unnest(roles) role_name where role_name::text = 'authenticated')
                and not exists (select 1 from unnest(roles) role_name where role_name::text <> 'authenticated'),
              'uses_auth_uid_equals_id',
                normalized_using_expression like '%auth.uid() = id%'
                or normalized_using_expression like '%id = auth.uid()%'
            )
            order by policy_name
          )
          from own_policy
        ),
        '[]'::jsonb
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
    'admin_list_profiles_protected',
      exists (
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
      ),
    'player_public_profiles_private_column_count',
      (
        select count(*)
        from view_columns v
        join private_view_columns p on p.column_name = v.column_name
      ),
    'get_my_profile_exists',
      exists (
        select 1
        from get_my_profile_catalog
        where identity_arguments = ''
      ),
    'postcheck_ok',
      (
        not exists (
          select 1
          from profile_policies
          where policy_name = 'profiles_select_authenticated'
        )
        and exists (
          select 1
          from own_policy
          where command = 'SELECT'
            and exists (select 1 from unnest(roles) role_name where role_name::text = 'authenticated')
            and not exists (select 1 from unnest(roles) role_name where role_name::text <> 'authenticated')
            and (
              normalized_using_expression like '%auth.uid() = id%'
              or normalized_using_expression like '%id = auth.uid()%'
            )
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
        and (
          select count(*)
          from view_columns v
          join private_view_columns p on p.column_name = v.column_name
        ) = 0
        and exists (
          select 1
          from get_my_profile_catalog
          where identity_arguments = ''
        )
      )
  )
) as profiles_read_lockdown_postcheck;
