-- 010_match_waitlist_public_view_ROLLBACK.sql
-- Removes only the RPC created by migration 010. No table or user row is changed.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_target_count integer;
begin
  select count(*) into v_target_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_match_waitlist';

  if v_target_count <> 1
     or pg_catalog.to_regprocedure('public.get_match_waitlist(uuid)') is null then
    raise exception using
      errcode = 'P0001',
      message = 'ROLLBACK_PRECONDITION_FAILED: expected exactly migration 010 get_match_waitlist(uuid)';
  end if;

  if coalesce(pg_catalog.obj_description(
       pg_catalog.to_regprocedure('public.get_match_waitlist(uuid)')::oid,
       'pg_proc'
     ), '') not like 'migration=010_match_waitlist_public_view;%' then
    raise exception using
      errcode = 'P0001',
      message = 'ROLLBACK_PRECONDITION_FAILED: get_match_waitlist(uuid) is not owned by migration 010';
  end if;

  if pg_catalog.to_regclass('public.match_waitlist') is null
     or coalesce(pg_catalog.obj_description(
          'public.match_waitlist'::pg_catalog.regclass,
          'pg_class'
        ), '') not like 'migration=009_match_waitlist_notifications;%' then
    raise exception using
      errcode = 'P0001',
      message = 'ROLLBACK_PRECONDITION_FAILED: installed migration 009 waitlist is missing or differs';
  end if;
end;
$$;

drop function public.get_match_waitlist(uuid);

commit;
