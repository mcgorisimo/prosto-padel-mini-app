-- 040_backend_player_initial_level_reassessment_ROLLBACK.sql
-- Safe only before any immutable reassessment evidence exists.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_state_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_onboarding_states')::oid;
  v_rating_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_rating_states')::oid;
  v_relation_oid oid := pg_catalog.to_regclass(
    'backend_auth.player_initial_level_reassessments'
  )::oid;
  v_function_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.guard_player_initial_level_reassessment_insert()'
  )::oid;
begin
  if v_state_oid is null
     or pg_catalog.obj_description(v_state_oid, 'pg_class') is distinct from
       '039_backend_player_onboarding_initial_level_result:'
         || backend_auth.relation_fingerprint(
           v_state_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: onboarding state differs from migration 039';
  end if;

  if v_rating_oid is null
     or pg_catalog.obj_description(v_rating_oid, 'pg_class') is distinct from
       '027_backend_admin_rating_state:'
         || backend_auth.relation_fingerprint(
           v_rating_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: rating state differs from migration 027';
  end if;

  if v_relation_oid is null
     or pg_catalog.obj_description(
       v_relation_oid,
       'pg_class'
     ) is distinct from
       '040_backend_player_initial_level_reassessment:'
         || backend_auth.relation_fingerprint(
           v_relation_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 040 relation differs';
  end if;

  if v_function_oid is null
     or pg_catalog.obj_description(
       v_function_oid,
       'pg_proc'
     ) is distinct from
       '040_backend_player_initial_level_reassessment:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_function_oid)
         ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 040 function differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = v_relation_oid
         and not trigger_row.tgisinternal
         and trigger_row.tgname in (
           'player_initial_level_reassessments_insert_guard',
           'player_initial_level_reassessments_immutable_guard'
         )
     ) <> 2 then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 040 triggers differ';
  end if;

  if exists (
    select 1
    from backend_auth.player_initial_level_reassessments
  ) then
    raise exception 'ROLLBACK_BLOCKED: immutable reassessment evidence exists; use a forward migration';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table backend_auth.player_initial_level_reassessments
  in access exclusive mode;

do $locked_preconditions$
begin
  if exists (
    select 1
    from backend_auth.player_initial_level_reassessments
  ) then
    raise exception 'ROLLBACK_BLOCKED: immutable reassessment evidence appeared while locking; use a forward migration';
  end if;
end;
$locked_preconditions$;

drop trigger player_initial_level_reassessments_immutable_guard
  on backend_auth.player_initial_level_reassessments;
drop trigger player_initial_level_reassessments_insert_guard
  on backend_auth.player_initial_level_reassessments;
drop table backend_auth.player_initial_level_reassessments;
drop function backend_auth.guard_player_initial_level_reassessment_insert();

do $assertions$
declare
  v_state_oid oid :=
    'backend_auth.player_onboarding_states'::pg_catalog.regclass::oid;
  v_rating_oid oid :=
    'backend_auth.player_rating_states'::pg_catalog.regclass::oid;
begin
  if pg_catalog.to_regclass(
       'backend_auth.player_initial_level_reassessments'
     ) is not null
     or pg_catalog.to_regprocedure(
       'backend_auth.guard_player_initial_level_reassessment_insert()'
     ) is not null then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 040 objects remain';
  end if;

  if pg_catalog.obj_description(v_state_oid, 'pg_class') is distinct from
       '039_backend_player_onboarding_initial_level_result:'
         || backend_auth.relation_fingerprint(
           v_state_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: onboarding state changed';
  end if;

  if pg_catalog.obj_description(v_rating_oid, 'pg_class') is distinct from
       '027_backend_admin_rating_state:'
         || backend_auth.relation_fingerprint(
           v_rating_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: rating state changed';
  end if;
end;
$assertions$;

reset role;
commit;

select
  '040_backend_player_initial_level_reassessment rolled back before evidence use'
  as result;
