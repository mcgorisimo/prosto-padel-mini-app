-- 010_match_waitlist_public_view_PRECHECK.sql
-- Read-only catalog report. It does not create objects, call write RPCs or change rows.

with required_columns(relation_name, column_name, expected_type, public_output_name) as (
  values
    ('matches', 'id', 'uuid', null::text),
    ('matches', 'type', 'text', null::text),
    ('matches', 'isPrivate', 'boolean', null::text),
    ('match_waitlist', 'id', 'uuid', 'waitlist_id'),
    ('match_waitlist', 'match_id', 'uuid', null::text),
    ('match_waitlist', 'user_id', 'uuid', 'user_id'),
    ('match_waitlist', 'status', 'text', null::text),
    ('match_waitlist', 'joined_at', 'timestamp with time zone', 'joined_at'),
    ('profiles', 'id', 'uuid', null::text),
    ('profiles', 'first_name', 'text', 'first_name'),
    ('profiles', 'last_name', 'text', 'last_name'),
    ('profiles', 'photo_url', 'text', 'photo_url'),
    ('profiles', 'rating', 'numeric', 'rating')
),
actual_columns as (
  select
    c.relname relation_name,
    a.attname column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) actual_type,
    t.typname base_type
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname in ('matches', 'match_waitlist', 'profiles')
    and a.attnum > 0
    and not a.attisdropped
),
column_checks as (
  select
    r.relation_name,
    r.column_name,
    r.expected_type,
    a.actual_type,
    r.public_output_name,
    case
      when r.expected_type = 'numeric' then a.base_type = 'numeric'
      else a.actual_type = r.expected_type
    end as type_ok
  from required_columns r
  left join actual_columns a using (relation_name, column_name)
),
relations as (
  select
    n.nspname schema_name,
    c.relname,
    c.relkind,
    c.relrowsecurity,
    pg_catalog.obj_description(c.oid, 'pg_class') description
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('matches', 'match_waitlist', 'profiles')
),
target_name_conflicts as (
  select
    p.oid,
    n.nspname schema_name,
    p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) result_type,
    pg_catalog.obj_description(p.oid, 'pg_proc') description
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_match_waitlist'
),
required_009_functions as (
  select
    p.oid,
    n.nspname schema_name,
    p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) result_type,
    p.prosecdef,
    p.proconfig,
    pg_catalog.obj_description(p.oid, 'pg_proc') description,
    regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)), '\s+', ' ', 'g') definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.oid in (
    pg_catalog.to_regprocedure('public.get_my_match_waitlist_position(uuid)')::oid,
    pg_catalog.to_regprocedure('public.get_match_waitlist_count(uuid)')::oid,
    pg_catalog.to_regprocedure('prosto_padel_internal.promote_match_waitlist(uuid)')::oid
  )
),
fifo_index as (
  select
    c.relname index_name,
    pg_catalog.pg_get_indexdef(i.indexrelid) definition,
    pg_catalog.pg_get_expr(i.indpred, i.indrelid) predicate
  from pg_catalog.pg_index i
  join pg_catalog.pg_class c on c.oid = i.indexrelid
  where i.indrelid = pg_catalog.to_regclass('public.match_waitlist')
    and c.relname = 'match_waitlist_fifo_idx'
),
waitlist_acl as (
  select
    coalesce(r.rolname, 'PUBLIC') role_name,
    a.privilege_type
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(
    coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  where c.oid = pg_catalog.to_regclass('public.match_waitlist')
    and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
),
waitlist_policies as (
  select
    pol.polname,
    pol.polcmd,
    pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) using_expression
  from pg_catalog.pg_policy pol
  where pol.polrelid = pg_catalog.to_regclass('public.match_waitlist')
),
checks as (
  select
    (select count(*) = 3 from relations) as required_tables_exist,
    exists (
      select 1 from relations
      where relname = 'match_waitlist'
        and relkind = 'r'
        and relrowsecurity
        and description like 'migration=009_match_waitlist_notifications;%'
    ) as migration_009_table_installed,
    not exists (
      select 1 from column_checks where actual_type is null or not type_ok
    ) as table_and_profile_columns_compatible,
    exists (
      select 1 from required_009_functions
      where schema_name = 'public'
        and proname = 'get_my_match_waitlist_position'
        and identity_arguments = 'p_match_id uuid'
        and description like 'migration=009_match_waitlist_notifications;%'
        and definition like '%order by w.joined_at, w.id%'
    )
    and exists (
      select 1 from required_009_functions
      where schema_name = 'public'
        and proname = 'get_match_waitlist_count'
        and identity_arguments = 'p_match_id uuid'
        and description like 'migration=009_match_waitlist_notifications;%'
    )
    and exists (
      select 1 from required_009_functions
      where schema_name = 'prosto_padel_internal'
        and proname = 'promote_match_waitlist'
        and identity_arguments = 'p_match_id uuid'
        and description like 'migration=009_match_waitlist_notifications;%'
        and definition like '%order by w.joined_at, w.id%'
    ) as migration_009_rpcs_and_fifo_installed,
    exists (
      select 1 from fifo_index
      where lower(definition) like '%match_id, joined_at, id%'
        and lower(predicate) like '%status = ''waiting''%'
    ) as fifo_index_compatible,
    pg_catalog.to_regprocedure('auth.uid()') is not null
      and exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
      and exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
      as supabase_auth_available,
    not exists (select 1 from target_name_conflicts) as no_conflicting_function,
    exists (
      select 1 from waitlist_policies
      where polname = 'match_waitlist_select_own'
        and polcmd = 'r'
        and lower(using_expression) like '%auth.uid()%'
    )
    and (select count(*) = 1 from waitlist_policies)
    and not exists (
      select 1 from waitlist_acl
      where privilege_type = 'SELECT'
        and role_name in ('PUBLIC', 'anon')
    )
    and exists (
      select 1 from waitlist_acl
      where privilege_type = 'SELECT'
        and role_name = 'authenticated'
    )
    and not exists (
      select 1 from waitlist_acl
      where role_name in ('PUBLIC', 'anon', 'authenticated')
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ) as existing_direct_table_access_remains_restricted,
    exists (
      select 1 from column_checks
      where relation_name = 'profiles' and column_name = 'first_name' and type_ok
    )
    and exists (
      select 1 from column_checks
      where relation_name = 'profiles' and column_name = 'last_name' and type_ok
    )
    and exists (
      select 1 from column_checks
      where relation_name = 'profiles' and column_name = 'rating' and type_ok
    )
    and exists (
      select 1 from column_checks
      where relation_name = 'profiles' and column_name = 'photo_url' and type_ok
    ) as safe_profile_field_names_known
)
select pg_catalog.jsonb_build_object(
  'precheck', pg_catalog.jsonb_build_object(
    'checks', (select to_jsonb(checks) from checks),
    'resolved_safe_fields', (
      select pg_catalog.jsonb_object_agg(public_output_name, column_name order by public_output_name)
      from column_checks
      where public_output_name is not null
    ),
    'last_name_output_policy', 'first character plus a dot; empty last name becomes null',
    'column_checks', (
      select pg_catalog.jsonb_agg(to_jsonb(column_checks) order by relation_name, column_name)
      from column_checks
    ),
    'migration_009_functions', coalesce((
      select pg_catalog.jsonb_agg(
        to_jsonb(required_009_functions) - 'definition'
        order by schema_name, proname
      ) from required_009_functions
    ), '[]'::jsonb),
    'fifo_index', coalesce((select pg_catalog.jsonb_agg(to_jsonb(fifo_index)) from fifo_index), '[]'::jsonb),
    'target_name_conflicts', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(target_name_conflicts)) from target_name_conflicts
    ), '[]'::jsonb),
    'waitlist_policies', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(waitlist_policies)) from waitlist_policies
    ), '[]'::jsonb),
    'waitlist_grants', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(waitlist_acl)) from waitlist_acl
    ), '[]'::jsonb),
    'precheck_ok', (
      select required_tables_exist
        and migration_009_table_installed
        and table_and_profile_columns_compatible
        and migration_009_rpcs_and_fifo_installed
        and fifo_index_compatible
        and supabase_auth_available
        and no_conflicting_function
        and existing_direct_table_access_remains_restricted
        and safe_profile_field_names_known
      from checks
    )
  )
) as match_waitlist_public_view_precheck;
