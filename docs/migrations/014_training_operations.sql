-- 014_training_operations.sql
-- Proposed server operations for individual training requests.
-- IMPORTANT: on the current migration 011 contract this script stops before
-- creating anything because there is no trusted server court-price source.

begin;
set local search_path = pg_catalog, public, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  v_definition text;
  v_comment text;
  v_role text;
  v_name text;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role']::text[] loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = v_role) then
      raise exception 'MIGRATION_PRECONDITION_FAILED: role % is missing', v_role;
    end if;
  end loop;

  if pg_catalog.to_regprocedure('auth.uid()') is null
     or not pg_catalog.has_function_privilege(current_user, 'auth.uid()', 'EXECUTE') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration owner cannot execute auth.uid()';
  end if;

  if pg_catalog.to_regclass('public.training_requests') is null
     or pg_catalog.to_regclass('public.training_status_history') is null
     or pg_catalog.to_regclass('public.training_coach_assignments') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 012 is incomplete';
  end if;

  foreach v_name in array array[
    'training_requests', 'training_status_history', 'training_coach_assignments'
  ]::text[] loop
    if pg_catalog.obj_description(
      pg_catalog.to_regclass('public.' || v_name), 'pg_class'
    ) not like 'migration=012_training_domain;%' then
      raise exception 'MIGRATION_PRECONDITION_FAILED: public.% is not owned by migration 012', v_name;
    end if;
  end loop;

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
  ) then
    raise exception 'MIGRATION_CONFLICT: migration 014 function already exists';
  end if;

  select pg_catalog.pg_get_functiondef(p.oid),
         pg_catalog.obj_description(p.oid, 'pg_proc')
  into v_definition, v_comment
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')
    and p.prorettype = 'public.matches'::pg_catalog.regtype
    and not p.prosecdef
    and p.proconfig = array['search_path=pg_catalog, public, pg_temp']::text[];

  if v_definition is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: create_booking(jsonb) contract is incompatible';
  end if;

  if v_comment not like '%trusted_court_price_source=true;%'
     or pg_catalog.strpos(pg_catalog.lower(v_definition),
       'p_booking->>''priceperperson''') > 0
     or pg_catalog.strpos(pg_catalog.lower(v_definition),
       'p_booking->>''price_per_person''') > 0 then
    raise exception using
      errcode = '55000',
      message = 'MIGRATION_014_BLOCKED_TRUSTED_COURT_PRICE_SOURCE_MISSING',
      detail = 'Migration 011 reads pricePerPerson from client JSON. Training creation must not trust that value.',
      hint = 'Apply and verify migration 013 with a trusted server tariff source, then re-audit migration 014 before applying it.';
  end if;
end;
$$;

-- Capture the complete structure and rows of the three 012 tables before any
-- 014 object is created. These transaction-local values are checked again below.
do $$
declare
  v_relation text;
  v_fingerprint text;
  v_rows_fingerprint text;
