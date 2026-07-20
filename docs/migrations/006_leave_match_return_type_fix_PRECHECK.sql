-- 006_leave_match_return_type_fix_PRECHECK.sql
-- Read-only catalog check. Safe states are: absent, legacy_jsonb, current_matches.

with function_catalog as (
  select
    p.oid,
    p.proowner,
    p.proname as function_name,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    p.prorettype as result_type_oid,
    p.proretset as returns_set,
    p.prosecdef as security_definer,
    p.proconfig as config,
    p.proacl,
    pg_catalog.pg_get_functiondef(p.oid) as function_definition,
    pg_catalog.obj_description(p.oid, 'pg_proc') as description
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'leave_match'
),
target_function as (
  select
    *,
    regexp_replace(lower(function_definition), '\s+', ' ', 'g') as normalized_definition
  from function_catalog
  where oid = pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid
),
target_acl as (
  select
    bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute,
    bool_or(r.rolname = 'anon' and a.privilege_type = 'EXECUTE') as anon_execute,
    bool_or(r.rolname = 'authenticated' and a.privilege_type = 'EXECUTE') as authenticated_execute
  from target_function f
  cross join lateral pg_catalog.aclexplode(
    coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
),
detected as (
  select case
    when not exists (select 1 from target_function) then 'absent'
    when exists (
      select 1 from target_function
      where not returns_set
        and result_type_oid = 'jsonb'::pg_catalog.regtype::oid
    ) then 'legacy_jsonb'
    when exists (
      select 1 from target_function
      where not returns_set
        and result_type_oid = pg_catalog.to_regtype('public.matches')::oid
        and normalized_definition like '%for update%'
        and normalized_definition like '%v_match.owner_id = v_user_id%'
        and normalized_definition like '%paid participation cannot be left through leave_match%'
        and normalized_definition like '%slot_value->>''id'' is distinct from v_user_id::text%'
        and normalized_definition like '%participant_id <> v_user_id::text%'
        and normalized_definition like '%return v_updated%'
    ) then 'current_matches'
    when exists (
      select 1 from target_function
      where not returns_set
        and result_type_oid = pg_catalog.to_regtype('public.matches')::oid
    ) then 'unsupported_current_matches'
    else 'unsupported'
  end as state
)
select jsonb_build_object(
  'precheck',
  jsonb_build_object(
    'detected_state', (select state from detected),
    'public_matches_type_exists', pg_catalog.to_regtype('public.matches') is not null,
    'target_function',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'identity_arguments', identity_arguments,
              'result_type', result_type,
              'returns_set', returns_set,
              'security_definer', security_definer,
              'fixed_search_path', coalesce(config @> array['search_path=public, pg_temp'], false),
              'description', description,
              'public_execute', coalesce((select public_execute from target_acl), false),
              'anon_execute', coalesce((select anon_execute from target_acl), false),
              'authenticated_execute', coalesce((select authenticated_execute from target_acl), false)
            )
          )
          from target_function
        ),
        '[]'::jsonb
      ),
    'extra_leave_match_overloads',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'identity_arguments', identity_arguments,
              'result_type', result_type
            )
            order by identity_arguments
          )
          from function_catalog
          where oid is distinct from pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid
        ),
        '[]'::jsonb
      ),
    'precheck_ok',
      (
        pg_catalog.to_regtype('public.matches') is not null
        and (select state from detected) in ('absent', 'legacy_jsonb', 'current_matches')
        and not exists (
          select 1
          from function_catalog
          where oid is distinct from pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid
        )
      )
  )
) as leave_match_return_type_fix_precheck;
