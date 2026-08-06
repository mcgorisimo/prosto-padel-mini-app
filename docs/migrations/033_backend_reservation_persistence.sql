-- 033_backend_reservation_persistence.sql
-- Expand-only storage for the D2 reservation aggregate and encrypted client data.
-- Review-only: do not apply without a separate owner approval.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
  end if;

  select * into v_owner from pg_catalog.pg_roles where rolname = 'backend_auth_owner';
  select * into v_app from pg_catalog.pg_roles where rolname = 'backend_auth_app';

  if v_owner.rolname is null
     or v_owner.rolcanlogin
     or v_owner.rolsuper
     or v_owner.rolcreaterole
     or v_owner.rolcreatedb
     or v_owner.rolreplication
     or v_owner.rolbypassrls then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_owner attributes are unsafe';
  end if;

  if v_app.rolname is null
     or not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_app attributes are unsafe';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
     or pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER')
     or not pg_catalog.has_database_privilege(
       'backend_auth_owner', pg_catalog.current_database(), 'CREATE'
     )
     or pg_catalog.has_database_privilege(
       'backend_auth_app', pg_catalog.current_database(), 'CREATE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend role boundary differs';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.to_regclass('backend_auth.accounts') is null
     or pg_catalog.to_regclass('backend_auth.security_audit_events') is null
     or pg_catalog.to_regprocedure(
       'backend_auth.relation_fingerprint(regclass)'
     ) is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend auth foundation is missing';
  end if;

  if pg_catalog.obj_description(
       'backend_auth.accounts'::pg_catalog.regclass,
       'pg_class'
     ) <> '015_backend_auth_foundation:'
       || backend_auth.relation_fingerprint(
         'backend_auth.accounts'::pg_catalog.regclass
       )
     or pg_catalog.obj_description(
       'backend_auth.security_audit_events'::pg_catalog.regclass,
       'pg_class'
     ) <> '015_backend_auth_foundation:'
       || backend_auth.relation_fingerprint(
         'backend_auth.security_audit_events'::pg_catalog.regclass
       ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend auth foundation differs';
  end if;

  if pg_catalog.to_regnamespace('backend_reservation') is not null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 033 target already exists';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create schema backend_reservation authorization backend_auth_owner;
revoke all on schema backend_reservation from public, backend_auth_app;
grant usage on schema backend_reservation to backend_auth_app;

create table backend_reservation.court_reservations (
  reservation_id uuid not null,
  owner_account_id uuid not null,
  status text not null,
  target_service_id bigint not null,
  target_resource_id bigint not null,
  target_datetime timestamp with time zone not null,
  target_datetime_text text not null,
  yclients_company_id bigint not null,
  yclients_appointment_id bigint,
  yclients_record_id bigint,
  yclients_record_hash_ciphertext bytea,
  yclients_record_hash_nonce bytea,
  yclients_record_hash_auth_tag bytea,
  yclients_record_hash_algorithm text,
  yclients_record_hash_encryption_key_version integer,
  yclients_record_hash_digest bytea,
  yclients_record_hash_digest_key_version integer,
  yclients_client_id bigint,
  version bigint not null,
  created_at bigint not null,
  updated_at bigint not null,
  status_changed_at bigint not null,
  terminal_at bigint,
  constraint court_reservations_pkey primary key (reservation_id),
  constraint court_reservations_owner_key
    unique (reservation_id, owner_account_id),
  constraint court_reservations_owner_fkey foreign key (owner_account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint court_reservations_status_check check (
    status = any (array[
      'unbooked', 'pending_confirmation', 'confirmed', 'reschedule_pending',
      'cancel_pending', 'cancelled', 'rejected', 'unknown'
    ]::text[])
  ),
  constraint court_reservations_target_check check (
    target_service_id between 1 and 9007199254740991
    and target_resource_id between 1 and 9007199254740991
    and pg_catalog.length(target_datetime_text) between 20 and 35
    and target_datetime_text ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and target_datetime = target_datetime_text::pg_catalog.timestamptz
  ),
  constraint court_reservations_provider_id_check check (
    yclients_company_id between 1 and 9007199254740991
    and (
      yclients_appointment_id is null
      or yclients_appointment_id between 1 and 9007199254740991
    )
    and (
      yclients_record_id is null
      or yclients_record_id between 1 and 9007199254740991
    )
    and (
      yclients_client_id is null
      or yclients_client_id between 1 and 9007199254740991
    )
  ),
  constraint court_reservations_record_hash_shape_check check (
    pg_catalog.num_nonnulls(
      yclients_appointment_id,
      yclients_record_id,
      yclients_record_hash_ciphertext,
      yclients_record_hash_nonce,
      yclients_record_hash_auth_tag,
      yclients_record_hash_algorithm,
      yclients_record_hash_encryption_key_version,
      yclients_record_hash_digest,
      yclients_record_hash_digest_key_version
    ) in (0, 9)
    and (
      yclients_record_hash_ciphertext is null
      or (
        pg_catalog.octet_length(yclients_record_hash_ciphertext) between 1 and 4096
        and pg_catalog.octet_length(yclients_record_hash_nonce) between 12 and 32
        and pg_catalog.octet_length(yclients_record_hash_auth_tag) between 16 and 32
        and yclients_record_hash_algorithm ~ '^[a-z][a-z0-9_]{0,63}$'
        and yclients_record_hash_encryption_key_version between 1 and 2147483647
        and pg_catalog.octet_length(yclients_record_hash_digest) = 32
        and yclients_record_hash_digest_key_version between 1 and 2147483647
      )
    )
  ),
  constraint court_reservations_binding_status_check check (
    status <> all (array[
      'confirmed', 'reschedule_pending', 'cancel_pending', 'cancelled'
    ]::text[])
    or yclients_record_hash_ciphertext is not null
  ),
  constraint court_reservations_version_check check (
    version between 1 and 9007199254740991
  ),
  constraint court_reservations_time_check check (
    created_at between 0 and 9007199254740991
    and status_changed_at between created_at and 9007199254740991
    and updated_at between status_changed_at and 9007199254740991
    and (
      (status = any (array['cancelled', 'rejected']::text[])
        and terminal_at is not null
        and terminal_at between status_changed_at and updated_at)
      or
      (status <> all (array['cancelled', 'rejected']::text[])
        and terminal_at is null)
    )
  )
);

create unique index court_reservations_slot_hold_uq
  on backend_reservation.court_reservations (
    yclients_company_id,
    target_resource_id,
    target_datetime
  )
  where status = any (array[
    'pending_confirmation', 'confirmed', 'reschedule_pending',
    'cancel_pending', 'unknown'
  ]::text[]);

create unique index court_reservations_record_binding_uq
  on backend_reservation.court_reservations (
    yclients_company_id,
    yclients_record_id
  )
  where yclients_record_id is not null;

create unique index court_reservations_record_hash_binding_uq
  on backend_reservation.court_reservations (
    yclients_company_id,
    yclients_record_hash_digest_key_version,
    yclients_record_hash_digest
  )
  where yclients_record_hash_digest is not null;

create index court_reservations_owner_time_idx
  on backend_reservation.court_reservations (
    owner_account_id,
    created_at desc,
    reservation_id
  );

create index court_reservations_appointment_lookup_idx
  on backend_reservation.court_reservations (
    yclients_company_id,
    yclients_appointment_id
  )
  where yclients_appointment_id is not null;

create index court_reservations_client_lookup_idx
  on backend_reservation.court_reservations (
    yclients_company_id,
    yclients_client_id
  )
  where yclients_client_id is not null;

create table backend_reservation.reservation_operations (
  operation_id uuid not null,
  reservation_id uuid not null,
  owner_account_id uuid not null,
  actor_account_id uuid not null,
  operation_type text not null,
  status text not null,
  idempotency_key uuid not null,
  request_digest text not null,
  request_digest_version integer not null,
  yclients_company_id bigint not null,
  external_api_id bigint not null,
  target_service_id bigint,
  target_resource_id bigint,
  target_datetime timestamp with time zone,
  target_datetime_text text,
  provider_appointment_id bigint,
  provider_record_id bigint,
  provider_record_hash_ciphertext bytea,
  provider_record_hash_nonce bytea,
  provider_record_hash_auth_tag bytea,
  provider_record_hash_algorithm text,
  provider_record_hash_encryption_key_version integer,
  provider_record_hash_digest bytea,
  provider_record_hash_digest_key_version integer,
  client_snapshot_digest bytea not null,
  client_snapshot_digest_key_version integer not null,
  previous_reservation_status text not null,
  provider_attempt_started_at bigint,
  provider_attempt_finished_at bigint,
  unknown_at bigint,
  terminal_at bigint,
  reconciled_at bigint,
  reconciliation_outcome text,
  rejection_reason text,
  reconciliation_attempts integer not null default 0,
  last_reconciliation_at bigint,
  version bigint not null,
  created_at bigint not null,
  updated_at bigint not null,
  constraint reservation_operations_pkey primary key (operation_id),
  constraint reservation_operations_owner_idempotency_key
    unique (owner_account_id, idempotency_key),
  constraint reservation_operations_operation_owner_key
    unique (operation_id, owner_account_id),
  constraint reservation_operations_operation_snapshot_key
    unique (
      operation_id,
      owner_account_id,
      client_snapshot_digest_key_version
    ),
  constraint reservation_operations_operation_reservation_key
    unique (operation_id, reservation_id),
  constraint reservation_operations_reservation_owner_fkey
    foreign key (reservation_id, owner_account_id)
    references backend_reservation.court_reservations (
      reservation_id,
      owner_account_id
    )
    on update no action on delete no action not deferrable,
  constraint reservation_operations_actor_fkey foreign key (actor_account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint reservation_operations_type_check check (
    operation_type = any (array['create', 'reschedule', 'cancel']::text[])
  ),
  constraint reservation_operations_status_check check (
    status = any (array[
      'pending', 'unknown', 'confirmed', 'rejected', 'reconciled'
    ]::text[])
  ),
  constraint reservation_operations_digest_check check (
    request_digest ~ '^[0-9a-f]{64}$'
    and request_digest_version between 1 and 2147483647
    and pg_catalog.octet_length(client_snapshot_digest) = 32
    and client_snapshot_digest_key_version between 1 and 2147483647
  ),
  constraint reservation_operations_external_reference_check check (
    yclients_company_id between 1 and 9007199254740991
    and external_api_id between 1 and 9007199254740991
  ),
  constraint reservation_operations_target_shape_check check (
    (
      operation_type = 'cancel'
      and pg_catalog.num_nonnulls(
        target_service_id,
        target_resource_id,
        target_datetime,
        target_datetime_text
      ) = 0
    )
    or
    (
      operation_type = any (array['create', 'reschedule']::text[])
      and pg_catalog.num_nonnulls(
        target_service_id,
        target_resource_id,
        target_datetime,
        target_datetime_text
      ) = 4
      and target_service_id between 1 and 9007199254740991
      and target_resource_id between 1 and 9007199254740991
      and pg_catalog.length(target_datetime_text) between 20 and 35
      and target_datetime_text ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
      and target_datetime = target_datetime_text::pg_catalog.timestamptz
    )
  ),
  constraint reservation_operations_provider_binding_shape_check check (
    pg_catalog.num_nonnulls(
      provider_appointment_id,
      provider_record_id,
      provider_record_hash_ciphertext,
      provider_record_hash_nonce,
      provider_record_hash_auth_tag,
      provider_record_hash_algorithm,
      provider_record_hash_encryption_key_version,
      provider_record_hash_digest,
      provider_record_hash_digest_key_version
    ) in (0, 9)
    and (
      provider_record_hash_ciphertext is null
      or (
        provider_appointment_id between 1 and 9007199254740991
        and provider_record_id between 1 and 9007199254740991
        and pg_catalog.octet_length(provider_record_hash_ciphertext) between 1 and 4096
        and pg_catalog.octet_length(provider_record_hash_nonce) between 12 and 32
        and pg_catalog.octet_length(provider_record_hash_auth_tag) between 16 and 32
        and provider_record_hash_algorithm ~ '^[a-z][a-z0-9_]{0,63}$'
        and provider_record_hash_encryption_key_version between 1 and 2147483647
        and pg_catalog.octet_length(provider_record_hash_digest) = 32
        and provider_record_hash_digest_key_version between 1 and 2147483647
      )
    )
    and (
      operation_type = 'create'
      or provider_record_hash_ciphertext is not null
    )
    and (
      status <> 'confirmed'
      or provider_record_hash_ciphertext is not null
    )
    and (
      status <> 'reconciled'
      or reconciliation_outcome <> 'confirmed'
      or provider_record_hash_ciphertext is not null
    )
  ),
  constraint reservation_operations_previous_status_check check (
    previous_reservation_status = any (array[
      'unbooked', 'pending_confirmation', 'confirmed', 'reschedule_pending',
      'cancel_pending', 'cancelled', 'rejected', 'unknown'
    ]::text[])
  ),
  constraint reservation_operations_terminal_shape_check check (
    (
      status = 'pending'
      and unknown_at is null
      and terminal_at is null
      and reconciled_at is null
      and reconciliation_outcome is null
      and rejection_reason is null
    )
    or
    (
      status = 'unknown'
      and unknown_at is not null
      and terminal_at is null
      and reconciled_at is null
      and reconciliation_outcome is null
      and rejection_reason is null
    )
    or
    (
      status = 'confirmed'
      and unknown_at is null
      and terminal_at is not null
      and reconciled_at is null
      and reconciliation_outcome is null
      and rejection_reason is null
    )
    or
    (
      status = 'rejected'
      and unknown_at is null
      and terminal_at is not null
      and reconciled_at is null
      and reconciliation_outcome is null
      and rejection_reason is not null
      and rejection_reason ~ '^[a-z][a-z0-9_]{0,127}$'
    )
    or
    (
      status = 'reconciled'
      and unknown_at is not null
      and terminal_at is not null
      and reconciled_at is not null
      and reconciliation_outcome is not null
      and reconciliation_outcome = any (array['confirmed', 'rejected']::text[])
      and (
        (reconciliation_outcome = 'confirmed' and rejection_reason is null)
        or
        (reconciliation_outcome = 'rejected'
          and rejection_reason is not null
          and rejection_reason ~ '^[a-z][a-z0-9_]{0,127}$')
      )
    )
  ),
  constraint reservation_operations_reconciliation_check check (
    reconciliation_attempts between 0 and 2147483647
    and (
      (reconciliation_attempts = 0 and last_reconciliation_at is null)
      or
      (reconciliation_attempts > 0 and last_reconciliation_at is not null)
    )
    and (status <> 'reconciled' or reconciliation_attempts > 0)
  ),
  constraint reservation_operations_version_check check (
    version between 1 and 9007199254740991
  ),
  constraint reservation_operations_time_check check (
    created_at between 0 and 9007199254740991
    and updated_at between created_at and 9007199254740991
    and (
      provider_attempt_started_at is null
      or provider_attempt_started_at between created_at and updated_at
    )
    and (
      provider_attempt_finished_at is null
      or (
        provider_attempt_started_at is not null
        and provider_attempt_finished_at between provider_attempt_started_at and updated_at
      )
    )
    and (unknown_at is null or unknown_at between created_at and updated_at)
    and (terminal_at is null or terminal_at between created_at and updated_at)
    and (
      last_reconciliation_at is null
      or last_reconciliation_at between created_at and updated_at
    )
    and (
      reconciled_at is null
      or (
        unknown_at is not null
        and reconciled_at between unknown_at and updated_at
      )
    )
  )
);

create unique index reservation_operations_active_reservation_uq
  on backend_reservation.reservation_operations (reservation_id)
  where status = any (array['pending', 'unknown']::text[]);

create index reservation_operations_reservation_time_idx
  on backend_reservation.reservation_operations (
    owner_account_id,
    reservation_id,
    created_at desc,
    operation_id
  );

create index reservation_operations_external_api_lookup_idx
  on backend_reservation.reservation_operations (
    yclients_company_id,
    external_api_id
  );

create index reservation_operations_provider_record_lookup_idx
  on backend_reservation.reservation_operations (
    yclients_company_id,
    provider_record_id,
    created_at desc
  )
  where provider_record_id is not null;

create index reservation_operations_unknown_reconciliation_idx
  on backend_reservation.reservation_operations (
    updated_at,
    operation_id
  )
  where status = 'unknown';

create table backend_reservation.reservation_operation_client_snapshots (
  operation_id uuid not null,
  owner_account_id uuid not null,
  ciphertext bytea not null,
  nonce bytea not null,
  auth_tag bytea not null,
  algorithm text not null,
  encryption_key_version integer not null,
  digest_key_version integer not null,
  aad_version integer not null,
  created_at bigint not null,
  crypto_destroyed_at bigint,
  constraint reservation_operation_client_snapshots_pkey
    primary key (operation_id),
  constraint reservation_operation_client_snapshots_operation_owner_fkey
    foreign key (operation_id, owner_account_id, digest_key_version)
    references backend_reservation.reservation_operations (
      operation_id,
      owner_account_id,
      client_snapshot_digest_key_version
    )
    on update no action on delete no action not deferrable,
  constraint reservation_operation_client_snapshots_crypto_check check (
    pg_catalog.octet_length(ciphertext) between 1 and 16384
    and pg_catalog.octet_length(nonce) between 12 and 32
    and pg_catalog.octet_length(auth_tag) between 16 and 32
    and algorithm ~ '^[a-z][a-z0-9_]{0,63}$'
    and encryption_key_version between 1 and 2147483647
    and digest_key_version between 1 and 2147483647
    and aad_version between 1 and 2147483647
  ),
  constraint reservation_operation_client_snapshots_time_check check (
    created_at between 0 and 9007199254740991
    and (
      crypto_destroyed_at is null
      or crypto_destroyed_at between created_at and 9007199254740991
    )
  )
);

create table backend_reservation.reservation_admin_read_audit_events (
  event_order bigint generated always as identity,
  event_id uuid not null,
  event_type text not null,
  actor_account_id uuid not null,
  actor_role text not null,
  reservation_id uuid not null,
  operation_id uuid not null,
  occurred_at bigint not null,
  purpose_code text not null,
  endpoint_code text not null,
  request_id uuid not null,
  correlation_id uuid,
  constraint reservation_admin_read_audit_events_pkey primary key (event_id),
  constraint reservation_admin_read_audit_events_order_key unique (event_order),
  constraint reservation_admin_read_audit_events_actor_fkey
    foreign key (actor_account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint reservation_admin_read_audit_events_operation_fkey
    foreign key (operation_id, reservation_id)
    references backend_reservation.reservation_operations (
      operation_id,
      reservation_id
    )
    on update no action on delete no action not deferrable,
  constraint reservation_admin_read_audit_events_type_check check (
    event_type = 'reservation_client_snapshot_admin_read'
  ),
  constraint reservation_admin_read_audit_events_role_check check (
    actor_role = 'club_admin'
  ),
  constraint reservation_admin_read_audit_events_time_check check (
    occurred_at between 0 and 9007199254740991
  ),
  constraint reservation_admin_read_audit_events_metadata_check check (
    purpose_code = 'reservation_administration'
    and endpoint_code = 'admin_reservation_details'
  )
);

create index reservation_admin_read_audit_events_actor_time_idx
  on backend_reservation.reservation_admin_read_audit_events (
    actor_account_id,
    occurred_at desc,
    event_order desc
  );

create index reservation_admin_read_audit_events_reservation_time_idx
  on backend_reservation.reservation_admin_read_audit_events (
    reservation_id,
    occurred_at desc,
    event_order desc
  );

create index reservation_admin_read_audit_events_operation_time_idx
  on backend_reservation.reservation_admin_read_audit_events (
    operation_id,
    occurred_at desc,
    event_order desc
  );

create function backend_reservation.reject_admin_read_audit_mutation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'BACKEND_RESERVATION_ADMIN_READ_AUDIT_IMMUTABLE';
end;
$function$;

create trigger reservation_admin_read_audit_events_update_delete_guard
before update or delete on backend_reservation.reservation_admin_read_audit_events
for each row execute function backend_reservation.reject_admin_read_audit_mutation();

create trigger reservation_admin_read_audit_events_truncate_guard
before truncate on backend_reservation.reservation_admin_read_audit_events
for each statement execute function backend_reservation.reject_admin_read_audit_mutation();

revoke all on all tables in schema backend_reservation
  from public, backend_auth_app;
revoke all on all sequences in schema backend_reservation
  from public, backend_auth_app;
revoke all on function backend_reservation.reject_admin_read_audit_mutation()
  from public, backend_auth_app;

grant select on table backend_reservation.court_reservations
  to backend_auth_app;
grant insert (
  reservation_id,
  owner_account_id,
  status,
  target_service_id,
  target_resource_id,
  target_datetime,
  target_datetime_text,
  yclients_company_id,
  yclients_appointment_id,
  yclients_record_id,
  yclients_record_hash_ciphertext,
  yclients_record_hash_nonce,
  yclients_record_hash_auth_tag,
  yclients_record_hash_algorithm,
  yclients_record_hash_encryption_key_version,
  yclients_record_hash_digest,
  yclients_record_hash_digest_key_version,
  yclients_client_id,
  version,
  created_at,
  updated_at,
  status_changed_at,
  terminal_at
) on backend_reservation.court_reservations to backend_auth_app;
grant update (
  status,
  target_service_id,
  target_resource_id,
  target_datetime,
  target_datetime_text,
  yclients_appointment_id,
  yclients_record_id,
  yclients_record_hash_ciphertext,
  yclients_record_hash_nonce,
  yclients_record_hash_auth_tag,
  yclients_record_hash_algorithm,
  yclients_record_hash_encryption_key_version,
  yclients_record_hash_digest,
  yclients_record_hash_digest_key_version,
  yclients_client_id,
  version,
  updated_at,
  status_changed_at,
  terminal_at
) on backend_reservation.court_reservations to backend_auth_app;

grant select on table backend_reservation.reservation_operations
  to backend_auth_app;
grant insert (
  operation_id,
  reservation_id,
  owner_account_id,
  actor_account_id,
  operation_type,
  status,
  idempotency_key,
  request_digest,
  request_digest_version,
  yclients_company_id,
  external_api_id,
  target_service_id,
  target_resource_id,
  target_datetime,
  target_datetime_text,
  provider_appointment_id,
  provider_record_id,
  provider_record_hash_ciphertext,
  provider_record_hash_nonce,
  provider_record_hash_auth_tag,
  provider_record_hash_algorithm,
  provider_record_hash_encryption_key_version,
  provider_record_hash_digest,
  provider_record_hash_digest_key_version,
  client_snapshot_digest,
  client_snapshot_digest_key_version,
  previous_reservation_status,
  provider_attempt_started_at,
  provider_attempt_finished_at,
  unknown_at,
  terminal_at,
  reconciled_at,
  reconciliation_outcome,
  rejection_reason,
  reconciliation_attempts,
  last_reconciliation_at,
  version,
  created_at,
  updated_at
) on backend_reservation.reservation_operations to backend_auth_app;
grant update (
  status,
  provider_appointment_id,
  provider_record_id,
  provider_record_hash_ciphertext,
  provider_record_hash_nonce,
  provider_record_hash_auth_tag,
  provider_record_hash_algorithm,
  provider_record_hash_encryption_key_version,
  provider_record_hash_digest,
  provider_record_hash_digest_key_version,
  provider_attempt_started_at,
  provider_attempt_finished_at,
  unknown_at,
  terminal_at,
  reconciled_at,
  reconciliation_outcome,
  rejection_reason,
  reconciliation_attempts,
  last_reconciliation_at,
  version,
  updated_at
) on backend_reservation.reservation_operations to backend_auth_app;

grant select on table
  backend_reservation.reservation_operation_client_snapshots
  to backend_auth_app;
grant insert (
  operation_id,
  owner_account_id,
  ciphertext,
  nonce,
  auth_tag,
  algorithm,
  encryption_key_version,
  digest_key_version,
  aad_version,
  created_at,
  crypto_destroyed_at
) on backend_reservation.reservation_operation_client_snapshots
  to backend_auth_app;
grant update (
  ciphertext,
  nonce,
  auth_tag,
  algorithm,
  encryption_key_version,
  aad_version,
  crypto_destroyed_at
) on backend_reservation.reservation_operation_client_snapshots
  to backend_auth_app;

grant insert (
  event_id,
  event_type,
  actor_account_id,
  actor_role,
  reservation_id,
  operation_id,
  occurred_at,
  purpose_code,
  endpoint_code,
  request_id,
  correlation_id
) on backend_reservation.reservation_admin_read_audit_events
  to backend_auth_app;
grant usage on sequence
  backend_reservation.reservation_admin_read_audit_events_event_order_seq
  to backend_auth_app;

do $fingerprints$
declare
  v_name text;
begin
  foreach v_name in array array[
    'court_reservations',
    'reservation_operations',
    'reservation_operation_client_snapshots',
    'reservation_admin_read_audit_events'
  ]
  loop
    execute pg_catalog.format(
      'comment on table backend_reservation.%I is %L',
      v_name,
      '033_backend_reservation_persistence:'
        || backend_auth.relation_fingerprint(
          pg_catalog.to_regclass('backend_reservation.' || v_name)
        )
    );
  end loop;

  execute pg_catalog.format(
    'comment on function backend_reservation.reject_admin_read_audit_mutation() is %L',
    '033_backend_reservation_persistence:'
      || pg_catalog.md5(pg_catalog.pg_get_functiondef(
        'backend_reservation.reject_admin_read_audit_mutation()'::pg_catalog.regprocedure
      ))
  );
end;
$fingerprints$;

do $assertions$
declare
  v_name text;
  v_relation_oid oid;
begin
  if pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_reservation'
     )) <> 'backend_auth_owner'
     or pg_catalog.has_schema_privilege(
       'backend_auth_app', 'backend_reservation', 'CREATE'
     )
     or not pg_catalog.has_schema_privilege(
       'backend_auth_app', 'backend_reservation', 'USAGE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: reservation schema boundary differs';
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
      raise exception 'MIGRATION_ASSERTION_FAILED: %.% boundary differs',
        'backend_reservation',
        v_name;
    end if;
  end loop;

  if pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_reservation.reservation_admin_read_audit_events',
       'SELECT, UPDATE, DELETE, TRUNCATE'
     )
     or exists (select 1 from backend_reservation.court_reservations)
     or exists (select 1 from backend_reservation.reservation_operations)
     or exists (
       select 1
       from backend_reservation.reservation_operation_client_snapshots
     )
     or exists (
       select 1
       from backend_reservation.reservation_admin_read_audit_events
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 033 data/ACL boundary differs';
  end if;
end;
$assertions$;

reset role;
commit;

select '033_backend_reservation_persistence prepared schema applied; runtime remains disconnected'
  as result;
