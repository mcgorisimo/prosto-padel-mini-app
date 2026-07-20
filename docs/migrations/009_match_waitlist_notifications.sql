-- 009_match_waitlist_notifications.sql
-- Additive waitlist and general notifications on top of installed migration 008.
-- Existing frontend writes to matches remain available temporarily for compatibility.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '90s';

do $$
declare
  v_required_columns integer;
begin
  if pg_catalog.to_regclass('public.matches') is null
     or pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.match_invitations') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: matches, profiles and installed 008 match_invitations are required';
  end if;

  if coalesce(pg_catalog.obj_description('public.match_invitations'::pg_catalog.regclass, 'pg_class'), '')
       not like 'migration=008_match_invitations_stage1;%' then
    raise exception 'MIGRATION_PRECONDITION_FAILED: match_invitations is not the audited 008 table';
  end if;

  select count(*) into v_required_columns
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
      or (a.attname = 'isPrivate' and a.atttypid = 'boolean'::pg_catalog.regtype)
      or (a.attname = 'ratingMin' and a.atttypid = 'integer'::pg_catalog.regtype)
      or (a.attname = 'ratingMax' and a.atttypid = 'integer'::pg_catalog.regtype)
      or (a.attname = 'pricePerPerson' and a.atttypid = 'numeric'::pg_catalog.regtype)
      or (a.attname = 'courtId' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'courtName' and a.atttypid = 'text'::pg_catalog.regtype)
      or (a.attname = 'filledSlots' and a.atttypid = 'jsonb'::pg_catalog.regtype)
      or (a.attname = 'participants' and a.atttypid = 'text[]'::pg_catalog.regtype)
    );

  if v_required_columns <> 14 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: public.matches differs from the audited structure';
  end if;

  if pg_catalog.to_regprocedure('auth.uid()') is null
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: Supabase auth adapter or API roles are missing';
  end if;

  if pg_catalog.to_regclass('public.match_waitlist') is not null
     or pg_catalog.to_regclass('public.notifications') is not null
     or exists (select 1 from pg_catalog.pg_namespace where nspname = 'prosto_padel_internal') then
    raise exception 'MIGRATION_CONFLICT: a 009 table or internal schema already exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'join_match_waitlist', 'leave_match_waitlist', 'get_my_match_waitlist_position',
        'get_match_waitlist_count', 'get_my_notifications', 'get_unread_notification_count',
        'mark_notification_read', 'mark_all_notifications_read', 'remove_match_participant'
      )
  ) then
    raise exception 'MIGRATION_CONFLICT: a 009 RPC name already exists';
  end if;

  if exists (
    select 1
    from public.matches m
    where pg_catalog.jsonb_typeof(m."filledSlots") is distinct from 'array'
       or pg_catalog.jsonb_array_length(m."filledSlots") > 4
  ) then
    raise exception 'MIGRATION_EXISTING_INVALID_MATCH: filledSlots must be an array with at most four rows';
  end if;

  if exists (
    select 1
    from public.matches m
    cross join lateral pg_catalog.jsonb_array_elements(m."filledSlots") with ordinality s(value,ord)
    where (value ? 'slotIndex' and coalesce(value->>'slotIndex','') !~ '^[0-3]$')
  ) or exists (
    select 1 from (
      select m.id,case when coalesce(value->>'slotIndex','')~'^[0-3]$'
        then (value->>'slotIndex')::integer else (ord-1)::integer end slot_index
      from public.matches m
      cross join lateral pg_catalog.jsonb_array_elements(m."filledSlots") with ordinality s(value,ord)
    ) slots group by id,slot_index having count(*)>1
  ) or exists (
    select 1 from public.matches m
    cross join lateral pg_catalog.jsonb_array_elements(m."filledSlots") s(value)
    where nullif(value->>'id','') is not null
    group by m.id,value->>'id' having count(*)>1
  ) then
    raise exception 'MIGRATION_EXISTING_INVALID_MATCH: filledSlots has invalid or duplicate logical slots/players';
  end if;

  if exists (
    select 1
    from public.matches m
    where pg_catalog.jsonb_array_length(m."filledSlots") +
      (select count(*) from public.match_invitations i where i.match_id=m.id and i.status='pending') > 4
  ) or exists (
    select 1
    from public.match_invitations i
    join public.matches m on m.id=i.match_id
    where i.status='pending' and (
      i.invited_user_id::text=any(coalesce(m.participants,array[]::text[]))
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(m."filledSlots") with ordinality s(value,ord)
        where value->>'id'=i.invited_user_id::text
           or case when coalesce(value->>'slotIndex','')~'^[0-3]$'
                then (value->>'slotIndex')::integer else (ord-1)::integer end=i.slot_index
      )
    )
  ) then
    raise exception 'MIGRATION_EXISTING_INVITATION_CONFLICT: pending reservations conflict with current match capacity or slots';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.join_match(uuid)')::oid
      and p.prorettype = 'public.matches'::pg_catalog.regtype
      and coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '') like 'migration=008_match_invitations_stage1;%'
  ) or not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = pg_catalog.to_regprocedure('public.create_match_invitation(uuid,uuid,smallint)')::oid
      and p.prorettype = 'public.match_invitations'::pg_catalog.regtype
      and coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '') like 'migration=008_match_invitations_stage1;%'
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: audited 008 RPC versions are not installed';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'create_match_invitation','get_incoming_match_invitations','accept_match_invitation',
        'decline_match_invitation','cancel_match_invitation','join_match'
      )
      and coalesce(pg_catalog.obj_description(p.oid,'pg_proc'),'')
        like 'migration=008_match_invitations_stage1;%'
  ) <> 6 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: one or more audited 008 invitation/join RPCs differ';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral (
      select regexp_replace(lower(pg_catalog.pg_get_functiondef(p.oid)),'\s+',' ','g') definition
    ) normalized
    where p.oid=pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid
      and pg_catalog.pg_get_function_identity_arguments(p.oid)='p_match_id uuid'
      and not p.proretset
      and p.prorettype='public.matches'::pg_catalog.regtype
      and p.prosecdef
      and coalesce(p.proconfig @> array['search_path=public, pg_temp'],false)
      and normalized.definition like '%auth.uid()%'
      and normalized.definition like '%for update%'
      and normalized.definition like '%v_match.owner_id = v_user_id%'
      and normalized.definition like '%organizer cannot leave own match through leave_match%'
      and normalized.definition like '%organizer slot cannot leave through leave_match%'
      and normalized.definition like '%paid participation cannot be left through leave_match%'
      and normalized.definition like '%paymentstatus%'
      and normalized.definition like '%ispaid%'
      and normalized.definition like '%slot_value->>''id'' is distinct from v_user_id::text%'
      and normalized.definition like '%participant_id <> v_user_id::text%'
      and normalized.definition like '%"filledslots" = v_new_filled_slots%'
      and normalized.definition like '%participants = v_new_participants%'
      and normalized.definition like '%return v_updated%'
  ) or exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='leave_match'
      and p.oid is distinct from pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid
  ) or exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    left join pg_catalog.pg_roles r on r.oid=a.grantee
    where p.oid=pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid
      and a.privilege_type='EXECUTE'
      and (a.grantee=0 or r.rolname='anon')
  ) or not exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    join pg_catalog.pg_roles r on r.oid=a.grantee
    where p.oid=pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid
      and r.rolname='authenticated' and a.privilege_type='EXECUTE'
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: leave_match(uuid) is not the audited compatible atomic implementation';
  end if;
