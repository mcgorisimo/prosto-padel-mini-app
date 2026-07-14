begin;

-- 004_profiles_read_api_ROLLBACK.sql
-- Roll back only the additive admin read RPC. Does not change profiles,
-- player_public_profiles, data, RLS policies, or grants on existing objects.

drop function if exists public.admin_list_profiles(text, text);

commit;
