-- 007_create_booking_atomic_POSTCHECK.sql
-- Catalog verification plus rollback-only behavioral checks.
-- Test rows exist only inside this transaction and are removed by the final ROLLBACK.

begin;

set local statement_timeout = '60s';

create temporary table booking_007_behavior (
  test_executed boolean not null default false,
  rpc_created_booking boolean not null default false,
  rpc_overlap_code_ok boolean not null default false,
  direct_open_match_created boolean not null default false,
  direct_overlap_blocked boolean not null default false,
  note text
) on commit drop;

insert into booking_007_behavior default values;

do $$
declare
  v_owner_id uuid;
  v_test_date date;
  v_test_court text;
  v_sqlstate text;
  v_message text;
begin
  select p.id
  into v_owner_id
  from public.profiles p
  order by p.created_at, p.id
  limit 1;

  if v_owner_id is null then
    update booking_007_behavior
    set note = 'Behavioral checks skipped: public.profiles has no row to satisfy matches.owner_id foreign key.';
    return;
  end if;

  select candidate_date, candidate_court
  into v_test_date, v_test_court
  from generate_series(date '2099-01-01', date '2099-12-31', interval '1 day') as dates(candidate_date)
  cross join unnest(array['p1','p2','p3','p4','p5','p6','p7','p8']::text[]) as courts(candidate_court)
  where not exists (
    select 1
    from public.matches m
    where m."dateISO" = candidate_date::date
      and m."courtId" = candidate_court
      and m.status is distinct from 'completed'
  )
  order by candidate_date, candidate_court
  limit 1;

  if v_test_date is null then
    update booking_007_behavior
    set note = 'Behavioral checks skipped: no empty court/day test key was available in 2099.';
    return;
  end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner_id::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_owner_id::text, 'role', 'authenticated')::text,
    true
  );

  update booking_007_behavior set test_executed = true;

  begin
    perform public.create_booking(
      pg_catalog.jsonb_build_object(
        'dateISO', v_test_date::text,
        'date', v_test_date::text,
        'time', '07:00',
        'duration', 1,
        'courtId', v_test_court,
        'courtName', 'Postcheck court',
        'courtType', 'panoramic',
        'isPrivate', true,
        'type', 'private',
        'scenario', 'private',
        'paymentStatus', 'full'
      )
    );
    update booking_007_behavior set rpc_created_booking = true;
  exception
    when others then
      update booking_007_behavior
      set note = concat_ws(' | ', note, 'Initial create_booking failed: ' || sqlstate || ' ' || sqlerrm);
  end;

  if (select rpc_created_booking from booking_007_behavior) then
    begin
      perform public.create_booking(
        pg_catalog.jsonb_build_object(
          'dateISO', v_test_date::text,
          'date', v_test_date::text,
          'time', '07:30',
          'duration', 1,
          'courtId', v_test_court,
          'courtName', 'Postcheck court',
          'courtType', 'panoramic',
          'isPrivate', true,
          'type', 'private',
          'scenario', 'private',
          'paymentStatus', 'full'
        )
      );
      update booking_007_behavior
      set note = concat_ws(' | ', note, 'Overlapping create_booking unexpectedly succeeded.');
    exception
      when others then
        get stacked diagnostics
          v_sqlstate = returned_sqlstate,
          v_message = message_text;
        update booking_007_behavior
        set rpc_overlap_code_ok = v_sqlstate = '23P01' and v_message = 'BOOKING_SLOT_TAKEN',
            note = case
              when v_sqlstate = '23P01' and v_message = 'BOOKING_SLOT_TAKEN' then note
              else concat_ws(' | ', note, 'Unexpected RPC overlap error: ' || v_sqlstate || ' ' || v_message)
            end;
    end;
  end if;

  begin
    insert into public.matches (
      owner_id,
      date,
      "dateISO",
      time,
      duration,
      "courtId",
      "courtName",
      "courtType",
      type,
      scenario,
      status,
      "isPrivate",
      "filledSlots",
      participants
    ) values (
      v_owner_id,
      v_test_date::text,
      v_test_date,
      '09:00',
      1,
      v_test_court,
      'Postcheck court',
      'panoramic',
      'match',
      'community',
      'searching',
      false,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', v_owner_id::text, 'isOrganizer', true)),
      array[v_owner_id::text]
    );
    update booking_007_behavior set direct_open_match_created = true;
  exception
    when others then
      update booking_007_behavior
      set note = concat_ws(' | ', note, 'Non-overlapping community match INSERT failed: ' || sqlstate || ' ' || sqlerrm);
  end;

  if (select direct_open_match_created from booking_007_behavior) then
    begin
      insert into public.matches (
        owner_id,
        date,
        "dateISO",
        time,
        duration,
        "courtId",
        "courtName",
        "courtType",
        type,
        scenario,
        status,
        "isPrivate",
        "filledSlots",
        participants
      ) values (
        v_owner_id,
        v_test_date::text,
        v_test_date,
        '09:30',
        1,
        v_test_court,
        'Postcheck court',
        'panoramic',
        'match',
        'community',
        'searching',
        false,
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', v_owner_id::text, 'isOrganizer', true)),
        array[v_owner_id::text]
      );
      update booking_007_behavior
      set note = concat_ws(' | ', note, 'Overlapping direct INSERT unexpectedly succeeded.');
    exception
      when exclusion_violation then
        update booking_007_behavior set direct_overlap_blocked = true;
      when others then
        update booking_007_behavior
        set note = concat_ws(' | ', note, 'Unexpected direct overlap error: ' || sqlstate || ' ' || sqlerrm);
    end;
  end if;
end;
$$;