end;
$$;

create schema prosto_padel_internal;
revoke all on schema prosto_padel_internal from public, anon, authenticated;
comment on schema prosto_padel_internal is
  'migration=009_match_waitlist_notifications;rollback=drop; non-API helpers only';

create table prosto_padel_internal.migration_009_function_state (
  function_identity text primary key,
  function_oid oid not null,
  function_definition text not null,
  definition_hash text not null,
  function_owner oid not null,
  function_acl aclitem[],
  function_config text[],
  function_description text,
  captured_at timestamp with time zone not null default pg_catalog.now(),
  constraint migration_009_function_state_identity_check
    check (function_identity='public.leave_match(uuid)'),
  constraint migration_009_function_state_hash_check
    check (definition_hash=pg_catalog.md5(function_definition))
);

-- The snapshot contains executable function text and is never an API table.
-- RLS has no policies by design: only the table owner (the SQL migration role)
-- may insert/read it for installation, POSTCHECK and ROLLBACK.
alter table prosto_padel_internal.migration_009_function_state
  enable row level security;

revoke all on table prosto_padel_internal.migration_009_function_state
  from public, anon, authenticated;

insert into prosto_padel_internal.migration_009_function_state (
  function_identity,function_oid,function_definition,definition_hash,
  function_owner,function_acl,function_config,function_description
)
select
  'public.leave_match(uuid)',p.oid,pg_catalog.pg_get_functiondef(p.oid),
  pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)),p.proowner,p.proacl,p.proconfig,
  pg_catalog.obj_description(p.oid,'pg_proc')
from pg_catalog.pg_proc p
where p.oid=pg_catalog.to_regprocedure('public.leave_match(uuid)')::oid;

comment on table prosto_padel_internal.migration_009_function_state is
  'migration=009_match_waitlist_notifications; exact pre-009 leave_match definition and metadata used only by ROLLBACK';

create table public.match_waitlist (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  match_id uuid not null,
  user_id uuid not null,
  status text not null default 'waiting',
  joined_at timestamp with time zone not null default pg_catalog.now(),
  status_changed_at timestamp with time zone,
  constraint match_waitlist_match_fkey
    foreign key (match_id) references public.matches(id) on delete cascade,
  constraint match_waitlist_user_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade,
  constraint match_waitlist_status_check
    check (status in ('waiting', 'promoted', 'left', 'skipped')),
  constraint match_waitlist_status_time_check
    check (
      (status = 'waiting' and status_changed_at is null)
      or (status in ('promoted', 'left', 'skipped') and status_changed_at is not null)
    )
);

create unique index match_waitlist_one_waiting_user
  on public.match_waitlist (match_id, user_id)
  where status = 'waiting';

create index match_waitlist_fifo_idx
  on public.match_waitlist (match_id, joined_at, id)
  where status = 'waiting';

create index match_waitlist_user_status_idx
  on public.match_waitlist (user_id, status, joined_at desc);

comment on table public.match_waitlist is
  'migration=009_match_waitlist_notifications;rollback=drop; FIFO waiting rows never occupy matches until atomic promotion';

create table public.notifications (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  recipient_id uuid not null,
  type text not null,
  match_id uuid not null,
  invitation_id uuid,
  waitlist_id uuid,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamp with time zone not null default pg_catalog.now(),
  read_at timestamp with time zone,
  constraint notifications_recipient_fkey
    foreign key (recipient_id) references public.profiles(id) on delete cascade,
  constraint notifications_match_fkey
    foreign key (match_id) references public.matches(id) on delete cascade,
  constraint notifications_invitation_fkey
    foreign key (invitation_id) references public.match_invitations(id) on delete set null,
  constraint notifications_waitlist_fkey
    foreign key (waitlist_id) references public.match_waitlist(id) on delete set null,
  constraint notifications_type_check
    check (type in ('match_invitation', 'waitlist_promoted')),
  constraint notifications_data_object_check
    check (pg_catalog.jsonb_typeof(data) = 'object'),
  constraint notifications_relation_check
    check (
      (type = 'match_invitation' and invitation_id is not null and waitlist_id is null)
      or (type = 'waitlist_promoted' and waitlist_id is not null and invitation_id is null)
    )
);

create unique index notifications_recipient_dedupe_key
  on public.notifications (recipient_id, dedupe_key);

create index notifications_recipient_feed_idx
  on public.notifications (recipient_id, created_at desc, id desc);

create index notifications_recipient_unread_idx
  on public.notifications (recipient_id, created_at desc)
  where read_at is null;

comment on table public.notifications is
  'migration=009_match_waitlist_notifications;rollback=drop; safe user-owned notification feed with deterministic deduplication';

alter table public.match_waitlist enable row level security;
alter table public.notifications enable row level security;

create policy match_waitlist_select_own
on public.match_waitlist
for select
to authenticated
using (user_id = (select auth.uid()));

create policy notifications_select_own
on public.notifications
for select
to authenticated
using (recipient_id = (select auth.uid()));

revoke all on table public.match_waitlist from public, anon, authenticated;
revoke all on table public.notifications from public, anon, authenticated;
grant select on table public.match_waitlist to authenticated;
grant select on table public.notifications to authenticated;

