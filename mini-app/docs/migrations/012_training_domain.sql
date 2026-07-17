-- 012_training_domain.sql
-- Non-operational PostgreSQL-first schema for individual training requests.
-- Apply manually only after 012_training_domain_PRECHECK.sql succeeds.
-- This migration does not call CRM/Telegram and does not alter matches rows,
-- create_booking, or the court-overlap exclusion constraint.

begin;
set transaction isolation level repeatable read;
set local search_path = pg_catalog, public, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '90s';

do $$
declare
  v_required_columns integer;
  v_create_booking_definition text;
  v_overlap_definition text;
begin
  if pg_catalog.to_regclass('public.matches') is null
     or pg_catalog.to_regclass('public.profiles') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: public.matches and public.profiles are required';
  end if;

  select count(*)
  into v_required_columns
  from pg_catalog.pg_attribute a
  where not a.attisdropped
    and a.attnum > 0
    and (
      (
        a.attrelid = 'public.profiles'::pg_catalog.regclass
        and a.attname = 'id'
        and a.atttypid = 'uuid'::pg_catalog.regtype
        and a.attnotnull
      )
      or (
        a.attrelid = 'public.matches'::pg_catalog.regclass
        and (
          (a.attname = 'id' and a.atttypid = 'uuid'::pg_catalog.regtype and a.attnotnull)
          or (a.attname = 'owner_id' and a.atttypid = 'uuid'::pg_catalog.regtype and a.attnotnull)
          or (a.attname = 'dateISO' and a.atttypid = 'date'::pg_catalog.regtype and not a.attnotnull)
          or (a.attname = 'time' and a.atttypid = 'text'::pg_catalog.regtype and not a.attnotnull)
          or (a.attname = 'courtId' and a.atttypid = 'text'::pg_catalog.regtype and not a.attnotnull)
          or (a.attname = 'duration' and a.atttypid = 'numeric'::pg_catalog.regtype and not a.attnotnull)
          or (a.attname = 'type' and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
          or (a.attname = 'scenario' and a.atttypid = 'text'::pg_catalog.regtype and not a.attnotnull)
          or (a.attname = 'isPrivate' and a.atttypid = 'boolean'::pg_catalog.regtype and a.attnotnull)
          or (a.attname = 'status' and a.atttypid = 'text'::pg_catalog.regtype and a.attnotnull)
        )
      )
    );

  if v_required_columns <> 11 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: profiles/matches differ from the audited 000-011 schema';
  end if;

  if pg_catalog.to_regprocedure('public.match_time_to_minutes(text)') is null
     or not exists (
       select 1
       from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.match_time_to_minutes(text)')::oid
         and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_time text'
         and p.prorettype = 'integer'::pg_catalog.regtype
         and not p.proretset
         and not p.prosecdef
         and p.provolatile = 'i'
         and p.proisstrict
         and p.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: public.match_time_to_minutes(text) is incompatible';
  end if;

  if pg_catalog.to_regprocedure('public.set_updated_at()') is null
     or not exists (
       select 1
       from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.set_updated_at()')::oid
         and p.prorettype = 'trigger'::pg_catalog.regtype
         and not p.prosecdef
     ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: public.set_updated_at() is missing or incompatible';
  end if;

  if pg_catalog.to_regprocedure('public.create_booking(jsonb)') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: public.create_booking(jsonb) is missing';
  end if;

  select pg_catalog.replace(
    pg_catalog.replace(
      coalesce(pg_catalog.pg_get_functiondef(p.oid), ''),
      E'\r\n',
      E'\n'
    ),
    E'\r',
    E'\n'
  )
  into v_create_booking_definition
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_booking jsonb'
    and p.prorettype = 'public.matches'::pg_catalog.regtype
    and not p.proretset
    and not p.prosecdef
    and p.provolatile = 'v'
    and p.prolang = (select l.oid from pg_catalog.pg_language l where l.lanname = 'plpgsql')
    and p.proconfig = array['search_path=pg_catalog, public, pg_temp']::text[];

  if v_create_booking_definition is null
     or pg_catalog.strpos(v_create_booking_definition, 'v_duration := nullif') = 0
     or pg_catalog.strpos(v_create_booking_definition, ')::numeric;') = 0
     or pg_catalog.strpos(v_create_booking_definition, 'v_type := ''private'';') = 0
     or pg_catalog.strpos(v_create_booking_definition, 'v_scenario := ''private'';') = 0
     or pg_catalog.strpos(v_create_booking_definition, 'v_status := ''upcoming'';') = 0
     or pg_catalog.strpos(v_create_booking_definition, 'at time zone ''Europe/Moscow''') = 0
     or pg_catalog.strpos(v_create_booking_definition, 'pg_catalog.pg_advisory_xact_lock') = 0
     or pg_catalog.strpos(v_create_booking_definition, 'insert into public.matches') = 0
     or coalesce(
       pg_catalog.obj_description(
         pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid,
         'pg_proc'
       ),
       ''
     ) not like 'migration=011_create_booking_price_snapshot;%'
  then
    raise exception 'MIGRATION_PRECONDITION_FAILED: create_booking differs from audited migration 011';
  end if;

  select pg_catalog.regexp_replace(
    pg_catalog.pg_get_constraintdef(c.oid, true),
    E'\\s+',
    ' ',
    'g'
  )
  into v_overlap_definition
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.matches'::pg_catalog.regclass
    and c.conname = 'matches_no_active_court_overlap'
    and c.contype = 'x';

  if v_overlap_definition is null
     or pg_catalog.strpos(v_overlap_definition, 'EXCLUDE USING gist') = 0
     or pg_catalog.strpos(v_overlap_definition, '"courtId" WITH =') = 0
     or pg_catalog.strpos(v_overlap_definition, '"dateISO" WITH =') = 0
     or pg_catalog.strpos(v_overlap_definition, 'match_time_to_minutes') = 0
     or pg_catalog.strpos(v_overlap_definition, 'duration') = 0
     or pg_catalog.strpos(v_overlap_definition, 'WITH &&') = 0
     or pg_catalog.strpos(v_overlap_definition, 'status IS DISTINCT FROM ''completed''') = 0
     or pg_catalog.strpos(v_overlap_definition, '"dateISO" IS NOT NULL') = 0
     or pg_catalog.strpos(v_overlap_definition, '"courtId" IS NOT NULL') = 0
     or (
       pg_catalog.strpos(v_overlap_definition, 'time IS NOT NULL') = 0
       and pg_catalog.strpos(v_overlap_definition, '"time" IS NOT NULL') = 0
     )
     or pg_catalog.strpos(v_overlap_definition, 'duration IS NOT NULL') = 0
     or not exists (
       select 1
       from pg_catalog.pg_constraint c
       join pg_catalog.pg_index i on i.indexrelid = c.conindid
       join pg_catalog.pg_class idx on idx.oid = i.indexrelid
       join pg_catalog.pg_am am on am.oid = idx.relam
       where c.conrelid = 'public.matches'::pg_catalog.regclass
         and c.conname = 'matches_no_active_court_overlap'
         and c.contype = 'x'
         and not c.condeferrable
         and not c.condeferred
         and c.convalidated
         and am.amname = 'gist'
         and i.indisvalid
         and i.indisready
         and i.indkey::text = pg_catalog.format(
           '%s %s 0',
           (select a.attnum from pg_catalog.pg_attribute a
            where a.attrelid = i.indrelid and a.attname = 'courtId'),
           (select a.attnum from pg_catalog.pg_attribute a
            where a.attrelid = i.indrelid and a.attname = 'dateISO')
         )
         and (
           select pg_catalog.array_agg(o.oprname::text order by operators.ordinality)
           from pg_catalog.unnest(c.conexclop) with ordinality
             as operators(operator_oid, ordinality)
           join pg_catalog.pg_operator o on o.oid = operators.operator_oid
         ) = array['=', '=', '&&']::text[]
         and (
           select pg_catalog.array_agg(opc.opcname::text order by classes.ordinality)
           from pg_catalog.unnest(i.indclass) with ordinality
             as classes(opclass_oid, ordinality)
           join pg_catalog.pg_opclass opc on opc.oid = classes.opclass_oid
         ) = array['gist_text_ops', 'gist_date_ops', 'range_ops']::text[]
         and pg_catalog.replace(
           pg_catalog.regexp_replace(
             pg_catalog.lower(pg_catalog.pg_get_expr(i.indpred, i.indrelid, false)),
             E'[\\s()"]+',
             '',
             'g'
           ),
           '::text',
           ''
         ) = 'statusisdistinctfrom''completed''anddateisoisnotnullandcourtidisnotnullandtimeisnotnullanddurationisnotnull'
     )
     or coalesce(
       (
         select pg_catalog.obj_description(c.oid, 'pg_constraint')
         from pg_catalog.pg_constraint c
         where c.conrelid = 'public.matches'::pg_catalog.regclass
           and c.conname = 'matches_no_active_court_overlap'
       ),
       ''
     ) not like 'migration=007_create_booking_atomic;%'
  then
    raise exception 'MIGRATION_PRECONDITION_FAILED: overlap constraint differs from audited migration 007';
  end if;

  if pg_catalog.to_regprocedure('auth.uid()') is null
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: Supabase access adapter is incomplete';
  end if;

  if not exists (
       select 1
       from pg_catalog.pg_class c
       where c.oid = 'public.matches'::pg_catalog.regclass
         and c.relrowsecurity
     )
     or (
       select count(*)
       from pg_catalog.pg_policy p
       where p.polrelid = 'public.matches'::pg_catalog.regclass
     ) <> 6
     or exists (
       select 1
       from pg_catalog.pg_policy p
       where p.polrelid = 'public.matches'::pg_catalog.regclass
         and p.polname not in (
           'matches_delete_owner_or_admin',
           'matches_insert_own',
           'matches_insert_owner',
           'matches_select_public_member_or_admin',
           'matches_update_owner_or_admin',
           'players_can_join_open_public_matches'
         )
     )
     or not pg_catalog.has_table_privilege('authenticated', 'public.matches', 'SELECT')
     or not pg_catalog.has_table_privilege('authenticated', 'public.matches', 'INSERT')
     or not pg_catalog.has_table_privilege('authenticated', 'public.matches', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.matches', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.matches', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.matches', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.matches', 'DELETE') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: matches RLS or grants differ from migrations 000-001';
  end if;

  if pg_catalog.to_regclass('public.training_requests') is not null
     or pg_catalog.to_regclass('public.training_status_history') is not null
     or pg_catalog.to_regclass('public.training_coach_assignments') is not null then
    raise exception 'MIGRATION_CONFLICT: one or more migration 012 tables already exist';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'training_request_validate_booking',
        'training_request_prevent_delete',
        'training_status_history_prevent_mutation'
      )
  ) then
    raise exception 'MIGRATION_CONFLICT: a migration 012 function name already exists';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'training_requests_one_active_per_booking_idx',
        'training_requests_customer_status_idx',
        'training_requests_court_booking_idx',
        'training_status_history_request_created_idx',
        'training_status_history_actor_idx',
        'training_coach_assignments_one_pending_idx',
        'training_coach_assignments_request_created_idx',
        'training_coach_assignments_assigned_by_idx'
      )
  ) then
    raise exception 'MIGRATION_CONFLICT: a migration 012 index name already exists';
  end if;
