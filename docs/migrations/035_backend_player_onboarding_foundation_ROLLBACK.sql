-- 035_backend_player_onboarding_foundation_ROLLBACK.sql
-- Fail-closed rollback. It refuses to discard any onboarding/contact data.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_relation record;
  v_function pg_catalog.regprocedure;
begin
  for v_relation in
    select *
    from (values
      (
        'player_profile_details',
        pg_catalog.to_regclass(
          'backend_auth.player_profile_details'
        )::oid
      ),
      (
        'player_onboarding_states',
        pg_catalog.to_regclass(
          'backend_auth.player_onboarding_states'
        )::oid
      ),
      (
        'account_consent_acceptances',
        pg_catalog.to_regclass(
          'backend_auth.account_consent_acceptances'
        )::oid
      )
    ) expected(relation_name, relation_oid)
  loop
    if v_relation.relation_oid is null
       or pg_catalog.obj_description(
         v_relation.relation_oid,
         'pg_class'
       ) is distinct from
         '035_backend_player_onboarding_foundation:'
           || backend_auth.relation_fingerprint(
             v_relation.relation_oid::pg_catalog.regclass
           ) then
      raise exception 'ROLLBACK_REFUSED: backend_auth.% fingerprint differs',
        v_relation.relation_name;
    end if;
  end loop;

  foreach v_function in array array[
    'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)'::pg_catalog.regprocedure,
    'backend_auth.guard_player_onboarding_state_transition()'::pg_catalog.regprocedure
  ] loop
    if pg_catalog.obj_description(v_function::oid, 'pg_proc') is distinct from
         '035_backend_player_onboarding_foundation:'
           || pg_catalog.md5(
             pg_catalog.pg_get_functiondef(v_function::oid)
           ) then
      raise exception 'ROLLBACK_REFUSED: migration function differs for %',
        v_function;
    end if;
  end loop;

  if pg_catalog.obj_description(
       'backend_auth.player_rating_states'::pg_catalog.regclass,
       'pg_class'
     ) is distinct from
       '027_backend_admin_rating_state:'
         || backend_auth.relation_fingerprint(
           'backend_auth.player_rating_states'::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_REFUSED: rating state differs from migration 027';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table
  backend_auth.player_profile_details,
  backend_auth.player_onboarding_states,
  backend_auth.account_consent_acceptances
in access exclusive mode;

do $empty_guard$
begin
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
    raise exception
      'ROLLBACK_REFUSED: onboarding/contact data exists; use a forward migration';
  end if;
end;
$empty_guard$;

revoke update (
  normalized_email
) on backend_auth.player_profile_details from backend_auth_app;

drop trigger account_consent_acceptances_immutable_guard
  on backend_auth.account_consent_acceptances;

drop trigger player_onboarding_states_transition_guard
  on backend_auth.player_onboarding_states;

drop table backend_auth.account_consent_acceptances;
drop table backend_auth.player_onboarding_states;

drop function backend_auth.guard_player_onboarding_state_transition();
drop function backend_auth.is_onboarding_survey_answer_codes(
  pg_catalog.jsonb
);

alter table backend_auth.player_profile_details
  drop constraint player_profile_details_normalized_email_check,
  drop column normalized_email;

do $restore_comment$
begin
  execute pg_catalog.format(
    'comment on table backend_auth.player_profile_details is %L',
    '018_backend_auth_player_profile_editable_fields:'
      || backend_auth.relation_fingerprint(
        'backend_auth.player_profile_details'::pg_catalog.regclass
      )
  );
end;
$restore_comment$;

do $assertions$
declare
  v_details_oid oid :=
    'backend_auth.player_profile_details'::pg_catalog.regclass;
begin
  if pg_catalog.to_regclass(
       'backend_auth.player_onboarding_states'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.account_consent_acceptances'
     ) is not null
     or pg_catalog.to_regprocedure(
       'backend_auth.is_onboarding_survey_answer_codes(pg_catalog.jsonb)'
     ) is not null
     or pg_catalog.to_regprocedure(
       'backend_auth.guard_player_onboarding_state_transition()'
     ) is not null
     or exists (
       select 1
       from pg_catalog.pg_attribute attribute
       where attribute.attrelid = v_details_oid
         and attribute.attname = 'normalized_email'
         and not attribute.attisdropped
     ) then
    raise exception 'ROLLBACK_FAILED: migration 035 objects remain';
  end if;

  if pg_catalog.obj_description(v_details_oid, 'pg_class') is distinct from
       '018_backend_auth_player_profile_editable_fields:'
         || backend_auth.relation_fingerprint(
           v_details_oid::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_FAILED: player profile restore differs';
  end if;

  if pg_catalog.obj_description(
       'backend_auth.player_rating_states'::pg_catalog.regclass,
       'pg_class'
     ) is distinct from
       '027_backend_admin_rating_state:'
         || backend_auth.relation_fingerprint(
           'backend_auth.player_rating_states'::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_FAILED: rating state changed';
  end if;
end;
$assertions$;

reset role;
commit;

select
  '035_backend_player_onboarding_foundation rolled back before onboarding data'
  as result;
