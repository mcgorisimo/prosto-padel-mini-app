begin;

-- 001_profiles_security_additive_ROLLBACK.sql
-- Rollback for 001_profiles_security_additive.sql.
-- This rollback does not drop tables and does not delete user data. It removes
-- only the additive view, triggers, and functions created by this stage.

-- Remove trigger bindings first so trigger functions can be dropped safely.
drop trigger if exists profiles_security_guard_insert on public.profiles;
drop trigger if exists profiles_security_guard_update on public.profiles;

-- Drop additive RPCs and trigger/helper functions.
drop function if exists public.admin_update_profile_security(uuid, text, numeric, boolean);
drop function if exists public.update_my_profile(
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  text,
  text
);
drop function if exists public.get_my_profile();
drop function if exists public.profiles_security_guard_update();
drop function if exists public.profiles_security_guard_insert();
drop function if exists public.profiles_security_is_privileged();

-- Drop additive public projection view. This does not delete profile rows.
drop view if exists public.player_public_profiles;

commit;
