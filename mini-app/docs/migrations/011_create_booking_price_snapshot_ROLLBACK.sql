-- 011_create_booking_price_snapshot_ROLLBACK.sql
-- Restore the exact create_booking implementation captured before migration 011.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $rollback_011$
declare
  v_definition text;
  v_definition_hash text;
  v_function_oid oid;
  v_function_owner oid;
  v_function_acl aclitem[];
  v_function_config text[];
  v_function_description text;
begin
  if pg_catalog.to_regclass('prosto_padel_internal.migration_011_function_state') is null
     or pg_catalog.to_regprocedure('public.create_booking(jsonb)') is null then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: complete migration 011 is not installed';
  end if;

  if coalesce(pg_catalog.obj_description(
       pg_catalog.to_regclass('prosto_padel_internal.migration_011_function_state'),
       'pg_class'
     ), '') not like 'migration=011_create_booking_price_snapshot;%'
     or coalesce(pg_catalog.obj_description(
       pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid,
       'pg_proc'
     ), '') not like 'migration=011_create_booking_price_snapshot;%' then
    raise exception 'ROLLBACK_CONFLICT: migration 011 objects were replaced or are unmanaged';
  end if;

  select
    s.function_definition, s.definition_hash, s.function_oid, s.function_owner,
    s.function_acl, s.function_config, s.function_description
  into
    v_definition, v_definition_hash, v_function_oid, v_function_owner,
    v_function_acl, v_function_config, v_function_description
  from prosto_padel_internal.migration_011_function_state s
  where s.function_identity = 'public.create_booking(jsonb)';

  if not found or v_definition_hash <> pg_catalog.md5(v_definition) then
    raise exception 'ROLLBACK_STATE_INVALID: captured create_booking definition is missing or corrupted';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
      and p.oid = v_function_oid
      and p.proowner = v_function_owner
      and p.proconfig is not distinct from v_function_config
      and lower(pg_catalog.pg_get_functiondef(p.oid)) like '%"priceperperson"%'
      -- aclitem[] order is not meaningful. Migration 011 may move the
      -- authenticated entry after service_role while preserving every grant.
      and not exists (
        (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
         from pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) a
         except
         select a.grantor, a.grantee, a.privilege_type, a.is_grantable
         from pg_catalog.aclexplode(
           coalesce(v_function_acl, pg_catalog.acldefault('f', v_function_owner))
         ) a)
        union all
        (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
         from pg_catalog.aclexplode(
           coalesce(v_function_acl, pg_catalog.acldefault('f', v_function_owner))
         ) a
         except
         select a.grantor, a.grantee, a.privilege_type, a.is_grantable
         from pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) a)
      )
  ) then
    raise exception 'ROLLBACK_CONFLICT: current create_booking no longer matches migration 011';
  end if;

  execute v_definition;
  execute pg_catalog.format(
    'comment on function public.create_booking(jsonb) is %L',
    v_function_description
  );

  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
      and p.oid = v_function_oid
      and p.proowner = v_function_owner
      and p.proconfig is not distinct from v_function_config
      and pg_catalog.obj_description(p.oid, 'pg_proc') is not distinct from v_function_description
      and pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) = v_definition_hash
      and not exists (
        (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
         from pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) a
         except
         select a.grantor, a.grantee, a.privilege_type, a.is_grantable
         from pg_catalog.aclexplode(
           coalesce(v_function_acl, pg_catalog.acldefault('f', v_function_owner))
         ) a)
        union all
        (select a.grantor, a.grantee, a.privilege_type, a.is_grantable
         from pg_catalog.aclexplode(
           coalesce(v_function_acl, pg_catalog.acldefault('f', v_function_owner))
         ) a
         except
         select a.grantor, a.grantee, a.privilege_type, a.is_grantable
         from pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) a)
      )
  ) then
    raise exception 'ROLLBACK_VERIFY_FAILED: create_booking was not restored exactly';
  end if;
end;
$rollback_011$;

drop table prosto_padel_internal.migration_011_function_state;

commit;
