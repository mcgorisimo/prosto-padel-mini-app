-- 003_match_join_rpc_ROLLBACK.sql
-- Rollback for the additive join_match RPC.
-- Does not delete tables or user data.

begin;

revoke all on function public.join_match(uuid) from public, anon, authenticated;
drop function if exists public.join_match(uuid);

commit;
