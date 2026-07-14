begin;

-- 001_profiles_security_additive.sql
-- Additive profiles security stage.
-- This file is intended for staging review before any production use.
-- It does not change existing column types, does not remove user data, does not
-- touch matches/messages, and does not change existing profiles RLS policies.

-- Keep schema access explicit for authenticated RPC calls and the public view.
grant usage on schema public to authenticated;

-- Helper for privileged maintenance contexts. Normal clients cannot become
-- privileged by passing role values in profile rows; this uses JWT role and the
-- original session_user, not current_user inside SECURITY DEFINER execution.
create or replace function public.profiles_security_is_privileged()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(auth.role(), '') = 'service_role'
    or session_user in ('postgres', 'service_role', 'supabase_admin');
$$;

revoke all on function public.profiles_security_is_privileged() from public, anon, authenticated;

-- Public player profile view. This intentionally avoids security_invoker because
-- the baseline does not include PostgreSQL version information. The view exposes
-- only non-private columns and does not depend on version-specific view options.
create or replace view public.player_public_profiles
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

revoke all on table public.player_public_profiles from public, anon, authenticated;
grant select on table public.player_public_profiles to authenticated;

comment on view public.player_public_profiles is
  'Safe public profile projection for player search, match rosters, and ratings. Private profile fields are intentionally excluded.';

-- BEFORE INSERT guard. Existing AuthGate can still pass role/is_verified; for
-- normal authenticated users those values are ignored and normalized.
create or replace function public.profiles_security_guard_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.profiles_security_is_privileged() then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Authentication is required to create a profile';
  end if;

  if new.id is distinct from auth.uid() then
    raise exception 'Profile id must match the authenticated user';
  end if;

  new.role := 'user';
  new.is_verified := false;
  new.rating := coalesce(new.rating, 3.00);

  return new;
end;
$$;

revoke all on function public.profiles_security_guard_insert() from public, anon, authenticated;

drop trigger if exists profiles_security_guard_insert on public.profiles;
create trigger profiles_security_guard_insert
before insert on public.profiles
for each row
execute function public.profiles_security_guard_insert();

-- BEFORE UPDATE guard. To reduce frontend breakage, protected values are restored
-- to OLD values instead of raising when a normal user submits extra fields.
create or replace function public.profiles_security_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.profiles_security_is_privileged() then
    return new;
  end if;

  if auth.uid() is null then
    raise exception 'Authentication is required to update a profile';
  end if;

  if current_setting('app.profiles_security_admin_rpc', true) = 'on'
     and public.is_admin() then
    return new;
  end if;

  if old.id is distinct from auth.uid() then
    raise exception 'Users can update only their own profile';
  end if;

  new.id := old.id;
  new.created_at := old.created_at;
  new.role := old.role;
  new.rating := old.rating;
  new.is_verified := old.is_verified;

  return new;
end;
$$;

revoke all on function public.profiles_security_guard_update() from public, anon, authenticated;

drop trigger if exists profiles_security_guard_update on public.profiles;
create trigger profiles_security_guard_update
before update on public.profiles
for each row
execute function public.profiles_security_guard_update();

-- Full own profile read. The function does not accept a user id and returns only
-- the row that belongs to auth.uid().
create or replace function public.get_my_profile()
returns public.profiles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select p.*
  into v_profile
  from public.profiles p
  where p.id = auth.uid();

  if not found then
    raise exception 'Profile not found';
  end if;

  return v_profile;
end;
$$;

revoke all on function public.get_my_profile() from public, anon;
grant execute on function public.get_my_profile() to authenticated;

-- Own profile update. The function does not accept a user id and cannot change
-- role, rating, is_verified, id, or created_at.
create or replace function public.update_my_profile(
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_username text,
  p_photo_url text,
  p_side_preference text,
  p_birthday date,
  p_gender text,
  p_language text
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

-- Admin-only protected profile update. Admin status is checked through the
-- existing public.is_admin() function, which reads the database row for auth.uid().
create or replace function public.admin_update_profile_security(
  p_profile_id uuid,
  p_role text,
  p_rating numeric,
  p_is_verified boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_profile public.profiles;
  v_profile public.profiles;
  v_next_role text;
  v_next_rating numeric;
  v_next_is_verified boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if not public.is_admin() then
    raise exception 'Admin access is required';
  end if;

  if p_role is not null and p_role not in ('user', 'admin') then
    raise exception 'Invalid role';
  end if;

  if p_rating is not null and (p_rating < 0 or p_rating > 10) then
    raise exception 'Rating must be between 0 and 10';
  end if;

  lock table public.profiles in share row exclusive mode;

  select p.*
  into v_old_profile
  from public.profiles p
  where p.id = p_profile_id
  for update;

  if not found then
    raise exception 'Profile not found';
  end if;

  v_next_role := coalesce(p_role, v_old_profile.role);
  v_next_rating := coalesce(p_rating, v_old_profile.rating);
  v_next_is_verified := coalesce(p_is_verified, v_old_profile.is_verified);

  if v_old_profile.role = 'admin'
     and v_next_role <> 'admin'
     and not exists (
       select 1
       from public.profiles p
       where p.role = 'admin'
         and p.id <> p_profile_id
     ) then
    raise exception 'Cannot remove the last admin';
  end if;

  perform set_config('app.profiles_security_admin_rpc', 'on', true);

  update public.profiles
  set
    role = v_next_role,
    rating = v_next_rating,
    is_verified = v_next_is_verified
  where id = p_profile_id
  returning * into v_profile;

  perform set_config('app.profiles_security_admin_rpc', 'off', true);

  return v_profile;
end;
$$;

revoke all on function public.admin_update_profile_security(uuid, text, numeric, boolean) from public, anon;
grant execute on function public.admin_update_profile_security(uuid, text, numeric, boolean) to authenticated;

comment on function public.admin_update_profile_security(uuid, text, numeric, boolean) is
  'Admin-only RPC for role, rating, and verification updates. Admin status is derived from auth.uid() via public.is_admin().';

commit;
