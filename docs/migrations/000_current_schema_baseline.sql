begin;

-- 000_current_schema_baseline.sql
-- Reproducible empty schema baseline generated from:
-- mini-app/docs/supabase-schema-baseline.json
--
-- Scope: public.profiles, public.matches, public.messages and related public
-- functions, triggers, indexes, RLS policies, and constraints captured in the
-- baseline. This file does not copy user rows, match rows, or message rows.
--
-- Required Supabase/platform objects are not created here:
-- - auth.users
-- - Supabase roles such as anon/authenticated/service_role
-- - schemas excluded from baseline, including auth/extensions/storage/realtime

-- Extension dependency observed from baseline:
-- public pg_trgm functions/types and gin_trgm_ops indexes are present.
-- The baseline does not contain extension metadata, so this restores the
-- dependency at extension level instead of replaying extension-owned C functions.
create extension if not exists pg_trgm with schema public;

-- Core tables.
create table if not exists public.profiles (
  id uuid not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  first_name text not null,
  last_name text not null default ''::text,
  email text,
  phone text,
  username text,
  photo_url text,
  role text not null default 'user'::text,
  rating numeric(4,2) not null default 3.00,
  is_verified boolean not null default false,
  side_preference text,
  birthday date,
  gender text,
  language text default 'RU'::text
);

create table if not exists public.matches (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  "ownerId" uuid generated always as (owner_id) stored,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  date text,
  "dateISO" date,
  time text,
  duration numeric,
  "courtId" text,
  "courtName" text,
  "courtType" text,
  "isPrime" boolean not null default false,
  type text not null default 'match'::text,
  scenario text,
  title text,
  description text,
  status text not null default 'open'::text,
  "ratingMin" integer not null default 0,
  "ratingMax" integer not null default 6,
  players integer,
  "filledSlots" jsonb not null default '[]'::jsonb,
  participants text[] not null default '{}'::text[],
  "isPrivate" boolean not null default false,
  "paymentStatus" text,
  "syncToCalendar" boolean not null default false,
  "ownerPaid" numeric,
  "holdAmount" numeric,
  "pricePerPerson" numeric,
  "ownerName" text,
  "isBooked" boolean not null default false,
  "isTraining" boolean not null default false,
  "trainingDetails" jsonb,
  "trainingStatus" text,
  "completedAt" timestamp with time zone,
  "finalScore" jsonb,
  "isTeam1Win" boolean,
  team1 jsonb,
  team2 jsonb,
  "ratingChanges" jsonb,
  host jsonb,
  is_rating_match boolean not null default false,
  score_status text not null default 'none'::text,
  score_submitted_by uuid,
  score_confirmed_by uuid,
  score_disputed_by uuid
);

create table if not exists public.messages (
  id uuid not null default gen_random_uuid(),
  match_id uuid not null,
  "matchId" uuid generated always as (match_id) stored,
  sender_id uuid not null,
  "senderId" uuid generated always as (sender_id) stored,
  sender_name text not null,
  "senderName" text generated always as (sender_name) stored,
  "text" text not null,
  "timestamp" timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now()
);

-- Primary keys and constraints.
alter table public.profiles
  add constraint profiles_pkey primary key (id);

alter table public.profiles
  add constraint profiles_rating_check check (rating >= 0::numeric and rating <= 10::numeric);

alter table public.profiles
  add constraint profiles_role_check check (role = any (array['user'::text, 'admin'::text]));

alter table public.profiles
  add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;

alter table public.matches
  add constraint matches_pkey primary key (id);

alter table public.matches
  add constraint matches_duration_check check (duration is null or duration > 0::numeric);

alter table public.matches
  add constraint matches_rating_range_check check ("ratingMin" <= "ratingMax");

alter table public.matches
  add constraint matches_owner_id_fkey foreign key (owner_id) references public.profiles(id) on delete cascade;

alter table public.messages
  add constraint messages_pkey primary key (id);

alter table public.messages
  add constraint messages_match_id_fkey foreign key (match_id) references public.matches(id) on delete cascade;

alter table public.messages
  add constraint messages_sender_id_fkey foreign key (sender_id) references public.profiles(id) on delete cascade;

-- User-defined public functions from baseline.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$function$;

