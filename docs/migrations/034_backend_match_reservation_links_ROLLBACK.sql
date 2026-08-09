-- 034_backend_match_reservation_links_ROLLBACK.sql
-- Fail-closed rollback. Refuses once any D3 link/event/recipient history exists.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_relation record;
  v_function pg_catalog.regprocedure;
begin
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'ROLLBACK_REFUSED: required owner role is unavailable';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_match', 'matches'),
      ('backend_match', 'match_reservation_links'),
      ('backend_match', 'match_reservation_events'),
      ('backend_match', 'match_reservation_event_recipients'),
      ('backend_reservation', 'court_reservations')
    ) expected(schema_name, relation_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = v_relation.schema_name
        and relation.relname = v_relation.relation_name
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          '034_backend_match_reservation_links:'
            || backend_auth.relation_fingerprint(
              relation.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'ROLLBACK_REFUSED: %.% fingerprint differs',
        v_relation.schema_name,
        v_relation.relation_name;
    end if;
  end loop;

  for v_function in
    select procedure_row.oid::pg_catalog.regprocedure
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
      and pg_catalog.pg_get_function_identity_arguments(procedure_row.oid) = ''
  loop
    if pg_catalog.obj_description(v_function::oid, 'pg_proc') is distinct from
      '034_backend_match_reservation_links:'
        || pg_catalog.md5(pg_catalog.pg_get_functiondef(v_function::oid)) then
      raise exception 'ROLLBACK_REFUSED: function % fingerprint differs',
        v_function;
    end if;
  end loop;

  if (
    select pg_catalog.count(*)
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
  ) <> 7 then
    raise exception 'ROLLBACK_REFUSED: migration function set differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

lock table
  backend_match.matches,
  backend_match.match_reservation_links,
  backend_match.match_reservation_events,
  backend_match.match_reservation_event_recipients,
  backend_reservation.court_reservations
in access exclusive mode;

do $empty_guard$
begin
  if exists (
    select 1 from backend_match.match_reservation_links
  ) or exists (
    select 1 from backend_match.match_reservation_events
  ) or exists (
    select 1 from backend_match.match_reservation_event_recipients
  ) then
    raise exception
      'ROLLBACK_REFUSED: match-reservation history exists; use a forward migration';
  end if;
end;
$empty_guard$;

drop trigger court_reservations_match_link_consistency
  on backend_reservation.court_reservations;
drop trigger matches_reservation_link_consistency
  on backend_match.matches;

drop table backend_match.match_reservation_event_recipients;
drop table backend_match.match_reservation_events;
drop table backend_match.match_reservation_links;

drop function backend_match.guard_match_reservation_link_transition();
drop function backend_match.assert_match_reservation_consistency();
drop function backend_match.guard_match_reservation_event_insert();
drop function backend_match.assert_match_reservation_link_event_consistency();
drop function backend_match.guard_match_reservation_recipient_transition();
drop function backend_match.assert_match_reservation_recipient_count();
drop function backend_match.reject_match_reservation_immutable_mutation();

alter table backend_match.matches
  drop constraint matches_id_owner_account_key;

do $restore_overlap_constraint$
declare
  v_extension_schema text;
begin
  select namespace.nspname into strict v_extension_schema
  from pg_catalog.pg_extension extension_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = extension_row.extnamespace
  where extension_row.extname = 'btree_gist';

  execute pg_catalog.format(
    'alter table backend_match.matches ' ||
    'add constraint matches_no_active_court_overlap ' ||
    'exclude using gist (' ||
    'court_id %1$I.gist_text_ops with =, ' ||
    'pg_catalog.int8range(' ||
    'starts_at, starts_at + duration_minutes::bigint * 60, ''[)''::text' ||
    ') with &&' ||
    ') where (status = any (' ||
    'array[''open'', ''searching'', ''confirmed'', ''upcoming'']::text[]' ||
    '))',
    v_extension_schema
  );
end;
$restore_overlap_constraint$;

do $restore_comments$
begin
  execute pg_catalog.format(
    'comment on table backend_match.matches is %L',
    '023_backend_match_description_updates:'
      || backend_auth.relation_fingerprint(
        'backend_match.matches'::pg_catalog.regclass
      )
  );

  execute pg_catalog.format(
    'comment on table backend_reservation.court_reservations is %L',
    '033_backend_reservation_persistence:'
      || backend_auth.relation_fingerprint(
        'backend_reservation.court_reservations'::pg_catalog.regclass
      )
  );
end;
$restore_comments$;

do $assertions$
begin
  if pg_catalog.to_regclass(
       'backend_match.match_reservation_links'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.match_reservation_events'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_match.match_reservation_event_recipients'
     ) is not null then
    raise exception 'ROLLBACK_FAILED: migration tables remain';
  end if;

  if pg_catalog.obj_description(
       'backend_match.matches'::pg_catalog.regclass,
       'pg_class'
     ) is distinct from
       '023_backend_match_description_updates:'
         || backend_auth.relation_fingerprint(
           'backend_match.matches'::pg_catalog.regclass
         )
     or pg_catalog.obj_description(
       'backend_reservation.court_reservations'::pg_catalog.regclass,
       'pg_class'
     ) is distinct from
       '033_backend_reservation_persistence:'
         || backend_auth.relation_fingerprint(
           'backend_reservation.court_reservations'::pg_catalog.regclass
         ) then
    raise exception 'ROLLBACK_FAILED: parent relation restore differs';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
      'backend_match.matches'::pg_catalog.regclass
      and constraint_row.conname = 'matches_no_active_court_overlap'
      and constraint_row.contype = 'x'
      and constraint_row.convalidated
  ) then
    raise exception 'ROLLBACK_FAILED: legacy match overlap constraint was not restored';
  end if;
end;
$assertions$;

reset role;
commit;

select '034_backend_match_reservation_links rolled back before runtime history' as result;
