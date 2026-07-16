-- PRODUCTION_CHECKPOINT_001_005.sql
-- Read-only production checkpoint before manual rollout of migrations 001-005.
-- This script returns one jsonb column and does not create, alter, drop,
-- insert, update, delete, truncate, or expose user/match/message rows.

with expected_tables(table_name) as (
  values
    ('profiles'),
    ('matches'),
    ('messages')
),
private_public_view_columns(column_name) as (
  values
    ('phone'),
    ('email'),
    ('role'),
    ('birthday'),
    ('created_at'),
    ('updated_at')
),
tracked_functions(function_name) as (
  values
    ('is_admin'),
    ('get_my_profile'),
    ('update_my_profile'),
    ('admin_update_profile_security'),
    ('leave_match'),
    ('join_match'),
    ('admin_list_profiles')
),
expected_single_signatures(function_name, identity_arguments) as (
  values
    ('is_admin', ''),
    ('get_my_profile', ''),
    ('update_my_profile', 'p_first_name text, p_last_name text, p_phone text, p_username text, p_photo_url text, p_side_preference text, p_birthday date, p_gender text, p_language text'),
    ('admin_update_profile_security', 'p_profile_id uuid, p_role text, p_rating numeric, p_is_verified boolean'),
    ('leave_match', 'p_match_id uuid'),
    ('join_match', 'p_match_id uuid'),
    ('admin_list_profiles', 'p_search text, p_filter text')
),
tables_catalog as (
  select
    e.table_name,
    c.oid as relation_oid,
    c.relkind,
    c.relrowsecurity as rls_enabled,
    c.relforcerowsecurity as rls_forced,
    pg_catalog.pg_get_userbyid(c.relowner) as owner
  from expected_tables e
  left join pg_catalog.pg_class c
    on c.relname = e.table_name
   and c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'p')
),
production_row_counts as (
  select
    'profiles'::text as table_name,
    case when to_regclass('public.profiles') is not null then (select count(*) from public.profiles) else null end as row_count
  union all
  select
    'matches'::text as table_name,
    case when to_regclass('public.matches') is not null then (select count(*) from public.matches) else null end as row_count
  union all
  select
    'messages'::text as table_name,
    case when to_regclass('public.messages') is not null then (select count(*) from public.messages) else null end as row_count
),
profiles_policies as (
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
function_catalog as (
  select
    n.nspname as schema_name,
    p.oid,
    p.proowner,
    p.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    l.lanname as language,
    p.prosecdef as security_definer,
    p.provolatile as volatility,
    p.proconfig as config,
    p.proacl,
    pg_catalog.pg_get_functiondef(p.oid) as function_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_language l on l.oid = p.prolang
  join tracked_functions tf on tf.function_name = p.proname
  where n.nspname = 'public'
),
function_acl as (
  select
    f.function_name,
    f.identity_arguments,
    coalesce(r.rolname, 'PUBLIC') as grantee,
    a.privilege_type
  from function_catalog f
  cross join lateral pg_catalog.aclexplode(coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
),
function_grants as (
  select
    function_name,
    identity_arguments,
    jsonb_agg(
      jsonb_build_object(
        'grantee', grantee,
        'privilege_type', privilege_type
      )
      order by grantee, privilege_type
    ) as grants
  from function_acl
  group by function_name, identity_arguments
),
function_summary as (
  select
    f.schema_name as schema,
    f.function_name,
    f.identity_arguments,
    f.result_type,
    f.language,
    f.security_definer,
    f.volatility,
    coalesce(to_jsonb(f.config), '[]'::jsonb) as config,
    coalesce(f.config @> array['search_path=public, pg_temp'], false)
      or coalesce(f.config @> array['search_path=public'], false) as has_fixed_public_search_path,
    coalesce(g.grants, '[]'::jsonb) as grants,
    f.function_definition
  from function_catalog f
  left join function_grants g
    on g.function_name = f.function_name
   and g.identity_arguments = f.identity_arguments
),
function_presence as (
  select
    e.function_name,
    e.identity_arguments,
    exists (
      select 1
      from function_catalog f
      where f.function_name = e.function_name
        and f.identity_arguments = e.identity_arguments
    ) as expected_signature_exists
  from expected_single_signatures e
),
unexpected_overloads as (
  select
    f.function_name,
    f.identity_arguments,
    f.result_type
  from function_catalog f
  left join expected_single_signatures e
    on e.function_name = f.function_name
   and e.identity_arguments = f.identity_arguments
  where e.function_name is null
),
view_relation as (
  select
    c.oid,
    c.relkind,
    pg_catalog.pg_get_userbyid(c.relowner) as owner,
    c.relacl
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'player_public_profiles'
),
view_columns as (
  select
    a.attname::text as column_name,
    a.attnum as ordinal_position,
    pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type
  from pg_catalog.pg_attribute a
  join view_relation v on v.oid = a.attrelid
  where a.attnum > 0
    and not a.attisdropped
),
view_acl as (
  select
    coalesce(r.rolname, 'PUBLIC') as grantee,
    a.privilege_type
  from view_relation v
  cross join lateral pg_catalog.aclexplode(coalesce(v.relacl, pg_catalog.acldefault('r', (select c.relowner from pg_catalog.pg_class c where c.oid = v.oid)))) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
),
conflict_flags as (
  select
    to_regprocedure('public.leave_match(uuid)') is not null as leave_match_exists,
    to_regprocedure('public.join_match(uuid)') is not null as join_match_exists,
    exists (
      select 1
      from function_catalog
      where function_name = 'admin_list_profiles'
    ) as admin_list_profiles_exists,
    exists (
      select 1
      from profiles_policies
      where policy_name = 'profiles_select_authenticated'
    ) as profiles_select_authenticated_exists,
    exists (
      select 1
      from profiles_policies
      where policy_name = 'profiles_select_own'
    ) as profiles_select_own_exists,
    to_regclass('public.player_public_profiles') is not null as player_public_profiles_exists,
    exists (select 1 from unexpected_overloads) as unexpected_overloads_exist
),
blocking_conflicts as (
  select jsonb_strip_nulls(jsonb_build_object(
    'leave_match_exists_requires_definition_compare',
      case when leave_match_exists then true else null end,
    'join_match_exists_before_rollout',
      case when join_match_exists then true else null end,
    'admin_list_profiles_exists_before_004',
      case when admin_list_profiles_exists then true else null end,
    'profiles_select_own_exists_before_005',
      case when profiles_select_own_exists then true else null end,
    'unexpected_overloads_exist',
      case when unexpected_overloads_exist then true else null end
  )) as value
  from conflict_flags
),
warnings as (
  select jsonb_strip_nulls(jsonb_build_object(
    'checkpoint_ok_is_not_rollout_approval', true,
    'row_counts_are_counts_only_no_user_rows_exported', true,
    'player_public_profiles_already_exists',
      case when player_public_profiles_exists then true else null end,
    'profiles_select_authenticated_missing_before_frontend_rollout',
      case when not profiles_select_authenticated_exists then true else null end
  )) as value
  from conflict_flags
),
objects_summary as (
  select jsonb_build_object(
    'tables_present',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'table_name', table_name,
              'exists', relation_oid is not null,
              'owner', owner,
              'rls_enabled', rls_enabled,
              'rls_forced', rls_forced
            )
            order by table_name
          )
          from tables_catalog
        ),
        '[]'::jsonb
      ),
    'expected_function_signatures',
      coalesce(
        (
          select jsonb_agg(to_jsonb(function_presence) order by function_name, identity_arguments)
          from function_presence
        ),
        '[]'::jsonb
      ),
    'unexpected_overloads',
      coalesce(
        (
          select jsonb_agg(to_jsonb(unexpected_overloads) order by function_name, identity_arguments)
          from unexpected_overloads
        ),
        '[]'::jsonb
      )
  ) as value
)
select jsonb_build_object(
  'checkpoint_ok', true,
  'note', 'checkpoint_ok only means this read-only diagnostic query completed; it does not mean rollout is safe.',
  'production_row_counts',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'table_name', table_name,
            'row_count', row_count
          )
          order by table_name
        )
        from production_row_counts
      ),
      '[]'::jsonb
    ),
  'tables',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', 'public',
            'table_name', table_name,
            'exists', relation_oid is not null,
            'owner', owner,
            'rls_enabled', rls_enabled,
            'rls_forced', rls_forced
          )
          order by table_name
        )
        from tables_catalog
      ),
      '[]'::jsonb
    ),
  'profiles_policies',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'policy_name', policy_name,
            'command', command,
            'roles', to_jsonb(roles),
            'permissive', permissive,
            'using_expression', using_expression,
            'with_check_expression', with_check_expression
          )
          order by policy_name
        )
        from profiles_policies
      ),
      '[]'::jsonb
    ),
  'functions',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'schema', schema,
            'function_name', function_name,
            'identity_arguments', identity_arguments,
            'result_type', result_type,
            'language', language,
            'security_definer', security_definer,
            'volatility', volatility,
            'config', config,
            'has_fixed_public_search_path', has_fixed_public_search_path,
            'grants', grants,
            'function_definition', function_definition
          )
          order by function_name, identity_arguments
        )
        from function_summary
      ),
      '[]'::jsonb
    ),
  'function_presence',
    coalesce(
      (
        select jsonb_agg(to_jsonb(function_presence) order by function_name, identity_arguments)
        from function_presence
      ),
      '[]'::jsonb
    ),
  'player_public_profiles',
    jsonb_build_object(
      'exists', to_regclass('public.player_public_profiles') is not null,
      'relation_type',
        (
          select case relkind
            when 'v' then 'view'
            when 'm' then 'materialized_view'
            else relkind::text
          end
          from view_relation
          limit 1
        ),
      'owner', (select owner from view_relation limit 1),
      'columns',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'column_name', column_name,
                'ordinal_position', ordinal_position,
                'data_type', data_type
              )
              order by ordinal_position
            )
            from view_columns
          ),
          '[]'::jsonb
        ),
      'grants',
        coalesce(
          (
            select jsonb_agg(
              jsonb_build_object(
                'grantee', grantee,
                'privilege_type', privilege_type
              )
              order by grantee, privilege_type
            )
            from view_acl
          ),
          '[]'::jsonb
        ),
      'private_columns_present',
        coalesce(
          (
            select jsonb_agg(v.column_name order by v.column_name)
            from view_columns v
            join private_public_view_columns p on p.column_name = v.column_name
          ),
          '[]'::jsonb
        ),
      'private_column_count',
        (
          select count(*)
          from view_columns v
          join private_public_view_columns p on p.column_name = v.column_name
        )
    ),
  'conflict_flags',
    (select to_jsonb(conflict_flags) from conflict_flags),
  'leave_match_definition',
    case
      when to_regprocedure('public.leave_match(uuid)') is not null
      then pg_catalog.pg_get_functiondef('public.leave_match(uuid)'::regprocedure)
      else null
    end,
  'blocking_conflicts',
    coalesce((select value from blocking_conflicts), '{}'::jsonb),
  'warnings',
    coalesce((select value from warnings), '{}'::jsonb),
  'objects_summary',
    coalesce((select value from objects_summary), '{}'::jsonb)
) as production_checkpoint_001_005;