begin
  foreach v_relation in array array[
    'public.training_requests',
    'public.training_status_history',
    'public.training_coach_assignments'
  ]::text[] loop
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(x.item, E'\n' order by x.item), ''))
    into v_fingerprint
    from (
      select pg_catalog.format(
        'column|%s|%s|%s|%s|%s', a.attnum, a.attname,
        pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
        coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '')
      ) as item
      from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef d
        on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = v_relation::pg_catalog.regclass
        and a.attnum > 0 and not a.attisdropped
      union all
      select 'constraint|' || c.conname || '|' || c.contype || '|'
        || pg_catalog.pg_get_constraintdef(c.oid, true)
      from pg_catalog.pg_constraint c
      where c.conrelid = v_relation::pg_catalog.regclass
      union all
      select 'index|' || c.relname || '|' || pg_catalog.pg_get_indexdef(i.indexrelid)
        || '|' || i.indisvalid || '|' || i.indisready
      from pg_catalog.pg_index i
      join pg_catalog.pg_class c on c.oid = i.indexrelid
      where i.indrelid = v_relation::pg_catalog.regclass
      union all
      select 'policy|' || p.polname || '|' || p.polcmd || '|' || p.polpermissive
        || '|' || p.polroles::text || '|'
        || coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '') || '|'
        || coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')
      from pg_catalog.pg_policy p
      where p.polrelid = v_relation::pg_catalog.regclass
      union all
      select 'trigger|' || t.tgname || '|' || pg_catalog.pg_get_triggerdef(t.oid, true)
      from pg_catalog.pg_trigger t
      where t.tgrelid = v_relation::pg_catalog.regclass and not t.tgisinternal
      union all
      select 'acl|' || acl.grantee || '|' || acl.grantor || '|'
        || acl.privilege_type || '|' || acl.is_grantable
      from pg_catalog.pg_class c
      cross join lateral pg_catalog.aclexplode(coalesce(
        c.relacl, pg_catalog.acldefault('r', c.relowner)
      )) acl
      where c.oid = v_relation::pg_catalog.regclass
      union all
      select 'flags|' || c.relowner || '|' || c.relrowsecurity || '|'
        || c.relforcerowsecurity || '|' || coalesce(
          pg_catalog.obj_description(c.oid, 'pg_class'), ''
        )
      from pg_catalog.pg_class c
      where c.oid = v_relation::pg_catalog.regclass
    ) x;

    execute pg_catalog.format(
      'select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, E''\n'' order by t.id::text), '''')) from %s t',
      v_relation
    ) into v_rows_fingerprint;

    perform pg_catalog.set_config(
      'prosto_padel.migration_014_schema_' || pg_catalog.replace(v_relation, '.', '_'),
      v_fingerprint, true
    );
    perform pg_catalog.set_config(
      'prosto_padel.migration_014_rows_' || pg_catalog.replace(v_relation, '.', '_'),
      v_rows_fingerprint, true
    );
  end loop;

  perform pg_catalog.set_config(
    'prosto_padel.migration_014_create_booking',
    pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
      pg_catalog.pg_get_functiondef('public.create_booking(jsonb)'::pg_catalog.regprocedure),
      E'\r\n', E'\n'
    ), E'\r', E'\n')), true
  );
end;
$$;

-- Supabase authentication adapter. Core operations call this small boundary;
-- replacing the auth provider only requires replacing this function/wrapper.
create function public.training_current_customer_id()
returns uuid
language sql
stable
security invoker
set search_path = pg_catalog, auth, pg_temp
as $$
  select auth.uid()
$$;

revoke all on function public.training_current_customer_id()
from public, anon, authenticated, service_role;

-- PostgreSQL-only transition graph. Terminal states have no outgoing edges.
-- awaiting_coach -> confirmed is intentionally unavailable until a real coach
-- assignment and trusted coach-price operation exist.
create function public.training_request_transition_allowed(
  p_from_status text,
  p_to_status text
)
returns boolean
language sql
immutable
strict
security invoker
set search_path = pg_catalog, pg_temp
as $$
  select case p_from_status
    when 'court_sync_pending' then p_to_status = any (array[
      'court_sync_unknown', 'awaiting_coach', 'rejected'
    ]::text[])
    when 'court_sync_unknown' then p_to_status = any (array[
      'awaiting_coach', 'rejected'
    ]::text[])
    when 'awaiting_coach' then p_to_status = any (array[
      'rejected', 'cancel_pending'
    ]::text[])
    when 'confirmed' then p_to_status = any (array[
      'cancel_pending', 'completed'
    ]::text[])
    when 'cancel_pending' then p_to_status = 'cancelled'
    else false
  end
$$;

revoke all on function public.training_request_transition_allowed(text, text)
from public, anon, authenticated, service_role;

create function public.create_individual_training_request(
  p_client_request_id uuid,
  p_booking jsonb
)
returns public.training_requests
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $$
declare
  v_customer_id uuid;
  v_existing public.training_requests%rowtype;
  v_created_booking public.matches%rowtype;
  v_created_request public.training_requests%rowtype;
  v_payload jsonb;
  v_duration numeric;
  v_duration_minutes smallint;
  v_scheduled_start_at timestamp with time zone;
  v_court_price numeric(12,2);
begin
  v_customer_id := public.training_current_customer_id();

  if v_customer_id is null then
    raise exception using errcode = '28000', message = 'TRAINING_AUTH_REQUIRED';
  end if;
  if p_client_request_id is null then
    raise exception using errcode = '22023', message = 'TRAINING_CLIENT_REQUEST_ID_REQUIRED';
  end if;
  if p_booking is null or pg_catalog.jsonb_typeof(p_booking) <> 'object' then
    raise exception using errcode = '22023', message = 'TRAINING_INVALID_BOOKING_PAYLOAD';
  end if;
  if p_booking ?| array['pricePerPerson', 'price_per_person']::text[] then
    raise exception using
      errcode = '22023',
      message = 'TRAINING_CLIENT_COURT_PRICE_FORBIDDEN';
  end if;

  begin
    v_duration := nullif(pg_catalog.btrim(p_booking->>'duration'), '')::numeric;
  exception
    when invalid_text_representation then
      raise exception using errcode = '22023', message = 'TRAINING_INVALID_DURATION';
  end;

  if v_duration is null or v_duration <> all (array[1, 1.5]::numeric[]) then
    raise exception using errcode = '22023', message = 'TRAINING_DURATION_MUST_BE_60_OR_90';
  end if;
  v_duration_minutes := (v_duration * 60::numeric)::smallint;

  -- Serialize all requests by the durable customer/client key before lookup.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'training-request:' || v_customer_id::text || ':' || p_client_request_id::text,
    0
  ));

  select r.* into v_existing
  from public.training_requests r
  where r.customer_id = v_customer_id
    and r.client_request_id = p_client_request_id
  for update;

  if found then
    return v_existing;
  end if;

  -- Force the only supported scenario and remove all client price aliases.
  v_payload := p_booking - 'pricePerPerson' - 'price_per_person';
  v_payload := pg_catalog.jsonb_set(v_payload, '{type}', '"private"'::jsonb, true);
  v_payload := pg_catalog.jsonb_set(v_payload, '{scenario}', '"private"'::jsonb, true);
  v_payload := pg_catalog.jsonb_set(v_payload, '{isPrivate}', 'true'::jsonb, true);
  v_payload := pg_catalog.jsonb_set(v_payload, '{status}', '"upcoming"'::jsonb, true);

  -- create_booking owns the existing atomic slot lock and exclusion handling.
  -- A later trusted implementation must populate pricePerPerson independently
  -- of the sanitized payload. A NULL price aborts this whole transaction.
  v_created_booking := public.create_booking(v_payload);

  if v_created_booking.owner_id is distinct from v_customer_id
     or v_created_booking.type is distinct from 'private'
     or v_created_booking.scenario is distinct from 'private'
     or v_created_booking."isPrivate" is distinct from true
     or v_created_booking.status is distinct from 'upcoming'
     or v_created_booking.duration is distinct from v_duration then
    raise exception using errcode = '55000', message = 'TRAINING_BOOKING_CONTRACT_VIOLATION';
  end if;

  v_court_price := v_created_booking."pricePerPerson"::numeric(12,2);
  if v_court_price is null
     or v_court_price::text = 'NaN'
     or v_court_price < 0
     or v_court_price > 1000000 then
    raise exception using
      errcode = '55000',
      message = 'TRAINING_TRUSTED_COURT_PRICE_UNAVAILABLE';
  end if;

  if v_created_booking."dateISO" is null
     or v_created_booking.time is null
     or v_created_booking."courtId" is null then
    raise exception using errcode = '55000', message = 'TRAINING_BOOKING_SNAPSHOT_INCOMPLETE';
  end if;

  v_scheduled_start_at := (
    v_created_booking."dateISO"::timestamp without time zone
    + v_created_booking.time::time without time zone
  ) at time zone 'Europe/Moscow';

  insert into public.training_requests (
    client_request_id,
    customer_id,
    court_booking_id,
    format,
    player_count,
    duration_minutes,
    coach_selection,
    status,
    court_price_amount,
    coach_price_amount,
    currency,
    payment_status,
    scheduled_start_at,
    court_id_snapshot,
    free_cancellation_until
  ) values (
    p_client_request_id,
    v_customer_id,
    v_created_booking.id,
    'individual',
    1,
    v_duration_minutes,
    'club',
    'court_sync_pending',
    v_court_price,
    null,
    'RUB',
    'not_due',
    v_scheduled_start_at,
    v_created_booking."courtId",
    v_scheduled_start_at - interval '24 hours'
  )
  returning * into v_created_request;

  insert into public.training_status_history (
    training_request_id,
    from_status,
    to_status,
    event_type,
    actor_type,
    actor_id,
    metadata
  ) values (
    v_created_request.id,
    null,
    'court_sync_pending',
    'request_created',
    'customer',
    v_customer_id,
    pg_catalog.jsonb_build_object(
      'client_request_id', p_client_request_id,
      'court_booking_id', v_created_booking.id
    )
  );

  insert into public.training_coach_assignments (
    training_request_id,
    coach_id,
    status,
    assigned_by
  ) values (
    v_created_request.id,
    null,
    'selection_pending',
    null
  );

  return v_created_request;
end;
$$;

revoke all on function public.create_individual_training_request(uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.create_individual_training_request(uuid, jsonb)
to authenticated;

create function public.transition_individual_training_request(
  p_training_request_id uuid,
  p_expected_status text,
  p_new_status text,
  p_event_type text,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.training_requests
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, pg_temp
set row_security = off
as $$
declare
  v_request public.training_requests%rowtype;
begin
  if p_training_request_id is null
     or p_expected_status is null
     or p_new_status is null
     or nullif(pg_catalog.btrim(p_event_type), '') is null then
    raise exception using errcode = '22023', message = 'TRAINING_TRANSITION_ARGUMENT_REQUIRED';
  end if;
  if p_metadata is null or pg_catalog.jsonb_typeof(p_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'TRAINING_TRANSITION_METADATA_MUST_BE_OBJECT';
  end if;

  select r.* into v_request
  from public.training_requests r
  where r.id = p_training_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'TRAINING_REQUEST_NOT_FOUND';
  end if;
  if v_request.status is distinct from p_expected_status then
    raise exception using
      errcode = '40001',
      message = 'TRAINING_STATUS_CHANGED',
      detail = pg_catalog.format('Expected %s, found %s', p_expected_status, v_request.status);
  end if;
  if not public.training_request_transition_allowed(v_request.status, p_new_status) then
    raise exception using errcode = '22023', message = 'TRAINING_STATUS_TRANSITION_NOT_ALLOWED';
  end if;

  update public.training_requests
  set status = p_new_status
  where id = v_request.id
  returning * into v_request;

  insert into public.training_status_history (
    training_request_id,
    from_status,
    to_status,
    event_type,
    actor_type,
    actor_id,
    reason,
    metadata
  ) values (
    v_request.id,
    p_expected_status,
    p_new_status,
    pg_catalog.btrim(p_event_type),
    'system',
    null,
    p_reason,
    p_metadata
  );

  return v_request;
end;
$$;

revoke all on function public.transition_individual_training_request(
  uuid, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.transition_individual_training_request(
  uuid, text, text, text, text, jsonb
) to service_role;

-- Store a definition/owner/ACL fingerprint on every 014 function. ROLLBACK
-- refuses to drop a function whose definition, owner, ACL, or overload set changed.
do $$
declare
  v_signature text;
  v_function pg_catalog.regprocedure;
  v_definition_md5 text;
  v_acl_md5 text;
  v_owner oid;
begin
  foreach v_signature in array array[
    'public.training_current_customer_id()',
    'public.training_request_transition_allowed(text,text)',
    'public.create_individual_training_request(uuid,jsonb)',
    'public.transition_individual_training_request(uuid,text,text,text,text,jsonb)'
  ]::text[] loop
    v_function := pg_catalog.to_regprocedure(v_signature);

    select pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
             pg_catalog.pg_get_functiondef(p.oid), E'\r\n', E'\n'
           ), E'\r', E'\n')),
           p.proowner,
           pg_catalog.md5(coalesce(pg_catalog.string_agg(
             acl.grantee || '|' || acl.grantor || '|' || acl.privilege_type
               || '|' || acl.is_grantable,
             ',' order by acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
           ), ''))
    into v_definition_md5, v_owner, v_acl_md5
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(
      p.proacl, pg_catalog.acldefault('f', p.proowner)
    )) acl
    where p.oid = v_function
    group by p.oid, p.proowner;

    execute pg_catalog.format(
      'comment on function %s is %L',
      v_function,
      pg_catalog.format(
        'migration=014_training_operations;rollback=drop;definition_md5=%s;owner_oid=%s;acl_md5=%s',
        v_definition_md5, v_owner, v_acl_md5
      )
    );
  end loop;
end;
$$;

-- Recalculate the 012 table structure and rows. Any difference aborts the
-- whole transaction, so 014 cannot silently alter migration 012 or its data.
do $$
declare
  v_relation text;
  v_fingerprint text;
  v_rows_fingerprint text;
begin
  foreach v_relation in array array[
    'public.training_requests',
    'public.training_status_history',
    'public.training_coach_assignments'
  ]::text[] loop
    select pg_catalog.md5(coalesce(pg_catalog.string_agg(x.item, E'\n' order by x.item), ''))
    into v_fingerprint
    from (
      select pg_catalog.format(
        'column|%s|%s|%s|%s|%s', a.attnum, a.attname,
        pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull,
        coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '')
      ) as item
      from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef d
        on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = v_relation::pg_catalog.regclass
        and a.attnum > 0 and not a.attisdropped
      union all
      select 'constraint|' || c.conname || '|' || c.contype || '|'
        || pg_catalog.pg_get_constraintdef(c.oid, true)
      from pg_catalog.pg_constraint c
      where c.conrelid = v_relation::pg_catalog.regclass
      union all
      select 'index|' || c.relname || '|' || pg_catalog.pg_get_indexdef(i.indexrelid)
        || '|' || i.indisvalid || '|' || i.indisready
      from pg_catalog.pg_index i join pg_catalog.pg_class c on c.oid = i.indexrelid
      where i.indrelid = v_relation::pg_catalog.regclass
      union all
      select 'policy|' || p.polname || '|' || p.polcmd || '|' || p.polpermissive
        || '|' || p.polroles::text || '|'
        || coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), '') || '|'
        || coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')
      from pg_catalog.pg_policy p where p.polrelid = v_relation::pg_catalog.regclass
      union all
      select 'trigger|' || t.tgname || '|' || pg_catalog.pg_get_triggerdef(t.oid, true)
      from pg_catalog.pg_trigger t
      where t.tgrelid = v_relation::pg_catalog.regclass and not t.tgisinternal
      union all
      select 'acl|' || acl.grantee || '|' || acl.grantor || '|'
        || acl.privilege_type || '|' || acl.is_grantable
      from pg_catalog.pg_class c
      cross join lateral pg_catalog.aclexplode(coalesce(
        c.relacl, pg_catalog.acldefault('r', c.relowner)
      )) acl
      where c.oid = v_relation::pg_catalog.regclass
      union all
      select 'flags|' || c.relowner || '|' || c.relrowsecurity || '|'
        || c.relforcerowsecurity || '|' || coalesce(
          pg_catalog.obj_description(c.oid, 'pg_class'), ''
        )
      from pg_catalog.pg_class c where c.oid = v_relation::pg_catalog.regclass
    ) x;

    execute pg_catalog.format(
      'select pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(t)::text, E''\n'' order by t.id::text), '''')) from %s t',
      v_relation
    ) into v_rows_fingerprint;

    if v_fingerprint is distinct from pg_catalog.current_setting(
         'prosto_padel.migration_014_schema_' || pg_catalog.replace(v_relation, '.', '_'), true
       )
       or v_rows_fingerprint is distinct from pg_catalog.current_setting(
         'prosto_padel.migration_014_rows_' || pg_catalog.replace(v_relation, '.', '_'), true
       ) then
      raise exception 'MIGRATION_FAILED: 014 changed migration 012 relation %', v_relation;
    end if;
  end loop;

  if pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
       pg_catalog.pg_get_functiondef('public.create_booking(jsonb)'::pg_catalog.regprocedure),
       E'\r\n', E'\n'
     ), E'\r', E'\n')) is distinct from pg_catalog.current_setting(
       'prosto_padel.migration_014_create_booking', true
     ) then
    raise exception 'MIGRATION_FAILED: 014 changed create_booking';
  end if;
end;
$$;

commit;

select pg_catalog.jsonb_build_object(
  'migration', '014_training_operations',
  'status', 'MIGRATION_014_COMPLETE',
  'client_create_function', 'public.create_individual_training_request(uuid,jsonb)',
  'administrative_transition_function',
    'public.transition_individual_training_request(uuid,text,text,text,text,jsonb)',
  'direct_table_dml', false
) as training_operations_migration_result;
