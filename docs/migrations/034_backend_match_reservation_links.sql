-- 034_backend_match_reservation_links.sql
-- Adds durable match <-> D2 reservation truth and a PII-free lifecycle ledger.
-- This migration is storage-only: it does not connect Nest/runtime or call YCLIENTS.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_relation record;
  v_matches oid := pg_catalog.to_regclass('backend_match.matches')::oid;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null
     or not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
     or pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: required role boundary is unavailable';
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
      raise exception 'MIGRATION_PRECONDITION_FAILED: %.% differs from %',
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
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: legacy match overlap authority differs';
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
    raise exception 'MIGRATION_PRECONDITION_FAILED: D2 canonical slot hold authority differs';
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
  ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 034 target already exists';
  end if;

  if pg_catalog.has_schema_privilege(
       'backend_auth_app', 'backend_match', 'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app', 'backend_reservation', 'CREATE'
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: application schema CREATE is unsafe';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

-- Planned match rows must not hold courts. D2 reservation_slot_holds remains
-- the only canonical database-level court collision authority.
alter table backend_match.matches
  drop constraint matches_no_active_court_overlap,
  add constraint matches_id_owner_account_key
    unique (id, owner_account_id);

create table backend_match.match_reservation_links (
  link_id uuid not null,
  match_id uuid not null,
  reservation_id uuid not null,
  owner_account_id uuid not null,
  state text not null,
  provider_appointment_id bigint not null,
  provider_record_id bigint not null,
  target_service_id bigint not null,
  target_resource_id bigint not null,
  target_datetime timestamp with time zone not null,
  target_datetime_text text not null,
  target_end_datetime timestamp with time zone not null,
  target_end_datetime_text text not null,
  observed_reservation_version bigint not null,
  version bigint not null,
  created_at bigint not null,
  updated_at bigint not null,
  released_at bigint,
  release_reason text,
  constraint match_reservation_links_pkey primary key (link_id),
  constraint match_reservation_links_binding_key unique (
    link_id,
    match_id,
    reservation_id,
    owner_account_id
  ),
  constraint match_reservation_links_match_owner_fkey
    foreign key (match_id, owner_account_id)
    references backend_match.matches (id, owner_account_id)
    on update no action on delete no action not deferrable,
  constraint match_reservation_links_reservation_owner_fkey
    foreign key (reservation_id, owner_account_id)
    references backend_reservation.court_reservations (
      reservation_id,
      owner_account_id
    )
    on update no action on delete no action not deferrable,
  constraint match_reservation_links_state_check check (
    state = 'active' or state = 'released'
  ),
  constraint match_reservation_links_provider_id_check check (
    provider_appointment_id between 1 and 9007199254740991
    and provider_record_id between 1 and 9007199254740991
  ),
  constraint match_reservation_links_target_check check (
    target_service_id between 1 and 9007199254740991
    and target_resource_id between 1 and 9007199254740991
    and pg_catalog.length(target_datetime_text) between 20 and 35
    and target_datetime_text ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and target_datetime = target_datetime_text::pg_catalog.timestamptz
    and pg_catalog.length(target_end_datetime_text) between 20 and 35
    and target_end_datetime_text ~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and target_end_datetime =
      target_end_datetime_text::pg_catalog.timestamptz
    and target_end_datetime > target_datetime
  ),
  constraint match_reservation_links_observed_version_check check (
    observed_reservation_version between 1 and 9007199254740991
  ),
  constraint match_reservation_links_release_shape_check check (
    (
      state = 'active'
      and released_at is null
      and release_reason is null
    )
    or (
      state = 'released'
      and released_at is not null
      and release_reason is not null
      and release_reason = any (array[
        'canonical_reservation_cancelled',
        'match_terminal'
      ]::text[])
    )
  ),
  constraint match_reservation_links_time_check check (
    created_at between 0 and 9007199254740991
    and updated_at between created_at and 9007199254740991
    and (
      released_at is null
      or released_at between created_at and updated_at
    )
  ),
  constraint match_reservation_links_version_check check (
    version between 1 and 9007199254740991
  )
);

create unique index match_reservation_links_active_match_uq
  on backend_match.match_reservation_links (match_id)
  where state = 'active';

create unique index match_reservation_links_active_reservation_uq
  on backend_match.match_reservation_links (reservation_id)
  where state = 'active';

create index match_reservation_links_owner_history_idx
  on backend_match.match_reservation_links (
    owner_account_id,
    created_at desc,
    link_id
  );

create table backend_match.match_reservation_events (
  event_id uuid not null,
  link_id uuid not null,
  match_id uuid not null,
  reservation_id uuid not null,
  owner_account_id uuid not null,
  event_type text not null,
  reservation_version bigint not null,
  expected_recipient_count smallint not null,
  previous_service_id bigint,
  previous_resource_id bigint,
  previous_datetime timestamp with time zone,
  previous_datetime_text text,
  previous_end_datetime timestamp with time zone,
  previous_end_datetime_text text,
  current_service_id bigint,
  current_resource_id bigint,
  current_datetime timestamp with time zone,
  current_datetime_text text,
  current_end_datetime timestamp with time zone,
  current_end_datetime_text text,
  occurred_at bigint not null,
  constraint match_reservation_events_pkey primary key (event_id),
  constraint match_reservation_events_dedup_key unique (
    link_id,
    event_type,
    reservation_version
  ),
  constraint match_reservation_events_link_binding_fkey foreign key (
    link_id,
    match_id,
    reservation_id,
    owner_account_id
  ) references backend_match.match_reservation_links (
    link_id,
    match_id,
    reservation_id,
    owner_account_id
  ) on update no action on delete no action not deferrable,
  constraint match_reservation_events_type_check check (
    event_type = any (array[
      'court_confirmed',
      'court_moved',
      'court_cancelled'
    ]::text[])
  ),
  constraint match_reservation_events_version_check check (
    reservation_version between 1 and 9007199254740991
  ),
  constraint match_reservation_events_recipient_count_check check (
    expected_recipient_count between 1 and 4
  ),
  constraint match_reservation_events_time_check check (
    occurred_at between 0 and 9007199254740991
  ),
  constraint match_reservation_events_snapshot_shape_check check (
    (
      event_type = 'court_confirmed'
      and pg_catalog.num_nonnulls(
        previous_service_id,
        previous_resource_id,
        previous_datetime,
        previous_datetime_text,
        previous_end_datetime,
        previous_end_datetime_text
      ) = 0
      and pg_catalog.num_nonnulls(
        current_service_id,
        current_resource_id,
        current_datetime,
        current_datetime_text,
        current_end_datetime,
        current_end_datetime_text
      ) = 6
    )
    or (
      event_type = 'court_moved'
      and pg_catalog.num_nonnulls(
        previous_service_id,
        previous_resource_id,
        previous_datetime,
        previous_datetime_text,
        previous_end_datetime,
        previous_end_datetime_text,
        current_service_id,
        current_resource_id,
        current_datetime,
        current_datetime_text,
        current_end_datetime,
        current_end_datetime_text
      ) = 12
      and row(
        previous_service_id,
        previous_resource_id,
        previous_datetime,
        previous_end_datetime
      ) is distinct from row(
        current_service_id,
        current_resource_id,
        current_datetime,
        current_end_datetime
      )
    )
    or (
      event_type = 'court_cancelled'
      and pg_catalog.num_nonnulls(
        previous_service_id,
        previous_resource_id,
        previous_datetime,
        previous_datetime_text,
        previous_end_datetime,
        previous_end_datetime_text
      ) = 6
      and pg_catalog.num_nonnulls(
        current_service_id,
        current_resource_id,
        current_datetime,
        current_datetime_text,
        current_end_datetime,
        current_end_datetime_text
      ) = 0
    )
  ),
  constraint match_reservation_events_snapshot_value_check check (
    (
      previous_service_id is null
      or (
        previous_service_id between 1 and 9007199254740991
        and previous_resource_id between 1 and 9007199254740991
        and pg_catalog.length(previous_datetime_text) between 20 and 35
        and previous_datetime_text ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
        and previous_datetime =
          previous_datetime_text::pg_catalog.timestamptz
        and pg_catalog.length(previous_end_datetime_text) between 20 and 35
        and previous_end_datetime_text ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
        and previous_end_datetime =
          previous_end_datetime_text::pg_catalog.timestamptz
        and previous_end_datetime > previous_datetime
      )
    )
    and (
      current_service_id is null
      or (
        current_service_id between 1 and 9007199254740991
        and current_resource_id between 1 and 9007199254740991
        and pg_catalog.length(current_datetime_text) between 20 and 35
        and current_datetime_text ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
        and current_datetime =
          current_datetime_text::pg_catalog.timestamptz
        and pg_catalog.length(current_end_datetime_text) between 20 and 35
        and current_end_datetime_text ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,3})?(Z|[+-][0-9]{2}:[0-9]{2})$'
        and current_end_datetime =
          current_end_datetime_text::pg_catalog.timestamptz
        and current_end_datetime > current_datetime
      )
    )
  )
);

