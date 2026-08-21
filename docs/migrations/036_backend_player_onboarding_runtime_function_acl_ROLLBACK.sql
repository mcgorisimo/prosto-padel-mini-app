-- 036_backend_player_onboarding_runtime_function_acl_ROLLBACK.sql
-- Restores the exact migration-035 function EXECUTE prohibition.
-- No function definition, relation or persisted row is changed.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preconditions$
declare
  v_expected record;
  v_function_oid oid;
  v_acl_count bigint;
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

  for v_expected in
    select *
    from (values
      ('backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)'),
      ('backend_auth.guard_player_onboarding_state_transition()')
    ) expected(signature)
  loop
    v_function_oid := pg_catalog.to_regprocedure(v_expected.signature)::oid;

    if v_function_oid is null
       or pg_catalog.obj_description(
         v_function_oid,
         'pg_proc'
       ) is distinct from
         '035_backend_player_onboarding_foundation:'
           || pg_catalog.md5(
             pg_catalog.pg_get_functiondef(v_function_oid)
           ) then
      raise exception 'ROLLBACK_REFUSED: function fingerprint differs for %',
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
      raise exception 'ROLLBACK_REFUSED: function ACL is not the exact migration-036 state for %',
        v_expected.signature;
    end if;
  end loop;
end;
$preconditions$;

set local role backend_auth_owner;

revoke all on function
  backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb),
  backend_auth.guard_player_onboarding_state_transition()
from public, backend_auth_app;

do $assertions$
declare
  v_function pg_catalog.regprocedure;
  v_acl_count bigint;
begin
  foreach v_function in array array[
    'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)'::pg_catalog.regprocedure,
    'backend_auth.guard_player_onboarding_state_transition()'::pg_catalog.regprocedure
  ] loop
    select pg_catalog.count(*) into v_acl_count
    from pg_catalog.pg_proc procedure_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) acl_row
    where procedure_row.oid = v_function::oid
      and acl_row.privilege_type = 'EXECUTE';

    if pg_catalog.has_function_privilege(
         'backend_auth_app', v_function, 'EXECUTE'
       )
       or v_acl_count <> 1
       or not exists (
         select 1
         from pg_catalog.pg_proc procedure_row
         cross join lateral pg_catalog.aclexplode(
           coalesce(
             procedure_row.proacl,
             pg_catalog.acldefault('f', procedure_row.proowner)
           )
         ) acl_row
         where procedure_row.oid = v_function::oid
           and acl_row.grantee = procedure_row.proowner
           and acl_row.grantor = procedure_row.proowner
           and acl_row.privilege_type = 'EXECUTE'
       )
       or pg_catalog.obj_description(v_function::oid, 'pg_proc') is distinct from
         '035_backend_player_onboarding_foundation:'
           || pg_catalog.md5(
             pg_catalog.pg_get_functiondef(v_function::oid)
           ) then
      raise exception 'ROLLBACK_FAILED: migration-035 function ACL or fingerprint was not restored for %',
        v_function;
    end if;
  end loop;
end;
$assertions$;

reset role;
commit;

select
  '036_backend_player_onboarding_runtime_function_acl rolled back to migration-035 ACL'
  as result;
