-- 006_leave_match_return_type_fix_ROLLBACK.sql
-- Restores the state recorded by migration 006 without changing tables or rows.
-- legacy_jsonb: restores the exact leave_match implementation from 001.
-- absent: removes the function. current_matches: leaves the prior current version in place.

begin;

do $rollback$
declare
  v_target_oid oid := pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid;
  v_description text;
  v_previous_state text;
begin
  if v_target_oid is null then
    raise exception 'public.leave_match(uuid) is absent; rollback marker cannot be read';
  end if;

  select pg_catalog.obj_description(v_target_oid, 'pg_proc')
  into v_description;

  v_previous_state := substring(
    coalesce(v_description, '')
    from 'rollback_state=(absent|legacy_jsonb|current_matches)'
  );

  if v_previous_state is null then
    raise exception 'Migration 006 rollback marker is missing; no changes were made';
  end if;

  if v_previous_state = 'current_matches' then
    raise notice 'Previous state was already current_matches; rollback is a no-op';
    return;
  end if;

  execute 'revoke all on function public.leave_match(uuid) from public, anon, authenticated';
  execute 'drop function public.leave_match(uuid)';

  if v_previous_state = 'absent' then
    raise notice 'Previous state was absent; public.leave_match(uuid) was removed';
    return;
  end if;

  execute $legacy_function$
    create function public.leave_match(p_match_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public, pg_temp
    as $legacy_body$
    declare
      v_user_id uuid := auth.uid();
      v_match public.matches;
      v_participants text[];
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
        raise exception 'Owner cannot leave own match through leave_match';
      end if;

      v_participants := coalesce(v_match.participants, array[]::text[]);

      if not (v_user_id::text = any(v_participants)) then
        raise exception 'User is not a participant';
      end if;

      v_participants := array_remove(v_participants, v_user_id::text);

      update public.matches
      set
        participants = v_participants,
        status = case
          when type = 'match'
            and coalesce("isPrivate", false) = false
            and status in ('upcoming', 'confirmed')
            and coalesce(array_length(v_participants, 1), 0) < 4
          then 'open'
          else status
        end
      where id = p_match_id
      returning * into v_updated;

      return jsonb_build_object(
        'ok', true,
        'match', to_jsonb(v_updated),
        'participants_count', coalesce(array_length(v_participants, 1), 0)
      );
    end;
    $legacy_body$;
  $legacy_function$;

  execute 'revoke all on function public.leave_match(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.leave_match(uuid) to authenticated';
  execute $legacy_comment$
    comment on function public.leave_match(uuid) is
      'Legacy jsonb leave_match restored from 001 by 006 rollback.'
  $legacy_comment$;
end;
$rollback$;

commit;