create index match_reservation_events_match_time_idx
  on backend_match.match_reservation_events (
    match_id,
    occurred_at desc,
    event_id
  );

create table backend_match.match_reservation_event_recipients (
  event_id uuid not null,
  recipient_account_id uuid not null,
  created_at bigint not null,
  read_at bigint,
  version bigint not null,
  constraint match_reservation_event_recipients_pkey primary key (
    event_id,
    recipient_account_id
  ),
  constraint match_reservation_event_recipients_event_fkey
    foreign key (event_id)
    references backend_match.match_reservation_events (event_id)
    on update no action on delete no action not deferrable,
  constraint match_reservation_event_recipients_account_fkey
    foreign key (recipient_account_id)
    references backend_auth.accounts (id)
    on update no action on delete no action not deferrable,
  constraint match_reservation_event_recipients_time_check check (
    created_at between 0 and 9007199254740991
    and (
      read_at is null
      or read_at between created_at and 9007199254740991
    )
  ),
  constraint match_reservation_event_recipients_read_shape_check check (
    (read_at is null and version = 1)
    or (read_at is not null and version = 2)
  )
);

create index match_reservation_event_recipients_feed_idx
  on backend_match.match_reservation_event_recipients (
    recipient_account_id,
    created_at desc,
    event_id
  );

