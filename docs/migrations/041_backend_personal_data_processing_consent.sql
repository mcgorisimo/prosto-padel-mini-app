-- 041_backend_personal_data_processing_consent.sql
-- Adds a distinct personal-data-processing consent kind without rewriting
-- historical privacy evidence. Runtime wiring remains a separate gate.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_acceptance_oid oid := pg_catalog.to_regclass(
    'backend_auth.account_consent_acceptances'
  )::oid;
  v_state_oid oid := pg_catalog.to_regclass(
    'backend_auth.player_onboarding_states'
  )::oid;
  v_reassessment_oid oid := pg_catalog.to_regclass(
    'backend_auth.player_initial_level_reassessments'
  )::oid;
  v_guard_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.guard_player_onboarding_state_transition()'
  )::oid;
  v_immutable_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.reject_immutable_mutation()'
  )::oid;
  v_execute_acl_count bigint;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null
     or not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.pg_has_role(
       'backend_auth_app',
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.has_database_privilege(
       'backend_auth_app',
       pg_catalog.current_database(),
       'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend role boundary differs';
  end if;

  if v_acceptance_oid is null
     or pg_catalog.obj_description(v_acceptance_oid, 'pg_class') is distinct from
       '035_backend_player_onboarding_foundation:'
         || backend_auth.relation_fingerprint(
           v_acceptance_oid::pg_catalog.regclass
         ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: consent ledger differs from migration 035';
  end if;

  if v_state_oid is null
     or pg_catalog.obj_description(v_state_oid, 'pg_class') is distinct from
       '039_backend_player_onboarding_initial_level_result:'
         || backend_auth.relation_fingerprint(
           v_state_oid::pg_catalog.regclass
         ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: onboarding state differs from migration 039';
  end if;

  if v_reassessment_oid is null
     or pg_catalog.obj_description(v_reassessment_oid, 'pg_class') is distinct from
       '040_backend_player_initial_level_reassessment:'
         || backend_auth.relation_fingerprint(
           v_reassessment_oid::pg_catalog.regclass
         ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: reassessment evidence differs from migration 040';
  end if;

  if v_guard_oid is null
     or pg_catalog.obj_description(v_guard_oid, 'pg_proc') is distinct from
       '037_backend_player_onboarding_progress_transition:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_guard_oid)
         ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: transition guard differs from migration 037';
  end if;

  if v_immutable_oid is null
     or pg_catalog.obj_description(v_immutable_oid, 'pg_proc') is distinct from
       '015_backend_auth_foundation:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_immutable_oid)
         ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: immutable guard differs from migration 015';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_acceptance_oid
         and constraint_row.conname =
           'account_consent_acceptances_kind_check'
         and constraint_row.contype = 'c'
         and constraint_row.convalidated
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           '''terms'''
         ) > 0
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           '''privacy'''
         ) > 0
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           '''cancellation'''
         ) > 0
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           'personal_data_processing'
         ) = 0
     ) <> 1 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: three-kind consent constraint differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = v_acceptance_oid
         and not trigger_row.tgisinternal
         and trigger_row.tgname =
           'account_consent_acceptances_immutable_guard'
         -- pg_trigger.tgtype = ROW (1) | BEFORE (2) | DELETE (8) | UPDATE (16).
         and trigger_row.tgtype = 27
         and trigger_row.tgfoid = v_immutable_oid
         and trigger_row.tgenabled = 'O'
         and trigger_row.tgconstraint = 0
     ) <> 1 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: consent immutability trigger differs';
  end if;

  select pg_catalog.count(*) into v_execute_acl_count
  from pg_catalog.pg_proc procedure_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      procedure_row.proacl,
      pg_catalog.acldefault('f', procedure_row.proowner)
    )
  ) acl_row
  where procedure_row.oid = v_guard_oid
    and acl_row.privilege_type = 'EXECUTE';

  if not pg_catalog.has_function_privilege(
       'backend_auth_app',
       v_guard_oid,
       'EXECUTE'
     )
     or v_execute_acl_count <> 2
     or exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) acl_row
       where procedure_row.oid = v_guard_oid
         and (
           acl_row.privilege_type <> 'EXECUTE'
           or acl_row.grantee not in (
             procedure_row.proowner,
             'backend_auth_app'::pg_catalog.regrole::oid
           )
           or acl_row.grantor <> procedure_row.proowner
           or acl_row.is_grantable
         )
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: transition guard ACL differs';
  end if;

  if exists (
    select 1
    from backend_auth.account_consent_acceptances
    where consent_kind = 'personal_data_processing'
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: personal-data-processing evidence predates migration 041';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table
  backend_auth.player_onboarding_states,
  backend_auth.account_consent_acceptances
in access exclusive mode;

alter table backend_auth.account_consent_acceptances
  drop constraint account_consent_acceptances_kind_check,
  add constraint account_consent_acceptances_kind_check check (
    consent_kind = any (array[
      'terms',
      'privacy',
      'cancellation',
      'personal_data_processing'
    ]::text[])
  );

create or replace function backend_auth.guard_player_onboarding_state_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_contacts_ready boolean;
  v_consent_kinds text[];
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
    select coalesce(
      pg_catalog.array_agg(
        consent_set.consent_kind
        order by consent_set.consent_kind collate "C"
      ),
      array[]::text[]
    ) into v_consent_kinds
    from (
      select distinct acceptance.consent_kind
      from backend_auth.account_consent_acceptances acceptance
      where acceptance.account_id = new.account_id
        and acceptance.flow_version = new.flow_version
        and acceptance.accepted_at between
          new.created_at and new.updated_at
    ) consent_set;

    if v_consent_kinds is distinct from
         array['cancellation', 'privacy', 'terms']::text[]
       and v_consent_kinds is distinct from
         array['cancellation', 'personal_data_processing', 'terms']::text[]
       and v_consent_kinds is distinct from array[
         'cancellation',
         'personal_data_processing',
         'privacy',
         'terms'
       ]::text[] then
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

    select coalesce(
      pg_catalog.array_agg(
        consent_set.consent_kind
        order by consent_set.consent_kind collate "C"
      ),
      array[]::text[]
    ) into v_consent_kinds
    from (
      select distinct acceptance.consent_kind
      from backend_auth.account_consent_acceptances acceptance
      where acceptance.account_id = new.account_id
        and acceptance.flow_version = new.flow_version
        and acceptance.accepted_at between
          new.created_at and new.completed_at
    ) consent_set;

    if v_consent_kinds is distinct from
         array['cancellation', 'privacy', 'terms']::text[]
       and v_consent_kinds is distinct from
         array['cancellation', 'personal_data_processing', 'terms']::text[]
       and v_consent_kinds is distinct from array[
         'cancellation',
         'personal_data_processing',
         'privacy',
         'terms'
       ]::text[] then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_PLAYER_ONBOARDING_CONSENTS_REQUIRED';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function
  backend_auth.guard_player_onboarding_state_transition()
from public;

grant execute on function
  backend_auth.guard_player_onboarding_state_transition()
to backend_auth_app;

do $comments$
declare
  v_acceptance pg_catalog.regclass :=
    'backend_auth.account_consent_acceptances'::pg_catalog.regclass;
  v_guard pg_catalog.regprocedure :=
    'backend_auth.guard_player_onboarding_state_transition()'::pg_catalog.regprocedure;
begin
  execute pg_catalog.format(
    'comment on table %s is %L',
    v_acceptance,
    '041_backend_personal_data_processing_consent:'
      || backend_auth.relation_fingerprint(v_acceptance)
  );

  execute pg_catalog.format(
    'comment on function %s is %L',
    v_guard,
    '041_backend_personal_data_processing_consent:'
      || pg_catalog.md5(
        pg_catalog.pg_get_functiondef(v_guard::oid)
      )
  );
end;
$comments$;

do $assertions$
declare
  v_acceptance_oid oid :=
    'backend_auth.account_consent_acceptances'::pg_catalog.regclass::oid;
  v_state_oid oid :=
    'backend_auth.player_onboarding_states'::pg_catalog.regclass::oid;
  v_reassessment_oid oid :=
    'backend_auth.player_initial_level_reassessments'::pg_catalog.regclass::oid;
  v_guard_oid oid :=
    'backend_auth.guard_player_onboarding_state_transition()'::pg_catalog.regprocedure::oid;
  v_immutable_oid oid :=
    'backend_auth.reject_immutable_mutation()'::pg_catalog.regprocedure::oid;
  v_guard_definition text;
  v_column text;
  v_execute_acl_count bigint;
begin
  if pg_catalog.obj_description(v_acceptance_oid, 'pg_class') is distinct from
       '041_backend_personal_data_processing_consent:'
         || backend_auth.relation_fingerprint(
           v_acceptance_oid::pg_catalog.regclass
         ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: consent ledger fingerprint differs';
  end if;

  if pg_catalog.obj_description(v_state_oid, 'pg_class') is distinct from
       '039_backend_player_onboarding_initial_level_result:'
         || backend_auth.relation_fingerprint(
           v_state_oid::pg_catalog.regclass
         )
     or pg_catalog.obj_description(v_reassessment_oid, 'pg_class') is distinct from
       '040_backend_player_initial_level_reassessment:'
         || backend_auth.relation_fingerprint(
           v_reassessment_oid::pg_catalog.regclass
         ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: unrelated onboarding relation changed';
  end if;

  if pg_catalog.obj_description(v_guard_oid, 'pg_proc') is distinct from
       '041_backend_personal_data_processing_consent:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_guard_oid)
         ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: transition guard fingerprint differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_acceptance_oid
         and constraint_row.conname =
           'account_consent_acceptances_kind_check'
         and constraint_row.contype = 'c'
         and constraint_row.convalidated
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           '''terms'''
         ) > 0
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           '''privacy'''
         ) > 0
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           '''cancellation'''
         ) > 0
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           '''personal_data_processing'''
         ) > 0
     ) <> 1 then
    raise exception 'MIGRATION_ASSERTION_FAILED: four-kind consent constraint differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = v_acceptance_oid
         and not trigger_row.tgisinternal
         and trigger_row.tgname =
           'account_consent_acceptances_immutable_guard'
         -- pg_trigger.tgtype = ROW (1) | BEFORE (2) | DELETE (8) | UPDATE (16).
         and trigger_row.tgtype = 27
         and trigger_row.tgfoid = v_immutable_oid
         and trigger_row.tgenabled = 'O'
         and trigger_row.tgconstraint = 0
     ) <> 1 then
    raise exception 'MIGRATION_ASSERTION_FAILED: consent immutability trigger differs';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_acceptance_oid,
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_acceptance_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'public',
       v_acceptance_oid,
       'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: consent table ACL differs';
  end if;

  foreach v_column in array array[
    'account_id',
    'consent_kind',
    'document_version',
    'flow_version',
    'accepted_at'
  ]::text[] loop
    if not pg_catalog.has_column_privilege(
      'backend_auth_app',
      v_acceptance_oid,
      v_column,
      'INSERT'
    )
       or pg_catalog.has_column_privilege(
         'backend_auth_app',
         v_acceptance_oid,
         v_column,
         'UPDATE'
       ) then
      raise exception 'MIGRATION_ASSERTION_FAILED: consent column ACL differs for %',
        v_column;
    end if;
  end loop;

  select pg_catalog.count(*) into v_execute_acl_count
  from pg_catalog.pg_proc procedure_row
  cross join lateral pg_catalog.aclexplode(
    coalesce(
      procedure_row.proacl,
      pg_catalog.acldefault('f', procedure_row.proowner)
    )
  ) acl_row
  where procedure_row.oid = v_guard_oid
    and acl_row.privilege_type = 'EXECUTE';

  if not pg_catalog.has_function_privilege(
       'backend_auth_app',
       v_guard_oid,
       'EXECUTE'
     )
     or v_execute_acl_count <> 2
     or exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) acl_row
       where procedure_row.oid = v_guard_oid
         and (
           acl_row.privilege_type <> 'EXECUTE'
           or acl_row.grantee not in (
             procedure_row.proowner,
             'backend_auth_app'::pg_catalog.regrole::oid
           )
           or acl_row.grantor <> procedure_row.proowner
           or acl_row.is_grantable
         )
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: transition guard ACL differs';
  end if;

  v_guard_definition := pg_catalog.pg_get_functiondef(v_guard_oid);
  if pg_catalog.strpos(v_guard_definition, 'v_consent_kinds text[]') = 0
     or pg_catalog.strpos(
       v_guard_definition,
       'personal_data_processing'
     ) = 0
     or pg_catalog.strpos(
       v_guard_definition,
       'BACKEND_PLAYER_ONBOARDING_CONSENTS_REQUIRED'
     ) = 0
     or pg_catalog.strpos(
       v_guard_definition,
       'v_consent_kind_count'
     ) <> 0 then
    raise exception 'MIGRATION_ASSERTION_FAILED: compatible consent guard differs';
  end if;

  if exists (
    select 1
    from backend_auth.account_consent_acceptances
    where consent_kind = 'personal_data_processing'
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: new consent evidence appeared during migration';
  end if;
end;
$assertions$;

reset role;
commit;

select
  '041_backend_personal_data_processing_consent applied; runtime wiring remains separate'
  as result;