create function public.join_match_waitlist(p_match_id uuid)
returns public.match_waitlist
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_match public.matches;
  v_profile public.profiles;
  v_rating_idx integer;
  v_start_at timestamp with time zone;
  v_filled_count integer;
  v_pending_count integer;
  v_created public.match_waitlist;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'WAITLIST_AUTH_REQUIRED';
  end if;

  select * into v_match
  from public.matches m
  where m.id = p_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'WAITLIST_MATCH_NOT_FOUND';
  end if;

  if v_match.type <> 'match' or coalesce(v_match."isPrivate", false) then
    raise exception using errcode = 'P0001', message = 'WAITLIST_PUBLIC_MATCH_ONLY';
  end if;

  if v_match.status not in ('open', 'searching', 'upcoming', 'confirmed') then
    raise exception using errcode = 'P0001', message = 'WAITLIST_MATCH_NOT_ACTIVE';
  end if;

  if v_match."dateISO" is null
     or coalesce(v_match.time, '') !~ '^(0?[0-9]|1[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception using errcode = '22007', message = 'WAITLIST_MATCH_SCHEDULE_INVALID';
  end if;

  v_start_at := (v_match."dateISO"::timestamp + v_match.time::time)
    at time zone 'Europe/Moscow';
  if v_start_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'WAITLIST_MATCH_ALREADY_STARTED';
  end if;

  if v_match.owner_id = v_user_id then
    raise exception using errcode = '22023', message = 'WAITLIST_ORGANIZER_FORBIDDEN';
  end if;

  if v_user_id::text = any(coalesce(v_match.participants, array[]::text[]))
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) s(value)
       where s.value->>'id' = v_user_id::text
     ) then
    raise exception using errcode = '23505', message = 'WAITLIST_ALREADY_PARTICIPANT';
  end if;

  if exists (
    select 1 from public.match_invitations i
    where i.match_id = p_match_id and i.invited_user_id = v_user_id and i.status = 'pending'
  ) then
    raise exception using errcode = '23505', message = 'WAITLIST_PENDING_INVITATION';
  end if;

  if exists (
    select 1 from public.match_waitlist w
    where w.match_id = p_match_id and w.user_id = v_user_id and w.status = 'waiting'
  ) then
    raise exception using errcode = '23505', message = 'WAITLIST_ALREADY_WAITING';
  end if;

  select * into v_profile from public.profiles p where p.id = v_user_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'WAITLIST_PROFILE_NOT_FOUND';
  end if;
  v_rating_idx := case
    when v_profile.rating <= 1.5 then 0 when v_profile.rating <= 2.2 then 1
    when v_profile.rating <= 3.2 then 2 when v_profile.rating <= 5.0 then 3
    when v_profile.rating <= 6.5 then 4 when v_profile.rating <= 7.5 then 5 else 6
  end;
  if v_rating_idx < v_match."ratingMin" or v_rating_idx > v_match."ratingMax" then
    raise exception using errcode = 'P0001', message = 'WAITLIST_RATING_OUTSIDE_RANGE';
  end if;

  v_filled_count := pg_catalog.jsonb_array_length(coalesce(v_match."filledSlots", '[]'::jsonb));
  select count(*)::integer into v_pending_count
  from public.match_invitations i
  where i.match_id = p_match_id and i.status = 'pending';

  if v_filled_count + v_pending_count < 4 then
    raise exception using errcode = 'P0001', message = 'WAITLIST_MATCH_HAS_FREE_SLOT';
  end if;

  begin
    insert into public.match_waitlist (match_id, user_id)
    values (p_match_id, v_user_id)
    returning * into v_created;
  exception
    when unique_violation then
      raise exception using errcode = '23505', message = 'WAITLIST_ALREADY_WAITING';
  end;

  return v_created;
end;
$$;

create function public.leave_match_waitlist(p_match_id uuid)
returns public.match_waitlist
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_match public.matches;
  v_entry public.match_waitlist;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'WAITLIST_AUTH_REQUIRED';
  end if;

  select * into v_match from public.matches m where m.id = p_match_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'WAITLIST_MATCH_NOT_FOUND';
  end if;

  select * into v_entry
  from public.match_waitlist w
  where w.match_id = p_match_id and w.user_id = v_user_id and w.status = 'waiting'
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'WAITLIST_NOT_WAITING';
  end if;

  update public.match_waitlist
  set status = 'left', status_changed_at = pg_catalog.now()
  where id = v_entry.id
  returning * into v_entry;

  return v_entry;
end;
$$;