create index match_reservation_event_recipients_unread_idx
  on backend_match.match_reservation_event_recipients (
    recipient_account_id,
    created_at desc,
    event_id
  )
  where read_at is null;

create function backend_match.guard_match_reservation_link_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_match_status text;
  v_reservation backend_reservation.court_reservations%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.state <> 'active'
       or new.version <> 1
       or new.created_at <> new.updated_at
       or new.released_at is not null
       or new.release_reason is not null then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_LINK_INSERT_INVALID';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.link_id is distinct from old.link_id
       or new.match_id is distinct from old.match_id
       or new.reservation_id is distinct from old.reservation_id
       or new.owner_account_id is distinct from old.owner_account_id
       or new.provider_appointment_id is distinct from old.provider_appointment_id
       or new.provider_record_id is distinct from old.provider_record_id
       or new.created_at is distinct from old.created_at then
      raise exception using
        errcode = '55000',
        message = 'BACKEND_MATCH_RESERVATION_LINK_IDENTITY_IMMUTABLE';
    end if;

    if old.state <> 'active' then
      raise exception using
        errcode = '55000',
        message = 'BACKEND_MATCH_RESERVATION_LINK_RELEASED_IMMUTABLE';
    end if;

    if new.version <> old.version + 1
       or new.updated_at < old.updated_at
       or new.observed_reservation_version <
         old.observed_reservation_version then
      raise exception using
        errcode = '40001',
        message = 'BACKEND_MATCH_RESERVATION_LINK_VERSION_CONFLICT';
    end if;

    if new.state = 'active'
       and (
         new.released_at is not null
         or new.release_reason is not null
       ) then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_LINK_ACTIVE_SHAPE_INVALID';
    elsif new.state = 'active'
       and new.observed_reservation_version =
         old.observed_reservation_version
       and new.target_service_id is not distinct from old.target_service_id
       and new.target_resource_id is not distinct from old.target_resource_id
       and new.target_datetime is not distinct from old.target_datetime
       and new.target_datetime_text is not distinct from old.target_datetime_text
       and new.target_end_datetime is not distinct from old.target_end_datetime
       and new.target_end_datetime_text is not distinct from
         old.target_end_datetime_text then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_LINK_NO_CHURN_REQUIRED';
    elsif new.state = 'active'
       and new.observed_reservation_version =
         old.observed_reservation_version then
      raise exception using
        errcode = '40001',
        message = 'BACKEND_MATCH_RESERVATION_LINK_MOVE_VERSION_CONFLICT';
    elsif new.state = 'released'
       and (
         new.released_at is null
         or new.release_reason is null
         or new.released_at <> new.updated_at
         or new.target_service_id is distinct from old.target_service_id
         or new.target_resource_id is distinct from old.target_resource_id
         or new.target_datetime is distinct from old.target_datetime
         or new.target_datetime_text is distinct from old.target_datetime_text
         or new.target_end_datetime is distinct from old.target_end_datetime
         or new.target_end_datetime_text is distinct from old.target_end_datetime_text
       ) then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_LINK_RELEASE_INVALID';
    end if;
  else
    raise exception using
      errcode = '55000',
      message = 'BACKEND_MATCH_RESERVATION_LINK_OPERATION_INVALID';
  end if;

  select match_row.status, reservation_row
    into v_match_status, v_reservation
  from backend_match.matches match_row
  join backend_reservation.court_reservations reservation_row
    on reservation_row.reservation_id = new.reservation_id
   and reservation_row.owner_account_id = new.owner_account_id
  where match_row.id = new.match_id
    and match_row.owner_account_id = new.owner_account_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'BACKEND_MATCH_RESERVATION_LINK_OWNER_BINDING_INVALID';
  end if;

  if new.provider_appointment_id <> v_reservation.yclients_appointment_id
     or new.provider_record_id <> v_reservation.yclients_record_id
     or new.observed_reservation_version <> v_reservation.version then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_MATCH_RESERVATION_LINK_PROVIDER_BINDING_INVALID';
  end if;

  if new.state = 'active' then
    if v_match_status = any (array['completed', 'cancelled']::text[])
       or v_reservation.status <> 'confirmed'
       or v_reservation.yclients_record_hash_ciphertext is null
       or new.target_service_id <> v_reservation.target_service_id
       or new.target_resource_id <> v_reservation.target_resource_id
       or new.target_datetime is distinct from v_reservation.target_datetime
       or new.target_datetime_text is distinct from v_reservation.target_datetime_text
       or new.target_end_datetime is distinct from v_reservation.target_end_datetime
       or new.target_end_datetime_text is distinct from v_reservation.target_end_datetime_text then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_LINK_ACTIVE_PROOF_INVALID';
    end if;
  elsif new.release_reason = 'canonical_reservation_cancelled' then
    if v_reservation.status <> 'cancelled'
       or new.observed_reservation_version <=
         old.observed_reservation_version then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_LINK_CANCEL_PROOF_INVALID';
    end if;
  elsif new.release_reason = 'match_terminal' then
    if v_match_status <> all (array['completed', 'cancelled']::text[])
       or v_reservation.status <> 'confirmed' then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_LINK_TERMINAL_PROOF_INVALID';
    end if;
  end if;

  return new;
