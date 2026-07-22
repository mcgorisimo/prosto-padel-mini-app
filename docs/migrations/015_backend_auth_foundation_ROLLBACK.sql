-- 015_backend_auth_foundation_ROLLBACK.sql
-- Destructive only for an empty, structurally intact migration 015 foundation.
-- Required wrapper is documented in 015_backend_auth_foundation_README.md.
-- This script commits the caller-started transaction after all checks and drops.

set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

set local role backend_auth_owner;

do $$
declare
  v_expected_tables constant text[] := array[
    'accounts', 'auth_session_commands', 'auth_session_credentials',
    'auth_session_families', 'authentication_operations', 'external_identities',
    'external_identity_lookup_digests', 'fresh_authentication_evidence',
    'otp_challenges', 'otp_commands', 'player_profiles',
    'reauthentication_grants', 'security_audit_events',
    'telegram_proof_consumptions'
  ]::text[];
  v_actual_tables text[];
  v_confirmation text;
begin
  v_confirmation := pg_catalog.current_setting(
    'backend_auth.rollback_015_confirm', true
  );
  if v_confirmation is distinct from
     'DROP_EMPTY_BACKEND_AUTH_015:' || pg_catalog.txid_current()::text then
    raise exception using
      errcode = '55000',
      message = 'ROLLBACK_015_CONFIRMATION_REQUIRED',
      detail = 'Use the transaction-local, transaction-ID-bound confirmation from the README';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is null then
    raise exception 'ROLLBACK_015_REFUSED: schema backend_auth is absent';
  end if;

  -- Resolve the exact expected set before taking locks. Any concurrent DDL
  -- that changes this set causes either LOCK or the authoritative reread
  -- below to fail closed.
  select pg_catalog.array_agg(
           c.relname::text collate "C" order by c.relname::text collate "C"
         ) into v_actual_tables
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r';
  if (select pg_catalog.count(*) <>
             pg_catalog.count(distinct expected_name.name collate "C")
      from pg_catalog.unnest(v_expected_tables) as expected_name(name))
     or v_actual_tables is distinct from (
       select pg_catalog.array_agg(
                expected_name.name collate "C"
                order by expected_name.name collate "C"
              )
       from pg_catalog.unnest(v_expected_tables) as expected_name(name)
     ) then
    raise exception 'ROLLBACK_015_REFUSED: exact 14-table set does not match: %',
      v_actual_tables;
  end if;
end;
$$;

-- Stable child-first order. ACCESS EXCLUSIVE prevents INSERT, UPDATE, DELETE,
-- TRUNCATE and DDL on these relations from crossing the authoritative checks.
-- These locks remain held until this caller-started transaction commits.
lock table
  backend_auth.security_audit_events,
  backend_auth.otp_commands,
  backend_auth.otp_challenges,
  backend_auth.reauthentication_grants,
  backend_auth.fresh_authentication_evidence,
  backend_auth.auth_session_commands,
  backend_auth.auth_session_credentials,
  backend_auth.auth_session_families,
  backend_auth.telegram_proof_consumptions,
  backend_auth.authentication_operations,
  backend_auth.external_identity_lookup_digests,
  backend_auth.external_identities,
  backend_auth.player_profiles,
  backend_auth.accounts
in access exclusive mode;

do $$
declare
  v_expected_tables constant text[] := array[
    'accounts', 'auth_session_commands', 'auth_session_credentials',
    'auth_session_families', 'authentication_operations', 'external_identities',
    'external_identity_lookup_digests', 'fresh_authentication_evidence',
    'otp_challenges', 'otp_commands', 'player_profiles',
    'reauthentication_grants', 'security_audit_events',
    'telegram_proof_consumptions'
  ]::text[];
  v_actual_tables text[];
  v_expected_functions constant text[] := array[
    'assert_active_account_has_login_method',
    'assert_authentication_proof_binding',
    'assert_external_identity_aliases',
    'assert_fresh_authentication_evidence_consistency',
    'assert_otp_consistency', 'assert_player_profile_consistency',
    'assert_primary_unlink_replacement',
    'assert_reauthentication_grant_consistency',
    'assert_session_consistency', 'assert_session_family_operation',
    'guard_account_transition', 'guard_authentication_operation_transition',
    'guard_external_identity_transition', 'guard_otp_challenge_transition',
    'guard_reauthentication_grant_transition',
    'guard_session_credential_transition', 'guard_session_family_transition',
    'reject_audit_mutation', 'reject_immutable_mutation',
    'relation_fingerprint'
  ]::text[];
  v_actual_functions text[];
  v_name text;
  v_relation pg_catalog.regclass;
  v_function record;
  v_count bigint;
  v_total_rows bigint;