create function public.get_my_match_waitlist_position(p_match_id uuid)
returns table (
  waitlist_id uuid,
  status text,
  queue_position bigint,
  joined_at timestamp with time zone
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
    raise exception using errcode = '28000', message = 'WAITLIST_AUTH_REQUIRED';
  end if;

  return query
  with ranked as (
    select w.id, w.user_id, w.status, w.joined_at,
      pg_catalog.row_number() over (order by w.joined_at, w.id) as queue_position
    from public.match_waitlist w
    where w.match_id = p_match_id and w.status = 'waiting'
  )
  select r.id, r.status, r.queue_position, r.joined_at
  from ranked r
  where r.user_id = v_user_id;
end;
$$;

create function public.get_match_waitlist_count(p_match_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'WAITLIST_AUTH_REQUIRED';
  end if;

  select count(*)::integer into v_count
  from public.match_waitlist w
  join public.matches m on m.id = w.match_id
  where w.match_id = p_match_id
    and w.status = 'waiting'
    and m.type = 'match'
    and coalesce(m."isPrivate", false) = false;
  return v_count;
end;
$$;

create function public.get_my_notifications()
returns table (
  notification_id uuid,
  notification_type text,
  match_id uuid,
  invitation_id uuid,
  waitlist_id uuid,
  title text,
  body text,
  data jsonb,
  created_at timestamp with time zone,
  read_at timestamp with time zone
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
    raise exception using errcode = '28000', message = 'NOTIFICATION_AUTH_REQUIRED';
  end if;
  return query
  select n.id, n.type, n.match_id, n.invitation_id, n.waitlist_id,
    n.title, n.body, n.data, n.created_at, n.read_at
  from public.notifications n
  where n.recipient_id = v_user_id
  order by n.created_at desc, n.id desc
  limit 100;
end;
$$;

create function public.get_unread_notification_count()
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'NOTIFICATION_AUTH_REQUIRED';
  end if;
  select count(*)::integer into v_count
  from public.notifications n
  where n.recipient_id = v_user_id and n.read_at is null;
  return v_count;
end;
$$;

create function public.mark_notification_read(p_notification_id uuid)
returns public.notifications
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_updated public.notifications;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'NOTIFICATION_AUTH_REQUIRED';
  end if;
  update public.notifications n
  set read_at = coalesce(n.read_at, pg_catalog.now())
  where n.id = p_notification_id and n.recipient_id = v_user_id
  returning * into v_updated;
  if not found then
    raise exception using errcode = '42501', message = 'NOTIFICATION_NOT_FOUND_OR_FORBIDDEN';
  end if;
  return v_updated;
end;
$$;

create function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'NOTIFICATION_AUTH_REQUIRED';
  end if;
  update public.notifications n
  set read_at = pg_catalog.now()
  where n.recipient_id = v_user_id and n.read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function prosto_padel_internal.promote_match_waitlist(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = pg_catalog, public, prosto_padel_internal, pg_temp
as $$
declare
  v_match public.matches;
  v_entry public.match_waitlist;
  v_profile public.profiles;
  v_start_at timestamp with time zone;
  v_rating_idx integer;
  v_filled_count integer;
  v_pending_count integer;
  v_slot_index integer;
  v_new_slot jsonb;
  v_new_participants text[];
begin
  select * into v_match
  from public.matches m
  where m.id = p_match_id
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'WAITLIST_MATCH_NOT_FOUND';
  end if;

  if v_match.type <> 'match'
     or coalesce(v_match."isPrivate", false)
     or v_match.status not in ('open', 'searching', 'upcoming', 'confirmed')
     or v_match."dateISO" is null
     or coalesce(v_match.time, '') !~ '^(0?[0-9]|1[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    return v_match;
  end if;

  v_start_at := (v_match."dateISO"::timestamp + v_match.time::time)
    at time zone 'Europe/Moscow';
  if v_start_at <= pg_catalog.clock_timestamp() then
    return v_match;
  end if;

  loop
    v_filled_count := pg_catalog.jsonb_array_length(coalesce(v_match."filledSlots", '[]'::jsonb));
    select count(*)::integer into v_pending_count
    from public.match_invitations i
    where i.match_id = p_match_id and i.status = 'pending';

    if v_filled_count + v_pending_count >= 4 then
      return v_match;
    end if;

    select * into v_entry
    from public.match_waitlist w
    where w.match_id = p_match_id and w.status = 'waiting'
    order by w.joined_at, w.id
    limit 1
    for update;

    if not found then
      return v_match;
    end if;

    select * into v_profile
    from public.profiles p
    where p.id = v_entry.user_id;

    v_rating_idx := case
      when v_profile.rating <= 1.5 then 0
      when v_profile.rating <= 2.2 then 1
      when v_profile.rating <= 3.2 then 2
      when v_profile.rating <= 5.0 then 3
      when v_profile.rating <= 6.5 then 4
      when v_profile.rating <= 7.5 then 5
      else 6
    end;

    if not found
       or v_entry.user_id = v_match.owner_id
       or v_entry.user_id::text = any(coalesce(v_match.participants, array[]::text[]))
       or exists (
         select 1 from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) s(value)
         where s.value->>'id' = v_entry.user_id::text
       )
       or exists (
         select 1 from public.match_invitations i
         where i.match_id = p_match_id and i.invited_user_id = v_entry.user_id and i.status = 'pending'
       )
       or v_rating_idx < v_match."ratingMin"
       or v_rating_idx > v_match."ratingMax" then
      update public.match_waitlist
      set status = 'skipped', status_changed_at = pg_catalog.now()
      where id = v_entry.id;
      continue;
    end if;

    select candidate.slot_index into v_slot_index
    from pg_catalog.generate_series(0, 3) candidate(slot_index)
    where not exists (
      select 1
      from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb))
        with ordinality as slots(slot_value, ordinal_position)
      where case
        when coalesce(slots.slot_value->>'slotIndex', '') ~ '^[0-3]$'
          then (slots.slot_value->>'slotIndex')::integer
        else (slots.ordinal_position - 1)::integer
      end = candidate.slot_index
    )
    and not exists (
      select 1 from public.match_invitations i
      where i.match_id = p_match_id and i.status = 'pending'
        and i.slot_index = candidate.slot_index
    )
    order by candidate.slot_index
    limit 1;

    if v_slot_index is null then
      return v_match;
    end if;

    v_new_slot := pg_catalog.jsonb_build_object(
      'id', v_entry.user_id::text,
      'firstName', v_profile.first_name,
      'lastName', v_profile.last_name,
      'ratingIdx', v_rating_idx,
      'numericRating', v_profile.rating,
      'isVerified', v_profile.is_verified,
      'isOrganizer', false,
      'slotIndex', v_slot_index
    );

    select coalesce(pg_catalog.array_agg(participant_id order by ordinal_position), array[]::text[])
    into v_new_participants
    from (
      select participant_id, min(ordinal_position) as ordinal_position
      from (
        select participant_id, ordinal_position
        from pg_catalog.unnest(coalesce(v_match.participants, array[]::text[]))
          with ordinality as p(participant_id, ordinal_position)
        union all
        select v_entry.user_id::text, coalesce(pg_catalog.array_length(v_match.participants, 1), 0) + 1
      ) rows_to_dedupe
      group by participant_id
    ) deduplicated;

    update public.matches
    set
      "filledSlots" = coalesce(v_match."filledSlots", '[]'::jsonb)
        || pg_catalog.jsonb_build_array(v_new_slot),
      participants = v_new_participants,
      status = case
        when v_match.status = 'searching' then 'searching'
        when v_match.status = 'confirmed' then
          case when v_filled_count + 1 >= 4 then 'confirmed' else 'open' end
        else case when v_filled_count + 1 >= 4 then 'upcoming' else 'open' end
      end,
      updated_at = pg_catalog.now()
    where id = p_match_id
    returning * into v_match;

    update public.match_waitlist
    set status = 'promoted', status_changed_at = pg_catalog.now()
    where id = v_entry.id;

    insert into public.notifications (
      recipient_id, type, match_id, waitlist_id, title, body, data, dedupe_key
    ) values (
      v_entry.user_id,
      'waitlist_promoted',
      p_match_id,
      v_entry.id,
      'Вы попали в игру',
      pg_catalog.concat_ws(' · ', v_match."dateISO"::text, v_match.time, v_match."courtName"),
      pg_catalog.jsonb_build_object(
        'dateISO', v_match."dateISO",
        'time', v_match.time,
        'courtId', v_match."courtId",
        'courtName', v_match."courtName",
        'type', v_match.type,
        'ratingMin', v_match."ratingMin",
        'ratingMax', v_match."ratingMax",
        'pricePerPerson', v_match."pricePerPerson"
      ),
      'waitlist-promoted:' || v_entry.id::text
    ) on conflict (recipient_id, dedupe_key) do nothing;

    return v_match;
  end loop;
end;
$$;

revoke all on function prosto_padel_internal.promote_match_waitlist(uuid)
  from public, anon, authenticated;
comment on function prosto_padel_internal.promote_match_waitlist(uuid) is
  'migration=009_match_waitlist_notifications; internal FIFO promotion under a matches row lock';

create function public.remove_match_participant(p_match_id uuid, p_user_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = pg_catalog, public, prosto_padel_internal, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_match public.matches;
  v_slot jsonb;
  v_is_admin boolean;
  v_new_slots jsonb;
  v_new_participants text[];
  v_updated public.matches;
  v_start_at timestamp with time zone;
  v_payment_status text;
begin
  if v_actor_id is null then
    raise exception using errcode = '28000', message = 'REMOVE_PARTICIPANT_AUTH_REQUIRED';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'REMOVE_PARTICIPANT_INVALID_USER';
  end if;

  select exists (
    select 1 from public.profiles p where p.id = v_actor_id and p.role = 'admin'
  ) into v_is_admin;

  select * into v_match
  from public.matches m where m.id = p_match_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'REMOVE_PARTICIPANT_MATCH_NOT_FOUND';
  end if;
  if v_match.owner_id <> v_actor_id and not v_is_admin then
    raise exception using errcode = '42501', message = 'REMOVE_PARTICIPANT_FORBIDDEN';
  end if;
  if p_user_id = v_match.owner_id then
    raise exception using errcode = '22023', message = 'REMOVE_PARTICIPANT_ORGANIZER_FORBIDDEN';
  end if;
  if v_match.status not in ('open', 'searching', 'upcoming', 'confirmed') then
    raise exception using errcode = 'P0001', message = 'REMOVE_PARTICIPANT_MATCH_NOT_ACTIVE';
  end if;
  if v_match."dateISO" is not null then
    v_start_at := case
      when coalesce(v_match.time, '') ~ '^\d{1,2}:\d{2}(:\d{2})?$'
        then (v_match."dateISO"::timestamp + v_match.time::time) at time zone 'Europe/Moscow'
      else v_match."dateISO"::timestamp at time zone 'Europe/Moscow'
    end;
    if v_start_at <= pg_catalog.clock_timestamp() then
      raise exception using errcode = 'P0001', message = 'REMOVE_PARTICIPANT_MATCH_ALREADY_STARTED';
    end if;
  end if;

  if not (p_user_id::text = any(coalesce(v_match.participants, array[]::text[]))) then
    raise exception using errcode = 'P0001', message = 'REMOVE_PARTICIPANT_NOT_FOUND';
  end if;
  select s.value into v_slot
  from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) s(value)
  where s.value->>'id' = p_user_id::text limit 1;
  if v_slot is null then
    raise exception using errcode = 'P0001', message = 'REMOVE_PARTICIPANT_SLOT_NOT_FOUND';
  end if;
  if lower(coalesce(v_slot->>'isOrganizer', 'false')) in ('true', 't', '1', 'yes') then
    raise exception using errcode = '22023', message = 'REMOVE_PARTICIPANT_ORGANIZER_FORBIDDEN';
  end if;

  v_payment_status := lower(coalesce(v_slot->>'paymentStatus', v_slot->>'payment_status', ''));
  if v_payment_status in ('paid', 'full', 'captured', 'confirmed')
     or lower(coalesce(v_slot->>'paid', 'false')) in ('true', 't', '1', 'yes')
     or lower(coalesce(v_slot->>'isPaid', 'false')) in ('true', 't', '1', 'yes') then
    raise exception using errcode = 'P0001', message = 'REMOVE_PARTICIPANT_PAID_SLOT_FORBIDDEN';
  end if;

  select coalesce(pg_catalog.jsonb_agg(value order by ordinal_position), '[]'::jsonb)
  into v_new_slots
  from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb))
    with ordinality s(value, ordinal_position)
  where value->>'id' is distinct from p_user_id::text;

  select coalesce(pg_catalog.array_agg(value order by ordinal_position), array[]::text[])
  into v_new_participants
  from pg_catalog.unnest(coalesce(v_match.participants, array[]::text[]))
    with ordinality p(value, ordinal_position)
  where value <> p_user_id::text;

  update public.matches
  set "filledSlots" = v_new_slots,
      participants = v_new_participants,
      status = case
        when type = 'match' and coalesce("isPrivate", false) = false
          and status in ('upcoming', 'confirmed') and pg_catalog.jsonb_array_length(v_new_slots) < 4
          then 'open' else status end,
      updated_at = pg_catalog.now()
  where id = p_match_id
  returning * into v_updated;

  select * into v_updated
  from prosto_padel_internal.promote_match_waitlist(p_match_id);
  return v_updated;
