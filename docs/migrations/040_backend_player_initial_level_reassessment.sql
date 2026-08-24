-- 040_backend_player_initial_level_reassessment.sql
-- Adds separate immutable evidence for one initial_level_v2 reassessment of a
-- completed initial_level_v1 onboarding. The source onboarding row is unchanged.

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
  v_answer_codes_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)'
  )::oid;
  v_transition_guard_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.guard_player_onboarding_state_transition()'
  )::oid;
  v_immutable_guard_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.reject_immutable_mutation()'
  )::oid;
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

  if v_state_oid is null
     or pg_catalog.obj_description(v_state_oid, 'pg_class') is distinct from
       '039_backend_player_onboarding_initial_level_result:'
         || backend_auth.relation_fingerprint(
           v_state_oid::pg_catalog.regclass
         ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: onboarding state differs from migration 039';
  end if;

  if v_rating_oid is null
     or pg_catalog.obj_description(v_rating_oid, 'pg_class') is distinct from
       '027_backend_admin_rating_state:'
         || backend_auth.relation_fingerprint(
           v_rating_oid::pg_catalog.regclass
         ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: rating state differs from migration 027';
  end if;

  if v_answer_codes_oid is null
     or pg_catalog.obj_description(
       v_answer_codes_oid,
       'pg_proc'
     ) is distinct from
       '035_backend_player_onboarding_foundation:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_answer_codes_oid)
         )
     or not pg_catalog.has_function_privilege(
       'backend_auth_app',
       v_answer_codes_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'public',
       v_answer_codes_oid,
       'EXECUTE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: survey answer validator differs from migrations 035/036';
  end if;

  if v_transition_guard_oid is null
     or pg_catalog.obj_description(
       v_transition_guard_oid,
       'pg_proc'
     ) is distinct from
       '037_backend_player_onboarding_progress_transition:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_transition_guard_oid)
         )
     or not pg_catalog.has_function_privilege(
       'backend_auth_app',
       v_transition_guard_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'public',
       v_transition_guard_oid,
       'EXECUTE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: transition guard differs from migrations 037/036';
  end if;

  if v_immutable_guard_oid is null
     or pg_catalog.obj_description(
       v_immutable_guard_oid,
       'pg_proc'
     ) is distinct from
       '015_backend_auth_foundation:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_immutable_guard_oid)
         )
     or pg_catalog.has_function_privilege(
       'backend_auth_app',
       v_immutable_guard_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'public',
       v_immutable_guard_oid,
       'EXECUTE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: immutable guard differs from migration 015';
  end if;

  if pg_catalog.to_regclass(
       'backend_auth.player_initial_level_reassessments'
     ) is not null
     or pg_catalog.to_regprocedure(
       'backend_auth.guard_player_initial_level_reassessment_insert()'
     ) is not null then
    raise exception 'MIGRATION_CONFLICT: migration 040 target already exists';
  end if;
end;
$preconditions$;

do $function_security_boundary$
declare
  v_expected record;
  v_function_oid oid;
  v_execute_acl_count bigint;
begin
  for v_expected in
    select *
    from (values
      (
        'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)',
        '035_backend_player_onboarding_foundation',
        'sql',
        'i'::text,
        true,
        'boolean',
        true,
        2::bigint
      ),
      (
        'backend_auth.guard_player_onboarding_state_transition()',
        '037_backend_player_onboarding_progress_transition',
        'plpgsql',
        'v'::text,
        false,
        'trigger',
        true,
        2::bigint
      ),
      (
        'backend_auth.reject_immutable_mutation()',
        '015_backend_auth_foundation',
        'plpgsql',
        'v'::text,
        false,
        'trigger',
        false,
        1::bigint
      )
    ) expected(
      signature,
      migration_name,
      language_name,
      volatility,
      is_strict,
      result_type,
      app_execute,
      expected_acl_count
    )
  loop
    v_function_oid :=
      pg_catalog.to_regprocedure(v_expected.signature)::oid;

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
           ) = v_expected.migration_name || ':'
             || pg_catalog.md5(
               pg_catalog.pg_get_functiondef(procedure_row.oid)
             )
       ) then
      raise exception 'MIGRATION_PRECONDITION_FAILED: function boundary differs for %',
        v_expected.signature;
    end if;

    select pg_catalog.count(*) into v_execute_acl_count
    from pg_catalog.pg_proc procedure_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) acl_row
    where procedure_row.oid = v_function_oid
      and acl_row.privilege_type = 'EXECUTE';

    if v_execute_acl_count <> v_expected.expected_acl_count
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
             or acl_row.grantor <> procedure_row.proowner
             or acl_row.grantee not in (
               procedure_row.proowner,
               case
                 when v_expected.app_execute then
                   'backend_auth_app'::pg_catalog.regrole::oid
                 else procedure_row.proowner
               end
             )
             or acl_row.is_grantable
           )
       ) then
      raise exception 'MIGRATION_PRECONDITION_FAILED: exact function ACL differs for %',
        v_expected.signature;
    end if;
  end loop;
