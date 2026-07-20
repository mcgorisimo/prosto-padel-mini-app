-- 008_match_invitations_stage1.sql
-- Additive first stage for atomic match invitations.
-- Does not disable the legacy direct UPDATE of matches participants/filledSlots.
-- Apply manually only after 008_match_invitations_stage1_PRECHECK.sql succeeds.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_required_columns integer;
  v_join_definition text;
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
      (a.attname = 'id' and a.atttypid = 'uuid'::pg_catalog.regtype)
      or (a.attname = 'owner_id' and a.atttypid = 'uuid'::pg_catalog.regtype)
      or (a.attname = 'dateISO' and a.atttypid = 'date'::pg_catalog.regtype)
      or (a.attname = 'time' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'status' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'type' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'scenario' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'isPrivate' and a.atttypid = 'boolean'::pg_catalog.regtype)
      or (a.attname = 'ratingMin' and a.atttypid = 'integer'::pg_catalog.regtype)
      or (a.attname = 'ratingMax' and a.atttypid = 'integer'::pg_catalog.regtype)
      or (a.attname = 'pricePerPerson' and a.atttypid = 'numeric'::pg_catalog.regtype)
      or (a.attname = 'courtId' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'courtName' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'courtType' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'filledSlots' and a.atttypid = 'jsonb'::pg_catalog.regtype)
      or (a.attname = 'participants' and a.atttypid = 'text[]'::pg_catalog.regtype)
    );

  if v_required_columns <> 16 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: public.matches columns or types differ from the audited baseline';
  end if;

  if pg_catalog.to_regprocedure('auth.uid()') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: auth.uid() is missing';
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: Supabase roles authenticated/anon are missing';
  end if;

  if pg_catalog.to_regclass('public.match_invitations') is not null then
    raise exception 'MIGRATION_CONFLICT: public.match_invitations already exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_match_invitation',
        'get_incoming_match_invitations',
        'accept_match_invitation',
        'decline_match_invitation',
        'cancel_match_invitation'
      )
  ) then
    raise exception 'MIGRATION_CONFLICT: one or more invitation RPC names already exist';
  end if;

  if pg_catalog.to_regprocedure('public.join_match(uuid)') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: public.join_match(uuid) is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.join_match(uuid)')::oid
      and not p.proretset
      and p.prorettype = 'public.matches'::pg_catalog.regtype
      and p.prosecdef
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: join_match(uuid) signature, return type, or security mode is unexpected';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(p.oid))
  into v_join_definition
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.join_match(uuid)')::oid;

  if v_join_definition not like '%auth.uid()%'
     or v_join_definition not like '%for update%'
     or (
       v_join_definition not like '%insert into%matches%'
       and v_join_definition not like '%update public.matches%'
     )
     or v_join_definition not like '%"filledslots"%'
     or v_join_definition not like '%participants%'
     or v_join_definition not like '%return v_updated%' then
    raise exception 'MIGRATION_PRECONDITION_FAILED: join_match(uuid) is not the audited atomic matches-row implementation';
  end if;

  if exists (
    select 1
    from public.matches m
    where pg_catalog.jsonb_typeof(m."filledSlots") is distinct from 'array'
  ) then
    raise exception 'MIGRATION_EXISTING_INVALID_SLOTS: filledSlots contains a non-array value';
  end if;

  if exists (
    select 1
    from public.matches m
    where pg_catalog.jsonb_array_length(m."filledSlots") > 4
  ) then
    raise exception 'MIGRATION_EXISTING_OVERFULL_MATCH: a match has more than four filledSlots';
  end if;

  if exists (
    select 1
    from public.matches m
    cross join lateral pg_catalog.jsonb_array_elements(m."filledSlots") as slots(slot_value)
    where slots.slot_value ? 'slotIndex'
      and coalesce(slots.slot_value->>'slotIndex', '') !~ '^[0-3]$'
  ) then
    raise exception 'MIGRATION_EXISTING_INVALID_SLOT_INDEX: filledSlots contains an unsupported slotIndex';
  end if;

  if exists (
    select 1
    from (
      select
        m.id,
        case
          when coalesce(slots.slot_value->>'slotIndex', '') ~ '^[0-3]$'
            then (slots.slot_value->>'slotIndex')::integer
          else (slots.ordinal_position - 1)::integer
        end as logical_slot_index
      from public.matches m
      cross join lateral pg_catalog.jsonb_array_elements(m."filledSlots")
        with ordinality as slots(slot_value, ordinal_position)
    ) occupied
    group by occupied.id, occupied.logical_slot_index
    having count(*) > 1
  ) then
    raise exception 'MIGRATION_EXISTING_DUPLICATE_SLOT_INDEX: a match has duplicate logical slot indexes';
  end if;

  if exists (
    select 1
    from public.matches m
    cross join lateral pg_catalog.jsonb_array_elements(m."filledSlots") as slots(slot_value)
    where nullif(slots.slot_value->>'id', '') is not null
    group by m.id, slots.slot_value->>'id'
    having count(*) > 1
  ) then
    raise exception 'MIGRATION_EXISTING_DUPLICATE_PLAYER_SLOT: a player appears more than once in filledSlots';
  end if;
