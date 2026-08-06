-- Fail-closed rollback for an unused migration 033.
-- Once any reservation, operation, encrypted snapshot, or audit event exists,
-- preserve the schema and use a reviewed forward migration.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_name text;
  v_relation_oid oid;
begin
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot assume backend_auth_owner';
  end if;

  if pg_catalog.to_regnamespace('backend_reservation') is null then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 033 schema is missing';
  end if;

  foreach v_name in array array[
    'court_reservations',
    'reservation_operations',
    'reservation_operation_client_snapshots',
    'reservation_admin_read_audit_events'
  ]
  loop
    v_relation_oid := pg_catalog.to_regclass('backend_reservation.' || v_name);
    if v_relation_oid is null
       or pg_catalog.obj_description(v_relation_oid, 'pg_class') <>
         '033_backend_reservation_persistence:'
           || backend_auth.relation_fingerprint(v_relation_oid::pg_catalog.regclass) then
      raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 033 relation % differs',
        v_name;
    end if;
  end loop;

  if pg_catalog.to_regprocedure(
       'backend_reservation.reject_admin_read_audit_mutation()'
     ) is null
     or pg_catalog.obj_description(
       'backend_reservation.reject_admin_read_audit_mutation()'::pg_catalog.regprocedure,
       'pg_proc'
     ) <> '033_backend_reservation_persistence:'
       || pg_catalog.md5(pg_catalog.pg_get_functiondef(
         'backend_reservation.reject_admin_read_audit_mutation()'::pg_catalog.regprocedure
       )) then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: migration 033 function differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table
  backend_reservation.reservation_admin_read_audit_events,
  backend_reservation.reservation_operation_client_snapshots,
  backend_reservation.reservation_operations,
  backend_reservation.court_reservations
in access exclusive mode;

do $empty_guard$
begin
  if exists (select 1 from backend_reservation.court_reservations)
     or exists (select 1 from backend_reservation.reservation_operations)
     or exists (
       select 1
       from backend_reservation.reservation_operation_client_snapshots
     )
     or exists (
       select 1
       from backend_reservation.reservation_admin_read_audit_events
     ) then
    raise exception 'ROLLBACK_REFUSED: reservation or audit history exists; use a forward migration';
  end if;
end;
$empty_guard$;

drop table backend_reservation.reservation_admin_read_audit_events;
drop table backend_reservation.reservation_operation_client_snapshots;
drop table backend_reservation.reservation_operations;
drop table backend_reservation.court_reservations;
drop function backend_reservation.reject_admin_read_audit_mutation();
drop schema backend_reservation;

do $assertions$
begin
  if pg_catalog.to_regnamespace('backend_reservation') is not null then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 033 schema remains';
  end if;
end;
$assertions$;

reset role;
commit;

select '033_backend_reservation_persistence rolled back before first write'
  as result;
