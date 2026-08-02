-- Read-only postcheck for 027_backend_admin_rating_state.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_relation record;
  v_command_oid oid;
  v_rating_state_oid oid;
  v_update_columns text[];
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
     )) <> 'backend_auth_owner' then
    raise exception 'POSTCHECK_FAILED: backend_auth schema is missing or owner differs';
  end if;

  v_command_oid := pg_catalog.to_regclass(
    'backend_auth.player_rating_admin_commands'
  )::oid;
  v_rating_state_oid := pg_catalog.to_regclass(
    'backend_auth.player_rating_states'
  )::oid;

  if v_command_oid is null or v_rating_state_oid is null then
    raise exception 'POSTCHECK_FAILED: migration 027 relation is missing';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_auth', 'accounts', '015_backend_auth_foundation'),
      ('backend_auth', 'player_profiles', '015_backend_auth_foundation'),
      ('backend_auth', 'player_rating_states', '027_backend_admin_rating_state'),
      ('backend_auth', 'player_rating_admin_commands', '027_backend_admin_rating_state'),
      ('backend_match', 'match_rating_applications', '026_backend_match_rating_applications'),
      ('backend_match', 'match_rating_changes', '026_backend_match_rating_applications')
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

  if exists (
    with actual as (
      select
        attribute.attname::text as column_name,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)::text
          as data_type,
        attribute.attnotnull as is_not_null,
        pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid, true)::text
          as default_expression
      from pg_catalog.pg_attribute attribute
      left join pg_catalog.pg_attrdef default_row
        on default_row.adrelid = attribute.attrelid
       and default_row.adnum = attribute.attnum
      where attribute.attrelid = v_command_oid
        and attribute.attnum > 0
        and not attribute.attisdropped
    ), expected as (
      select *
      from (values
        ('command_id', 'uuid', true, null::text),
        ('actor_account_id', 'uuid', true, null::text),
        ('target_account_id', 'uuid', true, null::text),
        ('request_digest', 'bytea', true, null::text),
        ('command_type', 'text', true, null::text),
        ('result_type', 'text', true, null::text),
        ('rating_before', 'numeric(4,2)', true, null::text),
        ('rating_after', 'numeric(4,2)', true, null::text),
        ('is_verified_before', 'boolean', true, null::text),
        ('is_verified_after', 'boolean', true, null::text),
        ('applied_at', 'bigint', true, null::text)
      ) inventory(column_name, data_type, is_not_null, default_expression)
    ), differences as (
      (select * from actual except select * from expected)
      union all
      (select * from expected except select * from actual)
    )
    select 1 from differences
  ) then
    raise exception 'POSTCHECK_FAILED: admin command column allowlist differs';
  end if;

  if exists (
    with actual as (
      select
        constraint_row.conname::text as constraint_name,
        constraint_row.contype::text as constraint_type,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        constraint_row.convalidated,
        pg_catalog.lower(pg_catalog.regexp_replace(
          pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
          '\s+',
          ' ',
          'g'
        ))::text as definition
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = v_command_oid
    ), expected as (
      select *
      from (values
        (
          'player_rating_admin_commands_pkey',
          'p', false, false, true,
          'primary key (command_id)'
        ),
        (
          'player_rating_admin_commands_actor_account_id_fkey',
          'f', false, false, true,
          'foreign key (actor_account_id) references backend_auth.accounts(id)'
        ),
        (
          'player_rating_admin_commands_target_account_id_fkey',
          'f', false, false, true,
          'foreign key (target_account_id) references backend_auth.player_rating_states(account_id)'
        ),
        (
          'player_rating_admin_commands_request_digest_check',
          'c', false, false, true,
          'check (octet_length(request_digest) = 32)'
        ),
        (
          'player_rating_admin_commands_command_type_check',
          'c', false, false, true,
          'check (command_type = ''set_player_rating_state''::text)'
        ),
        (
          'player_rating_admin_commands_result_type_check',
          'c', false, false, true,
          'check (result_type = any (array[''rating_updated''::text, ''verification_updated''::text, ''rating_and_verification_updated''::text, ''rating_state_unchanged''::text]))'
        ),
        (
          'player_rating_admin_commands_rating_check',
          'c', false, false, true,
          'check (rating_before >= 0.00 and rating_before <= 10.00 and rating_after >= 0.00 and rating_after <= 10.00)'
        ),
        (
          'player_rating_admin_commands_time_check',
          'c', false, false, true,
          'check (applied_at >= 0 and applied_at <= ''9007199254740991''::bigint)'
        ),
        (
          'player_rating_admin_commands_result_shape_check',
          'c', false, false, true,
          'check (result_type = ''rating_updated''::text and rating_before <> rating_after and is_verified_before = is_verified_after or result_type = ''verification_updated''::text and rating_before = rating_after and is_verified_before <> is_verified_after or result_type = ''rating_and_verification_updated''::text and rating_before <> rating_after and is_verified_before <> is_verified_after or result_type = ''rating_state_unchanged''::text and rating_before = rating_after and is_verified_before = is_verified_after)'
        )
      ) inventory(
        constraint_name,
        constraint_type,
        condeferrable,
        condeferred,
        convalidated,
        definition
      )
    ), differences as (
      (select * from actual except select * from expected)
      union all
      (select * from expected except select * from actual)
    )
    select 1 from differences
  ) then
    raise exception 'POSTCHECK_FAILED: admin command constraint allowlist differs';
  end if;

  if exists (
    with actual as (
      select
        index_relation.relname::text as index_name,
        access_method.amname::text as access_method,
        index_row.indisunique as is_unique,
        index_row.indisprimary as is_primary,
        (
          select pg_catalog.string_agg(
            pg_catalog.pg_get_indexdef(index_row.indexrelid, position, true),
            ', ' order by position
          )
          from pg_catalog.generate_series(1, index_row.indnkeyatts) position
        )::text as indexed_columns,
        pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid, true)::text
          as predicate
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_relation
        on index_relation.oid = index_row.indexrelid
      join pg_catalog.pg_am access_method
        on access_method.oid = index_relation.relam
      where index_row.indrelid = v_command_oid
    ), expected as (
      select *
      from (values
        (
          'player_rating_admin_commands_pkey',
          'btree',
          true,
          true,
          'command_id',
          null::text
        ),
        (
          'player_rating_admin_commands_actor_applied_idx',
          'btree',
          false,
          false,
          'actor_account_id, applied_at, command_id',
          null::text
        ),
        (
          'player_rating_admin_commands_target_applied_idx',
          'btree',
          false,
          false,
          'target_account_id, applied_at, command_id',
          null::text
        )
      ) inventory(
        index_name,
        access_method,
        is_unique,
        is_primary,
        indexed_columns,
        predicate
      )
    ), differences as (
      (select * from actual except select * from expected)
      union all
      (select * from expected except select * from actual)
    )
    select 1 from differences
  ) then
    raise exception 'POSTCHECK_FAILED: admin command index allowlist differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = v_command_oid
      and not trigger_row.tgisinternal
  ) then
    raise exception 'POSTCHECK_FAILED: admin command has an unexpected trigger';
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
          'backend_auth',
          'player_rating_admin_commands',
          'backend_auth_owner',
          'backend_auth_app',
          'SELECT',
          false
        ),
        (
          'backend_auth',
          'player_rating_admin_commands',
          'backend_auth_owner',
          'backend_auth_app',
          'INSERT',
          false
        ),
        (
          'backend_auth',
          'player_rating_states',
          'backend_auth_owner',
          'backend_auth_app',
          'SELECT',
          false
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
        coalesce(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) acl_row
      join pg_catalog.pg_roles grantor on grantor.oid = acl_row.grantor
      left join pg_catalog.pg_roles grantee on grantee.oid = acl_row.grantee
      where relation.oid = any (array[v_command_oid, v_rating_state_oid])
        and acl_row.grantee <> relation.relowner
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: admin rating table ACL differs';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app', v_command_oid, 'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app', v_command_oid, 'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_command_oid,
       'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     ) then
    raise exception 'POSTCHECK_FAILED: admin command privileges differ';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app', v_rating_state_oid, 'UPDATE'
     ) then
    raise exception 'POSTCHECK_FAILED: player_rating_states table UPDATE is unsafe';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_update_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = v_rating_state_oid
    and attribute.attnum > 0
    and not attribute.attisdropped
    and pg_catalog.has_column_privilege(
      'backend_auth_app',
      v_rating_state_oid,
      attribute.attname,
      'UPDATE'
    );

  if v_update_columns is distinct from
     array['rating', 'is_verified', 'updated_at']::text[] then
    raise exception 'POSTCHECK_FAILED: admin rating writer column boundary differs';
  end if;

  if exists (
    with expected(
      schema_name,
      table_name,
      column_name,
      grantor,
      grantee,
      privilege_type,
      is_grantable
    ) as (
      values
        (
          'backend_auth', 'player_rating_states', 'account_id',
          'backend_auth_owner', 'backend_auth_app', 'INSERT', false
        ),
        (
          'backend_auth', 'player_rating_states', 'rating',
          'backend_auth_owner', 'backend_auth_app', 'UPDATE', false
        ),
        (
          'backend_auth', 'player_rating_states', 'is_verified',
          'backend_auth_owner', 'backend_auth_app', 'UPDATE', false
        ),
        (
          'backend_auth', 'player_rating_states', 'created_at',
          'backend_auth_owner', 'backend_auth_app', 'INSERT', false
        ),
        (
          'backend_auth', 'player_rating_states', 'updated_at',
          'backend_auth_owner', 'backend_auth_app', 'INSERT', false
        ),
        (
          'backend_auth', 'player_rating_states', 'updated_at',
          'backend_auth_owner', 'backend_auth_app', 'UPDATE', false
        )
    ), actual as (
      select
        namespace.nspname::text,
        relation.relname::text,
        attribute.attname::text,
        grantor.rolname::text,
        case
          when acl_row.grantee = 0 then 'PUBLIC'::text
          else grantee.rolname::text
        end,
        acl_row.privilege_type::text,
        acl_row.is_grantable
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      cross join lateral pg_catalog.aclexplode(attribute.attacl) acl_row
      join pg_catalog.pg_roles grantor on grantor.oid = acl_row.grantor
      left join pg_catalog.pg_roles grantee on grantee.oid = acl_row.grantee
      where attribute.attrelid = any (array[v_command_oid, v_rating_state_oid])
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: admin rating column ACL differs';
  end if;

  if exists (select 1 from backend_auth.player_rating_admin_commands) then
    raise exception 'POSTCHECK_FAILED: admin command storage is not empty';
  end if;

  if (select pg_catalog.count(*) from backend_auth.player_profiles) <>
     (select pg_catalog.count(*) from backend_auth.player_rating_states) then
    raise exception 'POSTCHECK_FAILED: player rating state coverage differs';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '027_backend_admin_rating_state',
  'backend_auth_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', (
      select pg_catalog.count(*)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth' and relation.relkind = 'r'
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
    'player_rating_states', (
      select pg_catalog.count(*) from backend_auth.player_rating_states
    ),
    'player_rating_admin_commands', (
      select pg_catalog.count(*) from backend_auth.player_rating_admin_commands
    ),
    'match_rating_applications', (
      select pg_catalog.count(*) from backend_match.match_rating_applications
    ),
    'match_rating_changes', (
      select pg_catalog.count(*) from backend_match.match_rating_changes
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
    'match_rating_applications', backend_auth.relation_fingerprint(
      'backend_match.match_rating_applications'::pg_catalog.regclass
    ),
    'match_rating_changes', backend_auth.relation_fingerprint(
      'backend_match.match_rating_changes'::pg_catalog.regclass
    )
  )
) as backend_admin_rating_state_postcheck;

rollback;