end;
$$;

create table public.match_invitations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  match_id uuid not null,
  invited_by uuid not null,
  invited_user_id uuid not null,
  slot_index smallint not null,
  status text not null default 'pending',
  created_at timestamp with time zone not null default pg_catalog.now(),
  responded_at timestamp with time zone,
  constraint match_invitations_match_fkey
    foreign key (match_id) references public.matches(id) on delete cascade,
  constraint match_invitations_invited_by_fkey
    foreign key (invited_by) references public.profiles(id) on delete cascade,
  constraint match_invitations_invited_user_fkey
    foreign key (invited_user_id) references public.profiles(id) on delete cascade,
  constraint match_invitations_status_check
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  constraint match_invitations_slot_index_check
    check (slot_index between 0 and 3),
  constraint match_invitations_response_time_check
    check (
      (status = 'pending' and responded_at is null)
      or (status in ('accepted', 'declined', 'cancelled') and responded_at is not null)
    )
);

create unique index match_invitations_one_pending_player
  on public.match_invitations (match_id, invited_user_id)
  where status = 'pending';

create unique index match_invitations_one_pending_slot
  on public.match_invitations (match_id, slot_index)
  where status = 'pending';

create index match_invitations_incoming_pending_idx
  on public.match_invitations (invited_user_id, created_at desc)
  where status = 'pending';

create index match_invitations_match_status_idx
  on public.match_invitations (match_id, status);

comment on table public.match_invitations is
  'migration=008_match_invitations_stage1;rollback=drop; pending rows reserve capacity without changing matches participants or filledSlots';

comment on column public.match_invitations.slot_index is
  'Zero-based logical player slot. Legacy filledSlots without slotIndex use JSON array position.';

alter table public.match_invitations enable row level security;

create policy match_invitations_select_related
on public.match_invitations
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (
    invited_user_id = (select auth.uid())
    or invited_by = (select auth.uid())
    or exists (
      select 1
      from public.matches m
      where m.id = match_invitations.match_id
        and m.owner_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'admin'
    )
  )
);

revoke all on table public.match_invitations from public, anon, authenticated;
grant select on table public.match_invitations to authenticated;

create function public.create_match_invitation(
  p_match_id uuid,
  p_invited_user_id uuid,
  p_slot_index smallint
)
returns public.match_invitations
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_match public.matches;
  v_is_admin boolean;
  v_filled_count integer;
  v_pending_count integer;
  v_start_at timestamp with time zone;
  v_created public.match_invitations;
  v_constraint_name text;
