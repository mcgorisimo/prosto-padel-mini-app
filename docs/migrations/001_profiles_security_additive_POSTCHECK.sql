-- 001_profiles_security_additive_POSTCHECK.sql
-- Read-only postcheck for the additive profiles security stage.
-- Run after 001_profiles_security_additive.sql. This query reads PostgreSQL
-- catalogs only and returns one jsonb column.

with expected_view_columns(column_name, ordinal_position) as (
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
    ('language')
),
actual_view_columns as (
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
expected_functions(function_name, identity_arguments, authenticated_execute_expected) as (
  values
    ('profiles_security_is_privileged', '', false),
    ('profiles_security_guard_insert', '', false),
    ('profiles_security_guard_update', '', false),
    ('get_my_profile', '', true),
    ('update_my_profile', 'p_first_name text, p_last_name text, p_phone text, p_username text, p_photo_url text, p_side_preference text, p_birthday date, p_gender text, p_language text', true),
    ('admin_update_profile_security', 'p_profile_id uuid, p_role text, p_rating numeric, p_is_verified boolean', true)
),
function_catalog as (
  select
    p.oid,
    p.proowner,
    p.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.prosecdef as security_definer,
    p.proconfig as config,
    p.proacl
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'profiles_security_is_privileged',
      'profiles_security_guard_insert',
      'profiles_security_guard_update',
      'get_my_profile',
      'update_my_profile',
      'admin_update_profile_security'
    )
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
    coalesce(f.security_definer, false) as security_definer,
    coalesce(f.config @> array['search_path=public, pg_temp'], false) as fixed_search_path,
    coalesce(a.public_execute, false) as public_execute,
    coalesce(a.anon_execute, false) as anon_execute,
    coalesce(a.authenticated_execute, false) as authenticated_execute,
    e.authenticated_execute_expected,
    (
      f.oid is not null
      and f.security_definer
      and coalesce(f.config @> array['search_path=public, pg_temp'], false)
      and not coalesce(a.public_execute, false)
      and not coalesce(a.anon_execute, false)
      and coalesce(a.authenticated_execute, false) = e.authenticated_execute_expected
    ) as ok
  from expected_functions e
  left join function_catalog f
    on f.function_name = e.function_name
   and f.identity_arguments = e.identity_arguments
  left join function_acl a
    on a.function_name = e.function_name
   and a.identity_arguments = e.identity_arguments
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
    and t.tgname in (
      'profiles_security_guard_insert',
      'profiles_security_guard_update'
    )
    and not t.tgisinternal
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
  'postcheck',
  jsonb_build_object(
    'player_public_profiles_exists', to_regclass('public.player_public_profiles') is not null,
    'player_public_profiles_columns',
      coalesce(
        (
          select jsonb_agg(to_jsonb(actual_view_columns) order by ordinal_position)
          from actual_view_columns
        ),
        '[]'::jsonb
      ),
    'player_public_profiles_exact_public_columns', (
      select array_agg(column_name order by ordinal_position)
      from actual_view_columns
    ) = (
      select array_agg(column_name order by ordinal_position)
      from expected_view_columns
    ),
    'player_public_profiles_private_column_count', (
      select count(*)
      from actual_view_columns a
      join private_view_columns p on p.column_name = a.column_name
    ),
    'player_public_profiles_grants',
      jsonb_build_object(
        'public_select', coalesce((select public_select from view_acl), false),
        'anon_select', coalesce((select anon_select from view_acl), false),
        'authenticated_select', coalesce((select authenticated_select from view_acl), false)
      ),
    'functions',
      coalesce(
        (
          select jsonb_agg(to_jsonb(function_checks) order by function_name, identity_arguments)
          from function_checks
        ),
        '[]'::jsonb
      ),
    'triggers',
      coalesce(
        (
          select jsonb_agg(to_jsonb(trigger_checks) order by trigger_name)
          from trigger_checks
        ),
        '[]'::jsonb
      ),
    'postcheck_ok', (
      to_regclass('public.player_public_profiles') is not null
      and (
        select array_agg(column_name order by ordinal_position)
        from actual_view_columns
      ) = (
        select array_agg(column_name order by ordinal_position)
        from expected_view_columns
      )
      and not coalesce((select public_select from view_acl), false)
      and not coalesce((select anon_select from view_acl), false)
      and coalesce((select authenticated_select from view_acl), false)
      and not exists (select 1 from function_checks where not ok)
      and exists (
        select 1
        from trigger_checks
        where trigger_name = 'profiles_security_guard_insert'
          and enabled_status = 'O'
      )
      and exists (
        select 1
        from trigger_checks
        where trigger_name = 'profiles_security_guard_update'
          and enabled_status = 'O'
      )
      and (
        select count(*)
        from actual_view_columns a
        join private_view_columns p on p.column_name = a.column_name
      ) = 0
    )
  )
) as profiles_security_additive_postcheck;
