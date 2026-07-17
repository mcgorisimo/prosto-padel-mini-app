-- 011_create_booking_price_snapshot_POSTCHECK.sql
-- Catalog and rollback-only behavior checks. Every test write is rolled back.

begin;
set local statement_timeout = '120s';

create temporary table booking_011_behavior (
  test_executed boolean not null default false,
  public_price_saved boolean not null default false,
  private_price_saved boolean not null default false,
  missing_price_backward_compatible boolean not null default false,
  invalid_zero_blocked boolean not null default false,
  existing_data_unchanged boolean not null default false,
  note text
) on commit drop;
insert into booking_011_behavior default values;

create temporary table booking_011_original_matches on commit drop as
select id, pg_catalog.md5(to_jsonb(m)::text) fingerprint from public.matches m;

do $$
declare
  v_user_id uuid;
  v_public public.matches;
  v_private public.matches;
  v_legacy public.matches;
  v_base_date date;
  v_message text;
begin
  select id into v_user_id from public.profiles order by created_at, id limit 1;
  if v_user_id is null then
    update booking_011_behavior
    set note = 'Behavioral checks skipped: one existing profile is required; no profile/user was created.';
    return;
  end if;

  select d::date into v_base_date
  from pg_catalog.generate_series(date '2099-01-01', date '2099-12-20', interval '1 day') d
  where not exists (
    select 1 from public.matches m
    where m."dateISO" between d::date and d::date + 3
      and m."courtId" in ('p7', 'p8')
      and m.status is distinct from 'completed'
  )
  order by d
  limit 1;

  if v_base_date is null then
    update booking_011_behavior set note = 'Behavioral checks skipped: no free rollback-only fixture dates found.';
    return;
  end if;

  update booking_011_behavior set test_executed = true;
  perform pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user_id::text, 'role', 'authenticated')::text,
    true
  );

  execute pg_catalog.format(
    'select * from public.create_booking(%L::jsonb)',
    pg_catalog.jsonb_build_object(
      'dateISO', v_base_date, 'date', '011 public', 'time', '07:00', 'duration', 1.5,
      'courtId', 'p7', 'courtName', '011 public court', 'courtType', 'panoramic',
      'type', 'match', 'scenario', 'social', 'isPrivate', false,
      'ratingMin', 0, 'ratingMax', 6, 'paymentStatus', 'partial',
      'pricePerPerson', 1350
    )::text
  ) into v_public;

  execute pg_catalog.format(
    'select * from public.create_booking(%L::jsonb)',
    pg_catalog.jsonb_build_object(
      'dateISO', v_base_date + 1, 'date', '011 private', 'time', '07:00', 'duration', 2,
      'courtId', 'p8', 'courtName', '011 private court', 'courtType', 'panoramic',
      'type', 'private', 'scenario', 'private', 'isPrivate', true,
      'ratingMin', 0, 'ratingMax', 6, 'paymentStatus', 'full',
      'price_per_person', 1800
    )::text
  ) into v_private;

  execute pg_catalog.format(
    'select * from public.create_booking(%L::jsonb)',
    pg_catalog.jsonb_build_object(
      'dateISO', v_base_date + 2, 'date', '011 legacy', 'time', '07:00', 'duration', 1,
      'courtId', 'p7', 'courtName', '011 legacy court', 'courtType', 'panoramic',
      'type', 'private', 'scenario', 'private', 'isPrivate', true,
      'ratingMin', 0, 'ratingMax', 6, 'paymentStatus', 'full'
    )::text
  ) into v_legacy;

  begin
    execute pg_catalog.format(
      'select public.create_booking(%L::jsonb)',
      pg_catalog.jsonb_build_object(
        'dateISO', v_base_date + 3, 'date', '011 invalid', 'time', '07:00', 'duration', 1,
        'courtId', 'p8', 'courtName', '011 invalid court', 'courtType', 'panoramic',
        'type', 'private', 'scenario', 'private', 'isPrivate', true,
        'ratingMin', 0, 'ratingMax', 6, 'paymentStatus', 'full',
        'pricePerPerson', 0
      )::text
    );
  exception when others then
    get stacked diagnostics v_message = message_text;
    update booking_011_behavior set invalid_zero_blocked = v_message = 'BOOKING_INVALID_PRICE_PER_PERSON';
  end;
  update booking_011_behavior set
    public_price_saved = v_public."pricePerPerson" = 1350
      and exists(select 1 from public.matches where id = v_public.id and "pricePerPerson" = 1350),
    private_price_saved = v_private."pricePerPerson" = 1800
      and exists(select 1 from public.matches where id = v_private.id and "pricePerPerson" = 1800),
    missing_price_backward_compatible = v_legacy.id is not null
      and v_legacy."pricePerPerson" is null;

  update booking_011_behavior set existing_data_unchanged =
    not exists (
      select 1 from booking_011_original_matches o
      left join public.matches m on m.id = o.id
      where m.id is null or pg_catalog.md5(to_jsonb(m)::text) <> o.fingerprint
    )
    and (
      select count(*) from public.matches
      where id not in (v_public.id, v_private.id, v_legacy.id)
    ) = (select count(*) from booking_011_original_matches);
