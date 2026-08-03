-- Read-only postcheck for 029_backend_match_notifications.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_relation record;
  v_notification_oid oid := pg_catalog.to_regclass(
    'backend_match.match_notifications'
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

  if pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_match'
     )) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_auth'
     )) <> 'backend_auth_owner' then
    raise exception 'POSTCHECK_FAILED: backend schema boundary differs';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_auth', 'accounts', '015_backend_auth_foundation'),
      ('backend_match', 'matches', '023_backend_match_description_updates'),
      ('backend_match', 'match_waitlist_entries', '024_backend_match_waitlist')
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

  if v_notification_oid is null
     or not exists (
       select 1
       from pg_catalog.pg_class relation
       join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
       where relation.oid = v_notification_oid
         and namespace.nspname = 'backend_match'
         and relation.relname = 'match_notifications'
         and relation.relkind = 'r'
         and relation.relpersistence = 'p'
         and not relation.relrowsecurity
         and not relation.relforcerowsecurity
         and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
         and pg_catalog.obj_description(relation.oid, 'pg_class') =
           '029_backend_match_notifications:'
             || backend_auth.relation_fingerprint(relation.oid::pg_catalog.regclass)
     ) then
    raise exception 'POSTCHECK_FAILED: migration 029 relation metadata differs';
  end if;

  if pg_catalog.has_schema_privilege('backend_auth_app', 'backend_match', 'CREATE')
     or pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'CREATE') then
    raise exception 'POSTCHECK_FAILED: application schema CREATE is unsafe';
  end if;

  if exists (
    with expected(
      column_name,
      ordinal_position,
      data_type,
      not_null,
      identity_kind,
      generated_kind,
      default_expression
    ) as (
      values
        ('id', 1, 'uuid', true, '', '', null::text),
        ('waitlist_entry_id', 2, 'uuid', true, '', '', null::text),
        ('match_id', 3, 'uuid', true, '', '', null::text),
        ('recipient_account_id', 4, 'uuid', true, '', '', null::text),
        ('notification_type', 5, 'text', true, '', '', null::text),
        ('created_at', 6, 'bigint', true, '', '', null::text),
        ('read_at', 7, 'bigint', false, '', '', null::text),
        ('version', 8, 'bigint', true, '', '', null::text)
    ), actual as (
      select
        attribute.attname::text,
        attribute.attnum::integer,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)::text,
        attribute.attnotnull,
        attribute.attidentity::text,
        attribute.attgenerated::text,
        pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid, true)::text
      from pg_catalog.pg_attribute attribute
      left join pg_catalog.pg_attrdef default_row
        on default_row.adrelid = attribute.attrelid
       and default_row.adnum = attribute.attnum
      where attribute.attrelid = v_notification_oid
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: notification column allowlist differs';
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
          'match_notifications_pkey', 'p', array['id']::text[],
          null::text, null::text[], false, false, true,
          'primary key (id)'
        ),
        (
          'match_notifications_waitlist_entry_key', 'u',
          array['waitlist_entry_id']::text[],
          null::text, null::text[], false, false, true,
          'unique (waitlist_entry_id)'
        ),
        (
          'match_notifications_waitlist_entry_binding_fkey', 'f',
          array['waitlist_entry_id', 'match_id', 'recipient_account_id']::text[],
          'backend_match.match_waitlist_entries',
          array['id', 'match_id', 'account_id']::text[], false, false, true,
          'foreign key (waitlist_entry_id, match_id, recipient_account_id) references backend_match.match_waitlist_entries(id, match_id, account_id)'
        ),
        (
          'match_notifications_type_check', 'c',
          array['notification_type']::text[],
          null::text, null::text[], false, false, true,
          'check (notification_type = ''waitlist_promoted''::text)'
        ),
        (
          'match_notifications_time_check', 'c',
          array['created_at', 'read_at']::text[],
          null::text, null::text[], false, false, true,
          'check (created_at >= 0 and created_at <= ''9007199254740991''::bigint and (read_at is null or read_at >= created_at and read_at <= ''9007199254740991''::bigint))'
        ),
        (
          'match_notifications_version_check', 'c', array['version']::text[],
          null::text, null::text[], false, false, true,
          'check (version = 1 or version = 2)'
        ),
        (
          'match_notifications_read_shape_check', 'c',
          array['read_at', 'version']::text[],
          null::text, null::text[], false, false, true,
          'check (read_at is null and version = 1 or read_at is not null and version = 2)'
        )
    ), actual as (
      select
        constraint_row.conname::text,
        constraint_row.contype::text,
        case
          when constraint_row.conkey is null then null::text[]
          else array(
            select attribute.attname::text
            from pg_catalog.unnest(constraint_row.conkey)
              with ordinality key(attnum, position)
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
            from pg_catalog.unnest(constraint_row.confkey)
              with ordinality key(attnum, position)
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
      where constraint_row.conrelid = v_notification_oid
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: notification constraint allowlist differs';
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
          'match_notifications_pkey', 'btree', true, true,
          array['id']::text[], '0', null::text
        ),
        (
          'match_notifications_waitlist_entry_key', 'btree', true, false,
          array['waitlist_entry_id']::text[], '0', null::text
        ),
        (
          'match_notifications_recipient_feed_idx', 'btree', false, false,
          array['recipient_account_id', 'created_at', 'id']::text[],
          '0 3 3', null::text
        ),
        (
          'match_notifications_recipient_unread_idx', 'btree', false, false,
          array['recipient_account_id', 'created_at', 'id']::text[],
          '0 3 3', 'read_at is null'
        )
    ), actual as (
      select
        index_relation.relname::text,
        access_method.amname::text,
        index_row.indisunique,
        index_row.indisprimary,
        array(
          select pg_catalog.pg_get_indexdef(
            index_row.indexrelid, position, true
          )::text
          from pg_catalog.generate_series(1, index_row.indnkeyatts) position
          order by position
        ),
        index_row.indoption::text,
        pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(
          pg_catalog.pg_get_expr(
            index_row.indpred, index_row.indrelid, true
          ),
          '[[:space:]]+', ' ', 'g'
        )))::text
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_relation
        on index_relation.oid = index_row.indexrelid
      join pg_catalog.pg_am access_method on access_method.oid = index_relation.relam
      where index_row.indrelid = v_notification_oid
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: notification index allowlist differs';
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
          'backend_match', 'match_notifications',
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
      where relation.oid = v_notification_oid
        and acl_row.grantee <> relation.relowner
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: notification table ACL differs';
  end if;

  if exists (
    with expected(
      column_name,
      grantor,
      grantee,
      privilege_type,
      is_grantable
    ) as (
      values
        ('id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        ('waitlist_entry_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        ('match_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        ('recipient_account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        ('notification_type', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        ('created_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        ('version', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        ('read_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        ('version', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false)
    ), actual as (
      select
        attribute.attname::text,
        grantor.rolname::text,
        case
          when acl_row.grantee = 0 then 'PUBLIC'::text
          else grantee.rolname::text
        end,
        acl_row.privilege_type::text,
        acl_row.is_grantable
      from pg_catalog.pg_attribute attribute
      cross join lateral pg_catalog.aclexplode(attribute.attacl) acl_row
      join pg_catalog.pg_roles grantor on grantor.oid = acl_row.grantor
      left join pg_catalog.pg_roles grantee on grantee.oid = acl_row.grantee
      where attribute.attrelid = v_notification_oid
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: notification column ACL differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = v_notification_oid
      and not trigger_row.tgisinternal
  ) then
    raise exception 'POSTCHECK_FAILED: notification relation has an unexpected trigger';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app', v_notification_oid, 'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_notification_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_notification_oid, 'id', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_notification_oid, 'waitlist_entry_id', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_notification_oid, 'match_id', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_notification_oid, 'recipient_account_id', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_notification_oid, 'notification_type', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_notification_oid, 'created_at', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_notification_oid, 'version', 'INSERT'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', v_notification_oid, 'read_at', 'INSERT'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_notification_oid, 'read_at', 'UPDATE'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_notification_oid, 'version', 'UPDATE'
     )
     or exists (
       select 1
       from pg_catalog.pg_attribute attribute
       where attribute.attrelid = v_notification_oid
         and attribute.attnum > 0
         and not attribute.attisdropped
         and attribute.attname <> all (array['read_at', 'version']::name[])
         and pg_catalog.has_column_privilege(
           'backend_auth_app', v_notification_oid, attribute.attname, 'UPDATE'
         )
     ) then
    raise exception 'POSTCHECK_FAILED: notification effective privileges differ';
  end if;

  if exists (select 1 from backend_match.match_notifications) then
    raise exception 'POSTCHECK_FAILED: notification storage is not empty';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '029_backend_match_notifications',
  'backend_match_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', (
      select pg_catalog.count(*)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match' and relation.relkind = 'r'
    ),
    'constraints', (
      select pg_catalog.count(*)
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
    ),
    'indexes', (
      select pg_catalog.count(*)
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
    ),
    'user_triggers', (
      select pg_catalog.count(*)
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match' and not trigger_row.tgisinternal
    )
  ),
  'row_counts', pg_catalog.jsonb_build_object(
    'accounts', (select pg_catalog.count(*) from backend_auth.accounts),
    'matches', (select pg_catalog.count(*) from backend_match.matches),
    'match_waitlist_entries', (
      select pg_catalog.count(*) from backend_match.match_waitlist_entries
    ),
    'match_notifications', (
      select pg_catalog.count(*) from backend_match.match_notifications
    )
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'accounts', backend_auth.relation_fingerprint(
      'backend_auth.accounts'::pg_catalog.regclass
    ),
    'matches', backend_auth.relation_fingerprint(
      'backend_match.matches'::pg_catalog.regclass
    ),
    'match_waitlist_entries', backend_auth.relation_fingerprint(
      'backend_match.match_waitlist_entries'::pg_catalog.regclass
    ),
    'match_notifications', backend_auth.relation_fingerprint(
      'backend_match.match_notifications'::pg_catalog.regclass
    )
  )
) as backend_match_notifications_postcheck;

rollback;
