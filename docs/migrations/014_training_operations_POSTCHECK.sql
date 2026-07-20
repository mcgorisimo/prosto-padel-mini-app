-- 014_training_operations_POSTCHECK.sql
-- Structural, read-only verification. It creates no profiles, bookings, or requests.

begin;
set transaction read only;
set local search_path = pg_catalog, public, pg_temp;

select pg_catalog.jsonb_build_object(
  'check', 'environment',
  'server_version', pg_catalog.current_setting('server_version'),
  'timezone', pg_catalog.current_setting('TimeZone'),
  'database', pg_catalog.current_database(),
  'current_user', current_user
) as training_014_postcheck_environment;

do $$
declare
  v_signature text;
  v_function pg_catalog.regprocedure;
  v_definition text;
  v_comment text;
  v_definition_md5 text;
  v_acl_md5 text;
  v_owner oid;
  v_role text;
  v_table text;
  v_authenticated_oid oid;
begin
  foreach v_role in array array['anon', 'authenticated', 'service_role']::text[] loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = v_role) then
      raise exception 'POSTCHECK_FAILED: role % is missing', v_role;
    end if;
  end loop;

  if pg_catalog.to_regprocedure('public.training_current_customer_id()') is null
     or pg_catalog.to_regprocedure(
       'public.training_request_transition_allowed(text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.create_individual_training_request(uuid,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.transition_individual_training_request(uuid,text,text,text,text,jsonb)'
     ) is null then
    raise exception 'POSTCHECK_FAILED: migration 014 functions are incomplete';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'training_current_customer_id',
        'training_request_transition_allowed',
        'create_individual_training_request',
        'transition_individual_training_request'
      ]::text[])
  ) <> 4 then
    raise exception 'POSTCHECK_FAILED: unexpected migration 014 overload exists';
  end if;

end;
$$;

-- Exact function properties and required safety operations.
do $$
declare
  v_proc pg_catalog.pg_proc%rowtype;
  v_definition text;