end;
$function_security_boundary$;

set local role backend_auth_owner;

create table backend_auth.player_initial_level_reassessments (
  account_id uuid not null,
  source_flow_version text not null,
  source_survey_version text not null,
  source_revision bigint not null,
  survey_version text not null,
  survey_answers jsonb not null,
  initial_level_score smallint not null,
  initial_level_label text not null,
  completed_at bigint not null,
  constraint player_initial_level_reassessments_pkey
    primary key (account_id),
  constraint player_initial_level_reassessments_account_id_fkey
    foreign key (account_id)
    references backend_auth.player_onboarding_states (account_id)
    on update no action on delete no action not deferrable,
  constraint player_initial_level_reassessments_source_check check (
    source_flow_version ~ '^[a-z][a-z0-9_.-]{0,63}$'
    and source_survey_version = 'initial_level_v1'
    and source_revision between 1 and 9007199254740991
  ),
  constraint player_initial_level_reassessments_version_check check (
    survey_version = 'initial_level_v2'
  ),
  constraint player_initial_level_reassessments_answers_check check (
    backend_auth.is_onboarding_survey_answer_codes(survey_answers)
  ),
  constraint player_initial_level_reassessments_score_check check (
    initial_level_score between 0 and 20
  ),
  constraint player_initial_level_reassessments_label_check check (
    initial_level_label = any (
      array['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']::text[]
    )
  ),
  constraint player_initial_level_reassessments_time_check check (
    completed_at between 0 and 9007199254740991
  )
);

create function backend_auth.guard_player_initial_level_reassessment_insert()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_source backend_auth.player_onboarding_states%rowtype;
  v_answer_count bigint;
  v_unknown_answer_count bigint;
begin
  select state.*
    into v_source
  from backend_auth.player_onboarding_states state
  where state.account_id = new.account_id;

  if not found
     or v_source.status <> 'completed'
     or v_source.current_step <> 'completed'
     or v_source.survey_version <> 'initial_level_v1' then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_PLAYER_INITIAL_LEVEL_REASSESSMENT_SOURCE_INVALID';
  end if;

  if new.source_flow_version <> v_source.flow_version
     or new.source_survey_version <> v_source.survey_version
     or new.source_revision <> v_source.revision then
    raise exception using
      errcode = '40001',
      message = 'BACKEND_PLAYER_INITIAL_LEVEL_REASSESSMENT_SOURCE_CONFLICT';
  end if;

  if new.completed_at < v_source.completed_at then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_PLAYER_INITIAL_LEVEL_REASSESSMENT_TIME_INVALID';
  end if;

  if not backend_auth.is_onboarding_survey_answer_codes(
       new.survey_answers
     ) then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_PLAYER_INITIAL_LEVEL_REASSESSMENT_ANSWERS_INVALID';
  end if;

  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (
      where answer_key <> all (array[
        'match_count',
        'rally_stability',
        'glass_play',
        'serve_return_net',
        'match_experience_year'
      ]::text[])
    )
    into v_answer_count, v_unknown_answer_count
  from pg_catalog.jsonb_object_keys(new.survey_answers) answer(answer_key);

  if v_answer_count <> 5 or v_unknown_answer_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_PLAYER_INITIAL_LEVEL_REASSESSMENT_ANSWERS_INVALID';
  end if;

  return new;