begin
  if v_actor_id is null then
    raise exception using errcode = '28000', message = 'INVITATION_AUTH_REQUIRED';
  end if;

  if p_match_id is null or p_invited_user_id is null or p_slot_index is null then
    raise exception using errcode = '22023', message = 'INVITATION_INVALID_ARGUMENTS';
  end if;

  if p_slot_index not between 0 and 3 then
    raise exception using errcode = '22023', message = 'INVITATION_INVALID_SLOT';
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = v_actor_id
      and p.role = 'admin'
  ) into v_is_admin;

  select *
  into v_match
  from public.matches m
  where m.id = p_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_NOT_FOUND';
  end if;

  if v_match.owner_id <> v_actor_id and not v_is_admin then
    raise exception using errcode = '42501', message = 'INVITATION_CREATE_FORBIDDEN';
  end if;

  if v_match.status not in ('open', 'searching', 'upcoming', 'confirmed') then
    raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_NOT_ACTIVE';
  end if;

  if v_match."dateISO" is null
     or coalesce(v_match.time, '') !~ '^(0?[0-9]|1[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception using errcode = '22007', message = 'INVITATION_MATCH_SCHEDULE_INVALID';
  end if;

  v_start_at := (v_match."dateISO"::timestamp + v_match.time::time)
    at time zone 'Europe/Moscow';

  if v_start_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_ALREADY_STARTED';
  end if;

  if p_invited_user_id = v_match.owner_id then
    raise exception using errcode = '22023', message = 'INVITATION_ORGANIZER_FORBIDDEN';
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_invited_user_id) then
    raise exception using errcode = 'P0001', message = 'INVITATION_PROFILE_NOT_FOUND';
  end if;

  if p_invited_user_id::text = any(coalesce(v_match.participants, array[]::text[]))
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) slots(slot_value)
       where slots.slot_value->>'id' = p_invited_user_id::text
     ) then
    raise exception using errcode = '23505', message = 'INVITATION_ALREADY_PARTICIPANT';
  end if;

  v_filled_count := pg_catalog.jsonb_array_length(coalesce(v_match."filledSlots", '[]'::jsonb));

  select count(*)::integer
  into v_pending_count
  from public.match_invitations i
  where i.match_id = p_match_id
    and i.status = 'pending';

  if v_filled_count + v_pending_count >= 4 then
    raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_FULL';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb))
      with ordinality as slots(slot_value, ordinal_position)
    where (
      case
        when coalesce(slots.slot_value->>'slotIndex', '') ~ '^[0-3]$'
          then (slots.slot_value->>'slotIndex')::integer
        else (slots.ordinal_position - 1)::integer
      end
    ) = p_slot_index
  ) then
    raise exception using errcode = '23505', message = 'INVITATION_SLOT_OCCUPIED';
  end if;

  begin
    insert into public.match_invitations (
      match_id,
      invited_by,
      invited_user_id,
      slot_index
    ) values (
      p_match_id,
      v_actor_id,
      p_invited_user_id,
      p_slot_index
    )
    returning * into v_created;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'match_invitations_one_pending_player' then
        raise exception using errcode = '23505', message = 'INVITATION_ALREADY_PENDING';
      elsif v_constraint_name = 'match_invitations_one_pending_slot' then
        raise exception using errcode = '23505', message = 'INVITATION_SLOT_RESERVED';
      end if;
      raise;
  end;

  return v_created;
end;
$$;