begin
  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'public.training_current_customer_id()'::pg_catalog.regprocedure;
  if v_proc.prosecdef
     or v_proc.provolatile <> 's'
     or v_proc.prorettype <> 'uuid'::pg_catalog.regtype
     or v_proc.proconfig <> array['search_path=pg_catalog, auth, pg_temp']::text[] then
    raise exception 'POSTCHECK_FAILED: authentication boundary properties differ';
  end if;
  v_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(v_proc.oid));
  if pg_catalog.strpos(v_definition, 'select auth.uid()') = 0 then
    raise exception 'POSTCHECK_FAILED: authentication boundary no longer calls auth.uid()';
  end if;

  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'public.training_request_transition_allowed(text,text)'::pg_catalog.regprocedure;
  if v_proc.prosecdef
     or v_proc.provolatile <> 'i'
     or v_proc.prorettype <> 'boolean'::pg_catalog.regtype
     or not v_proc.proisstrict
     or v_proc.proconfig <> array['search_path=pg_catalog, pg_temp']::text[] then
    raise exception 'POSTCHECK_FAILED: transition graph properties differ';
  end if;
  v_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(v_proc.oid));
  if pg_catalog.strpos(v_definition, 'when ''court_sync_pending''') = 0
     or pg_catalog.strpos(v_definition, 'when ''court_sync_unknown''') = 0
     or pg_catalog.strpos(v_definition, 'when ''awaiting_coach''') = 0
     or pg_catalog.strpos(v_definition, 'when ''confirmed''') = 0
     or pg_catalog.strpos(v_definition, 'when ''cancel_pending''') = 0
     or pg_catalog.strpos(v_definition, 'else false') = 0
     or pg_catalog.strpos(v_definition, 'when ''rejected''') > 0
     or pg_catalog.strpos(v_definition, 'when ''cancelled''') > 0
     or pg_catalog.strpos(v_definition, 'when ''completed''') > 0 then
    raise exception 'POSTCHECK_FAILED: transition graph or terminal-state protection differs';
  end if;

  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'public.create_individual_training_request(uuid,jsonb)'::pg_catalog.regprocedure;
  if not v_proc.prosecdef
     or v_proc.provolatile <> 'v'
     or v_proc.prorettype <> 'public.training_requests'::pg_catalog.regtype
     or v_proc.proconfig <> array[
       'search_path=pg_catalog, public, pg_temp', 'row_security=off'
     ]::text[] then
    raise exception 'POSTCHECK_FAILED: client creation function properties differ';
  end if;
  v_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(v_proc.oid));
  if pg_catalog.strpos(v_definition, 'training_current_customer_id()') = 0
     or pg_catalog.strpos(v_definition, 'pg_advisory_xact_lock') = 0
     or pg_catalog.strpos(v_definition, 'customer_id = v_customer_id') = 0
     or pg_catalog.strpos(v_definition, 'client_request_id = p_client_request_id') = 0
     or pg_catalog.strpos(v_definition, 'return v_existing') = 0
     or pg_catalog.strpos(v_definition, 'training_client_court_price_forbidden') = 0
     or pg_catalog.strpos(v_definition, 'p_booking - ''priceperperson'' - ''price_per_person''') = 0
     or pg_catalog.strpos(v_definition, 'public.create_booking(v_payload)') = 0
     or pg_catalog.strpos(v_definition, 'training_trusted_court_price_unavailable') = 0
     or pg_catalog.strpos(v_definition, 'insert into public.training_requests') = 0
     or pg_catalog.strpos(v_definition, 'insert into public.training_status_history') = 0
     or pg_catalog.strpos(v_definition, 'insert into public.training_coach_assignments') = 0
     or pg_catalog.strpos(v_definition, '''court_sync_pending''') = 0
     or pg_catalog.strpos(v_definition, '''not_due''') = 0
     or pg_catalog.strpos(v_definition, '''selection_pending''') = 0 then
    raise exception 'POSTCHECK_FAILED: creation/idempotency/history contract differs';
  end if;

  select p.* into strict v_proc
  from pg_catalog.pg_proc p
  where p.oid = 'public.transition_individual_training_request(uuid,text,text,text,text,jsonb)'::pg_catalog.regprocedure;
  if not v_proc.prosecdef
     or v_proc.provolatile <> 'v'
     or v_proc.prorettype <> 'public.training_requests'::pg_catalog.regtype
     or v_proc.proconfig <> array[
       'search_path=pg_catalog, public, pg_temp', 'row_security=off'
     ]::text[] then
    raise exception 'POSTCHECK_FAILED: transition operation properties differ';
  end if;
  v_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(v_proc.oid));
  if pg_catalog.strpos(v_definition, 'for update') = 0
     or pg_catalog.strpos(v_definition, 'status is distinct from p_expected_status') = 0
     or pg_catalog.strpos(v_definition, 'training_request_transition_allowed') = 0
     or pg_catalog.strpos(v_definition, 'update public.training_requests') = 0
     or pg_catalog.strpos(v_definition, 'insert into public.training_status_history') = 0 then
    raise exception 'POSTCHECK_FAILED: locked transition/history operation differs';
  end if;
end;
$$;

-- Verify every function against the immutable metadata written by migration 014.
do $$
declare
  v_signature text;
  v_function pg_catalog.regprocedure;
  v_comment text;
  v_definition_md5 text;
  v_acl_md5 text;
  v_owner oid;
begin
  foreach v_signature in array array[
    'public.training_current_customer_id()',
    'public.training_request_transition_allowed(text,text)',
    'public.create_individual_training_request(uuid,jsonb)',
    'public.transition_individual_training_request(uuid,text,text,text,text,jsonb)'
  ]::text[] loop
    v_function := v_signature::pg_catalog.regprocedure;
    select pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
             pg_catalog.pg_get_functiondef(p.oid), E'\r\n', E'\n'
           ), E'\r', E'\n')),
           p.proowner,
           pg_catalog.md5(coalesce(pg_catalog.string_agg(
             acl.grantee || '|' || acl.grantor || '|' || acl.privilege_type
               || '|' || acl.is_grantable,
             ',' order by acl.grantee, acl.grantor, acl.privilege_type, acl.is_grantable
           ), '')),
           pg_catalog.obj_description(p.oid, 'pg_proc')
    into v_definition_md5, v_owner, v_acl_md5, v_comment
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(
      p.proacl, pg_catalog.acldefault('f', p.proowner)
    )) acl
    where p.oid = v_function
    group by p.oid, p.proowner;

    if v_comment is null
       or v_comment !~ '^migration=014_training_operations;rollback=drop;definition_md5=[0-9a-f]{32};owner_oid=[0-9]+;acl_md5=[0-9a-f]{32}$'
       or substring(v_comment from 'definition_md5=([0-9a-f]{32})') <> v_definition_md5
       or substring(v_comment from 'owner_oid=([0-9]+)')::oid <> v_owner
       or substring(v_comment from 'acl_md5=([0-9a-f]{32})') <> v_acl_md5 then
      raise exception 'POSTCHECK_FAILED: function % metadata fingerprint differs', v_signature;
    end if;
  end loop;
