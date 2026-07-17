-- 011_create_booking_price_snapshot_PRECHECK.sql
-- Read-only compatibility checks. Run before 011_create_booking_price_snapshot.sql.

begin;
set local statement_timeout = '30s';

with target_function as (
  select
    p.oid,
    p.prosecdef,
    p.proconfig,
    p.proacl,
    pg_catalog.pg_get_function_identity_arguments(p.oid) identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) result_type,
    pg_catalog.obj_description(p.oid, 'pg_proc') description,
    regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)), '\s+', ' ', 'g') definition
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
),
price_column as (
  select a.attname, a.atttypid, a.attnotnull
  from pg_catalog.pg_attribute a
  where a.attrelid = pg_catalog.to_regclass('public.matches')
    and a.attname = 'pricePerPerson'
    and a.attnum > 0
    and not a.attisdropped
),
client_grants as (
  select coalesce(r.rolname, 'PUBLIC') role_name, a.privilege_type
  from target_function f
  cross join lateral pg_catalog.aclexplode(
    coalesce(f.proacl, pg_catalog.acldefault('f', (select proowner from pg_catalog.pg_proc where oid = f.oid)))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
),
checks as (
  select
    pg_catalog.to_regclass('public.matches') is not null as matches_exists,
    pg_catalog.to_regclass('public.profiles') is not null as profiles_exists,
    (select count(*) = 1 from price_column
      where atttypid = 'numeric'::pg_catalog.regtype and not attnotnull) as compatible_price_column,
    (select count(*) = 1 from target_function
      where identity_arguments = 'p_booking jsonb'
        and result_type in ('matches', 'public.matches')
        and not prosecdef
        and coalesce(proconfig @> array['search_path=pg_catalog, public, pg_temp'], false)
        and description like 'migration=007_create_booking_atomic;%') as compatible_create_booking,
    exists(select 1 from target_function where definition like '%insert into public.matches%')
      and not exists(select 1 from target_function where definition like '%"priceperperson"%')
      as installed_function_does_not_save_price,
    exists(select 1 from client_grants where role_name = 'authenticated' and privilege_type = 'EXECUTE')
      and not exists(select 1 from client_grants where role_name in ('PUBLIC', 'anon') and privilege_type = 'EXECUTE')
      as existing_grants_safe,
    pg_catalog.to_regnamespace('prosto_padel_internal') is not null as internal_schema_exists,
    pg_catalog.to_regclass('prosto_padel_internal.migration_011_function_state') is null as no_state_conflict,
    not exists (
      select 1 from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_booking'
        and p.oid is distinct from pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
    ) as no_overload_conflict
)
select pg_catalog.jsonb_build_object(
  'precheck', pg_catalog.jsonb_build_object(
    'function', (select to_jsonb(target_function) - 'definition' from target_function),
    'price_column', (select to_jsonb(price_column) from price_column),
    'matches_without_price', (
      select count(*) from public.matches where "pricePerPerson" is null
    ),
    'checks', (select to_jsonb(checks) from checks),
    'precheck_ok', (
      select matches_exists and profiles_exists and compatible_price_column
        and compatible_create_booking and installed_function_does_not_save_price
        and existing_grants_safe and internal_schema_exists and no_state_conflict
        and no_overload_conflict
      from checks
    )
  )
) as create_booking_price_snapshot_precheck;

rollback;
