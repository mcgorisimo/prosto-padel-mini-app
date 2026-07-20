-- 010_match_waitlist_public_view_POSTCHECK.sql
-- Catalog and behavioral checks. Every test write is removed by final ROLLBACK.

begin;
set local statement_timeout = '120s';

create temporary table waitlist_010_behavior (
  test_executed boolean not null default false,
  fifo_order_ok boolean not null default false,
  organizer_access_ok boolean not null default false,
  participant_access_ok boolean not null default false,
  ordinary_user_access_ok boolean not null default false,
  unauthenticated_blocked boolean not null default false,
  private_match_blocked boolean not null default false,
  safe_projection_ok boolean not null default false,
  current_position_matches_ok boolean not null default false,
  existing_data_unchanged boolean not null default false,
  note text
) on commit drop;

insert into waitlist_010_behavior default values;

create temporary table waitlist_010_original_matches on commit drop as
select id, pg_catalog.md5(to_jsonb(m)::text) fingerprint
from public.matches m;

create temporary table waitlist_010_original_waitlist on commit drop as
select id, pg_catalog.md5(to_jsonb(w)::text) fingerprint
from public.match_waitlist w;

create temporary table waitlist_010_original_profiles on commit drop as
select id, pg_catalog.md5(to_jsonb(p)::text) fingerprint
from public.profiles p;

do $$
declare
  v_owner uuid;
  v_participant uuid;
  v_first uuid;
  v_second uuid;
  v_ordinary uuid;
  v_public_match uuid := pg_catalog.gen_random_uuid();
  v_private_match uuid := pg_catalog.gen_random_uuid();
  v_wait_first uuid := pg_catalog.gen_random_uuid();
  v_wait_second uuid := pg_catalog.gen_random_uuid();
  v_wait_ordinary uuid := pg_catalog.gen_random_uuid();
  v_wait_nonwaiting uuid := pg_catalog.gen_random_uuid();
  v_wait_private uuid := pg_catalog.gen_random_uuid();
  v_expected_order uuid[];
  v_actual_order uuid[];
  v_count integer;
  v_all_not_current boolean;
  v_current_count integer;
  v_public_position bigint;
  v_own_position bigint;
  v_message text;
  v_projection_ok boolean;