end;
$$;

-- Direct table DML remains blocked, including effective inherited privileges.
do $$
declare
  v_table text;
  v_role text;
  v_function text;
begin
  foreach v_table in array array[
    'public.training_requests',
    'public.training_status_history',
    'public.training_coach_assignments'
  ]::text[] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role']::text[] loop
      if pg_catalog.has_table_privilege(v_role, v_table, 'INSERT')
         or pg_catalog.has_table_privilege(v_role, v_table, 'UPDATE')
         or pg_catalog.has_table_privilege(v_role, v_table, 'DELETE')
         or pg_catalog.has_table_privilege(v_role, v_table, 'TRUNCATE')
         or pg_catalog.has_table_privilege(v_role, v_table, 'REFERENCES')
         or pg_catalog.has_table_privilege(v_role, v_table, 'TRIGGER') then
        raise exception 'POSTCHECK_FAILED: role % has effective direct DML on %', v_role, v_table;
      end if;
    end loop;

    if exists (
      select 1
      from pg_catalog.pg_class c
      cross join lateral pg_catalog.aclexplode(coalesce(
        c.relacl, pg_catalog.acldefault('r', c.relowner)
      )) acl
      where c.oid = v_table::pg_catalog.regclass
        and acl.grantee = 0
        and acl.privilege_type = any (array[
          'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
        ]::text[])
    ) then
      raise exception 'POSTCHECK_FAILED: PUBLIC has direct DML on %', v_table;
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
       'authenticated', 'public.create_individual_training_request(uuid,jsonb)', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon', 'public.create_individual_training_request(uuid,jsonb)', 'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'service_role', 'public.create_individual_training_request(uuid,jsonb)', 'EXECUTE'
     ) then
    raise exception 'POSTCHECK_FAILED: client creation EXECUTE grants differ';
  end if;

  if not pg_catalog.has_function_privilege(
       'service_role',
       'public.transition_individual_training_request(uuid,text,text,text,text,jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'anon',
       'public.transition_individual_training_request(uuid,text,text,text,text,jsonb)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.transition_individual_training_request(uuid,text,text,text,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'POSTCHECK_FAILED: administrative transition EXECUTE grants differ';
  end if;

  foreach v_function in array array[
    'public.training_current_customer_id()',
    'public.training_request_transition_allowed(text,text)'
  ]::text[] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role']::text[] loop
      if pg_catalog.has_function_privilege(v_role, v_function, 'EXECUTE') then
        raise exception 'POSTCHECK_FAILED: role % can execute internal helper %', v_role, v_function;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    cross join lateral pg_catalog.aclexplode(coalesce(
      p.proacl, pg_catalog.acldefault('f', p.proowner)
    )) acl
    where p.oid in (
      'public.training_current_customer_id()'::pg_catalog.regprocedure,
      'public.training_request_transition_allowed(text,text)'::pg_catalog.regprocedure,
      'public.create_individual_training_request(uuid,jsonb)'::pg_catalog.regprocedure,
      'public.transition_individual_training_request(uuid,text,text,text,text,jsonb)'::pg_catalog.regprocedure
    )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'POSTCHECK_FAILED: PUBLIC can execute a migration 014 function';
  end if;
end;
$$;

-- Reuse migration 012's exact relation manifests. This proves that policies,
-- constraints, indexes, triggers, columns, owners, ACL, and RLS flags did not change.
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
      raise exception 'POSTCHECK_FAILED: migration 012 relation % changed', v_relation_name;
    end if;
  end loop;
end;
$$;

-- Verify append-only history and physical-delete protection explicitly.
do $$
declare
  v_definition text;
begin
  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.training_status_history_prevent_mutation()'::pg_catalog.regprocedure
  )) into v_definition;
  if pg_catalog.strpos(v_definition, 'training_status_history_append_only') = 0
     or not exists (
       select 1 from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.training_status_history'::pg_catalog.regclass
         and t.tgname = 'training_status_history_append_only'
         and pg_catalog.lower(pg_catalog.pg_get_triggerdef(t.oid, true))
           like '%before update or delete%'
     ) then
    raise exception 'POSTCHECK_FAILED: append-only history protection differs';
  end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'public.training_request_prevent_delete()'::pg_catalog.regprocedure
  )) into v_definition;
  if pg_catalog.strpos(v_definition, 'training_request_physical_delete_forbidden') = 0
     or not exists (
       select 1 from pg_catalog.pg_trigger t
       where t.tgrelid = 'public.training_requests'::pg_catalog.regclass
         and t.tgname = 'training_requests_prevent_delete'
         and pg_catalog.lower(pg_catalog.pg_get_triggerdef(t.oid, true)) like '%before delete%'
     ) then
    raise exception 'POSTCHECK_FAILED: request delete protection differs';
  end if;