exception when others then
  update booking_011_behavior
  set note = pg_catalog.concat_ws(' | ', note, sqlstate || ' ' || sqlerrm);
end;
$$;

with target_function as (
  select
    p.oid, p.proowner, p.proacl, p.prosecdef, p.proconfig,
    pg_catalog.pg_get_function_identity_arguments(p.oid) identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) result_type,
    pg_catalog.obj_description(p.oid, 'pg_proc') description,
    regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)), '\s+', ' ', 'g') definition
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
),
state_table as (
  select c.oid, c.relrowsecurity, c.relforcerowsecurity, c.relowner, c.relacl,
    pg_catalog.obj_description(c.oid, 'pg_class') description
  from pg_catalog.pg_class c
  where c.oid = pg_catalog.to_regclass('prosto_padel_internal.migration_011_function_state')
),
state_policies as (
  select pol.polname, pol.polcmd
  from pg_catalog.pg_policy pol
  where pol.polrelid = pg_catalog.to_regclass('prosto_padel_internal.migration_011_function_state')
),
internal_schema as (
  select n.oid, n.nspowner, n.nspacl
  from pg_catalog.pg_namespace n
  where n.nspname = 'prosto_padel_internal'
),
internal_schema_acl as (
  select a.grantee, coalesce(r.rolname, 'PUBLIC') role_name, a.privilege_type
  from internal_schema s
  cross join lateral pg_catalog.aclexplode(
    coalesce(s.nspacl, pg_catalog.acldefault('n', s.nspowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
),
saved_state as (
  select
    s.function_identity, s.function_oid, s.definition_hash,
    pg_catalog.md5(s.function_definition) actual_definition_hash,
    s.function_owner, s.function_acl, s.function_config,
    s.function_description,
    regexp_replace(lower(s.function_definition), '\s+', ' ', 'g') normalized_definition
  from prosto_padel_internal.migration_011_function_state s
  where s.function_identity = 'public.create_booking(jsonb)'
),
function_acl as (
  select a.grantor, a.grantee, coalesce(r.rolname, 'PUBLIC') role_name,
    a.privilege_type, a.is_grantable
  from target_function f
  cross join lateral pg_catalog.aclexplode(
    coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
),
state_acl as (
  select a.grantee, coalesce(r.rolname, 'PUBLIC') role_name, a.privilege_type
  from state_table s
  cross join lateral pg_catalog.aclexplode(
    coalesce(s.relacl, pg_catalog.acldefault('r', s.relowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
),
saved_function_acl as (
  select a.grantor, a.grantee, coalesce(r.rolname, 'PUBLIC') role_name,
    a.privilege_type, a.is_grantable
  from saved_state s
  cross join lateral pg_catalog.aclexplode(
    coalesce(s.function_acl, pg_catalog.acldefault('f', s.function_owner))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
),
rollback_checks as (
  select
    (select count(*) = 1 from state_table
      where relrowsecurity
        and not relforcerowsecurity
        and description like 'migration=011_create_booking_price_snapshot;%')
      and not exists(select 1 from state_policies)
      and not exists(select 1 from state_acl
        where (grantee = 0 or role_name in ('anon', 'authenticated'))
          and privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))
      and not exists (
        select 1
        from state_table t
        cross join (values ('anon'), ('authenticated')) client_roles(role_name)
        cross join (values
          ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
        ) checked_privileges(privilege_name)
        where pg_catalog.has_table_privilege(
          client_roles.role_name, t.oid, checked_privileges.privilege_name
        )
      ) as state_table_private_ok,
    (select count(*) = 1 from internal_schema)
      and not exists(select 1 from internal_schema_acl
        where (grantee = 0 or role_name in ('anon', 'authenticated'))
          and privilege_type in ('USAGE', 'CREATE'))
      and not pg_catalog.has_schema_privilege('anon', 'prosto_padel_internal', 'USAGE')
      and not pg_catalog.has_schema_privilege('anon', 'prosto_padel_internal', 'CREATE')
      and not pg_catalog.has_schema_privilege('authenticated', 'prosto_padel_internal', 'USAGE')
      and not pg_catalog.has_schema_privilege('authenticated', 'prosto_padel_internal', 'CREATE')
      as internal_schema_hidden_ok,
    exists (
      select 1
      from state_table t
      join internal_schema s on true
      where pg_catalog.has_schema_privilege(t.relowner, s.oid, 'USAGE')
        and pg_catalog.has_table_privilege(t.relowner, t.oid, 'SELECT')
        and pg_catalog.has_table_privilege(t.relowner, t.oid, 'INSERT')
        and pg_catalog.has_table_privilege(t.relowner, t.oid, 'DELETE')
    ) as rollback_owner_access_ok,
    (select count(*) = 1 from saved_state s
      where s.definition_hash = s.actual_definition_hash
        and s.function_description like 'migration=007_create_booking_atomic;%'
        and coalesce(
          s.function_config @> array['search_path=pg_catalog, public, pg_temp'],
          false
        )
        and (s.normalized_definition like '%returns public.matches%'
          or s.normalized_definition like '%returns matches%')
        -- SECURITY INVOKER is PostgreSQL's default and pg_get_functiondef()
        -- may omit it. Reject the privileged alternative instead.
        and s.normalized_definition not like '%security definer%'
        and s.normalized_definition like '%auth.uid()%'
        and s.normalized_definition like '%insert into public.matches%'
        and s.normalized_definition not like '%"priceperperson"%')
      and not exists(select 1 from saved_function_acl
        where privilege_type = 'EXECUTE' and (grantee = 0 or role_name = 'anon'))
      and exists(select 1 from saved_function_acl
        where privilege_type = 'EXECUTE' and role_name = 'authenticated')
      as saved_function_complete_ok,
    exists (
      select 1 from saved_state s
      join target_function f on f.oid = s.function_oid
      where s.function_owner = f.proowner
        and coalesce(s.function_config, array[]::text[])
          @> coalesce(f.proconfig, array[]::text[])
        and coalesce(f.proconfig, array[]::text[])
          @> coalesce(s.function_config, array[]::text[])
    )
      and not exists (
        (select grantor, grantee, privilege_type, is_grantable from saved_function_acl
         except
         select grantor, grantee, privilege_type, is_grantable from function_acl)
        union all
        (select grantor, grantee, privilege_type, is_grantable from function_acl
         except
         select grantor, grantee, privilege_type, is_grantable from saved_function_acl)
      ) as current_metadata_semantically_compatible_ok
),
checks as (
  select
    (select count(*) = 1 from target_function
      where identity_arguments = 'p_booking jsonb'
        and result_type in ('matches', 'public.matches')
        and not prosecdef
        and coalesce(proconfig @> array['search_path=pg_catalog, public, pg_temp'], false)
        and description like 'migration=011_create_booking_price_snapshot;%') as function_contract_ok,
    exists(select 1 from target_function
      where definition like '%p_booking->>''priceperperson''%'
        and definition like '%p_booking->>''price_per_person''%'
        and definition like '%booking_invalid_price_per_person%'
        and definition like '%"priceperperson", "filledslots"%'
        and definition like '%v_price_per_person%') as price_snapshot_logic_ok,
    not exists(select 1 from function_acl
      where privilege_type = 'EXECUTE' and (grantee = 0 or role_name = 'anon'))
      and exists(select 1 from function_acl
        where privilege_type = 'EXECUTE' and role_name = 'authenticated') as grants_ok,
    (select state_table_private_ok and internal_schema_hidden_ok
      and rollback_owner_access_ok and saved_function_complete_ok
      and current_metadata_semantically_compatible_ok
      from rollback_checks) as rollback_state_private_ok,
    coalesce((select test_executed from booking_011_behavior), false) behavioral_test_executed,
    coalesce((select public_price_saved from booking_011_behavior), false) public_price_saved,
    coalesce((select private_price_saved from booking_011_behavior), false) private_price_saved,
    coalesce((select missing_price_backward_compatible from booking_011_behavior), false) missing_price_backward_compatible,
    coalesce((select invalid_zero_blocked from booking_011_behavior), false) invalid_zero_blocked,
    coalesce((select existing_data_unchanged from booking_011_behavior), false) existing_data_unchanged
)
select pg_catalog.jsonb_build_object(
  'postcheck', pg_catalog.jsonb_build_object(
    'function', (select to_jsonb(target_function) - 'definition' from target_function),
    'rollback_state', (select to_jsonb(saved_state) - 'normalized_definition' from saved_state),
    'rollback_checks', (select to_jsonb(rollback_checks) from rollback_checks),
    'behavior', (select to_jsonb(booking_011_behavior) from booking_011_behavior),
    'checks', (select to_jsonb(checks) from checks),
    'postcheck_ok', (
      select function_contract_ok and price_snapshot_logic_ok and grants_ok
        and rollback_state_private_ok and behavioral_test_executed
        and public_price_saved and private_price_saved
        and missing_price_backward_compatible and invalid_zero_blocked
        and existing_data_unchanged
      from checks
    )
  )
) as create_booking_price_snapshot_postcheck;

rollback;
