-- 002_match_leave_rpc_ROLLBACK.sql
-- Rollback for the additive leave_match RPC.
-- Does not delete tables or user data.

begin;

revoke all on function public.leave_match(uuid) from public, anon, authenticated;
drop function if exists public.leave_match(uuid);

commit;
