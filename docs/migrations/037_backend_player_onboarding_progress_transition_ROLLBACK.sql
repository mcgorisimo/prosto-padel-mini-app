-- 037_backend_player_onboarding_progress_transition_ROLLBACK.sql
-- Restores the exact migration-035 transition definition while preserving the
-- migration-036 backend runtime ACL. Relations and persisted rows are unchanged.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preconditions$
declare
  v_expected record;
  v_function_oid oid :=
    pg_catalog.to_regprocedure(
      'backend_auth.guard_player_onboarding_state_transition()'
    )::oid;
  v_acl_count bigint;
  v_guard_definition text;
begin
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
     or pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'ROLLBACK_REFUSED: backend role boundary differs';
  end if;

  for v_expected in
    select *
    from (values
      (
        'backend_auth.player_profile_details',
        '035_backend_player_onboarding_foundation'
      ),
      (
        'backend_auth.player_onboarding_states',
        '035_backend_player_onboarding_foundation'
      ),
      (
        'backend_auth.account_consent_acceptances',
        '035_backend_player_onboarding_foundation'
      ),
      (
        'backend_auth.player_rating_states',
        '027_backend_admin_rating_state'
      )
    ) expected(relation_name, migration_name)
  loop
    if pg_catalog.to_regclass(v_expected.relation_name) is null
       or pg_catalog.obj_description(
         pg_catalog.to_regclass(v_expected.relation_name)::oid,
         'pg_class'
       ) is distinct from
         v_expected.migration_name || ':'
           || backend_auth.relation_fingerprint(
             pg_catalog.to_regclass(v_expected.relation_name)
           ) then
      raise exception 'ROLLBACK_REFUSED: % fingerprint differs from %',
        v_expected.relation_name,
        v_expected.migration_name;
    end if;
  end loop;

  if v_function_oid is null
     or pg_catalog.obj_description(
       v_function_oid,
       'pg_proc'
     ) is distinct from
       '037_backend_player_onboarding_progress_transition:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_function_oid)
         ) then
    raise exception 'ROLLBACK_REFUSED: migration-037 guard fingerprint differs';
  end if;

  select pg_catalog.count(*) into v_acl_count
  from pg_catalog.pg_proc procedure_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      procedure_row.proacl,
      pg_catalog.acldefault('f', procedure_row.proowner)
    )
  ) acl_row
  where procedure_row.oid = v_function_oid
    and acl_row.privilege_type = 'EXECUTE';

  if not pg_catalog.has_function_privilege(
       'backend_auth_app', v_function_oid, 'EXECUTE'
     )
     or v_acl_count <> 2
     or exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) acl_row
       where procedure_row.oid = v_function_oid
         and (
           acl_row.privilege_type <> 'EXECUTE'
           or acl_row.grantee not in (
             procedure_row.proowner,
             'backend_auth_app'::pg_catalog.regrole::oid
           )
           or (
             acl_row.grantee = 'backend_auth_app'::pg_catalog.regrole::oid
             and acl_row.is_grantable
           )
           or acl_row.grantor <> procedure_row.proowner
         )
     ) then
    raise exception 'ROLLBACK_REFUSED: exact migration-036 function ACL differs';
  end if;

  v_guard_definition := pg_catalog.pg_get_functiondef(v_function_oid);
  if pg_catalog.strpos(
       v_guard_definition,
       'old.current_step = ''profile'''
     ) = 0
     or pg_catalog.strpos(
       v_guard_definition,
       'new.current_step = ''consents'''
     ) = 0
     or pg_catalog.strpos(v_guard_definition, 'v_old_step smallint') <> 0 then
    raise exception 'ROLLBACK_REFUSED: transition matrix is not migration 037';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create or replace function backend_auth.guard_player_onboarding_state_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_old_step smallint;
  v_new_step smallint;
  v_contacts_ready boolean;
  v_consent_kind_count bigint;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'in_progress'
       or new.current_step <> 'profile'
       or new.survey_answers <> '{}'::pg_catalog.jsonb
       or new.revision <> 1
       or new.created_at <> new.updated_at
       or new.completed_at is not null then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_PLAYER_ONBOARDING_INSERT_INVALID';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_PLAYER_ONBOARDING_STATE_IMMUTABLE';
  end if;

  if new.account_id is distinct from old.account_id
     or new.flow_version is distinct from old.flow_version
     or new.survey_version is distinct from old.survey_version
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_PLAYER_ONBOARDING_IDENTITY_IMMUTABLE';
  end if;

  if old.status = 'completed' then
    raise exception using
      errcode = '55000',
      message = 'BACKEND_PLAYER_ONBOARDING_COMPLETED_IMMUTABLE';
  end if;

  if new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception using
      errcode = '40001',
      message = 'BACKEND_PLAYER_ONBOARDING_REVISION_CONFLICT';
  end if;

  v_old_step := pg_catalog.array_position(
    array[
      'profile',
      'contacts',
      'consents',
      'level_survey',
      'completed'
    ]::text[],
    old.current_step
  );
  v_new_step := pg_catalog.array_position(
    array[
      'profile',
      'contacts',
      'consents',
      'level_survey',
      'completed'
    ]::text[],
    new.current_step
  );

  if v_new_step < v_old_step or v_new_step > v_old_step + 1 then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_PLAYER_ONBOARDING_STEP_INVALID';
  end if;

  if new.status = 'completed' then
    if old.current_step <> 'level_survey'
       or new.current_step <> 'completed'
       or new.survey_answers = '{}'::pg_catalog.jsonb then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_PLAYER_ONBOARDING_COMPLETION_INVALID';
    end if;

    select exists (
      select 1
      from backend_auth.player_profile_details details
      where details.account_id = new.account_id
        and pg_catalog.btrim(details.first_name) <> ''
        and details.phone is not null
        and details.normalized_email is not null
    ) into v_contacts_ready;

    if not v_contacts_ready then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_PLAYER_ONBOARDING_CONTACTS_REQUIRED';
    end if;

    select pg_catalog.count(distinct acceptance.consent_kind)
      into v_consent_kind_count
    from backend_auth.account_consent_acceptances acceptance
    where acceptance.account_id = new.account_id
      and acceptance.flow_version = new.flow_version
      and acceptance.accepted_at between new.created_at and new.completed_at;

    if v_consent_kind_count <> 3 then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_PLAYER_ONBOARDING_CONSENTS_REQUIRED';
    end if;
  end if;

  return new;
