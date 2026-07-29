-- Read-only postcheck for 021_backend_match_invitations.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_invitations_oid oid :=
    pg_catalog.to_regclass('backend_match.match_invitations');
  v_commands_oid oid :=
    pg_catalog.to_regclass('backend_match.match_invitation_commands');
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

  if v_invitations_oid is null
     or v_commands_oid is null
     or v_matches_oid is null
     or v_accounts_oid is null
     or v_participants_oid is null then
    raise exception 'POSTCHECK_FAILED: required relation is missing';
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
        and pg_catalog.pg_get_userbyid(c.relowner) =
          'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '021_backend_match_invitations:'
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
      ('match_invitations', 1, 'id', 'uuid', true, '', '', null),
      ('match_invitations', 2, 'match_id', 'uuid', true, '', '', null),
      ('match_invitations', 3, 'invited_by_account_id', 'uuid', true, '', '', null),
      ('match_invitations', 4, 'invited_account_id', 'uuid', true, '', '', null),
      ('match_invitations', 5, 'slot_number', 'smallint', true, '', '', null),
      ('match_invitations', 6, 'status', 'text', true, '', '', null),
      ('match_invitations', 7, 'created_at', 'bigint', true, '', '', null),
      ('match_invitations', 8, 'updated_at', 'bigint', true, '', '', null),
      ('match_invitations', 9, 'responded_at', 'bigint', false, '', '', null),
      ('match_invitations', 10, 'version', 'bigint', true, '', '', null),
      ('match_invitation_commands', 1, 'command_id', 'uuid', true, '', '', null),
      ('match_invitation_commands', 2, 'invitation_id', 'uuid', true, '', '', null),
      ('match_invitation_commands', 3, 'match_id', 'uuid', true, '', '', null),
      ('match_invitation_commands', 4, 'actor_account_id', 'uuid', true, '', '', null),
      ('match_invitation_commands', 5, 'request_digest', 'bytea', true, '', '', null),
      ('match_invitation_commands', 6, 'command_type', 'text', true, '', '', null),
      ('match_invitation_commands', 7, 'result_type', 'text', true, '', '', null),
      ('match_invitation_commands', 8, 'applied_at', 'bigint', true, '', '', null),
      ('match_invitation_commands', 9, 'invitation_version', 'bigint', true, '', '', null),
      ('match_invitation_commands', 10, 'match_status', 'text', true, '', '', null),
      ('match_invitation_commands', 11, 'participant_id', 'uuid', false, '', '', null),
      ('match_invitation_commands', 12, 'match_version', 'bigint', false, '', '', null)
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
        'match_invitations',
        'match_invitation_commands'
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
    raise exception 'POSTCHECK_FAILED: invitation columns or defaults differ';
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
      ('match_invitations', 'match_invitations_pkey', 'p', null, null, array['id'], null, null, null, null, false, false, true),
      ('match_invitations', 'match_invitations_id_match_key', 'u', null, null, array['id', 'match_id'], null, null, null, null, false, false, true),
      ('match_invitations', 'match_invitations_match_id_fkey', 'f', 'backend_match', 'matches', array['match_id'], array['id'], 'a', 'a', 's', false, false, true),
      ('match_invitations', 'match_invitations_invited_by_account_id_fkey', 'f', 'backend_auth', 'accounts', array['invited_by_account_id'], array['id'], 'a', 'a', 's', false, false, true),
      ('match_invitations', 'match_invitations_invited_account_id_fkey', 'f', 'backend_auth', 'accounts', array['invited_account_id'], array['id'], 'a', 'a', 's', false, false, true),
      ('match_invitations', 'match_invitations_distinct_accounts_check', 'c', null, null, array['invited_account_id', 'invited_by_account_id'], null, null, null, null, false, false, true),
      ('match_invitations', 'match_invitations_slot_number_check', 'c', null, null, array['slot_number'], null, null, null, null, false, false, true),
      ('match_invitations', 'match_invitations_status_check', 'c', null, null, array['status'], null, null, null, null, false, false, true),
      ('match_invitations', 'match_invitations_time_check', 'c', null, null, array['created_at', 'responded_at', 'updated_at'], null, null, null, null, false, false, true),
      ('match_invitations', 'match_invitations_version_check', 'c', null, null, array['version'], null, null, null, null, false, false, true),
      ('match_invitations', 'match_invitations_terminal_shape_check', 'c', null, null, array['responded_at', 'status', 'version'], null, null, null, null, false, false, true),
      ('match_invitation_commands', 'match_invitation_commands_pkey', 'p', null, null, array['command_id'], null, null, null, null, false, false, true),
      ('match_invitation_commands', 'match_invitation_commands_invitation_match_fkey', 'f', 'backend_match', 'match_invitations', array['invitation_id', 'match_id'], array['id', 'match_id'], 'a', 'a', 's', false, false, true),
      ('match_invitation_commands', 'match_invitation_commands_actor_account_id_fkey', 'f', 'backend_auth', 'accounts', array['actor_account_id'], array['id'], 'a', 'a', 's', false, false, true),
      ('match_invitation_commands', 'match_invitation_commands_participant_id_fkey', 'f', 'backend_match', 'match_participants', array['participant_id'], array['id'], 'a', 'a', 's', false, false, true),
      ('match_invitation_commands', 'match_invitation_commands_request_digest_check', 'c', null, null, array['request_digest'], null, null, null, null, false, false, true),
      ('match_invitation_commands', 'match_invitation_commands_command_type_check', 'c', null, null, array['command_type'], null, null, null, null, false, false, true),
      ('match_invitation_commands', 'match_invitation_commands_result_type_check', 'c', null, null, array['result_type'], null, null, null, null, false, false, true),
      ('match_invitation_commands', 'match_invitation_commands_applied_at_check', 'c', null, null, array['applied_at'], null, null, null, null, false, false, true),
      ('match_invitation_commands', 'match_invitation_commands_invitation_version_check', 'c', null, null, array['invitation_version'], null, null, null, null, false, false, true),
      ('match_invitation_commands', 'match_invitation_commands_match_status_check', 'c', null, null, array['match_status'], null, null, null, null, false, false, true),
      ('match_invitation_commands', 'match_invitation_commands_result_shape_check', 'c', null, null, array['command_type', 'invitation_version', 'match_version', 'participant_id', 'result_type'], null, null, null, null, false, false, true)
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
        'match_invitations',
        'match_invitation_commands'
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
    raise exception 'POSTCHECK_FAILED: invitation constraint allowlist differs';
  end if;

  with expected(table_name, constraint_name, normalized_definition) as (
    values
      ('match_invitations', 'match_invitations_distinct_accounts_check', 'check (invited_by_account_id <> invited_account_id)'),
      ('match_invitations', 'match_invitations_slot_number_check', 'check (slot_number = 2 or slot_number = 3 or slot_number = 4)'),
      ('match_invitations', 'match_invitations_status_check', 'check (status = ''pending''::text or status = ''accepted''::text or status = ''declined''::text or status = ''cancelled''::text)'),
      ('match_invitations', 'match_invitations_time_check', 'check (created_at >= 0 and created_at <= ''9007199254740991''::bigint and updated_at >= created_at and updated_at <= ''9007199254740991''::bigint and (responded_at is null or responded_at >= created_at and responded_at <= updated_at))'),
      ('match_invitations', 'match_invitations_version_check', 'check (version = 1 or version = 2)'),
      ('match_invitations', 'match_invitations_terminal_shape_check', 'check (status = ''pending''::text and responded_at is null and version = 1 or status <> ''pending''::text and responded_at is not null and version = 2)'),
      ('match_invitation_commands', 'match_invitation_commands_request_digest_check', 'check (octet_length(request_digest) = 32)'),
      ('match_invitation_commands', 'match_invitation_commands_command_type_check', 'check (command_type = ''create_invitation''::text or command_type = ''accept_invitation''::text or command_type = ''decline_invitation''::text or command_type = ''cancel_invitation''::text)'),
      ('match_invitation_commands', 'match_invitation_commands_result_type_check', 'check (result_type = ''invitation_created''::text or result_type = ''invitation_accepted''::text or result_type = ''invitation_declined''::text or result_type = ''invitation_cancelled''::text)'),
      ('match_invitation_commands', 'match_invitation_commands_applied_at_check', 'check (applied_at >= 0 and applied_at <= ''9007199254740991''::bigint)'),
      ('match_invitation_commands', 'match_invitation_commands_invitation_version_check', 'check (invitation_version = 1 or invitation_version = 2)'),
      ('match_invitation_commands', 'match_invitation_commands_match_status_check', 'check (match_status = ''open''::text or match_status = ''searching''::text or match_status = ''confirmed''::text or match_status = ''upcoming''::text or match_status = ''completed''::text or match_status = ''cancelled''::text)'),
      ('match_invitation_commands', 'match_invitation_commands_result_shape_check', 'check (command_type = ''create_invitation''::text and result_type = ''invitation_created''::text and invitation_version = 1 and participant_id is null and match_version is null or command_type = ''accept_invitation''::text and result_type = ''invitation_accepted''::text and invitation_version = 2 and participant_id is not null and match_version > 0 or command_type = ''decline_invitation''::text and result_type = ''invitation_declined''::text and invitation_version = 2 and participant_id is null and match_version is null or command_type = ''cancel_invitation''::text and result_type = ''invitation_cancelled''::text and invitation_version = 2 and participant_id is null and match_version is null)')
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
        'match_invitations',
        'match_invitation_commands'
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
    raise exception 'POSTCHECK_FAILED: invitation CHECK definitions differ';
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
      ('match_invitations', 'match_invitations_pkey', 'btree', true, true, array['id'], '0', null),
      ('match_invitations', 'match_invitations_id_match_key', 'btree', true, false, array['id', 'match_id'], '0 0', null),
      ('match_invitations', 'match_invitations_one_pending_player', 'btree', true, false, array['match_id', 'invited_account_id'], '0 0', 'status = ''pending''::text'),
      ('match_invitations', 'match_invitations_one_pending_slot', 'btree', true, false, array['match_id', 'slot_number'], '0 0', 'status = ''pending''::text'),
      ('match_invitations', 'match_invitations_incoming_pending_idx', 'btree', false, false, array['invited_account_id', 'created_at', 'id'], '0 3 0', 'status = ''pending''::text'),
      ('match_invitations', 'match_invitations_match_pending_idx', 'btree', false, false, array['match_id', 'slot_number', 'created_at', 'id'], '0 0 0 0', 'status = ''pending''::text'),
      ('match_invitation_commands', 'match_invitation_commands_pkey', 'btree', true, true, array['command_id'], '0', null),
      ('match_invitation_commands', 'match_invitation_commands_invitation_applied_idx', 'btree', false, false, array['invitation_id', 'applied_at', 'command_id'], '0 0 0', null),
      ('match_invitation_commands', 'match_invitation_commands_actor_applied_idx', 'btree', false, false, array['actor_account_id', 'applied_at', 'command_id'], '0 0 0', null)
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
        'match_invitations',
        'match_invitation_commands'
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
    raise exception 'POSTCHECK_FAILED: invitation index allowlist differs';
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
      ('backend_match', 'match_invitations', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
      ('backend_match', 'match_invitation_commands', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false)
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
        'match_invitations',
        'match_invitation_commands'
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
    raise exception 'POSTCHECK_FAILED: invitation table ACL differs';
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
      ('backend_match', 'match_invitations', 'id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitations', 'match_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitations', 'invited_by_account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitations', 'invited_account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitations', 'slot_number', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitations', 'status', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitations', 'created_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitations', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitations', 'version', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitations', 'status', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_invitations', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_invitations', 'responded_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_invitations', 'version', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_invitation_commands', 'command_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitation_commands', 'invitation_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitation_commands', 'match_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitation_commands', 'actor_account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitation_commands', 'request_digest', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitation_commands', 'command_type', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitation_commands', 'result_type', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitation_commands', 'applied_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitation_commands', 'invitation_version', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitation_commands', 'match_status', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitation_commands', 'participant_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_invitation_commands', 'match_version', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false)
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
        'match_invitations',
        'match_invitation_commands'
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
    raise exception 'POSTCHECK_FAILED: invitation column ACL differs';
  end if;

  if pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'CREATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_invitations_oid,
       'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_invitations_oid,
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_invitations_oid,
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
       v_invitations_oid,
       'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_commands_oid,
       'SELECT'
     ) then
    raise exception 'POSTCHECK_FAILED: effective invitation privileges differ';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_class relation
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
         and relation.relkind = 'r'
     ) <> 5
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       join pg_catalog.pg_class relation
         on relation.oid = constraint_row.conrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
     ) <> 58
     or (
       select pg_catalog.count(*)
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_class relation
         on relation.oid = index_row.indrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
     ) <> 22
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

  if (select pg_catalog.count(*) from backend_match.match_invitations) <> 0
     or (
       select pg_catalog.count(*)
       from backend_match.match_invitation_commands
     ) <> 0 then
    raise exception 'POSTCHECK_FAILED: migration 021 relations are not empty';
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
  'migration', '021_backend_match_invitations',
  'backend_match_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', 5,
    'constraints', 58,
    'indexes', 22,
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