create or replace function public.confirm_rating_match_score(
  p_match_id uuid,
  p_confirmed_by uuid,
  p_rating_changes jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_match public.matches%rowtype;
  v_submitter_team int;
  v_confirmer_team int;
  v_player_id text;
  v_change jsonb;
begin
  if auth.uid() is null or auth.uid() <> p_confirmed_by then
    raise exception 'invalid confirmer' using errcode = '42501';
  end if;

  select * into v_match
  from public.matches
  where id = p_match_id
  for update;

  if not found or v_match.is_rating_match is not true then
    raise exception 'rated pending match not found';
  end if;

  if v_match.score_status <> 'pending_confirmation' then
    raise exception 'score is not pending confirmation';
  end if;

  select case
    when exists (
      select 1 from jsonb_array_elements(coalesce(v_match.team1, '[]'::jsonb)) p
      where p->>'id' = v_match.score_submitted_by::text
    ) then 1
    when exists (
      select 1 from jsonb_array_elements(coalesce(v_match.team2, '[]'::jsonb)) p
      where p->>'id' = v_match.score_submitted_by::text
    ) then 2
  end into v_submitter_team;

  select case
    when exists (
      select 1 from jsonb_array_elements(coalesce(v_match.team1, '[]'::jsonb)) p
      where p->>'id' = p_confirmed_by::text
    ) then 1
    when exists (
      select 1 from jsonb_array_elements(coalesce(v_match.team2, '[]'::jsonb)) p
      where p->>'id' = p_confirmed_by::text
    ) then 2
  end into v_confirmer_team;

  if v_submitter_team is null or v_confirmer_team is null or v_submitter_team = v_confirmer_team then
    raise exception 'confirmation must come from opposite team' using errcode = '42501';
  end if;

  for v_player_id, v_change in
    select key, value from jsonb_each(p_rating_changes)
  loop
    update public.profiles
    set rating = (v_change->>'after')::numeric
    where id::text = v_player_id;
  end loop;

  update public.matches
  set status = 'completed',
      score_status = 'confirmed',
      score_confirmed_by = p_confirmed_by,
      "completedAt" = now(),
      "ratingChanges" = p_rating_changes
  where id = p_match_id;
end;
$function$;

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table','partitioned table')
  loop
     if cmd.schema_name is not null and cmd.schema_name in ('public') and cmd.schema_name not in ('pg_catalog','information_schema') and cmd.schema_name not like 'pg_toast%' and cmd.schema_name not like 'pg_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception
        when others then
          raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
     else
        raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     end if;
  end loop;
end;
$function$;

-- Triggers from baseline.
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create trigger set_matches_updated_at
before update on public.matches
for each row
execute function public.set_updated_at();

-- Non-primary indexes from baseline.
create index if not exists profiles_first_name_trgm_idx
  on public.profiles using gin (lower(first_name) gin_trgm_ops);

create index if not exists profiles_last_name_trgm_idx
  on public.profiles using gin (lower(last_name) gin_trgm_ops);

create index if not exists matches_calendar_idx
  on public.matches using btree ("dateISO", "courtId", "time");

create index if not exists matches_created_at_idx
  on public.matches using btree (created_at desc);

create index if not exists matches_owner_id_idx
  on public.matches using btree (owner_id);

create index if not exists matches_participants_idx
  on public.matches using gin (participants);

create index if not exists matches_status_type_idx
  on public.matches using btree (status, type);

create index if not exists messages_match_timestamp_idx
  on public.messages using btree (match_id, "timestamp");

-- RLS status from baseline.
alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.messages enable row level security;

-- Existing policies from baseline.
create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check ((auth.uid() = id));

create policy profiles_select_authenticated
on public.profiles
for select
to authenticated
using (true);

create policy profiles_update_own_or_admin
on public.profiles
for update
to authenticated
using (((auth.uid() = id) or is_admin()))
with check (((auth.uid() = id) or is_admin()));

create policy matches_delete_owner_or_admin
on public.matches
for delete
to authenticated
using (((auth.uid() = owner_id) or is_admin()));

create policy matches_insert_own
on public.matches
for insert
to authenticated
with check ((auth.uid() = owner_id));

create policy matches_select_authenticated
on public.matches
for select
to authenticated
using (true);

create policy matches_update_owner_participant_or_admin
on public.matches
for update
to authenticated
using (((auth.uid() = owner_id) or ((auth.uid())::text = any (participants)) or is_admin()))
with check (((auth.uid() = owner_id) or ((auth.uid())::text = any (participants)) or is_admin()));

create policy players_can_join_open_public_matches
on public.matches
for update
to authenticated
using (
  (
    type = 'match'::text
    and coalesce("isPrivate", false) = false
    and status = any (array['open'::text, 'upcoming'::text, 'searching'::text, 'confirmed'::text])
  )
)
with check (
  (
    type = 'match'::text
    and coalesce("isPrivate", false) = false
    and status = any (array['open'::text, 'upcoming'::text, 'searching'::text, 'confirmed'::text])
    and ((auth.uid())::text = any (participants))
  )
);

create policy messages_insert_match_members
on public.messages
for insert
to authenticated
with check (
  (
    sender_id = auth.uid()
    and exists (
      select 1
      from public.matches m
      where m.id = messages.match_id
        and (
          m.owner_id = auth.uid()
          or (auth.uid())::text = any (m.participants)
          or is_admin()
        )
    )
  )
);

create policy messages_select_match_members
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.matches m
    where m.id = messages.match_id
      and (
        m.owner_id = auth.uid()
        or (auth.uid())::text = any (m.participants)
        or is_admin()
      )
  )
);

-- Grants/revokes are not recreated here because the baseline JSON does not
-- include ACL data for tables/functions/sequences. Supabase role grants must be
-- verified separately on the target staging project.

commit;
