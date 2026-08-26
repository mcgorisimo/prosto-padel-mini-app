-- 042_backend_contact_verification_persistence_POSTCHECK.sql
-- Read-only exact-catalog and empty-state verification after a future apply.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $postcheck$
declare
  v_name text;
  v_relation_oid oid;
  v_function_oid oid;
  v_expected_tables text[] := array[
    'account_contacts',
    'contact_verification_audit',
    'contact_verification_challenges',
    'contact_verification_commands',
    'contact_verification_dispatches',
    'contact_verification_rate_buckets'
  ]::text[];
  v_actual_tables text[];
begin
  select pg_catalog.array_agg(
    class.relname::text order by class.relname::text collate "C"
  ) into v_actual_tables
  from pg_catalog.pg_class class
  where class.relnamespace = 'backend_auth'::pg_catalog.regnamespace
    and class.relkind = 'r'
    and class.relname = any (v_expected_tables);

  if v_actual_tables is distinct from v_expected_tables then
    raise exception 'POSTCHECK_FAILED: migration 042 relation set differs';
  end if;

  foreach v_name in array v_expected_tables loop
    v_relation_oid := pg_catalog.to_regclass('backend_auth.' || v_name)::oid;
    if v_relation_oid is null
       or pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
         '042_backend_contact_verification_persistence:'
           || backend_auth.relation_fingerprint(
             v_relation_oid::pg_catalog.regclass
           )
       or pg_catalog.has_table_privilege(
         'public',
         v_relation_oid,
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
       )
       or pg_catalog.has_table_privilege(
         'backend_auth_app',
         v_relation_oid,
         'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
       )
       or exists (
         select 1
         from pg_catalog.pg_class relation_row
         where relation_row.oid = v_relation_oid
           and relation_row.relowner is distinct from
             pg_catalog.to_regrole('backend_auth_owner')::oid
       )
       or exists (
         select 1
         from pg_catalog.pg_class relation_row
         cross join lateral pg_catalog.aclexplode(
           pg_catalog.coalesce(
             relation_row.relacl,
             pg_catalog.acldefault('r', relation_row.relowner)
           )
         ) acl
         where relation_row.oid = v_relation_oid
           and acl.grantee <> relation_row.relowner
       ) then
      raise exception 'POSTCHECK_FAILED: relation % differs', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'guard_account_contact_transition()',
    'guard_contact_verification_challenge_transition()',
    'guard_contact_verification_dispatch_transition()',
    'guard_contact_verification_rate_bucket_transition()'
  ] loop
    v_function_oid := pg_catalog.to_regprocedure(
      'backend_auth.' || v_name
    )::oid;
    if v_function_oid is null
       or pg_catalog.obj_description(v_function_oid, 'pg_proc') is distinct from
         '042_backend_contact_verification_persistence:'
           || pg_catalog.md5(
             pg_catalog.pg_get_functiondef(v_function_oid)
           )
       or exists (
         select 1
         from pg_catalog.pg_proc function_row
         where function_row.oid = v_function_oid
           and (
             function_row.proowner is distinct from
               pg_catalog.to_regrole('backend_auth_owner')::oid
             or function_row.prosecdef
             or function_row.provolatile <> 'v'
             or function_row.proconfig is distinct from
               array['search_path=pg_catalog, pg_temp']::text[]
           )
       )
       or pg_catalog.has_function_privilege(
         'public',
         v_function_oid,
         'EXECUTE'
       )
       or pg_catalog.has_function_privilege(
         'backend_auth_app',
         v_function_oid,
         'EXECUTE'
       )
       or exists (
         select 1
         from pg_catalog.pg_proc function_row
         cross join lateral pg_catalog.aclexplode(
           pg_catalog.coalesce(
             function_row.proacl,
             pg_catalog.acldefault('f', function_row.proowner)
           )
         ) acl
         where function_row.oid = v_function_oid
           and acl.grantee <> function_row.proowner
       ) then
      raise exception 'POSTCHECK_FAILED: function % differs', v_name;
    end if;
  end loop;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_class index_class
         on index_class.oid = index_row.indexrelid
       where index_row.indrelid =
         'backend_auth.contact_verification_challenges'::pg_catalog.regclass
         and index_class.relname =
           'contact_verification_challenges_one_active_uq'
         and index_row.indisunique
         and pg_catalog.pg_get_expr(
           index_row.indpred,
           index_row.indrelid
         ) = '(state = ''pending''::text)'
     ) <> 1 then
    raise exception 'POSTCHECK_FAILED: active challenge uniqueness differs';
  end if;

  if exists (select 1 from backend_auth.account_contacts)
     or exists (select 1 from backend_auth.contact_verification_challenges)
     or exists (select 1 from backend_auth.contact_verification_commands)
     or exists (select 1 from backend_auth.contact_verification_dispatches)
     or exists (select 1 from backend_auth.contact_verification_rate_buckets)
     or exists (select 1 from backend_auth.contact_verification_audit) then
    raise exception 'POSTCHECK_FAILED: migration 042 target must remain empty before runtime wiring';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'migration', '042_backend_contact_verification_persistence',
  'verified', true,
  'runtime_connected', false,
  'provider_selected', false,
  'rows', pg_catalog.jsonb_build_object(
    'account_contacts', (
      select pg_catalog.count(*) from backend_auth.account_contacts
    ),
    'contact_verification_challenges', (
      select pg_catalog.count(*)
      from backend_auth.contact_verification_challenges
    ),
    'contact_verification_commands', (
      select pg_catalog.count(*)
      from backend_auth.contact_verification_commands
    ),
    'contact_verification_dispatches', (
      select pg_catalog.count(*)
      from backend_auth.contact_verification_dispatches
    ),
    'contact_verification_rate_buckets', (
      select pg_catalog.count(*)
      from backend_auth.contact_verification_rate_buckets
    ),
    'contact_verification_audit', (
      select pg_catalog.count(*)
      from backend_auth.contact_verification_audit
    )
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'account_contacts', backend_auth.relation_fingerprint(
      'backend_auth.account_contacts'::pg_catalog.regclass
    ),
    'contact_verification_challenges', backend_auth.relation_fingerprint(
      'backend_auth.contact_verification_challenges'::pg_catalog.regclass
    ),
    'contact_verification_commands', backend_auth.relation_fingerprint(
      'backend_auth.contact_verification_commands'::pg_catalog.regclass
    ),
    'contact_verification_dispatches', backend_auth.relation_fingerprint(
      'backend_auth.contact_verification_dispatches'::pg_catalog.regclass
    ),
    'contact_verification_rate_buckets', backend_auth.relation_fingerprint(
      'backend_auth.contact_verification_rate_buckets'::pg_catalog.regclass
    ),
    'contact_verification_audit', backend_auth.relation_fingerprint(
      'backend_auth.contact_verification_audit'::pg_catalog.regclass
    )
  ),
  'function_fingerprints', pg_catalog.jsonb_build_object(
    'guard_account_contact_transition', pg_catalog.md5(
      pg_catalog.pg_get_functiondef(
        'backend_auth.guard_account_contact_transition()'::pg_catalog.regprocedure
      )
    ),
    'guard_contact_verification_challenge_transition', pg_catalog.md5(
      pg_catalog.pg_get_functiondef(
        'backend_auth.guard_contact_verification_challenge_transition()'::pg_catalog.regprocedure
      )
    ),
    'guard_contact_verification_dispatch_transition', pg_catalog.md5(
      pg_catalog.pg_get_functiondef(
        'backend_auth.guard_contact_verification_dispatch_transition()'::pg_catalog.regprocedure
      )
    ),
    'guard_contact_verification_rate_bucket_transition', pg_catalog.md5(
      pg_catalog.pg_get_functiondef(
        'backend_auth.guard_contact_verification_rate_bucket_transition()'::pg_catalog.regprocedure
      )
    )
  )
) as backend_contact_verification_persistence_postcheck;

rollback;
