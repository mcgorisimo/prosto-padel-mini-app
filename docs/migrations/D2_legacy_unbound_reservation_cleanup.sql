-- REVIEW-ONLY DATA REPAIR. DO NOT RUN WITHOUT THE EXACT OWNER APPROVAL.
-- This is not a migration and does not change schema.
\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\pset format unaligned
\pset tuples_only on

-- The future operator must mount a root-owned 0700 host directory here.
\! test "$(stat -c '%u:%a' /cleanup-artifacts)" = "0:700"
\if :SHELL_ERROR
  \echo 'D2_LEGACY_UNBOUND_CLEANUP_STOP: backup parent precheck failed'
  \quit 3
\endif

-- mkdir is the atomic no-clobber claim. A concurrent or repeated invocation
-- fails here because the fixed directory already exists. The script never
-- removes this directory, including after rollback or a partial backup.
\! umask 077 && mkdir -m 0700 /cleanup-artifacts/d2-legacy-unbound-reservations-claim
\if :SHELL_ERROR
  \echo 'D2_LEGACY_UNBOUND_CLEANUP_STOP: backup claim already exists or failed'
  \quit 3
\endif
\! test "$(stat -c '%u:%a' /cleanup-artifacts/d2-legacy-unbound-reservations-claim)" = "0:700"
\if :SHELL_ERROR
  \echo 'D2_LEGACY_UNBOUND_CLEANUP_STOP: backup claim ownership or mode differs'
  \quit 3
\endif

begin isolation level serializable;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '60s';
set local role backend_auth_owner;
set local search_path = pg_catalog, pg_temp;