end;
$$;

-- Preserve exact pre-migration fingerprints inside this transaction.
do $$
declare
  v_count bigint;
  v_rows_fingerprint text;
  v_create_booking_fingerprint text;
  v_overlap_fingerprint text;
  v_matches_policies_fingerprint text;
  v_matches_acl_fingerprint text;
begin
  select
    count(*)::bigint,
    pg_catalog.md5(
      coalesce(
        pg_catalog.string_agg(
          pg_catalog.md5(pg_catalog.to_jsonb(m)::text),
          '' order by m.id
        ),
        ''
      )
    )
  into v_count, v_rows_fingerprint
  from public.matches m;

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
  into v_create_booking_fingerprint
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid;

  select pg_catalog.md5(pg_catalog.pg_get_constraintdef(c.oid, false))
  into v_overlap_fingerprint
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.matches'::pg_catalog.regclass
    and c.conname = 'matches_no_active_court_overlap';

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
  into v_matches_policies_fingerprint
  from pg_catalog.pg_policy p
  where p.polrelid = 'public.matches'::pg_catalog.regclass;

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
  into v_matches_acl_fingerprint
  from pg_catalog.pg_class c
  where c.oid = 'public.matches'::pg_catalog.regclass;

  perform pg_catalog.set_config('prosto_padel.migration_012_matches_count', v_count::text, true);
  perform pg_catalog.set_config('prosto_padel.migration_012_matches_rows_hash', v_rows_fingerprint, true);
  perform pg_catalog.set_config('prosto_padel.migration_012_create_booking_hash', v_create_booking_fingerprint, true);
  perform pg_catalog.set_config('prosto_padel.migration_012_overlap_hash', v_overlap_fingerprint, true);
  perform pg_catalog.set_config('prosto_padel.migration_012_matches_policies_hash', v_matches_policies_fingerprint, true);
  perform pg_catalog.set_config('prosto_padel.migration_012_matches_acl_hash', v_matches_acl_fingerprint, true);
