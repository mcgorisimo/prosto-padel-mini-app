-- 007_create_booking_atomic.sql
-- PostgreSQL-first atomic court booking with table-level overlap protection.
-- Apply manually on staging only after 007_create_booking_atomic_PRECHECK.sql.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_required_columns integer;
begin
  if pg_catalog.to_regclass('public.matches') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: public.matches does not exist';
  end if;

  if pg_catalog.to_regclass('public.profiles') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: public.profiles does not exist';
  end if;

  select count(*)
  into v_required_columns
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.matches'::pg_catalog.regclass
    and not a.attisdropped
    and (
      (a.attname = 'owner_id' and a.atttypid = 'uuid'::pg_catalog.regtype)
      or (a.attname = 'dateISO' and a.atttypid = 'date'::pg_catalog.regtype)
      or (a.attname = 'time' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'duration' and a.atttypid = 'numeric'::pg_catalog.regtype)
      or (a.attname = 'courtId' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'courtName' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'courtType' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'status' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'type' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'scenario' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'isPrivate' and a.atttypid = 'boolean'::pg_catalog.regtype)
      or (a.attname = 'filledSlots' and a.atttypid = 'jsonb'::pg_catalog.regtype)
      or (a.attname = 'participants' and a.atttypid = 'text[]'::pg_catalog.regtype)
    );

  if v_required_columns <> 13 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: public.matches columns or types differ from the audited baseline';
  end if;

  if pg_catalog.to_regprocedure('auth.uid()') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: auth.uid() is missing';
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: Supabase roles authenticated/anon are missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_booking'
      and not (
        pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_booking jsonb'
        and not p.proretset
        and p.prorettype = 'public.matches'::pg_catalog.regtype
        and pg_catalog.obj_description(p.oid, 'pg_proc') like 'migration=007_create_booking_atomic;%'
      )
  ) then
    raise exception 'MIGRATION_CONFLICT: an unmanaged public.create_booking function already exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'match_time_to_minutes'
      and not (
        pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_time text'
        and not p.proretset
        and p.prorettype = 'integer'::pg_catalog.regtype
        and pg_catalog.obj_description(p.oid, 'pg_proc') like 'migration=007_create_booking_atomic;%'
      )
  ) then
    raise exception 'MIGRATION_CONFLICT: an unmanaged public.match_time_to_minutes function already exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.matches'::pg_catalog.regclass
      and c.conname = 'matches_no_active_court_overlap'
      and coalesce(pg_catalog.obj_description(c.oid, 'pg_constraint'), '') not like 'migration=007_create_booking_atomic;%'
  ) then
    raise exception 'MIGRATION_CONFLICT: an unmanaged matches_no_active_court_overlap constraint already exists';
  end if;
end;
$$;

-- btree_gist is a standard trusted PostgreSQL contrib extension. It supplies
-- GiST equality operator classes for text and date used by the exclusion rule.
create extension if not exists btree_gist with schema public;

create or replace function public.match_time_to_minutes(p_time text)
returns integer
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog, pg_temp
as $$
declare
  v_hour integer;
  v_minute integer;
begin
  if p_time !~ '^(?:[0-9]|[01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception using
      errcode = '22007',
      message = 'MATCH_TIME_INVALID',
      detail = 'Expected H:MM or HH:MM in the 00:00-23:59 range.';
  end if;

  v_hour := split_part(p_time, ':', 1)::integer;
  v_minute := split_part(p_time, ':', 2)::integer;
  return v_hour * 60 + v_minute;
end;
$$;

revoke all on function public.match_time_to_minutes(text) from public, anon;
grant execute on function public.match_time_to_minutes(text) to authenticated;

comment on function public.match_time_to_minutes(text) is
  'migration=007_create_booking_atomic; immutable parser used by the court-overlap exclusion constraint';