do $precheck$
declare
  v_pending_ids constant uuid[] := array[
    '4257aa93-00ee-4c2d-b971-1111a07a71f5',
    '1e1fa95a-c042-4141-a922-29a0d78bf61f',
    'd7a8a984-7131-4047-94da-38e39c5b597a',
    '48c74dee-5248-4f75-8fc7-cfafc4a3223c',
    '94105b19-c497-4ff3-816b-bc28691daab5'
  ]::uuid[];
  v_unknown_ids constant uuid[] := array[
    '3d49b170-61a6-4b77-b497-ad62b4f414f6',
    'b286b04e-66af-4237-84fb-10bc2a9c99c9',
    '953f1810-9a65-4a1b-bee5-c2b9d9cd4f12'
  ]::uuid[];
  v_target_ids constant uuid[] := v_pending_ids || v_unknown_ids;
  v_negative_control constant uuid :=
    '2cf39988-358d-4009-b64c-c017d3c1d0b5'::uuid;
  v_cleanup_at bigint :=
    pg_catalog.floor(
      pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()) * 1000
    )::bigint;
  v_count bigint;
  v_latest_updated_at bigint;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(2079564, 20260809) then
    raise exception using
      errcode = '55P03',
      message = 'D2_LEGACY_UNBOUND_CLEANUP_PRECHECK: advisory lock unavailable';
  end if;

  -- Lock order is reservation -> operation -> hold -> snapshot.
  perform reservation_row.reservation_id
  from backend_reservation.court_reservations reservation_row
  where reservation_row.reservation_id = any (
    v_target_ids || array[v_negative_control]::uuid[]
  )
  order by reservation_row.reservation_id
  for update;
  get diagnostics v_count = row_count;
  if v_count <> 9 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_PRECHECK: reservation count differs';
  end if;

  perform operation_row.operation_id
  from backend_reservation.reservation_operations operation_row
  where operation_row.reservation_id = any (v_target_ids)
  order by operation_row.reservation_id, operation_row.operation_id
  for update;
  get diagnostics v_count = row_count;
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_PRECHECK: operation count differs';
  end if;

  perform hold_row.hold_id
  from backend_reservation.reservation_slot_holds hold_row
  where hold_row.reservation_id = any (v_target_ids)
  order by hold_row.reservation_id, hold_row.hold_id
  for update;

  perform snapshot_row.operation_id
  from backend_reservation.reservation_operation_client_snapshots snapshot_row
  where snapshot_row.operation_id in (
    select operation_row.operation_id
    from backend_reservation.reservation_operations operation_row
    where operation_row.reservation_id = any (v_target_ids)
  )
  order by snapshot_row.operation_id
  for update;
  get diagnostics v_count = row_count;
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_PRECHECK: snapshot count differs';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.court_reservations reservation_row
  join (
    values
      ('b286b04e-66af-4237-84fb-10bc2a9c99c9'::uuid, 'unknown'::text),
      ('953f1810-9a65-4a1b-bee5-c2b9d9cd4f12'::uuid, 'unknown'::text),
      ('3d49b170-61a6-4b77-b497-ad62b4f414f6'::uuid, 'unknown'::text),
      ('4257aa93-00ee-4c2d-b971-1111a07a71f5'::uuid, 'pending_confirmation'::text),
      ('1e1fa95a-c042-4141-a922-29a0d78bf61f'::uuid, 'pending_confirmation'::text),
      ('d7a8a984-7131-4047-94da-38e39c5b597a'::uuid, 'pending_confirmation'::text),
      ('48c74dee-5248-4f75-8fc7-cfafc4a3223c'::uuid, 'pending_confirmation'::text),
      ('94105b19-c497-4ff3-816b-bc28691daab5'::uuid, 'pending_confirmation'::text)
  ) expected(reservation_id, status)
    on expected.reservation_id = reservation_row.reservation_id
   and expected.status = reservation_row.status
  where pg_catalog.num_nonnulls(
      reservation_row.yclients_appointment_id,
      reservation_row.yclients_record_id,
      reservation_row.yclients_record_hash_ciphertext,
      reservation_row.yclients_record_hash_nonce,
      reservation_row.yclients_record_hash_auth_tag,
      reservation_row.yclients_record_hash_algorithm,
      reservation_row.yclients_record_hash_encryption_key_version,
      reservation_row.yclients_record_hash_digest,
      reservation_row.yclients_record_hash_digest_key_version,
      reservation_row.yclients_client_id
    ) = 0
    and reservation_row.terminal_at is null
    and (
      (reservation_row.reservation_id = any (v_pending_ids)
        and reservation_row.version <= 9007199254740989)
      or
      (reservation_row.reservation_id = any (v_unknown_ids)
        and reservation_row.version <= 9007199254740990)
    );
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_PRECHECK: reservation shape differs';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.reservation_operations operation_row
  join backend_reservation.court_reservations reservation_row
    on reservation_row.reservation_id = operation_row.reservation_id
   and reservation_row.owner_account_id = operation_row.owner_account_id
  where operation_row.reservation_id = any (v_target_ids)
    and operation_row.actor_account_id = operation_row.owner_account_id
    and operation_row.operation_type = 'create'
    and operation_row.previous_reservation_status = 'unbooked'
    and operation_row.yclients_company_id = reservation_row.yclients_company_id
    and operation_row.target_service_id = reservation_row.target_service_id
    and operation_row.target_resource_id = reservation_row.target_resource_id
    and operation_row.target_datetime = reservation_row.target_datetime
    and operation_row.target_datetime_text = reservation_row.target_datetime_text
    and operation_row.target_end_datetime = reservation_row.target_end_datetime
    and operation_row.target_end_datetime_text = reservation_row.target_end_datetime_text
    and operation_row.status = case
      when operation_row.reservation_id = any (v_pending_ids) then 'pending'
      else 'unknown'
    end
    and pg_catalog.num_nonnulls(
      operation_row.provider_appointment_id,
      operation_row.provider_record_id,
      operation_row.provider_record_hash_ciphertext,
      operation_row.provider_record_hash_nonce,
      operation_row.provider_record_hash_auth_tag,
      operation_row.provider_record_hash_algorithm,
      operation_row.provider_record_hash_encryption_key_version,
      operation_row.provider_record_hash_digest,
      operation_row.provider_record_hash_digest_key_version
    ) = 0
    and operation_row.terminal_at is null
    and operation_row.reconciled_at is null
    and operation_row.reconciliation_outcome is null
    and operation_row.rejection_reason is null
    and operation_row.reconciliation_attempts < 2147483647
    and (
      (operation_row.reservation_id = any (v_pending_ids)
        and operation_row.unknown_at is null
        and operation_row.version <= 9007199254740989)
      or
      (operation_row.reservation_id = any (v_unknown_ids)
        and operation_row.unknown_at is not null
        and operation_row.version <= 9007199254740990)
    );
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_PRECHECK: operation shape differs';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.reservation_operation_client_snapshots snapshot_row
  join backend_reservation.reservation_operations operation_row
    on operation_row.operation_id = snapshot_row.operation_id
   and operation_row.owner_account_id = snapshot_row.owner_account_id
   and operation_row.client_snapshot_digest_key_version = snapshot_row.digest_key_version
  where operation_row.reservation_id = any (v_target_ids)
    and snapshot_row.crypto_destroyed_at is null
    and pg_catalog.num_nonnulls(
      snapshot_row.wrapped_data_key_ciphertext,
      snapshot_row.wrapped_data_key_nonce,
      snapshot_row.wrapped_data_key_auth_tag,
      snapshot_row.wrapping_algorithm,
      snapshot_row.wrapping_key_version
    ) = 5;
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_PRECHECK: snapshot binding differs';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.reservation_slot_holds hold_row
  join backend_reservation.court_reservations reservation_row
    on reservation_row.reservation_id = hold_row.reservation_id
   and reservation_row.owner_account_id = hold_row.owner_account_id
   and reservation_row.yclients_company_id = hold_row.yclients_company_id
   and reservation_row.target_service_id = hold_row.target_service_id
   and reservation_row.target_resource_id = hold_row.target_resource_id
   and reservation_row.target_datetime = hold_row.starts_at
   and reservation_row.target_end_datetime = hold_row.ends_at
  where hold_row.reservation_id = any (v_target_ids)
    and hold_row.hold_kind = 'reservation'
    and hold_row.operation_id is null
    and hold_row.operation_type is null
    and hold_row.released_at is null
    and hold_row.version <= 9007199254740990;
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_PRECHECK: active hold shape differs';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.reservation_slot_holds hold_row
  where hold_row.reservation_id = any (v_target_ids)
    and hold_row.released_at is null;
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_PRECHECK: active hold count differs';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.court_reservations reservation_row
  where reservation_row.reservation_id = v_negative_control
    and reservation_row.status = 'cancelled'
    and reservation_row.terminal_at is not null
    and pg_catalog.num_nonnulls(
      reservation_row.yclients_appointment_id,
      reservation_row.yclients_record_id,
      reservation_row.yclients_record_hash_ciphertext,
      reservation_row.yclients_record_hash_nonce,
      reservation_row.yclients_record_hash_auth_tag,
      reservation_row.yclients_record_hash_algorithm,
      reservation_row.yclients_record_hash_encryption_key_version,
      reservation_row.yclients_record_hash_digest,
      reservation_row.yclients_record_hash_digest_key_version
    ) = 9;
  if v_count <> 1 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_PRECHECK: negative control differs';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.reservation_slot_holds hold_row
  where hold_row.reservation_id = v_negative_control
    and hold_row.released_at is null;
  if v_count <> 0 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_PRECHECK: negative control hold differs';
  end if;

  select pg_catalog.max(updated_at)
  into v_latest_updated_at
  from (
    select reservation_row.updated_at
    from backend_reservation.court_reservations reservation_row
    where reservation_row.reservation_id = any (v_target_ids)
    union all
    select operation_row.updated_at
    from backend_reservation.reservation_operations operation_row
    where operation_row.reservation_id = any (v_target_ids)
    union all
    select hold_row.updated_at
    from backend_reservation.reservation_slot_holds hold_row
    where hold_row.reservation_id = any (v_target_ids)
    union all
    select snapshot_row.updated_at
    from backend_reservation.reservation_operation_client_snapshots snapshot_row
    join backend_reservation.reservation_operations operation_row
      on operation_row.operation_id = snapshot_row.operation_id
    where operation_row.reservation_id = any (v_target_ids)
  ) affected_rows;
  if v_cleanup_at < v_latest_updated_at then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_PRECHECK: cleanup time is stale';
  end if;

  perform pg_catalog.set_config(
    'prosto_padel.d2_legacy_cleanup_at_ms',
    v_cleanup_at::text,
    true
  );