end;
$$;

create function public.training_request_validate_booking()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_owner_id uuid;
  v_duration numeric;
  v_date date;
  v_time text;
  v_court_id text;
  v_type text;
  v_scenario text;
  v_is_private boolean;
  v_status text;
  v_scheduled_start_at timestamptz;
begin
  if tg_op = 'UPDATE' and (
    new.scheduled_start_at is distinct from old.scheduled_start_at
    or new.court_id_snapshot is distinct from old.court_id_snapshot
  ) then
    raise exception using
      errcode = '55000',
      message = 'TRAINING_BOOKING_SNAPSHOT_IMMUTABLE';
  end if;

  select
    m.owner_id,
    m.duration,
    m."dateISO",
    m.time,
    m."courtId",
    m.type,
    m.scenario,
    m."isPrivate",
    m.status
  into
    v_owner_id,
    v_duration,
    v_date,
    v_time,
    v_court_id,
    v_type,
    v_scenario,
    v_is_private,
    v_status
  from public.matches m
  where m.id = new.court_booking_id
  for update of m;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'TRAINING_COURT_BOOKING_NOT_FOUND';
  end if;

  if v_owner_id is distinct from new.customer_id then
    raise exception using
      errcode = '23514',
      message = 'TRAINING_CUSTOMER_BOOKING_OWNER_MISMATCH';
  end if;

  if v_type is distinct from 'private'
     or v_scenario is distinct from 'private'
     or v_is_private is distinct from true
     or v_status is distinct from 'upcoming' then
    raise exception using
      errcode = '23514',
      message = 'TRAINING_COURT_BOOKING_NOT_PRIVATE_UPCOMING';
  end if;

  if v_duration is null
     or v_duration * 60::numeric is distinct from new.duration_minutes::numeric then
    raise exception using
      errcode = '23514',
      message = 'TRAINING_DURATION_BOOKING_MISMATCH';
  end if;

  if v_date is null or v_time is null or v_court_id is null then
    raise exception using
      errcode = '23514',
      message = 'TRAINING_COURT_BOOKING_NOT_SCHEDULED';
  end if;

  v_scheduled_start_at := (
    v_date::timestamp
    + pg_catalog.make_interval(mins => public.match_time_to_minutes(v_time))
  ) at time zone 'Europe/Moscow';

  if new.scheduled_start_at is distinct from v_scheduled_start_at then
    raise exception using
      errcode = '23514',
      message = 'TRAINING_SCHEDULED_START_SNAPSHOT_MISMATCH';
  end if;

  if new.court_id_snapshot is distinct from v_court_id then
    raise exception using
      errcode = '23514',
      message = 'TRAINING_COURT_SNAPSHOT_MISMATCH';
  end if;

  if new.free_cancellation_until is distinct from
     new.scheduled_start_at - interval '24 hours' then
    raise exception using
      errcode = '23514',
      message = 'TRAINING_FREE_CANCELLATION_DEADLINE_MISMATCH';
  end if;

  return new;
