-- 007_create_booking_atomic_PRECHECK.sql
-- Read-only inspection. This file does not create, alter, insert, update or delete anything.

with expected_columns(column_name, expected_type, purpose) as (
  values
    ('owner_id', 'uuid', 'authenticated owner'),
    ('dateISO', 'date', 'booking local date'),
    ('time', 'text', 'booking local start in H:MM or HH:MM'),
    ('duration', 'numeric', 'duration in hours'),
    ('courtId', 'text', 'court identity'),
    ('courtName', 'text', 'frontend court label'),
    ('courtType', 'text', 'frontend court type'),
    ('status', 'text', 'active/completed predicate'),
    ('type', 'text', 'private booking or match'),
    ('scenario', 'text', 'private/social/community scenario'),
    ('isPrivate', 'boolean', 'private/public format'),
    ('filledSlots', 'jsonb', 'frontend player slots'),
    ('participants', 'text[]', 'frontend participant ids')
),
actual_columns as (
  select
    a.attname as column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) as actual_type,
    a.attnotnull as not_null,
    pg_catalog.pg_get_expr(d.adbin, d.adrelid) as default_expression
  from pg_catalog.pg_attribute a
  left join pg_catalog.pg_attrdef d
    on d.adrelid = a.attrelid
   and d.adnum = a.attnum
  where a.attrelid = pg_catalog.to_regclass('public.matches')
    and a.attnum > 0
    and not a.attisdropped
),
column_report as (
  select
    e.column_name,
    e.expected_type,
    a.actual_type,
    a.not_null,
    a.default_expression,
    e.purpose,
    a.column_name is not null and a.actual_type = e.expected_type as type_ok
  from expected_columns e
  left join actual_columns a using (column_name)
),
valid_scheduled_rows as (
  select
    m.id,
    m."dateISO" as booking_date,
    m."courtId" as court_id,
    (
      split_part(m.time, ':', 1)::integer * 60
      + split_part(m.time, ':', 2)::integer
    )::numeric as start_minute,
    (
      split_part(m.time, ':', 1)::integer * 60
      + split_part(m.time, ':', 2)::integer
      + m.duration * 60
    )::numeric as end_minute
  from public.matches m
  where m.status is distinct from 'completed'
    and m."dateISO" is not null
    and m."courtId" is not null
    and m.time is not null
    and m.duration is not null
    and m.time ~ '^(?:[0-9]|[01][0-9]|2[0-3]):[0-5][0-9]$'
),
data_findings as (
  select
    (
      select count(*)
      from public.matches m
      where m.status is distinct from 'completed'
        and m."dateISO" is not null
        and m."courtId" is not null
        and m.time is not null
        and m.duration is not null
        and m.time !~ '^(?:[0-9]|[01][0-9]|2[0-3]):[0-5][0-9]$'
    ) as invalid_active_time_count,
    (
      select count(*)
      from valid_scheduled_rows left_booking
      join valid_scheduled_rows right_booking
        on left_booking.id < right_booking.id
       and left_booking.booking_date = right_booking.booking_date
       and left_booking.court_id = right_booking.court_id
       and numrange(left_booking.start_minute, left_booking.end_minute, '[)')
           && numrange(right_booking.start_minute, right_booking.end_minute, '[)')
    ) as existing_overlap_pair_count,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'left_id', left_booking.id,
            'right_id', right_booking.id,
            'dateISO', left_booking.booking_date,
            'courtId', left_booking.court_id,
            'left_minutes', numrange(left_booking.start_minute, left_booking.end_minute, '[)'),
            'right_minutes', numrange(right_booking.start_minute, right_booking.end_minute, '[)')
          ) order by left_booking.booking_date, left_booking.court_id, left_booking.id
        ),
        '[]'::jsonb
      )
      from valid_scheduled_rows left_booking
      join valid_scheduled_rows right_booking
        on left_booking.id < right_booking.id
       and left_booking.booking_date = right_booking.booking_date
       and left_booking.court_id = right_booking.court_id
       and numrange(left_booking.start_minute, left_booking.end_minute, '[)')
           && numrange(right_booking.start_minute, right_booking.end_minute, '[)')
    ) as overlap_examples
),
function_catalog as (
  select
    p.oid,
    p.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    p.prorettype as result_type_oid,
    p.proretset as returns_set,
    p.prosecdef as security_definer,
    p.provolatile as volatility,
    p.proconfig as config,
    pg_catalog.obj_description(p.oid, 'pg_proc') as description
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_booking', 'match_time_to_minutes')
),
constraint_catalog as (
  select
    c.oid,
    c.conname as constraint_name,
    c.contype as constraint_type,
    pg_catalog.pg_get_constraintdef(c.oid, true) as definition,
    pg_catalog.obj_description(c.oid, 'pg_constraint') as description
  from pg_catalog.pg_constraint c
  where c.conrelid = pg_catalog.to_regclass('public.matches')
),
insert_policies as (
  select
    pol.polname as policy_name,
    pol.polpermissive as permissive,
    pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
  from pg_catalog.pg_policy pol
  where pol.polrelid = pg_catalog.to_regclass('public.matches')
    and pol.polcmd in ('a', '*')
),
capabilities as (
  select
    exists (
      select 1 from pg_catalog.pg_available_extensions where name = 'btree_gist'
    ) as btree_gist_available,
    exists (
      select 1 from pg_catalog.pg_extension where extname = 'btree_gist'
    ) as btree_gist_installed,
    pg_catalog.to_regprocedure('auth.uid()') is not null as auth_uid_exists,
    pg_catalog.to_regrole('authenticated') is not null as authenticated_role_exists,
    pg_catalog.to_regrole('anon') is not null as anon_role_exists,
    case
      when pg_catalog.to_regrole('authenticated') is null then false
      else pg_catalog.has_table_privilege('authenticated', 'public.matches', 'INSERT')
    end as authenticated_has_insert,
    exists (select 1 from insert_policies) as insert_policy_exists,
    exists (
      select 1
      from constraint_catalog
      where constraint_name = 'matches_no_active_court_overlap'
        and constraint_type = 'x'
        and description like 'migration=007_create_booking_atomic;%'
    ) as overlap_constraint_installed
),
checks as (
  select
    pg_catalog.to_regclass('public.matches') is not null as matches_table_exists,
    pg_catalog.to_regclass('public.profiles') is not null as profiles_table_exists,
    not exists (select 1 from column_report where not type_ok) as required_columns_ok,
    (select invalid_active_time_count = 0 from data_findings) as existing_times_ok,
    (select existing_overlap_pair_count = 0 from data_findings) as no_existing_overlaps,
    not exists (
      select 1
      from function_catalog
      where function_name = 'create_booking'
        and not (
          identity_arguments = 'p_booking jsonb'
          and not returns_set
          and result_type_oid = 'public.matches'::pg_catalog.regtype
          and description like 'migration=007_create_booking_atomic;%'
        )
    ) as no_conflicting_create_booking,
    not exists (
      select 1
      from function_catalog
      where function_name = 'match_time_to_minutes'
        and not (
          identity_arguments = 'p_time text'
          and not returns_set
          and result_type_oid = 'integer'::pg_catalog.regtype
          and description like 'migration=007_create_booking_atomic;%'
        )
    ) as no_conflicting_time_helper,
    not exists (
      select 1
      from constraint_catalog
      where constraint_name = 'matches_no_active_court_overlap'
        and coalesce(description, '') not like 'migration=007_create_booking_atomic;%'
    ) as no_conflicting_overlap_constraint,
    (select btree_gist_available from capabilities) as btree_gist_available,
    (select auth_uid_exists from capabilities) as auth_uid_exists,
    (select authenticated_role_exists and anon_role_exists from capabilities) as supabase_roles_exist
)
select jsonb_build_object(
  'precheck',
  jsonb_build_object(
    'schedule_mapping', jsonb_build_object(
      'court', 'public.matches."courtId" text',
      'start', 'public.matches."dateISO" date + public.matches.time text interpreted as local club time',
      'end', 'start minute + public.matches.duration numeric * 60',
      'range_semantics', '[start,end), so adjacent bookings do not overlap',
      'active_predicate', 'status IS DISTINCT FROM completed and all schedule fields are non-null'
    ),
    'columns', (select jsonb_agg(to_jsonb(column_report) order by column_name) from column_report),
    'data_findings', (select to_jsonb(data_findings) from data_findings),
    'existing_functions', coalesce(
      (select jsonb_agg(to_jsonb(function_catalog) order by function_name, identity_arguments) from function_catalog),
      '[]'::jsonb
    ),
    'existing_constraints', coalesce(
      (select jsonb_agg(to_jsonb(constraint_catalog) order by constraint_name) from constraint_catalog),
      '[]'::jsonb
    ),
    'insert_policies', coalesce(
      (select jsonb_agg(to_jsonb(insert_policies) order by policy_name) from insert_policies),
      '[]'::jsonb
    ),
    'direct_insert', jsonb_build_object(
      'authenticated_has_insert', (select authenticated_has_insert from capabilities),
      'insert_policy_exists', (select insert_policy_exists from capabilities),
      'table_overlap_guard_installed', (select overlap_constraint_installed from capabilities),
      'can_currently_bypass_create_booking_overlap_check', (
        select authenticated_has_insert and insert_policy_exists and not overlap_constraint_installed
        from capabilities
      )
    ),
    'platform', (select to_jsonb(capabilities) from capabilities),
    'checks', (select to_jsonb(checks) from checks),
    'precheck_ok', (
      select matches_table_exists
        and profiles_table_exists
        and required_columns_ok
        and existing_times_ok
        and no_existing_overlaps
        and no_conflicting_create_booking
        and no_conflicting_time_helper
        and no_conflicting_overlap_constraint
        and btree_gist_available
        and auth_uid_exists
        and supabase_roles_exist
      from checks
    )
  )
) as create_booking_atomic_precheck;
