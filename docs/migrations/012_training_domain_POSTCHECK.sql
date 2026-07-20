-- 012_training_domain_POSTCHECK.sql
-- Read-only structural verification for migration 012.
-- It creates no fixtures and performs no behavioural writes.

begin;
set transaction read only;
set local search_path = pg_catalog, public, pg_temp;
set local statement_timeout = '45s';
set local lock_timeout = '5s';

do $$
declare
  v_count integer;
  v_values text[];
  v_duration_values integer[];
  v_definition text;
  v_authenticated_oid oid;
  v_relation_name text;
  v_relation regclass;
  v_schema_fingerprint text;
  v_stored_fingerprint text;
  v_object_comment text;
  v_function_signature text;
  v_function regprocedure;
  v_function_fingerprint text;
  v_function_owner oid;
begin
  if pg_catalog.to_regclass('public.training_requests') is null
     or pg_catalog.to_regclass('public.training_status_history') is null
     or pg_catalog.to_regclass('public.training_coach_assignments') is null then
    raise exception 'POSTCHECK_FAILED: one or more migration 012 tables are missing';
  end if;

  if coalesce(pg_catalog.obj_description('public.training_requests'::pg_catalog.regclass, 'pg_class'), '')
       not like 'migration=012_training_domain;%'
     or coalesce(pg_catalog.obj_description('public.training_status_history'::pg_catalog.regclass, 'pg_class'), '')
       not like 'migration=012_training_domain;%'
     or coalesce(pg_catalog.obj_description('public.training_coach_assignments'::pg_catalog.regclass, 'pg_class'), '')
       not like 'migration=012_training_domain;%' then
    raise exception 'POSTCHECK_FAILED: migration 012 table ownership comments are missing';
  end if;

  select count(*) into v_count
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.training_requests'::pg_catalog.regclass
    and a.attnum > 0
    and not a.attisdropped;
  if v_count <> 18 then
    raise exception 'POSTCHECK_FAILED: training_requests must have exactly 18 columns';
  end if;

  select count(*) into v_count
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.training_requests'::pg_catalog.regclass
    and a.attnum > 0
    and not a.attisdropped
    and (
      (a.attname = 'id' and a.atttypid = 'uuid'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'client_request_id' and a.atttypid = 'uuid'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'customer_id' and a.atttypid = 'uuid'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'court_booking_id' and a.atttypid = 'uuid'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'format' and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'player_count' and a.atttypid = 'smallint'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'duration_minutes' and a.atttypid = 'smallint'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'coach_selection' and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'status' and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
      or (
        a.attname = 'court_price_amount'
        and pg_catalog.format_type(a.atttypid, a.atttypmod) = 'numeric(12,2)'
        and a.attnotnull
      )
      or (
        a.attname = 'coach_price_amount'
        and pg_catalog.format_type(a.atttypid, a.atttypmod) = 'numeric(12,2)'
        and not a.attnotnull
      )
      or (a.attname = 'currency' and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'payment_status' and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
      or (
        a.attname = 'scheduled_start_at'
        and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
        and a.attnotnull
      )
      or (a.attname = 'court_id_snapshot' and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
      or (
        a.attname = 'free_cancellation_until'
        and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
        and a.attnotnull
      )
      or (
        a.attname = 'created_at'
        and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
        and a.attnotnull
      )
      or (
        a.attname = 'updated_at'
        and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
        and a.attnotnull
      )
    );
  if v_count <> 18 then
    raise exception 'POSTCHECK_FAILED: training_requests column types or nullability differ';
  end if;

  select count(*) into v_count
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.training_status_history'::pg_catalog.regclass
    and a.attnum > 0
    and not a.attisdropped;
  if v_count <> 10 then
    raise exception 'POSTCHECK_FAILED: training_status_history must have exactly 10 columns';
  end if;

  select count(*) into v_count
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.training_status_history'::pg_catalog.regclass
    and a.attnum > 0
    and not a.attisdropped
    and (
      (a.attname = 'id' and a.atttypid = 'uuid'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'training_request_id' and a.atttypid = 'uuid'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'from_status' and a.atttypid = 'text'::pg_catalog.regtype and not a.attnotnull)
      or (a.attname = 'to_status' and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'event_type' and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'actor_type' and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'actor_id' and a.atttypid = 'uuid'::pg_catalog.regtype and not a.attnotnull)
      or (a.attname = 'reason' and a.atttypid = 'text'::pg_catalog.regtype and not a.attnotnull)
      or (a.attname = 'metadata' and a.atttypid = 'jsonb'::pg_catalog.regtype and a.attnotnull)
      or (
        a.attname = 'created_at'
        and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
        and a.attnotnull
      )
    );
  if v_count <> 10 then
    raise exception 'POSTCHECK_FAILED: training_status_history column types or nullability differ';
  end if;

  select count(*) into v_count
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.training_coach_assignments'::pg_catalog.regclass
    and a.attnum > 0
    and not a.attisdropped;
  if v_count <> 9 then
    raise exception 'POSTCHECK_FAILED: training_coach_assignments must have exactly 9 columns';
  end if;

  select count(*) into v_count
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.training_coach_assignments'::pg_catalog.regclass
    and a.attnum > 0
    and not a.attisdropped
    and (
      (a.attname = 'id' and a.atttypid = 'uuid'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'training_request_id' and a.atttypid = 'uuid'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'coach_id' and a.atttypid = 'uuid'::pg_catalog.regtype and not a.attnotnull)
      or (a.attname = 'status' and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
      or (a.attname = 'assigned_by' and a.atttypid = 'uuid'::pg_catalog.regtype and not a.attnotnull)
      or (
        a.attname = 'assigned_at'
        and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
        and not a.attnotnull
      )
      or (
        a.attname = 'responded_at'
        and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
        and not a.attnotnull
      )
      or (
        a.attname = 'created_at'
        and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
        and a.attnotnull
      )
      or (
        a.attname = 'updated_at'
        and a.atttypid = 'timestamp with time zone'::pg_catalog.regtype
        and a.attnotnull
      )
    );
  if v_count <> 9 then
    raise exception 'POSTCHECK_FAILED: training_coach_assignments column types or nullability differ';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.training_requests'::pg_catalog.regclass
      and c.conname = 'training_requests_customer_client_request_key'
      and c.contype = 'u'
      and c.conkey = array[
        (
          select a.attnum from pg_catalog.pg_attribute a
          where a.attrelid = c.conrelid and a.attname = 'customer_id'
        ),
        (
          select a.attnum from pg_catalog.pg_attribute a
          where a.attrelid = c.conrelid and a.attname = 'client_request_id'
        )
      ]::smallint[]
  ) then
    raise exception 'POSTCHECK_FAILED: customer/client_request idempotency constraint is wrong';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_requests'::pg_catalog.regclass
         and c.conname = 'training_requests_customer_fkey'
         and c.contype = 'f'
         and c.confrelid = 'public.profiles'::pg_catalog.regclass
         and c.confdeltype = 'r'
         and c.conkey = array[
           (
             select a.attnum from pg_catalog.pg_attribute a
             where a.attrelid = c.conrelid and a.attname = 'customer_id'
           )
         ]::smallint[]
         and c.confkey = array[
           (
             select a.attnum from pg_catalog.pg_attribute a
             where a.attrelid = c.confrelid and a.attname = 'id'
           )
         ]::smallint[]
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_requests'::pg_catalog.regclass
         and c.conname = 'training_requests_court_booking_fkey'
         and c.contype = 'f'
         and c.confrelid = 'public.matches'::pg_catalog.regclass
         and c.confdeltype = 'r'
         and c.conkey = array[
           (
             select a.attnum from pg_catalog.pg_attribute a
             where a.attrelid = c.conrelid and a.attname = 'court_booking_id'
           )
         ]::smallint[]
         and c.confkey = array[
           (
             select a.attnum from pg_catalog.pg_attribute a
             where a.attrelid = c.confrelid and a.attname = 'id'
           )
         ]::smallint[]
     ) then
    raise exception 'POSTCHECK_FAILED: training_requests parent FKs must use ON DELETE RESTRICT';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_status_history'::pg_catalog.regclass
         and c.conname = 'training_status_history_request_fkey'
         and c.contype = 'f'
         and c.confrelid = 'public.training_requests'::pg_catalog.regclass
         and c.confdeltype = 'c'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_coach_assignments'::pg_catalog.regclass
         and c.conname = 'training_coach_assignments_request_fkey'
         and c.contype = 'f'
         and c.confrelid = 'public.training_requests'::pg_catalog.regclass
         and c.confdeltype = 'c'
  ) then
    raise exception 'POSTCHECK_FAILED: child request FKs must use ON DELETE CASCADE';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_status_history'::pg_catalog.regclass
         and c.conname = 'training_status_history_actor_fkey'
         and c.contype = 'f'
         and c.confrelid = 'public.profiles'::pg_catalog.regclass
          and c.confdeltype = 'r'
         and c.conkey = array[
           (
             select a.attnum from pg_catalog.pg_attribute a
             where a.attrelid = c.conrelid and a.attname = 'actor_id'
           )
         ]::smallint[]
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_coach_assignments'::pg_catalog.regclass
         and c.conname = 'training_coach_assignments_assigned_by_fkey'
         and c.contype = 'f'
         and c.confrelid = 'public.profiles'::pg_catalog.regclass
         and c.confdeltype = 'r'
         and c.conkey = array[
           (
             select a.attnum from pg_catalog.pg_attribute a
             where a.attrelid = c.conrelid and a.attname = 'assigned_by'
           )
         ]::smallint[]
     ) then
    raise exception 'POSTCHECK_FAILED: actor/assigner foreign keys or ON DELETE actions are wrong';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_constraint c
    where c.conrelid in (
      'public.training_requests'::pg_catalog.regclass,
      'public.training_status_history'::pg_catalog.regclass,
      'public.training_coach_assignments'::pg_catalog.regclass
    )
      and c.contype = 'p'
  ) <> 3 then
    raise exception 'POSTCHECK_FAILED: each migration 012 table must have exactly one primary key';
  end if;

  if (
       select count(*)
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_requests'::pg_catalog.regclass
     ) <> 16
     or (
       select count(*)
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_requests'::pg_catalog.regclass
         and c.conname in (
           'training_requests_pkey',
           'training_requests_customer_client_request_key',
           'training_requests_customer_fkey',
           'training_requests_court_booking_fkey',
           'training_requests_format_check',
           'training_requests_player_count_check',
           'training_requests_duration_check',
           'training_requests_coach_selection_check',
           'training_requests_status_check',
           'training_requests_court_price_check',
           'training_requests_coach_price_check',
           'training_requests_confirmed_price_check',
           'training_requests_currency_check',
           'training_requests_payment_status_check',
           'training_requests_cancellation_deadline_check',
           'training_requests_timestamps_check'
         )
     ) <> 16 then
    raise exception 'POSTCHECK_FAILED: training_requests constraint set is not exact';
  end if;

  if (
       select count(*)
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_status_history'::pg_catalog.regclass
     ) <> 9
     or (
       select count(*)
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_status_history'::pg_catalog.regclass
         and c.conname in (
           'training_status_history_pkey',
           'training_status_history_request_fkey',
           'training_status_history_actor_fkey',
           'training_status_history_from_status_check',
           'training_status_history_to_status_check',
           'training_status_history_transition_check',
           'training_status_history_event_type_check',
           'training_status_history_actor_type_check',
           'training_status_history_metadata_check'
         )
     ) <> 9 then
    raise exception 'POSTCHECK_FAILED: training_status_history constraint set is not exact';
  end if;

  if (
       select count(*)
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_coach_assignments'::pg_catalog.regclass
     ) <> 6
     or (
       select count(*)
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_coach_assignments'::pg_catalog.regclass
         and c.conname in (
           'training_coach_assignments_pkey',
           'training_coach_assignments_request_fkey',
           'training_coach_assignments_assigned_by_fkey',
           'training_coach_assignments_status_check',
           'training_coach_assignments_pending_only_check',
           'training_coach_assignments_timestamps_check'
         )
     ) <> 6 then
    raise exception 'POSTCHECK_FAILED: training_coach_assignments constraint set is not exact';
  end if;

  select array_agg(distinct (m.value)[1] order by (m.value)[1])
  into v_values
  from pg_catalog.pg_constraint c
  cross join lateral pg_catalog.regexp_matches(
    pg_catalog.pg_get_constraintdef(c.oid, true),
    '''([^'']+)''',
    'g'
  ) m(value)
  where c.conrelid = 'public.training_requests'::pg_catalog.regclass
    and c.conname = 'training_requests_status_check';
  if v_values is distinct from array[
    'awaiting_coach',
    'cancel_pending',
    'cancelled',
    'completed',
    'confirmed',
    'court_sync_pending',
    'court_sync_unknown',
    'rejected'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: request statuses are not the exact canonical set';
  end if;

  select array_agg(distinct (m.value)[1] order by (m.value)[1])
  into v_values
  from pg_catalog.pg_constraint c
  cross join lateral pg_catalog.regexp_matches(
    pg_catalog.pg_get_constraintdef(c.oid, true),
    '''([^'']+)''',
    'g'
  ) m(value)
  where c.conrelid = 'public.training_status_history'::pg_catalog.regclass
    and c.conname = 'training_status_history_from_status_check';
  if v_values is distinct from array[
    'awaiting_coach',
    'cancel_pending',
    'cancelled',
    'completed',
    'confirmed',
    'court_sync_pending',
    'court_sync_unknown',
    'rejected'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: history from_status set is not exact';
  end if;

  select array_agg(distinct (m.value)[1] order by (m.value)[1])
  into v_values
  from pg_catalog.pg_constraint c
  cross join lateral pg_catalog.regexp_matches(
    pg_catalog.pg_get_constraintdef(c.oid, true),
    '''([^'']+)''',
    'g'
  ) m(value)
  where c.conrelid = 'public.training_status_history'::pg_catalog.regclass
    and c.conname = 'training_status_history_to_status_check';
  if v_values is distinct from array[
    'awaiting_coach',
    'cancel_pending',
    'cancelled',
    'completed',
    'confirmed',
    'court_sync_pending',
    'court_sync_unknown',
    'rejected'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: history to_status set is not exact';
  end if;

  select array_agg(distinct (m.value)[1] order by (m.value)[1])
  into v_values
  from pg_catalog.pg_constraint c
  cross join lateral pg_catalog.regexp_matches(
    pg_catalog.pg_get_constraintdef(c.oid, true),
    '''([^'']+)''',
    'g'
  ) m(value)
  where c.conrelid = 'public.training_requests'::pg_catalog.regclass
    and c.conname = 'training_requests_payment_status_check';
  if v_values is distinct from array[
    'not_due',
    'paid_offline',
    'pending_offline'
  ]::text[] then
    raise exception 'POSTCHECK_FAILED: payment statuses are not the exact canonical set';
  end if;

  select array_agg(distinct ((m.value)[1])::integer order by ((m.value)[1])::integer)
  into v_duration_values
  from pg_catalog.pg_constraint c
  cross join lateral pg_catalog.regexp_matches(
    pg_catalog.pg_get_constraintdef(c.oid, true),
    E'\\m([0-9]+)\\M',
    'g'
  ) m(value)
  where c.conrelid = 'public.training_requests'::pg_catalog.regclass
    and c.conname = 'training_requests_duration_check';
  if v_duration_values is distinct from array[60, 90]::integer[] then
    raise exception 'POSTCHECK_FAILED: durations are not exactly {60,90}';
  end if;

  if not exists (
       select 1 from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_requests'::pg_catalog.regclass
         and c.conname = 'training_requests_format_check'
         and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid, true), 'format = ''individual''') > 0
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_requests'::pg_catalog.regclass
         and c.conname = 'training_requests_player_count_check'
         and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid, true), 'player_count = 1') > 0
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_requests'::pg_catalog.regclass
         and c.conname = 'training_requests_coach_selection_check'
         and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid, true), 'coach_selection = ''club''') > 0
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_requests'::pg_catalog.regclass
         and c.conname = 'training_requests_currency_check'
         and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid, true), 'currency = ''RUB''') > 0
     ) then
    raise exception 'POSTCHECK_FAILED: fixed individual-training constants are wrong';
  end if;

  select array_agg(distinct (m.value)[1] order by (m.value)[1])
  into v_values
  from pg_catalog.pg_constraint c
  cross join lateral pg_catalog.regexp_matches(
    pg_catalog.pg_get_constraintdef(c.oid, true),
    '''([^'']+)''',
    'g'
  ) m(value)
  where c.conrelid = 'public.training_coach_assignments'::pg_catalog.regclass
    and c.conname = 'training_coach_assignments_status_check';
  if v_values is distinct from array['selection_pending']::text[] then
    raise exception 'POSTCHECK_FAILED: coach assignment must be pending-only in 012';
  end if;

  if not exists (
       select 1 from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_status_history'::pg_catalog.regclass
         and c.conname = 'training_status_history_transition_check'
         and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid, true), 'from_status IS NULL') > 0
         and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid, true), 'from_status <> to_status') > 0
     )
     or not exists (
       select 1 from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_status_history'::pg_catalog.regclass
         and c.conname = 'training_status_history_metadata_check'
         and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid, true), 'jsonb_typeof') > 0
         and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid, true), '''object''') > 0
     ) then
    raise exception 'POSTCHECK_FAILED: status history shape constraints are wrong';
  end if;

  select pg_catalog.regexp_replace(
    pg_catalog.pg_get_constraintdef(c.oid, true),
    E'\\s+',
    ' ',
    'g'
  ) into v_definition
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.training_coach_assignments'::pg_catalog.regclass
    and c.conname = 'training_coach_assignments_pending_only_check';
  if v_definition is null
     or pg_catalog.strpos(v_definition, 'coach_id IS NULL') = 0
     or pg_catalog.strpos(v_definition, 'assigned_by IS NULL') = 0
     or pg_catalog.strpos(v_definition, 'assigned_at IS NULL') = 0
     or pg_catalog.strpos(v_definition, 'responded_at IS NULL') = 0 then
    raise exception 'POSTCHECK_FAILED: pending coach assignment shape is not strict';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.training_coach_assignments'::pg_catalog.regclass
      and c.contype = 'f'
      and c.conkey = array[
        (
          select a.attnum from pg_catalog.pg_attribute a
          where a.attrelid = c.conrelid and a.attname = 'coach_id'
        )
      ]::smallint[]
  ) then
    raise exception 'POSTCHECK_FAILED: 012 must not invent a coach registry foreign key';
  end if;

  select pg_catalog.regexp_replace(
    pg_catalog.pg_get_constraintdef(c.oid, true),
    E'\\s+',
    ' ',
    'g'
  ) into v_definition
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.training_requests'::pg_catalog.regclass
    and c.conname = 'training_requests_cancellation_deadline_check';
  if v_definition is null
     or pg_catalog.strpos(v_definition, 'free_cancellation_until') = 0
     or pg_catalog.strpos(v_definition, 'scheduled_start_at') = 0
     or (
       pg_catalog.strpos(v_definition, '24:00:00') = 0
       and pg_catalog.strpos(v_definition, '24 hours') = 0
     ) then
    raise exception 'POSTCHECK_FAILED: exact 24-hour cancellation constraint is missing';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_requests'::pg_catalog.regclass
         and c.conname = 'training_requests_court_price_check'
         and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid, true), 'court_price_amount >= 0') > 0
         and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid, true), 'court_price_amount <= 1000000') > 0
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = 'public.training_requests'::pg_catalog.regclass
         and c.conname = 'training_requests_coach_price_check'
         and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid, true), 'coach_price_amount IS NULL') > 0
         and pg_catalog.strpos(pg_catalog.pg_get_constraintdef(c.oid, true), 'coach_price_amount >= 0') > 0
     ) then
    raise exception 'POSTCHECK_FAILED: price constraints are incomplete';
  end if;

  if exists (
    with expected_indexes(
      table_name, index_name, is_unique, key_columns, descending, expected_predicate
    ) as (
      values
        ('public.training_requests', 'training_requests_pkey', true,
          array['id']::text[], array[false]::boolean[], null::text),
        ('public.training_requests', 'training_requests_customer_client_request_key', true,
          array['customer_id', 'client_request_id']::text[], array[false, false]::boolean[], null::text),
        ('public.training_requests', 'training_requests_one_active_per_booking_idx', true,
          array['court_booking_id']::text[], array[false]::boolean[],
          'status = any (array[''court_sync_pending'', ''court_sync_unknown'', ''awaiting_coach'', ''confirmed'', ''cancel_pending'']::text[])'),
        ('public.training_requests', 'training_requests_customer_status_idx', false,
          array['customer_id', 'status', 'created_at', 'id']::text[],
          array[false, false, true, true]::boolean[], null::text),
        ('public.training_requests', 'training_requests_court_booking_idx', false,
          array['court_booking_id', 'created_at']::text[], array[false, true]::boolean[], null::text),
        ('public.training_status_history', 'training_status_history_pkey', true,
          array['id']::text[], array[false]::boolean[], null::text),
        ('public.training_status_history', 'training_status_history_request_created_idx', false,
          array['training_request_id', 'created_at', 'id']::text[],
          array[false, false, false]::boolean[], null::text),
        ('public.training_status_history', 'training_status_history_actor_idx', false,
          array['actor_id', 'created_at']::text[], array[false, true]::boolean[],
          'actor_id is not null'),
        ('public.training_coach_assignments', 'training_coach_assignments_pkey', true,
          array['id']::text[], array[false]::boolean[], null::text),
        ('public.training_coach_assignments', 'training_coach_assignments_one_pending_idx', true,
          array['training_request_id']::text[], array[false]::boolean[], null::text),
        ('public.training_coach_assignments', 'training_coach_assignments_request_created_idx', false,
          array['training_request_id', 'created_at', 'id']::text[],
          array[false, false, false]::boolean[], null::text),
        ('public.training_coach_assignments', 'training_coach_assignments_assigned_by_idx', false,
          array['assigned_by']::text[], array[false]::boolean[],
          'assigned_by is not null')
    ), actual_indexes as (
      select
        tbl_ns.nspname || '.' || tbl.relname as table_name,
        idx.relname as index_name,
        ns.nspname as index_schema,
        i.indisunique as is_unique,
        i.indisvalid,
        i.indisready,
        i.indnkeyatts,
        i.indnatts,
        i.indexprs,
        pg_catalog.pg_get_expr(i.indpred, i.indrelid, false) as predicate,
        (
          select pg_catalog.array_agg(a.attname order by keys.ordinality)
          from pg_catalog.unnest(i.indkey) with ordinality as keys(attnum, ordinality)
          join pg_catalog.pg_attribute a
            on a.attrelid = i.indrelid and a.attnum = keys.attnum
        ) as key_columns,
        (
          select pg_catalog.array_agg(((options.option_value & 1) = 1) order by options.ordinality)
          from pg_catalog.unnest(i.indoption) with ordinality
            as options(option_value, ordinality)
        ) as descending
      from pg_catalog.pg_index i
      join pg_catalog.pg_class idx on idx.oid = i.indexrelid
      join pg_catalog.pg_namespace ns on ns.oid = idx.relnamespace
      join pg_catalog.pg_class tbl on tbl.oid = i.indrelid
      join pg_catalog.pg_namespace tbl_ns on tbl_ns.oid = tbl.relnamespace
      where i.indrelid in (
        'public.training_requests'::pg_catalog.regclass,
        'public.training_status_history'::pg_catalog.regclass,
        'public.training_coach_assignments'::pg_catalog.regclass
      )
    )
    select 1
    from expected_indexes e
    left join actual_indexes a
      on a.table_name = e.table_name and a.index_name = e.index_name
    where a.index_name is null
       or a.index_schema <> 'public'
       or a.is_unique is distinct from e.is_unique
       or not a.indisvalid
       or not a.indisready
       or a.indnkeyatts <> pg_catalog.cardinality(e.key_columns)
       or a.indnatts <> pg_catalog.cardinality(e.key_columns)
       or a.indexprs is not null
       or a.key_columns is distinct from e.key_columns
       or a.descending is distinct from e.descending
       or (
          e.expected_predicate is null and a.predicate is not null
        )
        or (
          e.expected_predicate is not null
          and pg_catalog.replace(
            pg_catalog.replace(
              pg_catalog.regexp_replace(
                pg_catalog.lower(coalesce(a.predicate, '')),
               E'[\\s()"]+',
               '',
               'g'
             ),
             '::text[]',
             ''
           ),
            '::text',
            ''
          ) is distinct from pg_catalog.replace(
            pg_catalog.replace(
              pg_catalog.regexp_replace(
                pg_catalog.lower(coalesce(e.expected_predicate, '')),
                E'[\\s()"]+',
                '',
                'g'
              ),
              '::text[]',
              ''
            ),
            '::text',
            ''
          )
        )
  )
  or (
    select count(*)
    from pg_catalog.pg_index i
    where i.indrelid in (
      'public.training_requests'::pg_catalog.regclass,
      'public.training_status_history'::pg_catalog.regclass,
      'public.training_coach_assignments'::pg_catalog.regclass
    )
  ) <> 12 then
    raise exception 'POSTCHECK_FAILED: migration 012 index definitions are not exact';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.training_requests'::pg_catalog.regclass
      and t.tgname = 'training_requests_validate_booking'
      and not t.tgisinternal
      and t.tgtype = 23
      and t.tgattr = '3 4 7 14 15 16'::pg_catalog.int2vector
      and t.tgfoid = pg_catalog.to_regprocedure('public.training_request_validate_booking()')::oid
      and pg_catalog.strpos(pg_catalog.pg_get_triggerdef(t.oid, true), 'BEFORE INSERT OR UPDATE') > 0
  ) then
    raise exception 'POSTCHECK_FAILED: booking validation trigger definition is wrong';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.training_requests'::pg_catalog.regclass
         and t.tgname = 'training_requests_prevent_delete'
         and not t.tgisinternal
         and t.tgtype = 11
         and t.tgfoid = pg_catalog.to_regprocedure('public.training_request_prevent_delete()')::oid
         and pg_catalog.strpos(pg_catalog.pg_get_triggerdef(t.oid, true), 'BEFORE DELETE') > 0
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.training_status_history'::pg_catalog.regclass
         and t.tgname = 'training_status_history_append_only'
         and not t.tgisinternal
         and t.tgtype = 27
         and t.tgfoid = pg_catalog.to_regprocedure('public.training_status_history_prevent_mutation()')::oid
         and pg_catalog.strpos(pg_catalog.pg_get_triggerdef(t.oid, true), 'BEFORE') > 0
         and pg_catalog.strpos(pg_catalog.pg_get_triggerdef(t.oid, true), 'UPDATE') > 0
         and pg_catalog.strpos(pg_catalog.pg_get_triggerdef(t.oid, true), 'DELETE') > 0
     ) then
    raise exception 'POSTCHECK_FAILED: delete/append-only protection triggers are wrong';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.training_requests'::pg_catalog.regclass
         and t.tgname = 'set_training_requests_updated_at'
         and not t.tgisinternal
         and t.tgtype = 19
         and t.tgfoid = pg_catalog.to_regprocedure('public.set_updated_at()')::oid
     )
     or not exists (
       select 1
       from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.training_coach_assignments'::pg_catalog.regclass
         and t.tgname = 'set_training_coach_assignments_updated_at'
         and not t.tgisinternal
         and t.tgtype = 19
         and t.tgfoid = pg_catalog.to_regprocedure('public.set_updated_at()')::oid
     ) then
    raise exception 'POSTCHECK_FAILED: updated_at triggers are wrong';
  end if;

  if pg_catalog.to_regprocedure('public.training_request_validate_booking()') is null
     or pg_catalog.to_regprocedure('public.training_request_prevent_delete()') is null
     or pg_catalog.to_regprocedure('public.training_status_history_prevent_mutation()') is null then
    raise exception 'POSTCHECK_FAILED: one or more migration 012 functions are missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_language l on l.oid = p.prolang
    where p.oid in (
      pg_catalog.to_regprocedure('public.training_request_validate_booking()')::oid,
      pg_catalog.to_regprocedure('public.training_request_prevent_delete()')::oid,
      pg_catalog.to_regprocedure('public.training_status_history_prevent_mutation()')::oid
    )
      and (
        p.prorettype <> 'trigger'::pg_catalog.regtype
        or p.proretset
        or p.prosecdef
        or l.lanname <> 'plpgsql'
        or not coalesce(p.proconfig, array[]::text[]) && array[
          'search_path=pg_catalog, public, pg_temp',
          'search_path=pg_catalog, pg_temp'
        ]::text[]
      )
  ) then
    raise exception 'POSTCHECK_FAILED: function return type, language, security or search_path is wrong';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.training_request_validate_booking()')::oid
         and p.proconfig = array['search_path=pg_catalog, public, pg_temp']::text[]
     )
     or not exists (
       select 1
       from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.training_request_prevent_delete()')::oid
         and p.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
     )
     or not exists (
       select 1
       from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.training_status_history_prevent_mutation()')::oid
         and p.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
     ) then
    raise exception 'POSTCHECK_FAILED: a migration 012 function has an unexpected exact search_path';
  end if;

  select pg_catalog.replace(
    pg_catalog.replace(
      coalesce(pg_catalog.pg_get_functiondef(p.oid), ''),
      E'\r\n',
      E'\n'
    ),
    E'\r',
    E'\n'
  ) into v_definition
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.training_request_validate_booking()')::oid;
  if v_definition is null
     or pg_catalog.strpos(v_definition, 'for update of m') = 0
     or pg_catalog.strpos(v_definition, 'v_type is distinct from ''private''') = 0
     or pg_catalog.strpos(v_definition, 'v_scenario is distinct from ''private''') = 0
     or pg_catalog.strpos(v_definition, 'v_is_private is distinct from true') = 0
     or pg_catalog.strpos(v_definition, 'v_status is distinct from ''upcoming''') = 0
     or pg_catalog.strpos(v_definition, 'v_duration * 60::numeric') = 0
     or pg_catalog.strpos(v_definition, 'at time zone ''Europe/Moscow''') = 0
     or pg_catalog.strpos(v_definition, 'new.scheduled_start_at is distinct from v_scheduled_start_at') = 0
     or pg_catalog.strpos(v_definition, 'new.court_id_snapshot is distinct from v_court_id') = 0
     or pg_catalog.strpos(v_definition, 'interval ''24 hours''') = 0
     or pg_catalog.strpos(v_definition, 'auth.uid') > 0 then
    raise exception 'POSTCHECK_FAILED: booking validation function lacks an exact required condition';
  end if;

  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.training_request_prevent_delete()')::oid;
  if v_definition is null
     or pg_catalog.strpos(v_definition, 'TRAINING_REQUEST_PHYSICAL_DELETE_FORBIDDEN') = 0
     or pg_catalog.strpos(v_definition, 'auth.uid') > 0 then
    raise exception 'POSTCHECK_FAILED: request delete guard definition is wrong';
  end if;

  select pg_catalog.pg_get_functiondef(p.oid)
  into v_definition
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.training_status_history_prevent_mutation()')::oid;
  if v_definition is null
     or pg_catalog.strpos(v_definition, 'TRAINING_STATUS_HISTORY_APPEND_ONLY') = 0
     or pg_catalog.strpos(v_definition, 'auth.uid') > 0 then
    raise exception 'POSTCHECK_FAILED: history mutation guard definition is wrong';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where p.oid in (
      pg_catalog.to_regprocedure('public.training_request_validate_booking()')::oid,
      pg_catalog.to_regprocedure('public.training_request_prevent_delete()')::oid,
      pg_catalog.to_regprocedure('public.training_status_history_prevent_mutation()')::oid
    )
      and acl.privilege_type = 'EXECUTE'
      and acl.grantee = any (array[
        0::oid,
        (select oid from pg_catalog.pg_roles where rolname = 'anon'),
        (select oid from pg_catalog.pg_roles where rolname = 'authenticated'),
        (select oid from pg_catalog.pg_roles where rolname = 'service_role')
      ]::oid[])
  ) then
    raise exception 'POSTCHECK_FAILED: a migration 012 trigger function is directly executable by an API role or PUBLIC';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    where c.oid in (
      'public.training_requests'::pg_catalog.regclass,
      'public.training_status_history'::pg_catalog.regclass,
      'public.training_coach_assignments'::pg_catalog.regclass
    )
      and acl.privilege_type in (
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      )
      and acl.grantee = any (array[
        0::oid,
        (select oid from pg_catalog.pg_roles where rolname = 'anon'),
        (select oid from pg_catalog.pg_roles where rolname = 'authenticated'),
        (select oid from pg_catalog.pg_roles where rolname = 'service_role')
      ]::oid[])
  ) then
    raise exception 'POSTCHECK_FAILED: direct table write privilege exists for PUBLIC/API/integration role';
  end if;

  if exists (
    select 1
    from (
      values ('anon'), ('authenticated'), ('service_role')
    ) as roles(role_name)
    cross join (
      values
        ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
        ('REFERENCES'), ('TRIGGER')
    ) as privileges(privilege_name)
    cross join (
      values
        ('public.training_requests'),
        ('public.training_status_history'),
        ('public.training_coach_assignments')
    ) as relations(relation_name)
    where pg_catalog.has_table_privilege(
      roles.role_name,
      relations.relation_name,
      privileges.privilege_name
    )
  ) then
    raise exception 'POSTCHECK_FAILED: an API/integration role has an effective write privilege, including inherited grants';
  end if;

  if exists (
    select 1
    from (
      values ('anon'), ('authenticated'), ('service_role')
    ) as roles(role_name)
    cross join (
      values
        ('public.training_request_validate_booking()'),
        ('public.training_request_prevent_delete()'),
        ('public.training_status_history_prevent_mutation()')
    ) as functions(function_signature)
    where pg_catalog.has_function_privilege(
      roles.role_name,
      functions.function_signature,
      'EXECUTE'
    )
  ) then
    raise exception 'POSTCHECK_FAILED: an API/integration role has effective EXECUTE on a migration 012 function';
  end if;

  if not pg_catalog.has_table_privilege('authenticated', 'public.training_requests', 'SELECT')
     or not pg_catalog.has_table_privilege('authenticated', 'public.training_status_history', 'SELECT')
     or not pg_catalog.has_table_privilege('authenticated', 'public.training_coach_assignments', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.training_requests', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.training_status_history', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.training_coach_assignments', 'SELECT')
     or pg_catalog.has_table_privilege('service_role', 'public.training_requests', 'SELECT')
     or pg_catalog.has_table_privilege('service_role', 'public.training_status_history', 'SELECT')
     or pg_catalog.has_table_privilege('service_role', 'public.training_coach_assignments', 'SELECT')
     or exists (
       select 1
       from pg_catalog.pg_class c
       cross join lateral pg_catalog.aclexplode(
         coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
       ) acl
       where c.oid in (
         'public.training_requests'::pg_catalog.regclass,
         'public.training_status_history'::pg_catalog.regclass,
         'public.training_coach_assignments'::pg_catalog.regclass
       )
         and acl.grantee = 0
         and acl.privilege_type = 'SELECT'
     ) then
    raise exception 'POSTCHECK_FAILED: table SELECT ACL differs from the read-only client model';
  end if;

  select oid into v_authenticated_oid
  from pg_catalog.pg_roles
  where rolname = 'authenticated';

  if (
       select count(*)
       from pg_catalog.pg_class c
       where c.oid in (
         'public.training_requests'::pg_catalog.regclass,
         'public.training_status_history'::pg_catalog.regclass,
         'public.training_coach_assignments'::pg_catalog.regclass
       )
         and c.relrowsecurity
     ) <> 3 then
    raise exception 'POSTCHECK_FAILED: RLS is not enabled on all migration 012 tables';
  end if;

  if (
       select count(*)
       from pg_catalog.pg_policy p
       where p.polrelid in (
         'public.training_requests'::pg_catalog.regclass,
         'public.training_status_history'::pg_catalog.regclass,
         'public.training_coach_assignments'::pg_catalog.regclass
       )
     ) <> 3
     or exists (
       select 1
       from pg_catalog.pg_policy p
       where p.polrelid in (
         'public.training_requests'::pg_catalog.regclass,
         'public.training_status_history'::pg_catalog.regclass,
         'public.training_coach_assignments'::pg_catalog.regclass
       )
         and (p.polcmd <> 'r' or p.polroles <> array[v_authenticated_oid]::oid[])
     ) then
    raise exception 'POSTCHECK_FAILED: exactly one authenticated SELECT policy per table is required';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_policy p
       where p.polrelid in (
         'public.training_requests'::pg_catalog.regclass,
         'public.training_status_history'::pg_catalog.regclass,
         'public.training_coach_assignments'::pg_catalog.regclass
       )
         and (
           not p.polpermissive
           or p.polcmd <> 'r'
           or p.polroles <> array[v_authenticated_oid]::oid[]
           or p.polwithcheck is not null
         )
     )
     or not exists (
       select 1 from pg_catalog.pg_policy p
       where p.polrelid = 'public.training_requests'::pg_catalog.regclass
         and p.polname = 'training_requests_select_own'
     )
     or not exists (
       select 1 from pg_catalog.pg_policy p
       where p.polrelid = 'public.training_status_history'::pg_catalog.regclass
         and p.polname = 'training_status_history_select_own'
     )
     or not exists (
       select 1 from pg_catalog.pg_policy p
       where p.polrelid = 'public.training_coach_assignments'::pg_catalog.regclass
         and p.polname = 'training_coach_assignments_select_own'
     ) then
    raise exception 'POSTCHECK_FAILED: RLS policy name/table/role/mode/command/WITH CHECK differs';
  end if;

  -- The exact normalized USING expressions are part of each table schema_md5
  -- manifest verified below. Any added condition, including OR true, changes
  -- pg_get_expr(...) in that manifest and makes POSTCHECK fail.

  foreach v_relation_name in array array[
    'public.training_requests',
    'public.training_status_history',
    'public.training_coach_assignments'
  ]::text[] loop
    v_relation := pg_catalog.to_regclass(v_relation_name);
    v_object_comment := coalesce(
      pg_catalog.obj_description(v_relation, 'pg_class'),
      ''
    );
    v_stored_fingerprint := substring(
      v_object_comment from 'schema_md5=([0-9a-f]{32})'
    );

    select pg_catalog.md5(
      pg_catalog.jsonb_build_object(
        'relation', pg_catalog.jsonb_build_object(
          'name', rel.oid::pg_catalog.regclass::text,
          'kind', rel.relkind,
          'owner', pg_catalog.pg_get_userbyid(rel.relowner),
          'row_security', rel.relrowsecurity,
          'force_row_security', rel.relforcerowsecurity,
          'replica_identity', rel.relreplident,
          'options', rel.reloptions,
          'acl', rel.relacl
        ),
        'columns', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'number', a.attnum,
              'name', a.attname,
              'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
              'not_null', a.attnotnull,
              'identity', a.attidentity,
              'generated', a.attgenerated,
              'collation', a.attcollation,
              'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid, false)
            )
            order by a.attnum
          )
          from pg_catalog.pg_attribute a
          left join pg_catalog.pg_attrdef d
            on d.adrelid = a.attrelid and d.adnum = a.attnum
          where a.attrelid = rel.oid
            and a.attnum > 0
            and not a.attisdropped
        ), '[]'::jsonb),
        'constraints', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'name', con.conname,
              'type', con.contype,
              'deferrable', con.condeferrable,
              'deferred', con.condeferred,
              'validated', con.convalidated,
              'keys', con.conkey::text,
              'referenced_table', case
                when con.confrelid = 0 then null
                else con.confrelid::pg_catalog.regclass::text
              end,
              'referenced_keys', con.confkey::text,
              'on_update', con.confupdtype,
              'on_delete', con.confdeltype,
              'match_type', con.confmatchtype,
              'definition', pg_catalog.pg_get_constraintdef(con.oid, false)
            )
            order by con.conname
          )
          from pg_catalog.pg_constraint con
          where con.conrelid = rel.oid
        ), '[]'::jsonb),
        'indexes', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'name', idx.relname,
              'unique', i.indisunique,
              'primary', i.indisprimary,
              'valid', i.indisvalid,
              'ready', i.indisready,
              'key_count', i.indnkeyatts,
              'attribute_count', i.indnatts,
              'keys', i.indkey::text,
              'options', i.indoption::text,
              'expressions', pg_catalog.pg_get_expr(i.indexprs, i.indrelid, false),
              'predicate', pg_catalog.pg_get_expr(i.indpred, i.indrelid, false),
              'definition', pg_catalog.pg_get_indexdef(i.indexrelid, 0, false)
            )
            order by idx.relname
          )
          from pg_catalog.pg_index i
          join pg_catalog.pg_class idx on idx.oid = i.indexrelid
          where i.indrelid = rel.oid
        ), '[]'::jsonb),
        'policies', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'name', pol.polname,
              'permissive', pol.polpermissive,
              'command', pol.polcmd,
              'roles', (
                select pg_catalog.jsonb_agg(
                  pg_catalog.pg_get_userbyid(role_oid)
                  order by pg_catalog.pg_get_userbyid(role_oid)
                )
                from pg_catalog.unnest(pol.polroles) as policy_roles(role_oid)
              ),
              'using', pg_catalog.pg_get_expr(pol.polqual, pol.polrelid, false),
              'with_check', pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid, false)
            )
            order by pol.polname
          )
          from pg_catalog.pg_policy pol
          where pol.polrelid = rel.oid
        ), '[]'::jsonb),
        'triggers', coalesce((
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'name', trg.tgname,
              'enabled', trg.tgenabled,
              'type', trg.tgtype,
              'columns', trg.tgattr::text,
              'function', trg.tgfoid::pg_catalog.regprocedure::text,
              'definition', pg_catalog.pg_get_triggerdef(trg.oid, false)
            )
            order by trg.tgname
          )
          from pg_catalog.pg_trigger trg
          where trg.tgrelid = rel.oid
            and not trg.tgisinternal
        ), '[]'::jsonb)
      )::text
    )
    into v_schema_fingerprint
    from pg_catalog.pg_class rel
    where rel.oid = v_relation;

    if v_stored_fingerprint is null
       or v_schema_fingerprint is distinct from v_stored_fingerprint then
      raise exception 'POSTCHECK_FAILED: exact schema manifest differs for %',
        v_relation_name;
    end if;
  end loop;

  foreach v_function_signature in array array[
    'public.training_request_validate_booking()',
    'public.training_request_prevent_delete()',
    'public.training_status_history_prevent_mutation()'
  ]::text[] loop
    v_function := pg_catalog.to_regprocedure(v_function_signature);
    v_object_comment := coalesce(
      pg_catalog.obj_description(v_function, 'pg_proc'),
      ''
    );
    v_stored_fingerprint := substring(
      v_object_comment from 'definition_md5=([0-9a-f]{32})'
    );

    select
      pg_catalog.md5(
        pg_catalog.replace(
          pg_catalog.replace(
            coalesce(pg_catalog.pg_get_functiondef(p.oid), ''),
            E'\r\n',
            E'\n'
          ),
          E'\r',
          E'\n'
        )
      ),
      p.proowner
    into v_function_fingerprint, v_function_owner
    from pg_catalog.pg_proc p
    where p.oid = v_function;

    if v_stored_fingerprint is null
       or v_function_fingerprint is distinct from v_stored_fingerprint
       or substring(v_object_comment from 'owner_oid=([0-9]+)')
          is distinct from v_function_owner::text then
      raise exception 'POSTCHECK_FAILED: exact function manifest differs for %',
        v_function_signature;
    end if;
  end loop;

  if pg_catalog.to_regprocedure('public.create_booking(jsonb)') is null
     or not exists (
       select 1
       from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
         and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_booking jsonb'
         and p.prorettype = 'public.matches'::pg_catalog.regtype
         and not p.proretset
         and not p.prosecdef
         and p.provolatile = 'v'
         and p.prolang = (select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql')
          and p.proconfig = array['search_path=pg_catalog, public, pg_temp']::text[]
         and coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '')
           like 'migration=011_create_booking_price_snapshot;%'
     ) then
    raise exception 'POSTCHECK_FAILED: create_booking no longer matches migration 011';
  end if;

  v_object_comment := coalesce(
    pg_catalog.obj_description(
      'public.training_requests'::pg_catalog.regclass,
      'pg_class'
    ),
    ''
  );

  select pg_catalog.md5(
    pg_catalog.replace(
      pg_catalog.replace(
        coalesce(pg_catalog.pg_get_functiondef(p.oid), ''),
        E'\r\n',
        E'\n'
      ),
      E'\r',
      E'\n'
    )
  )
  into v_definition
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid;

  if v_definition is distinct from substring(
    v_object_comment from 'legacy_create_booking_md5=([0-9a-f]{32})'
  ) then
    raise exception 'POSTCHECK_FAILED: create_booking differs from the definition approved by migration 012';
  end if;

  select pg_catalog.md5(pg_catalog.pg_get_constraintdef(c.oid, false))
  into v_definition
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.matches'::pg_catalog.regclass
    and c.conname = 'matches_no_active_court_overlap'
    and c.contype = 'x'
    and not c.condeferrable
    and not c.condeferred;

  if v_definition is null
     or v_definition is distinct from substring(
       v_object_comment from 'legacy_overlap_md5=([0-9a-f]{32})'
     ) then
    raise exception 'POSTCHECK_FAILED: overlap constraint differs from the definition approved by migration 012';
  end if;

  select pg_catalog.md5(
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'name', p.polname,
          'permissive', p.polpermissive,
          'command', p.polcmd,
          'roles', (
            select pg_catalog.jsonb_agg(
              pg_catalog.pg_get_userbyid(role_oid)
              order by pg_catalog.pg_get_userbyid(role_oid)
            )
            from pg_catalog.unnest(p.polroles) as policy_roles(role_oid)
          ),
          'using', pg_catalog.regexp_replace(
            coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid, false), ''),
            E'\\s+',
            ' ',
            'g'
          ),
          'with_check', pg_catalog.regexp_replace(
            coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false), ''),
            E'\\s+',
            ' ',
            'g'
          )
        )
        order by p.polname
      )::text,
      '[]'
    )
  )
  into v_definition
  from pg_catalog.pg_policy p
  where p.polrelid = 'public.matches'::pg_catalog.regclass;

  if v_definition is distinct from substring(
    v_object_comment from 'legacy_matches_policies_md5=([0-9a-f]{32})'
  ) then
    raise exception 'POSTCHECK_FAILED: matches policies differ from the definitions approved by migration 012';
  end if;

  select pg_catalog.md5(
    pg_catalog.jsonb_build_object(
      'relacl', coalesce(c.relacl::text, ''),
      'effective', (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'role', role_name,
            'privilege', privilege_name,
            'allowed', pg_catalog.has_table_privilege(
              role_name,
              'public.matches',
              privilege_name
            )
          )
          order by role_name, privilege_name
        )
        from (
          values ('anon'), ('authenticated'), ('service_role')
        ) as roles(role_name)
        cross join (
          values
            ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
            ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
        ) as privileges(privilege_name)
      )
    )::text
  )
  into v_definition
  from pg_catalog.pg_class c
  where c.oid = 'public.matches'::pg_catalog.regclass;

  if v_definition is distinct from substring(
    v_object_comment from 'legacy_matches_acl_md5=([0-9a-f]{32})'
  ) then
    raise exception 'POSTCHECK_FAILED: matches grants differ from the grants approved by migration 012';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.matches'::pg_catalog.regclass
      and a.attname = 'occupies_court'
      and a.attnum > 0
      and not a.attisdropped
  ) then
    raise exception 'POSTCHECK_FAILED: migration 012 must not add matches.occupies_court';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.matches'::pg_catalog.regclass
      and a.attname in ('isTraining', 'trainingDetails', 'trainingStatus')
      and a.attnum > 0
      and not a.attisdropped
  ) <> 3 then
    raise exception 'POSTCHECK_FAILED: one or more legacy training columns were removed';
  end if;
