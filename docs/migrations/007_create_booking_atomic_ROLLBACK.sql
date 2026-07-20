-- 007_create_booking_atomic_ROLLBACK.sql
-- Removes only objects owned by migration 007. Existing rows are not changed.
-- btree_gist is intentionally left installed because another object may use it.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_function_comment text;
  v_constraint_comment text;
  v_helper_comment text;
begin
  if pg_catalog.to_regprocedure('public.create_booking(jsonb)') is not null then
    select pg_catalog.obj_description(
      pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid,
      'pg_proc'
    ) into v_function_comment;

    if coalesce(v_function_comment, '') not like 'migration=007_create_booking_atomic;%' then
      raise exception 'ROLLBACK_ABORTED: public.create_booking(jsonb) is not owned by migration 007';
    end if;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_booking'
      and p.oid is distinct from pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
  ) then
    raise exception 'ROLLBACK_ABORTED: an extra public.create_booking overload exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.matches'::pg_catalog.regclass
      and c.conname = 'matches_no_active_court_overlap'
  ) then
    select pg_catalog.obj_description(c.oid, 'pg_constraint')
    into v_constraint_comment
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.matches'::pg_catalog.regclass
      and c.conname = 'matches_no_active_court_overlap';

    if coalesce(v_constraint_comment, '') not like 'migration=007_create_booking_atomic;%' then
      raise exception 'ROLLBACK_ABORTED: matches_no_active_court_overlap is not owned by migration 007';
    end if;
  end if;

  if pg_catalog.to_regprocedure('public.match_time_to_minutes(text)') is not null then
    select pg_catalog.obj_description(
      pg_catalog.to_regprocedure('public.match_time_to_minutes(text)')::oid,
      'pg_proc'
    ) into v_helper_comment;

    if coalesce(v_helper_comment, '') not like 'migration=007_create_booking_atomic;%' then
      raise exception 'ROLLBACK_ABORTED: public.match_time_to_minutes(text) is not owned by migration 007';
    end if;
  end if;
end;
$$;

drop function if exists public.create_booking(jsonb);

alter table public.matches
  drop constraint if exists matches_no_active_court_overlap;

drop function if exists public.match_time_to_minutes(text);

commit;