create function public.get_incoming_match_invitations()
returns table (
  invitation_id uuid,
  match_id uuid,
  invited_by uuid,
  organizer_id uuid,
  organizer_first_name text,
  organizer_last_name text,
  date_iso date,
  start_time text,
  court_id text,
  court_name text,
  court_type text,
  match_type text,
  scenario text,
  is_private boolean,
  rating_min integer,
  rating_max integer,
  price_per_person numeric,
  slot_index smallint,
  created_at timestamp with time zone,
  match_status text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'INVITATION_AUTH_REQUIRED';
  end if;

  return query
  select
    i.id,
    i.match_id,
    i.invited_by,
    m.owner_id,
    organizer.first_name,
    organizer.last_name,
    m."dateISO",
    m.time,
    m."courtId",
    m."courtName",
    m."courtType",
    m.type,
    m.scenario,
    m."isPrivate",
    m."ratingMin",
    m."ratingMax",
    m."pricePerPerson",
    i.slot_index,
    i.created_at,
    m.status
  from public.match_invitations i
  join public.matches m on m.id = i.match_id
  join public.profiles organizer on organizer.id = m.owner_id
  where i.invited_user_id = v_user_id
    and i.status = 'pending'
  order by i.created_at desc, i.id;
end;
$$;

create function public.accept_match_invitation(p_invitation_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_match_id uuid;
  v_invitation public.match_invitations;
  v_match public.matches;
  v_profile public.profiles;
  v_rating_idx integer;
  v_filled_count integer;
  v_pending_count integer;
  v_next_filled_count integer;
  v_start_at timestamp with time zone;
  v_new_slot jsonb;
  v_new_filled_slots jsonb;
  v_new_participants text[];
  v_updated public.matches;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'INVITATION_AUTH_REQUIRED';
  end if;

  select i.match_id
  into v_match_id
  from public.match_invitations i
  where i.id = p_invitation_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVITATION_NOT_FOUND';
  end if;

  -- Every invitation mutation locks match first, invitation second.
  select *
  into v_match
  from public.matches m
  where m.id = v_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_NOT_FOUND';
  end if;

  select *
  into v_invitation
  from public.match_invitations i
  where i.id = p_invitation_id
    and i.match_id = v_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVITATION_NOT_FOUND';
  end if;

  if v_invitation.invited_user_id <> v_user_id then
    raise exception using errcode = '42501', message = 'INVITATION_RESPONSE_FORBIDDEN';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'INVITATION_NOT_PENDING';
  end if;

  if v_match.status not in ('open', 'searching', 'upcoming', 'confirmed') then
    raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_NOT_ACTIVE';
  end if;

  if v_match."dateISO" is null
     or coalesce(v_match.time, '') !~ '^(0?[0-9]|1[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception using errcode = '22007', message = 'INVITATION_MATCH_SCHEDULE_INVALID';
  end if;

  v_start_at := (v_match."dateISO"::timestamp + v_match.time::time)
    at time zone 'Europe/Moscow';

  if v_start_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_ALREADY_STARTED';
  end if;

  if v_match.owner_id = v_user_id then
    raise exception using errcode = '22023', message = 'INVITATION_ORGANIZER_FORBIDDEN';
  end if;

  if v_user_id::text = any(coalesce(v_match.participants, array[]::text[]))
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) slots(slot_value)
       where slots.slot_value->>'id' = v_user_id::text
     ) then
    raise exception using errcode = '23505', message = 'INVITATION_ALREADY_PARTICIPANT';
  end if;

  v_filled_count := pg_catalog.jsonb_array_length(coalesce(v_match."filledSlots", '[]'::jsonb));

  select count(*)::integer
  into v_pending_count
  from public.match_invitations i
  where i.match_id = v_match_id
    and i.status = 'pending';

  if v_filled_count >= 4 or v_filled_count + v_pending_count > 4 then
    raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_FULL';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb))
      with ordinality as slots(slot_value, ordinal_position)
    where (
      case
        when coalesce(slots.slot_value->>'slotIndex', '') ~ '^[0-3]$'
          then (slots.slot_value->>'slotIndex')::integer
        else (slots.ordinal_position - 1)::integer
      end
    ) = v_invitation.slot_index
  ) then
    raise exception using errcode = '23505', message = 'INVITATION_SLOT_UNAVAILABLE';
  end if;

  select *
  into v_profile
  from public.profiles p
  where p.id = v_user_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVITATION_PROFILE_NOT_FOUND';
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

  v_new_slot := pg_catalog.jsonb_build_object(
    'id', v_user_id::text,
    'firstName', v_profile.first_name,
    'lastName', v_profile.last_name,
    'ratingIdx', v_rating_idx,
    'numericRating', v_profile.rating,
    'isVerified', v_profile.is_verified,
    'isOrganizer', false,
    'slotIndex', v_invitation.slot_index
  );

  v_new_filled_slots := coalesce(v_match."filledSlots", '[]'::jsonb)
    || pg_catalog.jsonb_build_array(v_new_slot);
  v_next_filled_count := v_filled_count + 1;

  select coalesce(pg_catalog.array_agg(participant_id order by ordinal_position), array[]::text[])
  into v_new_participants
  from (
    select participant_id, min(ordinal_position) as ordinal_position
    from (
      select participant_id, ordinal_position
      from pg_catalog.unnest(coalesce(v_match.participants, array[]::text[]))
        with ordinality as participants(participant_id, ordinal_position)
      union all
      select v_user_id::text, coalesce(pg_catalog.array_length(v_match.participants, 1), 0) + 1
    ) participant_rows
    group by participant_id
  ) deduplicated_participants;

  update public.matches
  set
    "filledSlots" = v_new_filled_slots,
    participants = v_new_participants,
    status = case
      when coalesce(v_match."isPrivate", false) then v_match.status
      when v_match.status = 'searching' then 'searching'
      when v_match.status = 'confirmed' then
        case when v_next_filled_count >= 4 then 'confirmed' else 'open' end
      when v_match.status not in ('completed', 'finished', 'cancelled', 'canceled') then
        case when v_next_filled_count >= 4 then 'upcoming' else 'open' end
      else v_match.status
    end,
    updated_at = pg_catalog.now()
  where id = v_match_id
  returning * into v_updated;

  update public.match_invitations
  set
    status = 'accepted',
    responded_at = pg_catalog.now()
  where id = p_invitation_id;

  return v_updated;