end;
$precheck$;

-- The backup contains sensitive encrypted rows and identifiers. The one-row
-- unaligned result is written directly to the fixed file and never to stdout.
with target_ids(reservation_id) as (
    values
      ('b286b04e-66af-4237-84fb-10bc2a9c99c9'::uuid),
      ('953f1810-9a65-4a1b-bee5-c2b9d9cd4f12'::uuid),
      ('3d49b170-61a6-4b77-b497-ad62b4f414f6'::uuid),
      ('4257aa93-00ee-4c2d-b971-1111a07a71f5'::uuid),
      ('1e1fa95a-c042-4141-a922-29a0d78bf61f'::uuid),
      ('d7a8a984-7131-4047-94da-38e39c5b597a'::uuid),
      ('48c74dee-5248-4f75-8fc7-cfafc4a3223c'::uuid),
      ('94105b19-c497-4ff3-816b-bc28691daab5'::uuid)
)
select pg_catalog.jsonb_build_object(
    'contract', 'd2_legacy_unbound_reservation_cleanup_v1',
    'reservations', (
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(reservation_row)
        order by reservation_row.reservation_id)
      from backend_reservation.court_reservations reservation_row
      join target_ids using (reservation_id)
    ),
    'operations', (
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(operation_row)
        order by operation_row.reservation_id, operation_row.operation_id)
      from backend_reservation.reservation_operations operation_row
      join target_ids using (reservation_id)
    ),
    'holds', (
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(hold_row)
        order by hold_row.reservation_id, hold_row.hold_id)
      from backend_reservation.reservation_slot_holds hold_row
      join target_ids using (reservation_id)
    ),
    'client_snapshots', (
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(snapshot_row)
        order by snapshot_row.operation_id)
      from backend_reservation.reservation_operation_client_snapshots snapshot_row
      join backend_reservation.reservation_operations operation_row
        on operation_row.operation_id = snapshot_row.operation_id
      join target_ids on target_ids.reservation_id = operation_row.reservation_id
    )
  )::text