end;
$$;

-- Compare legacy booking objects with the fingerprints stored by migration 012.
do $$
declare
  v_comment text;
  v_expected text;
  v_actual text;
begin
  v_comment := pg_catalog.obj_description(
    'public.training_requests'::pg_catalog.regclass, 'pg_class'
  );

  v_expected := substring(v_comment from 'legacy_create_booking_md5=([0-9a-f]{32})');
  select pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
    coalesce(pg_catalog.pg_get_functiondef(
      'public.create_booking(jsonb)'::pg_catalog.regprocedure
    ), ''), E'\r\n', E'\n'), E'\r', E'\n')) into v_actual;
  if v_expected is null or v_actual is distinct from v_expected then
    raise exception 'POSTCHECK_FAILED: create_booking changed after migration 012';
  end if;

  v_expected := substring(v_comment from 'legacy_overlap_md5=([0-9a-f]{32})');
  select pg_catalog.md5(pg_catalog.pg_get_constraintdef(c.oid, false)) into v_actual
  from pg_catalog.pg_constraint c
  where c.conrelid = 'public.matches'::pg_catalog.regclass
    and c.conname = 'matches_no_active_court_overlap';
  if v_expected is null or v_actual is distinct from v_expected then
    raise exception 'POSTCHECK_FAILED: booking exclusion constraint changed';
  end if;

  v_expected := substring(v_comment from 'legacy_matches_policies_md5=([0-9a-f]{32})');
  select pg_catalog.md5(coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'name', p.polname,
      'permissive', p.polpermissive,
      'command', p.polcmd,
      'roles', (select pg_catalog.jsonb_agg(pg_catalog.pg_get_userbyid(role_oid)
        order by pg_catalog.pg_get_userbyid(role_oid))
        from pg_catalog.unnest(p.polroles) roles(role_oid)),
      'using', pg_catalog.regexp_replace(coalesce(
        pg_catalog.pg_get_expr(p.polqual, p.polrelid, false), ''
      ), E'\s+', ' ', 'g'),
      'with_check', pg_catalog.regexp_replace(coalesce(
        pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false), ''
      ), E'\s+', ' ', 'g')
    ) order by p.polname
  )::text, '[]')) into v_actual
  from pg_catalog.pg_policy p where p.polrelid = 'public.matches'::pg_catalog.regclass;
  if v_expected is null or v_actual is distinct from v_expected then
    raise exception 'POSTCHECK_FAILED: matches policies changed';
  end if;

  v_expected := substring(v_comment from 'legacy_matches_acl_md5=([0-9a-f]{32})');
  select pg_catalog.md5(pg_catalog.jsonb_build_object(
    'relacl', coalesce(c.relacl::text, ''),
    'effective', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'role', role_name,
      'privilege', privilege_name,
      'allowed', pg_catalog.has_table_privilege(
        role_name, 'public.matches', privilege_name
      )
    ) order by role_name, privilege_name)
    from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) privileges(privilege_name))
  )::text) into v_actual
  from pg_catalog.pg_class c where c.oid = 'public.matches'::pg_catalog.regclass;
  if v_expected is null or v_actual is distinct from v_expected then
    raise exception 'POSTCHECK_FAILED: matches grants changed';
  end if;
end;
$$;

rollback;

select pg_catalog.jsonb_build_object(
  'migration', '014_training_operations',
  'status', 'POSTCHECK_OK',
  'behavioral_rows_created', false,
  'direct_table_dml', false,
  'legacy_booking_objects_changed', false,
  'note', 'Behavioral concurrency and rollback tests still require a disposable PostgreSQL database.'
) as training_014_postcheck_result;