end;
$$;

-- Compatible replacement of the audited pre-009 implementation: same
-- signature/result and paid-slot rules, plus waitlist promotion.
create or replace function public.leave_match(p_match_id uuid)
returns public.matches
language plpgsql
security definer
set search_path = pg_catalog, public, prosto_padel_internal, pg_temp
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
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if v_match.owner_id = v_user_id then raise exception 'Organizer cannot leave own match through leave_match'; end if;
  if v_match.status not in ('open', 'searching', 'upcoming', 'confirmed') then raise exception 'Match cannot be left in current status'; end if;
  if v_match."dateISO" is not null then
    if coalesce(v_match.time, '') ~ '^\d{1,2}:\d{2}(:\d{2})?$' then
      v_start_at := (v_match."dateISO"::timestamp + v_match.time::time) at time zone current_setting('TimeZone');
    else
      v_start_at := v_match."dateISO"::timestamp at time zone current_setting('TimeZone');
    end if;
    if v_start_at <= pg_catalog.now() then raise exception 'Match has already started'; end if;
  end if;
  if not (v_user_id::text = any(coalesce(v_match.participants, array[]::text[]))) then raise exception 'User is not a participant'; end if;
  select value into v_user_slot
  from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) s(value)
  where value->>'id' = v_user_id::text limit 1;
  if v_user_slot is null then raise exception 'Participant slot not found'; end if;
  if lower(coalesce(v_user_slot->>'isOrganizer', 'false')) in ('true','t','1','yes') then raise exception 'Organizer slot cannot leave through leave_match'; end if;
  v_payment_status := lower(coalesce(v_user_slot->>'paymentStatus', v_user_slot->>'payment_status', ''));
  if v_payment_status in ('paid','full','captured','confirmed')
     or lower(coalesce(v_user_slot->>'paid','false')) in ('true','t','1','yes')
     or lower(coalesce(v_user_slot->>'isPaid','false')) in ('true','t','1','yes') then
    raise exception 'Paid participation cannot be left through leave_match';
  end if;
  select coalesce(pg_catalog.jsonb_agg(value order by ord), '[]'::jsonb) into v_new_filled_slots
  from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) with ordinality s(value, ord)
  where value->>'id' is distinct from v_user_id::text;
  select coalesce(pg_catalog.array_agg(value order by ord), array[]::text[]) into v_new_participants
  from pg_catalog.unnest(coalesce(v_match.participants, array[]::text[])) with ordinality p(value, ord)
  where value <> v_user_id::text;
  v_new_filled_count := pg_catalog.jsonb_array_length(v_new_filled_slots);
  update public.matches set
    "filledSlots" = v_new_filled_slots,
    participants = v_new_participants,
    status = case when type = 'match' and coalesce("isPrivate", false) = false
      and status in ('upcoming','confirmed') and v_new_filled_count < 4 then 'open' else status end,
    updated_at = pg_catalog.now()
  where id = p_match_id returning * into v_updated;
  select * into v_updated from prosto_padel_internal.promote_match_waitlist(p_match_id);
  return v_updated;
