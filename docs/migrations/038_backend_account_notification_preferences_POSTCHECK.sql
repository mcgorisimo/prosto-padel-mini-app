-- Read-only postcheck for 038_backend_account_notification_preferences.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_relation record;
  v_preference_oid oid := pg_catalog.to_regclass(
    'backend_auth.account_notification_preferences'
  );
  v_outbox_oid oid := pg_catalog.to_regclass(
    'backend_match.telegram_notification_outbox'
  );
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'POSTCHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  select * into v_owner
  from pg_catalog.pg_roles
  where rolname = 'backend_auth_owner';

  select * into v_app
  from pg_catalog.pg_roles
  where rolname = 'backend_auth_app';

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

  if not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     )
     or pg_catalog.pg_has_role(
       'backend_auth_app',
       'backend_auth_owner',
       'MEMBER'
     ) then
    raise exception 'POSTCHECK_FAILED: role membership boundary differs';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_auth'
     )) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_match'
     )) <> 'backend_auth_owner' then
    raise exception 'POSTCHECK_FAILED: backend schema boundary differs';
  end if;

  for v_relation in
    select *
    from (values
      (
        'backend_auth',
        'accounts',
        '015_backend_auth_foundation'
      ),
      (
        'backend_auth',
        'telegram_notification_destinations',
        '030_backend_telegram_outbound_notifications'
      )
    ) expected(schema_name, relation_name, migration_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = v_relation.schema_name
        and relation.relname = v_relation.relation_name
        and relation.relkind = 'r'
        and relation.relpersistence = 'p'
        and not relation.relrowsecurity
        and not relation.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(relation.relowner) =
          'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          v_relation.migration_name || ':'
            || backend_auth.relation_fingerprint(
              relation.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'POSTCHECK_FAILED: %.% differs from %',
        v_relation.schema_name,
        v_relation.relation_name,
        v_relation.migration_name;
    end if;
  end loop;

  if v_preference_oid is null or v_outbox_oid is null then
    raise exception 'POSTCHECK_FAILED: migration 038 relation is missing';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid in (v_preference_oid, v_outbox_oid)
      and (
        relation.relkind <> 'r'
        or relation.relpersistence <> 'p'
        or relation.relrowsecurity
        or relation.relforcerowsecurity
        or pg_catalog.pg_get_userbyid(relation.relowner) <>
          'backend_auth_owner'
      )
  ) then
    raise exception 'POSTCHECK_FAILED: migration 038 relation metadata differs';
  end if;

  if pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_auth',
       'CREATE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'CREATE'
     ) then
    raise exception 'POSTCHECK_FAILED: application schema CREATE is unsafe';
  end if;

  if exists (
    with expected_base(
      column_name,
      ordinal_position,
      data_type,
      not_null,
      default_expression
    ) as (
      values
        ('account_id', 1, 'uuid', true, null::text),
        (
          'telegram_match_notifications_enabled',
          2,
          'boolean',
          true,
          null::text
        ),
        ('created_at', 3, 'bigint', true, null::text),
        ('updated_at', 4, 'bigint', true, null::text),
        ('version', 5, 'bigint', true, null::text)
    ), expected as (
      select
        expected_base.*,
        ''::text as identity_kind,
        ''::text as generation_kind
      from expected_base
    ), actual as (
      select
        attribute.attname::text,
        attribute.attnum::integer,
        pg_catalog.format_type(
          attribute.atttypid,
          attribute.atttypmod
        )::text,
        attribute.attnotnull,
        pg_catalog.pg_get_expr(
          default_row.adbin,
          default_row.adrelid,
          true
        )::text,
        attribute.attidentity::text,
        attribute.attgenerated::text
      from pg_catalog.pg_attribute attribute
      left join pg_catalog.pg_attrdef default_row
        on default_row.adrelid = attribute.attrelid
       and default_row.adnum = attribute.attnum
      where attribute.attrelid = v_preference_oid
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: preference column allowlist differs';
  end if;

  if exists (
    with expected_base(
      relation_oid,
      constraint_name,
      constraint_type
    ) as (
      values
        (
          v_preference_oid,
          'account_notification_preferences_pkey',
          'p'
        ),
        (
          v_preference_oid,
          'account_notification_preferences_account_id_fkey',
          'f'
        ),
        (
          v_preference_oid,
          'account_notification_preferences_time_check',
          'c'
        ),
        (
          v_preference_oid,
          'account_notification_preferences_version_check',
          'c'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_pkey',
          'p'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_match_notification_fkey',
          'f'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_invitation_fkey',
          'f'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_source_check',
          'c'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_status_check',
          'c'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_attempt_check',
          'c'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_time_check',
          'c'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_message_check',
          'c'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_failure_check',
          'c'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_state_check',
          'c'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_version_check',
          'c'
        )
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
      where constraint_row.conrelid in (
        v_preference_oid,
        v_outbox_oid
      )
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: migration 038 constraint allowlist differs';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid = v_preference_oid
      and constraint_row.conname =
        'account_notification_preferences_account_id_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid =
        'backend_auth.accounts'::pg_catalog.regclass::oid
      and constraint_row.confupdtype = 'a'
      and constraint_row.confdeltype = 'a'
      and constraint_row.confmatchtype = 's'
      and constraint_row.conkey = array[
        (
          select attribute.attnum
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid = v_preference_oid
            and attribute.attname = 'account_id'
        )
      ]::smallint[]
      and constraint_row.confkey = array[
        (
          select attribute.attnum
          from pg_catalog.pg_attribute attribute
          where attribute.attrelid =
            'backend_auth.accounts'::pg_catalog.regclass
            and attribute.attname = 'id'
        )
      ]::smallint[]
  ) then
    raise exception 'POSTCHECK_FAILED: preference account binding differs';
  end if;

  if exists (
    with expected(relation_oid, constraint_name, normalized_definition) as (
      values
        (
          v_preference_oid,
          'account_notification_preferences_time_check',
          'check (created_at >= 0 and created_at <= ''9007199254740991''::bigint and updated_at >= created_at and updated_at <= ''9007199254740991''::bigint)'
        ),
        (
          v_preference_oid,
          'account_notification_preferences_version_check',
          'check (version >= 1 and version <= ''9007199254740991''::bigint)'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_failure_check',
          'check (failure_code is null or failure_code = ''destination_unavailable''::text or failure_code = ''preference_disabled''::text or failure_code = ''telegram_forbidden''::text or failure_code = ''telegram_bad_request''::text or failure_code = ''telegram_rate_limited''::text or failure_code = ''telegram_unavailable''::text or failure_code = ''network_error''::text or failure_code = ''invalid_response''::text or failure_code = ''retry_exhausted''::text)'
        ),
        (
          v_outbox_oid,
          'telegram_notification_outbox_state_check',
          'check (status = ''pending''::text and sent_at is null and telegram_message_id is null and attempt_count <= 20 and (failure_code is null or failure_code = ''telegram_rate_limited''::text or failure_code = ''telegram_unavailable''::text or failure_code = ''network_error''::text or failure_code = ''invalid_response''::text) or status = ''sent''::text and sent_at is not null and telegram_message_id is not null and failure_code is null and attempt_count > 0 or status = ''abandoned''::text and sent_at is null and telegram_message_id is null and (failure_code = ''destination_unavailable''::text or failure_code = ''preference_disabled''::text or failure_code = ''telegram_forbidden''::text or failure_code = ''telegram_bad_request''::text or failure_code = ''retry_exhausted''::text))'
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
      where constraint_row.conrelid in (
        v_preference_oid,
        v_outbox_oid
      )
        and constraint_row.conname in (
          'account_notification_preferences_time_check',
          'account_notification_preferences_version_check',
          'telegram_notification_outbox_failure_check',
          'telegram_notification_outbox_state_check'
        )
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: migration 038 CHECK definitions differ';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_index index_row
       where index_row.indrelid = v_preference_oid
     ) <> 1
     or not exists (
       select 1
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_class index_relation
         on index_relation.oid = index_row.indexrelid
       join pg_catalog.pg_am access_method
         on access_method.oid = index_relation.relam
       where index_row.indrelid = v_preference_oid
         and index_relation.relname =
           'account_notification_preferences_pkey'
         and access_method.amname = 'btree'
         and index_row.indisunique
         and index_row.indisprimary
         and index_row.indisvalid
         and index_row.indisready
         and index_row.indnkeyatts = 1
         and index_row.indnatts = 1
         and pg_catalog.pg_get_expr(
           index_row.indpred,
           index_row.indrelid,
           true
         ) is null
     ) then
    raise exception 'POSTCHECK_FAILED: preference index contract differs';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_index index_row
       where index_row.indrelid = v_outbox_oid
     ) <> 4
     or exists (
       (
         values
           ('telegram_notification_outbox_pkey'),
           ('telegram_notification_outbox_notification_key'),
           ('telegram_notification_outbox_invitation_key'),
           ('telegram_notification_outbox_pending_idx')
       )
       except
       select index_relation.relname::text
       from pg_catalog.pg_index index_row
       join pg_catalog.pg_class index_relation
         on index_relation.oid = index_row.indexrelid
       where index_row.indrelid = v_outbox_oid
     ) then
    raise exception 'POSTCHECK_FAILED: outbox index allowlist differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid in (v_preference_oid, v_outbox_oid)
      and not trigger_row.tgisinternal
  ) or exists (
    select 1
    from pg_catalog.pg_policy policy_row
    where policy_row.polrelid in (v_preference_oid, v_outbox_oid)
  ) then
    raise exception 'POSTCHECK_FAILED: unexpected trigger or policy exists';
  end if;

  if exists (
    with expected(
      grantee_name,
      grantor_name,
      privilege_type,
      is_grantable
    ) as (
      values
        (
          'backend_auth_app',
          'backend_auth_owner',
          'SELECT',
          false
        )
    ), actual as (
      select
        pg_catalog.pg_get_userbyid(acl.grantee)::text,
        pg_catalog.pg_get_userbyid(acl.grantor)::text,
        acl.privilege_type::text,
        acl.is_grantable
      from pg_catalog.pg_class relation
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          relation.relacl,
          pg_catalog.acldefault('r', relation.relowner)
        )
      ) acl
      where relation.oid = v_preference_oid
        and acl.grantee <> relation.relowner
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: preference table ACL differs';
  end if;

  if exists (
    with expected(
      column_name,
      grantee_name,
      grantor_name,
      privilege_type,
      is_grantable
    ) as (
      values
        (
          'account_id',
          'backend_auth_app',
          'backend_auth_owner',
          'INSERT',
          false
        ),
        (
          'telegram_match_notifications_enabled',
          'backend_auth_app',
          'backend_auth_owner',
          'INSERT',
          false
        ),
        (
          'created_at',
          'backend_auth_app',
          'backend_auth_owner',
          'INSERT',
          false
        ),
        (
          'updated_at',
          'backend_auth_app',
          'backend_auth_owner',
          'INSERT',
          false
        ),
        (
          'version',
          'backend_auth_app',
          'backend_auth_owner',
          'INSERT',
          false
        ),
        (
          'telegram_match_notifications_enabled',
          'backend_auth_app',
          'backend_auth_owner',
          'UPDATE',
          false
        ),
        (
          'updated_at',
          'backend_auth_app',
          'backend_auth_owner',
          'UPDATE',
          false
        ),
        (
          'version',
          'backend_auth_app',
          'backend_auth_owner',
          'UPDATE',
          false
        )
    ), actual as (
      select
        attribute.attname::text,
        pg_catalog.pg_get_userbyid(acl.grantee)::text,
        pg_catalog.pg_get_userbyid(acl.grantor)::text,
        acl.privilege_type::text,
        acl.is_grantable
      from pg_catalog.pg_attribute attribute
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          attribute.attacl,
          '{}'::pg_catalog.aclitem[]
        )
      ) acl
      where attribute.attrelid = v_preference_oid
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: preference column ACL differs';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_outbox_oid,
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_outbox_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app',
       v_outbox_oid,
       'failure_code',
       'UPDATE'
     ) then
    raise exception 'POSTCHECK_FAILED: outbox application privileges differ';
  end if;

  if exists (
       select 1
       from backend_auth.account_notification_preferences
     ) then
    raise exception 'POSTCHECK_FAILED: preference storage is not empty';
  end if;

  if pg_catalog.obj_description(v_preference_oid, 'pg_class') <>
       '038_backend_account_notification_preferences:'
         || backend_auth.relation_fingerprint(
           v_preference_oid::pg_catalog.regclass
         )
     or pg_catalog.obj_description(v_outbox_oid, 'pg_class') <>
       '038_backend_account_notification_preferences:'
         || backend_auth.relation_fingerprint(
           v_outbox_oid::pg_catalog.regclass
         ) then
    raise exception 'POSTCHECK_FAILED: migration 038 fingerprint differs';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'verified', true,
  'migration', '038_backend_account_notification_preferences',
  'runtime_connected', false,
  'preference_rows', (
    select pg_catalog.count(*)
    from backend_auth.account_notification_preferences
  ),
  'row_counts', pg_catalog.jsonb_build_object(
    'accounts', (
      select pg_catalog.count(*)
      from backend_auth.accounts
    ),
    'telegram_notification_destinations', (
      select pg_catalog.count(*)
      from backend_auth.telegram_notification_destinations
    ),
    'telegram_notification_outbox', (
      select pg_catalog.count(*)
      from backend_match.telegram_notification_outbox
    )
  ),
  'semantics', pg_catalog.jsonb_build_object(
    'missing_preference_row', 'enabled',
    'explicit_false_persisted_separately', true,
    'outbox_terminal_failure', 'preference_disabled'
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'account_notification_preferences',
      backend_auth.relation_fingerprint(
        'backend_auth.account_notification_preferences'::pg_catalog.regclass
      ),
    'telegram_notification_outbox',
      backend_auth.relation_fingerprint(
        'backend_match.telegram_notification_outbox'::pg_catalog.regclass
      )
  )
) as backend_account_notification_preferences_postcheck;

rollback;
