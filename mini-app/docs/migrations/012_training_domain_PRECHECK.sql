-- 012_training_domain_PRECHECK.sql
-- Read-only compatibility, security and conflict checks for migration 012.
-- Run manually before 012_training_domain.sql and keep the complete JSON result.

begin;
set transaction read only;
set local search_path = pg_catalog, public, pg_temp;
set local statement_timeout = '30s';
set local lock_timeout = '5s';

do $$
declare
  v_required_columns integer;
  v_create_booking_definition text;
  v_overlap_definition text;
  v_authenticated_oid oid;
begin
  if pg_catalog.to_regclass('public.matches') is null then
    raise exception 'PRECHECK_FAILED: public.matches does not exist';
  end if;

  if pg_catalog.to_regclass('public.profiles') is null then
    raise exception 'PRECHECK_FAILED: public.profiles does not exist';
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
    raise exception 'PRECHECK_FAILED: profiles/matches columns, nullability or types differ from audited migrations 000-011';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.profiles'::pg_catalog.regclass
      and c.contype = 'p'
      and c.conkey = array[
        (
          select a.attnum
          from pg_catalog.pg_attribute a
          where a.attrelid = c.conrelid
            and a.attname = 'id'
            and not a.attisdropped
        )
      ]::smallint[]
  ) then
    raise exception 'PRECHECK_FAILED: profiles.id is not the expected primary key';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.matches'::pg_catalog.regclass
      and c.contype = 'p'
      and c.conkey = array[
        (
          select a.attnum
          from pg_catalog.pg_attribute a
          where a.attrelid = c.conrelid
            and a.attname = 'id'
            and not a.attisdropped
        )
      ]::smallint[]
  ) then
    raise exception 'PRECHECK_FAILED: matches.id is not the expected primary key';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.matches'::pg_catalog.regclass
      and c.confrelid = 'public.profiles'::pg_catalog.regclass
      and c.contype = 'f'
      and c.conkey = array[
        (
          select a.attnum
          from pg_catalog.pg_attribute a
          where a.attrelid = c.conrelid
            and a.attname = 'owner_id'
            and not a.attisdropped
        )
      ]::smallint[]
      and c.confkey = array[
        (
          select a.attnum
          from pg_catalog.pg_attribute a
          where a.attrelid = c.confrelid
            and a.attname = 'id'
            and not a.attisdropped
        )
      ]::smallint[]
  ) then
    raise exception 'PRECHECK_FAILED: matches.owner_id is not linked to profiles.id';
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
         and p.proparallel = 's'
         and p.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
         and coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), '')
           like 'migration=007_create_booking_atomic;%'
     ) then
    raise exception 'PRECHECK_FAILED: match_time_to_minutes differs from audited migration 007';
  end if;

  if pg_catalog.to_regprocedure('public.set_updated_at()') is null
     or not exists (
       select 1
       from pg_catalog.pg_proc p
       where p.oid = pg_catalog.to_regprocedure('public.set_updated_at()')::oid
         and p.prorettype = 'trigger'::pg_catalog.regtype
         and not p.proretset
         and not p.prosecdef
     ) then
    raise exception 'PRECHECK_FAILED: public.set_updated_at() is missing or incompatible';
  end if;

  if pg_catalog.to_regprocedure('public.create_booking(jsonb)') is null then
    raise exception 'PRECHECK_FAILED: public.create_booking(jsonb) is missing';
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
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = 'p_booking jsonb'
    and p.prorettype = 'public.matches'::pg_catalog.regtype
    and not p.proretset
    and not p.prosecdef
    and p.provolatile = 'v'
    and l.lanname = 'plpgsql'
    and p.proconfig = array['search_path=pg_catalog, public, pg_temp']::text[];

  if v_create_booking_definition is null
     or pg_catalog.strpos(v_create_booking_definition, 'v_user_id uuid := auth.uid()') = 0
     or pg_catalog.strpos(v_create_booking_definition, 'v_duration := nullif') = 0
     or pg_catalog.strpos(v_create_booking_definition, ')::numeric;') = 0
     or pg_catalog.strpos(v_create_booking_definition, 'v_duration not in (1, 1.5, 2, 2.5)') = 0
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
    raise exception 'PRECHECK_FAILED: create_booking differs from audited migration 011';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated',
       'public.create_booking(jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.create_booking(jsonb)',
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_catalog.pg_proc p
       cross join lateral pg_catalog.aclexplode(
         coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
       ) acl
       where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'PRECHECK_FAILED: create_booking EXECUTE ACL differs from migration 011';
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
    and c.contype = 'x'
    and not c.condeferrable
    and not c.condeferred;

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
    raise exception 'PRECHECK_FAILED: exclusion constraint differs from audited migration 007';
  end if;

  if pg_catalog.to_regprocedure('auth.uid()') is null then
    raise exception 'PRECHECK_FAILED: Supabase auth.uid() adapter is missing';
  end if;

  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    raise exception 'PRECHECK_FAILED: expected Supabase API roles are missing';
  end if;

  select oid into v_authenticated_oid
  from pg_catalog.pg_roles
  where rolname = 'authenticated';

  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = 'public.matches'::pg_catalog.regclass
      and c.relrowsecurity
  ) then
    raise exception 'PRECHECK_FAILED: RLS is not enabled on public.matches';
  end if;

  if (
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
     ) then
    raise exception 'PRECHECK_FAILED: exact matches policy set differs from migrations 000-001';
  end if;

  if not exists (
       select 1 from pg_catalog.pg_policy p
       where p.polrelid = 'public.matches'::pg_catalog.regclass
         and p.polname = 'matches_select_public_member_or_admin'
         and p.polcmd = 'r'
         and p.polroles = array[v_authenticated_oid]::oid[]
         and pg_catalog.strpos(
           pg_catalog.pg_get_expr(p.polqual, p.polrelid, true),
           '"isPrivate"'
         ) > 0
         and pg_catalog.strpos(
           pg_catalog.pg_get_expr(p.polqual, p.polrelid, true),
           'owner_id'
         ) > 0
     )
     or not exists (
       select 1 from pg_catalog.pg_policy p
       where p.polrelid = 'public.matches'::pg_catalog.regclass
         and p.polname = 'matches_insert_owner'
         and p.polcmd = 'a'
         and p.polroles = array[v_authenticated_oid]::oid[]
         and pg_catalog.strpos(
           pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, true),
           'owner_id'
         ) > 0
     )
     or not exists (
       select 1 from pg_catalog.pg_policy p
       where p.polrelid = 'public.matches'::pg_catalog.regclass
         and p.polname = 'matches_update_owner_or_admin'
         and p.polcmd = 'w'
         and p.polroles = array[v_authenticated_oid]::oid[]
         and p.polqual is not null
         and p.polwithcheck is not null
     )
     or not exists (
       select 1 from pg_catalog.pg_policy p
       where p.polrelid = 'public.matches'::pg_catalog.regclass
         and p.polname = 'matches_delete_owner_or_admin'
         and p.polcmd = 'd'
         and p.polroles = array[v_authenticated_oid]::oid[]
         and pg_catalog.strpos(
           pg_catalog.pg_get_expr(p.polqual, p.polrelid, true),
           'owner_id'
         ) > 0
     ) then
    raise exception 'PRECHECK_FAILED: matches RLS policies differ from migration 001';
  end if;

  if not pg_catalog.has_table_privilege('authenticated', 'public.matches', 'SELECT')
     or not pg_catalog.has_table_privilege('authenticated', 'public.matches', 'INSERT')
     or not pg_catalog.has_table_privilege('authenticated', 'public.matches', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.matches', 'SELECT')
     or pg_catalog.has_table_privilege('anon', 'public.matches', 'INSERT')
     or pg_catalog.has_table_privilege('anon', 'public.matches', 'UPDATE')
     or pg_catalog.has_table_privilege('anon', 'public.matches', 'DELETE') then
    raise exception 'PRECHECK_FAILED: matches table grants differ from migration 001';
  end if;

  if pg_catalog.to_regprocedure('pg_catalog.gen_random_uuid()') is null then
    raise exception 'PRECHECK_FAILED: pg_catalog.gen_random_uuid() is missing';
  end if;

  if not pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE') then
    raise exception 'PRECHECK_FAILED: current user cannot create objects in public';
  end if;

  if not pg_catalog.has_table_privilege(current_user, 'public.matches', 'REFERENCES')
     or not pg_catalog.has_table_privilege(current_user, 'public.profiles', 'REFERENCES') then
    raise exception 'PRECHECK_FAILED: current user cannot create the required foreign keys';
  end if;

  if pg_catalog.to_regclass('public.training_requests') is not null
     or pg_catalog.to_regclass('public.training_status_history') is not null
     or pg_catalog.to_regclass('public.training_coach_assignments') is not null then
    raise exception 'PRECHECK_CONFLICT: one or more migration 012 tables already exist';
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
    raise exception 'PRECHECK_CONFLICT: a migration 012 function name already exists';
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
    raise exception 'PRECHECK_CONFLICT: a migration 012 index name already exists';
  end if;
end;
$$;

with required_columns(table_name, column_name) as (
  values
    ('profiles', 'id'),
    ('matches', 'id'),
    ('matches', 'owner_id'),
    ('matches', 'dateISO'),
    ('matches', 'time'),
    ('matches', 'courtId'),
    ('matches', 'duration'),
    ('matches', 'type'),
    ('matches', 'scenario'),
    ('matches', 'isPrivate'),
    ('matches', 'status')
),
detected_columns as (
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'table', n.nspname || '.' || c.relname,
      'column', a.attname,
      'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
      'not_null', a.attnotnull
    )
    order by c.relname, a.attnum
  ) as value
  from required_columns rc
  join pg_catalog.pg_class c on c.relname = rc.table_name
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  join pg_catalog.pg_attribute a
    on a.attrelid = c.oid
   and a.attname = rc.column_name
   and a.attnum > 0
   and not a.attisdropped
),
create_booking_details as (
  select pg_catalog.jsonb_build_object(
    'identity_arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
    'return_type', pg_catalog.format_type(p.prorettype, null),
    'security', case when p.prosecdef then 'DEFINER' else 'INVOKER' end,
    'search_path', p.proconfig,
    'definition_fingerprint', pg_catalog.md5(
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
  ) as value
  from pg_catalog.pg_proc p
  where p.oid = pg_catalog.to_regprocedure('public.create_booking(jsonb)')::oid
),
overlap_details as (
  select pg_catalog.jsonb_build_object(
    'definition_hash', pg_catalog.md5(pg_catalog.pg_get_constraintdef(c.oid, false)),
    'definition', pg_catalog.pg_get_constraintdef(c.oid, false)
  ) as value
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.matches'::pg_catalog.regclass
    and c.conname = 'matches_no_active_court_overlap'
),
matches_policies as (
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'name', p.polname,
      'command', p.polcmd,
      'roles', (
        select pg_catalog.jsonb_agg(
          pg_catalog.pg_get_userbyid(roles.role_oid)
          order by pg_catalog.pg_get_userbyid(roles.role_oid)
        )
        from pg_catalog.unnest(p.polroles) as roles(role_oid)
      ),
      'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid, true),
      'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, true)
    )
    order by p.polname
  ) as value
  from pg_catalog.pg_policy p
  where p.polrelid = 'public.matches'::pg_catalog.regclass
),
matches_policies_fingerprint as (
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
  ) as value
  from pg_catalog.pg_policy p
  where p.polrelid = 'public.matches'::pg_catalog.regclass
),
matches_grants as (
  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'grantee', r.rolname,
      'select', pg_catalog.has_table_privilege(r.rolname, 'public.matches', 'SELECT'),
      'insert', pg_catalog.has_table_privilege(r.rolname, 'public.matches', 'INSERT'),
      'update', pg_catalog.has_table_privilege(r.rolname, 'public.matches', 'UPDATE'),
      'delete', pg_catalog.has_table_privilege(r.rolname, 'public.matches', 'DELETE')
    )
    order by r.rolname
  ) as value
  from pg_catalog.pg_roles r
  where r.rolname in ('anon', 'authenticated', 'service_role')
),
matches_acl_fingerprint as (
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
  ) as value
  from pg_catalog.pg_class c
  where c.oid = 'public.matches'::pg_catalog.regclass
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
)
select pg_catalog.jsonb_build_object(
  'migration', '012_training_domain',
  'precheck_ok', true,
  'detected_columns', (select value from detected_columns),
  'create_booking', (select value from create_booking_details),
  'overlap_constraint', (select value from overlap_details),
  'expected_012_actor_fk_on_delete', 'RESTRICT',
  'matches_rls_enabled', (
    select c.relrowsecurity
    from pg_catalog.pg_class c
    where c.oid = 'public.matches'::pg_catalog.regclass
  ),
  'matches_policies', (select value from matches_policies),
  'matches_policies_fingerprint', (select value from matches_policies_fingerprint),
  'matches_grants', (select value from matches_grants),
  'matches_acl_fingerprint', (select value from matches_acl_fingerprint),
  'matches_snapshot', (select pg_catalog.to_jsonb(matches_snapshot) from matches_snapshot),
  'diagnostics', pg_catalog.jsonb_build_object(
    'server_version', pg_catalog.current_setting('server_version'),
    'TimeZone', pg_catalog.current_setting('TimeZone'),
    'timezone_data_version', null,
    'timezone_data_version_note', 'PostgreSQL does not expose a standard standalone tzdata version setting.'
  ),
  'note', 'Read-only PRECHECK. Migration 012 persists approved legacy fingerprints in its own table metadata for automatic POSTCHECK comparison.'
) as training_domain_precheck;

rollback;
