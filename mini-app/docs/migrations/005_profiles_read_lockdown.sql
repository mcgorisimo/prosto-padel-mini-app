begin;

-- 005_profiles_read_lockdown.sql
-- Replace broad authenticated SELECT on profiles with own-row SELECT only.
-- Administrative reads must use public.admin_list_profiles.
-- Public player reads must use public.player_public_profiles.

drop policy profiles_select_authenticated on public.profiles;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using (auth.uid() = id);

commit;
