-- 017_backend_auth_player_profile_details_POSTCHECK.sql
-- Read-only verification of the private backend profile-details relation.

begin;
set transaction read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $role_precheck$
begin
  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null then
    raise exception 'POSTCHECK_FAILED: required backend_auth roles are missing';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'POSTCHECK_FAILED: current user cannot SET ROLE backend_auth_owner';
  end if;
end;
$role_precheck$;

set local role backend_auth_owner;

do $postcheck$
declare
  v_expected record;
  v_relation_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
  v_count bigint;
  v_column text;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'POSTCHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.pg_get_userbyid(
       (select n.nspowner from pg_catalog.pg_namespace n where n.nspname = 'backend_auth')
     ) <> 'backend_auth_owner' then
    raise exception 'POSTCHECK_FAILED: backend_auth schema is missing or has an unexpected owner';
  end if;

  if v_relation_oid is null then
    raise exception 'POSTCHECK_FAILED: backend_auth.player_profile_details is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = v_relation_oid
      and c.relkind = 'r'
      and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
      and not c.relrowsecurity
      and not c.relforcerowsecurity
  ) then
    raise exception 'POSTCHECK_FAILED: player_profile_details kind, owner, or private-schema access mode differs';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r';

  if v_count <> 15 then
    raise exception 'POSTCHECK_FAILED: expected 15 backend_auth tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth';

  if v_count <> 154 then
    raise exception 'POSTCHECK_FAILED: expected 154 backend_auth constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth'
    and c.contype in ('p', 'u', 'f', 'c');

  if v_count <> 139 then
    raise exception 'POSTCHECK_FAILED: expected 139 backend_auth table constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth' and c.contype = 't';

  if v_count <> 15 then
    raise exception 'POSTCHECK_FAILED: expected 15 backend_auth constraint-trigger constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and not t.tgisinternal;

  if v_count <> 33 then
    raise exception 'POSTCHECK_FAILED: expected 33 backend_auth user triggers, found %',
      v_count;
  end if;

  for v_expected in
    select *
    from (values
      (1, 'account_id', 'uuid', true),
      (2, 'first_name', 'text', true),
      (3, 'last_name', 'text', false),
      (4, 'username', 'text', false),
      (5, 'photo_url', 'text', false),
      (6, 'language_code', 'text', false),
      (7, 'created_at', 'bigint', true),
      (8, 'updated_at', 'bigint', true)
    ) expected(column_number, column_name, data_type, is_not_null)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute a
      where a.attrelid = v_relation_oid
        and a.attnum = v_expected.column_number
        and a.attname = v_expected.column_name
        and pg_catalog.format_type(a.atttypid, a.atttypmod) = v_expected.data_type
        and a.attnotnull = v_expected.is_not_null
        and a.attidentity = ''
        and a.attgenerated = ''
        and not a.attisdropped
        and not exists (
          select 1
          from pg_catalog.pg_attrdef d
          where d.adrelid = a.attrelid and d.adnum = a.attnum
        )
    ) then
      raise exception 'POSTCHECK_FAILED: column % differs',
        v_expected.column_name;
    end if;
  end loop;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_attribute a
      where a.attrelid = v_relation_oid
        and a.attnum > 0
        and not a.attisdropped) <> 8 then
    raise exception 'POSTCHECK_FAILED: player_profile_details has unexpected columns';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_constraint c
      where c.conrelid = v_relation_oid) <> 8 then
    raise exception 'POSTCHECK_FAILED: player_profile_details constraint count differs';
  end if;

  if exists (
    with expected_constraints(
      constraint_name,
      constraint_type,
      constraint_relation,
      referenced_relation,
      constrained_columns,
      referenced_columns,
      update_action,
      delete_action,
      match_type,
      is_deferrable,
      is_deferred,
      is_validated,
      normalized_definition
    ) as (
      values
        (
          'player_profile_details_pkey'::text,
          'p'::"char",
          v_relation_oid,
          null::oid,
          array[
            (
              select a.attnum
              from pg_catalog.pg_attribute a
              where a.attrelid = v_relation_oid
                and a.attname = 'account_id'
                and a.attnum > 0
                and not a.attisdropped
            )
          ]::smallint[],
          null::smallint[],
          null::"char",
          null::"char",
          null::"char",
          false,
          false,
          true,
          'primary key (account_id)'::text
        ),
        (
          'player_profile_details_account_id_fkey'::text,
          'f'::"char",
          v_relation_oid,
          'backend_auth.player_profiles'::pg_catalog.regclass::oid,
          array[
            (
              select a.attnum
              from pg_catalog.pg_attribute a
              where a.attrelid = v_relation_oid
                and a.attname = 'account_id'
                and a.attnum > 0
                and not a.attisdropped
            )
          ]::smallint[],
          array[
            (
              select a.attnum
              from pg_catalog.pg_attribute a
              where a.attrelid =
                'backend_auth.player_profiles'::pg_catalog.regclass
                and a.attname = 'account_id'
                and a.attnum > 0
                and not a.attisdropped
            )
          ]::smallint[],
          'a'::"char",
          'a'::"char",
          's'::"char",
          false,
          false,
          true,
          'foreign key (account_id) references backend_auth.player_profiles(account_id)'::text
        ),
        (
          'player_profile_details_first_name_check'::text,
          'c'::"char",
          v_relation_oid,
          null::oid,
          array[
            (
              select a.attnum
              from pg_catalog.pg_attribute a
              where a.attrelid = v_relation_oid
                and a.attname = 'first_name'
                and a.attnum > 0
                and not a.attisdropped
            )
          ]::smallint[],
          null::smallint[],
          null::"char",
          null::"char",
          null::"char",
          false,
          false,
          true,
          'check (char_length(first_name) >= 1 and char_length(first_name) <= 256)'::text
        ),
        (
          'player_profile_details_last_name_check'::text,
          'c'::"char",
          v_relation_oid,
          null::oid,
          array[
            (
              select a.attnum
              from pg_catalog.pg_attribute a
              where a.attrelid = v_relation_oid
                and a.attname = 'last_name'
                and a.attnum > 0
                and not a.attisdropped
            )
          ]::smallint[],
          null::smallint[],
          null::"char",
          null::"char",
          null::"char",
          false,
          false,
          true,
          'check (last_name is null or char_length(last_name) >= 1 and char_length(last_name) <= 256)'::text
        ),
        (
          'player_profile_details_username_check'::text,
          'c'::"char",
          v_relation_oid,
          null::oid,
          array[
            (
              select a.attnum
              from pg_catalog.pg_attribute a
              where a.attrelid = v_relation_oid
                and a.attname = 'username'
                and a.attnum > 0
                and not a.attisdropped
            )
          ]::smallint[],
          null::smallint[],
          null::"char",
          null::"char",
          null::"char",
          false,
          false,
          true,
          'check (username is null or char_length(username) >= 1 and char_length(username) <= 64)'::text
        ),
        (
          'player_profile_details_photo_url_check'::text,
          'c'::"char",
          v_relation_oid,
          null::oid,
          array[
            (
              select a.attnum
              from pg_catalog.pg_attribute a
              where a.attrelid = v_relation_oid
                and a.attname = 'photo_url'
                and a.attnum > 0
                and not a.attisdropped
            )
          ]::smallint[],
          null::smallint[],
          null::"char",
          null::"char",
          null::"char",
          false,
          false,
          true,
          'check (photo_url is null or char_length(photo_url) >= 1 and char_length(photo_url) <= 2048 and lower("left"(btrim(photo_url), 6)) = ''https:''::text)'::text
        ),
        (
          'player_profile_details_language_code_check'::text,
          'c'::"char",
          v_relation_oid,
          null::oid,
          array[
            (
              select a.attnum
              from pg_catalog.pg_attribute a
              where a.attrelid = v_relation_oid
                and a.attname = 'language_code'
                and a.attnum > 0
                and not a.attisdropped
            )
          ]::smallint[],
          null::smallint[],
          null::"char",
          null::"char",
          null::"char",
          false,
          false,
          true,
          'check (language_code is null or char_length(language_code) >= 1 and char_length(language_code) <= 64)'::text
        ),
        (
          'player_profile_details_time_check'::text,
          'c'::"char",
          v_relation_oid,
          null::oid,
          array[
            (
              select a.attnum
              from pg_catalog.pg_attribute a
              where a.attrelid = v_relation_oid
                and a.attname = 'created_at'
                and a.attnum > 0
                and not a.attisdropped
            ),
            (
              select a.attnum
              from pg_catalog.pg_attribute a
              where a.attrelid = v_relation_oid
                and a.attname = 'updated_at'
                and a.attnum > 0
                and not a.attisdropped
            )
          ]::smallint[],
          null::smallint[],
          null::"char",
          null::"char",
          null::"char",
          false,
          false,
          true,
          'check (created_at >= 0 and created_at <= ''9007199254740991''::bigint and updated_at >= created_at and updated_at <= ''9007199254740991''::bigint)'::text
        )
    ),
    actual_constraints as (
      select
        c.conname::text as constraint_name,
        c.contype as constraint_type,
        c.conrelid as constraint_relation,
        case when c.contype = 'f' then c.confrelid end as referenced_relation,
        c.conkey as constrained_columns,
        case when c.contype = 'f' then c.confkey end as referenced_columns,
        case when c.contype = 'f' then c.confupdtype end as update_action,
        case when c.contype = 'f' then c.confdeltype end as delete_action,
        case when c.contype = 'f' then c.confmatchtype end as match_type,
        c.condeferrable as is_deferrable,
        c.condeferred as is_deferred,
        c.convalidated as is_validated,
        pg_catalog.btrim(
          pg_catalog.regexp_replace(
            pg_catalog.lower(pg_catalog.pg_get_constraintdef(c.oid, true)),
            '[[:space:]]+',
            ' ',
            'g'
          )
        ) as normalized_definition
      from pg_catalog.pg_constraint c
      where c.conrelid = v_relation_oid
    ),
    constraint_differences as (
      (
        select * from expected_constraints
        except
        select * from actual_constraints
      )
      union all
      (
        select * from actual_constraints
        except
        select * from expected_constraints
      )
    )
    select 1
    from constraint_differences
  ) then
    raise exception 'POSTCHECK_FAILED: player_profile_details constraints differ';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = v_relation_oid and not t.tgisinternal
  ) then
    raise exception 'POSTCHECK_FAILED: player_profile_details has unexpected triggers';
  end if;

  if pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
     '017_backend_auth_player_profile_details:'
       || backend_auth.relation_fingerprint(v_relation_oid::pg_catalog.regclass) then
    raise exception 'POSTCHECK_FAILED: player_profile_details fingerprint differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    where c.oid = v_relation_oid
      and acl.grantee not in (
        c.relowner,
        'backend_auth_app'::pg_catalog.regrole
      )
  ) then
    raise exception 'POSTCHECK_FAILED: player_profile_details table ACL has an unexpected grantee';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'DELETE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'TRUNCATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'REFERENCES'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_relation_oid, 'TRIGGER'
     ) then
    raise exception 'POSTCHECK_FAILED: player_profile_details table privileges differ';
  end if;

  if exists (
    with expected_column_acl(
      schema_name,
      table_name,
      column_name,
      grantor_name,
      grantee_name,
      privilege_type,
      is_grantable
    ) as (
      values
        (
          'backend_auth'::text,
          'player_profile_details'::text,
          'account_id'::text,
          'backend_auth_owner'::text,
          'backend_auth_app'::text,
          'INSERT'::text,
          false
        ),
        (
          'backend_auth'::text,
          'player_profile_details'::text,
          'first_name'::text,
          'backend_auth_owner'::text,
          'backend_auth_app'::text,
          'INSERT'::text,
          false
        ),
        (
          'backend_auth'::text,
          'player_profile_details'::text,
          'last_name'::text,
          'backend_auth_owner'::text,
          'backend_auth_app'::text,
          'INSERT'::text,
          false
        ),
        (
          'backend_auth'::text,
          'player_profile_details'::text,
          'username'::text,
          'backend_auth_owner'::text,
          'backend_auth_app'::text,
          'INSERT'::text,
          false
        ),
        (
          'backend_auth'::text,
          'player_profile_details'::text,
          'photo_url'::text,
          'backend_auth_owner'::text,
          'backend_auth_app'::text,
          'INSERT'::text,
          false
        ),
        (
          'backend_auth'::text,
          'player_profile_details'::text,
          'language_code'::text,
          'backend_auth_owner'::text,
          'backend_auth_app'::text,
          'INSERT'::text,
          false
        ),
        (
          'backend_auth'::text,
          'player_profile_details'::text,
          'created_at'::text,
          'backend_auth_owner'::text,
          'backend_auth_app'::text,
          'INSERT'::text,
          false
        ),
        (
          'backend_auth'::text,
          'player_profile_details'::text,
          'updated_at'::text,
          'backend_auth_owner'::text,
          'backend_auth_app'::text,
          'INSERT'::text,
          false
        )
    ),
    actual_column_acl as (
      select
        n.nspname::text as schema_name,
        c.relname::text as table_name,
        a.attname::text as column_name,
        pg_catalog.pg_get_userbyid(acl.grantor)::text as grantor_name,
        pg_catalog.pg_get_userbyid(acl.grantee)::text as grantee_name,
        acl.privilege_type::text,
        acl.is_grantable
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      cross join lateral pg_catalog.aclexplode(a.attacl) acl
      where a.attrelid = v_relation_oid
        and a.attnum > 0
        and not a.attisdropped
    ),
    column_acl_differences as (
      (
        select * from expected_column_acl
        except
        select * from actual_column_acl
      )
      union all
      (
        select * from actual_column_acl
        except
        select * from expected_column_acl
      )
    )
    select 1
    from column_acl_differences
  ) then
    raise exception 'POSTCHECK_FAILED: player_profile_details column ACL differs';
  end if;

  foreach v_column in array array[
    'account_id',
    'first_name',
    'last_name',
    'username',
    'photo_url',
    'language_code',
    'created_at',
    'updated_at'
  ]::text[]
  loop
    if not pg_catalog.has_column_privilege(
         'backend_auth_app', v_relation_oid, v_column, 'INSERT'
       )
       or pg_catalog.has_column_privilege(
         'backend_auth_app', v_relation_oid, v_column, 'UPDATE'
       ) then
      raise exception 'POSTCHECK_FAILED: column privileges differ for %',
        v_column;
    end if;
  end loop;

  if (select pg_catalog.count(*) from backend_auth.player_profile_details) <> 0 then
    raise exception 'POSTCHECK_FAILED: migration must leave player_profile_details empty';
  end if;

  for v_expected in
    select *
    from (values
      ('accounts'),
      ('player_profiles'),
      ('external_identities'),
      ('external_identity_lookup_digests'),
      ('authentication_operations'),
      ('telegram_proof_consumptions'),
      ('auth_session_families'),
      ('auth_session_credentials'),
      ('auth_session_commands'),
      ('fresh_authentication_evidence'),
      ('reauthentication_grants'),
      ('otp_challenges'),
      ('otp_commands'),
      ('security_audit_events')
    ) expected(table_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'backend_auth'
        and c.relname = v_expected.table_name
        and c.relkind = 'r'
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '015_backend_auth_foundation:'
            || backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass)
    ) then
      raise exception 'POSTCHECK_FAILED: existing backend_auth.% structure or fingerprint changed',
        v_expected.table_name;
    end if;
  end loop;