\g /cleanup-artifacts/d2-legacy-unbound-reservations-claim/backup.jsonl

\! chmod 0600 /cleanup-artifacts/d2-legacy-unbound-reservations-claim/backup.jsonl
\if :SHELL_ERROR
  \echo 'D2_LEGACY_UNBOUND_CLEANUP_STOP: backup chmod failed'
  \quit 4
\endif
\! test "$(stat -c '%u:%a' /cleanup-artifacts/d2-legacy-unbound-reservations-claim/backup.jsonl)" = "0:600" && test "$(wc -l < /cleanup-artifacts/d2-legacy-unbound-reservations-claim/backup.jsonl)" -eq 1 && test -s /cleanup-artifacts/d2-legacy-unbound-reservations-claim/backup.jsonl && sync /cleanup-artifacts/d2-legacy-unbound-reservations-claim/backup.jsonl && sync -f /cleanup-artifacts/d2-legacy-unbound-reservations-claim && sync -f /cleanup-artifacts
\if :SHELL_ERROR
  \echo 'D2_LEGACY_UNBOUND_CLEANUP_STOP: backup durability check failed'
  \quit 5
\endif

do $cleanup$
declare
  v_pending_ids constant uuid[] := array[
    '4257aa93-00ee-4c2d-b971-1111a07a71f5',
    '1e1fa95a-c042-4141-a922-29a0d78bf61f',
    'd7a8a984-7131-4047-94da-38e39c5b597a',
    '48c74dee-5248-4f75-8fc7-cfafc4a3223c',
    '94105b19-c497-4ff3-816b-bc28691daab5'
  ]::uuid[];
  v_unknown_ids constant uuid[] := array[
    '3d49b170-61a6-4b77-b497-ad62b4f414f6',
    'b286b04e-66af-4237-84fb-10bc2a9c99c9',
    '953f1810-9a65-4a1b-bee5-c2b9d9cd4f12'
  ]::uuid[];
  v_target_ids constant uuid[] := v_pending_ids || v_unknown_ids;
  v_cleanup_at constant bigint :=
    pg_catalog.current_setting('prosto_padel.d2_legacy_cleanup_at_ms')::bigint;
  v_count bigint;