end;
$function$;

create trigger player_initial_level_reassessments_insert_guard
before insert on backend_auth.player_initial_level_reassessments
for each row execute function
  backend_auth.guard_player_initial_level_reassessment_insert();

create trigger player_initial_level_reassessments_immutable_guard
before update or delete on backend_auth.player_initial_level_reassessments
for each row execute function backend_auth.reject_immutable_mutation();

do $normalize_acl$
declare
  v_grantee oid;
  v_role_name text;
begin
  for v_grantee in
    select distinct acl_row.grantee
    from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) acl_row
    where relation.oid =
      'backend_auth.player_initial_level_reassessments'::pg_catalog.regclass
      and acl_row.grantee <> relation.relowner
  loop
    if v_grantee = 0 then
      execute 'revoke all privileges on table backend_auth.player_initial_level_reassessments from public';
    else
      v_role_name := pg_catalog.pg_get_userbyid(v_grantee);
      execute pg_catalog.format(
        'revoke all privileges on table backend_auth.player_initial_level_reassessments from %I',
        v_role_name
      );
    end if;
  end loop;

  for v_grantee in
    select distinct acl_row.grantee
    from pg_catalog.pg_proc procedure_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) acl_row
    where procedure_row.oid =
      'backend_auth.guard_player_initial_level_reassessment_insert()'::pg_catalog.regprocedure
      and acl_row.grantee <> procedure_row.proowner
  loop
    if v_grantee = 0 then
      execute 'revoke all privileges on function backend_auth.guard_player_initial_level_reassessment_insert() from public';
    else
      v_role_name := pg_catalog.pg_get_userbyid(v_grantee);
      execute pg_catalog.format(
        'revoke all privileges on function backend_auth.guard_player_initial_level_reassessment_insert() from %I',
        v_role_name
      );
    end if;
  end loop;
end;
$normalize_acl$;

revoke all on table
  backend_auth.player_initial_level_reassessments
from public, backend_auth_app;

grant select on table
  backend_auth.player_initial_level_reassessments
to backend_auth_app;

grant insert (
  account_id,
  source_flow_version,
  source_survey_version,
  source_revision,
  survey_version,
  survey_answers,
  initial_level_score,
  initial_level_label,
  completed_at
) on backend_auth.player_initial_level_reassessments to backend_auth_app;

revoke all on function
  backend_auth.guard_player_initial_level_reassessment_insert()
from public, backend_auth_app;

do $comments$
declare
  v_relation_oid oid :=
    'backend_auth.player_initial_level_reassessments'::pg_catalog.regclass::oid;
  v_function_oid oid :=
    'backend_auth.guard_player_initial_level_reassessment_insert()'::pg_catalog.regprocedure::oid;
begin
  execute pg_catalog.format(
    'comment on table %s is %L',
    v_relation_oid::pg_catalog.regclass,
    '040_backend_player_initial_level_reassessment:'
      || backend_auth.relation_fingerprint(
        v_relation_oid::pg_catalog.regclass
      )
  );

  execute pg_catalog.format(
    'comment on function %s is %L',
    v_function_oid::pg_catalog.regprocedure,
    '040_backend_player_initial_level_reassessment:'
      || pg_catalog.md5(
        pg_catalog.pg_get_functiondef(v_function_oid)
      )
  );
end;
$comments$;

do $assertions$
declare
  v_relation_oid oid :=
    'backend_auth.player_initial_level_reassessments'::pg_catalog.regclass::oid;
  v_function_oid oid :=
    'backend_auth.guard_player_initial_level_reassessment_insert()'::pg_catalog.regprocedure::oid;
