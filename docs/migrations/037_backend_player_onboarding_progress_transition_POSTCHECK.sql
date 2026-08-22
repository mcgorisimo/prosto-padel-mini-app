-- 037_backend_player_onboarding_progress_transition_POSTCHECK.sql
-- Read-only exact verification after a separately approved migration 037 apply.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $postcheck$
declare
  v_expected record;
  v_function_oid oid;
  v_acl_count bigint;
  v_guard_definition text;
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
    if pg_catalog.to_regclass(v_expected.relation_name) is null
       or pg_catalog.obj_description(
         pg_catalog.to_regclass(v_expected.relation_name)::oid,
         'pg_class'
       ) is distinct from
         v_expected.migration_name || ':'
           || backend_auth.relation_fingerprint(
             pg_catalog.to_regclass(v_expected.relation_name)
           ) then
      raise exception 'POSTCHECK_FAILED: % fingerprint differs from %',
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
        'boolean',
        '035_backend_player_onboarding_foundation'
      ),
      (
        'backend_auth.guard_player_onboarding_state_transition()',
        'plpgsql',
        'v'::text,
        false,
        'trigger',
        '037_backend_player_onboarding_progress_transition'
      )
    ) expected(
      signature,
      language_name,
      volatility,
      is_strict,
      result_type,
      migration_name
    )
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
           ) = v_expected.migration_name || ':'
             || pg_catalog.md5(
               pg_catalog.pg_get_functiondef(procedure_row.oid)
             )
       ) then
      raise exception 'POSTCHECK_FAILED: function fingerprint differs for %',
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
      raise exception 'POSTCHECK_FAILED: exact runtime function ACL differs for %',
        v_expected.signature;
    end if;
  end loop;

  v_guard_definition := pg_catalog.pg_get_functiondef(
    'backend_auth.guard_player_onboarding_state_transition()'::pg_catalog.regprocedure
  );

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
     or pg_catalog.strpos(
       v_guard_definition,
       'BACKEND_PLAYER_ONBOARDING_CONTACTS_REQUIRED'
     ) = 0
     or pg_catalog.strpos(
       v_guard_definition,
       'BACKEND_PLAYER_ONBOARDING_CONSENTS_REQUIRED'
     ) = 0
     or pg_catalog.strpos(v_guard_definition, 'v_old_step smallint') <> 0
     or pg_catalog.strpos(v_guard_definition, 'v_new_step smallint') <> 0 then
    raise exception 'POSTCHECK_FAILED: migration-037 transition matrix differs';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'migration', '037_backend_player_onboarding_progress_transition',
  'verified', true,
  'profile_to_consents', true,
  'new_profile_to_contacts', false,
  'legacy_contacts_to_consents', true,
  'consents_to_level_survey', true,
  'backend_auth_app_execute', true,
  'public_execute', false,
  'relation_definitions_changed', false,
  'persisted_data_changed', false,
  'synthetic_fixture_compatible', true,
  'onboarding_rows_observed', (
    select pg_catalog.count(*)
    from backend_auth.player_onboarding_states
  ),
  'legacy_contacts_rows_observed', (
    select pg_catalog.count(*)
    from backend_auth.player_onboarding_states
    where current_step = 'contacts'
  ),
  'consent_rows_observed', (
    select pg_catalog.count(*)
    from backend_auth.account_consent_acceptances
  )
) as postcheck_result;

rollback;
