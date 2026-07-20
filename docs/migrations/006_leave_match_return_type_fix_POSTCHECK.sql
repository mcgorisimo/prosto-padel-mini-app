-- 006_leave_match_return_type_fix_POSTCHECK.sql
-- Read-only verification of signature, return type, security, grants and core 002 logic.

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
    pg_catalog.obj_description(p.oid, 'pg_proc') as description,
    regexp_replace(
      lower(pg_catalog.pg_get_functiondef(p.oid)),
      '\s+',
      ' ',
      'g'
    ) as normalized_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'leave_match'
),
target_function as (
  select *
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
checks as (
  select
    exists (select 1 from target_function) as function_exists,
    exists (
      select 1 from target_function
      where identity_arguments = 'p_match_id uuid'
        and not returns_set
        and result_type_oid = pg_catalog.to_regtype('public.matches')::oid
    ) as signature_and_return_type_ok,
    exists (
      select 1 from target_function
      where security_definer
        and coalesce(config @> array['search_path=public, pg_temp'], false)
    ) as security_ok,
    not coalesce((select public_execute from target_acl), false)
      and not coalesce((select anon_execute from target_acl), false)
      and coalesce((select authenticated_execute from target_acl), false) as grants_ok,
    exists (
      select 1 from target_function
      where normalized_definition like '%auth.uid()%'
        and normalized_definition like '%for update%'
        and normalized_definition like '%v_match.owner_id = v_user_id%'
        and normalized_definition like '%organizer slot cannot leave through leave_match%'
        and normalized_definition like '%paid participation cannot be left through leave_match%'
        and normalized_definition like '%slot_value->>''id'' is distinct from v_user_id::text%'
        and normalized_definition like '%participant_id <> v_user_id::text%'
        and normalized_definition like '%"filledslots" = v_new_filled_slots%'
        and normalized_definition like '%participants = v_new_participants%'
        and normalized_definition like '%return v_updated%'
    ) as core_logic_ok,
    exists (
      select 1 from target_function
      where description ~ 'migration=006_leave_match_return_type_fix'
        and description ~ 'rollback_state=(absent|legacy_jsonb|current_matches)'
    ) as rollback_marker_ok,
    not exists (
      select 1
      from function_catalog
      where oid is distinct from pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid
    ) as no_extra_overloads
)
select jsonb_build_object(
  'postcheck',
  jsonb_build_object(
    'function',
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'identity_arguments', identity_arguments,
              'result_type', result_type,
              'security_definer', security_definer,
              'fixed_search_path', coalesce(config @> array['search_path=public, pg_temp'], false),
              'description', description
            )
          )
          from target_function
        ),
        '[]'::jsonb
      ),
    'checks', (select to_jsonb(checks) from checks),
    'postcheck_ok',
      (
        select function_exists
          and signature_and_return_type_ok
          and security_ok
          and grants_ok
          and core_logic_ok
          and rollback_marker_ok
          and no_extra_overloads
        from checks
      )
  )
) as leave_match_return_type_fix_postcheck;