begin
  update backend_reservation.court_reservations reservation_row
  set status = 'unknown',
      version = reservation_row.version + 1,
      updated_at = v_cleanup_at,
      status_changed_at = v_cleanup_at,
      terminal_at = null
  where reservation_row.reservation_id = any (v_pending_ids)
    and reservation_row.status = 'pending_confirmation'
    and reservation_row.terminal_at is null
    and pg_catalog.num_nonnulls(
      reservation_row.yclients_appointment_id,
      reservation_row.yclients_record_id,
      reservation_row.yclients_record_hash_ciphertext,
      reservation_row.yclients_record_hash_nonce,
      reservation_row.yclients_record_hash_auth_tag,
      reservation_row.yclients_record_hash_algorithm,
      reservation_row.yclients_record_hash_encryption_key_version,
      reservation_row.yclients_record_hash_digest,
      reservation_row.yclients_record_hash_digest_key_version,
      reservation_row.yclients_client_id
    ) = 0;
  get diagnostics v_count = row_count;
  if v_count <> 5 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_UPDATE: pending reservation count differs';
  end if;

  update backend_reservation.reservation_operations operation_row
  set status = 'unknown',
      unknown_at = v_cleanup_at,
      version = operation_row.version + 1,
      updated_at = v_cleanup_at
  where operation_row.reservation_id = any (v_pending_ids)
    and operation_row.operation_type = 'create'
    and operation_row.status = 'pending'
    and operation_row.unknown_at is null
    and operation_row.terminal_at is null
    and operation_row.reconciled_at is null
    and operation_row.reconciliation_outcome is null
    and operation_row.rejection_reason is null
    and pg_catalog.num_nonnulls(
      operation_row.provider_appointment_id,
      operation_row.provider_record_id,
      operation_row.provider_record_hash_ciphertext,
      operation_row.provider_record_hash_nonce,
      operation_row.provider_record_hash_auth_tag,
      operation_row.provider_record_hash_algorithm,
      operation_row.provider_record_hash_encryption_key_version,
      operation_row.provider_record_hash_digest,
      operation_row.provider_record_hash_digest_key_version
    ) = 0;
  get diagnostics v_count = row_count;
  if v_count <> 5 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_UPDATE: pending operation count differs';
  end if;

  update backend_reservation.court_reservations reservation_row
  set status = 'rejected',
      version = reservation_row.version + 1,
      updated_at = v_cleanup_at,
      status_changed_at = v_cleanup_at,
      terminal_at = v_cleanup_at
  where reservation_row.reservation_id = any (v_target_ids)
    and reservation_row.status = 'unknown'
    and reservation_row.terminal_at is null
    and pg_catalog.num_nonnulls(
      reservation_row.yclients_appointment_id,
      reservation_row.yclients_record_id,
      reservation_row.yclients_record_hash_ciphertext,
      reservation_row.yclients_record_hash_nonce,
      reservation_row.yclients_record_hash_auth_tag,
      reservation_row.yclients_record_hash_algorithm,
      reservation_row.yclients_record_hash_encryption_key_version,
      reservation_row.yclients_record_hash_digest,
      reservation_row.yclients_record_hash_digest_key_version,
      reservation_row.yclients_client_id
    ) = 0;
  get diagnostics v_count = row_count;
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_UPDATE: rejected reservation count differs';
  end if;

  update backend_reservation.reservation_operations operation_row
  set status = 'reconciled',
      terminal_at = v_cleanup_at,
      reconciled_at = v_cleanup_at,
      reconciliation_outcome = 'rejected',
      rejection_reason = 'admin_confirmed_legacy_unbound_cleanup',
      reconciliation_attempts = operation_row.reconciliation_attempts + 1,
      last_reconciliation_at = v_cleanup_at,
      version = operation_row.version + 1,
      updated_at = v_cleanup_at
  where operation_row.reservation_id = any (v_target_ids)
    and operation_row.operation_type = 'create'
    and operation_row.status = 'unknown'
    and operation_row.unknown_at is not null
    and operation_row.terminal_at is null
    and operation_row.reconciled_at is null
    and operation_row.reconciliation_outcome is null
    and operation_row.rejection_reason is null
    and operation_row.reconciliation_attempts < 2147483647
    and pg_catalog.num_nonnulls(
      operation_row.provider_appointment_id,
      operation_row.provider_record_id,
      operation_row.provider_record_hash_ciphertext,
      operation_row.provider_record_hash_nonce,
      operation_row.provider_record_hash_auth_tag,
      operation_row.provider_record_hash_algorithm,
      operation_row.provider_record_hash_encryption_key_version,
      operation_row.provider_record_hash_digest,
      operation_row.provider_record_hash_digest_key_version
    ) = 0;
  get diagnostics v_count = row_count;
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_UPDATE: reconciled operation count differs';
  end if;

  update backend_reservation.reservation_slot_holds hold_row
  set released_at = v_cleanup_at,
      updated_at = v_cleanup_at,
      version = hold_row.version + 1
  where hold_row.reservation_id = any (v_target_ids)
    and hold_row.hold_kind = 'reservation'
    and hold_row.operation_id is null
    and hold_row.operation_type is null
    and hold_row.released_at is null;
  get diagnostics v_count = row_count;
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_UPDATE: released hold count differs';
  end if;
