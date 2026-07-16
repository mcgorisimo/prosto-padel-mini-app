-- 009_match_waitlist_notifications_ROLLBACK.sql
-- Safe only before 009 has accumulated persistent waitlist/notification rows.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

do $$
begin
  if pg_catalog.to_regclass('public.match_waitlist') is null
     or pg_catalog.to_regclass('public.notifications') is null
     or pg_catalog.to_regclass('prosto_padel_internal.migration_009_function_state') is null
     or pg_catalog.to_regprocedure('prosto_padel_internal.promote_match_waitlist(uuid)') is null then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: complete migration 009 is not installed';
  end if;
  if coalesce(pg_catalog.obj_description('public.match_waitlist'::pg_catalog.regclass,'pg_class'),'')
       not like 'migration=009_match_waitlist_notifications;%'
     or coalesce(pg_catalog.obj_description('public.notifications'::pg_catalog.regclass,'pg_class'),'')
       not like 'migration=009_match_waitlist_notifications;%' then
    raise exception 'ROLLBACK_CONFLICT: refusing to remove unmanaged tables';
  end if;
  if coalesce(pg_catalog.obj_description(
       (select n.oid from pg_catalog.pg_namespace n where n.nspname='prosto_padel_internal'),
       'pg_namespace'
     ),'') not like 'migration=009_match_waitlist_notifications;%'
     or coalesce(pg_catalog.obj_description(
       pg_catalog.to_regprocedure('prosto_padel_internal.promote_match_waitlist(uuid)')::oid,
       'pg_proc'
     ),'') not like 'migration=009_match_waitlist_notifications;%'
     or coalesce(pg_catalog.obj_description(
       pg_catalog.to_regclass('prosto_padel_internal.migration_009_function_state'),
       'pg_class'
     ),'') not like 'migration=009_match_waitlist_notifications;%' then
    raise exception 'ROLLBACK_CONFLICT: refusing to remove an unmanaged internal schema or helper';
  end if;
  if (
    select count(*)
    from (values
      ('public.join_match_waitlist(uuid)'),
      ('public.leave_match_waitlist(uuid)'),
      ('public.get_my_match_waitlist_position(uuid)'),
      ('public.get_match_waitlist_count(uuid)'),
      ('public.get_my_notifications()'),
      ('public.get_unread_notification_count()'),
      ('public.mark_notification_read(uuid)'),
      ('public.mark_all_notifications_read()'),
      ('public.remove_match_participant(uuid,uuid)')
    ) expected(signature)
    join pg_catalog.pg_proc p
      on p.oid=pg_catalog.to_regprocedure(expected.signature)::oid
    where coalesce(pg_catalog.obj_description(p.oid,'pg_proc'),'')
      like 'migration=009_match_waitlist_notifications;%'
  ) <> 9 then
    raise exception 'ROLLBACK_CONFLICT: a 009 public RPC is missing or was replaced';
  end if;
  if exists (
    select 1 from (values
      ('public.create_match_invitation(uuid,uuid,smallint)'),
      ('public.decline_match_invitation(uuid)'),
      ('public.cancel_match_invitation(uuid)'),
      ('public.join_match(uuid)')
    ) expected(signature)
    left join pg_catalog.pg_proc p on p.oid=pg_catalog.to_regprocedure(expected.signature)::oid
    where p.oid is null
       or coalesce(pg_catalog.obj_description(p.oid,'pg_proc'),'')
          not like 'migration=009_match_waitlist_notifications;%'
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    join prosto_padel_internal.migration_009_function_state s
      on s.function_identity='public.leave_match(uuid)'
    where p.oid=pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid
      and p.oid=s.function_oid
      and p.proowner=s.function_owner
      and p.proacl is not distinct from s.function_acl
      and pg_catalog.obj_description(p.oid,'pg_proc') is not distinct from s.function_description
      and s.definition_hash=pg_catalog.md5(s.function_definition)
      and lower(pg_catalog.pg_get_functiondef(p.oid)) like '%prosto_padel_internal.promote_match_waitlist%'
  ) then
    raise exception 'ROLLBACK_CONFLICT: an updated legacy RPC or captured leave_match state no longer matches migration 009';
  end if;
  if exists(select 1 from public.match_waitlist)
     or exists(select 1 from public.notifications) then
    raise exception 'ROLLBACK_DATA_PRESENT: preserve or archive 009 rows before any removal';
  end if;
end;
$$;