end;
$postcheck$;

with row_counts(table_name, row_count) as (
  select 'accounts', pg_catalog.count(*) from backend_auth.accounts
  union all select 'player_profiles', pg_catalog.count(*) from backend_auth.player_profiles
  union all select 'player_profile_details', pg_catalog.count(*) from backend_auth.player_profile_details
  union all select 'external_identities', pg_catalog.count(*) from backend_auth.external_identities
  union all select 'external_identity_lookup_digests', pg_catalog.count(*) from backend_auth.external_identity_lookup_digests
  union all select 'authentication_operations', pg_catalog.count(*) from backend_auth.authentication_operations
  union all select 'telegram_proof_consumptions', pg_catalog.count(*) from backend_auth.telegram_proof_consumptions
  union all select 'auth_session_families', pg_catalog.count(*) from backend_auth.auth_session_families
  union all select 'auth_session_credentials', pg_catalog.count(*) from backend_auth.auth_session_credentials
  union all select 'auth_session_commands', pg_catalog.count(*) from backend_auth.auth_session_commands
  union all select 'fresh_authentication_evidence', pg_catalog.count(*) from backend_auth.fresh_authentication_evidence
  union all select 'reauthentication_grants', pg_catalog.count(*) from backend_auth.reauthentication_grants
  union all select 'otp_challenges', pg_catalog.count(*) from backend_auth.otp_challenges
  union all select 'otp_commands', pg_catalog.count(*) from backend_auth.otp_commands
  union all select 'security_audit_events', pg_catalog.count(*) from backend_auth.security_audit_events
),
relation_state as (
  select
    c.relname as table_name,
    backend_auth.relation_fingerprint(c.oid::pg_catalog.regclass) as fingerprint,
    pg_catalog.obj_description(c.oid, 'pg_class') as comment
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth' and c.relkind = 'r'
)
select pg_catalog.jsonb_build_object(
  'postcheck_ok', true,
  'catalog_counts', pg_catalog.jsonb_build_object(
    'tables', 15,
    'constraints', 154,
    'table_constraints', 139,
    'constraint_trigger_constraints', 15,
    'user_triggers', 33
  ),
  'row_counts', (
    select pg_catalog.jsonb_object_agg(
      row_counts.table_name,
      row_counts.row_count
      order by row_counts.table_name
    )
    from row_counts
  ),
  'relation_state', (
    select pg_catalog.jsonb_object_agg(
      relation_state.table_name,
      pg_catalog.jsonb_build_object(
        'fingerprint', relation_state.fingerprint,
        'comment', relation_state.comment
      )
      order by relation_state.table_name
    )
    from relation_state
  )
) as backend_auth_player_profile_details_postcheck;

reset role;
rollback;