with function_catalog as (
  select
    p.oid,
    p.proowner,
    pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    p.prorettype as result_type_oid,
    p.proretset as returns_set,
    p.prosecdef as security_definer,
    p.provolatile as volatility,
    p.proconfig as config,
    p.proacl,
    pg_catalog.obj_description(p.oid, 'pg_proc') as description,
    regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)), '\s+', ' ', 'g') as normalized_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'create_booking'
),
target_function as (
  select *
  from function_catalog
  where oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
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
constraint_catalog as (
  select
    c.oid,
    c.contype,
    pg_catalog.pg_get_constraintdef(c.oid, true) as definition,
    pg_catalog.obj_description(c.oid, 'pg_constraint') as description
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.matches'::pg_catalog.regclass
    and c.conname = 'matches_no_active_court_overlap'
),
helper_catalog as (
  select
    p.oid,
    p.provolatile,
    p.proisstrict,
    pg_catalog.obj_description(p.oid, 'pg_proc') as description
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.match_time_to_minutes(text)')::oid
),
insert_policy as (
  select
    pol.polname,
    pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check
  from pg_catalog.pg_policy pol
  where pol.polrelid = 'public.matches'::pg_catalog.regclass
    and pol.polcmd in ('a', '*')
),
checks as (
  select
    exists (select 1 from target_function) as function_exists,
    exists (
      select 1 from target_function
      where identity_arguments = 'p_booking jsonb'
        and not returns_set
        and result_type_oid = 'public.matches'::pg_catalog.regtype
    ) as signature_and_return_type_ok,
    exists (
      select 1 from target_function
      where not security_definer
        and coalesce(config @> array['search_path=pg_catalog, public, pg_temp'], false)
    ) as security_invoker_and_path_ok,
    not coalesce((select public_execute from target_acl), false)
      and not coalesce((select anon_execute from target_acl), false)
      and coalesce((select authenticated_execute from target_acl), false) as grants_ok,
    exists (
      select 1 from target_function
      where normalized_definition like '%auth.uid()%'
        and normalized_definition like '%pg_advisory_xact_lock%'
        and normalized_definition like '%status is distinct from ''completed''%'
        and normalized_definition like '%numrange(%'
        and normalized_definition like '%insert into public.matches%'
        and normalized_definition like '%when exclusion_violation%'
        and normalized_definition like '%booking_slot_taken%'
        and normalized_definition like '%23p01%'
        and normalized_definition like '%return v_created%'
    ) as rpc_core_logic_ok,
    exists (
      select 1 from constraint_catalog
      where contype = 'x'
        and lower(definition) like '%exclude using gist%'
        and lower(definition) like '%"courtid"%with =%'
        and lower(definition) like '%"dateiso"%with =%'
        and lower(definition) like '%numrange%with &&%'
        and lower(definition) like '%status is distinct from%completed%'
        and description like 'migration=007_create_booking_atomic;%'
    ) as table_overlap_constraint_ok,
    exists (
      select 1 from helper_catalog
      where provolatile = 'i'
        and proisstrict
        and description like 'migration=007_create_booking_atomic;%'
    ) as immutable_time_helper_ok,
    exists (select 1 from pg_catalog.pg_extension where extname = 'btree_gist') as btree_gist_installed,
    exists (
      select 1 from insert_policy
      where lower(coalesce(with_check, '')) like '%auth.uid()%owner_id%'
    ) and pg_catalog.has_table_privilege('authenticated', 'public.matches', 'INSERT') as open_match_insert_path_preserved,
    exists (
      select 1 from target_function
      where description like 'migration=007_create_booking_atomic;%'
        and description like '%rollback=drop%'
    )
    and exists (
      select 1 from constraint_catalog
      where description like 'migration=007_create_booking_atomic;%'
    ) as rollback_markers_ok,
    not exists (
      select 1
      from function_catalog
      where oid is distinct from pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
    ) as no_extra_create_booking_overloads,
    coalesce((select test_executed from booking_007_behavior), false) as behavioral_test_executed,
    coalesce((select rpc_created_booking from booking_007_behavior), false) as rpc_created_booking,
    coalesce((select rpc_overlap_code_ok from booking_007_behavior), false) as rpc_overlap_code_ok,
    coalesce((select direct_open_match_created from booking_007_behavior), false) as direct_open_match_created,
    coalesce((select direct_overlap_blocked from booking_007_behavior), false) as direct_overlap_blocked
)
select jsonb_build_object(
  'postcheck',
  jsonb_build_object(
    'function', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'identity_arguments', identity_arguments,
            'result_type', result_type,
            'security_definer', security_definer,
            'fixed_search_path', coalesce(config @> array['search_path=pg_catalog, public, pg_temp'], false),
            'description', description
          )
        )
        from target_function
      ),
      '[]'::jsonb
    ),
    'constraint', coalesce((select jsonb_agg(to_jsonb(constraint_catalog)) from constraint_catalog), '[]'::jsonb),
    'behavior', (select to_jsonb(booking_007_behavior) from booking_007_behavior),
    'checks', (select to_jsonb(checks) from checks),
    'postcheck_ok', (
      select function_exists
        and signature_and_return_type_ok
        and security_invoker_and_path_ok
        and grants_ok
        and rpc_core_logic_ok
        and table_overlap_constraint_ok
        and immutable_time_helper_ok
        and btree_gist_installed
        and open_match_insert_path_preserved
        and rollback_markers_ok
        and no_extra_create_booking_overloads
        and behavioral_test_executed
        and rpc_created_booking
        and rpc_overlap_code_ok
        and direct_open_match_created
        and direct_overlap_blocked
      from checks
    )
  )
) as create_booking_atomic_postcheck;

rollback;
