-- Read-only postcheck for 033_backend_reservation_persistence.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_expected record;
  v_relation_oid oid;
  v_actual_columns text[];
  v_actual_constraints text[];
  v_actual_indexes text[];
  v_actual_insert_columns text[];
  v_actual_update_columns text[];
begin
  if pg_catalog.to_regnamespace('backend_reservation') is null
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_reservation'
     )) <> 'backend_auth_owner'
     or not pg_catalog.has_schema_privilege(
       'backend_auth_app', 'backend_reservation', 'USAGE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app', 'backend_reservation', 'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'public', 'backend_reservation', 'USAGE, CREATE'
     ) then
    raise exception 'POSTCHECK_FAILED: reservation schema boundary differs';
  end if;

  for v_expected in
    select *
    from (values
      (
        'court_reservations',
        array[
          'reservation_id', 'owner_account_id', 'status',
          'target_service_id', 'target_resource_id', 'target_datetime',
          'target_datetime_text', 'target_end_datetime',
          'target_end_datetime_text', 'yclients_company_id',
          'yclients_appointment_id', 'yclients_record_id',
          'yclients_record_hash_ciphertext', 'yclients_record_hash_nonce',
          'yclients_record_hash_auth_tag', 'yclients_record_hash_algorithm',
          'yclients_record_hash_encryption_key_version',
          'yclients_record_hash_digest',
          'yclients_record_hash_digest_key_version', 'yclients_client_id',
          'version', 'created_at', 'updated_at', 'status_changed_at', 'terminal_at'
        ]::text[],
        array[
          'court_reservations_binding_status_check',
          'court_reservations_owner_fkey',
          'court_reservations_owner_key',
          'court_reservations_pkey',
          'court_reservations_provider_id_check',
          'court_reservations_record_hash_shape_check',
          'court_reservations_status_check',
          'court_reservations_target_check',
          'court_reservations_time_check',
          'court_reservations_version_check'
        ]::text[],
        array[
          'court_reservations_appointment_lookup_idx',
          'court_reservations_client_lookup_idx',
          'court_reservations_owner_time_idx',
          'court_reservations_record_binding_uq',
          'court_reservations_record_hash_binding_uq'
        ]::text[]
      ),
      (
        'reservation_operations',
        array[
          'operation_id', 'reservation_id', 'owner_account_id',
          'actor_account_id', 'operation_type', 'status', 'idempotency_key',
          'request_digest', 'request_digest_version', 'yclients_company_id',
          'external_api_id', 'target_service_id', 'target_resource_id',
          'target_datetime', 'target_datetime_text', 'target_end_datetime',
          'target_end_datetime_text', 'provider_appointment_id',
          'provider_record_id', 'provider_record_hash_ciphertext',
          'provider_record_hash_nonce', 'provider_record_hash_auth_tag',
          'provider_record_hash_algorithm',
          'provider_record_hash_encryption_key_version',
          'provider_record_hash_digest',
          'provider_record_hash_digest_key_version', 'client_snapshot_digest',
          'client_snapshot_digest_key_version', 'previous_reservation_status',
          'provider_attempt_started_at', 'provider_attempt_finished_at',
          'unknown_at', 'terminal_at', 'reconciled_at',
          'reconciliation_outcome', 'rejection_reason',
          'reconciliation_attempts', 'last_reconciliation_at', 'version',
          'created_at', 'updated_at'
        ]::text[],
        array[
          'reservation_operations_actor_fkey',
          'reservation_operations_digest_check',
          'reservation_operations_external_reference_check',
          'reservation_operations_operation_owner_key',
          'reservation_operations_operation_reservation_key',
          'reservation_operations_operation_reservation_owner_key',
          'reservation_operations_operation_snapshot_key',
          'reservation_operations_owner_idempotency_key',
          'reservation_operations_pkey',
          'reservation_operations_previous_status_check',
          'reservation_operations_provider_binding_shape_check',
          'reservation_operations_reconciliation_check',
          'reservation_operations_reservation_owner_fkey',
          'reservation_operations_slot_hold_binding_key',
          'reservation_operations_status_check',
          'reservation_operations_target_shape_check',
          'reservation_operations_terminal_shape_check',
          'reservation_operations_time_check',
          'reservation_operations_type_check',
          'reservation_operations_version_check'
        ]::text[],
        array[
          'reservation_operations_active_reservation_uq',
          'reservation_operations_external_api_lookup_idx',
          'reservation_operations_provider_record_lookup_idx',
          'reservation_operations_reservation_time_idx',
          'reservation_operations_unknown_reconciliation_idx'
        ]::text[]
      ),
      (
        'reservation_slot_holds',
        array[
          'hold_id', 'reservation_id', 'owner_account_id', 'operation_id',
          'operation_type', 'hold_kind', 'yclients_company_id',
          'target_service_id', 'target_resource_id', 'starts_at', 'ends_at',
          'version', 'created_at', 'updated_at', 'released_at'
        ]::text[],
        array[
          'reservation_slot_holds_kind_check',
          'reservation_slot_holds_no_overlap',
          'reservation_slot_holds_operation_fkey',
          'reservation_slot_holds_pkey',
          'reservation_slot_holds_reservation_owner_fkey',
          'reservation_slot_holds_target_check',
          'reservation_slot_holds_time_check',
          'reservation_slot_holds_version_check'
        ]::text[],
        array[
          'reservation_slot_holds_current_reservation_uq',
          'reservation_slot_holds_owner_time_idx',
          'reservation_slot_holds_reschedule_operation_uq'
        ]::text[]
      ),
      (
        'reservation_operation_client_snapshots',
        array[
          'operation_id', 'owner_account_id', 'ciphertext', 'nonce', 'auth_tag',
          'algorithm', 'wrapped_data_key_ciphertext', 'wrapped_data_key_nonce',
          'wrapped_data_key_auth_tag', 'wrapping_algorithm',
          'wrapping_key_version', 'digest_key_version', 'aad_version', 'version',
          'created_at', 'updated_at', 'crypto_destroyed_at'
        ]::text[],
        array[
          'reservation_operation_client_snapshots_crypto_check',
          'reservation_operation_client_snapshots_operation_owner_fkey',
          'reservation_operation_client_snapshots_pkey',
          'reservation_operation_client_snapshots_time_check'
        ]::text[],
        array[]::text[]
      ),
      (
        'reservation_admin_read_audit_events',
        array[
          'event_order', 'event_id', 'event_type', 'actor_account_id',
          'actor_role', 'reservation_id', 'operation_id', 'occurred_at',
          'purpose_code', 'endpoint_code', 'request_id', 'correlation_id'
        ]::text[],
        array[
          'reservation_admin_read_audit_events_actor_fkey',
          'reservation_admin_read_audit_events_metadata_check',
          'reservation_admin_read_audit_events_operation_fkey',
          'reservation_admin_read_audit_events_order_key',
          'reservation_admin_read_audit_events_pkey',
          'reservation_admin_read_audit_events_role_check',
          'reservation_admin_read_audit_events_time_check',
          'reservation_admin_read_audit_events_type_check'
        ]::text[],
        array[
          'reservation_admin_read_audit_events_actor_time_idx',
          'reservation_admin_read_audit_events_operation_time_idx',
          'reservation_admin_read_audit_events_reservation_time_idx'
        ]::text[]
      )
    ) expected(table_name, columns, constraints, indexes)
  loop
    v_relation_oid := pg_catalog.to_regclass(
      'backend_reservation.' || v_expected.table_name
    );
    if v_relation_oid is null then
      raise exception 'POSTCHECK_FAILED: migration 033 table % is missing',
        v_expected.table_name;
    end if;

    select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
    into v_actual_columns
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = v_relation_oid
      and attribute.attnum > 0
      and not attribute.attisdropped;

    select pg_catalog.array_agg(constraint_row.conname order by constraint_row.conname)
    into v_actual_constraints
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = v_relation_oid;

    select coalesce(
      pg_catalog.array_agg(index_relation.relname order by index_relation.relname),
      array[]::text[]
    )
    into v_actual_indexes
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    where index_row.indrelid = v_relation_oid
      and not exists (
        select 1
        from pg_catalog.pg_constraint constraint_row
        where constraint_row.conindid = index_row.indexrelid
      );

    if v_actual_columns is distinct from v_expected.columns
       or v_actual_constraints is distinct from v_expected.constraints
       or v_actual_indexes is distinct from v_expected.indexes
       or pg_catalog.pg_get_userbyid((
         select relation.relowner
         from pg_catalog.pg_class relation
         where relation.oid = v_relation_oid
       )) <> 'backend_auth_owner'
       or pg_catalog.obj_description(v_relation_oid, 'pg_class') <>
         '033_backend_reservation_persistence:'
           || backend_auth.relation_fingerprint(v_relation_oid::pg_catalog.regclass)
       or pg_catalog.has_table_privilege(
         'public', v_relation_oid,
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
       )
       or pg_catalog.has_table_privilege(
         'backend_auth_app', v_relation_oid,
         'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
       ) then
      raise exception 'POSTCHECK_FAILED: migration 033 relation % differs',
        v_expected.table_name;
    end if;
  end loop;

  if not exists (
       select 1
       from pg_catalog.pg_extension extension_row
       join pg_catalog.pg_namespace namespace
         on namespace.oid = extension_row.extnamespace
       join pg_catalog.pg_opclass opclass
         on opclass.opcnamespace = namespace.oid
        and opclass.opcname = 'gist_int8_ops'
        and opclass.opcintype = 'pg_catalog.int8'::pg_catalog.regtype
       join pg_catalog.pg_am access_method
         on access_method.oid = opclass.opcmethod
        and access_method.amname = 'gist'
       where extension_row.extname = 'btree_gist'
         and namespace.nspname = 'public'
     )
     or not exists (
       select 1
       from pg_catalog.pg_extension extension_row
       join pg_catalog.pg_namespace namespace
         on namespace.oid = extension_row.extnamespace
       join pg_catalog.pg_opclass opclass
         on opclass.opcnamespace = namespace.oid
        and opclass.opcname = 'gist_uuid_ops'
        and opclass.opcintype = 'pg_catalog.uuid'::pg_catalog.regtype
       join pg_catalog.pg_am access_method
         on access_method.oid = opclass.opcmethod
        and access_method.amname = 'gist'
       where extension_row.extname = 'btree_gist'
         and namespace.nspname = 'public'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       join pg_catalog.pg_index index_row
         on index_row.indexrelid = constraint_row.conindid
       join pg_catalog.pg_class index_relation
         on index_relation.oid = index_row.indexrelid
       join pg_catalog.pg_am access_method
         on access_method.oid = index_relation.relam
       where constraint_row.conrelid =
           'backend_reservation.reservation_slot_holds'::pg_catalog.regclass
         and constraint_row.conname = 'reservation_slot_holds_no_overlap'
         and constraint_row.contype = 'x'
         and access_method.amname = 'gist'
         and (
           select pg_catalog.array_agg(operator.oprname::text order by item.position)
           from pg_catalog.unnest(constraint_row.conexclop)
             with ordinality item(operator_oid, position)
           join pg_catalog.pg_operator operator
             on operator.oid = item.operator_oid
         ) = array['<>', '=', '=', '&&']::text[]
         and (
           select pg_catalog.array_agg(opclass.opcname::text order by item.position)
           from pg_catalog.unnest(index_row.indclass)
             with ordinality item(opclass_oid, position)
           join pg_catalog.pg_opclass opclass
             on opclass.oid = item.opclass_oid
         ) = array[
           'gist_uuid_ops', 'gist_int8_ops', 'gist_int8_ops', 'range_ops'
         ]::text[]
         and (
           select pg_catalog.array_agg(namespace.nspname::text order by item.position)
           from pg_catalog.unnest(index_row.indclass)
             with ordinality item(opclass_oid, position)
           join pg_catalog.pg_opclass opclass
             on opclass.oid = item.opclass_oid
           join pg_catalog.pg_namespace namespace
             on namespace.oid = opclass.opcnamespace
         ) = array['public', 'public', 'public', 'pg_catalog']::text[]
         and pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.lower(pg_catalog.pg_get_expr(
             index_row.indexprs,
             index_row.indrelid,
             true
           )),
           '[[:space:]]+',
           ' ',
           'g'
         )) = 'tstzrange(starts_at, ends_at, ''[)''::text)'
         and pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.lower(pg_catalog.pg_get_expr(
             index_row.indpred,
             index_row.indrelid,
             true
           )),
           '[[:space:]]+',
           ' ',
           'g'
         )) in ('released_at is null', '(released_at is null)')
     ) then
    raise exception 'POSTCHECK_FAILED: interval overlap exclusion differs';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_reservation.court_reservations', 'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_reservation.reservation_operations', 'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_reservation.reservation_slot_holds', 'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_reservation.reservation_operation_client_snapshots',
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_reservation.reservation_admin_read_audit_events',
       'SELECT, UPDATE, DELETE, TRUNCATE'
     ) then
    raise exception 'POSTCHECK_FAILED: migration 033 table ACL differs';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_actual_insert_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid =
      'backend_reservation.reservation_admin_read_audit_events'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and pg_catalog.has_column_privilege(
      'backend_auth_app',
      attribute.attrelid,
      attribute.attname,
      'INSERT'
    );

  if v_actual_insert_columns is distinct from array[
       'event_id', 'event_type', 'actor_account_id', 'actor_role',
       'reservation_id', 'operation_id', 'occurred_at', 'purpose_code',
       'endpoint_code', 'request_id', 'correlation_id'
     ]::text[]
     or not pg_catalog.has_sequence_privilege(
       'backend_auth_app',
       'backend_reservation.reservation_admin_read_audit_events_event_order_seq',
       'USAGE'
     )
     or pg_catalog.has_sequence_privilege(
       'public',
       'backend_reservation.reservation_admin_read_audit_events_event_order_seq',
       'USAGE, SELECT, UPDATE'
     ) then
    raise exception 'POSTCHECK_FAILED: admin audit append ACL differs';
  end if;

  if pg_catalog.to_regprocedure(
       'backend_reservation.guard_slot_hold_transition()'
     ) is null
     or pg_catalog.obj_description(
       'backend_reservation.guard_slot_hold_transition()'::pg_catalog.regprocedure,
       'pg_proc'
     ) <> '033_backend_reservation_persistence:'
       || pg_catalog.md5(pg_catalog.pg_get_functiondef(
         'backend_reservation.guard_slot_hold_transition()'::pg_catalog.regprocedure
       ))
     or (
       select pg_catalog.array_agg(
         trigger_row.tgname::text order by trigger_row.tgname::text
       )
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
         'backend_reservation.reservation_slot_holds'::pg_catalog.regclass
         and not trigger_row.tgisinternal
     ) is distinct from array[
       'reservation_slot_holds_transition_guard'
     ]::text[] then
    raise exception 'POSTCHECK_FAILED: slot hold transition guard differs';
  end if;

  if pg_catalog.to_regprocedure(
       'backend_reservation.guard_client_snapshot_transition()'
     ) is null
     or pg_catalog.obj_description(
       'backend_reservation.guard_client_snapshot_transition()'::pg_catalog.regprocedure,
       'pg_proc'
     ) <> '033_backend_reservation_persistence:'
       || pg_catalog.md5(pg_catalog.pg_get_functiondef(
         'backend_reservation.guard_client_snapshot_transition()'::pg_catalog.regprocedure
       ))
     or (
       select pg_catalog.array_agg(
         trigger_row.tgname::text order by trigger_row.tgname::text
       )
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
         'backend_reservation.reservation_operation_client_snapshots'::pg_catalog.regclass
         and not trigger_row.tgisinternal
     ) is distinct from array[
       'reservation_operation_client_snapshots_transition_guard'
     ]::text[] then
    raise exception 'POSTCHECK_FAILED: snapshot erase guard differs';
  end if;

  if pg_catalog.to_regprocedure(
       'backend_reservation.reject_admin_read_audit_mutation()'
     ) is null
     or pg_catalog.obj_description(
       'backend_reservation.reject_admin_read_audit_mutation()'::pg_catalog.regprocedure,
       'pg_proc'
     ) <> '033_backend_reservation_persistence:'
       || pg_catalog.md5(pg_catalog.pg_get_functiondef(
         'backend_reservation.reject_admin_read_audit_mutation()'::pg_catalog.regprocedure
       ))
     or (
       select pg_catalog.array_agg(
         trigger_row.tgname::text order by trigger_row.tgname::text
       )
       from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid =
         'backend_reservation.reservation_admin_read_audit_events'::pg_catalog.regclass
         and not trigger_row.tgisinternal
     ) is distinct from array[
       'reservation_admin_read_audit_events_truncate_guard',
       'reservation_admin_read_audit_events_update_delete_guard'
     ]::text[] then
    raise exception 'POSTCHECK_FAILED: admin audit immutability boundary differs';
  end if;

  if exists (select 1 from backend_reservation.court_reservations)
     or exists (select 1 from backend_reservation.reservation_operations)
     or exists (select 1 from backend_reservation.reservation_slot_holds)
     or exists (
       select 1
       from backend_reservation.reservation_operation_client_snapshots
     )
     or exists (
       select 1
       from backend_reservation.reservation_admin_read_audit_events
     ) then
    raise exception 'POSTCHECK_FAILED: migration 033 target must start empty';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '033_backend_reservation_persistence',
  'runtime_connected', false,
  'row_counts', pg_catalog.jsonb_build_object(
    'court_reservations', (
      select pg_catalog.count(*)
      from backend_reservation.court_reservations
    ),
    'reservation_operations', (
      select pg_catalog.count(*)
      from backend_reservation.reservation_operations
    ),
    'reservation_slot_holds', (
      select pg_catalog.count(*)
      from backend_reservation.reservation_slot_holds
    ),
    'reservation_operation_client_snapshots', (
      select pg_catalog.count(*)
      from backend_reservation.reservation_operation_client_snapshots
    ),
    'reservation_admin_read_audit_events', (
      select pg_catalog.count(*)
      from backend_reservation.reservation_admin_read_audit_events
    )
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'court_reservations', backend_auth.relation_fingerprint(
      'backend_reservation.court_reservations'::pg_catalog.regclass
    ),
    'reservation_operations', backend_auth.relation_fingerprint(
      'backend_reservation.reservation_operations'::pg_catalog.regclass
    ),
    'reservation_slot_holds', backend_auth.relation_fingerprint(
      'backend_reservation.reservation_slot_holds'::pg_catalog.regclass
    ),
    'reservation_operation_client_snapshots', backend_auth.relation_fingerprint(
      'backend_reservation.reservation_operation_client_snapshots'::pg_catalog.regclass
    ),
    'reservation_admin_read_audit_events', backend_auth.relation_fingerprint(
      'backend_reservation.reservation_admin_read_audit_events'::pg_catalog.regclass
    )
  )
) as backend_reservation_persistence_postcheck;

rollback;
