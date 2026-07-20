begin;

-- 001_security_and_atomic_join.sql
-- Local migration draft only. Do not run it before the mini-app switches from
-- direct profile/match mutations to the RPCs defined below.
-- This script does not drop tables, does not delete user data, and does not
-- rename existing columns or change existing column types.

-- Keep authenticated access explicit.
grant usage on schema public to authenticated;

-- Admin helper. This function intentionally derives admin status from auth.uid()
-- and the server-side profiles row, never from client input.
create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  );
$$;

revoke all on function public.current_user_is_admin() from public, anon;
grant execute on function public.current_user_is_admin() to authenticated;

-- Public profile view. It exposes only fields that are safe for player cards,
-- match rosters, ratings, and public discovery.
create or replace view public.player_public_profiles
with (security_invoker = true)
as
select
  id,
  first_name,
  last_name,
  username,
  photo_url,
  rating,
  is_verified,
  side_preference
from public.profiles;

revoke all on public.player_public_profiles from public, anon, authenticated;
grant select on public.player_public_profiles to authenticated;

-- Profile RLS and privileges. Authenticated users can read only public columns
-- directly. Full own/admin reads should go through RPCs below.
alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select (
  id,
  first_name,
  last_name,
  username,
  photo_url,
  rating,
  is_verified,
  side_preference
) on public.profiles to authenticated;
grant insert (
  id,
  email,
  first_name,
  last_name,
  phone,
  username,
  photo_url,
  side_preference,
  birthday,
  gender,
  language
) on public.profiles to authenticated;
grant update (
  first_name,
  last_name,
  phone,
  username,
  photo_url,
  side_preference,
  birthday,
  gender,
  language
) on public.profiles to authenticated;

drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_select_public_authenticated on public.profiles;
drop policy if exists profiles_select_own_or_admin on public.profiles;
drop policy if exists profiles_insert_own on public.profiles;
drop policy if exists profiles_update_own_or_admin on public.profiles;

create policy profiles_select_public_authenticated
on public.profiles
for select
to authenticated
using (auth.uid() is not null);

create policy profiles_insert_own
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy profiles_update_own_or_admin
on public.profiles
for update
to authenticated
using (id = auth.uid() or public.current_user_is_admin())
with check (id = auth.uid() or public.current_user_is_admin());

-- Guard profile updates at the row level. Normal users may update their own
-- editable profile fields only; role, rating, and is_verified stay server/admin
-- controlled even if a client obtains broader update privileges later.
create or replace function public.guard_profile_security_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if public.current_user_is_admin() then
    return new;
  end if;

  if old.id <> auth.uid() then
    raise exception 'Users can update only their own profile';
  end if;

  if new.role is distinct from old.role then
    raise exception 'Users cannot update role';
  end if;

  if new.rating is distinct from old.rating then
    raise exception 'Users cannot update rating';
  end if;

  if new.is_verified is distinct from old.is_verified then
    raise exception 'Users cannot update verification status';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_security_update on public.profiles;
create trigger profiles_guard_security_update
before update on public.profiles
for each row
execute function public.guard_profile_security_update();

revoke all on function public.guard_profile_security_update() from public, anon, authenticated;

-- Full own-profile read RPC. This replaces direct select('*') from profiles for
-- private columns such as phone, birthday, gender, email, and role.
create or replace function public.get_my_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.*
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

