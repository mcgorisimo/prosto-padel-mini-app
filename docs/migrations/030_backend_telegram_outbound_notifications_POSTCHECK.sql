-- Read-only postcheck for 030_backend_telegram_outbound_notifications.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_relation record;
  v_destination_oid oid := pg_catalog.to_regclass(
    'backend_auth.telegram_notification_destinations'
  );
  v_outbox_oid oid := pg_catalog.to_regclass(
    'backend_match.telegram_notification_outbox'
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
       select namespace.nspowner from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_match'
     )) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_auth'
     )) <> 'backend_auth_owner' then
    raise exception 'POSTCHECK_FAILED: backend schema boundary differs';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_auth', 'accounts', '015_backend_auth_foundation'),
      ('backend_match', 'matches', '023_backend_match_description_updates'),
      ('backend_match', 'match_invitations', '021_backend_match_invitations'),
      ('backend_match', 'match_notifications', '029_backend_match_notifications')
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

  if v_destination_oid is null or v_outbox_oid is null then
    raise exception 'POSTCHECK_FAILED: migration 030 relation is missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where relation.oid in (v_destination_oid, v_outbox_oid)
      and (
        relation.relkind <> 'r'
        or relation.relpersistence <> 'p'
        or relation.relrowsecurity
        or relation.relforcerowsecurity
        or pg_catalog.pg_get_userbyid(relation.relowner) <> 'backend_auth_owner'
      )
  ) then
    raise exception 'POSTCHECK_FAILED: migration 030 relation metadata differs';
  end if;

  if pg_catalog.has_schema_privilege('backend_auth_app', 'backend_match', 'CREATE')
     or pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'CREATE') then
    raise exception 'POSTCHECK_FAILED: application schema CREATE is unsafe';
  end if;

  if exists (
    with expected_base(
      relation_oid,
      column_name,
      ordinal_position,
      data_type,
      not_null,
      default_expression
    ) as (
      values
        (v_destination_oid, 'account_id', 1, 'uuid', true, null::text),
        (v_destination_oid, 'telegram_chat_id', 2, 'bigint', true, null::text),
        (v_destination_oid, 'status', 3, 'text', true, null::text),
        (v_destination_oid, 'permission_granted_at', 4, 'bigint', true, null::text),
        (v_destination_oid, 'updated_at', 5, 'bigint', true, null::text),
        (v_destination_oid, 'disabled_at', 6, 'bigint', false, null::text),
        (v_destination_oid, 'disable_reason', 7, 'text', false, null::text),
        (v_destination_oid, 'version', 8, 'bigint', true, null::text),
        (v_outbox_oid, 'id', 1, 'uuid', true, null::text),
        (v_outbox_oid, 'source_type', 2, 'text', true, null::text),
        (v_outbox_oid, 'match_notification_id', 3, 'uuid', false, null::text),
        (v_outbox_oid, 'invitation_id', 4, 'uuid', false, null::text),
        (v_outbox_oid, 'created_at', 5, 'bigint', true, null::text),
        (v_outbox_oid, 'available_at', 6, 'bigint', true, null::text),
        (v_outbox_oid, 'status', 7, 'text', true, null::text),
        (v_outbox_oid, 'attempt_count', 8, 'integer', true, null::text),
        (v_outbox_oid, 'updated_at', 9, 'bigint', true, null::text),
        (v_outbox_oid, 'sent_at', 10, 'bigint', false, null::text),
        (v_outbox_oid, 'telegram_message_id', 11, 'bigint', false, null::text),
        (v_outbox_oid, 'failure_code', 12, 'text', false, null::text),
        (v_outbox_oid, 'version', 13, 'bigint', true, null::text)
    ), expected as (
      select
        expected_base.*,
        ''::text as identity_kind,
        ''::text as generation_kind
      from expected_base
    ), actual as (
      select
        attribute.attrelid,
        attribute.attname::text,
        attribute.attnum::integer,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)::text,
        attribute.attnotnull,
        pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid, true)::text,
        attribute.attidentity::text,
        attribute.attgenerated::text
      from pg_catalog.pg_attribute attribute
      left join pg_catalog.pg_attrdef default_row
        on default_row.adrelid = attribute.attrelid
       and default_row.adnum = attribute.attnum
      where attribute.attrelid in (v_destination_oid, v_outbox_oid)
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: migration 030 column allowlist differs';
  end if;

  if exists (
    with expected_base(relation_oid, constraint_name, constraint_type) as (
      values
        (v_destination_oid, 'telegram_notification_destinations_pkey', 'p'),
        (v_destination_oid, 'telegram_notification_destinations_chat_key', 'u'),
        (v_destination_oid, 'telegram_notification_destinations_account_id_fkey', 'f'),
        (v_destination_oid, 'telegram_notification_destinations_chat_check', 'c'),
        (v_destination_oid, 'telegram_notification_destinations_status_check', 'c'),
        (v_destination_oid, 'telegram_notification_destinations_reason_check', 'c'),
        (v_destination_oid, 'telegram_notification_destinations_time_check', 'c'),
        (v_destination_oid, 'telegram_notification_destinations_state_check', 'c'),
        (v_destination_oid, 'telegram_notification_destinations_version_check', 'c'),
        (v_outbox_oid, 'telegram_notification_outbox_pkey', 'p'),
        (v_outbox_oid, 'telegram_notification_outbox_match_notification_fkey', 'f'),
        (v_outbox_oid, 'telegram_notification_outbox_invitation_fkey', 'f'),
        (v_outbox_oid, 'telegram_notification_outbox_source_check', 'c'),
        (v_outbox_oid, 'telegram_notification_outbox_status_check', 'c'),
        (v_outbox_oid, 'telegram_notification_outbox_attempt_check', 'c'),
        (v_outbox_oid, 'telegram_notification_outbox_time_check', 'c'),
        (v_outbox_oid, 'telegram_notification_outbox_message_check', 'c'),
        (v_outbox_oid, 'telegram_notification_outbox_failure_check', 'c'),
        (v_outbox_oid, 'telegram_notification_outbox_state_check', 'c'),
        (v_outbox_oid, 'telegram_notification_outbox_version_check', 'c')
    ), expected as (
      select
        expected_base.*,
        false as is_deferrable,
        false as is_initially_deferred,
        true as is_validated
      from expected_base
    ), actual as (
      select
        constraint_row.conrelid,
        constraint_row.conname::text,
        constraint_row.contype::text,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        constraint_row.convalidated
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid in (v_destination_oid, v_outbox_oid)
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: migration 030 constraint allowlist differs';
  end if;

  if exists (
    with expected(
      constraint_name,
      source_relation,
      source_columns,
      target_relation,
      target_columns
    ) as (
      values
        (
          'telegram_notification_destinations_account_id_fkey',
          v_destination_oid,
          array['account_id']::text[],
          'backend_auth.accounts'::pg_catalog.regclass::oid,
          array['id']::text[]
        ),
        (
          'telegram_notification_outbox_match_notification_fkey',
          v_outbox_oid,
          array['match_notification_id']::text[],
          'backend_match.match_notifications'::pg_catalog.regclass::oid,
          array['id']::text[]
        ),
        (
          'telegram_notification_outbox_invitation_fkey',
          v_outbox_oid,
          array['invitation_id']::text[],
          'backend_match.match_invitations'::pg_catalog.regclass::oid,
          array['id']::text[]
        )
    ), actual as (
      select
        constraint_row.conname::text,
        constraint_row.conrelid,
        array(
          select attribute.attname::text
          from pg_catalog.unnest(constraint_row.conkey)
            with ordinality key(attnum, position)
          join pg_catalog.pg_attribute attribute
            on attribute.attrelid = constraint_row.conrelid
           and attribute.attnum = key.attnum
          order by key.position
        ),
        constraint_row.confrelid,
        array(
          select attribute.attname::text
          from pg_catalog.unnest(constraint_row.confkey)
            with ordinality key(attnum, position)
          join pg_catalog.pg_attribute attribute
            on attribute.attrelid = constraint_row.confrelid
           and attribute.attnum = key.attnum
          order by key.position
        )
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid in (v_destination_oid, v_outbox_oid)
        and constraint_row.contype = 'f'
        and constraint_row.confupdtype = 'a'
        and constraint_row.confdeltype = 'a'
        and constraint_row.confmatchtype = 's'
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: migration 030 foreign key metadata differs';
  end if;

  if exists (
    with expected(relation_oid, constraint_name, normalized_definition) as (
      values
        (
          v_destination_oid,
          'telegram_notification_destinations_chat_check',
          'check (telegram_chat_id >= 1 and telegram_chat_id <= ''9007199254740991''::bigint)'
        ),
        (
          v_destination_oid,
          'telegram_notification_destinations_status_check',
          'check (status = ''enabled''::text or status = ''disabled''::text)'
        ),
        (
          v_destination_oid,
          'telegram_notification_destinations_reason_check',
          'check (disable_reason is null or disable_reason = ''user_revoked''::text or disable_reason = ''telegram_forbidden''::text or disable_reason = ''invalid_destination''::text)'
        ),
        (
          v_destination_oid,
          'telegram_notification_destinations_time_check',
          'check (permission_granted_at >= 0 and permission_granted_at <= ''9007199254740991''::bigint and updated_at >= permission_granted_at and updated_at <= ''9007199254740991''::bigint and (disabled_at is null or disabled_at >= permission_granted_at and disabled_at <= updated_at))'
        ),
        (
          v_destination_oid,
          'telegram_notification_destinations_state_check',
          'check (status = ''enabled''::text and disabled_at is null and disable_reason is null or status = ''disabled''::text and disabled_at is not null and disable_reason is not null)'
        ),
        (
          v_destination_oid,
          'telegram_notification_destinations_version_check',
          'check (version >= 1 and version <= ''9007199254740991''::bigint)'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_source_check',
          'check (source_type = ''match_notification''::text and match_notification_id is not null and invitation_id is null or source_type = ''match_invitation''::text and match_notification_id is null and invitation_id is not null)'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_status_check',
          'check (status = ''pending''::text or status = ''sent''::text or status = ''abandoned''::text)'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_attempt_check',
          'check (attempt_count >= 0 and attempt_count <= 20)'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_time_check',
          'check (created_at >= 0 and created_at <= ''9007199254740991''::bigint and available_at >= created_at and available_at <= ''9007199254740991''::bigint and updated_at >= created_at and updated_at <= ''9007199254740991''::bigint and (sent_at is null or sent_at >= created_at and sent_at <= updated_at))'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_message_check',
          'check (telegram_message_id is null or telegram_message_id >= 1 and telegram_message_id <= ''9007199254740991''::bigint)'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_failure_check',
          'check (failure_code is null or failure_code = ''destination_unavailable''::text or failure_code = ''telegram_forbidden''::text or failure_code = ''telegram_bad_request''::text or failure_code = ''telegram_rate_limited''::text or failure_code = ''telegram_unavailable''::text or failure_code = ''network_error''::text or failure_code = ''invalid_response''::text or failure_code = ''retry_exhausted''::text)'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_state_check',
          'check (status = ''pending''::text and sent_at is null and telegram_message_id is null and attempt_count <= 20 and (failure_code is null or failure_code = ''telegram_rate_limited''::text or failure_code = ''telegram_unavailable''::text or failure_code = ''network_error''::text or failure_code = ''invalid_response''::text) or status = ''sent''::text and sent_at is not null and telegram_message_id is not null and failure_code is null and attempt_count > 0 or status = ''abandoned''::text and sent_at is null and telegram_message_id is null and (failure_code = ''destination_unavailable''::text or failure_code = ''telegram_forbidden''::text or failure_code = ''telegram_bad_request''::text or failure_code = ''retry_exhausted''::text))'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_version_check',
          'check (version >= 1 and version <= ''9007199254740991''::bigint)'
        )
    ), actual as (
      select
        constraint_row.conrelid,
        constraint_row.conname::text,
        pg_catalog.lower(
          pg_catalog.regexp_replace(
            pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
            '[[:space:]]+',
            ' ',
            'g'
          )
        )::text
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid in (v_destination_oid, v_outbox_oid)
        and constraint_row.contype = 'c'
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: migration 030 CHECK definitions differ';
  end if;

  if exists (
    with expected(
      relation_oid,
      index_name,
      access_method,
      is_unique,
      is_primary,
      is_valid,
      is_ready,
      key_attribute_count,
      total_attribute_count,
      indexed_columns,
      ordering_options,
      predicate
    ) as (
      values
        (
          v_destination_oid,
          'telegram_notification_destinations_pkey',
          'btree',
          true,
          true,
          true,
          true,
          1::smallint,
          1::smallint,
          array['account_id']::text[],
          '0',
          null::text
        ),
        (
          v_destination_oid,
          'telegram_notification_destinations_chat_key',
          'btree',
          true,
          false,
          true,
          true,
          1::smallint,
          1::smallint,
          array['telegram_chat_id']::text[],
          '0',
          null::text
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_pkey',
          'btree',
          true,
          true,
          true,
          true,
          1::smallint,
          1::smallint,
          array['id']::text[],
          '0',
          null::text
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_notification_key',
          'btree',
          true,
          false,
          true,
          true,
          1::smallint,
          1::smallint,
          array['match_notification_id']::text[],
          '0',
          'match_notification_idisnotnull'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_invitation_key',
          'btree',
          true,
          false,
          true,
          true,
          1::smallint,
          1::smallint,
          array['invitation_id']::text[],
          '0',
          'invitation_idisnotnull'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_pending_idx',
          'btree',
          false,
          false,
          true,
          true,
          3::smallint,
          3::smallint,
          array['available_at','created_at','id']::text[],
          '0 0 0',
          'status=''pending''::text'
        )
    ), actual as (
      select
        index_row.indrelid,
        index_relation.relname::text,
        access_method.amname::text,
        index_row.indisunique,
        index_row.indisprimary,
        index_row.indisvalid,
        index_row.indisready,
        index_row.indnkeyatts,
        index_row.indnatts,
        array(
          select pg_catalog.pg_get_indexdef(index_row.indexrelid, position, true)
          from pg_catalog.generate_series(1, index_row.indnkeyatts) position
          order by position
        ),
        index_row.indoption::text,
        case
          when index_row.indpred is null then null::text
          else pg_catalog.regexp_replace(
            pg_catalog.lower(
              pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid, true)
            ),
            '[[:space:]()]',
            '',
            'g'
          )
        end
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class index_relation
        on index_relation.oid = index_row.indexrelid
      join pg_catalog.pg_am access_method
        on access_method.oid = index_relation.relam
      where index_row.indrelid in (v_destination_oid, v_outbox_oid)
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: migration 030 index allowlist differs';
  end if;

  if exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid in (v_destination_oid, v_outbox_oid)
      and not trigger_row.tgisinternal
  ) then
    raise exception 'POSTCHECK_FAILED: migration 030 user trigger exists';
  end if;

  if exists (
    with expected(
      relation_oid,
      grantor,
      grantee,
      privilege_type,
      is_grantable
    ) as (
      values
        (
          v_destination_oid,
          'backend_auth_owner',
          'backend_auth_app',
          'SELECT',
          false
        ),
        (
          v_outbox_oid,
          'backend_auth_owner',
          'backend_auth_app',
          'SELECT',
          false
        )
    ), actual as (
      select
        relation.oid,
        grantor.rolname::text,
        case
          when acl_row.grantee = 0 then 'PUBLIC'::text
          else grantee.rolname::text
        end,
        acl_row.privilege_type::text,
        acl_row.is_grantable
      from pg_catalog.pg_class relation
      cross join lateral pg_catalog.aclexplode(
        coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) acl_row
      join pg_catalog.pg_roles grantor on grantor.oid = acl_row.grantor
      left join pg_catalog.pg_roles grantee on grantee.oid = acl_row.grantee
      where relation.oid in (v_destination_oid, v_outbox_oid)
        and acl_row.grantee <> relation.relowner
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: migration 030 table ACL differs';
  end if;

  if exists (
    with expected(
      relation_oid,
      column_name,
      grantor,
      grantee,
      privilege_type,
      is_grantable
    ) as (
      values
        (v_destination_oid, 'account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_destination_oid, 'telegram_chat_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_destination_oid, 'status', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_destination_oid, 'permission_granted_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_destination_oid, 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_destination_oid, 'version', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_destination_oid, 'telegram_chat_id', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_destination_oid, 'status', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_destination_oid, 'permission_granted_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_destination_oid, 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_destination_oid, 'disabled_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_destination_oid, 'disable_reason', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_destination_oid, 'version', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_outbox_oid, 'id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_outbox_oid, 'source_type', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_outbox_oid, 'match_notification_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_outbox_oid, 'invitation_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_outbox_oid, 'created_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_outbox_oid, 'available_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_outbox_oid, 'status', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_outbox_oid, 'attempt_count', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_outbox_oid, 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_outbox_oid, 'version', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        (v_outbox_oid, 'available_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_outbox_oid, 'status', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_outbox_oid, 'attempt_count', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_outbox_oid, 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_outbox_oid, 'sent_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_outbox_oid, 'telegram_message_id', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_outbox_oid, 'failure_code', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        (v_outbox_oid, 'version', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false)
    ), actual as (
      select
        attribute.attrelid,
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
      where attribute.attrelid in (v_destination_oid, v_outbox_oid)
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: migration 030 column ACL differs';
  end if;

  if exists (select 1 from backend_auth.telegram_notification_destinations)
     or exists (select 1 from backend_match.telegram_notification_outbox) then
    raise exception 'POSTCHECK_FAILED: migration 030 storage is not empty';
  end if;

  if pg_catalog.obj_description(v_destination_oid, 'pg_class') <>
       '030_backend_telegram_outbound_notifications:'
         || backend_auth.relation_fingerprint(v_destination_oid::pg_catalog.regclass)
     or pg_catalog.obj_description(v_outbox_oid, 'pg_class') <>
       '030_backend_telegram_outbound_notifications:'
         || backend_auth.relation_fingerprint(v_outbox_oid::pg_catalog.regclass) then
    raise exception 'POSTCHECK_FAILED: migration 030 fingerprint differs';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '030_backend_telegram_outbound_notifications',
  'backend_auth_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', (
      select pg_catalog.count(*) from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth' and relation.relkind = 'r'
    ),
    'constraints', (
      select pg_catalog.count(*) from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth'
    ),
    'indexes', (
      select pg_catalog.count(*) from pg_catalog.pg_index index_row
      join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth'
    )
  ),
  'backend_match_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', (
      select pg_catalog.count(*) from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match' and relation.relkind = 'r'
    ),
    'constraints', (
      select pg_catalog.count(*) from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
    ),
    'indexes', (
      select pg_catalog.count(*) from pg_catalog.pg_index index_row
      join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match'
    )
  ),
  'row_counts', pg_catalog.jsonb_build_object(
    'accounts', (select pg_catalog.count(*) from backend_auth.accounts),
    'matches', (select pg_catalog.count(*) from backend_match.matches),
    'match_invitations', (select pg_catalog.count(*) from backend_match.match_invitations),
    'match_notifications', (select pg_catalog.count(*) from backend_match.match_notifications),
    'telegram_notification_destinations', (
      select pg_catalog.count(*) from backend_auth.telegram_notification_destinations
    ),
    'telegram_notification_outbox', (
      select pg_catalog.count(*) from backend_match.telegram_notification_outbox
    )
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'accounts', backend_auth.relation_fingerprint(
      'backend_auth.accounts'::pg_catalog.regclass
    ),
    'matches', backend_auth.relation_fingerprint(
      'backend_match.matches'::pg_catalog.regclass
    ),
    'match_invitations', backend_auth.relation_fingerprint(
      'backend_match.match_invitations'::pg_catalog.regclass
    ),
    'match_notifications', backend_auth.relation_fingerprint(
      'backend_match.match_notifications'::pg_catalog.regclass
    ),
    'telegram_notification_destinations', backend_auth.relation_fingerprint(
      'backend_auth.telegram_notification_destinations'::pg_catalog.regclass
    ),
    'telegram_notification_outbox', backend_auth.relation_fingerprint(
      'backend_match.telegram_notification_outbox'::pg_catalog.regclass
    )
  )
) as backend_telegram_outbound_notifications_postcheck;

rollback;
