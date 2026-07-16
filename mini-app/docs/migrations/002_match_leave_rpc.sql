-- 002_match_leave_rpc.sql
-- Safe atomic participant self-leave for matches.
-- Apply manually on staging only after reviewing PRE/POST expectations.

begin;

create or replace function public.leave_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_match public.matches;
  v_user_slot jsonb;
  v_new_filled_slots jsonb;
  v_new_participants text[];
  v_new_filled_count integer;
  v_updated public.matches;
  v_start_at timestamp with time zone;
  v_payment_status text;
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
    raise exception 'Organizer cannot leave own match through leave_match';
  end if;

  if v_match.status not in ('open', 'searching', 'upcoming', 'confirmed') then
    raise exception 'Match cannot be left in current status';
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

  if not (v_user_id::text = any(coalesce(v_match.participants, array[]::text[]))) then
    raise exception 'User is not a participant';
  end if;

  select slot_value
  into v_user_slot
  from jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) as slots(slot_value)
  where slot_value->>'id' = v_user_id::text
  limit 1;

  if v_user_slot is null then
    raise exception 'Participant slot not found';
  end if;

  if lower(coalesce(v_user_slot->>'isOrganizer', 'false')) in ('true', 't', '1', 'yes') then
    raise exception 'Organizer slot cannot leave through leave_match';
  end if;

  v_payment_status := lower(coalesce(v_user_slot->>'paymentStatus', v_user_slot->>'payment_status', ''));

  if v_payment_status in ('paid', 'full', 'captured', 'confirmed')
    or lower(coalesce(v_user_slot->>'paid', 'false')) in ('true', 't', '1', 'yes')
    or lower(coalesce(v_user_slot->>'isPaid', 'false')) in ('true', 't', '1', 'yes')
  then
    raise exception 'Paid participation cannot be left through leave_match';
  end if;

  select coalesce(jsonb_agg(slot_value order by ordinal_position), '[]'::jsonb)
  into v_new_filled_slots
  from jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) with ordinality as slots(slot_value, ordinal_position)
  where slot_value->>'id' is distinct from v_user_id::text;

  select coalesce(array_agg(participant_id order by ordinal_position), array[]::text[])
  into v_new_participants
  from unnest(coalesce(v_match.participants, array[]::text[])) with ordinality as participants(participant_id, ordinal_position)
  where participant_id <> v_user_id::text;

  v_new_filled_count := jsonb_array_length(v_new_filled_slots);

  update public.matches
  set
    "filledSlots" = v_new_filled_slots,
    participants = v_new_participants,
    status = case
      when type = 'match'
        and coalesce("isPrivate", false) = false
        and status in ('upcoming', 'confirmed')
        and v_new_filled_count < 4
      then 'open'
      else status
    end,
    updated_at = now()
  where id = p_match_id
  returning * into v_updated;

  return v_updated;
end;
$$;

revoke all on function public.leave_match(uuid) from public, anon;
grant execute on function public.leave_match(uuid) to authenticated;

comment on function public.leave_match(uuid) is
  'Atomic self-leave RPC. Uses auth.uid(), locks the match row, removes only the current participant from filledSlots and participants, and returns the updated matches row.';

commit;