-- Own-profile update RPC for editable fields only. Null arguments mean "leave
-- unchanged"; a future version can accept jsonb to allow intentional nulling.
create or replace function public.update_my_profile(
  p_first_name text default null,
  p_last_name text default null,
  p_phone text default null,
  p_username text default null,
  p_photo_url text default null,
  p_side_preference text default null,
  p_birthday date default null,
  p_gender text default null,
  p_language text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  update public.profiles
  set
    first_name = coalesce(p_first_name, first_name),
    last_name = coalesce(p_last_name, last_name),
    phone = coalesce(p_phone, phone),
    username = coalesce(p_username, username),
    photo_url = coalesce(p_photo_url, photo_url),
    side_preference = coalesce(p_side_preference, side_preference),
    birthday = coalesce(p_birthday, birthday),
    gender = coalesce(p_gender, gender),
    language = coalesce(p_language, language)
  where id = auth.uid()
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found';
  end if;

  return v_profile;
end;
$$;

revoke all on function public.update_my_profile(
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text
) from public, anon;
grant execute on function public.update_my_profile(
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text
) to authenticated;

-- Admin full-profile read RPC. Client-provided roles are ignored; admin status
-- is checked by current_user_is_admin().
create or replace function public.admin_get_profiles()
returns setof public.profiles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.current_user_is_admin() then
    raise exception 'Admin access is required';
  end if;

  return query
  select p.*
  from public.profiles p
  order by p.created_at desc nulls last, p.id;
end;
$$;

revoke all on function public.admin_get_profiles() from public, anon;
grant execute on function public.admin_get_profiles() to authenticated;

-- Admin security-field update RPC for role, rating, and verification changes.
create or replace function public.admin_update_profile_security(
  p_profile_id uuid,
  p_role text default null,
  p_rating numeric default null,
  p_is_verified boolean default null
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
begin
  if not public.current_user_is_admin() then
    raise exception 'Admin access is required';
  end if;

  update public.profiles
  set
    role = coalesce(p_role, role),
    rating = coalesce(p_rating, rating),
    is_verified = coalesce(p_is_verified, is_verified)
  where id = p_profile_id
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found';
  end if;

  return v_profile;
end;
$$;

revoke all on function public.admin_update_profile_security(uuid, text, numeric, boolean) from public, anon;
grant execute on function public.admin_update_profile_security(uuid, text, numeric, boolean) to authenticated;

-- Match RLS. Public matches are readable by authenticated users. Private matches
-- and training records are readable only by owner, participant, or admin.
alter table public.matches enable row level security;

drop policy if exists matches_select_authenticated on public.matches;
drop policy if exists matches_select_public_member_or_admin on public.matches;
drop policy if exists matches_update_owner_participant_or_admin on public.matches;
drop policy if exists matches_update_owner_or_admin on public.matches;
drop policy if exists matches_insert_owner on public.matches;

create policy matches_select_public_member_or_admin
on public.matches
for select
to authenticated
using (
  auth.uid() is not null
  and (
    coalesce("isPrivate", false) = false
    or owner_id = auth.uid()
    or auth.uid()::text = any(coalesce(participants, array[]::text[]))
    or public.current_user_is_admin()
  )
);

create policy matches_insert_owner
on public.matches
for insert
to authenticated
with check (owner_id = auth.uid());

create policy matches_update_owner_or_admin
on public.matches
for update
to authenticated
using (owner_id = auth.uid() or public.current_user_is_admin())
with check (owner_id = auth.uid() or public.current_user_is_admin());

-- Table privileges for matches. Participants no longer receive general UPDATE
-- authority through RLS; join/leave must use the RPCs below.
revoke all on table public.matches from anon;
grant select, insert, update on table public.matches to authenticated;

-- Atomic open-match join. This function locks the match row, checks membership,
-- capacity, privacy, status, and rating bounds, then updates only participants.
-- It does not trust client-filled slots and does not accept a user id argument.
create or replace function public.join_open_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_match public.matches;
  v_user_rating numeric;
  v_participants text[];
  v_participant_count integer;
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

  if v_match.type <> 'match' then
    raise exception 'Only open matches can be joined';
  end if;

  if coalesce(v_match."isPrivate", false) then
    raise exception 'Private matches cannot be joined through this function';
  end if;

  if v_match.status not in ('open', 'searching', 'upcoming', 'confirmed') then
    raise exception 'Match is not joinable';
  end if;

  if v_match.owner_id = v_user_id then
    raise exception 'Owner cannot join own match';
  end if;

  v_participants := coalesce(v_match.participants, array[]::text[]);

  if v_user_id::text = any(v_participants) then
    raise exception 'User is already a participant';
  end if;

  v_participant_count := coalesce(array_length(v_participants, 1), 0);

  if v_participant_count >= 4 then
    raise exception 'Match is full';
  end if;

  select p.rating
  into v_user_rating
  from public.profiles p
  where p.id = v_user_id;

  if v_user_rating is null then
    raise exception 'Player rating is required';
  end if;

  if v_match."ratingMin" is not null and v_user_rating < v_match."ratingMin" then
    raise exception 'Player rating is below match range';
  end if;

  if v_match."ratingMax" is not null and v_user_rating > v_match."ratingMax" then
    raise exception 'Player rating is above match range';
  end if;

  v_participants := array_append(v_participants, v_user_id::text);

  update public.matches
  set
    participants = v_participants,
    status = case
      when coalesce(array_length(v_participants, 1), 0) >= 4 then 'upcoming'
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
$$;

revoke all on function public.join_open_match(uuid) from public, anon;
grant execute on function public.join_open_match(uuid) to authenticated;

-- Safe leave. A participant can remove only their own auth.uid() from the locked
-- match row. The owner cannot leave their own match through this RPC.
create or replace function public.leave_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke all on function public.leave_match(uuid) from public, anon;
grant execute on function public.leave_match(uuid) to authenticated;

-- Existing rating confirmation RPC is not removed, but public/anon execution is
-- revoked. TODO: replace it with a server-side rating function that calculates
-- changes from stored match result and validates owner/participants on server.
do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'confirm_rating_match_score'
  loop
    execute format('revoke execute on function %s from public', v_function.signature);
    execute format('revoke execute on function %s from anon', v_function.signature);
    execute format(
      'comment on function %s is %L',
      v_function.signature,
      'Unsafe for direct client use: accepts rating changes from the client. Keep public/anon revoked and replace with server-side rating calculation.'
    );
  end loop;
end $$;

commit;