end;
$cleanup$;

do $postcheck$
declare
  v_target_ids constant uuid[] := array[
    'b286b04e-66af-4237-84fb-10bc2a9c99c9',
    '953f1810-9a65-4a1b-bee5-c2b9d9cd4f12',
    '3d49b170-61a6-4b77-b497-ad62b4f414f6',
    '4257aa93-00ee-4c2d-b971-1111a07a71f5',
    '1e1fa95a-c042-4141-a922-29a0d78bf61f',
    'd7a8a984-7131-4047-94da-38e39c5b597a',
    '48c74dee-5248-4f75-8fc7-cfafc4a3223c',
    '94105b19-c497-4ff3-816b-bc28691daab5'
  ]::uuid[];
  v_negative_control constant uuid :=
    '2cf39988-358d-4009-b64c-c017d3c1d0b5'::uuid;
  v_cleanup_at constant bigint :=
    pg_catalog.current_setting('prosto_padel.d2_legacy_cleanup_at_ms')::bigint;
  v_count bigint;
begin
  select pg_catalog.count(*)
  into v_count
  from backend_reservation.court_reservations reservation_row
  where reservation_row.reservation_id = any (v_target_ids)
    and reservation_row.status = 'rejected'
    and reservation_row.status_changed_at = v_cleanup_at
    and reservation_row.updated_at = v_cleanup_at
    and reservation_row.terminal_at = v_cleanup_at
    and pg_catalog.num_nonnulls(
      reservation_row.yclients_appointment_id,
      reservation_row.yclients_record_id,
      reservation_row.yclients_record_hash_ciphertext,
      reservation_row.yclients_record_hash_nonce,
      reservation_row.yclients_record_hash_auth_tag,
      reservation_row.yclients_record_hash_algorithm,
      reservation_row.yclients_record_hash_encryption_key_version,
      reservation_row.yclients_record_hash_digest,
      reservation_row.yclients_record_hash_digest_key_version,
      reservation_row.yclients_client_id
    ) = 0;
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_POSTCHECK: reservation result differs';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.reservation_operations operation_row
  where operation_row.reservation_id = any (v_target_ids)
    and operation_row.operation_type = 'create'
    and operation_row.status = 'reconciled'
    and operation_row.unknown_at is not null
    and operation_row.terminal_at = v_cleanup_at
    and operation_row.reconciled_at = v_cleanup_at
    and operation_row.reconciliation_outcome = 'rejected'
    and operation_row.rejection_reason = 'admin_confirmed_legacy_unbound_cleanup'
    and operation_row.reconciliation_attempts > 0
    and operation_row.last_reconciliation_at = v_cleanup_at
    and operation_row.updated_at = v_cleanup_at
    and pg_catalog.num_nonnulls(
      operation_row.provider_appointment_id,
      operation_row.provider_record_id,
      operation_row.provider_record_hash_ciphertext,
      operation_row.provider_record_hash_nonce,
      operation_row.provider_record_hash_auth_tag,
      operation_row.provider_record_hash_algorithm,
      operation_row.provider_record_hash_encryption_key_version,
      operation_row.provider_record_hash_digest,
      operation_row.provider_record_hash_digest_key_version
    ) = 0;
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_POSTCHECK: operation result differs';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.reservation_slot_holds hold_row
  where hold_row.reservation_id = any (v_target_ids)
    and hold_row.released_at is null;
  if v_count <> 0 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_POSTCHECK: active holds remain';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.reservation_slot_holds hold_row
  where hold_row.reservation_id = any (v_target_ids)
    and hold_row.hold_kind = 'reservation'
    and hold_row.released_at = v_cleanup_at
    and hold_row.updated_at = v_cleanup_at;
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_POSTCHECK: released hold result differs';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.reservation_operation_client_snapshots snapshot_row
  join backend_reservation.reservation_operations operation_row
    on operation_row.operation_id = snapshot_row.operation_id
   and operation_row.owner_account_id = snapshot_row.owner_account_id
   and operation_row.client_snapshot_digest_key_version = snapshot_row.digest_key_version
  where operation_row.reservation_id = any (v_target_ids)
    and snapshot_row.crypto_destroyed_at is null
    and pg_catalog.num_nonnulls(
      snapshot_row.wrapped_data_key_ciphertext,
      snapshot_row.wrapped_data_key_nonce,
      snapshot_row.wrapped_data_key_auth_tag,
      snapshot_row.wrapping_algorithm,
      snapshot_row.wrapping_key_version
    ) = 5;
  if v_count <> 8 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_POSTCHECK: snapshot result differs';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.court_reservations reservation_row
  where reservation_row.reservation_id = v_negative_control
    and reservation_row.status = 'cancelled'
    and reservation_row.terminal_at is not null
    and pg_catalog.num_nonnulls(
      reservation_row.yclients_appointment_id,
      reservation_row.yclients_record_id,
      reservation_row.yclients_record_hash_ciphertext,
      reservation_row.yclients_record_hash_nonce,
      reservation_row.yclients_record_hash_auth_tag,
      reservation_row.yclients_record_hash_algorithm,
      reservation_row.yclients_record_hash_encryption_key_version,
      reservation_row.yclients_record_hash_digest,
      reservation_row.yclients_record_hash_digest_key_version
    ) = 9;
  if v_count <> 1 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_POSTCHECK: negative control differs';
  end if;

  select pg_catalog.count(*)
  into v_count
  from backend_reservation.reservation_slot_holds hold_row
  where hold_row.reservation_id = v_negative_control
    and hold_row.released_at is null;
  if v_count <> 0 then
    raise exception 'D2_LEGACY_UNBOUND_CLEANUP_POSTCHECK: negative control hold differs';
  end if;
end;
$postcheck$;

commit;
select 'D2_LEGACY_UNBOUND_CLEANUP_PASS'::text as result,
       8::integer as reservations_rejected,
       8::integer as holds_released;
