-- 039_backend_player_onboarding_initial_level_result_ROLLBACK.sql
-- Safe only before any initial_level_v2 state or computed result exists.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_state_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_onboarding_states')::oid;
  v_guard_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.guard_player_onboarding_state_transition()'
  )::oid;
begin
  if v_state_oid is null
     or pg_catalog.obj_description(v_state_oid, 'pg_class') is distinct from
       '039_backend_player_onboarding_initial_level_result:'
         || backend_auth.relation_fingerprint(
           v_state_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: onboarding state relation differs from migration 039';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_attribute attribute
       where attribute.attrelid = v_state_oid
         and attribute.attname in (
           'initial_level_score',
           'initial_level_label'
         )
         and not attribute.attisdropped
     ) <> 2
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_state_oid
         and constraint_row.conname in (
           'player_onboarding_states_initial_level_score_check',
           'player_onboarding_states_initial_level_label_check',
           'player_onboarding_states_initial_level_result_check'
         )
     ) <> 3 then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 039 catalog differs';
  end if;

  if v_guard_oid is null
     or pg_catalog.obj_description(v_guard_oid, 'pg_proc') is distinct from
       '037_backend_player_onboarding_progress_transition:'
         || pg_catalog.md5(pg_catalog.pg_get_functiondef(v_guard_oid))
     or not pg_catalog.has_function_privilege(
       'backend_auth_app',
       v_guard_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege('public', v_guard_oid, 'EXECUTE') then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration-037 transition guard differs';
  end if;

  if exists (
    select 1
    from backend_auth.player_onboarding_states state
    where state.survey_version = 'initial_level_v2'
  ) then
    raise exception 'ROLLBACK_BLOCKED: initial_level_v2 onboarding data exists; use a forward migration';
  end if;

  if exists (
    select 1
    from backend_auth.player_onboarding_states state
    where state.initial_level_score is not null
       or state.initial_level_label is not null
  ) then
    raise exception 'ROLLBACK_BLOCKED: computed initial-level data exists; use a forward migration';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

revoke update (
  initial_level_score,
  initial_level_label
) on backend_auth.player_onboarding_states from public, backend_auth_app;

alter table backend_auth.player_onboarding_states
  drop constraint player_onboarding_states_initial_level_result_check,
  drop constraint player_onboarding_states_initial_level_label_check,
  drop constraint player_onboarding_states_initial_level_score_check,
  drop column initial_level_label,
  drop column initial_level_score;

do $restore_comment$
declare
  v_state_oid oid :=
    'backend_auth.player_onboarding_states'::pg_catalog.regclass::oid;
begin
  execute pg_catalog.format(
    'comment on table %s is %L',
    v_state_oid::pg_catalog.regclass,
    '035_backend_player_onboarding_foundation:'
      || backend_auth.relation_fingerprint(
        v_state_oid::pg_catalog.regclass
      )
  );
end;
$restore_comment$;

do $assertions$
declare
  v_state_oid oid :=
    'backend_auth.player_onboarding_states'::pg_catalog.regclass::oid;
  v_guard_oid oid :=
    'backend_auth.guard_player_onboarding_state_transition()'::pg_catalog.regprocedure::oid;
begin
  if pg_catalog.obj_description(v_state_oid, 'pg_class') is distinct from
       '035_backend_player_onboarding_foundation:'
         || backend_auth.relation_fingerprint(
           v_state_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration-035 relation fingerprint was not restored';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = v_state_oid
      and attribute.attname in (
        'initial_level_score',
        'initial_level_label'
      )
      and not attribute.attisdropped
  )
     or exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_state_oid
         and constraint_row.conname in (
           'player_onboarding_states_initial_level_score_check',
           'player_onboarding_states_initial_level_label_check',
           'player_onboarding_states_initial_level_result_check'
         )
     ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 039 objects remain';
  end if;

  if pg_catalog.obj_description(v_guard_oid, 'pg_proc') is distinct from
       '037_backend_player_onboarding_progress_transition:'
         || pg_catalog.md5(pg_catalog.pg_get_functiondef(v_guard_oid))
     or not pg_catalog.has_function_privilege(
       'backend_auth_app',
       v_guard_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege('public', v_guard_oid, 'EXECUTE') then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration-037 transition guard changed';
  end if;
end;
$assertions$;

reset role;
commit;

select
  '039_backend_player_onboarding_initial_level_result rolled back before runtime use'
  as result;
