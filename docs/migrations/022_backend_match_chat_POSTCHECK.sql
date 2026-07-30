-- Read-only postcheck for 022_backend_match_chat.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_messages_oid oid :=
    pg_catalog.to_regclass('backend_match.match_messages');
  v_commands_oid oid :=
    pg_catalog.to_regclass('backend_match.match_message_commands');
  v_difference_count bigint;
  v_table text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'POSTCHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if v_messages_oid is null
     or v_commands_oid is null
     or pg_catalog.to_regclass('backend_match.matches') is null
     or pg_catalog.to_regclass('backend_auth.accounts') is null
     or pg_catalog.to_regclass('backend_auth.player_profiles') is null then
    raise exception 'POSTCHECK_FAILED: required relation is missing';
  end if;

  foreach v_table in array array[
    'match_messages',
    'match_message_commands'
  ]::text[]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'backend_match'
        and c.relname = v_table
        and c.relkind = 'r'
        and pg_catalog.pg_get_userbyid(c.relowner) =
          'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '022_backend_match_chat:'
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'POSTCHECK_FAILED: backend_match.% structure, owner, or fingerprint differs',
        v_table;
    end if;
  end loop;

  foreach v_table in array array[
    'matches',
    'match_participants',
    'match_commands'
  ]::text[]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'backend_match'
        and c.relname = v_table
        and c.relkind = 'r'
        and pg_catalog.pg_get_userbyid(c.relowner) =
          'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '020_backend_match_storage:'
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'POSTCHECK_FAILED: backend_match.% changed from migration 020',
        v_table;
    end if;
  end loop;

  foreach v_table in array array[
    'match_invitations',
    'match_invitation_commands'
  ]::text[]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'backend_match'
        and c.relname = v_table
        and c.relkind = 'r'
        and pg_catalog.pg_get_userbyid(c.relowner) =
          'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '021_backend_match_invitations:'
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'POSTCHECK_FAILED: backend_match.% changed from migration 021',
        v_table;
    end if;
  end loop;

  with expected(
    table_name,
    ordinal_position,
    column_name,
    data_type,
    is_not_null,
    identity_kind,
    generated_kind,
    default_expression
  ) as (
    values
      ('match_messages', 1, 'id', 'uuid', true, '', '', null),
      ('match_messages', 2, 'match_id', 'uuid', true, '', '', null),
      ('match_messages', 3, 'sender_account_id', 'uuid', true, '', '', null),
      ('match_messages', 4, 'body', 'text', true, '', '', null),
      ('match_messages', 5, 'created_at', 'bigint', true, '', '', null),
      ('match_message_commands', 1, 'command_id', 'uuid', true, '', '', null),
      ('match_message_commands', 2, 'message_id', 'uuid', true, '', '', null),
      ('match_message_commands', 3, 'match_id', 'uuid', true, '', '', null),
      ('match_message_commands', 4, 'actor_account_id', 'uuid', true, '', '', null),
      ('match_message_commands', 5, 'request_digest', 'bytea', true, '', '', null),
      ('match_message_commands', 6, 'command_type', 'text', true, '', '', null),
      ('match_message_commands', 7, 'result_type', 'text', true, '', '', null),
      ('match_message_commands', 8, 'applied_at', 'bigint', true, '', '', null)
  ),
  actual as (
    select
      relation.relname::text,
      attribute.attnum::integer,
      attribute.attname::text,
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      attribute.attnotnull,
      attribute.attidentity::text,
      attribute.attgenerated::text,
      pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid, true)
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation
      on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    left join pg_catalog.pg_attrdef default_row
      on default_row.adrelid = attribute.attrelid
     and default_row.adnum = attribute.attnum
    where namespace.nspname = 'backend_match'
      and relation.relname in (
        'match_messages',
        'match_message_commands'
      )
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count
  from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: chat columns or defaults differ';
  end if;

  with expected(
    table_name,
    constraint_name,
    constraint_type,
    referenced_schema,
    referenced_table,
    constrained_columns,
    referenced_columns,
    update_action,
    delete_action,
    match_type,
    is_deferrable,
    is_deferred,
    is_validated
  ) as (
    values
      ('match_messages', 'match_messages_pkey', 'p', null, null, array['id'], null, null, null, null, false, false, true),
      ('match_messages', 'match_messages_identity_key', 'u', null, null, array['id', 'match_id', 'sender_account_id'], null, null, null, null, false, false, true),
      ('match_messages', 'match_messages_match_id_fkey', 'f', 'backend_match', 'matches', array['match_id'], array['id'], 'a', 'a', 's', false, false, true),
      ('match_messages', 'match_messages_sender_account_id_fkey', 'f', 'backend_auth', 'player_profiles', array['sender_account_id'], array['account_id'], 'a', 'a', 's', false, false, true),
      ('match_messages', 'match_messages_body_check', 'c', null, null, array['body'], null, null, null, null, false, false, true),
      ('match_messages', 'match_messages_created_at_check', 'c', null, null, array['created_at'], null, null, null, null, false, false, true),
      ('match_message_commands', 'match_message_commands_pkey', 'p', null, null, array['command_id'], null, null, null, null, false, false, true),
      ('match_message_commands', 'match_message_commands_message_match_key', 'u', null, null, array['message_id', 'match_id'], null, null, null, null, false, false, true),
      ('match_message_commands', 'match_message_commands_message_actor_fkey', 'f', 'backend_match', 'match_messages', array['message_id', 'match_id', 'actor_account_id'], array['id', 'match_id', 'sender_account_id'], 'a', 'a', 's', false, false, true),
      ('match_message_commands', 'match_message_commands_request_digest_check', 'c', null, null, array['request_digest'], null, null, null, null, false, false, true),
      ('match_message_commands', 'match_message_commands_result_shape_check', 'c', null, null, array['command_type', 'result_type'], null, null, null, null, false, false, true),
      ('match_message_commands', 'match_message_commands_applied_at_check', 'c', null, null, array['applied_at'], null, null, null, null, false, false, true)
  ),
  actual as (
    select
      relation.relname::text,
      constraint_row.conname::text,
      constraint_row.contype::text,
      referenced_namespace.nspname::text,
      referenced_relation.relname::text,
      (
        select pg_catalog.array_agg(
          attribute.attname::text
          order by
            case
              when constraint_row.contype = 'c'
                then attribute.attname::text
            end,
            key_column.position
        )
        from pg_catalog.unnest(constraint_row.conkey)
          with ordinality key_column(attnum, position)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = key_column.attnum
      ),
      (
        select pg_catalog.array_agg(
          attribute.attname::text
          order by key_column.position
        )
        from pg_catalog.unnest(constraint_row.confkey)
          with ordinality key_column(attnum, position)
        join pg_catalog.pg_attribute attribute
          on attribute.attrelid = constraint_row.confrelid
         and attribute.attnum = key_column.attnum
      ),
      case when constraint_row.contype = 'f' then constraint_row.confupdtype::text end,
      case when constraint_row.contype = 'f' then constraint_row.confdeltype::text end,
      case when constraint_row.contype = 'f' then constraint_row.confmatchtype::text end,
      constraint_row.condeferrable,
      constraint_row.condeferred,
      constraint_row.convalidated
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class relation
      on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    left join pg_catalog.pg_class referenced_relation
      on referenced_relation.oid = constraint_row.confrelid
    left join pg_catalog.pg_namespace referenced_namespace
      on referenced_namespace.oid = referenced_relation.relnamespace
    where namespace.nspname = 'backend_match'
      and relation.relname in (
        'match_messages',
        'match_message_commands'
      )
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count
  from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: chat constraint allowlist differs';
  end if;

  with expected(table_name, constraint_name, normalized_definition) as (
    values
      ('match_messages', 'match_messages_body_check', 'check (char_length(body) >= 1 and char_length(body) <= 2000 and body !~ ''^[[:space:]]''::text and body !~ ''[[:space:]]$''::text)'),
      ('match_messages', 'match_messages_created_at_check', 'check (created_at >= 0 and created_at <= ''9007199254740991''::bigint)'),
      ('match_message_commands', 'match_message_commands_request_digest_check', 'check (octet_length(request_digest) = 32)'),
      ('match_message_commands', 'match_message_commands_result_shape_check', 'check (command_type = ''send_message''::text and result_type = ''message_sent''::text)'),
      ('match_message_commands', 'match_message_commands_applied_at_check', 'check (applied_at >= 0 and applied_at <= ''9007199254740991''::bigint)')
  ),
  actual as (
    select
      relation.relname::text,
      constraint_row.conname::text,
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.lower(
            pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
          ),
          '[[:space:]]+',
          ' ',
          'g'
        )
      )
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class relation
      on relation.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_match'
      and relation.relname in (
        'match_messages',
        'match_message_commands'
      )
      and constraint_row.contype = 'c'
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count
  from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: chat CHECK definitions differ';
  end if;

  with expected(
    table_name,
    index_name,
    access_method,
    is_unique,
    is_primary,
    indexed_columns,
    ordering_options,
    normalized_predicate
  ) as (
    values
      ('match_messages', 'match_messages_pkey', 'btree', true, true, array['id'], '0', null),
      ('match_messages', 'match_messages_identity_key', 'btree', true, false, array['id', 'match_id', 'sender_account_id'], '0 0 0', null),
      ('match_messages', 'match_messages_match_created_idx', 'btree', false, false, array['match_id', 'created_at', 'id'], '0 3 3', null),
      ('match_messages', 'match_messages_sender_created_idx', 'btree', false, false, array['sender_account_id', 'created_at', 'id'], '0 3 0', null),
      ('match_message_commands', 'match_message_commands_pkey', 'btree', true, true, array['command_id'], '0', null),
      ('match_message_commands', 'match_message_commands_message_match_key', 'btree', true, false, array['message_id', 'match_id'], '0 0', null),
      ('match_message_commands', 'match_message_commands_actor_applied_idx', 'btree', false, false, array['actor_account_id', 'applied_at', 'command_id'], '0 3 0', null)
  ),
  actual as (
    select
      relation.relname::text,
      index_relation.relname::text,
      access_method.amname::text,
      index_row.indisunique,
      index_row.indisprimary,
      (
        select pg_catalog.array_agg(
          pg_catalog.pg_get_indexdef(
            index_row.indexrelid,
            position,
            true
          )
          order by position
        )
        from pg_catalog.generate_series(
          1,
          index_row.indnkeyatts
        ) position
      ),
      index_row.indoption::text,
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.lower(
            pg_catalog.pg_get_expr(
              index_row.indpred,
              index_row.indrelid,
              true
            )
          ),
          '[[:space:]]+',
          ' ',
          'g'
        )
      )
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class relation
      on relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where namespace.nspname = 'backend_match'
      and relation.relname in (
        'match_messages',
        'match_message_commands'
      )
      and index_row.indisvalid
      and index_row.indisready
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count
  from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: chat index allowlist differs';
  end if;

  with expected(
    schema_name,
    table_name,
    grantor,
    grantee,
    privilege_type,
    is_grantable
  ) as (
    values
      ('backend_match', 'match_messages', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
      ('backend_match', 'match_message_commands', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false)
  ),
  actual as (
    select
      namespace.nspname::text,
      relation.relname::text,
      grantor.rolname::text,
      case
        when acl.grantee = 0 then 'PUBLIC'::text
        else grantee.rolname::text
      end,
      acl.privilege_type::text,
      acl.is_grantable
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) acl
    join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
    left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where namespace.nspname = 'backend_match'
      and relation.relname in (
        'match_messages',
        'match_message_commands'
      )
      and acl.grantee <> relation.relowner
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count
  from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: chat table ACL differs';
  end if;

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
      ('backend_match', 'match_messages', 'id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_messages', 'match_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_messages', 'sender_account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_messages', 'body', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_messages', 'created_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_message_commands', 'command_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_message_commands', 'message_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_message_commands', 'match_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_message_commands', 'actor_account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_message_commands', 'request_digest', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_message_commands', 'command_type', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_message_commands', 'result_type', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_message_commands', 'applied_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false)
  ),
  actual as (
    select
      namespace.nspname::text,
      relation.relname::text,
      attribute.attname::text,
      grantor.rolname::text,
      case
        when acl.grantee = 0 then 'PUBLIC'::text
        else grantee.rolname::text
      end,
      acl.privilege_type::text,
      acl.is_grantable
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation
      on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
    join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
    left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where namespace.nspname = 'backend_match'
      and relation.relname in (
        'match_messages',
        'match_message_commands'
      )
      and attribute.attnum > 0
      and not attribute.attisdropped
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count
  from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: chat column ACL differs';
  end if;

  if not pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'USAGE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'CREATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_messages_oid,
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_messages_oid,
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_messages_oid,
       'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_commands_oid,
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_commands_oid,
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_commands_oid,
       'DELETE'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_messages_oid,
       'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_commands_oid,
       'SELECT'
     ) then
    raise exception 'POSTCHECK_FAILED: effective chat privileges differ';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_class relation
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
         and relation.relkind = 'r'
     ) <> 7
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       join pg_catalog.pg_class relation
         on relation.oid = constraint_row.conrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
     ) <> 70
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_class relation
         on relation.oid = index_row.indrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
     ) <> 29
     or exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       join pg_catalog.pg_class relation
         on relation.oid = trigger_row.tgrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
         and not trigger_row.tgisinternal
     ) then
    raise exception 'POSTCHECK_FAILED: backend_match catalog counts differ';
  end if;

  if (select pg_catalog.count(*) from backend_match.match_messages) <> 0
     or (
       select pg_catalog.count(*)
       from backend_match.match_message_commands
     ) <> 0 then
    raise exception 'POSTCHECK_FAILED: migration 022 relations are not empty';
  end if;