end;
$function$;

create trigger match_reservation_links_transition_guard
before insert or update on backend_match.match_reservation_links
for each row execute function
  backend_match.guard_match_reservation_link_transition();

create function backend_match.assert_match_reservation_consistency()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_match_id uuid;
  v_reservation_id uuid;
begin
  if tg_table_schema = 'backend_match'
     and tg_table_name = 'matches' then
    v_match_id := new.id;
  elsif tg_table_schema = 'backend_reservation'
        and tg_table_name = 'court_reservations' then
    v_reservation_id := new.reservation_id;
  elsif tg_table_schema = 'backend_match'
        and tg_table_name = 'match_reservation_links' then
    v_match_id := new.match_id;
    v_reservation_id := new.reservation_id;
  else
    raise exception using
      errcode = '55000',
      message = 'BACKEND_MATCH_RESERVATION_CONSISTENCY_TRIGGER_TABLE_INVALID';
  end if;

  if exists (
    select 1
    from backend_match.match_reservation_links link_row
    join backend_match.matches match_row
      on match_row.id = link_row.match_id
     and match_row.owner_account_id = link_row.owner_account_id
    join backend_reservation.court_reservations reservation_row
      on reservation_row.reservation_id = link_row.reservation_id
     and reservation_row.owner_account_id = link_row.owner_account_id
    where link_row.state = 'active'
      and (v_match_id is null or link_row.match_id = v_match_id)
      and (
        v_reservation_id is null
        or link_row.reservation_id = v_reservation_id
      )
      and (
        match_row.status = any (array['completed', 'cancelled']::text[])
        or reservation_row.status <> 'confirmed'
        or reservation_row.yclients_appointment_id is null
        or reservation_row.yclients_record_id is null
        or reservation_row.yclients_record_hash_ciphertext is null
        or reservation_row.yclients_record_hash_nonce is null
        or reservation_row.yclients_record_hash_auth_tag is null
        or reservation_row.yclients_record_hash_algorithm is null
        or reservation_row.yclients_record_hash_encryption_key_version is null
        or reservation_row.yclients_record_hash_digest is null
        or reservation_row.yclients_record_hash_digest_key_version is null
        or link_row.provider_appointment_id <>
          reservation_row.yclients_appointment_id
        or link_row.provider_record_id <> reservation_row.yclients_record_id
        or link_row.observed_reservation_version <> reservation_row.version
        or link_row.target_service_id <> reservation_row.target_service_id
        or link_row.target_resource_id <> reservation_row.target_resource_id
        or link_row.target_datetime is distinct from
          reservation_row.target_datetime
        or link_row.target_datetime_text is distinct from
          reservation_row.target_datetime_text
        or link_row.target_end_datetime is distinct from
          reservation_row.target_end_datetime
        or link_row.target_end_datetime_text is distinct from
          reservation_row.target_end_datetime_text
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_MATCH_RESERVATION_ACTIVE_LINK_INCONSISTENT';
  end if;

  return null;
end;
$function$;

create constraint trigger match_reservation_links_consistency
after insert or update on backend_match.match_reservation_links
deferrable initially deferred
for each row execute function
  backend_match.assert_match_reservation_consistency();

create constraint trigger matches_reservation_link_consistency
after update on backend_match.matches
deferrable initially deferred
for each row execute function
  backend_match.assert_match_reservation_consistency();

create constraint trigger court_reservations_match_link_consistency
after update on backend_reservation.court_reservations
deferrable initially deferred
for each row execute function
  backend_match.assert_match_reservation_consistency();

create function backend_match.guard_match_reservation_event_insert()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_link backend_match.match_reservation_links%rowtype;
  v_previous_event backend_match.match_reservation_events%rowtype;
  v_expected_recipient_count bigint;
begin
  select * into v_link
  from backend_match.match_reservation_links link_row
  where link_row.link_id = new.link_id
    and link_row.match_id = new.match_id
    and link_row.reservation_id = new.reservation_id
    and link_row.owner_account_id = new.owner_account_id;

  if not found
     or new.reservation_version <> v_link.observed_reservation_version
     or new.occurred_at <> v_link.updated_at then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_MATCH_RESERVATION_EVENT_BINDING_INVALID';
  end if;

  select 1 + pg_catalog.count(*)
    into v_expected_recipient_count
  from backend_match.match_participants participant_row
  where participant_row.match_id = new.match_id
    and participant_row.status = 'active';

  if new.expected_recipient_count <> v_expected_recipient_count then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_MATCH_RESERVATION_EVENT_RECIPIENT_COUNT_INVALID';
  end if;

  select event_row.* into v_previous_event
  from backend_match.match_reservation_events event_row
  where event_row.link_id = new.link_id
  order by event_row.reservation_version desc, event_row.event_id desc
  limit 1;

  if new.event_type = 'court_confirmed' and found then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_MATCH_RESERVATION_CONFIRMED_EVENT_NOT_FIRST';
  elsif new.event_type <> 'court_confirmed' then
    if not found
       or v_previous_event.event_type = 'court_cancelled'
       or new.reservation_version <= v_previous_event.reservation_version
       or new.previous_service_id is distinct from
         v_previous_event.current_service_id
       or new.previous_resource_id is distinct from
         v_previous_event.current_resource_id
       or new.previous_datetime is distinct from
         v_previous_event.current_datetime
       or new.previous_datetime_text is distinct from
         v_previous_event.current_datetime_text
       or new.previous_end_datetime is distinct from
         v_previous_event.current_end_datetime
       or new.previous_end_datetime_text is distinct from
         v_previous_event.current_end_datetime_text
       or new.occurred_at < v_previous_event.occurred_at then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_EVENT_CHAIN_INVALID';
    end if;
  end if;

  if new.event_type = 'court_confirmed' then
    if v_link.state <> 'active'
       or v_link.version <> 1
       or new.current_service_id <> v_link.target_service_id
       or new.current_resource_id <> v_link.target_resource_id
       or new.current_datetime is distinct from v_link.target_datetime
       or new.current_datetime_text is distinct from v_link.target_datetime_text
       or new.current_end_datetime is distinct from v_link.target_end_datetime
       or new.current_end_datetime_text is distinct from
         v_link.target_end_datetime_text then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_CONFIRMED_EVENT_INVALID';
    end if;
  elsif new.event_type = 'court_moved' then
    if v_link.state <> 'active'
       or v_link.version < 2
       or new.current_service_id <> v_link.target_service_id
       or new.current_resource_id <> v_link.target_resource_id
       or new.current_datetime is distinct from v_link.target_datetime
       or new.current_datetime_text is distinct from v_link.target_datetime_text
       or new.current_end_datetime is distinct from v_link.target_end_datetime
       or new.current_end_datetime_text is distinct from
         v_link.target_end_datetime_text then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_MOVED_EVENT_INVALID';
    end if;
  elsif new.event_type = 'court_cancelled' then
    if v_link.state <> 'released'
       or v_link.release_reason <> 'canonical_reservation_cancelled'
       or new.previous_service_id <> v_link.target_service_id
       or new.previous_resource_id <> v_link.target_resource_id
       or new.previous_datetime is distinct from v_link.target_datetime
       or new.previous_datetime_text is distinct from v_link.target_datetime_text
       or new.previous_end_datetime is distinct from
         v_link.target_end_datetime
       or new.previous_end_datetime_text is distinct from
         v_link.target_end_datetime_text then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_CANCELLED_EVENT_INVALID';
    end if;
  end if;

  return new;
end;
$function$;

create trigger match_reservation_events_insert_guard
before insert on backend_match.match_reservation_events
for each row execute function
  backend_match.guard_match_reservation_event_insert();

create function backend_match.assert_match_reservation_link_event_consistency()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1
      from backend_match.match_reservation_events event_row
      where event_row.link_id = new.link_id
        and event_row.event_type = 'court_confirmed'
        and event_row.reservation_version =
          new.observed_reservation_version
        and event_row.current_service_id = new.target_service_id
        and event_row.current_resource_id = new.target_resource_id
        and event_row.current_datetime is not distinct from
          new.target_datetime
        and event_row.current_datetime_text is not distinct from
          new.target_datetime_text
        and event_row.current_end_datetime is not distinct from
          new.target_end_datetime
        and event_row.current_end_datetime_text is not distinct from
          new.target_end_datetime_text
        and event_row.occurred_at = new.updated_at
    ) then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_CONFIRMED_EVENT_REQUIRED';
    end if;
  elsif new.state = 'active'
        and row(
          new.target_service_id,
          new.target_resource_id,
          new.target_datetime,
          new.target_datetime_text,
          new.target_end_datetime,
          new.target_end_datetime_text
        ) is distinct from row(
          old.target_service_id,
          old.target_resource_id,
          old.target_datetime,
          old.target_datetime_text,
          old.target_end_datetime,
          old.target_end_datetime_text
        ) then
    if not exists (
      select 1
      from backend_match.match_reservation_events event_row
      where event_row.link_id = new.link_id
        and event_row.event_type = 'court_moved'
        and event_row.reservation_version =
          new.observed_reservation_version
        and event_row.previous_service_id = old.target_service_id
        and event_row.previous_resource_id = old.target_resource_id
        and event_row.previous_datetime is not distinct from
          old.target_datetime
        and event_row.previous_datetime_text is not distinct from
          old.target_datetime_text
        and event_row.previous_end_datetime is not distinct from
          old.target_end_datetime
        and event_row.previous_end_datetime_text is not distinct from
          old.target_end_datetime_text
        and event_row.current_service_id = new.target_service_id
        and event_row.current_resource_id = new.target_resource_id
        and event_row.current_datetime is not distinct from
          new.target_datetime
        and event_row.current_datetime_text is not distinct from
          new.target_datetime_text
        and event_row.current_end_datetime is not distinct from
          new.target_end_datetime
        and event_row.current_end_datetime_text is not distinct from
          new.target_end_datetime_text
        and event_row.occurred_at = new.updated_at
    ) then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_MOVED_EVENT_REQUIRED';
    end if;
  elsif new.state = 'released'
        and new.release_reason = 'canonical_reservation_cancelled' then
    if not exists (
      select 1
      from backend_match.match_reservation_events event_row
      where event_row.link_id = new.link_id
        and event_row.event_type = 'court_cancelled'
        and event_row.reservation_version =
          new.observed_reservation_version
        and event_row.previous_service_id = old.target_service_id
        and event_row.previous_resource_id = old.target_resource_id
        and event_row.previous_datetime is not distinct from
          old.target_datetime
        and event_row.previous_datetime_text is not distinct from
          old.target_datetime_text
        and event_row.previous_end_datetime is not distinct from
          old.target_end_datetime
        and event_row.previous_end_datetime_text is not distinct from
          old.target_end_datetime_text
        and event_row.occurred_at = new.updated_at
    ) then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_CANCELLED_EVENT_REQUIRED';
    end if;
  end if;

  return null;
end;
$function$;

create constraint trigger match_reservation_links_event_consistency
after insert or update on backend_match.match_reservation_links
deferrable initially deferred
for each row execute function
  backend_match.assert_match_reservation_link_event_consistency();

create function backend_match.guard_match_reservation_recipient_transition()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_match_id uuid;
  v_event_occurred_at bigint;
begin
  if tg_op = 'INSERT' then
    if new.read_at is not null or new.version <> 1 then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_RECIPIENT_INSERT_INVALID';
    end if;

    select event_row.match_id, event_row.occurred_at
      into v_match_id, v_event_occurred_at
    from backend_match.match_reservation_events event_row
    where event_row.event_id = new.event_id;

    if not found
       or new.created_at <> v_event_occurred_at
       or not exists (
      select 1
      from backend_match.matches match_row
      where match_row.id = v_match_id
        and (
          match_row.owner_account_id = new.recipient_account_id
          or exists (
            select 1
            from backend_match.match_participants participant_row
            where participant_row.match_id = match_row.id
              and participant_row.account_id = new.recipient_account_id
              and participant_row.status = 'active'
          )
        )
       ) then
      raise exception using
        errcode = '23514',
        message = 'BACKEND_MATCH_RESERVATION_RECIPIENT_NOT_ACTIVE';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.event_id is distinct from old.event_id
       or new.recipient_account_id is distinct from old.recipient_account_id
       or new.created_at is distinct from old.created_at
       or old.read_at is not null
       or new.read_at is null
       or new.read_at < old.created_at
       or old.version <> 1
       or new.version <> 2 then
      raise exception using
        errcode = '55000',
        message = 'BACKEND_MATCH_RESERVATION_RECIPIENT_TRANSITION_INVALID';
    end if;
  else
    raise exception using
      errcode = '55000',
      message = 'BACKEND_MATCH_RESERVATION_RECIPIENT_OPERATION_INVALID';
  end if;

  return new;
end;
$function$;

create trigger match_reservation_event_recipients_transition_guard
before insert or update
on backend_match.match_reservation_event_recipients
for each row execute function
  backend_match.guard_match_reservation_recipient_transition();

create function backend_match.assert_match_reservation_recipient_count()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_event_id uuid;
  v_expected smallint;
  v_actual bigint;
begin
  v_event_id := new.event_id;

  select event_row.expected_recipient_count into v_expected
  from backend_match.match_reservation_events event_row
  where event_row.event_id = v_event_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'BACKEND_MATCH_RESERVATION_RECIPIENT_EVENT_MISSING';
  end if;

  select pg_catalog.count(*) into v_actual
  from backend_match.match_reservation_event_recipients recipient_row
  where recipient_row.event_id = v_event_id;

  if v_actual <> v_expected then
    raise exception using
      errcode = '23514',
      message = 'BACKEND_MATCH_RESERVATION_RECIPIENT_SET_INCOMPLETE';
  end if;

  return null;
end;
$function$;

create constraint trigger match_reservation_events_recipient_count_consistency
after insert on backend_match.match_reservation_events
deferrable initially deferred
for each row execute function
  backend_match.assert_match_reservation_recipient_count();

create constraint trigger match_reservation_recipients_count_consistency
after insert on backend_match.match_reservation_event_recipients
deferrable initially deferred
for each row execute function
  backend_match.assert_match_reservation_recipient_count();

create function backend_match.reject_match_reservation_immutable_mutation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'BACKEND_MATCH_RESERVATION_HISTORY_IMMUTABLE';
end;
$function$;

create trigger match_reservation_links_delete_guard
before delete or truncate on backend_match.match_reservation_links
for each statement execute function
  backend_match.reject_match_reservation_immutable_mutation();

create trigger match_reservation_events_mutation_guard
before update or delete or truncate on backend_match.match_reservation_events
for each statement execute function
  backend_match.reject_match_reservation_immutable_mutation();

create trigger match_reservation_event_recipients_delete_guard
before delete or truncate
on backend_match.match_reservation_event_recipients
for each statement execute function
  backend_match.reject_match_reservation_immutable_mutation();

revoke all on table
  backend_match.match_reservation_links,
  backend_match.match_reservation_events,
  backend_match.match_reservation_event_recipients
from public, backend_auth_app;

revoke all on function
  backend_match.guard_match_reservation_link_transition(),
  backend_match.assert_match_reservation_consistency(),
  backend_match.guard_match_reservation_event_insert(),
  backend_match.assert_match_reservation_link_event_consistency(),
  backend_match.guard_match_reservation_recipient_transition(),
  backend_match.assert_match_reservation_recipient_count(),
  backend_match.reject_match_reservation_immutable_mutation()
from public, backend_auth_app;

grant select on table
  backend_match.match_reservation_links,
  backend_match.match_reservation_events,
  backend_match.match_reservation_event_recipients
to backend_auth_app;

grant insert (
  link_id,
  match_id,
  reservation_id,
  owner_account_id,
  state,
  provider_appointment_id,
  provider_record_id,
  target_service_id,
  target_resource_id,
  target_datetime,
  target_datetime_text,
  target_end_datetime,
  target_end_datetime_text,
  observed_reservation_version,
  version,
  created_at,
  updated_at
) on backend_match.match_reservation_links to backend_auth_app;

grant update (
  state,
  target_service_id,
  target_resource_id,
  target_datetime,
  target_datetime_text,
  target_end_datetime,
  target_end_datetime_text,
  observed_reservation_version,
  version,
  updated_at,
  released_at,
  release_reason
) on backend_match.match_reservation_links to backend_auth_app;

grant insert (
  event_id,
  link_id,
  match_id,
  reservation_id,
  owner_account_id,
  event_type,
  reservation_version,
  expected_recipient_count,
  previous_service_id,
  previous_resource_id,
  previous_datetime,
  previous_datetime_text,
  previous_end_datetime,
  previous_end_datetime_text,
  current_service_id,
  current_resource_id,
  current_datetime,
  current_datetime_text,
  current_end_datetime,
  current_end_datetime_text,
  occurred_at
) on backend_match.match_reservation_events to backend_auth_app;

grant insert (
  event_id,
  recipient_account_id,
  created_at,
  version
) on backend_match.match_reservation_event_recipients to backend_auth_app;

grant update (
  read_at,
  version
) on backend_match.match_reservation_event_recipients to backend_auth_app;

do $comments$
declare
  v_table_name text;
  v_function pg_catalog.regprocedure;
begin
  foreach v_table_name in array array[
    'matches',
    'match_reservation_links',
    'match_reservation_events',
    'match_reservation_event_recipients'
  ]::text[]
  loop
    execute pg_catalog.format(
      'comment on table backend_match.%I is %L',
      v_table_name,
      '034_backend_match_reservation_links:'
        || backend_auth.relation_fingerprint(
          pg_catalog.to_regclass('backend_match.' || v_table_name)
        )
    );
  end loop;

  execute pg_catalog.format(
    'comment on table backend_reservation.court_reservations is %L',
    '034_backend_match_reservation_links:'
      || backend_auth.relation_fingerprint(
        'backend_reservation.court_reservations'::pg_catalog.regclass
      )
  );

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
    order by procedure_row.proname
  loop
    execute pg_catalog.format(
      'comment on function %s is %L',
      v_function,
      '034_backend_match_reservation_links:'
        || pg_catalog.md5(
          pg_catalog.pg_get_functiondef(v_function::oid)
        )
    );
  end loop;
end;
$comments$;

do $assertions$
declare
  v_relation record;
begin
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
      raise exception 'MIGRATION_ASSERTION_FAILED: %.% fingerprint differs',
        v_relation.schema_name,
        v_relation.relation_name;
    end if;
  end loop;

  if exists (
    select 1
    from backend_match.match_reservation_links
  ) or exists (
    select 1
    from backend_match.match_reservation_events
  ) or exists (
    select 1
    from backend_match.match_reservation_event_recipients
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 034 target must start empty';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_links',
       'DELETE,TRUNCATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_events',
       'UPDATE,DELETE,TRUNCATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       'backend_match.match_reservation_event_recipients',
       'DELETE,TRUNCATE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: application history privileges are unsafe';
  end if;
end;
$assertions$;

reset role;
commit;

select '034_backend_match_reservation_links applied; run POSTCHECK before runtime wiring' as result;