end;
$$;

create function public.decline_match_invitation(p_invitation_id uuid)
returns public.match_invitations
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_match_id uuid;
  v_match public.matches;
  v_invitation public.match_invitations;
  v_updated public.match_invitations;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'INVITATION_AUTH_REQUIRED';
  end if;

  select i.match_id into v_match_id
  from public.match_invitations i
  where i.id = p_invitation_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVITATION_NOT_FOUND';
  end if;

  select * into v_match
  from public.matches m
  where m.id = v_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_NOT_FOUND';
  end if;

  select * into v_invitation
  from public.match_invitations i
  where i.id = p_invitation_id
    and i.match_id = v_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVITATION_NOT_FOUND';
  end if;

  if v_invitation.invited_user_id <> v_user_id then
    raise exception using errcode = '42501', message = 'INVITATION_RESPONSE_FORBIDDEN';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'INVITATION_NOT_PENDING';
  end if;

  update public.match_invitations
  set
    status = 'declined',
    responded_at = pg_catalog.now()
  where id = p_invitation_id
  returning * into v_updated;

  return v_updated;
end;
$$;

create function public.cancel_match_invitation(p_invitation_id uuid)
returns public.match_invitations
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_match_id uuid;
  v_match public.matches;
  v_invitation public.match_invitations;
  v_is_admin boolean;
  v_updated public.match_invitations;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'INVITATION_AUTH_REQUIRED';
  end if;

  select i.match_id into v_match_id
  from public.match_invitations i
  where i.id = p_invitation_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVITATION_NOT_FOUND';
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
      and p.role = 'admin'
  ) into v_is_admin;

  select * into v_match
  from public.matches m
  where m.id = v_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_NOT_FOUND';
  end if;

  select * into v_invitation
  from public.match_invitations i
  where i.id = p_invitation_id
    and i.match_id = v_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'INVITATION_NOT_FOUND';
  end if;

  if v_match.owner_id <> v_user_id and not v_is_admin then
    raise exception using errcode = '42501', message = 'INVITATION_CANCEL_FORBIDDEN';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'INVITATION_NOT_PENDING';
  end if;

  update public.match_invitations
  set
    status = 'cancelled',
    responded_at = pg_catalog.now()
  where id = p_invitation_id
  returning * into v_updated;

  return v_updated;