begin
  select id into v_owner
  from public.profiles
  order by id
  limit 1;

  select id into v_participant
  from public.profiles
  where id is distinct from v_owner
  order by id
  limit 1;

  select id into v_first
  from public.profiles
  where id is distinct from v_owner
    and id is distinct from v_participant
  order by id
  limit 1;

  select id into v_second
  from public.profiles
  where id is distinct from v_owner
    and id is distinct from v_participant
    and id is distinct from v_first
  order by id
  limit 1;

  select id into v_ordinary
  from public.profiles
  where id is distinct from v_owner
    and id is distinct from v_participant
    and id is distinct from v_first
    and id is distinct from v_second
  order by id
  limit 1;

  if v_ordinary is null then
    update waitlist_010_behavior
    set note = 'Behavioral checks skipped: five existing profiles are required; no profile/user was created.';
    return;
  end if;

  update waitlist_010_behavior set test_executed = true;

  insert into public.matches (
    id, owner_id, date, "dateISO", time, duration,
    "courtId", "courtName", "courtType", type, scenario, status,
    "isPrivate", "ratingMin", "ratingMax", "pricePerPerson",
    "filledSlots", participants
  ) values (
    v_public_match, v_owner, '20 января', date '2099-01-20', '10:00', 1.5,
    'wait010-public-' || v_public_match::text, '010 public test', 'panoramic',
    'match', 'social', 'open', false, 0, 6, 1000,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_owner::text, 'isOrganizer', true, 'slotIndex', 0
      ),
      pg_catalog.jsonb_build_object(
        'id', v_participant::text, 'isOrganizer', false, 'slotIndex', 1
      )
    ),
    array[v_owner::text, v_participant::text]
  );

  insert into public.matches (
    id, owner_id, date, "dateISO", time, duration,
    "courtId", "courtName", "courtType", type, scenario, status,
    "isPrivate", "ratingMin", "ratingMax", "pricePerPerson",
    "filledSlots", participants
  ) values (
    v_private_match, v_owner, '21 января', date '2099-01-21', '10:00', 1.5,
    'wait010-private-' || v_private_match::text, '010 private test', 'panoramic',
    'private', 'private', 'upcoming', true, 0, 6, 1000,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', v_owner::text, 'isOrganizer', true, 'slotIndex', 0
      )
    ),
    array[v_owner::text]
  );

  -- The first row has an earlier joined_at. The next two have the same
  -- joined_at, so their relative order must be decided by waitlist id.
  insert into public.match_waitlist (id, match_id, user_id, status, joined_at)
  values
    (v_wait_first, v_public_match, v_first, 'waiting', timestamptz '2098-01-01 10:00:00+03'),
    (v_wait_second, v_public_match, v_second, 'waiting', timestamptz '2098-01-02 10:00:00+03'),
    (v_wait_ordinary, v_public_match, v_ordinary, 'waiting', timestamptz '2098-01-02 10:00:00+03'),
    (v_wait_private, v_private_match, v_first, 'waiting', timestamptz '2098-01-01 10:00:00+03');

  insert into public.match_waitlist (
    id, match_id, user_id, status, joined_at, status_changed_at
  ) values (
    v_wait_nonwaiting, v_public_match, v_first, 'left',
    timestamptz '2097-01-01 10:00:00+03',
    timestamptz '2097-01-02 10:00:00+03'
  );

  select pg_catalog.array_agg(w.id order by w.joined_at, w.id)
  into v_expected_order
  from public.match_waitlist w
  where w.match_id = v_public_match
    and w.status = 'waiting';

  -- Organizer: authenticated database role plus organizer JWT identity.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
    true
  );
  begin
    execute 'set local role authenticated';
    execute pg_catalog.format(
      'select count(*)::integer, array_agg(g.waitlist_id order by g.queue_position), bool_and(not g.is_current_user) from public.get_match_waitlist(%L::uuid) g',
      v_public_match
    ) into v_count, v_actual_order, v_all_not_current;
    execute 'reset role';

    update waitlist_010_behavior
    set organizer_access_ok = v_count = 3
      and v_actual_order = v_expected_order
      and coalesce(v_all_not_current, false),
      fifo_order_ok = v_count = 3
        and v_actual_order = v_expected_order
        and v_expected_order[1] = v_wait_first;
  exception when others then
    get stacked diagnostics v_message = message_text;
    update waitlist_010_behavior
    set note = pg_catalog.concat_ws(' | ', note, 'organizer: ' || sqlstate || ' ' || v_message);
  end;

  -- Participant: same public list, no special organizer privilege required.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_participant::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_participant::text, 'role', 'authenticated')::text,
    true
  );
  begin
    execute 'set local role authenticated';
    execute pg_catalog.format(
      'select count(*)::integer, array_agg(g.waitlist_id order by g.queue_position), bool_and(not g.is_current_user) from public.get_match_waitlist(%L::uuid) g',
      v_public_match
    ) into v_count, v_actual_order, v_all_not_current;
    execute 'reset role';

    update waitlist_010_behavior
    set participant_access_ok = v_count = 3
      and v_actual_order = v_expected_order
      and coalesce(v_all_not_current, false);
  exception when others then
    get stacked diagnostics v_message = message_text;
    update waitlist_010_behavior
    set note = pg_catalog.concat_ws(' | ', note, 'participant: ' || sqlstate || ' ' || v_message);
  end;

  -- Ordinary authenticated user: not organizer or participant. This fixture
  -- user is waiting and must see exactly one is_current_user=true row.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_ordinary::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_ordinary::text, 'role', 'authenticated')::text,
    true
  );
  begin
    execute 'set local role authenticated';
    execute pg_catalog.format(
      'select count(*)::integer, array_agg(g.waitlist_id order by g.queue_position), count(*) filter (where g.is_current_user)::integer from public.get_match_waitlist(%L::uuid) g',
      v_public_match
    ) into v_count, v_actual_order, v_current_count;
    execute 'reset role';

    update waitlist_010_behavior
    set ordinary_user_access_ok = v_count = 3
      and v_actual_order = v_expected_order
      and v_current_count = 1;
  exception when others then
    get stacked diagnostics v_message = message_text;
    update waitlist_010_behavior
    set note = pg_catalog.concat_ws(' | ', note, 'ordinary user: ' || sqlstate || ' ' || v_message);
  end;

  -- The safe projection must match only the explicitly allowed source fields.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
    true
  );
  begin
    -- Run this source-value comparison as the migration/check role. The
    -- authenticated role intentionally cannot join arbitrary profile and
    -- waitlist rows directly; its real RPC access was tested above.
    execute pg_catalog.format($query$
      select bool_and(
        g.waitlist_id = w.id
        and g.user_id = w.user_id
        and g.first_name = pg_catalog.btrim(p.first_name)
        and g.last_name is not distinct from case
          when nullif(pg_catalog.btrim(p.last_name), '') is null then null::text
          else pg_catalog.left(pg_catalog.btrim(p.last_name), 1) || '.'
        end
        and g.photo_url is not distinct from nullif(pg_catalog.btrim(p.photo_url), '')
        and g.rating is not distinct from p.rating
        and g.joined_at = w.joined_at
        and not g.is_current_user
      )
      from public.get_match_waitlist(%L::uuid) g
      join public.match_waitlist w on w.id = g.waitlist_id
      join public.profiles p on p.id = g.user_id
    $query$, v_public_match) into v_projection_ok;

    update waitlist_010_behavior
    set safe_projection_ok = coalesce(v_projection_ok, false);
  exception when others then
    get stacked diagnostics v_message = message_text;
    update waitlist_010_behavior
    set note = pg_catalog.concat_ws(' | ', note, 'safe projection: ' || sqlstate || ' ' || v_message);
  end;

  -- A waiting user's position must equal migration 009's own-position RPC.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_second::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_second::text, 'role', 'authenticated')::text,
    true
  );
  begin
    execute 'set local role authenticated';
    execute pg_catalog.format($query$
      select
        (select g.queue_position from public.get_match_waitlist(%L::uuid) g where g.user_id = %L::uuid),
        (select q.queue_position from public.get_my_match_waitlist_position(%L::uuid) q)
    $query$, v_public_match, v_second, v_public_match)
    into v_public_position, v_own_position;
    execute 'reset role';

    update waitlist_010_behavior
    set current_position_matches_ok = v_public_position is not null
      and v_public_position = v_own_position
      and v_public_position = pg_catalog.array_position(v_expected_order, v_wait_second)::bigint;
  exception when others then
    get stacked diagnostics v_message = message_text;
    update waitlist_010_behavior
    set note = pg_catalog.concat_ws(' | ', note, 'position comparison: ' || sqlstate || ' ' || v_message);
  end;

  -- Private match: even its organizer cannot retrieve the inserted waiting row.
  perform pg_catalog.set_config('request.jwt.claim.sub', v_owner::text, true);
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_owner::text, 'role', 'authenticated')::text,
    true
  );
  begin
    execute 'set local role authenticated';
    execute pg_catalog.format(
      'select count(*)::integer from public.get_match_waitlist(%L::uuid)',
      v_private_match
    ) into v_count;
    execute 'reset role';
  exception when others then
    get stacked diagnostics v_message = message_text;
    update waitlist_010_behavior
    set private_match_blocked = v_message = 'WAITLIST_PUBLIC_MATCH_ONLY';
  end;

  -- anon must fail at EXECUTE privilege, before any data can be returned.
  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '{}'::jsonb::text, true);
  begin
    execute 'set local role anon';
    execute pg_catalog.format(
      'select count(*)::integer from public.get_match_waitlist(%L::uuid)',
      v_public_match
    ) into v_count;
    execute 'reset role';
  exception
    when insufficient_privilege then
      update waitlist_010_behavior set unauthenticated_blocked = true;
    when others then
      get stacked diagnostics v_message = message_text;
      update waitlist_010_behavior
      set note = pg_catalog.concat_ws(' | ', note, 'anon role: ' || sqlstate || ' ' || v_message);
  end;

  update waitlist_010_behavior
  set existing_data_unchanged =
    not exists (
      select 1
      from waitlist_010_original_matches o
      left join public.matches m on m.id = o.id
      where m.id is null or pg_catalog.md5(to_jsonb(m)::text) <> o.fingerprint
    )
    and not exists (
      select 1
      from waitlist_010_original_waitlist o
      left join public.match_waitlist w on w.id = o.id
      where w.id is null or pg_catalog.md5(to_jsonb(w)::text) <> o.fingerprint
    )
    and not exists (
      select 1
      from waitlist_010_original_profiles o
      left join public.profiles p on p.id = o.id
      where p.id is null or pg_catalog.md5(to_jsonb(p)::text) <> o.fingerprint
    )
    and (
      select count(*)
      from public.matches m
      where m.id not in (v_public_match, v_private_match)
    ) = (select count(*) from waitlist_010_original_matches)
    and (
      select count(*)
      from public.match_waitlist w
      where w.id not in (
        v_wait_first, v_wait_second, v_wait_ordinary,
        v_wait_nonwaiting, v_wait_private
      )
    ) = (select count(*) from waitlist_010_original_waitlist)
    and (select count(*) from public.profiles)
      = (select count(*) from waitlist_010_original_profiles);