begin
  -- Authoritative reread after every table lock has been acquired.
  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.pg_get_userbyid((
       select n.nspowner from pg_catalog.pg_namespace n
       where n.nspname = 'backend_auth'
     )) <> 'backend_auth_owner' then
    raise exception 'ROLLBACK_015_REFUSED: schema missing or owner changed after lock wait';
  end if;

  select pg_catalog.array_agg(
           c.relname::text collate "C" order by c.relname::text collate "C"
         ) into v_actual_tables
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r';
  if (select pg_catalog.count(*) <>
             pg_catalog.count(distinct expected_name.name collate "C")
      from pg_catalog.unnest(v_expected_tables) as expected_name(name))
     or v_actual_tables is distinct from (
       select pg_catalog.array_agg(
                expected_name.name collate "C"
                order by expected_name.name collate "C"
              )
       from pg_catalog.unnest(v_expected_tables) as expected_name(name)
     ) then
    raise exception 'ROLLBACK_015_REFUSED: table set changed after lock wait: %',
      v_actual_tables;
  end if;

  if pg_catalog.obj_description(
       'backend_auth.relation_fingerprint(regclass)'::pg_catalog.regprocedure,
       'pg_proc'
     ) is distinct from '015_backend_auth_foundation:' || pg_catalog.md5(
       pg_catalog.pg_get_functiondef(
         'backend_auth.relation_fingerprint(regclass)'::pg_catalog.regprocedure
       )
     ) then
    raise exception 'ROLLBACK_015_REFUSED: fingerprint function changed after lock wait';
  end if;

  foreach v_name in array v_expected_tables loop
    v_relation := pg_catalog.to_regclass('backend_auth.' || v_name);
    if pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid = v_relation)
    ) <> 'backend_auth_owner'
       or pg_catalog.obj_description(v_relation, 'pg_class') is distinct from
          '015_backend_auth_foundation:' ||
            backend_auth.relation_fingerprint(v_relation) then
      raise exception 'ROLLBACK_015_REFUSED: owner/fingerprint changed after lock wait for %',
        v_name;
    end if;
  end loop;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'backend_auth';
  select pg_catalog.array_agg(
           p.proname::text collate "C" order by p.proname::text collate "C"
         )
  into v_actual_functions
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'backend_auth';
  if v_count <> 20
     or (select pg_catalog.count(*) <>
                pg_catalog.count(distinct expected_name.name collate "C")
         from pg_catalog.unnest(v_expected_functions) as expected_name(name))
     or v_actual_functions is distinct from (
       select pg_catalog.array_agg(
                expected_name.name collate "C"
                order by expected_name.name collate "C"
              )
       from pg_catalog.unnest(v_expected_functions) as expected_name(name)
     ) then
    raise exception 'ROLLBACK_015_REFUSED: exact function set changed after lock wait: %',
      v_actual_functions;
  end if;

  for v_function in
    select p.oid, p.oid::pg_catalog.regprocedure as identity, p.proowner
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'backend_auth'
  loop
    if pg_catalog.pg_get_userbyid(v_function.proowner) <> 'backend_auth_owner'
       or pg_catalog.obj_description(v_function.oid, 'pg_proc') is distinct from
          '015_backend_auth_foundation:' ||
            pg_catalog.md5(pg_catalog.pg_get_functiondef(v_function.oid)) then
      raise exception 'ROLLBACK_015_REFUSED: function changed after lock wait for %',
        v_function.identity;
    end if;
  end loop;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_class s
      join pg_catalog.pg_namespace n on n.oid = s.relnamespace
      where n.nspname = 'backend_auth' and s.relkind = 'S') <> 1
     or pg_catalog.obj_description(
       'backend_auth.security_audit_events_event_order_seq'::pg_catalog.regclass,
       'pg_class'
     ) is distinct from '015_backend_auth_foundation:audit_storage_order'
     or pg_catalog.pg_get_userbyid((
       select c.relowner from pg_catalog.pg_class c
       where c.oid =
         'backend_auth.security_audit_events_event_order_seq'::pg_catalog.regclass
     )) <> 'backend_auth_owner' then
    raise exception 'ROLLBACK_015_REFUSED: audit sequence changed after lock wait';
  end if;

  v_total_rows := 0;
  foreach v_name in array v_expected_tables loop
    execute pg_catalog.format('select count(*) from backend_auth.%I', v_name)
      into v_count;
    v_total_rows := v_total_rows + v_count;
  end loop;
  if v_total_rows <> 0 then
    raise exception using
      errcode = '55000',
      message = 'ROLLBACK_015_REFUSED_NONEMPTY',
      detail = pg_catalog.format(
        'All 14 locked tables, including security_audit_events, must be empty; found %s rows',
        v_total_rows
      );
  end if;
end;
$$;

drop trigger security_audit_events_truncate_guard
  on backend_auth.security_audit_events;
drop trigger security_audit_events_update_delete_guard
  on backend_auth.security_audit_events;
drop trigger otp_commands_state_consistency on backend_auth.otp_commands;
drop trigger otp_challenges_state_consistency on backend_auth.otp_challenges;
drop trigger reauthentication_grants_state_consistency
  on backend_auth.reauthentication_grants;
drop trigger fresh_authentication_evidence_state_consistency
  on backend_auth.fresh_authentication_evidence;