-- Restore the 008 invitation creator without waitlist/notification dependencies.
create or replace function public.create_match_invitation(
  p_match_id uuid, p_invited_user_id uuid, p_slot_index smallint
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
  if v_actor_id is null then raise exception using errcode='28000',message='INVITATION_AUTH_REQUIRED'; end if;
  if p_match_id is null or p_invited_user_id is null or p_slot_index is null then raise exception using errcode='22023',message='INVITATION_INVALID_ARGUMENTS'; end if;
  if p_slot_index not between 0 and 3 then raise exception using errcode='22023',message='INVITATION_INVALID_SLOT'; end if;
  select exists(select 1 from public.profiles p where p.id=v_actor_id and p.role='admin') into v_is_admin;
  select * into v_match from public.matches m where m.id=p_match_id for update;
  if not found then raise exception using errcode='P0001',message='INVITATION_MATCH_NOT_FOUND'; end if;
  if v_match.owner_id<>v_actor_id and not v_is_admin then raise exception using errcode='42501',message='INVITATION_CREATE_FORBIDDEN'; end if;
  if v_match.status not in ('open','searching','upcoming','confirmed') then raise exception using errcode='P0001',message='INVITATION_MATCH_NOT_ACTIVE'; end if;
  if v_match."dateISO" is null or coalesce(v_match.time,'') !~ '^(0?[0-9]|1[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then raise exception using errcode='22007',message='INVITATION_MATCH_SCHEDULE_INVALID'; end if;
  v_start_at := (v_match."dateISO"::timestamp+v_match.time::time) at time zone 'Europe/Moscow';
  if v_start_at<=pg_catalog.clock_timestamp() then raise exception using errcode='P0001',message='INVITATION_MATCH_ALREADY_STARTED'; end if;
  if p_invited_user_id=v_match.owner_id then raise exception using errcode='22023',message='INVITATION_ORGANIZER_FORBIDDEN'; end if;
  if not exists(select 1 from public.profiles p where p.id=p_invited_user_id) then raise exception using errcode='P0001',message='INVITATION_PROFILE_NOT_FOUND'; end if;
  if p_invited_user_id::text=any(coalesce(v_match.participants,array[]::text[]))
    or exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots",'[]'::jsonb)) s(value) where value->>'id'=p_invited_user_id::text)
    then raise exception using errcode='23505',message='INVITATION_ALREADY_PARTICIPANT'; end if;
  v_filled_count:=pg_catalog.jsonb_array_length(coalesce(v_match."filledSlots",'[]'::jsonb));
  select count(*)::integer into v_pending_count from public.match_invitations i where i.match_id=p_match_id and i.status='pending';
  if v_filled_count+v_pending_count>=4 then raise exception using errcode='P0001',message='INVITATION_MATCH_FULL'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots",'[]'::jsonb)) with ordinality s(value,ord)
    where case when coalesce(value->>'slotIndex','')~'^[0-3]$' then (value->>'slotIndex')::integer else (ord-1)::integer end=p_slot_index)
    then raise exception using errcode='23505',message='INVITATION_SLOT_OCCUPIED'; end if;
  begin
    insert into public.match_invitations(match_id,invited_by,invited_user_id,slot_index)
    values(p_match_id,v_actor_id,p_invited_user_id,p_slot_index) returning * into v_created;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name=constraint_name;
    if v_constraint_name='match_invitations_one_pending_player' then raise exception using errcode='23505',message='INVITATION_ALREADY_PENDING';
    elsif v_constraint_name='match_invitations_one_pending_slot' then raise exception using errcode='23505',message='INVITATION_SLOT_RESERVED'; end if;
    raise;
  end;
  return v_created;
end;
$$;

create or replace function public.decline_match_invitation(p_invitation_id uuid)
returns public.match_invitations
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_user_id uuid:=auth.uid(); v_match_id uuid; v_match public.matches;
  v_invitation public.match_invitations; v_updated public.match_invitations;
begin
  if v_user_id is null then raise exception using errcode='28000',message='INVITATION_AUTH_REQUIRED'; end if;
  select i.match_id into v_match_id from public.match_invitations i where i.id=p_invitation_id;
  if not found then raise exception using errcode='P0001',message='INVITATION_NOT_FOUND'; end if;
  select * into v_match from public.matches m where m.id=v_match_id for update;
  if not found then raise exception using errcode='P0001',message='INVITATION_MATCH_NOT_FOUND'; end if;
  select * into v_invitation from public.match_invitations i where i.id=p_invitation_id and i.match_id=v_match_id for update;
  if not found then raise exception using errcode='P0001',message='INVITATION_NOT_FOUND'; end if;
  if v_invitation.invited_user_id<>v_user_id then raise exception using errcode='42501',message='INVITATION_RESPONSE_FORBIDDEN'; end if;
  if v_invitation.status<>'pending' then raise exception using errcode='P0001',message='INVITATION_NOT_PENDING'; end if;
  update public.match_invitations set status='declined',responded_at=pg_catalog.now()
  where id=p_invitation_id returning * into v_updated;
  return v_updated;
end;
$$;

