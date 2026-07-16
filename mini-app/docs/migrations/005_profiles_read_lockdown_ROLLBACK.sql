begin;

-- 005_profiles_read_lockdown_ROLLBACK.sql
-- Restore the previous broad authenticated profiles SELECT policy.
-- Does not change data, functions, views, grants, triggers, or other policies.

drop policy if exists profiles_select_own on public.profiles;

create policy profiles_select_authenticated
on public.profiles
for select
to authenticated
using (true);

commit;
