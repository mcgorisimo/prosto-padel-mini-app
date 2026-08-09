-- 034_backend_match_reservation_links_PRECHECK.sql
-- Read-only gate. Run immediately before any separately approved migration 034.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $precheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_relation record;
  v_matches oid := pg_catalog.to_regclass('backend_match.matches')::oid;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'PRECHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  select * into v_owner
  from pg_catalog.pg_roles
  where rolname = 'backend_auth_owner';
  select * into v_app
  from pg_catalog.pg_roles
  where rolname = 'backend_auth_app';

  if v_owner.rolname is null
     or v_owner.rolcanlogin
     or v_owner.rolsuper
     or v_owner.rolcreaterole
     or v_owner.rolcreatedb
     or v_owner.rolreplication
     or v_owner.rolbypassrls
     or v_app.rolname is null
     or not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'PRECHECK_FAILED: backend role attributes differ';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
     or pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER')
     or pg_catalog.has_schema_privilege(
       'backend_auth_app', 'backend_match', 'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app', 'backend_reservation', 'CREATE'
     ) then
    raise exception 'PRECHECK_FAILED: backend role membership or schema boundary differs';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_auth', 'accounts', '015_backend_auth_foundation'),
      ('backend_match', 'matches', '023_backend_match_description_updates'),
      ('backend_match', 'match_participants', '020_backend_match_storage'),
      ('backend_reservation', 'court_reservations', '033_backend_reservation_persistence'),
      ('backend_reservation', 'reservation_slot_holds', '033_backend_reservation_persistence')
    ) expected(schema_name, relation_name, migration_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = v_relation.schema_name
        and relation.relname = v_relation.relation_name
        and relation.relkind = 'r'
        and relation.relpersistence = 'p'
        and not relation.relrowsecurity
        and not relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          v_relation.migration_name || ':'
            || backend_auth.relation_fingerprint(
              relation.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'PRECHECK_FAILED: %.% fingerprint differs from %',
        v_relation.schema_name,
        v_relation.relation_name,
        v_relation.migration_name;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = v_matches
      and constraint_row.conname = 'matches_no_active_court_overlap'
      and constraint_row.contype = 'x'
      and constraint_row.convalidated
      and pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ) like '%exclude using gist%court_id%int8range%with &&%'
  ) then
    raise exception 'PRECHECK_FAILED: legacy match overlap constraint differs';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
      'backend_reservation.reservation_slot_holds'::pg_catalog.regclass
      and constraint_row.conname = 'reservation_slot_holds_no_overlap'
      and constraint_row.contype = 'x'
      and constraint_row.convalidated
  ) then
    raise exception 'PRECHECK_FAILED: D2 canonical slot hold authority differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_match'
      and relation.relname = any (array[
        'match_reservation_links',
        'match_reservation_events',
        'match_reservation_event_recipients',
        'matches_id_owner_account_key',
        'match_reservation_links_active_match_uq',
        'match_reservation_links_active_reservation_uq'
      ]::text[])
  ) or exists (
    select 1
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure_row.pronamespace
    where namespace.nspname = 'backend_match'
      and procedure_row.proname = any (array[
        'guard_match_reservation_link_transition',
        'assert_match_reservation_consistency',
        'guard_match_reservation_event_insert',
        'assert_match_reservation_link_event_consistency',
        'guard_match_reservation_recipient_transition',
        'assert_match_reservation_recipient_count',
        'reject_match_reservation_immutable_mutation'
      ]::text[])
  ) or exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where not trigger_row.tgisinternal
      and trigger_row.tgname = any (array[
        'matches_reservation_link_consistency',
        'court_reservations_match_link_consistency'
      ]::text[])
  ) then
    raise exception 'PRECHECK_FAILED: migration 034 target already exists';
  end if;
end;
$precheck$;

select pg_catalog.json_build_object(
  'ready', true,
  'migration', '034_backend_match_reservation_links',
  'matches', (
    select pg_catalog.count(*)
    from backend_match.matches
  ),
  'confirmed_reservations', (
    select pg_catalog.count(*)
    from backend_reservation.court_reservations
    where status = 'confirmed'
  ),
  'legacy_match_overlap_present', true,
  'd2_slot_hold_authority_present', true,
  'target_absent', true
) as precheck;

rollback;