end;
$$;

-- Compatible 008 replacement: same signature/result, now rejects active waitlist
-- rows and creates one deduplicated safe notification in the same transaction.
create or replace function public.create_match_invitation(
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
  if v_actor_id is null then raise exception using errcode = '28000', message = 'INVITATION_AUTH_REQUIRED'; end if;
  if p_match_id is null or p_invited_user_id is null or p_slot_index is null then
    raise exception using errcode = '22023', message = 'INVITATION_INVALID_ARGUMENTS';
  end if;
  if p_slot_index not between 0 and 3 then raise exception using errcode = '22023', message = 'INVITATION_INVALID_SLOT'; end if;

  select exists (select 1 from public.profiles p where p.id = v_actor_id and p.role = 'admin') into v_is_admin;
  select * into v_match from public.matches m where m.id = p_match_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_NOT_FOUND'; end if;
  if v_match.owner_id <> v_actor_id and not v_is_admin then raise exception using errcode = '42501', message = 'INVITATION_CREATE_FORBIDDEN'; end if;
  if v_match.status not in ('open','searching','upcoming','confirmed') then raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_NOT_ACTIVE'; end if;
  if v_match."dateISO" is null or coalesce(v_match.time, '') !~ '^(0?[0-9]|1[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
    raise exception using errcode = '22007', message = 'INVITATION_MATCH_SCHEDULE_INVALID';
  end if;
  v_start_at := (v_match."dateISO"::timestamp + v_match.time::time) at time zone 'Europe/Moscow';
  if v_start_at <= pg_catalog.clock_timestamp() then raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_ALREADY_STARTED'; end if;
  if p_invited_user_id = v_match.owner_id then raise exception using errcode = '22023', message = 'INVITATION_ORGANIZER_FORBIDDEN'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_invited_user_id) then raise exception using errcode = 'P0001', message = 'INVITATION_PROFILE_NOT_FOUND'; end if;
  if p_invited_user_id::text = any(coalesce(v_match.participants, array[]::text[]))
     or exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) s(value) where value->>'id' = p_invited_user_id::text) then
    raise exception using errcode = '23505', message = 'INVITATION_ALREADY_PARTICIPANT';
  end if;
  if exists (
    select 1 from public.match_waitlist w
    where w.match_id = p_match_id and w.user_id = p_invited_user_id and w.status = 'waiting'
  ) then
    raise exception using errcode = '23505', message = 'INVITATION_USER_WAITLISTED';
  end if;
  if exists (
    select 1 from public.match_waitlist w
    where w.match_id = p_match_id and w.status = 'waiting'
  ) then
    raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_HAS_WAITLIST';
  end if;

  v_filled_count := pg_catalog.jsonb_array_length(coalesce(v_match."filledSlots", '[]'::jsonb));
  select count(*)::integer into v_pending_count from public.match_invitations i
  where i.match_id = p_match_id and i.status = 'pending';
  if v_filled_count + v_pending_count >= 4 then raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_FULL'; end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots", '[]'::jsonb)) with ordinality s(value, ord)
    where case when coalesce(value->>'slotIndex','') ~ '^[0-3]$'
      then (value->>'slotIndex')::integer else (ord - 1)::integer end = p_slot_index
  ) then raise exception using errcode = '23505', message = 'INVITATION_SLOT_OCCUPIED'; end if;

  begin
    insert into public.match_invitations (match_id, invited_by, invited_user_id, slot_index)
    values (p_match_id, v_actor_id, p_invited_user_id, p_slot_index)
    returning * into v_created;
  exception when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'match_invitations_one_pending_player' then
      raise exception using errcode = '23505', message = 'INVITATION_ALREADY_PENDING';
    elsif v_constraint_name = 'match_invitations_one_pending_slot' then
      raise exception using errcode = '23505', message = 'INVITATION_SLOT_RESERVED';
    end if;
    raise;
  end;

  insert into public.notifications (
    recipient_id, type, match_id, invitation_id, title, body, data, dedupe_key
  ) values (
    p_invited_user_id,
    'match_invitation',
    p_match_id,
    v_created.id,
    'Приглашение в игру',
    pg_catalog.concat_ws(' · ', v_match."dateISO"::text, v_match.time, v_match."courtName"),
    pg_catalog.jsonb_build_object(
      'organizerId', v_match.owner_id,
      'dateISO', v_match."dateISO",
      'time', v_match.time,
      'courtId', v_match."courtId",
      'courtName', v_match."courtName",
      'type', v_match.type,
      'scenario', v_match.scenario,
      'isPrivate', v_match."isPrivate",
      'ratingMin', v_match."ratingMin",
      'ratingMax', v_match."ratingMax",
      'pricePerPerson', v_match."pricePerPerson"
    ),
    'match-invitation:' || v_created.id::text
  ) on conflict (recipient_id, dedupe_key) do nothing;

  return v_created;