end;
$$;

-- Compatible replacement of 003_match_join_rpc.sql. Signature and return type
-- remain unchanged; pending invitations now reserve capacity and slot indexes.
create or replace function public.join_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_match public.matches;
  v_profile public.profiles;
  v_rating_idx integer;
  v_capacity integer := 4;
  v_filled_count integer;
  v_pending_count integer;
  v_next_filled_count integer;
  v_slot_index integer;
  v_new_slot jsonb;
  v_new_filled_slots jsonb;
  v_new_participants text[];
  v_start_at timestamp with time zone;
  v_updated public.matches;
begin
  if v_user_id is null then
    raise exception 'Authentication is required';
  end if;

  select *
  into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'Match not found';
  end if;

  if v_match.owner_id = v_user_id then
    raise exception 'Organizer cannot join own match through join_match';
  end if;

  if v_match.type <> 'match' then
    raise exception 'Only match records can be joined';
  end if;

  if coalesce(v_match."isPrivate", false) then
    raise exception 'Private matches cannot be joined through join_match';
  end if;

  if v_match.status not in ('open', 'searching', 'upcoming', 'confirmed') then
    raise exception 'Match cannot be joined in current status';
  end if;

  if v_match."dateISO" is not null then
    if coalesce(v_match.time, '') ~ '^\d{1,2}:\d{2}(:\d{2})?$' then
      v_start_at := (v_match."dateISO"::timestamp + v_match.time::time)
        at time zone current_setting('TimeZone');
    else
      v_start_at := v_match."dateISO"::timestamp at time zone current_setting('TimeZone');
    end if;

    if v_start_at <= pg_catalog.now() then
      raise exception 'Match has already started';
    end if;
  end if;

  if v_user_id::text = any(coalesce(v_match.participants, array[]::text[])) then
    raise exception 'User is already a participant';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) slots(slot_value)
    where slots.slot_value->>'id' = v_user_id::text
  ) then
    raise exception 'User already has a slot';
  end if;

  if exists (
    select 1
    from public.match_invitations i
    where i.match_id = p_match_id
      and i.invited_user_id = v_user_id
      and i.status = 'pending'
  ) then
    raise exception 'User has a pending invitation; accept or decline it instead';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_user_id;

  if not found then
    raise exception 'Profile not found';
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

  if v_rating_idx < v_match."ratingMin" or v_rating_idx > v_match."ratingMax" then
    raise exception 'Player rating is outside match range';
  end if;

  v_filled_count := pg_catalog.jsonb_array_length(coalesce(v_match."filledSlots", '[]'::jsonb));

  select count(*)::integer
  into v_pending_count
  from public.match_invitations i
  where i.match_id = p_match_id
    and i.status = 'pending';

  if v_filled_count + v_pending_count >= v_capacity then
    raise exception 'Match has no free slots';
  end if;

  select candidate.slot_index
  into v_slot_index
  from pg_catalog.generate_series(0, v_capacity - 1) candidate(slot_index)
  where not exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb))
      with ordinality as slots(slot_value, ordinal_position)
    where (
      case
        when coalesce(slots.slot_value->>'slotIndex', '') ~ '^[0-3]$'
          then (slots.slot_value->>'slotIndex')::integer
        else (slots.ordinal_position - 1)::integer
      end
    ) = candidate.slot_index
  )
  and not exists (
    select 1
    from public.match_invitations i
    where i.match_id = p_match_id
      and i.status = 'pending'
      and i.slot_index = candidate.slot_index
  )
  order by candidate.slot_index
  limit 1;

  if v_slot_index is null then
    raise exception 'Match has no free slots';
  end if;

  v_new_slot := pg_catalog.jsonb_build_object(
    'id', v_user_id::text,
    'firstName', v_profile.first_name,
    'lastName', v_profile.last_name,
    'ratingIdx', v_rating_idx,
    'numericRating', v_profile.rating,
    'isVerified', v_profile.is_verified,
    'isOrganizer', false,
    'slotIndex', v_slot_index
  );

  v_new_filled_slots := coalesce(v_match."filledSlots", '[]'::jsonb)
    || pg_catalog.jsonb_build_array(v_new_slot);
  v_next_filled_count := v_filled_count + 1;

  select coalesce(pg_catalog.array_agg(participant_id order by ordinal_position), array[]::text[])
  into v_new_participants
  from (
    select participant_id, min(ordinal_position) as ordinal_position
    from (
      select participant_id, ordinal_position
      from pg_catalog.unnest(coalesce(v_match.participants, array[]::text[]))
        with ordinality as participants(participant_id, ordinal_position)
      union all
      select v_user_id::text, coalesce(pg_catalog.array_length(v_match.participants, 1), 0) + 1
    ) participant_rows
    group by participant_id
  ) deduplicated_participants;

  update public.matches
  set
    "filledSlots" = v_new_filled_slots,
    participants = v_new_participants,
    status = case
      when v_match.status = 'searching' then 'searching'
      when v_match.status = 'confirmed' then
        case when v_next_filled_count >= v_capacity then 'confirmed' else 'open' end
      when v_match.status not in ('completed', 'finished', 'cancelled', 'canceled') then
        case when v_next_filled_count >= v_capacity then 'upcoming' else 'open' end
      else v_match.status
    end,
    updated_at = pg_catalog.now()
  where id = p_match_id
  returning * into v_updated;

  return v_updated;