end;
$postcheck$;

with backend_match_relation_state as (
  select
    relation.relname as table_name,
    backend_auth.relation_fingerprint(
      relation.oid::pg_catalog.regclass
    ) as fingerprint
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'backend_match'
    and relation.relkind = 'r'
)
select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '022_backend_match_chat',
  'backend_match_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', 7,
    'constraints', 70,
    'indexes', 29,
    'user_triggers', 0
  ),
  'backend_match_row_counts', pg_catalog.jsonb_build_object(
    'matches', (select pg_catalog.count(*) from backend_match.matches),
    'match_participants',
      (select pg_catalog.count(*) from backend_match.match_participants),
    'match_commands',
      (select pg_catalog.count(*) from backend_match.match_commands),
    'match_invitations',
      (select pg_catalog.count(*) from backend_match.match_invitations),
    'match_invitation_commands',
      (
        select pg_catalog.count(*)
        from backend_match.match_invitation_commands
      ),
    'match_messages',
      (select pg_catalog.count(*) from backend_match.match_messages),
    'match_message_commands',
      (
        select pg_catalog.count(*)
        from backend_match.match_message_commands
      )
  ),
  'backend_match_relation_fingerprints', (
    select pg_catalog.jsonb_object_agg(
      table_name,
      fingerprint
      order by table_name
    )
    from backend_match_relation_state
  )
) as postcheck;

rollback;
