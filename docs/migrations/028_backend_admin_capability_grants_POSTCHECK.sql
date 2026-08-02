-- Read-only postcheck for 028_backend_admin_capability_grants.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_relation record;
  v_event_oid oid := pg_catalog.to_regclass('backend_auth.admin_capability_events');
  v_sequence_oid oid := pg_catalog.to_regclass(
    'backend_auth.admin_capability_events_event_order_seq'
  );
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'POSTCHECK_FAILED: PostgreSQL 14 or newer is required';
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
    raise exception 'POSTCHECK_FAILED: backend_auth_owner attributes are unsafe';
  end if;

  if v_app.rolname is null
     or not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'POSTCHECK_FAILED: backend_auth_app attributes are unsafe';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
     or pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'POSTCHECK_FAILED: role membership boundary differs';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_auth'
     )) <> 'backend_auth_owner'
     or pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'CREATE') then
    raise exception 'POSTCHECK_FAILED: backend_auth schema boundary differs';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_auth', 'accounts', '015_backend_auth_foundation'),
      ('backend_auth', 'player_profiles', '015_backend_auth_foundation'),
      ('backend_auth', 'player_rating_states', '027_backend_admin_rating_state'),
      ('backend_auth', 'player_rating_admin_commands', '027_backend_admin_rating_state')
    ) expected(schema_name, relation_name, migration_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = v_relation.schema_name
        and relation.relname = v_relation.relation_name
        and relation.relkind = 'r'
        and relation.relpersistence = 'p'
        and not relation.relrowsecurity
        and not relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          v_relation.migration_name || ':'
            || backend_auth.relation_fingerprint(relation.oid::pg_catalog.regclass)
    ) then
      raise exception 'POSTCHECK_FAILED: %.% differs from %',
        v_relation.schema_name,
        v_relation.relation_name,
        v_relation.migration_name;
    end if;
  end loop;

  if v_event_oid is null or v_sequence_oid is null then
    raise exception 'POSTCHECK_FAILED: migration 028 relation or sequence is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where relation.oid = v_event_oid
      and namespace.nspname = 'backend_auth'
      and relation.relname = 'admin_capability_events'
      and relation.relkind = 'r'
      and relation.relpersistence = 'p'
      and not relation.relrowsecurity
      and not relation.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(relation.oid, 'pg_class') =
        '028_backend_admin_capability_grants:'
          || backend_auth.relation_fingerprint(relation.oid::pg_catalog.regclass)
  ) then
    raise exception 'POSTCHECK_FAILED: capability event relation metadata differs';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class sequence_row
    join pg_catalog.pg_namespace namespace on namespace.oid = sequence_row.relnamespace
    where sequence_row.oid = v_sequence_oid
      and namespace.nspname = 'backend_auth'
      and sequence_row.relname = 'admin_capability_events_event_order_seq'
      and sequence_row.relkind = 'S'
      and sequence_row.relpersistence = 'p'
      and pg_catalog.pg_get_userbyid(sequence_row.relowner) = 'backend_auth_owner'
  ) then
    raise exception 'POSTCHECK_FAILED: capability event sequence metadata differs';
  end if;

  if pg_catalog.to_regclass(pg_catalog.pg_get_serial_sequence(
       'backend_auth.admin_capability_events', 'event_order'
     )) is distinct from v_sequence_oid
     or not exists (
       select 1
       from pg_catalog.pg_depend dependency
       where dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass
         and dependency.objid = v_sequence_oid
         and dependency.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass
         and dependency.refobjid = v_event_oid
         and dependency.refobjsubid = 2
         and dependency.deptype = 'i'
     ) then
    raise exception 'POSTCHECK_FAILED: capability event identity binding differs';
  end if;

  if exists (
    with expected(
      column_name,
      ordinal_position,
      data_type,
      not_null,
      identity_kind
    ) as (
      values
        ('event_id', 1, 'uuid', true, ''),
        ('event_order', 2, 'bigint', true, 'a'),
        ('account_id', 3, 'uuid', true, ''),
        ('capability', 4, 'text', true, ''),
        ('event_type', 5, 'text', true, ''),
        ('reason_code', 6, 'text', true, ''),
        ('occurred_at', 7, 'bigint', true, '')
    ), actual as (
      select
        attribute.attname::text,
        attribute.attnum::integer,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)::text,
        attribute.attnotnull,
        attribute.attidentity::text
      from pg_catalog.pg_attribute attribute
      where attribute.attrelid = v_event_oid
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: capability event column allowlist differs';
  end if;

  if exists (
    with expected(
      constraint_name,
      constraint_type,
      constrained_columns,
      referenced_relation,
      referenced_columns,
      is_deferrable,
      initially_deferred,
      is_validated,
      normalized_definition
    ) as (
      values
        (
          'admin_capability_events_pkey', 'p', array['event_id']::text[],
          null::text, null::text[], false, false, true,
          'primary key (event_id)'
        ),
        (
          'admin_capability_events_event_order_key', 'u', array['event_order']::text[],
          null::text, null::text[], false, false, true,
          'unique (event_order)'
        ),
        (
          'admin_capability_events_account_id_fkey', 'f', array['account_id']::text[],
          'backend_auth.accounts', array['id']::text[], false, false, true,
          'foreign key (account_id) references backend_auth.accounts(id)'
        ),
        (
          'admin_capability_events_capability_check', 'c', array['capability']::text[],
          null::text, null::text[], false, false, true,
          'check (capability = ''club_admin''::text)'
        ),
        (
          'admin_capability_events_event_type_check', 'c', array['event_type']::text[],
          null::text, null::text[], false, false, true,
          'check (event_type = any (array[''granted''::text, ''revoked''::text]))'
        ),
        (
          'admin_capability_events_reason_code_check', 'c', array['reason_code']::text[],
          null::text, null::text[], false, false, true,
          'check (reason_code = any (array[''bootstrap_admin''::text, ''admin_access_granted''::text, ''admin_access_revoked''::text]))'
        ),
        (
          'admin_capability_events_reason_shape_check', 'c',
          array['event_type', 'reason_code']::text[],
          null::text, null::text[], false, false, true,
          'check (event_type = ''granted''::text and reason_code = any (array[''bootstrap_admin''::text, ''admin_access_granted''::text]) or event_type = ''revoked''::text and reason_code = ''admin_access_revoked''::text)'
        ),
        (
          'admin_capability_events_time_check', 'c', array['occurred_at']::text[],
          null::text, null::text[], false, false, true,
          'check (occurred_at >= 0 and occurred_at <= ''9007199254740991''::bigint)'
        )
    ), actual as (
      select
        constraint_row.conname::text,
        constraint_row.contype::text,
        case
          when constraint_row.conkey is null then null::text[]
          else array(
            select attribute.attname::text
            from pg_catalog.unnest(constraint_row.conkey) with ordinality key(attnum, position)
            join pg_catalog.pg_attribute attribute
              on attribute.attrelid = constraint_row.conrelid
             and attribute.attnum = key.attnum
            order by key.position
          )
        end,
        case
          when constraint_row.confrelid = 0 then null::text
          else constraint_row.confrelid::pg_catalog.regclass::text
        end,
        case
          when constraint_row.confkey is null then null::text[]
          else array(
            select attribute.attname::text
            from pg_catalog.unnest(constraint_row.confkey) with ordinality key(attnum, position)
            join pg_catalog.pg_attribute attribute
              on attribute.attrelid = constraint_row.confrelid
             and attribute.attnum = key.attnum
            order by key.position
          )
        end,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        constraint_row.convalidated,
        pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
          '[[:space:]]+', ' ', 'g'
        ))
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = v_event_oid
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: capability event constraint allowlist differs';
  end if;

  if exists (
    with expected(
      index_name,
      access_method,
      is_unique,
      is_primary,
      indexed_columns,
      ordering_options,
      predicate
    ) as (
      values
        (
          'admin_capability_events_pkey', 'btree', true, true,
          array['event_id']::text[], '0', null::text
        ),
        (
          'admin_capability_events_event_order_key', 'btree', true, false,
          array['event_order']::text[], '0', null::text
        ),
        (
          'admin_capability_events_account_latest_idx', 'btree', false, false,
          array['account_id', 'capability', 'event_order']::text[], '0 0 3', null::text
        )
    ), actual as (
      select
        index_relation.relname::text,
        access_method.amname::text,
        index_row.indisunique,
        index_row.indisprimary,
        array(
          select pg_catalog.pg_get_indexdef(index_row.indexrelid, position, true)::text
          from pg_catalog.generate_series(1, index_row.indnkeyatts) position
          order by position
        ),
        index_row.indoption::text,
        pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid, true)::text
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_relation on index_relation.oid = index_row.indexrelid
      join pg_catalog.pg_am access_method on access_method.oid = index_relation.relam
      where index_row.indrelid = v_event_oid
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: capability event index allowlist differs';
  end if;

  if exists (
    with expected(
      schema_name,
      table_name,
      grantor,
      grantee,
      privilege_type,
      is_grantable
    ) as (
      values
        (
          'backend_auth', 'admin_capability_events',
          'backend_auth_owner', 'backend_auth_app', 'SELECT', false
        )
    ), actual as (
      select
        namespace.nspname::text,
        relation.relname::text,
        grantor.rolname::text,
        case
          when acl_row.grantee = 0 then 'PUBLIC'::text
          else grantee.rolname::text
        end,
        acl_row.privilege_type::text,
        acl_row.is_grantable
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) acl_row
      join pg_catalog.pg_roles grantor on grantor.oid = acl_row.grantor
      left join pg_catalog.pg_roles grantee on grantee.oid = acl_row.grantee
      where relation.oid = v_event_oid
        and acl_row.grantee <> relation.relowner
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: capability event table ACL differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class sequence_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(sequence_row.relacl, pg_catalog.acldefault('S', sequence_row.relowner))
    ) acl_row
    where sequence_row.oid = v_sequence_oid
      and acl_row.grantee <> sequence_row.relowner
  ) then
    raise exception 'POSTCHECK_FAILED: capability event sequence ACL differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = v_event_oid
      and attribute.attnum > 0
      and not attribute.attisdropped
      and attribute.attacl is not null
  ) then
    raise exception 'POSTCHECK_FAILED: capability event column ACL differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = v_event_oid
      and not trigger_row.tgisinternal
  ) then
    raise exception 'POSTCHECK_FAILED: capability event has an unexpected trigger';
  end if;

  if not pg_catalog.has_table_privilege('backend_auth_app', v_event_oid, 'SELECT')
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_event_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or pg_catalog.has_sequence_privilege(
       'backend_auth_app', v_sequence_oid, 'USAGE, SELECT, UPDATE'
     ) then
    raise exception 'POSTCHECK_FAILED: capability event privileges differ';
  end if;

  if exists (select 1 from backend_auth.admin_capability_events) then
    raise exception 'POSTCHECK_FAILED: capability event storage is not empty';
  end if;

  if exists (
    select 1
    from backend_auth.accounts account
    where account.role <> all (array['player', 'club_admin']::text[])
       or account.status <> all (array[
         'active', 'blocked', 'pending_deletion', 'anonymized'
       ]::text[])
  ) then
    raise exception 'POSTCHECK_FAILED: account role or status data differs';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '028_backend_admin_capability_grants',
  'backend_auth_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', (
      select pg_catalog.count(*)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth' and relation.relkind = 'r'
    ),
    'sequences', (
      select pg_catalog.count(*)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth' and relation.relkind = 'S'
    ),
    'constraints', (
      select pg_catalog.count(*)
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth'
    ),
    'user_triggers', (
      select pg_catalog.count(*)
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth' and not trigger_row.tgisinternal
    )
  ),
  'row_counts', pg_catalog.jsonb_build_object(
    'accounts', (select pg_catalog.count(*) from backend_auth.accounts),
    'player_profiles', (select pg_catalog.count(*) from backend_auth.player_profiles),
    'player_rating_states', (select pg_catalog.count(*) from backend_auth.player_rating_states),
    'player_rating_admin_commands', (
      select pg_catalog.count(*) from backend_auth.player_rating_admin_commands
    ),
    'admin_capability_events', (
      select pg_catalog.count(*) from backend_auth.admin_capability_events
    )
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'accounts', backend_auth.relation_fingerprint(
      'backend_auth.accounts'::pg_catalog.regclass
    ),
    'player_profiles', backend_auth.relation_fingerprint(
      'backend_auth.player_profiles'::pg_catalog.regclass
    ),
    'player_rating_states', backend_auth.relation_fingerprint(
      'backend_auth.player_rating_states'::pg_catalog.regclass
    ),
    'player_rating_admin_commands', backend_auth.relation_fingerprint(
      'backend_auth.player_rating_admin_commands'::pg_catalog.regclass
    ),
    'admin_capability_events', backend_auth.relation_fingerprint(
      'backend_auth.admin_capability_events'::pg_catalog.regclass
    )
  )
) as backend_admin_capability_grants_postcheck;

rollback;