drop trigger auth_session_commands_state_consistency
  on backend_auth.auth_session_commands;
drop trigger auth_session_credentials_state_consistency
  on backend_auth.auth_session_credentials;
drop trigger auth_session_families_state_consistency
  on backend_auth.auth_session_families;
drop trigger auth_session_families_operation_consistency
  on backend_auth.auth_session_families;
drop trigger otp_challenges_operation_binding on backend_auth.otp_challenges;
drop trigger telegram_proof_consumptions_operation_binding
  on backend_auth.telegram_proof_consumptions;
drop trigger authentication_operations_proof_binding
  on backend_auth.authentication_operations;
drop trigger external_identities_primary_unlink_replacement
  on backend_auth.external_identities;
drop trigger external_identities_active_login_method_required
  on backend_auth.external_identities;
drop trigger accounts_active_login_method_required on backend_auth.accounts;
drop trigger external_identity_lookup_digests_identity_required
  on backend_auth.external_identity_lookup_digests;
drop trigger external_identities_alias_required
  on backend_auth.external_identities;
drop trigger player_profiles_account_consistency on backend_auth.player_profiles;
drop trigger accounts_player_profile_consistency on backend_auth.accounts;
drop trigger otp_commands_immutable_guard on backend_auth.otp_commands;
drop trigger fresh_authentication_evidence_immutable_guard
  on backend_auth.fresh_authentication_evidence;
drop trigger auth_session_commands_immutable_guard
  on backend_auth.auth_session_commands;
drop trigger telegram_proof_consumptions_immutable_guard
  on backend_auth.telegram_proof_consumptions;
drop trigger external_identity_lookup_digests_immutable_guard
  on backend_auth.external_identity_lookup_digests;
drop trigger player_profiles_immutable_guard on backend_auth.player_profiles;
drop trigger otp_challenges_transition_guard on backend_auth.otp_challenges;
drop trigger reauthentication_grants_transition_guard
  on backend_auth.reauthentication_grants;
drop trigger auth_session_credentials_transition_guard
  on backend_auth.auth_session_credentials;
drop trigger auth_session_families_transition_guard
  on backend_auth.auth_session_families;
drop trigger authentication_operations_transition_guard
  on backend_auth.authentication_operations;
drop trigger external_identities_transition_guard
  on backend_auth.external_identities;
drop trigger accounts_transition_guard on backend_auth.accounts;

drop function backend_auth.assert_fresh_authentication_evidence_consistency();
drop function backend_auth.reject_audit_mutation();
drop function backend_auth.assert_otp_consistency();
drop function backend_auth.assert_reauthentication_grant_consistency();
drop function backend_auth.assert_session_consistency();
drop function backend_auth.assert_session_family_operation();
drop function backend_auth.assert_authentication_proof_binding();
drop function backend_auth.assert_primary_unlink_replacement();
drop function backend_auth.assert_active_account_has_login_method();
drop function backend_auth.assert_external_identity_aliases();
drop function backend_auth.assert_player_profile_consistency();
drop function backend_auth.guard_otp_challenge_transition();
drop function backend_auth.guard_reauthentication_grant_transition();
drop function backend_auth.guard_session_credential_transition();
drop function backend_auth.guard_session_family_transition();
drop function backend_auth.guard_authentication_operation_transition();
drop function backend_auth.guard_external_identity_transition();
drop function backend_auth.guard_account_transition();
drop function backend_auth.reject_immutable_mutation();
drop function backend_auth.relation_fingerprint(pg_catalog.regclass);

-- Break only the six cycles/composite back-references introduced by 015.
alter table backend_auth.authentication_operations
  drop constraint authentication_operations_telegram_proof_fkey,
  drop constraint authentication_operations_otp_challenge_fkey;
alter table backend_auth.auth_session_families
  drop constraint auth_session_families_current_credential_fkey,
  drop constraint auth_session_families_terminal_command_fkey;
alter table backend_auth.auth_session_credentials
  drop constraint auth_session_credentials_consuming_command_fkey;
alter table backend_auth.otp_challenges
  drop constraint otp_challenges_terminal_command_fkey;

-- Child-first, no implicit removal of any object outside migration 015.
drop table backend_auth.security_audit_events;
drop table backend_auth.otp_commands;
drop table backend_auth.otp_challenges;
drop table backend_auth.reauthentication_grants;
drop table backend_auth.fresh_authentication_evidence;
drop table backend_auth.auth_session_commands;
drop table backend_auth.auth_session_credentials;
drop table backend_auth.auth_session_families;
drop table backend_auth.telegram_proof_consumptions;
drop table backend_auth.authentication_operations;
drop table backend_auth.external_identity_lookup_digests;
drop table backend_auth.external_identities;
drop table backend_auth.player_profiles;
drop table backend_auth.accounts;
drop schema backend_auth;

reset role;
commit;

select '015_backend_auth_foundation rolled back; provisioned roles were retained' as result;
