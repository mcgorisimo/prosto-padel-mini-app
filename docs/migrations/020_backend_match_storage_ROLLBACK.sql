-- 020_backend_match_storage_ROLLBACK.sql
-- Safe rollback is allowed only while every migration 020 table is empty.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $role_precheck$
begin
  if pg_catalog.to_regrole('backend_auth_owner') is null
     or not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: owner role boundary is unavailable';
  end if;
end;
$role_precheck$;

set local role backend_auth_owner;

lock table
  backend_match.matches,
  backend_match.match_participants,
  backend_match.match_commands
in access exclusive mode;

do $preconditions$
declare
  v_expected record;
  v_count bigint;
begin
  if pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.pg_get_userbyid(
       (select n.nspowner
        from pg_catalog.pg_namespace n
        where n.nspname = 'backend_match')
     ) <> 'backend_auth_owner'
     or pg_catalog.obj_description(
       pg_catalog.to_regnamespace('backend_match'),
       'pg_namespace'
     ) is distinct from
       '020_backend_match_storage:private backend-owned match aggregate' then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 020 schema differs';
  end if;

  for v_expected in
    select *
    from (values
      ('matches'),
      ('match_participants'),
      ('match_commands')
    ) expected(table_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
        and relation.relname = v_expected.table_name
        and relation.relkind = 'r'
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          '020_backend_match_storage:'
            || backend_auth.relation_fingerprint(
              relation.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'ROLLBACK_PRECONDITION_FAILED: backend_match.% structure, owner, or fingerprint differs',
        v_expected.table_name;
    end if;
  end loop;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'backend_match';

  if v_count <> 16 then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: backend_match object count differs';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = constraint_row.connamespace
  where namespace.nspname = 'backend_match';

  if v_count <> 36 then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: backend_match constraint count differs';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'backend_match';

  if v_count <> 13 then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: backend_match index count differs';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
         and not trigger_row.tgisinternal
     )
     or exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       join pg_catalog.pg_namespace namespace
         on namespace.oid = procedure_row.pronamespace
       where namespace.nspname = 'backend_match'
     ) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: backend_match contains unexpected executable objects';
  end if;

  if exists (select 1 from backend_match.matches)
     or exists (select 1 from backend_match.match_participants)
     or exists (select 1 from backend_match.match_commands) then
    raise exception 'ROLLBACK_BLOCKED: backend_match storage contains data';
  end if;
end;
$preconditions$;

drop table backend_match.match_commands;
drop table backend_match.match_participants;
drop table backend_match.matches;
drop schema backend_match;

do $assertions$
declare
  v_expected record;
  v_count bigint;
begin
  if pg_catalog.to_regnamespace('backend_match') is not null then
    raise exception 'ROLLBACK_ASSERTION_FAILED: backend_match schema still exists';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'backend_auth'
    and relation.relkind = 'r';

  if v_count <> 16 then
    raise exception 'ROLLBACK_ASSERTION_FAILED: expected 16 backend_auth tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = constraint_row.connamespace
  where namespace.nspname = 'backend_auth';

  if v_count <> 160 then
    raise exception 'ROLLBACK_ASSERTION_FAILED: expected 160 backend_auth constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'backend_auth'
    and not trigger_row.tgisinternal;

  if v_count <> 33 then
    raise exception 'ROLLBACK_ASSERTION_FAILED: expected 33 backend_auth user triggers, found %',
      v_count;
  end if;

  for v_expected in
    select *
    from (values
      ('accounts', '015_backend_auth_foundation:'),
      ('player_profiles', '015_backend_auth_foundation:'),
      ('external_identities', '015_backend_auth_foundation:'),
      ('external_identity_lookup_digests', '015_backend_auth_foundation:'),
      ('authentication_operations', '015_backend_auth_foundation:'),
      ('telegram_proof_consumptions', '015_backend_auth_foundation:'),
      ('auth_session_families', '015_backend_auth_foundation:'),
      ('auth_session_credentials', '015_backend_auth_foundation:'),
      ('auth_session_commands', '015_backend_auth_foundation:'),
      ('fresh_authentication_evidence', '015_backend_auth_foundation:'),
      ('reauthentication_grants', '015_backend_auth_foundation:'),
      ('otp_challenges', '015_backend_auth_foundation:'),
      ('otp_commands', '015_backend_auth_foundation:'),
      ('security_audit_events', '015_backend_auth_foundation:'),
      ('player_profile_details', '018_backend_auth_player_profile_editable_fields:'),
      ('player_rating_states', '019_backend_auth_player_rating_state:')
    ) expected(table_name, comment_prefix)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth'
        and relation.relname = v_expected.table_name
        and relation.relkind = 'r'
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          v_expected.comment_prefix
            || backend_auth.relation_fingerprint(
              relation.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'ROLLBACK_ASSERTION_FAILED: existing backend_auth.% structure changed',
        v_expected.table_name;
    end if;
  end loop;
end;
$assertions$;

reset role;
commit;

select '020_backend_match_storage rolled back while all migration tables were empty'
  as result;
