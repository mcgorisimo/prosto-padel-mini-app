-- 006_leave_match_return_type_fix.sql
-- Transactionally replaces legacy public.leave_match(uuid) regardless of whether
-- it is absent, returns jsonb, or already returns public.matches.
-- Does not alter tables or existing rows.

begin;

do $preflight$
declare
  v_target_oid oid := pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid;
  v_matches_type oid := pg_catalog.to_regtype('public.matches')::oid;
  v_return_type oid;
  v_returns_set boolean;
  v_normalized_definition text;
  v_previous_state text;
begin
  if v_matches_type is null then
    raise exception 'Required composite type public.matches does not exist';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'leave_match'
      and p.oid is distinct from v_target_oid
  ) then
    raise exception 'Unexpected public.leave_match overload exists; stop and review PRECHECK output';
  end if;

  if v_target_oid is null then
    v_previous_state := 'absent';
  else
    select
      p.prorettype,
      p.proretset,
      regexp_replace(
        lower(pg_catalog.pg_get_functiondef(p.oid)),
        '\s+',
        ' ',
        'g'
      )
    into v_return_type, v_returns_set, v_normalized_definition
    from pg_catalog.pg_proc p
    where p.oid = v_target_oid;

    if v_returns_set then
      raise exception 'Unsupported set-returning public.leave_match(uuid)';
    elsif v_return_type = 'jsonb'::pg_catalog.regtype::oid then
      v_previous_state := 'legacy_jsonb';
    elsif v_return_type = v_matches_type
      and v_normalized_definition like '%for update%'
      and v_normalized_definition like '%v_match.owner_id = v_user_id%'
      and v_normalized_definition like '%paid participation cannot be left through leave_match%'
      and v_normalized_definition like '%slot_value->>''id'' is distinct from v_user_id::text%'
      and v_normalized_definition like '%participant_id <> v_user_id::text%'
      and v_normalized_definition like '%return v_updated%'
    then
      v_previous_state := 'current_matches';
    elsif v_return_type = v_matches_type then
      raise exception 'Existing public.leave_match(uuid) returns public.matches but does not match the expected 002 logic';
    else
      raise exception 'Unsupported return type for public.leave_match(uuid): %',
        pg_catalog.pg_get_function_result(v_target_oid);
    end if;
  end if;

  perform pg_catalog.set_config(
    'prosto_padel.leave_match_previous_state',
    v_previous_state,
    true
  );
end;
$preflight$;

-- DROP + CREATE is required because PostgreSQL cannot change a function return
-- type with CREATE OR REPLACE FUNCTION. The surrounding transaction restores the
-- previous function automatically if any later statement fails.
drop function if exists public.leave_match(uuid);

create function public.leave_match(p_match_id uuid)
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

revoke all on function public.leave_match(uuid) from public, anon, authenticated;
grant execute on function public.leave_match(uuid) to authenticated;

do $comment$
declare
  v_previous_state text := pg_catalog.current_setting(
    'prosto_padel.leave_match_previous_state',
    true
  );
begin
  execute pg_catalog.format(
    'comment on function public.leave_match(uuid) is %L',
    'Atomic self-leave RPC returning public.matches; migration=006_leave_match_return_type_fix; rollback_state='
      || v_previous_state
  );
end;
$comment$;

commit;