create or replace function public.cancel_match_invitation(p_invitation_id uuid)
returns public.match_invitations
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_user_id uuid:=auth.uid(); v_match_id uuid; v_match public.matches;
  v_invitation public.match_invitations; v_is_admin boolean; v_updated public.match_invitations;
begin
  if v_user_id is null then raise exception using errcode='28000',message='INVITATION_AUTH_REQUIRED'; end if;
  select i.match_id into v_match_id from public.match_invitations i where i.id=p_invitation_id;
  if not found then raise exception using errcode='P0001',message='INVITATION_NOT_FOUND'; end if;
  select exists(select 1 from public.profiles p where p.id=v_user_id and p.role='admin') into v_is_admin;
  select * into v_match from public.matches m where m.id=v_match_id for update;
  if not found then raise exception using errcode='P0001',message='INVITATION_MATCH_NOT_FOUND'; end if;
  select * into v_invitation from public.match_invitations i where i.id=p_invitation_id and i.match_id=v_match_id for update;
  if not found then raise exception using errcode='P0001',message='INVITATION_NOT_FOUND'; end if;
  if v_match.owner_id<>v_user_id and not v_is_admin then raise exception using errcode='42501',message='INVITATION_CANCEL_FORBIDDEN'; end if;
  if v_invitation.status<>'pending' then raise exception using errcode='P0001',message='INVITATION_NOT_PENDING'; end if;
  update public.match_invitations set status='cancelled',responded_at=pg_catalog.now()
  where id=p_invitation_id returning * into v_updated;
  return v_updated;
end;
$$;

-- Restore the 008 reservation-aware join_match (without waitlist awareness).
create or replace function public.join_match(p_match_id uuid)
returns public.matches
language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare v_user_id uuid:=auth.uid(); v_match public.matches; v_profile public.profiles;
  v_rating_idx integer; v_filled_count integer; v_pending_count integer; v_slot_index integer;
  v_new_slot jsonb; v_new_participants text[]; v_start_at timestamp with time zone; v_updated public.matches;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  select * into v_match from public.matches where id=p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if v_match.owner_id=v_user_id then raise exception 'Organizer cannot join own match through join_match'; end if;
  if v_match.type<>'match' then raise exception 'Only match records can be joined'; end if;
  if coalesce(v_match."isPrivate",false) then raise exception 'Private matches cannot be joined through join_match'; end if;
  if v_match.status not in ('open','searching','upcoming','confirmed') then raise exception 'Match cannot be joined in current status'; end if;
  if v_match."dateISO" is not null then
    if coalesce(v_match.time,'')~'^\d{1,2}:\d{2}(:\d{2})?$' then v_start_at:=(v_match."dateISO"::timestamp+v_match.time::time) at time zone current_setting('TimeZone');
    else v_start_at:=v_match."dateISO"::timestamp at time zone current_setting('TimeZone'); end if;
    if v_start_at<=pg_catalog.now() then raise exception 'Match has already started'; end if;
  end if;
  if v_user_id::text=any(coalesce(v_match.participants,array[]::text[])) then raise exception 'User is already a participant'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots",'[]'::jsonb)) s(value) where value->>'id'=v_user_id::text) then raise exception 'User already has a slot'; end if;
  if exists(select 1 from public.match_invitations i where i.match_id=p_match_id and i.invited_user_id=v_user_id and i.status='pending') then raise exception 'User has a pending invitation; accept or decline it instead'; end if;
  select * into v_profile from public.profiles where id=v_user_id;
  if not found then raise exception 'Profile not found'; end if;
  v_rating_idx:=case when v_profile.rating<=1.5 then 0 when v_profile.rating<=2.2 then 1 when v_profile.rating<=3.2 then 2
    when v_profile.rating<=5.0 then 3 when v_profile.rating<=6.5 then 4 when v_profile.rating<=7.5 then 5 else 6 end;
  if v_rating_idx<v_match."ratingMin" or v_rating_idx>v_match."ratingMax" then raise exception 'Player rating is outside match range'; end if;
  v_filled_count:=pg_catalog.jsonb_array_length(coalesce(v_match."filledSlots",'[]'::jsonb));
  select count(*)::integer into v_pending_count from public.match_invitations i where i.match_id=p_match_id and i.status='pending';
  if v_filled_count+v_pending_count>=4 then raise exception 'Match has no free slots'; end if;
  select c.slot_index into v_slot_index from pg_catalog.generate_series(0,3)c(slot_index)
  where not exists(select 1 from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots",'[]'::jsonb)) with ordinality s(value,ord)
    where case when coalesce(value->>'slotIndex','')~'^[0-3]$' then (value->>'slotIndex')::integer else (ord-1)::integer end=c.slot_index)
  and not exists(select 1 from public.match_invitations i where i.match_id=p_match_id and i.status='pending' and i.slot_index=c.slot_index)
  order by c.slot_index limit 1;
  if v_slot_index is null then raise exception 'Match has no free slots'; end if;
  v_new_slot:=pg_catalog.jsonb_build_object('id',v_user_id::text,'firstName',v_profile.first_name,'lastName',v_profile.last_name,
    'ratingIdx',v_rating_idx,'numericRating',v_profile.rating,'isVerified',v_profile.is_verified,'isOrganizer',false,'slotIndex',v_slot_index);
  select coalesce(pg_catalog.array_agg(participant_id order by ord),array[]::text[]) into v_new_participants
  from(select participant_id,min(ord) ord from(
    select participant_id,ord from pg_catalog.unnest(coalesce(v_match.participants,array[]::text[])) with ordinality p(participant_id,ord)
    union all select v_user_id::text,coalesce(pg_catalog.array_length(v_match.participants,1),0)+1)x group by participant_id)d;
  update public.matches set "filledSlots"=coalesce(v_match."filledSlots",'[]'::jsonb)||pg_catalog.jsonb_build_array(v_new_slot),
    participants=v_new_participants,status=case when v_match.status='searching' then 'searching'
      when v_match.status='confirmed' then case when v_filled_count+1>=4 then 'confirmed' else 'open' end
      else case when v_filled_count+1>=4 then 'upcoming' else 'open' end end,updated_at=pg_catalog.now()
  where id=p_match_id returning * into v_updated;
  return v_updated;