end;
$$;

create or replace function public.decline_match_invitation(p_invitation_id uuid)
returns public.match_invitations
language plpgsql
security definer
set search_path = pg_catalog, public, prosto_padel_internal, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_match_id uuid;
  v_match public.matches;
  v_invitation public.match_invitations;
  v_updated public.match_invitations;
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'INVITATION_AUTH_REQUIRED'; end if;
  select i.match_id into v_match_id from public.match_invitations i where i.id = p_invitation_id;
  if not found then raise exception using errcode = 'P0001', message = 'INVITATION_NOT_FOUND'; end if;
  select * into v_match from public.matches m where m.id = v_match_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_NOT_FOUND'; end if;
  select * into v_invitation from public.match_invitations i
  where i.id = p_invitation_id and i.match_id = v_match_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'INVITATION_NOT_FOUND'; end if;
  if v_invitation.invited_user_id <> v_user_id then raise exception using errcode = '42501', message = 'INVITATION_RESPONSE_FORBIDDEN'; end if;
  if v_invitation.status <> 'pending' then raise exception using errcode = 'P0001', message = 'INVITATION_NOT_PENDING'; end if;
  update public.match_invitations set status = 'declined', responded_at = pg_catalog.now()
  where id = p_invitation_id returning * into v_updated;
  perform prosto_padel_internal.promote_match_waitlist(v_match_id);
  return v_updated;
end;
$$;

create or replace function public.cancel_match_invitation(p_invitation_id uuid)
returns public.match_invitations
language plpgsql
security definer
set search_path = pg_catalog, public, prosto_padel_internal, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_match_id uuid;
  v_match public.matches;
  v_invitation public.match_invitations;
  v_is_admin boolean;
  v_updated public.match_invitations;
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'INVITATION_AUTH_REQUIRED'; end if;
  select i.match_id into v_match_id from public.match_invitations i where i.id = p_invitation_id;
  if not found then raise exception using errcode = 'P0001', message = 'INVITATION_NOT_FOUND'; end if;
  select exists (select 1 from public.profiles p where p.id = v_user_id and p.role = 'admin') into v_is_admin;
  select * into v_match from public.matches m where m.id = v_match_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'INVITATION_MATCH_NOT_FOUND'; end if;
  select * into v_invitation from public.match_invitations i
  where i.id = p_invitation_id and i.match_id = v_match_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'INVITATION_NOT_FOUND'; end if;
  if v_match.owner_id <> v_user_id and not v_is_admin then raise exception using errcode = '42501', message = 'INVITATION_CANCEL_FORBIDDEN'; end if;
  if v_invitation.status <> 'pending' then raise exception using errcode = 'P0001', message = 'INVITATION_NOT_PENDING'; end if;
  update public.match_invitations set status = 'cancelled', responded_at = pg_catalog.now()
  where id = p_invitation_id returning * into v_updated;
  perform prosto_padel_internal.promote_match_waitlist(v_match_id);
  return v_updated;
end;
$$;

-- Compatible 008 join response. A user already in FIFO must wait for promotion.
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
  v_filled_count integer;
  v_pending_count integer;
  v_slot_index integer;
  v_new_slot jsonb;
  v_new_participants text[];
  v_start_at timestamp with time zone;
  v_updated public.matches;