end;
$$;

revoke all on function public.training_request_validate_booking()
from public, anon, authenticated, service_role;

comment on function public.training_request_validate_booking() is
  'migration=012_training_domain;rollback=drop; validates and locks one private upcoming matches booking and verifies immutable time/court snapshots';

create function public.training_request_prevent_delete()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'TRAINING_REQUEST_PHYSICAL_DELETE_FORBIDDEN';
end;
$$;

revoke all on function public.training_request_prevent_delete()
from public, anon, authenticated, service_role;

comment on function public.training_request_prevent_delete() is
  'migration=012_training_domain;rollback=drop; blocks ordinary physical deletion; cancellation or anonymization must be used';

create table public.training_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  client_request_id uuid not null,
  customer_id uuid not null,
  court_booking_id uuid not null,
  format text not null default 'individual',
  player_count smallint not null default 1,
  duration_minutes smallint not null,
  coach_selection text not null default 'club',
  status text not null default 'court_sync_pending',
  court_price_amount numeric(12,2) not null,
  coach_price_amount numeric(12,2),
  currency text not null default 'RUB',
  payment_status text not null default 'not_due',
  scheduled_start_at timestamp with time zone not null,
  court_id_snapshot text not null,
  free_cancellation_until timestamp with time zone not null,
  created_at timestamp with time zone not null default pg_catalog.now(),
  updated_at timestamp with time zone not null default pg_catalog.now(),

  constraint training_requests_customer_client_request_key
    unique (customer_id, client_request_id),
  constraint training_requests_customer_fkey
    foreign key (customer_id) references public.profiles(id) on delete restrict,
  constraint training_requests_court_booking_fkey
    foreign key (court_booking_id) references public.matches(id) on delete restrict,
  constraint training_requests_format_check
    check (format = 'individual'),
  constraint training_requests_player_count_check
    check (player_count = 1),
  constraint training_requests_duration_check
    check (duration_minutes = any (array[60, 90]::smallint[])),
  constraint training_requests_coach_selection_check
    check (coach_selection = 'club'),
  constraint training_requests_status_check
    check (status = any (array[
      'court_sync_pending',
      'court_sync_unknown',
      'awaiting_coach',
      'confirmed',
      'rejected',
      'cancel_pending',
      'cancelled',
      'completed'
    ]::text[])),
  constraint training_requests_court_price_check
    check (
      court_price_amount::text <> 'NaN'
      and court_price_amount >= 0
      and court_price_amount <= 1000000
    ),
  constraint training_requests_coach_price_check
    check (
      coach_price_amount is null
      or (
        coach_price_amount::text <> 'NaN'
        and coach_price_amount >= 0
        and coach_price_amount <= 1000000
      )
    ),
  constraint training_requests_confirmed_price_check
    check (
      status <> all (array['confirmed', 'completed']::text[])
      or coach_price_amount is not null
    ),
  constraint training_requests_currency_check
    check (currency = 'RUB'),
  constraint training_requests_payment_status_check
    check (payment_status = any (array[
      'not_due',
      'pending_offline',
      'paid_offline'
    ]::text[])),
  constraint training_requests_cancellation_deadline_check
    check (free_cancellation_until = scheduled_start_at - interval '24 hours'),
  constraint training_requests_timestamps_check
    check (updated_at >= created_at)
);