end;
$$;

-- Restore the exact function definition captured from the working database
-- immediately before 009 replaced it. CREATE OR REPLACE keeps the same OID,
-- owner, ACL and comment; the post-restore assertions verify all metadata.
do $restore_leave_match$
declare
  v_definition text;
  v_definition_hash text;
  v_function_oid oid;
  v_function_owner oid;
  v_function_acl aclitem[];
  v_function_config text[];
  v_function_description text;
begin
  select
    s.function_definition,s.definition_hash,s.function_oid,s.function_owner,
    s.function_acl,s.function_config,s.function_description
  into
    v_definition,v_definition_hash,v_function_oid,v_function_owner,
    v_function_acl,v_function_config,v_function_description
  from prosto_padel_internal.migration_009_function_state s
  where s.function_identity='public.leave_match(uuid)';

  if not found or v_definition_hash<>pg_catalog.md5(v_definition) then
    raise exception 'ROLLBACK_STATE_INVALID: captured leave_match definition is missing or corrupted';
  end if;

  execute v_definition;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid=pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid
      and p.oid=v_function_oid
      and p.proowner=v_function_owner
      and p.proacl is not distinct from v_function_acl
      and p.proconfig is not distinct from v_function_config
      and pg_catalog.obj_description(p.oid,'pg_proc') is not distinct from v_function_description
      and pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid))=v_definition_hash
  ) then
    raise exception 'ROLLBACK_VERIFY_FAILED: leave_match was not restored exactly';
  end if;
end;
$restore_leave_match$;

revoke all on function public.create_match_invitation(uuid,uuid,smallint) from public,anon,authenticated;
revoke all on function public.decline_match_invitation(uuid) from public,anon,authenticated;
revoke all on function public.cancel_match_invitation(uuid) from public,anon,authenticated;
revoke all on function public.join_match(uuid) from public,anon,authenticated;
grant execute on function public.create_match_invitation(uuid,uuid,smallint) to authenticated;
grant execute on function public.decline_match_invitation(uuid) to authenticated;
grant execute on function public.cancel_match_invitation(uuid) to authenticated;
grant execute on function public.join_match(uuid) to authenticated;
comment on function public.create_match_invitation(uuid,uuid,smallint) is 'migration=008_match_invitations_stage1; authenticated organizer/admin creates one pending reservation under a match-row lock';
comment on function public.decline_match_invitation(uuid) is 'migration=008_match_invitations_stage1; invited user releases a pending reservation';
comment on function public.cancel_match_invitation(uuid) is 'migration=008_match_invitations_stage1; organizer/admin releases a pending reservation';
comment on function public.join_match(uuid) is 'migration=008_match_invitations_stage1;rollback=restore_003; atomic public self-join preserving returns public.matches while excluding pending invitation reservations';
-- leave_match owner, ACL, search_path, body and comment came from the captured state.

drop function public.join_match_waitlist(uuid);
drop function public.leave_match_waitlist(uuid);
drop function public.get_my_match_waitlist_position(uuid);
drop function public.get_match_waitlist_count(uuid);
drop function public.get_my_notifications();
drop function public.get_unread_notification_count();
drop function public.mark_notification_read(uuid);
drop function public.mark_all_notifications_read();
drop function public.remove_match_participant(uuid,uuid);
drop function prosto_padel_internal.promote_match_waitlist(uuid);
drop table public.notifications;
drop table public.match_waitlist;
drop table prosto_padel_internal.migration_009_function_state;
drop schema prosto_padel_internal;

commit;
