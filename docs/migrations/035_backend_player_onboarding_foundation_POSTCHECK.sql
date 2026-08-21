-- 035_backend_player_onboarding_foundation_POSTCHECK.sql
-- Read-only exact verification. Run only after a separately approved DB apply.

begin;
set transaction read only;
set local search_path = pg_catalog, pg_temp;
set local statement_timeout = '30s';

do $postcheck$
declare
  v_relation record;
  v_function pg_catalog.regprocedure;
  v_details_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
  v_state_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_onboarding_states')::oid;
  v_acceptance_oid oid :=
    pg_catalog.to_regclass('backend_auth.account_consent_acceptances')::oid;
  v_actual text[];
  v_difference_count bigint;
  v_column text;
begin
  for v_relation in
    select *
    from (values
      (
        'player_profile_details',
        v_details_oid,
        '035_backend_player_onboarding_foundation'
      ),
      (
        'player_onboarding_states',
        v_state_oid,
        '035_backend_player_onboarding_foundation'
      ),
      (
        'account_consent_acceptances',
        v_acceptance_oid,
        '035_backend_player_onboarding_foundation'
      ),
      (
        'player_rating_states',
        pg_catalog.to_regclass(
          'backend_auth.player_rating_states'
        )::oid,
        '027_backend_admin_rating_state'
      )
    ) expected(relation_name, relation_oid, migration_name)
  loop
    if v_relation.relation_oid is null
       or not exists (
         select 1
         from pg_catalog.pg_class relation
         where relation.oid = v_relation.relation_oid
           and relation.relkind = 'r'
           and relation.relpersistence = 'p'
           and not relation.relrowsecurity
           and not relation.relforcerowsecurity
           and pg_catalog.pg_get_userbyid(relation.relowner) =
             'backend_auth_owner'
           and pg_catalog.obj_description(relation.oid, 'pg_class') =
             v_relation.migration_name || ':'
               || backend_auth.relation_fingerprint(
                 relation.oid::pg_catalog.regclass
               )
       ) then
      raise exception 'POSTCHECK_FAILED: backend_auth.% relation differs from %',
        v_relation.relation_name,
        v_relation.migration_name;
    end if;
  end loop;

  with expected(
    relation_oid,
    column_name,
    data_type,
    not_null,
    default_expression
  ) as (
    values
      (v_details_oid, 'normalized_email', 'text', false, null::text),
      (v_state_oid, 'account_id', 'uuid', true, null::text),
      (v_state_oid, 'flow_version', 'text', true, null::text),
      (
        v_state_oid,
        'status',
        'text',
        true,
        '''in_progress''::text'
      ),
      (v_state_oid, 'current_step', 'text', true, null::text),
      (v_state_oid, 'survey_version', 'text', true, null::text),
      (
        v_state_oid,
        'survey_answers',
        'jsonb',
        true,
        '''{}''::jsonb'
      ),
      (v_state_oid, 'revision', 'bigint', true, '1'),
      (v_state_oid, 'created_at', 'bigint', true, null::text),
      (v_state_oid, 'updated_at', 'bigint', true, null::text),
      (v_state_oid, 'completed_at', 'bigint', false, null::text),
      (v_acceptance_oid, 'account_id', 'uuid', true, null::text),
      (v_acceptance_oid, 'consent_kind', 'text', true, null::text),
      (
        v_acceptance_oid,
        'document_version',
        'text',
        true,
        null::text
      ),
      (v_acceptance_oid, 'flow_version', 'text', true, null::text),
      (v_acceptance_oid, 'accepted_at', 'bigint', true, null::text)
  ),
  actual as (
    select
      attribute.attrelid::oid,
      attribute.attname::text,
      pg_catalog.format_type(
        attribute.atttypid,
        attribute.atttypmod
      ),
      attribute.attnotnull,
      pg_catalog.pg_get_expr(
        attribute_default.adbin,
        attribute_default.adrelid,
        false
      )
    from pg_catalog.pg_attribute attribute
    left join pg_catalog.pg_attrdef attribute_default
      on attribute_default.adrelid = attribute.attrelid
      and attribute_default.adnum = attribute.attnum
    where (
      attribute.attrelid in (v_state_oid, v_acceptance_oid)
      or (
        attribute.attrelid = v_details_oid
        and attribute.attname = 'normalized_email'
      )
    )
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count
  from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: onboarding columns or defaults differ';
  end if;

  select pg_catalog.array_agg(
    constraint_row.conname::text
    order by constraint_row.conname::text collate "C"
  ) into v_actual
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_details_oid;

  if v_actual is distinct from array[
    'player_profile_details_account_id_fkey',
    'player_profile_details_first_name_check',
    'player_profile_details_language_code_check',
    'player_profile_details_last_name_check',
    'player_profile_details_normalized_email_check',
    'player_profile_details_phone_check',
    'player_profile_details_photo_url_check',
    'player_profile_details_pkey',
    'player_profile_details_side_preference_check',
    'player_profile_details_time_check',
    'player_profile_details_username_check'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: player profile constraint set differs';
  end if;

  select pg_catalog.array_agg(
    constraint_row.conname::text
    order by constraint_row.conname::text collate "C"
  ) into v_actual
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_state_oid;

  if v_actual is distinct from array[
    'player_onboarding_states_account_id_fkey',
    'player_onboarding_states_code_check',
    'player_onboarding_states_pkey',
    'player_onboarding_states_revision_check',
    'player_onboarding_states_shape_check',
    'player_onboarding_states_status_check',
    'player_onboarding_states_step_check',
    'player_onboarding_states_survey_answers_check',
    'player_onboarding_states_time_check'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: onboarding state constraint set differs';
  end if;

  select pg_catalog.array_agg(
    constraint_row.conname::text
    order by constraint_row.conname::text collate "C"
  ) into v_actual
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_acceptance_oid;

  if v_actual is distinct from array[
    'account_consent_acceptances_account_id_fkey',
    'account_consent_acceptances_kind_check',
    'account_consent_acceptances_pkey',
    'account_consent_acceptances_time_check',
    'account_consent_acceptances_version_check'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: consent acceptance constraint set differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid in (
      v_details_oid,
      v_state_oid,
      v_acceptance_oid
    )
      and not constraint_row.convalidated
  ) then
    raise exception 'POSTCHECK_FAILED: an onboarding constraint is not validated';
  end if;

  select pg_catalog.array_agg(
    index_relation.relname::text
    order by index_relation.relname::text collate "C"
  ) into v_actual
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  where index_row.indrelid = v_state_oid
    and index_row.indisvalid
    and index_row.indisready;

  if v_actual is distinct from array[
    'player_onboarding_states_pkey'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: onboarding state index set differs';
  end if;

  select pg_catalog.array_agg(
    index_relation.relname::text
    order by index_relation.relname::text collate "C"
  ) into v_actual
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation
    on index_relation.oid = index_row.indexrelid
  where index_row.indrelid = v_acceptance_oid
    and index_row.indisvalid
    and index_row.indisready;

  if v_actual is distinct from array[
    'account_consent_acceptances_pkey'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: consent acceptance index set differs';
  end if;

  select pg_catalog.array_agg(
    trigger_row.tgname::text
    order by trigger_row.tgname::text collate "C"
  ) into v_actual
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = v_state_oid
    and not trigger_row.tgisinternal;

  if v_actual is distinct from array[
    'player_onboarding_states_transition_guard'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: onboarding state trigger set differs';
  end if;

  select pg_catalog.array_agg(
    trigger_row.tgname::text
    order by trigger_row.tgname::text collate "C"
  ) into v_actual
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid = v_acceptance_oid
    and not trigger_row.tgisinternal;

  if v_actual is distinct from array[
    'account_consent_acceptances_immutable_guard'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: consent acceptance trigger set differs';
  end if;

  foreach v_function in array array[
    'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)'::pg_catalog.regprocedure,
    'backend_auth.guard_player_onboarding_state_transition()'::pg_catalog.regprocedure
  ] loop
    if pg_catalog.obj_description(v_function::oid, 'pg_proc') is distinct from
         '035_backend_player_onboarding_foundation:'
           || pg_catalog.md5(
             pg_catalog.pg_get_functiondef(v_function::oid)
           )
       or pg_catalog.has_function_privilege(
         'backend_auth_app',
         v_function,
         'EXECUTE'
       )
       or exists (
         select 1
         from pg_catalog.pg_proc procedure_row
         cross join lateral pg_catalog.aclexplode(
           coalesce(
             procedure_row.proacl,
             pg_catalog.acldefault('f', procedure_row.proowner)
           )
         ) acl
         where procedure_row.oid = v_function::oid
           and acl.grantee = 0
           and acl.privilege_type = 'EXECUTE'
       ) then
      raise exception 'POSTCHECK_FAILED: function fingerprint or ACL differs for %',
        v_function;
    end if;
  end loop;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_state_oid,
       'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_acceptance_oid,
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_state_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_acceptance_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     ) then
    raise exception 'POSTCHECK_FAILED: onboarding table ACL differs';
  end if;

  foreach v_column in array array[
    'account_id',
    'flow_version',
    'current_step',
    'survey_version',
    'created_at',
    'updated_at'
  ]::text[]
  loop
    if not pg_catalog.has_column_privilege(
      'backend_auth_app',
      v_state_oid,
      v_column,
      'INSERT'
    ) then
      raise exception 'POSTCHECK_FAILED: onboarding INSERT is missing for %',
        v_column;
    end if;
  end loop;

  foreach v_column in array array[
    'status',
    'current_step',
    'survey_answers',
    'revision',
    'updated_at',
    'completed_at'
  ]::text[]
  loop
    if not pg_catalog.has_column_privilege(
      'backend_auth_app',
      v_state_oid,
      v_column,
      'UPDATE'
    ) then
      raise exception 'POSTCHECK_FAILED: onboarding UPDATE is missing for %',
        v_column;
    end if;
  end loop;

  foreach v_column in array array[
    'account_id',
    'consent_kind',
    'document_version',
    'flow_version',
    'accepted_at'
  ]::text[]
  loop
    if not pg_catalog.has_column_privilege(
      'backend_auth_app',
      v_acceptance_oid,
      v_column,
      'INSERT'
    ) then
      raise exception 'POSTCHECK_FAILED: consent INSERT is missing for %',
        v_column;
    end if;
  end loop;

  if pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_state_oid,
       'status',
       'INSERT'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_state_oid,
       'survey_answers',
       'INSERT'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_state_oid,
       'revision',
       'INSERT'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_state_oid,
       'completed_at',
       'INSERT'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_state_oid,
       'account_id',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_state_oid,
       'flow_version',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_state_oid,
       'survey_version',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_state_oid,
       'created_at',
       'UPDATE'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_details_oid,
       'normalized_email',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_details_oid,
       'normalized_email',
       'INSERT'
     ) then
    raise exception 'POSTCHECK_FAILED: onboarding column ACL boundary differs';
  end if;

  if exists (
       select 1 from backend_auth.player_onboarding_states
     )
     or exists (
       select 1 from backend_auth.account_consent_acceptances
     )
     or exists (
       select 1
       from backend_auth.player_profile_details
       where normalized_email is not null
     ) then
    raise exception 'POSTCHECK_FAILED: migration 035 target must start empty';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'migration', '035_backend_player_onboarding_foundation',
  'verified', true,
  'runtime_connected', false,
  'new_tables_empty', true,
  'contact_verification_added', false,
  'rating_state_unchanged', true
) as postcheck_result;

rollback;
