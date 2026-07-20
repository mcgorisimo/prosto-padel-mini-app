-- 014_training_operations_PRECHECK.sql
-- Read-only structural audit for the proposed training operations layer.
-- This file intentionally reports a blocking price-source condition on schema 011/012.

begin;
set transaction read only;
set local search_path = pg_catalog, public, pg_temp;

select pg_catalog.jsonb_build_object(
  'check', 'environment',
  'server_version', pg_catalog.current_setting('server_version'),
  'timezone', pg_catalog.current_setting('TimeZone'),
  'database', pg_catalog.current_database(),
  'current_user', current_user
) as training_014_precheck_environment;

do $$
declare
  v_role text;
  v_table text;
  v_definition text;
  v_comment text;
  v_missing text[];
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role']::text[] loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = v_role) then
      raise exception 'PRECHECK_FAILED: required API role % is missing', v_role;
    end if;
  end loop;

  if pg_catalog.to_regprocedure('auth.uid()') is null
     or not pg_catalog.has_function_privilege(current_user, 'auth.uid()', 'EXECUTE') then
    raise exception 'PRECHECK_FAILED: migration owner cannot execute auth.uid() boundary';
  end if;

  if pg_catalog.to_regclass('public.matches') is null
     or pg_catalog.to_regclass('public.profiles') is null then
    raise exception 'PRECHECK_FAILED: matches and profiles must exist';
  end if;

  if pg_catalog.to_regclass('public.training_requests') is null
     or pg_catalog.to_regclass('public.training_status_history') is null
     or pg_catalog.to_regclass('public.training_coach_assignments') is null then
    raise exception 'PRECHECK_FAILED: migration 012 tables are incomplete';
  end if;

  foreach v_table in array array[
    'public.training_requests',
    'public.training_status_history',
    'public.training_coach_assignments'
  ]::text[] loop
    if pg_catalog.obj_description(v_table::pg_catalog.regclass, 'pg_class')
       not like 'migration=012_training_domain;%' then
      raise exception 'PRECHECK_FAILED: % is not an audited migration 012 table', v_table;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_class c
      where c.oid = v_table::pg_catalog.regclass
        and c.relrowsecurity
        and not c.relforcerowsecurity
    ) then
      raise exception 'PRECHECK_FAILED: % RLS flags differ from migration 012', v_table;
    end if;

    foreach v_role in array array['anon', 'authenticated', 'service_role']::text[] loop
      if pg_catalog.has_table_privilege(v_role, v_table, 'INSERT')
         or pg_catalog.has_table_privilege(v_role, v_table, 'UPDATE')
         or pg_catalog.has_table_privilege(v_role, v_table, 'DELETE')
         or pg_catalog.has_table_privilege(v_role, v_table, 'TRUNCATE')
         or pg_catalog.has_table_privilege(v_role, v_table, 'REFERENCES')
         or pg_catalog.has_table_privilege(v_role, v_table, 'TRIGGER') then
        raise exception 'PRECHECK_FAILED: role % has effective direct write access to %',
          v_role, v_table;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from pg_catalog.aclexplode(coalesce(
      (select c.relacl from pg_catalog.pg_class c
       where c.oid = 'public.training_requests'::pg_catalog.regclass),
      pg_catalog.acldefault('r',
        (select c.relowner from pg_catalog.pg_class c
         where c.oid = 'public.training_requests'::pg_catalog.regclass))
    )) acl
    where acl.grantee = 0
      and acl.privilege_type = any (array[
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      ]::text[])
  ) then
    raise exception 'PRECHECK_FAILED: PUBLIC can write training_requests';
  end if;

  select array_agg(x.name order by x.name)
  into v_missing
  from (
    values
      ('id', 'uuid', true),
      ('client_request_id', 'uuid', true),
      ('customer_id', 'uuid', true),
      ('court_booking_id', 'uuid', true),
      ('format', 'text', true),
      ('player_count', 'smallint', true),
      ('duration_minutes', 'smallint', true),
      ('coach_selection', 'text', true),
      ('status', 'text', true),
      ('court_price_amount', 'numeric(12,2)', true),
      ('coach_price_amount', 'numeric(12,2)', false),
      ('currency', 'text', true),
      ('payment_status', 'text', true),
      ('scheduled_start_at', 'timestamp with time zone', true),
      ('court_id_snapshot', 'text', true),
      ('free_cancellation_until', 'timestamp with time zone', true),
      ('created_at', 'timestamp with time zone', true),
      ('updated_at', 'timestamp with time zone', true)
  ) as x(name, data_type, is_not_null)
  where not exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.training_requests'::pg_catalog.regclass
      and a.attname = x.name
      and pg_catalog.format_type(a.atttypid, a.atttypmod) = x.data_type
      and a.attnotnull = x.is_not_null
      and a.attnum > 0
      and not a.attisdropped
  );

  if v_missing is not null then
    raise exception 'PRECHECK_FAILED: incompatible training_requests columns: %', v_missing;
  end if;

  if (select count(*) from pg_catalog.pg_attribute a
      where a.attrelid = 'public.training_requests'::pg_catalog.regclass
        and a.attnum > 0 and not a.attisdropped) <> 18 then
    raise exception 'PRECHECK_FAILED: training_requests has unexpected columns; roll back later migrations first';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.training_requests'::pg_catalog.regclass
      and c.conname = 'training_requests_customer_client_request_key'
      and c.contype = 'u'
      and c.conkey = array[
        (select a.attnum from pg_catalog.pg_attribute a
         where a.attrelid = c.conrelid and a.attname = 'customer_id'),
        (select a.attnum from pg_catalog.pg_attribute a
         where a.attrelid = c.conrelid and a.attname = 'client_request_id')
      ]::smallint[]
  ) then
    raise exception 'PRECHECK_FAILED: customer/client idempotency constraint differs from 012';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.training_requests'::pg_catalog.regclass
      and c.conname = 'training_requests_duration_check'
      and pg_catalog.regexp_replace(
        pg_catalog.lower(pg_catalog.pg_get_constraintdef(c.oid, true)), '\s+', '', 'g'
      ) = 'check((duration_minutes=any(array[60,90]::smallint[])))'
  ) then
    raise exception 'PRECHECK_FAILED: duration set must be exactly 60/90';
  end if;

  if pg_catalog.to_regprocedure('public.training_request_validate_booking()') is null
     or pg_catalog.to_regprocedure('public.training_request_prevent_delete()') is null
     or pg_catalog.to_regprocedure('public.training_status_history_prevent_mutation()') is null then
    raise exception 'PRECHECK_FAILED: migration 012 protection functions are incomplete';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.training_request_validate_booking()'::pg_catalog.regprocedure
  )) into v_definition;

  if pg_catalog.strpos(v_definition, 'for update') = 0
     or pg_catalog.strpos(v_definition, 'v_type is distinct from ''private''') = 0
     or pg_catalog.strpos(v_definition, 'v_scenario is distinct from ''private''') = 0
     or pg_catalog.strpos(v_definition, 'v_is_private is distinct from true') = 0
     or pg_catalog.strpos(v_definition, 'v_booking_status is distinct from ''upcoming''') = 0
     or pg_catalog.strpos(v_definition, 'at time zone ''europe/moscow''') = 0 then
    raise exception 'PRECHECK_FAILED: migration 012 booking validation is incompatible';
  end if;

  if pg_catalog.to_regprocedure('public.create_booking(jsonb)') is null then
    raise exception 'PRECHECK_FAILED: public.create_booking(jsonb) is missing';
  end if;

  select pg_catalog.pg_get_functiondef(p.oid),
         pg_catalog.obj_description(p.oid, 'pg_proc')
  into v_definition, v_comment
  from pg_catalog.pg_proc p
  where p.oid = 'public.create_booking(jsonb)'::pg_catalog.regprocedure
    and p.prorettype = 'public.matches'::pg_catalog.regtype
    and p.provolatile = 'v'
    and not p.prosecdef
    and p.proconfig = array['search_path=pg_catalog, public, pg_temp']::text[];

  if v_definition is null
     or v_comment not like 'migration=011_create_booking_price_snapshot;%'
     or pg_catalog.strpos(pg_catalog.lower(v_definition), 'pg_catalog.pg_advisory_xact_lock') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_definition), 'insert into public.matches') = 0
     or pg_catalog.strpos(pg_catalog.lower(v_definition), 'booking_slot_taken') = 0 then
    raise exception 'PRECHECK_FAILED: create_booking contract differs from audited migration 011';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'training_current_customer_id',
        'training_request_transition_allowed',
        'create_individual_training_request',
        'transition_individual_training_request'
      ]::text[])
  ) then
    raise exception 'PRECHECK_FAILED: one or more migration 014 functions already exist';
  end if;