create trigger training_requests_validate_booking
before insert or update of
  customer_id,
  court_booking_id,
  duration_minutes,
  scheduled_start_at,
  court_id_snapshot,
  free_cancellation_until
on public.training_requests
for each row
execute function public.training_request_validate_booking();

create trigger training_requests_prevent_delete
before delete on public.training_requests
for each row
execute function public.training_request_prevent_delete();

create trigger set_training_requests_updated_at
before update on public.training_requests
for each row
execute function public.set_updated_at();

create unique index training_requests_one_active_per_booking_idx
  on public.training_requests (court_booking_id)
  where status = any (array[
    'court_sync_pending',
    'court_sync_unknown',
    'awaiting_coach',
    'confirmed',
    'cancel_pending'
  ]::text[]);

create index training_requests_customer_status_idx
  on public.training_requests (customer_id, status, created_at desc, id desc);

create index training_requests_court_booking_idx
  on public.training_requests (court_booking_id, created_at desc);

comment on table public.training_requests is
  'migration=012_training_domain;rollback=drop; non-operational individual training request linked to one private upcoming matches booking';

comment on column public.training_requests.client_request_id is
  'Stable client-generated UUID. Together with customer_id it is the future server idempotency lookup key.';

comment on column public.training_requests.court_booking_id is
  'Local court fixation in matches; RESTRICT preserves the training request if deletion of the booking is attempted.';