begin
  if v_user_id is null then raise exception 'Authentication is required'; end if;
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if v_match.owner_id = v_user_id then raise exception 'Organizer cannot join own match through join_match'; end if;
  if v_match.type <> 'match' then raise exception 'Only match records can be joined'; end if;
  if coalesce(v_match."isPrivate", false) then raise exception 'Private matches cannot be joined through join_match'; end if;
  if v_match.status not in ('open','searching','upcoming','confirmed') then raise exception 'Match cannot be joined in current status'; end if;
  if v_match."dateISO" is not null then
    if coalesce(v_match.time,'') ~ '^\d{1,2}:\d{2}(:\d{2})?$' then
      v_start_at := (v_match."dateISO"::timestamp + v_match.time::time) at time zone current_setting('TimeZone');
    else v_start_at := v_match."dateISO"::timestamp at time zone current_setting('TimeZone'); end if;
    if v_start_at <= pg_catalog.now() then raise exception 'Match has already started'; end if;
  end if;
  if v_user_id::text = any(coalesce(v_match.participants,array[]::text[])) then raise exception 'User is already a participant'; end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots",'[]'::jsonb)) s(value) where value->>'id'=v_user_id::text) then raise exception 'User already has a slot'; end if;
  if exists (select 1 from public.match_invitations i where i.match_id=p_match_id and i.invited_user_id=v_user_id and i.status='pending') then raise exception 'User has a pending invitation; accept or decline it instead'; end if;
  if exists (select 1 from public.match_waitlist w where w.match_id=p_match_id and w.user_id=v_user_id and w.status='waiting') then raise exception 'User is in the waitlist; wait for promotion or leave the waitlist'; end if;
  if exists (select 1 from public.match_waitlist w where w.match_id=p_match_id and w.status='waiting') then raise exception 'Match has an active waitlist'; end if;
  select * into v_profile from public.profiles where id=v_user_id;
  if not found then raise exception 'Profile not found'; end if;
  v_rating_idx := case when v_profile.rating<=1.5 then 0 when v_profile.rating<=2.2 then 1
    when v_profile.rating<=3.2 then 2 when v_profile.rating<=5.0 then 3 when v_profile.rating<=6.5 then 4
    when v_profile.rating<=7.5 then 5 else 6 end;
  if v_rating_idx < v_match."ratingMin" or v_rating_idx > v_match."ratingMax" then raise exception 'Player rating is outside match range'; end if;
  v_filled_count := pg_catalog.jsonb_array_length(coalesce(v_match."filledSlots",'[]'::jsonb));
  select count(*)::integer into v_pending_count from public.match_invitations i where i.match_id=p_match_id and i.status='pending';
  if v_filled_count+v_pending_count>=4 then raise exception 'Match has no free slots'; end if;
  select candidate.slot_index into v_slot_index from pg_catalog.generate_series(0,3) candidate(slot_index)
  where not exists (
    select 1 from pg_catalog.jsonb_array_elements(coalesce(v_match."filledSlots",'[]'::jsonb)) with ordinality s(value,ord)
    where case when coalesce(value->>'slotIndex','') ~ '^[0-3]$' then (value->>'slotIndex')::integer else (ord-1)::integer end=candidate.slot_index
  ) and not exists (
    select 1 from public.match_invitations i where i.match_id=p_match_id and i.status='pending' and i.slot_index=candidate.slot_index
  ) order by candidate.slot_index limit 1;
  if v_slot_index is null then raise exception 'Match has no free slots'; end if;
  v_new_slot := pg_catalog.jsonb_build_object('id',v_user_id::text,'firstName',v_profile.first_name,
    'lastName',v_profile.last_name,'ratingIdx',v_rating_idx,'numericRating',v_profile.rating,
    'isVerified',v_profile.is_verified,'isOrganizer',false,'slotIndex',v_slot_index);
  select coalesce(pg_catalog.array_agg(participant_id order by ordinal_position),array[]::text[]) into v_new_participants
  from (select participant_id,min(ordinal_position) ordinal_position from (
    select participant_id,ordinal_position from pg_catalog.unnest(coalesce(v_match.participants,array[]::text[])) with ordinality p(participant_id,ordinal_position)
    union all select v_user_id::text,coalesce(pg_catalog.array_length(v_match.participants,1),0)+1
  ) x group by participant_id) d;
  update public.matches set
    "filledSlots"=coalesce(v_match."filledSlots",'[]'::jsonb)||pg_catalog.jsonb_build_array(v_new_slot),
    participants=v_new_participants,
    status=case when v_match.status='searching' then 'searching'
      when v_match.status='confirmed' then case when v_filled_count+1>=4 then 'confirmed' else 'open' end
      else case when v_filled_count+1>=4 then 'upcoming' else 'open' end end,
    updated_at=pg_catalog.now()
  where id=p_match_id returning * into v_updated;
  return v_updated;
end;
$$;

revoke all on function public.join_match_waitlist(uuid) from public, anon, authenticated;
revoke all on function public.leave_match_waitlist(uuid) from public, anon, authenticated;
revoke all on function public.get_my_match_waitlist_position(uuid) from public, anon, authenticated;
revoke all on function public.get_match_waitlist_count(uuid) from public, anon, authenticated;
revoke all on function public.get_my_notifications() from public, anon, authenticated;
revoke all on function public.get_unread_notification_count() from public, anon, authenticated;
revoke all on function public.mark_notification_read(uuid) from public, anon, authenticated;
revoke all on function public.mark_all_notifications_read() from public, anon, authenticated;
revoke all on function public.remove_match_participant(uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_match_invitation(uuid, uuid, smallint) from public, anon, authenticated;
revoke all on function public.decline_match_invitation(uuid) from public, anon, authenticated;
revoke all on function public.cancel_match_invitation(uuid) from public, anon, authenticated;
revoke all on function public.join_match(uuid) from public, anon, authenticated;

grant execute on function public.join_match_waitlist(uuid) to authenticated;
grant execute on function public.leave_match_waitlist(uuid) to authenticated;
grant execute on function public.get_my_match_waitlist_position(uuid) to authenticated;
grant execute on function public.get_match_waitlist_count(uuid) to authenticated;
grant execute on function public.get_my_notifications() to authenticated;
grant execute on function public.get_unread_notification_count() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.remove_match_participant(uuid, uuid) to authenticated;
grant execute on function public.create_match_invitation(uuid, uuid, smallint) to authenticated;
grant execute on function public.decline_match_invitation(uuid) to authenticated;
grant execute on function public.cancel_match_invitation(uuid) to authenticated;
grant execute on function public.join_match(uuid) to authenticated;

comment on function public.join_match_waitlist(uuid) is 'migration=009_match_waitlist_notifications; current user enters FIFO only when confirmed plus reserved capacity is full';
comment on function public.leave_match_waitlist(uuid) is 'migration=009_match_waitlist_notifications; current user atomically leaves own waiting row';
comment on function public.get_my_match_waitlist_position(uuid) is 'migration=009_match_waitlist_notifications; exposes only current user FIFO queue number';
comment on function public.get_match_waitlist_count(uuid) is 'migration=009_match_waitlist_notifications; safe count for a public match card';
comment on function public.get_my_notifications() is 'migration=009_match_waitlist_notifications; safe current-user notification feed';
comment on function public.get_unread_notification_count() is 'migration=009_match_waitlist_notifications; unread badge count for current user';
comment on function public.mark_notification_read(uuid) is 'migration=009_match_waitlist_notifications; current user marks one owned notification read';
comment on function public.mark_all_notifications_read() is 'migration=009_match_waitlist_notifications; current user marks all owned notifications read';
comment on function public.remove_match_participant(uuid, uuid) is 'migration=009_match_waitlist_notifications; organizer/admin removes one unpaid non-organizer participant then promotes FIFO';
comment on function public.create_match_invitation(uuid, uuid, smallint) is 'migration=009_match_waitlist_notifications;rollback=restore_008; 008-compatible invitation plus deduplicated notification';
comment on function public.decline_match_invitation(uuid) is 'migration=009_match_waitlist_notifications;rollback=restore_008; decline releases reservation then promotes FIFO';
comment on function public.cancel_match_invitation(uuid) is 'migration=009_match_waitlist_notifications;rollback=restore_008; organizer/admin cancellation releases reservation then promotes FIFO';
comment on function public.join_match(uuid) is 'migration=009_match_waitlist_notifications;rollback=restore_008; 008-compatible self-join that cannot bypass own waiting row';
-- CREATE OR REPLACE preserves the actual pre-009 owner, ACL and comment. The
-- exact previous definition is stored in the private migration state table.

commit;