end;
$$;

-- Recompute the exact migration 012 manifests. A retained marker comment alone
-- is not sufficient: any later column, constraint, index, policy, trigger, ACL,
-- owner, or RLS change makes this precheck fail.
do $$
declare
  v_relation_name text;
  v_relation pg_catalog.regclass;
  v_comment text;
  v_stored text;
  v_actual text;
begin
  foreach v_relation_name in array array[
    'public.training_requests',
    'public.training_status_history',
    'public.training_coach_assignments'
  ]::text[] loop
    v_relation := v_relation_name::pg_catalog.regclass;
    v_comment := coalesce(pg_catalog.obj_description(v_relation, 'pg_class'), '');
    v_stored := substring(v_comment from 'schema_md5=([0-9a-f]{32})');

    select pg_catalog.md5(pg_catalog.jsonb_build_object(
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
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'number', a.attnum,
          'name', a.attname,
          'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull,
          'identity', a.attidentity,
          'generated', a.attgenerated,
          'collation', a.attcollation,
          'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid, false)
        ) order by a.attnum)
        from pg_catalog.pg_attribute a
        left join pg_catalog.pg_attrdef d
          on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
      ), '[]'::jsonb),
      'constraints', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'name', c.conname,
          'type', c.contype,
          'deferrable', c.condeferrable,
          'deferred', c.condeferred,
          'validated', c.convalidated,
          'keys', c.conkey::text,
          'referenced_table', case when c.confrelid = 0 then null
            else c.confrelid::pg_catalog.regclass::text end,
          'referenced_keys', c.confkey::text,
          'on_update', c.confupdtype,
          'on_delete', c.confdeltype,
          'match_type', c.confmatchtype,
          'definition', pg_catalog.pg_get_constraintdef(c.oid, false)
        ) order by c.conname)
        from pg_catalog.pg_constraint c where c.conrelid = rel.oid
      ), '[]'::jsonb),
      'indexes', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
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
        ) order by idx.relname)
        from pg_catalog.pg_index i
        join pg_catalog.pg_class idx on idx.oid = i.indexrelid
        where i.indrelid = rel.oid
      ), '[]'::jsonb),
      'policies', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'name', p.polname,
          'permissive', p.polpermissive,
          'command', p.polcmd,
          'roles', (
            select pg_catalog.jsonb_agg(pg_catalog.pg_get_userbyid(role_oid)
              order by pg_catalog.pg_get_userbyid(role_oid))
            from pg_catalog.unnest(p.polroles) roles(role_oid)
          ),
          'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid, false),
          'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false)
        ) order by p.polname)
        from pg_catalog.pg_policy p where p.polrelid = rel.oid
      ), '[]'::jsonb),
      'triggers', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'name', t.tgname,
          'enabled', t.tgenabled,
          'type', t.tgtype,
          'columns', t.tgattr::text,
          'function', t.tgfoid::pg_catalog.regprocedure::text,
          'definition', pg_catalog.pg_get_triggerdef(t.oid, false)
        ) order by t.tgname)
        from pg_catalog.pg_trigger t
        where t.tgrelid = rel.oid and not t.tgisinternal
      ), '[]'::jsonb)
    )::text)
    into v_actual
    from pg_catalog.pg_class rel
    where rel.oid = v_relation;

    if v_stored is null or v_actual is distinct from v_stored then
      raise exception 'PRECHECK_FAILED: migration 012 relation % has changed', v_relation_name;
    end if;
  end loop;
end;
$$;

select pg_catalog.jsonb_build_object(
  'check', 'trusted_court_price_source',
  'status', case
    when pg_catalog.obj_description(
      'public.create_booking(jsonb)'::pg_catalog.regprocedure, 'pg_proc'
    ) like '%trusted_court_price_source=true;%'
    and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.create_booking(jsonb)'::pg_catalog.regprocedure
    )), 'p_booking->>''priceperperson''') = 0
    and pg_catalog.strpos(pg_catalog.lower(pg_catalog.pg_get_functiondef(
      'public.create_booking(jsonb)'::pg_catalog.regprocedure
    )), 'p_booking->>''price_per_person''') = 0
    then 'READY'
    else 'BLOCKED'
  end,
  'reason', 'Migration 011 copies pricePerPerson from client JSON. Migration 014 must not trust it.',
  'required_action', 'Approve and implement a separate trusted server tariff source, then re-audit this project.'
) as training_014_price_source_check;

rollback;