do $$
begin
  if exists (
    select 1
    from public.matches m
    where m.status is distinct from 'completed'
      and m."dateISO" is not null
      and m."courtId" is not null
      and m.time is not null
      and m.duration is not null
      and m.time !~ '^(?:[0-9]|[01][0-9]|2[0-3]):[0-5][0-9]$'
  ) then
    raise exception 'MIGRATION_EXISTING_INVALID_TIME: active scheduled rows contain an unsupported time value; inspect PRECHECK and stop';
  end if;

  if exists (
    with scheduled as (
      select
        m.id,
        m."dateISO" as booking_date,
        m."courtId" as court_id,
        numrange(
          public.match_time_to_minutes(m.time)::numeric,
          public.match_time_to_minutes(m.time)::numeric + m.duration * 60,
          '[)'
        ) as booking_minutes
      from public.matches m
      where m.status is distinct from 'completed'
        and m."dateISO" is not null
        and m."courtId" is not null
        and m.time is not null
        and m.duration is not null
    )
    select 1
    from scheduled left_booking
    join scheduled right_booking
      on left_booking.id < right_booking.id
     and left_booking.booking_date = right_booking.booking_date
     and left_booking.court_id = right_booking.court_id
     and left_booking.booking_minutes && right_booking.booking_minutes
  ) then
    raise exception 'MIGRATION_EXISTING_OVERLAP: overlapping active rows already exist; inspect PRECHECK and stop';
  end if;
end;
$$;

do $$
declare
  v_extension_schema text;
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.matches'::pg_catalog.regclass
      and c.conname = 'matches_no_active_court_overlap'
  ) then
    select n.nspname
    into v_extension_schema
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'btree_gist';

    if v_extension_schema is null then
      raise exception 'MIGRATION_PRECONDITION_FAILED: btree_gist is not installed';
    end if;

    execute pg_catalog.format(
      'alter table public.matches add constraint matches_no_active_court_overlap exclude using gist (' ||
      '"courtId" %1$I.gist_text_ops with =, ' ||
      '"dateISO" %1$I.gist_date_ops with =, ' ||
      '(numrange(public.match_time_to_minutes(time)::numeric, ' ||
      'public.match_time_to_minutes(time)::numeric + duration * 60, ''[)'')) with &&' ||
      ') where (status is distinct from ''completed'' ' ||
      'and "dateISO" is not null and "courtId" is not null and time is not null and duration is not null)',
      v_extension_schema
    );
  end if;
end;
$$;

comment on constraint matches_no_active_court_overlap on public.matches is
  'migration=007_create_booking_atomic; table-level protection for all active scheduled rows, including direct INSERT and open matches';

create or replace function public.create_booking(p_booking jsonb)
returns public.matches
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid(); -- Supabase adapter point: replace this identity lookup after migration.
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

  select *
  into v_profile
  from public.profiles p
  where p.id = v_user_id;

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

  v_requested_range := pg_catalog.numrange(
    v_start_minute::numeric,
    v_end_minute,
    '[)'
  );

  -- Serialize create_booking calls per court/day. The exclusion constraint below
  -- remains the final authority for direct INSERTs and non-cooperating writers.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('court-booking:' || v_court_id || ':' || v_date_iso::text, 0)
  );

  if exists (
    select 1
    from public.matches m
    where m.status is distinct from 'completed'
      and m."dateISO" = v_date_iso
      and m."courtId" = v_court_id
      and m.time is not null
      and m.duration is not null
      and pg_catalog.numrange(
        public.match_time_to_minutes(m.time)::numeric,
        public.match_time_to_minutes(m.time)::numeric + m.duration * 60,
        '[)'
      ) && v_requested_range
  ) then
    raise exception using
      errcode = '23P01',
      message = 'BOOKING_SLOT_TAKEN',
      detail = 'The requested court interval overlaps an active match or booking.';
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
      "isPrime",
      type,
      "ratingMin",
      "ratingMax",
      description,
      scenario,
      status,
      "isPrivate",
      is_rating_match,
      "paymentStatus",
      "filledSlots",
      participants
    ) values (
      v_user_id,
      v_date_label,
      v_date_iso,
      v_time,
      v_duration,
      v_court_id,
      v_court_name,
      v_court_type,
      v_is_prime,
      v_type,
      v_rating_min,
      v_rating_max,
      v_description,
      v_scenario,
      v_status,
      v_is_private,
      (not v_is_private) and v_is_rating_match,
      v_payment_status,
      pg_catalog.jsonb_build_array(v_owner_slot),
      array[v_user_id::text]
    )
    returning * into v_created;
  exception
    when exclusion_violation then
      raise exception using
        errcode = '23P01',
        message = 'BOOKING_SLOT_TAKEN',
        detail = 'The requested court interval overlaps an active match or booking.';
  end;

  return v_created;
end;
$$;

revoke all on function public.create_booking(jsonb) from public, anon;
grant execute on function public.create_booking(jsonb) to authenticated;

comment on function public.create_booking(jsonb) is
  'migration=007_create_booking_atomic; rollback=drop; security_invoker atomic booking RPC; SQLSTATE 23P01 and message BOOKING_SLOT_TAKEN mean occupied interval';

commit;