comment on column public.training_requests.scheduled_start_at is
  'Immutable absolute start snapshot calculated from matches dateISO/time in Europe/Moscow.';

comment on column public.training_requests.court_id_snapshot is
  'Immutable text snapshot of matches.courtId; type intentionally matches the audited source column.';

comment on column public.training_requests.free_cancellation_until is
  'Absolute deadline constrained to scheduled_start_at minus exactly 24 hours.';

create table public.training_status_history (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  training_request_id uuid not null,
  from_status text,
  to_status text not null,
  event_type text not null,
  actor_type text not null default 'system',
  actor_id uuid,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default pg_catalog.now(),

  constraint training_status_history_request_fkey
    foreign key (training_request_id)
    references public.training_requests(id)
    on delete cascade,
  constraint training_status_history_actor_fkey
    foreign key (actor_id) references public.profiles(id) on delete restrict,
  constraint training_status_history_from_status_check
    check (
      from_status is null
      or from_status = any (array[
        'court_sync_pending',
        'court_sync_unknown',
        'awaiting_coach',
        'confirmed',
        'rejected',
        'cancel_pending',
        'cancelled',
        'completed'
      ]::text[])
    ),
  constraint training_status_history_to_status_check
    check (to_status = any (array[
      'court_sync_pending',
      'court_sync_unknown',
      'awaiting_coach',
      'confirmed',
      'rejected',
      'cancel_pending',
      'cancelled',
      'completed'
    ]::text[])),
  constraint training_status_history_transition_check
    check (from_status is null or from_status <> to_status),
  constraint training_status_history_event_type_check
    check (pg_catalog.btrim(event_type) <> ''),
  constraint training_status_history_actor_type_check
    check (actor_type = any (array['system', 'customer', 'admin']::text[])),
  constraint training_status_history_metadata_check
    check (pg_catalog.jsonb_typeof(metadata) = 'object')
);

create function public.training_status_history_prevent_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'TRAINING_STATUS_HISTORY_APPEND_ONLY';
end;
$$;

revoke all on function public.training_status_history_prevent_mutation()
from public, anon, authenticated, service_role;

comment on function public.training_status_history_prevent_mutation() is
  'migration=012_training_domain;rollback=drop; blocks UPDATE and DELETE so status history remains append-only';

create trigger training_status_history_append_only
before update or delete on public.training_status_history
for each row
execute function public.training_status_history_prevent_mutation();

create index training_status_history_request_created_idx
  on public.training_status_history (training_request_id, created_at, id);

create index training_status_history_actor_idx
  on public.training_status_history (actor_id, created_at desc)
  where actor_id is not null;

comment on table public.training_status_history is
  'migration=012_training_domain;rollback=drop; immutable journal reserved for atomic server operations in migration 013';

