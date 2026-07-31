-- Read-only postcheck for 024_backend_match_waitlist.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_entries_oid oid :=
    pg_catalog.to_regclass('backend_match.match_waitlist_entries');
  v_commands_oid oid :=
    pg_catalog.to_regclass('backend_match.match_waitlist_commands');
  v_matches_oid oid :=
    pg_catalog.to_regclass('backend_match.matches');
  v_accounts_oid oid :=
    pg_catalog.to_regclass('backend_auth.accounts');
  v_participants_oid oid :=
    pg_catalog.to_regclass('backend_match.match_participants');
  v_difference_count bigint;
  v_table text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'POSTCHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if v_entries_oid is null
     or v_commands_oid is null
     or v_matches_oid is null
     or v_accounts_oid is null
     or v_participants_oid is null then
    raise exception 'POSTCHECK_FAILED: required relation is missing';
  end if;

  foreach v_table in array array[
    'match_waitlist_entries',
    'match_waitlist_commands'
  ]::text[]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'backend_match'
        and c.relname = v_table
        and c.relkind = 'r'
        and c.relpersistence = 'p'
        and not c.relrowsecurity
        and not c.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '024_backend_match_waitlist:'
            || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
    ) then
      raise exception 'POSTCHECK_FAILED: backend_match.% structure, mode, owner, or fingerprint differs',
        v_table;
    end if;
  end loop;

  foreach v_table in array array[
    'matches',
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
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '023_backend_match_description_updates:'
            || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
    ) then
      raise exception 'POSTCHECK_FAILED: backend_match.% changed from migration 023',
        v_table;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'backend_match'
      and c.relname = 'match_participants'
      and c.relkind = 'r'
      and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
      and pg_catalog.obj_description(c.oid, 'pg_class') =
        '020_backend_match_storage:'
          || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
  ) then
    raise exception 'POSTCHECK_FAILED: backend_match.match_participants changed from migration 020';
  end if;

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
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '021_backend_match_invitations:'
            || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
    ) then
      raise exception 'POSTCHECK_FAILED: backend_match.% changed from migration 021',
        v_table;
    end if;
  end loop;

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
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '022_backend_match_chat:'
            || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
    ) then
      raise exception 'POSTCHECK_FAILED: backend_match.% changed from migration 022',
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
      ('match_waitlist_entries', 1, 'id', 'uuid', true, '', '', null),
      ('match_waitlist_entries', 2, 'match_id', 'uuid', true, '', '', null),
      ('match_waitlist_entries', 3, 'account_id', 'uuid', true, '', '', null),
      ('match_waitlist_entries', 4, 'status', 'text', true, '', '', null),
      ('match_waitlist_entries', 5, 'joined_at', 'bigint', true, '', '', null),
      ('match_waitlist_entries', 6, 'updated_at', 'bigint', true, '', '', null),
      ('match_waitlist_entries', 7, 'resolved_at', 'bigint', false, '', '', null),
      ('match_waitlist_entries', 8, 'version', 'bigint', true, '', '', null),
      ('match_waitlist_commands', 1, 'command_id', 'uuid', true, '', '', null),
      ('match_waitlist_commands', 2, 'entry_id', 'uuid', true, '', '', null),
      ('match_waitlist_commands', 3, 'match_id', 'uuid', true, '', '', null),
      ('match_waitlist_commands', 4, 'actor_account_id', 'uuid', true, '', '', null),
      ('match_waitlist_commands', 5, 'request_digest', 'bytea', true, '', '', null),
      ('match_waitlist_commands', 6, 'command_type', 'text', true, '', '', null),
      ('match_waitlist_commands', 7, 'result_type', 'text', true, '', '', null),
      ('match_waitlist_commands', 8, 'applied_at', 'bigint', true, '', '', null),
      ('match_waitlist_commands', 9, 'entry_status', 'text', true, '', '', null),
      ('match_waitlist_commands', 10, 'entry_version', 'bigint', true, '', '', null)
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
        'match_waitlist_entries',
        'match_waitlist_commands'
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
    raise exception 'POSTCHECK_FAILED: waitlist columns or defaults differ';
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
      ('match_waitlist_entries', 'match_waitlist_entries_pkey', 'p', null, null, array['id'], null, null, null, null, false, false, true),
      ('match_waitlist_entries', 'match_waitlist_entries_identity_key', 'u', null, null, array['id', 'match_id', 'account_id'], null, null, null, null, false, false, true),
      ('match_waitlist_entries', 'match_waitlist_entries_match_id_fkey', 'f', 'backend_match', 'matches', array['match_id'], array['id'], 'a', 'a', 's', false, false, true),
      ('match_waitlist_entries', 'match_waitlist_entries_account_id_fkey', 'f', 'backend_auth', 'accounts', array['account_id'], array['id'], 'a', 'a', 's', false, false, true),
      ('match_waitlist_entries', 'match_waitlist_entries_status_check', 'c', null, null, array['status'], null, null, null, null, false, false, true),
      ('match_waitlist_entries', 'match_waitlist_entries_time_check', 'c', null, null, array['joined_at', 'resolved_at', 'updated_at'], null, null, null, null, false, false, true),
      ('match_waitlist_entries', 'match_waitlist_entries_version_check', 'c', null, null, array['version'], null, null, null, null, false, false, true),
      ('match_waitlist_entries', 'match_waitlist_entries_lifecycle_shape_check', 'c', null, null, array['resolved_at', 'status', 'version'], null, null, null, null, false, false, true),
      ('match_waitlist_commands', 'match_waitlist_commands_pkey', 'p', null, null, array['command_id'], null, null, null, null, false, false, true),
      ('match_waitlist_commands', 'match_waitlist_commands_entry_binding_fkey', 'f', 'backend_match', 'match_waitlist_entries', array['entry_id', 'match_id', 'actor_account_id'], array['id', 'match_id', 'account_id'], 'a', 'a', 's', false, false, true),
      ('match_waitlist_commands', 'match_waitlist_commands_request_digest_check', 'c', null, null, array['request_digest'], null, null, null, null, false, false, true),
      ('match_waitlist_commands', 'match_waitlist_commands_command_type_check', 'c', null, null, array['command_type'], null, null, null, null, false, false, true),
      ('match_waitlist_commands', 'match_waitlist_commands_result_type_check', 'c', null, null, array['result_type'], null, null, null, null, false, false, true),
      ('match_waitlist_commands', 'match_waitlist_commands_applied_at_check', 'c', null, null, array['applied_at'], null, null, null, null, false, false, true),
      ('match_waitlist_commands', 'match_waitlist_commands_entry_status_check', 'c', null, null, array['entry_status'], null, null, null, null, false, false, true),
      ('match_waitlist_commands', 'match_waitlist_commands_entry_version_check', 'c', null, null, array['entry_version'], null, null, null, null, false, false, true),
      ('match_waitlist_commands', 'match_waitlist_commands_result_shape_check', 'c', null, null, array['command_type', 'entry_status', 'entry_version', 'result_type'], null, null, null, null, false, false, true)
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
        'match_waitlist_entries',
        'match_waitlist_commands'
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
    raise exception 'POSTCHECK_FAILED: waitlist constraint allowlist differs';
  end if;

  with expected(table_name, constraint_name, normalized_definition) as (
    values
      ('match_waitlist_entries', 'match_waitlist_entries_status_check', 'check (status = ''waiting''::text or status = ''promoted''::text or status = ''left''::text or status = ''skipped''::text)'),
      ('match_waitlist_entries', 'match_waitlist_entries_time_check', 'check (joined_at >= 0 and joined_at <= ''9007199254740991''::bigint and updated_at >= joined_at and updated_at <= ''9007199254740991''::bigint and (resolved_at is null or resolved_at >= joined_at and resolved_at <= updated_at))'),
      ('match_waitlist_entries', 'match_waitlist_entries_version_check', 'check (version = 1 or version = 2)'),
      ('match_waitlist_entries', 'match_waitlist_entries_lifecycle_shape_check', 'check (status = ''waiting''::text and resolved_at is null and version = 1 or status <> ''waiting''::text and resolved_at is not null and version = 2)'),
      ('match_waitlist_commands', 'match_waitlist_commands_request_digest_check', 'check (octet_length(request_digest) = 32)'),
      ('match_waitlist_commands', 'match_waitlist_commands_command_type_check', 'check (command_type = ''join_waitlist''::text or command_type = ''leave_waitlist''::text)'),
      ('match_waitlist_commands', 'match_waitlist_commands_result_type_check', 'check (result_type = ''waitlist_joined''::text or result_type = ''waitlist_left''::text)'),
      ('match_waitlist_commands', 'match_waitlist_commands_applied_at_check', 'check (applied_at >= 0 and applied_at <= ''9007199254740991''::bigint)'),
      ('match_waitlist_commands', 'match_waitlist_commands_entry_status_check', 'check (entry_status = ''waiting''::text or entry_status = ''left''::text)'),
      ('match_waitlist_commands', 'match_waitlist_commands_entry_version_check', 'check (entry_version = 1 or entry_version = 2)'),
      ('match_waitlist_commands', 'match_waitlist_commands_result_shape_check', 'check (command_type = ''join_waitlist''::text and result_type = ''waitlist_joined''::text and entry_status = ''waiting''::text and entry_version = 1 or command_type = ''leave_waitlist''::text and result_type = ''waitlist_left''::text and entry_status = ''left''::text and entry_version = 2)')
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
        'match_waitlist_entries',
        'match_waitlist_commands'
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
    raise exception 'POSTCHECK_FAILED: waitlist CHECK definitions differ';
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
      ('match_waitlist_entries', 'match_waitlist_entries_pkey', 'btree', true, true, array['id'], '0', null),
      ('match_waitlist_entries', 'match_waitlist_entries_identity_key', 'btree', true, false, array['id', 'match_id', 'account_id'], '0 0 0', null),
      ('match_waitlist_entries', 'match_waitlist_entries_one_waiting_account', 'btree', true, false, array['match_id', 'account_id'], '0 0', 'status = ''waiting''::text'),
      ('match_waitlist_entries', 'match_waitlist_entries_fifo_idx', 'btree', false, false, array['match_id', 'joined_at', 'id'], '0 0 0', 'status = ''waiting''::text'),
      ('match_waitlist_entries', 'match_waitlist_entries_match_history_idx', 'btree', false, false, array['match_id', 'joined_at', 'id'], '0 0 0', null),
      ('match_waitlist_entries', 'match_waitlist_entries_account_history_idx', 'btree', false, false, array['account_id', 'joined_at', 'id'], '0 3 0', null),
      ('match_waitlist_commands', 'match_waitlist_commands_pkey', 'btree', true, true, array['command_id'], '0', null),
      ('match_waitlist_commands', 'match_waitlist_commands_entry_applied_idx', 'btree', false, false, array['entry_id', 'applied_at', 'command_id'], '0 0 0', null),
      ('match_waitlist_commands', 'match_waitlist_commands_actor_applied_idx', 'btree', false, false, array['actor_account_id', 'applied_at', 'command_id'], '0 0 0', null)
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
        'match_waitlist_entries',
        'match_waitlist_commands'
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
    raise exception 'POSTCHECK_FAILED: waitlist index allowlist differs';
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
      ('backend_match', 'match_waitlist_entries', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
      ('backend_match', 'match_waitlist_commands', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false)
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
        'match_waitlist_entries',
        'match_waitlist_commands'
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
    raise exception 'POSTCHECK_FAILED: waitlist table ACL differs';
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
      ('backend_match', 'match_waitlist_entries', 'id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_entries', 'match_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_entries', 'account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_entries', 'status', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_entries', 'joined_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_entries', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_entries', 'version', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_entries', 'status', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_waitlist_entries', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_waitlist_entries', 'resolved_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_waitlist_entries', 'version', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_waitlist_commands', 'command_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_commands', 'entry_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_commands', 'match_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_commands', 'actor_account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_commands', 'request_digest', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_commands', 'command_type', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_commands', 'result_type', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_commands', 'applied_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_commands', 'entry_status', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_waitlist_commands', 'entry_version', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false)
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
        'match_waitlist_entries',
        'match_waitlist_commands'
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
    raise exception 'POSTCHECK_FAILED: waitlist column ACL differs';
  end if;

  if pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'CREATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_entries_oid,
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_entries_oid,
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_entries_oid,
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
       v_entries_oid,
       'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_commands_oid,
       'SELECT'
     ) then
    raise exception 'POSTCHECK_FAILED: effective waitlist privileges differ';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_class relation
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
         and relation.relkind = 'r'
     ) <> 9
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       join pg_catalog.pg_class relation
         on relation.oid = constraint_row.conrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
     ) <> 87
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_class relation
         on relation.oid = index_row.indrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
     ) <> 38
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

  if (select pg_catalog.count(*) from backend_match.match_waitlist_entries) <> 0
     or (
       select pg_catalog.count(*)
       from backend_match.match_waitlist_commands
     ) <> 0 then
    raise exception 'POSTCHECK_FAILED: migration 024 relations are not empty';
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
  'migration', '024_backend_match_waitlist',
  'backend_match_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', 9,
    'constraints', 87,
    'indexes', 38,
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
      ),
    'match_waitlist_entries',
      (select pg_catalog.count(*) from backend_match.match_waitlist_entries),
    'match_waitlist_commands',
      (
        select pg_catalog.count(*)
        from backend_match.match_waitlist_commands
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
