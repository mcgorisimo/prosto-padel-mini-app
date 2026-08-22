-- 037_backend_player_onboarding_progress_transition.sql
-- Aligns the backend-owned onboarding transition guard with the product-visible
-- profile -> consents -> level_survey flow. Relations and persisted rows remain
-- unchanged; exact consent document versions stay an application policy check.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preconditions$
declare
  v_expected record;
  v_function_oid oid;
  v_acl_count bigint;
  v_guard_definition text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null
     or not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
     or pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER')
     or pg_catalog.has_database_privilege(
       'backend_auth_app', pg_catalog.current_database(), 'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app', 'backend_auth', 'CREATE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend role boundary differs';
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
      raise exception 'MIGRATION_PRECONDITION_FAILED: % fingerprint differs from %',
        v_expected.relation_name,
        v_expected.migration_name;
    end if;
  end loop;

  for v_expected in
    select *
    from (values
      (
        'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)',
        'sql',
        'i'::text,
        true,
        'boolean'
      ),
      (
        'backend_auth.guard_player_onboarding_state_transition()',
        'plpgsql',
        'v'::text,
        false,
        'trigger'
      )
    ) expected(signature, language_name, volatility, is_strict, result_type)
  loop
    v_function_oid := pg_catalog.to_regprocedure(v_expected.signature)::oid;

    if v_function_oid is null
       or not exists (
         select 1
         from pg_catalog.pg_proc procedure_row
         join pg_catalog.pg_language language_row
           on language_row.oid = procedure_row.prolang
         where procedure_row.oid = v_function_oid
           and pg_catalog.pg_get_userbyid(procedure_row.proowner) =
             'backend_auth_owner'
           and procedure_row.prokind = 'f'
           and not procedure_row.prosecdef
           and not procedure_row.proleakproof
           and not procedure_row.proretset
           and procedure_row.provolatile::text = v_expected.volatility
           and procedure_row.proisstrict = v_expected.is_strict
           and procedure_row.proconfig is not distinct from
             array['search_path=pg_catalog, pg_temp']::text[]
           and language_row.lanname = v_expected.language_name
           and pg_catalog.pg_get_function_result(procedure_row.oid) =
             v_expected.result_type
           and pg_catalog.obj_description(
             procedure_row.oid,
             'pg_proc'
           ) = '035_backend_player_onboarding_foundation:'
             || pg_catalog.md5(
               pg_catalog.pg_get_functiondef(procedure_row.oid)
             )
       ) then
      raise exception 'MIGRATION_PRECONDITION_FAILED: migration-035 function fingerprint differs for %',
        v_expected.signature;
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
               acl_row.grantee =
                 'backend_auth_app'::pg_catalog.regrole::oid
               and acl_row.is_grantable
             )
             or acl_row.grantor <> procedure_row.proowner
           )
       ) then
      raise exception 'MIGRATION_PRECONDITION_FAILED: exact migration-036 function ACL differs for %',
        v_expected.signature;
    end if;
  end loop;

  v_guard_definition := pg_catalog.pg_get_functiondef(
    'backend_auth.guard_player_onboarding_state_transition()'::pg_catalog.regprocedure
  );

  if pg_catalog.strpos(v_guard_definition, 'v_old_step smallint') = 0
     or pg_catalog.strpos(v_guard_definition, 'v_new_step smallint') = 0
     or pg_catalog.strpos(
       v_guard_definition,
       'v_new_step > v_old_step + 1'
     ) = 0
     or pg_catalog.strpos(
       v_guard_definition,
       'BACKEND_PLAYER_ONBOARDING_STEP_INVALID'
     ) = 0 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: source transition matrix is not migration 035';
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

  if new.status = 'in_progress'
     and new.survey_answers <> '{}'::pg_catalog.jsonb then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_PLAYER_ONBOARDING_PROGRESS_SURVEY_INVALID';
  end if;

  if new.current_step = old.current_step then
    null;
  elsif old.current_step = 'profile'
        and new.current_step = 'consents'
        and new.status = 'in_progress' then
    null;
  elsif old.current_step = 'contacts'
        and new.current_step = 'consents'
        and new.status = 'in_progress' then
    null;
  elsif old.current_step = 'consents'
        and new.current_step = 'level_survey'
        and new.status = 'in_progress' then
    null;
  elsif old.current_step = 'level_survey'
        and new.current_step = 'completed'
        and new.status = 'completed' then
    null;
  else
    raise exception using
      errcode = '23514',
      message = 'BACKEND_PLAYER_ONBOARDING_STEP_INVALID';
  end if;

  if (
       new.current_step = 'consents'
       and old.current_step in ('profile', 'contacts')
     )
     or (
       old.current_step = 'consents'
       and new.current_step = 'level_survey'
     ) then
    select exists (
      select 1
      from backend_auth.player_profile_details details
      where details.account_id = new.account_id
        and pg_catalog.btrim(details.first_name) <> ''
        and details.phone ~ '^\+[1-9][0-9]{6,14}$'
        and details.normalized_email is not null
        and pg_catalog.btrim(details.normalized_email) =
          details.normalized_email
        and pg_catalog.lower(details.normalized_email) =
          details.normalized_email
    ) into v_contacts_ready;

    if not v_contacts_ready then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_PLAYER_ONBOARDING_CONTACTS_REQUIRED';
    end if;
  end if;

  if old.current_step = 'consents'
     and new.current_step = 'level_survey' then
    select pg_catalog.count(distinct acceptance.consent_kind)
      into v_consent_kind_count
    from backend_auth.account_consent_acceptances acceptance
    where acceptance.account_id = new.account_id
      and acceptance.flow_version = new.flow_version
      and acceptance.accepted_at between new.created_at and new.updated_at;

    if v_consent_kind_count <> 3 then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_PLAYER_ONBOARDING_CONSENTS_REQUIRED';
    end if;
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
    '037_backend_player_onboarding_progress_transition:'
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
  v_expected record;
begin
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
    if pg_catalog.obj_description(
         pg_catalog.to_regclass(v_expected.relation_name)::oid,
         'pg_class'
       ) is distinct from
         v_expected.migration_name || ':'
           || backend_auth.relation_fingerprint(
             pg_catalog.to_regclass(v_expected.relation_name)
           ) then
      raise exception 'MIGRATION_ASSERTION_FAILED: % relation fingerprint changed',
        v_expected.relation_name;
    end if;
  end loop;

  if pg_catalog.obj_description(v_function_oid, 'pg_proc') is distinct from
       '037_backend_player_onboarding_progress_transition:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_function_oid)
         ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: transition guard fingerprint differs';
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
    raise exception 'MIGRATION_ASSERTION_FAILED: transition guard ACL differs';
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
     or pg_catalog.strpos(
       v_guard_definition,
       'old.current_step = ''contacts'''
     ) = 0
     or pg_catalog.strpos(
       v_guard_definition,
       'new.current_step = ''level_survey'''
     ) = 0
     or pg_catalog.strpos(v_guard_definition, 'v_old_step smallint') <> 0
     or pg_catalog.strpos(v_guard_definition, 'v_new_step smallint') <> 0 then
    raise exception 'MIGRATION_ASSERTION_FAILED: transition matrix differs';
  end if;
end;
$assertions$;

reset role;
commit;

select
  '037_backend_player_onboarding_progress_transition applied; API wiring and runtime rollout remain separate'
  as result;
