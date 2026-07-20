-- 011_create_booking_price_snapshot.sql
-- Persist the optional per-player price snapshot supplied to create_booking.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

do $$
declare
  v_definition text;
begin
  if pg_catalog.to_regclass('public.matches') is null
     or pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regnamespace('prosto_padel_internal') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migrations 007 and 009 must be installed';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = pg_catalog.to_regclass('public.matches')
      and a.attname = 'pricePerPerson'
      and a.atttypid = 'numeric'::pg_catalog.regtype
      and not a.attnotnull and a.attnum > 0 and not a.attisdropped
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: matches.pricePerPerson must be nullable numeric';
  end if;

  if pg_catalog.to_regclass('prosto_padel_internal.migration_011_function_state') is not null then
    raise exception 'MIGRATION_CONFLICT: migration 011 state already exists';
  end if;

  select regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)), '\s+', ' ', 'g')
  into v_definition
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
    and not p.prosecdef
    and coalesce(p.proconfig @> array['search_path=pg_catalog, public, pg_temp'], false)
    and pg_catalog.obj_description(p.oid, 'pg_proc') like 'migration=007_create_booking_atomic;%';

  if v_definition is null
     or v_definition not like '%insert into public.matches%'
     or v_definition like '%"priceperperson"%' then
    raise exception 'MIGRATION_PRECONDITION_FAILED: create_booking(jsonb) is not the audited migration 007 implementation';
  end if;

  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_booking'
      and p.oid is distinct from pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
  ) then
    raise exception 'MIGRATION_CONFLICT: an extra create_booking overload exists';
  end if;
end;
$$;

create table prosto_padel_internal.migration_011_function_state (
  function_identity text primary key,
  function_oid oid not null,
  function_definition text not null,
  definition_hash text not null,
  function_owner oid not null,
  function_acl aclitem[],
  function_config text[],
  function_description text,
  captured_at timestamp with time zone not null default pg_catalog.now(),
  constraint migration_011_function_state_identity_check
    check (function_identity = 'public.create_booking(jsonb)'),
  constraint migration_011_function_state_hash_check
    check (definition_hash = pg_catalog.md5(function_definition))
);

alter table prosto_padel_internal.migration_011_function_state enable row level security;
revoke all on table prosto_padel_internal.migration_011_function_state
  from public, anon, authenticated;

insert into prosto_padel_internal.migration_011_function_state (
  function_identity, function_oid, function_definition, definition_hash,
  function_owner, function_acl, function_config, function_description
)
select
  'public.create_booking(jsonb)', p.oid, pg_catalog.pg_get_functiondef(p.oid),
  pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)), p.proowner, p.proacl,
  p.proconfig, pg_catalog.obj_description(p.oid, 'pg_proc')
from pg_catalog.pg_proc p
where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid;

comment on table prosto_padel_internal.migration_011_function_state is
  'migration=011_create_booking_price_snapshot; exact pre-011 create_booking definition and metadata used only by ROLLBACK';

