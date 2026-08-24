-- 040_backend_player_initial_level_reassessment_POSTCHECK.sql
-- Read-only verification for migration 040. Must end with ROLLBACK.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local statement_timeout = '30s';

do $postcheck$
declare
  v_expected record;
  v_checked_function_oid oid;
  v_execute_acl_count bigint;
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
    raise exception 'POSTCHECK_FAILED: onboarding state differs from migration 039';
  end if;

  if v_rating_oid is null
     or pg_catalog.obj_description(v_rating_oid, 'pg_class') is distinct from
       '027_backend_admin_rating_state:'
         || backend_auth.relation_fingerprint(
           v_rating_oid::pg_catalog.regclass
         ) then
    raise exception 'POSTCHECK_FAILED: rating state differs from migration 027';
  end if;

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
    v_checked_function_oid :=
      pg_catalog.to_regprocedure(v_expected.signature)::oid;

    if v_checked_function_oid is null
       or not exists (
         select 1
         from pg_catalog.pg_proc procedure_row
         join pg_catalog.pg_language language_row
           on language_row.oid = procedure_row.prolang
         where procedure_row.oid = v_checked_function_oid
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
      raise exception 'POSTCHECK_FAILED: function boundary differs for %',
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
    where procedure_row.oid = v_checked_function_oid
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
         where procedure_row.oid = v_checked_function_oid
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
      raise exception 'POSTCHECK_FAILED: exact function ACL differs for %',
        v_expected.signature;
    end if;
  end loop;

  if v_relation_oid is null
     or pg_catalog.obj_description(
       v_relation_oid,
       'pg_class'
     ) is distinct from
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
     ) then
    raise exception 'POSTCHECK_FAILED: migration 040 relation fingerprint differs';
  end if;

  if v_function_oid is null
     or pg_catalog.obj_description(
       v_function_oid,
       'pg_proc'
     ) is distinct from
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
         and language_row.lanname = 'plpgsql'
         and procedure_row.prokind = 'f'
         and not procedure_row.prosecdef
         and not procedure_row.proleakproof
         and not procedure_row.proretset
         and not procedure_row.proisstrict
         and procedure_row.provolatile = 'v'
         and procedure_row.proconfig is not distinct from
           array['search_path=pg_catalog, pg_temp']::text[]
         and pg_catalog.pg_get_function_result(procedure_row.oid) = 'trigger'
     ) then
    raise exception 'POSTCHECK_FAILED: migration 040 insert guard differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_attribute attribute
       where attribute.attrelid = v_relation_oid
         and attribute.attnum > 0
         and not attribute.attisdropped
     ) <> 9
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_relation_oid
         and constraint_row.conname in (
           'player_initial_level_reassessments_pkey',
           'player_initial_level_reassessments_account_id_fkey',
           'player_initial_level_reassessments_source_check',
           'player_initial_level_reassessments_version_check',
           'player_initial_level_reassessments_answers_check',
           'player_initial_level_reassessments_score_check',
           'player_initial_level_reassessments_label_check',
           'player_initial_level_reassessments_time_check'
         )
     ) <> 8
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid = v_relation_oid
         and not trigger_row.tgisinternal
         and trigger_row.tgname in (
           'player_initial_level_reassessments_insert_guard',
           'player_initial_level_reassessments_immutable_guard'
         )
     ) <> 2 then
    raise exception 'POSTCHECK_FAILED: migration 040 catalog shape differs';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_relation_oid
         and constraint_row.conname =
           'player_initial_level_reassessments_account_id_fkey'
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), 'foreign key (account_id) references backend_auth.player_onboarding_states(account_id)') > 0
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_relation_oid
         and constraint_row.conname =
           'player_initial_level_reassessments_source_check'
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), 'source_survey_version = ''initial_level_v1''::text') > 0
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_relation_oid
         and constraint_row.conname =
           'player_initial_level_reassessments_version_check'
         and pg_catalog.strpos(pg_catalog.lower(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
         ), 'survey_version = ''initial_level_v2''::text') > 0
     ) then
    raise exception 'POSTCHECK_FAILED: migration 040 source/version constraints differ';
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
     )
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
    raise exception 'POSTCHECK_FAILED: migration 040 table/function ACL differs';
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
    raise exception 'POSTCHECK_FAILED: migration 040 exact table ACL differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_attribute attribute
       join pg_catalog.pg_class relation
         on relation.oid = attribute.attrelid
       join lateral pg_catalog.aclexplode(
         coalesce(attribute.attacl, '{}'::pg_catalog.aclitem[])
       ) acl_row on true
       where attribute.attrelid = v_relation_oid
         and attribute.attnum > 0
         and not attribute.attisdropped
         and acl_row.privilege_type = 'INSERT'
         and acl_row.grantee =
           'backend_auth_app'::pg_catalog.regrole::oid
         and not acl_row.is_grantable
         and acl_row.grantor = relation.relowner
     ) <> 9
     or exists (
       select 1
       from pg_catalog.pg_attribute attribute
       join pg_catalog.pg_class relation
         on relation.oid = attribute.attrelid
       join lateral pg_catalog.aclexplode(
         coalesce(attribute.attacl, '{}'::pg_catalog.aclitem[])
       ) acl_row on true
       where attribute.attrelid = v_relation_oid
         and attribute.attnum > 0
         and not attribute.attisdropped
         and (
           acl_row.privilege_type <> 'INSERT'
           or acl_row.grantee <>
             'backend_auth_app'::pg_catalog.regrole::oid
           or acl_row.is_grantable
           or acl_row.grantor <> relation.relowner
         )
     ) then
    raise exception 'POSTCHECK_FAILED: migration 040 column ACL differs';
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
    raise exception 'POSTCHECK_FAILED: migration 040 exact function ACL differs';
  end if;

  if exists (
    select 1
    from backend_auth.player_initial_level_reassessments reassessment
    left join backend_auth.player_onboarding_states source
      on source.account_id = reassessment.account_id
    where source.account_id is null
       or source.status <> 'completed'
       or source.current_step <> 'completed'
       or source.survey_version <> 'initial_level_v1'
       or source.flow_version <> reassessment.source_flow_version
       or source.survey_version <> reassessment.source_survey_version
       or source.revision <> reassessment.source_revision
       or reassessment.completed_at < source.completed_at
       or reassessment.survey_version <> 'initial_level_v2'
       or reassessment.initial_level_score not between 0 and 20
       or reassessment.initial_level_label <> all (
         array['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']::text[]
       )
       or not backend_auth.is_onboarding_survey_answer_codes(
         reassessment.survey_answers
       )
       or (
         select pg_catalog.count(*)
         from pg_catalog.jsonb_object_keys(
           reassessment.survey_answers
         ) answer(answer_key)
       ) <> 5
       or exists (
         select 1
         from pg_catalog.jsonb_object_keys(
           reassessment.survey_answers
         ) answer(answer_key)
         where answer_key <> all (array[
           'match_count',
           'rally_stability',
           'glass_play',
           'serve_return_net',
           'match_experience_year'
         ]::text[])
       )
  ) then
    raise exception 'POSTCHECK_FAILED: persisted reassessment evidence differs';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'migration', '040_backend_player_initial_level_reassessment',
  'applied', true,
  'source_state_migration', '039_backend_player_onboarding_initial_level_result',
  'one_reassessment_per_account', true,
  'source_evidence_immutable', true,
  'backend_auth_app_select', true,
  'backend_auth_app_column_insert', true,
  'backend_auth_app_update_delete', false,
  'public_access', false,
  'reassessment_rows_observed', (
    select pg_catalog.count(*)
    from backend_auth.player_initial_level_reassessments
  ),
  'eligible_without_reassessment_rows_observed', (
    select pg_catalog.count(*)
    from backend_auth.player_onboarding_states source
    where source.status = 'completed'
      and source.current_step = 'completed'
      and source.survey_version = 'initial_level_v1'
      and not exists (
        select 1
        from backend_auth.player_initial_level_reassessments reassessment
        where reassessment.account_id = source.account_id
      )
  ),
  'rating_state_unchanged', true,
  'legacy_rows_backfilled', false,
  'synthetic_fixture_compatible', true
) as backend_player_initial_level_reassessment_postcheck;

rollback;