exception when others then
  update waitlist_010_behavior
  set note = pg_catalog.concat_ws(' | ', note, sqlstate || ' ' || sqlerrm);
end;
$$;

with target_function as (
  select
    p.oid,
    p.proowner,
    p.proacl,
    p.prosecdef,
    p.provolatile,
    p.proconfig,
    p.proretset,
    p.proallargtypes,
    p.proargnames,
    p.proargmodes,
    pg_catalog.pg_get_function_identity_arguments(p.oid) identity_arguments,
    pg_catalog.pg_get_function_result(p.oid) result_type,
    pg_catalog.obj_description(p.oid, 'pg_proc') description,
    regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)), '\s+', ' ', 'g') definition
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.get_match_waitlist(uuid)')::oid
),
function_acl as (
  select
    a.grantee,
    coalesce(r.rolname, 'PUBLIC') role_name,
    a.privilege_type
  from target_function f
  cross join lateral pg_catalog.aclexplode(
    coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
),
waitlist_acl as (
  select
    a.grantee,
    coalesce(r.rolname, 'PUBLIC') role_name,
    a.privilege_type
  from pg_catalog.pg_class c
  cross join lateral pg_catalog.aclexplode(
    coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
  ) a
  left join pg_catalog.pg_roles r on r.oid = a.grantee
  where c.oid = pg_catalog.to_regclass('public.match_waitlist')
),
waitlist_policies as (
  select
    pol.polname,
    pol.polcmd,
    pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) using_expression
  from pg_catalog.pg_policy pol
  where pol.polrelid = pg_catalog.to_regclass('public.match_waitlist')
),
fifo_functions as (
  select
    n.nspname schema_name,
    p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) identity_arguments,
    pg_catalog.obj_description(p.oid, 'pg_proc') description,
    regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)), '\s+', ' ', 'g') definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.oid in (
    pg_catalog.to_regprocedure('public.get_my_match_waitlist_position(uuid)')::oid,
    pg_catalog.to_regprocedure('prosto_padel_internal.promote_match_waitlist(uuid)')::oid
  )
),
checks as (
  select
    (select count(*) = 1 from target_function) as function_exists_once,
    exists (
      select 1 from target_function
      where identity_arguments = 'p_match_id uuid'
        and proretset
        and proargnames = array[
          'p_match_id', 'waitlist_id', 'user_id', 'queue_position',
          'first_name', 'last_name', 'photo_url', 'rating',
          'joined_at', 'is_current_user'
        ]::text[]
        and proargmodes = array['i','t','t','t','t','t','t','t','t','t']::"char"[]
        and proallargtypes = array[
          'uuid'::pg_catalog.regtype::oid,
          'uuid'::pg_catalog.regtype::oid,
          'uuid'::pg_catalog.regtype::oid,
          'bigint'::pg_catalog.regtype::oid,
          'text'::pg_catalog.regtype::oid,
          'text'::pg_catalog.regtype::oid,
          'text'::pg_catalog.regtype::oid,
          'numeric'::pg_catalog.regtype::oid,
          'timestamp with time zone'::pg_catalog.regtype::oid,
          'boolean'::pg_catalog.regtype::oid
        ]::oid[]
    ) as exact_output_columns_ok,
    exists (
      select 1 from target_function
      where prosecdef
        and provolatile = 's'
        and coalesce(
          proconfig @> array['search_path=pg_catalog, public, pg_temp'],
          false
        )
        and description like 'migration=010_match_waitlist_public_view;%'
    ) as security_configuration_ok,
    not exists (
      select 1 from function_acl
      where privilege_type = 'EXECUTE'
        and (grantee = 0 or role_name = 'anon')
    )
    and exists (
      select 1 from function_acl
      where privilege_type = 'EXECUTE'
        and role_name = 'authenticated'
    ) as function_grants_ok,
    exists (
      select 1 from target_function
      where definition like '%auth.uid()%'
        and definition like '%waitlist_auth_required%'
        and definition like '%v_match_type is distinct from ''match'' or v_is_private%'
        and definition like '%waitlist_public_match_only%'
        and definition like '%w.status = ''waiting''%'
        and definition like '%order by w.joined_at, w.id%'
        and definition like '%order by r.queue_position%'
    ) as public_waiting_fifo_contract_ok,
    exists (
      select 1 from target_function
      where definition like '%pg_catalog.left(pg_catalog.btrim(r.last_name), 1) || ''.''%'
        and definition like '%r.user_id = v_user_id as is_current_user%'
        and definition not like '%p.email%'
        and definition not like '%p.phone%'
        and definition not like '%p.username%'
        and definition not like '%p.role%'
        and definition not like '%p.birthday%'
        and definition not like '%p.gender%'
        and definition not like '%p.language%'
        and definition not like '%p.side_preference%'
        and definition not like '%p.is_verified%'
    ) as personal_data_projection_safe,
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
        and (grantee = 0 or role_name = 'anon')
    )
    and exists (
      select 1 from waitlist_acl
      where privilege_type = 'SELECT'
        and role_name = 'authenticated'
    )
    and not exists (
      select 1 from waitlist_acl
      where (grantee = 0 or role_name in ('anon', 'authenticated'))
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
    ) as no_new_broad_table_access_ok,
    (select count(*) = 2 from fifo_functions)
    and not exists (
      select 1 from fifo_functions
      where description not like 'migration=009_match_waitlist_notifications;%'
        or definition not like '%order by w.joined_at, w.id%'
    ) as existing_fifo_rpcs_unchanged_contract_ok,
    coalesce((select test_executed from waitlist_010_behavior), false) behavioral_test_executed,
    coalesce((select fifo_order_ok from waitlist_010_behavior), false) fifo_order_ok,
    coalesce((select organizer_access_ok from waitlist_010_behavior), false) organizer_access_ok,
    coalesce((select participant_access_ok from waitlist_010_behavior), false) participant_access_ok,
    coalesce((select ordinary_user_access_ok from waitlist_010_behavior), false) ordinary_user_access_ok,
    coalesce((select unauthenticated_blocked from waitlist_010_behavior), false) unauthenticated_blocked,
    coalesce((select private_match_blocked from waitlist_010_behavior), false) private_match_blocked,
    coalesce((select safe_projection_ok from waitlist_010_behavior), false) safe_projection_ok,
    coalesce((select current_position_matches_ok from waitlist_010_behavior), false) current_position_matches_ok,
    coalesce((select existing_data_unchanged from waitlist_010_behavior), false) existing_data_unchanged
)
select pg_catalog.jsonb_build_object(
  'postcheck', pg_catalog.jsonb_build_object(
    'function', (select to_jsonb(target_function) - 'definition' from target_function),
    'function_grants', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(function_acl) order by role_name)
      from function_acl
    ), '[]'::jsonb),
    'waitlist_grants', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(waitlist_acl) order by role_name, privilege_type)
      from waitlist_acl
      where grantee = 0 or role_name in ('anon', 'authenticated')
    ), '[]'::jsonb),
    'waitlist_policies', coalesce((
      select pg_catalog.jsonb_agg(to_jsonb(waitlist_policies)) from waitlist_policies
    ), '[]'::jsonb),
    'behavior', (select to_jsonb(waitlist_010_behavior) from waitlist_010_behavior),
    'checks', (select to_jsonb(checks) from checks),
    'postcheck_ok', (
      select function_exists_once
        and exact_output_columns_ok
        and security_configuration_ok
        and function_grants_ok
        and public_waiting_fifo_contract_ok
        and personal_data_projection_safe
        and no_new_broad_table_access_ok
        and existing_fifo_rpcs_unchanged_contract_ok
        and behavioral_test_executed
        and fifo_order_ok
        and organizer_access_ok
        and participant_access_ok
        and ordinary_user_access_ok
        and unauthenticated_blocked
        and private_match_blocked
        and safe_projection_ok
        and current_position_matches_ok
        and existing_data_unchanged
      from checks
    )
  )
) as match_waitlist_public_view_postcheck;

rollback;