begin
  if pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
       '040_backend_player_initial_level_reassessment:'
         || backend_auth.relation_fingerprint(
           v_relation_oid::pg_catalog.regclass
         )
     or not exists (
       select 1
       from pg_catalog.pg_class relation
       where relation.oid = v_relation_oid
         and relation.relkind = 'r'
         and pg_catalog.pg_get_userbyid(relation.relowner) =
           'backend_auth_owner'
     )
     or pg_catalog.obj_description(v_function_oid, 'pg_proc') is distinct from
       '040_backend_player_initial_level_reassessment:'
         || pg_catalog.md5(
           pg_catalog.pg_get_functiondef(v_function_oid)
         )
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
         and not procedure_row.proisstrict
         and procedure_row.provolatile = 'v'
         and procedure_row.proconfig is not distinct from
           array['search_path=pg_catalog, pg_temp']::text[]
         and language_row.lanname = 'plpgsql'
         and pg_catalog.pg_get_function_result(procedure_row.oid) = 'trigger'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 040 fingerprint differs';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_relation_oid,
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_relation_oid,
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_relation_oid,
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_relation_oid,
       'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_relation_oid,
       'TRUNCATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_relation_oid,
       'REFERENCES'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_relation_oid,
       'TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'public',
       v_relation_oid,
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'public',
       v_relation_oid,
       'INSERT'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 040 table ACL differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_class relation
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           relation.relacl,
           pg_catalog.acldefault('r', relation.relowner)
         )
       ) acl_row
       where relation.oid = v_relation_oid
     ) <> 8
     or exists (
       select 1
       from pg_catalog.pg_class relation
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           relation.relacl,
           pg_catalog.acldefault('r', relation.relowner)
         )
       ) acl_row
       where relation.oid = v_relation_oid
         and not (
           (
             acl_row.grantee = relation.relowner
             and acl_row.grantor = relation.relowner
             and not acl_row.is_grantable
             and acl_row.privilege_type in (
               'INSERT',
               'SELECT',
               'UPDATE',
               'DELETE',
               'TRUNCATE',
               'REFERENCES',
               'TRIGGER'
             )
           )
           or (
             acl_row.grantee =
               'backend_auth_app'::pg_catalog.regrole::oid
             and acl_row.grantor = relation.relowner
             and acl_row.privilege_type = 'SELECT'
             and not acl_row.is_grantable
           )
         )
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 040 exact table ACL differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_attribute attribute
       where attribute.attrelid = v_relation_oid
         and attribute.attnum > 0
         and not attribute.attisdropped
         and pg_catalog.has_column_privilege(
           'backend_auth_app',
           v_relation_oid,
           attribute.attname,
           'INSERT'
         )
     ) <> 9
     or pg_catalog.has_function_privilege(
       'backend_auth_app',
       v_function_oid,
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'public',
       v_function_oid,
       'EXECUTE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 040 column/function ACL differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) acl_row
       where procedure_row.oid = v_function_oid
         and acl_row.privilege_type = 'EXECUTE'
         and acl_row.grantee = procedure_row.proowner
         and acl_row.grantor = procedure_row.proowner
         and not acl_row.is_grantable
     ) <> 1
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_proc procedure_row
       cross join lateral pg_catalog.aclexplode(
         coalesce(
           procedure_row.proacl,
           pg_catalog.acldefault('f', procedure_row.proowner)
         )
       ) acl_row
       where procedure_row.oid = v_function_oid
     ) <> 1 then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 040 exact function ACL differs';
  end if;

  if exists (
    select 1
    from backend_auth.player_initial_level_reassessments
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 040 evidence relation must start empty';
  end if;
end;
$assertions$;

reset role;
commit;

select
  '040_backend_player_initial_level_reassessment applied; runtime wiring remains separate'
  as result;
