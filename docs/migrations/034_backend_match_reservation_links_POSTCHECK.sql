-- 034_backend_match_reservation_links_POSTCHECK.sql
-- Read-only verification after a separately approved application of migration 034.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $postcheck$
declare
  v_expected record;
  v_actual text[];
  v_relation oid;
  v_function pg_catalog.regprocedure;
begin
  for v_expected in
    select *
    from (values
      (
        'match_reservation_links',
        array[
          'link_id', 'match_id', 'reservation_id', 'owner_account_id',
          'state', 'provider_appointment_id', 'provider_record_id',
          'target_service_id', 'target_resource_id', 'target_datetime',
          'target_datetime_text', 'target_end_datetime',
          'target_end_datetime_text', 'observed_reservation_version',
          'version', 'created_at', 'updated_at', 'released_at',
          'release_reason'
        ]::text[],
        array[
          'match_reservation_links_binding_key',
          'match_reservation_links_match_owner_fkey',
          'match_reservation_links_observed_version_check',
          'match_reservation_links_pkey',
          'match_reservation_links_provider_id_check',
          'match_reservation_links_release_shape_check',
          'match_reservation_links_reservation_owner_fkey',
          'match_reservation_links_state_check',
          'match_reservation_links_target_check',
          'match_reservation_links_time_check',
          'match_reservation_links_version_check'
        ]::text[],
        array[
          'match_reservation_links_active_match_uq',
          'match_reservation_links_active_reservation_uq',
          'match_reservation_links_binding_key',
          'match_reservation_links_owner_history_idx',
          'match_reservation_links_pkey'
        ]::text[]
      ),
      (
        'match_reservation_events',
        array[
          'event_id', 'link_id', 'match_id', 'reservation_id',
          'owner_account_id', 'event_type', 'reservation_version',
          'expected_recipient_count',
          'previous_service_id', 'previous_resource_id',
          'previous_datetime', 'previous_datetime_text',
          'previous_end_datetime', 'previous_end_datetime_text',
          'current_service_id', 'current_resource_id', 'current_datetime',
          'current_datetime_text', 'current_end_datetime',
          'current_end_datetime_text', 'occurred_at'
        ]::text[],
        array[
          'match_reservation_events_dedup_key',
          'match_reservation_events_link_binding_fkey',
          'match_reservation_events_pkey',
          'match_reservation_events_recipient_count_check',
          'match_reservation_events_snapshot_shape_check',
          'match_reservation_events_snapshot_value_check',
          'match_reservation_events_time_check',
          'match_reservation_events_type_check',
          'match_reservation_events_version_check'
        ]::text[],
        array[
          'match_reservation_events_dedup_key',
          'match_reservation_events_match_time_idx',
          'match_reservation_events_pkey'
        ]::text[]
      ),
      (
        'match_reservation_event_recipients',
        array[
          'event_id', 'recipient_account_id', 'created_at', 'read_at',
          'version'
        ]::text[],
        array[
          'match_reservation_event_recipients_account_fkey',
          'match_reservation_event_recipients_event_fkey',
          'match_reservation_event_recipients_pkey',
          'match_reservation_event_recipients_read_shape_check',
          'match_reservation_event_recipients_time_check'
        ]::text[],
        array[
          'match_reservation_event_recipients_feed_idx',
          'match_reservation_event_recipients_pkey',
          'match_reservation_event_recipients_unread_idx'
        ]::text[]
      )
    ) expected(table_name, columns, constraints, indexes)
  loop
    v_relation := pg_catalog.to_regclass(
      'backend_match.' || v_expected.table_name
    )::oid;

    if v_relation is null
       or pg_catalog.pg_get_userbyid((
         select relation.relowner
         from pg_catalog.pg_class relation
         where relation.oid = v_relation
       )) <> 'backend_auth_owner'
       or pg_catalog.obj_description(v_relation, 'pg_class') is distinct from
         '034_backend_match_reservation_links:'
           || backend_auth.relation_fingerprint(
             v_relation::pg_catalog.regclass
           ) then
      raise exception 'POSTCHECK_FAILED: backend_match.% boundary or fingerprint differs',
        v_expected.table_name;
    end if;

    select pg_catalog.array_agg(
      attribute.attname::text order by attribute.attnum
    ) into v_actual
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = v_relation
      and attribute.attnum > 0
      and not attribute.attisdropped;
    if v_actual is distinct from v_expected.columns then
      raise exception 'POSTCHECK_FAILED: backend_match.% columns differ',
        v_expected.table_name;
    end if;

    select pg_catalog.array_agg(
      constraint_row.conname::text
      order by constraint_row.conname::text
    ) into v_actual
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = v_relation;
    if v_actual is distinct from v_expected.constraints then
      raise exception 'POSTCHECK_FAILED: backend_match.% constraints differ',
        v_expected.table_name;
    end if;

    select pg_catalog.array_agg(
      index_row.relname::text order by index_row.relname::text
    ) into v_actual
    from pg_catalog.pg_index index_binding
    join pg_catalog.pg_class index_row
      on index_row.oid = index_binding.indexrelid
    where index_binding.indrelid = v_relation;
    if v_actual is distinct from v_expected.indexes then
      raise exception 'POSTCHECK_FAILED: backend_match.% indexes differ',
        v_expected.table_name;
    end if;
  end loop;

  if pg_catalog.obj_description(
       'backend_match.matches'::pg_catalog.regclass,
       'pg_class'
     ) is distinct from
       '034_backend_match_reservation_links:'
         || backend_auth.relation_fingerprint(
           'backend_match.matches'::pg_catalog.regclass
         )
     or pg_catalog.obj_description(
       'backend_reservation.court_reservations'::pg_catalog.regclass,
       'pg_class'
     ) is distinct from
       '034_backend_match_reservation_links:'
         || backend_auth.relation_fingerprint(
           'backend_reservation.court_reservations'::pg_catalog.regclass
         ) then
    raise exception 'POSTCHECK_FAILED: modified parent relation fingerprint differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
      'backend_match.matches'::pg_catalog.regclass
      and constraint_row.conname = 'matches_no_active_court_overlap'
  ) or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
      'backend_match.matches'::pg_catalog.regclass
      and constraint_row.conname = 'matches_id_owner_account_key'
      and constraint_row.contype = 'u'
      and constraint_row.convalidated
  ) then
    raise exception 'POSTCHECK_FAILED: match planning/court ownership boundary differs';
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
    raise exception 'POSTCHECK_FAILED: D2 canonical slot hold authority differs';
  end if;

  select pg_catalog.array_agg(
    trigger_row.tgname::text order by trigger_row.tgname::text
  ) into v_actual
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid =
    'backend_match.match_reservation_links'::pg_catalog.regclass
    and not trigger_row.tgisinternal;
  if v_actual is distinct from array[
    'match_reservation_links_consistency',
    'match_reservation_links_delete_guard',
    'match_reservation_links_event_consistency',
    'match_reservation_links_transition_guard'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: link triggers differ';
  end if;

  select pg_catalog.array_agg(
    trigger_row.tgname::text order by trigger_row.tgname::text
  ) into v_actual
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid =
    'backend_match.match_reservation_events'::pg_catalog.regclass
    and not trigger_row.tgisinternal;
  if v_actual is distinct from array[
    'match_reservation_events_insert_guard',
    'match_reservation_events_mutation_guard',
    'match_reservation_events_recipient_count_consistency'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: event triggers differ';
  end if;

  select pg_catalog.array_agg(
    trigger_row.tgname::text order by trigger_row.tgname::text
  ) into v_actual
  from pg_catalog.pg_trigger trigger_row
  where trigger_row.tgrelid =
    'backend_match.match_reservation_event_recipients'::pg_catalog.regclass
    and not trigger_row.tgisinternal;
  if v_actual is distinct from array[
    'match_reservation_event_recipients_delete_guard',
    'match_reservation_event_recipients_transition_guard',
    'match_reservation_recipients_count_consistency'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: recipient triggers differ';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
      'backend_match.matches'::pg_catalog.regclass
      and trigger_row.tgname = 'matches_reservation_link_consistency'
      and trigger_row.tgdeferrable
      and trigger_row.tginitdeferred
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
      'backend_reservation.court_reservations'::pg_catalog.regclass
      and trigger_row.tgname = 'court_reservations_match_link_consistency'
      and trigger_row.tgdeferrable
      and trigger_row.tginitdeferred
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid =
      'backend_match.match_reservation_links'::pg_catalog.regclass
      and trigger_row.tgname = 'match_reservation_links_consistency'
      and trigger_row.tgdeferrable
      and trigger_row.tginitdeferred
  ) then
    raise exception 'POSTCHECK_FAILED: deferred cross-domain consistency triggers differ';
  end if;

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
           || pg_catalog.md5(
             pg_catalog.pg_get_functiondef(v_function::oid)
           )
       or pg_catalog.has_function_privilege(
         'backend_auth_app', v_function, 'EXECUTE'
       )
       or exists (
         select 1
         from pg_catalog.pg_proc procedure_row
         cross join lateral pg_catalog.aclexplode(
           coalesce(
             procedure_row.proacl,
             pg_catalog.acldefault('f', procedure_row.proowner)
           )
         ) acl_row
         where procedure_row.oid = v_function::oid
           and acl_row.grantee = 0
           and acl_row.privilege_type = 'EXECUTE'
       ) then
      raise exception 'POSTCHECK_FAILED: function % fingerprint or ACL differs',
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
      and pg_catalog.pg_get_function_identity_arguments(procedure_row.oid) = ''
  ) <> 7 then
    raise exception 'POSTCHECK_FAILED: migration function count differs';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_links',
       'SELECT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_links',
       'link_id',
       'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_links',
       'state',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_links',
       'match_id',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_links',
       'DELETE,TRUNCATE'
     ) then
    raise exception 'POSTCHECK_FAILED: link ACL differs';
  end if;

  if not pg_catalog.has_column_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_events',
       'event_id',
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_events',
       'UPDATE,DELETE,TRUNCATE'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_event_recipients',
       'read_at',
       'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_event_recipients',
       'created_at',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_event_recipients',
       'DELETE,TRUNCATE'
     ) then
    raise exception 'POSTCHECK_FAILED: event/recipient ACL differs';
  end if;

  if exists (
    select 1 from backend_match.match_reservation_links
  ) or exists (
    select 1 from backend_match.match_reservation_events
  ) or exists (
    select 1 from backend_match.match_reservation_event_recipients
  ) then
    raise exception 'POSTCHECK_FAILED: migration 034 target must start empty';
  end if;
end;
$postcheck$;

select pg_catalog.json_build_object(
  'verified', true,
  'migration', '034_backend_match_reservation_links',
  'new_tables_empty', true,
  'runtime_connected', false,
  'match_overlap_removed', true,
  'd2_slot_hold_authority_preserved', true
) as postcheck;

rollback;
