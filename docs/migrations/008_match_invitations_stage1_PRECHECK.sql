-- 008_match_invitations_stage1_PRECHECK.sql
-- Read-only catalog and data audit. This file changes nothing.

with required_match_columns(column_name, expected_type) as (
  values
    ('id', 'uuid'),
    ('owner_id', 'uuid'),
    ('dateISO', 'date'),
    ('time', 'text'),
    ('status', 'text'),
    ('type', 'text'),
    ('scenario', 'text'),
    ('isPrivate', 'boolean'),
    ('ratingMin', 'integer'),
    ('ratingMax', 'integer'),
    ('pricePerPerson', 'numeric'),
    ('courtId', 'text'),
    ('courtName', 'text'),
    ('courtType', 'text'),
    ('filledSlots', 'jsonb'),
    ('participants', 'text[]')
),
actual_match_columns as (
  select
    a.attname as column_name,
    pg_catalog.format_type(a.atttypid, a.atttypmod) as actual_type,
    a.atttypid as type_oid,
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
column_checks as (
  select
    r.column_name,
    r.expected_type,
    a.actual_type,
    a.not_null,
    a.default_expression,
    case r.expected_type
      when 'uuid' then a.type_oid = pg_catalog.to_regtype('uuid')::oid
      when 'date' then a.type_oid = pg_catalog.to_regtype('date')::oid
      when 'text' then a.type_oid = pg_catalog.to_regtype('text')::oid
      when 'boolean' then a.type_oid = pg_catalog.to_regtype('boolean')::oid
      when 'integer' then a.type_oid = pg_catalog.to_regtype('integer')::oid
      when 'numeric' then a.type_oid = pg_catalog.to_regtype('numeric')::oid
      when 'jsonb' then a.type_oid = pg_catalog.to_regtype('jsonb')::oid
      when 'text[]' then a.type_oid = pg_catalog.to_regtype('text[]')::oid
      else false
    end as type_ok
  from required_match_columns r
  left join actual_match_columns a using (column_name)
),
profile_checks as (
  select
    exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = pg_catalog.to_regclass('public.profiles')
        and a.attname = 'id'
        and a.atttypid = pg_catalog.to_regtype('uuid')::oid
        and not a.attisdropped
    ) as id_ok,
    exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = pg_catalog.to_regclass('public.profiles')
        and a.attname = 'first_name'
        and a.atttypid = pg_catalog.to_regtype('text')::oid
        and not a.attisdropped
    ) as first_name_ok,
    exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = pg_catalog.to_regclass('public.profiles')
        and a.attname = 'last_name'
        and a.atttypid = pg_catalog.to_regtype('text')::oid
        and not a.attisdropped
    ) as last_name_ok,
    exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = pg_catalog.to_regclass('public.profiles')
        and a.attname = 'rating'
        and a.atttypid = pg_catalog.to_regtype('numeric')::oid
        and not a.attisdropped
    ) as rating_ok,
    exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = pg_catalog.to_regclass('public.profiles')
        and a.attname = 'is_verified'
        and a.atttypid = pg_catalog.to_regtype('boolean')::oid
        and not a.attisdropped
    ) as verified_ok,
    exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = pg_catalog.to_regclass('public.profiles')
        and a.attname = 'role'
        and a.atttypid = pg_catalog.to_regtype('text')::oid
        and not a.attisdropped
    ) as role_ok
),
join_functions as (
  select
    p.oid,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    p.prorettype as result_type_oid,
    p.proretset as returns_set,
    p.prosecdef as security_definer,
    p.proconfig as config,
    p.proowner,
    p.proacl,
    pg_catalog.obj_description(p.oid, 'pg_proc') as description,
    regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)), '\s+', ' ', 'g') as normalized_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'join_match'
),
target_join as (
  select *
  from join_functions
  where oid = pg_catalog.to_regprocedure('public.join_match(uuid)')::oid
),
join_acl as (
  select
    bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute,
    bool_or(r.rolname = 'anon' and a.privilege_type = 'EXECUTE') as anon_execute,
    bool_or(r.rolname = 'authenticated' and a.privilege_type = 'EXECUTE') as authenticated_execute
  from target_join f
  cross join lateral pg_catalog.aclexplode(
    coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
),
invitation_function_conflicts as (
  select
    p.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    pg_catalog.obj_description(p.oid, 'pg_proc') as description
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'create_match_invitation',
      'get_incoming_match_invitations',
      'accept_match_invitation',
      'decline_match_invitation',
      'cancel_match_invitation'
    )
),
matches_policies as (
  select
    pol.polname as policy_name,
    case pol.polcmd
      when 'r' then 'SELECT'
      when 'a' then 'INSERT'
      when 'w' then 'UPDATE'
      when 'd' then 'DELETE'
      when '*' then 'ALL'
    end as command,
    pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as using_expression,
    pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check_expression
  from pg_catalog.pg_policy pol
  where pol.polrelid = pg_catalog.to_regclass('public.matches')
),
matches_acl as (
  select
    r.rolname,
    a.privilege_type,
    a.is_grantable
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(
    coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  where c.oid = pg_catalog.to_regclass('public.matches')
    and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))
),
slot_rows as (
  select
    m.id as match_id,
    slots.slot_value,
    slots.ordinal_position,
    case
      when coalesce(slots.slot_value->>'slotIndex', '') ~ '^[0-3]$'
        then (slots.slot_value->>'slotIndex')::integer
      else (slots.ordinal_position - 1)::integer
    end as logical_slot_index
  from public.matches m
  cross join lateral pg_catalog.jsonb_array_elements(
    case
      when pg_catalog.jsonb_typeof(m."filledSlots") = 'array' then m."filledSlots"
      else '[]'::jsonb
    end
  ) with ordinality as slots(slot_value, ordinal_position)
),
data_findings as (
  select
    (select count(*) from public.matches) as match_count,
    (
      select count(*)
      from public.matches m
      where pg_catalog.jsonb_typeof(m."filledSlots") is distinct from 'array'
    ) as non_array_filled_slots_count,
    (
      select count(*)
      from public.matches m
      where pg_catalog.jsonb_typeof(m."filledSlots") = 'array'
        and pg_catalog.jsonb_array_length(m."filledSlots") > 4
    ) as over_capacity_match_count,
    (
      select count(*)
      from slot_rows s
      where s.slot_value ? 'slotIndex'
        and coalesce(s.slot_value->>'slotIndex', '') !~ '^[0-3]$'
    ) as invalid_explicit_slot_index_count,
    (
      select count(*)
      from (
        select match_id, logical_slot_index
        from slot_rows
        group by match_id, logical_slot_index
        having count(*) > 1
      ) duplicates
    ) as duplicate_logical_slot_count,
    (
      select count(*)
      from (
        select match_id, slot_value->>'id' as player_id
        from slot_rows
        where nullif(slot_value->>'id', '') is not null
        group by match_id, slot_value->>'id'
        having count(*) > 1
      ) duplicates
    ) as duplicate_player_slot_count
),
checks as (
  select
    pg_catalog.to_regclass('public.matches') is not null as matches_exists,
    pg_catalog.to_regclass('public.profiles') is not null as profiles_exists,
    not exists (select 1 from column_checks where actual_type is null or not type_ok) as matches_structure_ok,
    (
      select id_ok and first_name_ok and last_name_ok and rating_ok and verified_ok and role_ok
      from profile_checks
    ) as profiles_structure_ok,
    pg_catalog.to_regprocedure('auth.uid()') is not null as auth_uid_exists,
    exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
      and exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') as supabase_roles_exist,
    exists (
      select 1
      from target_join
      where identity_arguments = 'p_match_id uuid'
        and not returns_set
        and result_type_oid = pg_catalog.to_regtype('public.matches')::oid
        and security_definer
        and normalized_definition like '%auth.uid()%'
        and normalized_definition like '%for update%'
        and normalized_definition like '%update public.matches%'
        and normalized_definition like '%"filledslots"%'
        and normalized_definition like '%participants%'
        and normalized_definition like '%return v_updated%'
    ) as join_match_compatible,
    not coalesce((select public_execute from join_acl), false)
      and not coalesce((select anon_execute from join_acl), false)
      and coalesce((select authenticated_execute from join_acl), false) as join_match_grants_ok,
    not exists (
      select 1 from join_functions
      where oid is distinct from pg_catalog.to_regprocedure('public.join_match(uuid)')::oid
    ) as no_extra_join_match_overloads,
    pg_catalog.to_regclass('public.match_invitations') is null as invitation_table_absent,
    not exists (select 1 from invitation_function_conflicts) as invitation_functions_absent,
    (
      select non_array_filled_slots_count = 0
        and over_capacity_match_count = 0
        and invalid_explicit_slot_index_count = 0
        and duplicate_logical_slot_count = 0
        and duplicate_player_slot_count = 0
      from data_findings
    ) as existing_data_compatible,
    pg_catalog.has_table_privilege('authenticated', 'public.matches', 'UPDATE') as legacy_direct_update_currently_allowed
)
select pg_catalog.jsonb_build_object(
  'precheck', pg_catalog.jsonb_build_object(
    'matches_columns', coalesce(
      (select pg_catalog.jsonb_agg(to_jsonb(column_checks) order by column_name) from column_checks),
      '[]'::jsonb
    ),
    'join_match_versions', coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'identity_arguments', identity_arguments,
            'result_type', result_type,
            'security_definer', security_definer,
            'fixed_search_path', config,
            'description', description
          ) order by identity_arguments
        )
        from join_functions
      ),
      '[]'::jsonb
    ),
    'invitation_conflicts', pg_catalog.jsonb_build_object(
      'table_exists', pg_catalog.to_regclass('public.match_invitations') is not null,
      'functions', coalesce(
        (select pg_catalog.jsonb_agg(to_jsonb(invitation_function_conflicts)) from invitation_function_conflicts),
        '[]'::jsonb
      )
    ),
    'data_findings', (select to_jsonb(data_findings) from data_findings),
    'matches_policies', coalesce(
      (select pg_catalog.jsonb_agg(to_jsonb(matches_policies) order by policy_name) from matches_policies),
      '[]'::jsonb
    ),
    'matches_acl', coalesce(
      (select pg_catalog.jsonb_agg(to_jsonb(matches_acl) order by rolname, privilege_type) from matches_acl),
      '[]'::jsonb
    ),
    'checks', (select to_jsonb(checks) from checks),
    'precheck_ok', (
      select matches_exists
        and profiles_exists
        and matches_structure_ok
        and profiles_structure_ok
        and auth_uid_exists
        and supabase_roles_exist
        and join_match_compatible
        and join_match_grants_ok
        and no_extra_join_match_overloads
        and invitation_table_absent
        and invitation_functions_absent
        and existing_data_compatible
      from checks
    )
  )
) as match_invitations_stage1_precheck;