end;
$$;

revoke all on function public.create_match_invitation(uuid, uuid, smallint) from public, anon, authenticated;
revoke all on function public.get_incoming_match_invitations() from public, anon, authenticated;
revoke all on function public.accept_match_invitation(uuid) from public, anon, authenticated;
revoke all on function public.decline_match_invitation(uuid) from public, anon, authenticated;
revoke all on function public.cancel_match_invitation(uuid) from public, anon, authenticated;
revoke all on function public.join_match(uuid) from public, anon, authenticated;

grant execute on function public.create_match_invitation(uuid, uuid, smallint) to authenticated;
grant execute on function public.get_incoming_match_invitations() to authenticated;
grant execute on function public.accept_match_invitation(uuid) to authenticated;
grant execute on function public.decline_match_invitation(uuid) to authenticated;
grant execute on function public.cancel_match_invitation(uuid) to authenticated;
grant execute on function public.join_match(uuid) to authenticated;

comment on function public.create_match_invitation(uuid, uuid, smallint) is
  'migration=008_match_invitations_stage1; authenticated organizer/admin creates one pending reservation under a match-row lock';
comment on function public.get_incoming_match_invitations() is
  'migration=008_match_invitations_stage1; returns only the current user pending invitations and a safe match summary';
comment on function public.accept_match_invitation(uuid) is
  'migration=008_match_invitations_stage1; invited user atomically accepts and joins under a match-row lock';
comment on function public.decline_match_invitation(uuid) is
  'migration=008_match_invitations_stage1; invited user releases a pending reservation';
comment on function public.cancel_match_invitation(uuid) is
  'migration=008_match_invitations_stage1; organizer/admin releases a pending reservation';
comment on function public.join_match(uuid) is
  'migration=008_match_invitations_stage1;rollback=restore_003; atomic public self-join preserving returns public.matches while excluding pending invitation reservations';

commit;
