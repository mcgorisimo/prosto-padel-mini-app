-- 008_match_invitations_stage1_ROLLBACK.sql
-- Removes only migration 008 objects and restores join_match from migration 003.
-- Refuses to delete invitation rows or unmanaged objects.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_table_description text;
  v_function record;
  v_join_description text;
begin
  if pg_catalog.to_regclass('public.match_invitations') is null
     and pg_catalog.to_regprocedure('public.create_match_invitation(uuid,uuid,smallint)') is null
     and pg_catalog.to_regprocedure('public.get_incoming_match_invitations()') is null
     and pg_catalog.to_regprocedure('public.accept_match_invitation(uuid)') is null
     and pg_catalog.to_regprocedure('public.decline_match_invitation(uuid)') is null
     and pg_catalog.to_regprocedure('public.cancel_match_invitation(uuid)') is null
     and pg_catalog.to_regprocedure('public.join_match(uuid)') is null then
    raise exception 'ROLLBACK_NOT_APPLICABLE: no migration 008 objects or join_match(uuid) exist';
  end if;

  if pg_catalog.to_regclass('public.match_invitations') is not null then
    select pg_catalog.obj_description(c.oid, 'pg_class')
    into v_table_description
    from pg_catalog.pg_class c
    where c.oid = 'public.match_invitations'::pg_catalog.regclass;

    if coalesce(v_table_description, '') not like 'migration=008_match_invitations_stage1;%' then
      raise exception 'ROLLBACK_CONFLICT: public.match_invitations is not owned by migration 008';
    end if;

    if exists (select 1 from public.match_invitations) then
      raise exception 'ROLLBACK_DATA_PRESENT: match_invitations contains rows; export and review them before rollback';
    end if;
  end if;

  for v_function in
    select
      p.oid,
      p.proname,
      pg_catalog.pg_get_function_identity_arguments(p.oid) as identity_arguments,
      pg_catalog.obj_description(p.oid, 'pg_proc') as description
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
  loop
    if coalesce(v_function.description, '') not like 'migration=008_match_invitations_stage1;%' then
      raise exception 'ROLLBACK_CONFLICT: %.%(%) is not owned by migration 008',
        'public', v_function.proname, v_function.identity_arguments;
    end if;
  end loop;

  if pg_catalog.to_regprocedure('public.join_match(uuid)') is not null then
    select pg_catalog.obj_description(
      pg_catalog.to_regprocedure('public.join_match(uuid)')::oid,
      'pg_proc'
    ) into v_join_description;

    if coalesce(v_join_description, '') not like 'migration=008_match_invitations_stage1;%'
       and coalesce(v_join_description, '') <>
         'Atomic public match self-join RPC. Uses auth.uid(), locks the match row, builds the player slot from public.profiles, updates filledSlots and participants together, and returns the updated matches row.' then
      raise exception 'ROLLBACK_CONFLICT: public.join_match(uuid) is neither migration 008 nor the known migration 003 version';
    end if;
  elsif pg_catalog.to_regclass('public.match_invitations') is not null then
    raise exception 'ROLLBACK_CONFLICT: migration 008 table exists but join_match(uuid) is missing';
  end if;
end;
$$;

drop function if exists public.create_match_invitation(uuid, uuid, smallint);
drop function if exists public.get_incoming_match_invitations();
drop function if exists public.accept_match_invitation(uuid);
drop function if exists public.decline_match_invitation(uuid);
drop function if exists public.cancel_match_invitation(uuid);

drop table if exists public.match_invitations;

-- Exact restoration of 003_match_join_rpc.sql.
create or replace function public.join_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_match public.matches;
  v_profile public.profiles;
  v_rating_idx integer;
  v_capacity integer := 4;
  v_filled_count integer;
  v_next_filled_count integer;
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
    if coalesce(v_match."time", '') ~ '^\d{1,2}:\d{2}(:\d{2})?$' then
      v_start_at := (v_match."dateISO"::timestamp + v_match."time"::time) at time zone current_setting('TimeZone');
    else
      v_start_at := v_match."dateISO"::timestamp at time zone current_setting('TimeZone');
    end if;

    if v_start_at <= now() then
      raise exception 'Match has already started';
    end if;
  end if;

  if v_user_id::text = any(coalesce(v_match.participants, array[]::text[])) then
    raise exception 'User is already a participant';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) as slots(slot_value)
    where slot_value->>'id' = v_user_id::text
  ) then
    raise exception 'User already has a slot';
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

  v_filled_count := jsonb_array_length(coalesce(v_match."filledSlots", '[]'::jsonb));

  if v_filled_count >= v_capacity then
    raise exception 'Match has no free slots';
  end if;

  v_new_slot := jsonb_build_object(
    'id', v_user_id::text,
    'firstName', v_profile.first_name,
    'lastName', v_profile.last_name,
    'ratingIdx', v_rating_idx,
    'numericRating', v_profile.rating,
    'isVerified', v_profile.is_verified,
    'isOrganizer', false
  );

  v_new_filled_slots := coalesce(v_match."filledSlots", '[]'::jsonb) || jsonb_build_array(v_new_slot);
  v_next_filled_count := v_filled_count + 1;

  select coalesce(array_agg(participant_id order by ordinal_position), array[]::text[])
  into v_new_participants
  from (
    select participant_id, min(ordinal_position) as ordinal_position
    from (
      select participant_id, ordinal_position
      from unnest(coalesce(v_match.participants, array[]::text[])) with ordinality as participants(participant_id, ordinal_position)
      union all
      select v_user_id::text, coalesce(array_length(v_match.participants, 1), 0) + 1
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
    updated_at = now()
  where id = p_match_id
  returning * into v_updated;

  return v_updated;
end;
$$;

revoke all on function public.join_match(uuid) from public, anon;
grant execute on function public.join_match(uuid) to authenticated;

comment on function public.join_match(uuid) is
  'Atomic public match self-join RPC. Uses auth.uid(), locks the match row, builds the player slot from public.profiles, updates filledSlots and participants together, and returns the updated matches row.';

commit;
