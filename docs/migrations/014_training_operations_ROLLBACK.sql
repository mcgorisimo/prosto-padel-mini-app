-- 014_training_operations_ROLLBACK.sql
-- Removes only verified functions created by migration 014.
-- Tables and data from migrations 000-012 are never removed.

begin;
set local search_path = pg_catalog, public, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  v_signature text;
  v_function pg_catalog.regprocedure;
  v_comment text;
  v_definition_md5 text;
  v_acl_md5 text;
  v_owner oid;
  v_current_user_oid oid;
  v_is_superuser boolean;
  v_present_oids oid[] := array[]::oid[];
begin
  select r.oid, r.rolsuper
  into v_current_user_oid, v_is_superuser
  from pg_catalog.pg_roles r
  where r.rolname = current_user;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'training_current_customer_id',
        'training_request_transition_allowed',
        'create_individual_training_request',
        'transition_individual_training_request'
      ]::text[])
      and p.oid <> all (array_remove(array[
        pg_catalog.to_regprocedure('public.training_current_customer_id()')::oid,
        pg_catalog.to_regprocedure('public.training_request_transition_allowed(text,text)')::oid,
        pg_catalog.to_regprocedure('public.create_individual_training_request(uuid,jsonb)')::oid,
        pg_catalog.to_regprocedure(
          'public.transition_individual_training_request(uuid,text,text,text,text,jsonb)'
        )::oid
      ]::oid[], null))
  ) then
    raise exception 'ROLLBACK_ABORTED: an unexpected 014-name overload exists';
  end if;

  if exists (
    select 1 from pg_catalog.pg_class c
    where pg_catalog.obj_description(c.oid, 'pg_class') like 'migration=014_training_operations;%'
  )
  or exists (
    select 1 from pg_catalog.pg_trigger t
    where pg_catalog.obj_description(t.oid, 'pg_trigger') like 'migration=014_training_operations;%'
  )
  or exists (
    select 1 from pg_catalog.pg_policy p
    where pg_catalog.obj_description(p.oid, 'pg_policy') like 'migration=014_training_operations;%'
  ) then
    raise exception 'ROLLBACK_ABORTED: unexpected migration 014 table, trigger, or policy exists';
  end if;

  foreach v_signature in array array[
    'public.training_current_customer_id()',
    'public.training_request_transition_allowed(text,text)',
    'public.create_individual_training_request(uuid,jsonb)',
    'public.transition_individual_training_request(uuid,text,text,text,text,jsonb)'
  ]::text[] loop
    v_function := pg_catalog.to_regprocedure(v_signature);
    if v_function is null then
      continue;
    end if;

    select pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
             pg_catalog.pg_get_functiondef(p.oid), E'\r\n', E'\n'
           ), E'\r', E'\n')),
           p.proowner,
           pg_catalog.md5(coalesce(pg_catalog.string_agg(
             acl.grantee || '|' || acl.grantor || '|' || acl.privilege_type
               || '|' || acl.is_grantable,
             ',' order by acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
           ), '')),
           pg_catalog.obj_description(p.oid, 'pg_proc')
    into v_definition_md5, v_owner, v_acl_md5, v_comment
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(
      p.proacl, pg_catalog.acldefault('f', p.proowner)
    )) acl
    where p.oid = v_function
    group by p.oid, p.proowner;

    if v_comment is null
       or v_comment !~ '^migration=014_training_operations;rollback=drop;definition_md5=[0-9a-f]{32};owner_oid=[0-9]+;acl_md5=[0-9a-f]{32}$'
       or substring(v_comment from 'definition_md5=([0-9a-f]{32})') <> v_definition_md5
       or substring(v_comment from 'owner_oid=([0-9]+)')::oid <> v_owner
       or substring(v_comment from 'acl_md5=([0-9a-f]{32})') <> v_acl_md5 then
      raise exception 'ROLLBACK_ABORTED: function % was changed after migration 014', v_signature;
    end if;

    if not v_is_superuser and v_owner <> v_current_user_oid then
      raise exception 'ROLLBACK_ABORTED: current role does not own function %', v_signature;
    end if;

    v_present_oids := pg_catalog.array_append(v_present_oids, v_function::oid);
  end loop;

  -- Detect later objects before the first DROP. Dependencies between the four
  -- known functions are allowed and are removed in the explicit order below.
  if exists (
    select 1
    from pg_catalog.pg_depend d
    where d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
      and d.refobjid = any (v_present_oids)
      and d.deptype in ('n', 'a')
      and not (
        d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
        and d.objid = any (v_present_oids)
      )
  ) then
    raise exception 'ROLLBACK_ABORTED: a later object depends on a migration 014 function';
  end if;
end;
$$;

-- Wrappers first, then internal helpers. RESTRICT is the PostgreSQL default
-- and is written explicitly so an unknown dependency aborts the transaction.
drop function if exists public.transition_individual_training_request(
  uuid, text, text, text, text, jsonb
) restrict;
drop function if exists public.create_individual_training_request(uuid, jsonb) restrict;
drop function if exists public.training_request_transition_allowed(text, text) restrict;
drop function if exists public.training_current_customer_id() restrict;

commit;

select pg_catalog.jsonb_build_object(
  'migration', '014_training_operations',
  'status', 'ROLLBACK_014_COMPLETE',
  'training_012_tables_removed', false,
  'training_012_data_removed', false,
  'matches_changed', false,
  'create_booking_changed', false
) as training_014_rollback_result;