create table public.training_coach_assignments (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  training_request_id uuid not null,
  coach_id uuid,
  status text not null default 'selection_pending',
  assigned_by uuid,
  assigned_at timestamp with time zone,
  responded_at timestamp with time zone,
  created_at timestamp with time zone not null default pg_catalog.now(),
  updated_at timestamp with time zone not null default pg_catalog.now(),

  constraint training_coach_assignments_request_fkey
    foreign key (training_request_id)
    references public.training_requests(id)
    on delete cascade,
  constraint training_coach_assignments_assigned_by_fkey
    foreign key (assigned_by) references public.profiles(id) on delete restrict,
  constraint training_coach_assignments_status_check
    check (status = 'selection_pending'),
  constraint training_coach_assignments_pending_only_check
    check (
      coach_id is null
      and assigned_by is null
      and assigned_at is null
      and responded_at is null
    ),
  constraint training_coach_assignments_timestamps_check
    check (updated_at >= created_at)
);

create trigger set_training_coach_assignments_updated_at
before update on public.training_coach_assignments
for each row
execute function public.set_updated_at();

create unique index training_coach_assignments_one_pending_idx
  on public.training_coach_assignments (training_request_id);

create index training_coach_assignments_request_created_idx
  on public.training_coach_assignments (training_request_id, created_at, id);

create index training_coach_assignments_assigned_by_idx
  on public.training_coach_assignments (assigned_by)
  where assigned_by is not null;

comment on table public.training_coach_assignments is
  'migration=012_training_domain;rollback=drop; pending-only coach selection placeholder until a real coach registry exists';

comment on column public.training_coach_assignments.coach_id is
  'Must remain NULL in migration 012; a future migration will add the approved coach entity and foreign key.';

comment on column public.training_coach_assignments.assigned_by is
  'Must remain NULL in migration 012; future server operations will verify administrator authority.';

-- Supabase adapter boundary. Core tables and validation above do not use
-- auth.uid(); only read policies depend on the current Supabase identity.
alter table public.training_requests enable row level security;
alter table public.training_status_history enable row level security;
alter table public.training_coach_assignments enable row level security;

create policy training_requests_select_own
on public.training_requests
for select
to authenticated
using (
  (select auth.uid()) is not null
  and customer_id = (select auth.uid())
);

create policy training_status_history_select_own
on public.training_status_history
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.training_requests r
    where r.id = training_status_history.training_request_id
      and r.customer_id = (select auth.uid())
  )
);

create policy training_coach_assignments_select_own
on public.training_coach_assignments
for select
to authenticated
using (
  (select auth.uid()) is not null
  and exists (
    select 1
    from public.training_requests r
    where r.id = training_coach_assignments.training_request_id
      and r.customer_id = (select auth.uid())
  )
);

revoke all on table public.training_requests
from public, anon, authenticated, service_role;
revoke all on table public.training_status_history
from public, anon, authenticated, service_role;
revoke all on table public.training_coach_assignments
from public, anon, authenticated, service_role;

revoke insert, update, delete, truncate, references, trigger
on table public.training_requests, public.training_status_history,
  public.training_coach_assignments
from public, anon, authenticated, service_role;

grant select on table public.training_requests to authenticated;
grant select on table public.training_status_history to authenticated;
grant select on table public.training_coach_assignments to authenticated;

-- Prove inside the same transaction that 012 did not modify the legacy rows or
-- the two audited booking objects.
do $$
declare
  v_count bigint;
  v_rows_fingerprint text;
  v_create_booking_fingerprint text;
  v_overlap_fingerprint text;
  v_matches_policies_fingerprint text;
  v_matches_acl_fingerprint text;