end;
$$;

with constraint_definitions as (
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'table', c.conrelid::pg_catalog.regclass::text,
      'name', c.conname,
      'type', c.contype,
      'definition', pg_catalog.pg_get_constraintdef(c.oid, false)
    )
    order by c.conrelid::pg_catalog.regclass::text, c.conname
  ) as value
  from pg_catalog.pg_constraint c
  where c.conrelid in (
    'public.training_requests'::pg_catalog.regclass,
    'public.training_status_history'::pg_catalog.regclass,
    'public.training_coach_assignments'::pg_catalog.regclass
  )
),
trigger_definitions as (
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'table', t.tgrelid::pg_catalog.regclass::text,
      'name', t.tgname,
      'definition', pg_catalog.pg_get_triggerdef(t.oid, false)
    )
    order by t.tgrelid::pg_catalog.regclass::text, t.tgname
  ) as value
  from pg_catalog.pg_trigger t
  where t.tgrelid in (
    'public.training_requests'::pg_catalog.regclass,
    'public.training_status_history'::pg_catalog.regclass,
    'public.training_coach_assignments'::pg_catalog.regclass
  )
    and not t.tgisinternal
),
function_definitions as (
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'name', p.oid::pg_catalog.regprocedure::text,
      'security', case when p.prosecdef then 'DEFINER' else 'INVOKER' end,
      'search_path', p.proconfig,
      'acl', p.proacl,
      'definition_hash', pg_catalog.md5(
        pg_catalog.replace(
          pg_catalog.replace(
            coalesce(pg_catalog.pg_get_functiondef(p.oid), ''),
            E'\r\n',
            E'\n'
          ),
          E'\r',
          E'\n'
        )
      ),
      'definition', pg_catalog.pg_get_functiondef(p.oid)
    )
    order by p.oid::pg_catalog.regprocedure::text
  ) as value
  from pg_catalog.pg_proc p
  where p.oid in (
    pg_catalog.to_regprocedure('public.training_request_validate_booking()')::oid,
    pg_catalog.to_regprocedure('public.training_request_prevent_delete()')::oid,
    pg_catalog.to_regprocedure('public.training_status_history_prevent_mutation()')::oid
  )
),
policy_definitions as (
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'table', p.polrelid::pg_catalog.regclass::text,
      'name', p.polname,
      'permissive', p.polpermissive,
      'command', p.polcmd,
      'roles', (
        select pg_catalog.jsonb_agg(
          pg_catalog.pg_get_userbyid(role_oid)
          order by pg_catalog.pg_get_userbyid(role_oid)
        )
        from pg_catalog.unnest(p.polroles) as policy_roles(role_oid)
      ),
      'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid, false),
      'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false)
    )
    order by p.polrelid::pg_catalog.regclass::text, p.polname
  ) as value
  from pg_catalog.pg_policy p
  where p.polrelid in (
    'public.training_requests'::pg_catalog.regclass,
    'public.training_status_history'::pg_catalog.regclass,
    'public.training_coach_assignments'::pg_catalog.regclass
  )
),
matches_snapshot as (
  select
    count(*)::bigint as row_count,
    pg_catalog.md5(
      coalesce(
        pg_catalog.string_agg(
          pg_catalog.md5(pg_catalog.to_jsonb(m)::text),
          '' order by m.id
        ),
        ''
      )
    ) as fingerprint
  from public.matches m
),
legacy_definitions as (
  select pg_catalog.jsonb_build_object(
    'approved_manifest', pg_catalog.obj_description(
      'public.training_requests'::pg_catalog.regclass,
      'pg_class'
    ),
    'create_booking_hash', (
      select pg_catalog.md5(
        pg_catalog.replace(
          pg_catalog.replace(
            coalesce(pg_catalog.pg_get_functiondef(p.oid), ''),
            E'\r\n',
            E'\n'
          ),
          E'\r',
          E'\n'
        )
      )
      from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
    ),
    'create_booking_definition', (
      select pg_catalog.pg_get_functiondef(p.oid)
      from pg_catalog.pg_proc p
      where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
    ),
    'overlap_constraint_hash', (
      select pg_catalog.md5(pg_catalog.pg_get_constraintdef(c.oid, false))
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.matches'::pg_catalog.regclass
        and c.conname = 'matches_no_active_court_overlap'
    ),
    'overlap_constraint_definition', (
      select pg_catalog.pg_get_constraintdef(c.oid, false)
      from pg_catalog.pg_constraint c
      where c.conrelid = 'public.matches'::pg_catalog.regclass
        and c.conname = 'matches_no_active_court_overlap'
    )
  ) as value
)
select pg_catalog.jsonb_build_object(
  'migration', '012_training_domain',
  'postcheck_ok', true,
  'constraints', (select value from constraint_definitions),
  'triggers', (select value from trigger_definitions),
  'functions', (select value from function_definitions),
  'policies', (select value from policy_definitions),
  'legacy_definitions', (select value from legacy_definitions),
  'matches_snapshot', (select pg_catalog.to_jsonb(matches_snapshot) from matches_snapshot),
  'diagnostics', pg_catalog.jsonb_build_object(
    'server_version', pg_catalog.current_setting('server_version'),
    'TimeZone', pg_catalog.current_setting('TimeZone'),
    'timezone_data_version', null,
    'timezone_data_version_note', 'PostgreSQL does not expose a standard standalone tzdata version setting.'
  ),
  'behavioural_tests_run', false,
  'note', 'Structural read-only POSTCHECK. Legacy definitions are automatically compared with migration 012 metadata; behavioural tests still require a disposable database.'
) as training_domain_postcheck;

rollback;