end;
$function$;

do $comments$
declare
  v_function pg_catalog.regprocedure :=
    'backend_auth.guard_player_onboarding_state_transition()'::pg_catalog.regprocedure;
begin
  execute pg_catalog.format(
    'comment on function %s is %L',
    v_function,
    '035_backend_player_onboarding_foundation:'
      || pg_catalog.md5(
        pg_catalog.pg_get_functiondef(v_function::oid)
      )
  );
end;
$comments$;

revoke all on function
  backend_auth.guard_player_onboarding_state_transition()
from public;

grant execute on function
  backend_auth.guard_player_onboarding_state_transition()
to backend_auth_app;

do $assertions$
declare
  v_function_oid oid :=
    'backend_auth.guard_player_onboarding_state_transition()'::pg_catalog.regprocedure::oid;
  v_acl_count bigint;
  v_guard_definition text;
begin
  if pg_catalog.obj_description(v_function_oid, 'pg_proc') is distinct from
       '035_backend_player_onboarding_foundation:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_function_oid)
         ) then
    raise exception 'ROLLBACK_FAILED: migration-035 function fingerprint was not restored';
  end if;

  select pg_catalog.count(*) into v_acl_count
  from pg_catalog.pg_proc procedure_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      procedure_row.proacl,
      pg_catalog.acldefault('f', procedure_row.proowner)
    )
  ) acl_row
  where procedure_row.oid = v_function_oid
    and acl_row.privilege_type = 'EXECUTE';

  if not pg_catalog.has_function_privilege(
       'backend_auth_app', v_function_oid, 'EXECUTE'
     )
     or v_acl_count <> 2
     or exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) acl_row
       where procedure_row.oid = v_function_oid
         and (
           acl_row.privilege_type <> 'EXECUTE'
           or acl_row.grantee not in (
             procedure_row.proowner,
             'backend_auth_app'::pg_catalog.regrole::oid
           )
           or (
             acl_row.grantee = 'backend_auth_app'::pg_catalog.regrole::oid
             and acl_row.is_grantable
           )
           or acl_row.grantor <> procedure_row.proowner
         )
     ) then
    raise exception 'ROLLBACK_FAILED: migration-036 function ACL was not preserved';
  end if;

  v_guard_definition := pg_catalog.pg_get_functiondef(v_function_oid);
  if pg_catalog.strpos(v_guard_definition, 'v_old_step smallint') = 0
     or pg_catalog.strpos(v_guard_definition, 'v_new_step smallint') = 0
     or pg_catalog.strpos(
       v_guard_definition,
       'v_new_step > v_old_step + 1'
     ) = 0
     or pg_catalog.strpos(
       v_guard_definition,
       'BACKEND_PLAYER_ONBOARDING_PROGRESS_SURVEY_INVALID'
     ) <> 0 then
    raise exception 'ROLLBACK_FAILED: migration-035 transition matrix was not restored';
  end if;
end;
$assertions$;

reset role;
commit;

select
  '037_backend_player_onboarding_progress_transition rolled back to migration-035 definition with migration-036 ACL preserved'
  as result;