begin
  select
    count(*)::bigint,
    pg_catalog.md5(
      coalesce(
        pg_catalog.string_agg(
          pg_catalog.md5(pg_catalog.to_jsonb(m)::text),
          '' order by m.id
        ),
        ''
      )
    )
  into v_count, v_rows_fingerprint
  from public.matches m;

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
  into v_create_booking_fingerprint
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid;

  select pg_catalog.md5(pg_catalog.pg_get_constraintdef(c.oid, false))
  into v_overlap_fingerprint
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.matches'::pg_catalog.regclass
    and c.conname = 'matches_no_active_court_overlap';

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
  into v_matches_policies_fingerprint
  from pg_catalog.pg_policy p
  where p.polrelid = 'public.matches'::pg_catalog.regclass;

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
  into v_matches_acl_fingerprint
  from pg_catalog.pg_class c
  where c.oid = 'public.matches'::pg_catalog.regclass;

  if v_count::text is distinct from pg_catalog.current_setting(
       'prosto_padel.migration_012_matches_count', true
     )
     or v_rows_fingerprint is distinct from pg_catalog.current_setting(
       'prosto_padel.migration_012_matches_rows_hash', true
     )
     or v_create_booking_fingerprint is distinct from pg_catalog.current_setting(
       'prosto_padel.migration_012_create_booking_hash', true
     )
     or v_overlap_fingerprint is distinct from pg_catalog.current_setting(
       'prosto_padel.migration_012_overlap_hash', true
     )
     or v_matches_policies_fingerprint is distinct from pg_catalog.current_setting(
       'prosto_padel.migration_012_matches_policies_hash', true
     )
     or v_matches_acl_fingerprint is distinct from pg_catalog.current_setting(
       'prosto_padel.migration_012_matches_acl_hash', true
     ) then
    raise exception 'MIGRATION_ABORTED: legacy booking data or definitions changed during migration 012';
  end if;
end;
$$;

-- Persist a deterministic manifest in comments on the new objects. POSTCHECK
-- and ROLLBACK recompute the same catalog projection, so a later migration that
-- adds or changes a column, default, constraint, index, policy, trigger, ACL,
-- owner or RLS flag must be removed before 012 can be rolled back.
do $$
declare
  v_relation_name text;
  v_relation regclass;
  v_schema_fingerprint text;
  v_comment text;
  v_function_signature text;
  v_function regprocedure;
  v_function_fingerprint text;
  v_function_owner oid;
begin
  foreach v_relation_name in array array[
    'public.training_requests',
    'public.training_status_history',
    'public.training_coach_assignments'
  ]::text[] loop
    v_relation := pg_catalog.to_regclass(v_relation_name);

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

    v_comment := pg_catalog.format(
      'migration=012_training_domain;rollback=drop;schema_md5=%s',
      v_schema_fingerprint
    );

    if v_relation_name = 'public.training_requests' then
      v_comment := v_comment || pg_catalog.format(
        ';legacy_create_booking_md5=%s;legacy_overlap_md5=%s;legacy_matches_policies_md5=%s;legacy_matches_acl_md5=%s',
        pg_catalog.current_setting('prosto_padel.migration_012_create_booking_hash', true),
        pg_catalog.current_setting('prosto_padel.migration_012_overlap_hash', true),
        pg_catalog.current_setting('prosto_padel.migration_012_matches_policies_hash', true),
        pg_catalog.current_setting('prosto_padel.migration_012_matches_acl_hash', true)
      );
    end if;

    execute pg_catalog.format('comment on table %s is %L', v_relation, v_comment);
  end loop;

  foreach v_function_signature in array array[
    'public.training_request_validate_booking()',
    'public.training_request_prevent_delete()',
    'public.training_status_history_prevent_mutation()'
  ]::text[] loop
    v_function := pg_catalog.to_regprocedure(v_function_signature);

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

    execute pg_catalog.format(
      'comment on function %s is %L',
      v_function,
      pg_catalog.format(
        'migration=012_training_domain;rollback=drop;definition_md5=%s;owner_oid=%s',
        v_function_fingerprint,
        v_function_owner
      )
    );
  end loop;
end;
$$;

commit;

select pg_catalog.jsonb_build_object(
  'migration', '012_training_domain',
  'status', 'MIGRATION_012_COMPLETE_NON_OPERATIONAL',
  'tables', pg_catalog.jsonb_build_array(
    'public.training_requests',
    'public.training_status_history',
    'public.training_coach_assignments'
  ),
  'direct_write_grants', false,
  'matches_modified', false,
  'next_step', 'Run 012_training_domain_POSTCHECK.sql; do not create requests before migration 013.'
) as training_domain_migration_result;