create or replace function public.create_booking(p_booking jsonb)
returns public.matches
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles;
  v_date_iso date;
  v_date_label text;
  v_time text;
  v_start_minute integer;
  v_end_minute numeric;
  v_duration numeric;
  v_court_id text;
  v_court_name text;
  v_court_type text;
  v_is_private boolean;
  v_is_prime boolean;
  v_is_rating_match boolean;
  v_rating_min integer;
  v_rating_max integer;
  v_price_per_person numeric;
  v_type text;
  v_scenario text;
  v_status text;
  v_payment_status text;
  v_description text;
  v_rating_idx integer;
  v_owner_slot jsonb;
  v_requested_range numrange;
  v_start_at timestamptz;
  v_created public.matches;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'BOOKING_AUTH_REQUIRED';
  end if;

  if p_booking is null or pg_catalog.jsonb_typeof(p_booking) <> 'object' then
    raise exception using errcode = '22023', message = 'BOOKING_INVALID_PAYLOAD';
  end if;

  begin
    v_date_iso := nullif(pg_catalog.btrim(p_booking->>'dateISO'), '')::date;
    v_time := nullif(pg_catalog.btrim(p_booking->>'time'), '');
    v_duration := nullif(pg_catalog.btrim(p_booking->>'duration'), '')::numeric;
    v_is_private := coalesce(nullif(p_booking->>'isPrivate', '')::boolean, true);
    v_is_prime := coalesce(nullif(p_booking->>'isPrime', '')::boolean, false);
    v_is_rating_match := coalesce(
      nullif(p_booking->>'isRatingMatch', '')::boolean,
      nullif(p_booking->>'is_rating_match', '')::boolean,
      false
    );
    v_rating_min := coalesce(nullif(p_booking->>'ratingMin', '')::integer, 0);
    v_rating_max := coalesce(nullif(p_booking->>'ratingMax', '')::integer, 6);
    v_price_per_person := nullif(pg_catalog.btrim(coalesce(
      p_booking->>'pricePerPerson', p_booking->>'price_per_person'
    )), '')::numeric;
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception using errcode = '22023', message = 'BOOKING_INVALID_PAYLOAD_TYPES';
  end;

  v_court_id := nullif(pg_catalog.btrim(coalesce(p_booking->>'courtId', p_booking #>> '{court,id}')), '');
  v_court_name := nullif(pg_catalog.btrim(coalesce(p_booking->>'courtName', p_booking #>> '{court,name}')), '');
  v_court_type := coalesce(
    nullif(pg_catalog.btrim(coalesce(p_booking->>'courtType', p_booking #>> '{court,type}')), ''),
    'panoramic'
  );
  v_date_label := coalesce(nullif(pg_catalog.btrim(p_booking->>'date'), ''), v_date_iso::text);
  v_description := coalesce(p_booking->>'description', '');

  if v_date_iso is null then
    raise exception using errcode = '22023', message = 'BOOKING_INVALID_DATE';
  end if;
  if v_time is null or v_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception using errcode = '22023', message = 'BOOKING_INVALID_TIME';
  end if;
  if v_duration is null or v_duration not in (1, 1.5, 2, 2.5) then
    raise exception using errcode = '22023', message = 'BOOKING_INVALID_DURATION';
  end if;
  if v_court_id is null or v_court_id not in ('p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8') then
    raise exception using errcode = '22023', message = 'BOOKING_INVALID_COURT';
  end if;
  if v_court_name is null then
    raise exception using errcode = '22023', message = 'BOOKING_INVALID_COURT_NAME';
  end if;
  if v_rating_min < 0 or v_rating_max > 6 or v_rating_min > v_rating_max then
    raise exception using errcode = '22023', message = 'BOOKING_INVALID_RATING_RANGE';
  end if;
  if v_price_per_person is not null and (
    v_price_per_person::text = 'NaN'
    or v_price_per_person <= 0
    or v_price_per_person > 1000000
  ) then
    raise exception using errcode = '22023', message = 'BOOKING_INVALID_PRICE_PER_PERSON';
  end if;

  v_start_minute := public.match_time_to_minutes(v_time);
  v_end_minute := v_start_minute + v_duration * 60;
  if v_start_minute < 7 * 60 or v_end_minute > 24 * 60 then
    raise exception using errcode = '22023', message = 'BOOKING_OUTSIDE_WORKING_HOURS';
  end if;

  v_start_at := (v_date_iso::timestamp + pg_catalog.make_interval(mins => v_start_minute))
    at time zone 'Europe/Moscow';
  if v_start_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '22023', message = 'BOOKING_TIME_IN_PAST';
  end if;

  if v_is_private then
    if coalesce(nullif(p_booking->>'type', ''), 'private') <> 'private'
       or coalesce(nullif(p_booking->>'scenario', ''), 'private') <> 'private' then
      raise exception using errcode = '22023', message = 'BOOKING_INVALID_PRIVATE_FORMAT';
    end if;
    v_type := 'private';
    v_scenario := 'private';
    v_status := 'upcoming';
    v_payment_status := coalesce(nullif(p_booking->>'paymentStatus', ''), 'full');
  else
    if coalesce(nullif(p_booking->>'type', ''), 'match') <> 'match'
       or coalesce(nullif(p_booking->>'scenario', ''), 'social') <> 'social' then
      raise exception using errcode = '22023', message = 'BOOKING_INVALID_PUBLIC_FORMAT';
    end if;
    v_type := 'match';
    v_scenario := 'social';
    v_status := 'open';
    v_payment_status := coalesce(nullif(p_booking->>'paymentStatus', ''), 'partial');
  end if;

  select * into v_profile from public.profiles p where p.id = v_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'BOOKING_PROFILE_NOT_FOUND';
  end if;

  v_rating_idx := case
    when v_profile.rating <= 1.5 then 0
    when v_profile.rating <= 2.2 then 1
    when v_profile.rating <= 3.2 then 2
    when v_profile.rating <= 5.0 then 3
    when v_profile.rating <= 6.5 then 4
    when v_profile.rating <= 7.5 then 5
    else 6
  end;

  v_owner_slot := pg_catalog.jsonb_build_object(
    'id', v_user_id::text,
    'firstName', v_profile.first_name,
    'lastName', v_profile.last_name,
    'ratingIdx', v_rating_idx,
    'numericRating', v_profile.rating,
    'isVerified', v_profile.is_verified,
    'isOrganizer', true
  );

  v_requested_range := pg_catalog.numrange(v_start_minute::numeric, v_end_minute, '[)');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('court-booking:' || v_court_id || ':' || v_date_iso::text, 0)
  );

  if exists (
    select 1 from public.matches m
    where m.status is distinct from 'completed'
      and m."dateISO" = v_date_iso and m."courtId" = v_court_id
      and m.time is not null and m.duration is not null
      and pg_catalog.numrange(
        public.match_time_to_minutes(m.time)::numeric,
        public.match_time_to_minutes(m.time)::numeric + m.duration * 60,
        '[)'
      ) && v_requested_range
  ) then
    raise exception using errcode = '23P01', message = 'BOOKING_SLOT_TAKEN',
      detail = 'The requested court interval overlaps an active match or booking.';
  end if;

  begin
    insert into public.matches (
      owner_id, date, "dateISO", time, duration, "courtId", "courtName",
      "courtType", "isPrime", type, "ratingMin", "ratingMax", description,
      scenario, status, "isPrivate", is_rating_match, "paymentStatus",
      "pricePerPerson", "filledSlots", participants
    ) values (
      v_user_id, v_date_label, v_date_iso, v_time, v_duration, v_court_id,
      v_court_name, v_court_type, v_is_prime, v_type, v_rating_min, v_rating_max,
      v_description, v_scenario, v_status, v_is_private,
      (not v_is_private) and v_is_rating_match, v_payment_status,
      v_price_per_person, pg_catalog.jsonb_build_array(v_owner_slot),
      array[v_user_id::text]
    ) returning * into v_created;
  exception
    when exclusion_violation then
      raise exception using errcode = '23P01', message = 'BOOKING_SLOT_TAKEN',
        detail = 'The requested court interval overlaps an active match or booking.';
  end;

  return v_created;
end;
$$;

revoke all on function public.create_booking(jsonb) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb) to authenticated;
comment on function public.create_booking(jsonb) is
  'migration=011_create_booking_price_snapshot; rollback=restore captured 007 function; optional positive pricePerPerson snapshot is persisted';

commit;
