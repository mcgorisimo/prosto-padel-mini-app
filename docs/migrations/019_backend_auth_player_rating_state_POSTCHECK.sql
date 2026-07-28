-- 019_backend_auth_player_rating_state_POSTCHECK.sql
-- Read-only verification for the private default backend rating state.

begin;
set transaction read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $role_precheck$
begin
  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null
     or not pg_catalog.pg_has_role(
       current_user,
       'backend_auth_owner',
       'MEMBER'
     ) then
    raise exception 'POSTCHECK_FAILED: required role boundary is unavailable';
  end if;
end;
$role_precheck$;

set local role backend_auth_owner;

do $postcheck$
declare
  v_relation_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_rating_states')::oid;
  v_profiles_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profiles')::oid;
  v_details_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
  v_difference_count bigint;
  v_count bigint;
  v_expected record;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'POSTCHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if v_relation_oid is null
     or pg_catalog.pg_get_userbyid(
       (select c.relowner
        from pg_catalog.pg_class c
        where c.oid = v_relation_oid)
     ) <> 'backend_auth_owner'
     or pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
       '019_backend_auth_player_rating_state:'
         || backend_auth.relation_fingerprint(
           v_relation_oid::pg_catalog.regclass
         ) then
    raise exception 'POSTCHECK_FAILED: player_rating_states owner or fingerprint differs';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class c
    where c.oid = v_relation_oid
      and c.relkind = 'r'
      and c.relpersistence = 'p'
      and not c.relrowsecurity
      and not c.relforcerowsecurity
  ) then
    raise exception 'POSTCHECK_FAILED: player_rating_states relation mode differs';
  end if;

  with expected(
    column_position,
    column_name,
    data_type,
    not_null,
    default_expression
  ) as (
    values
      (1, 'account_id'::text, 'uuid'::text, true, null::text),
      (2, 'rating'::text, 'numeric(4,2)'::text, true, '3.00'::text),
      (3, 'is_verified'::text, 'boolean'::text, true, 'false'::text),
      (4, 'created_at'::text, 'bigint'::text, true, null::text),
      (5, 'updated_at'::text, 'bigint'::text, true, null::text)
  ),
  actual as (
    select
      a.attnum::integer,
      a.attname::text,
      pg_catalog.format_type(a.atttypid, a.atttypmod),
      a.attnotnull,
      pg_catalog.pg_get_expr(d.adbin, d.adrelid, true)
    from pg_catalog.pg_attribute a
    left join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid
     and d.adnum = a.attnum
    where a.attrelid = v_relation_oid
      and a.attnum > 0
      and not a.attisdropped
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*)
    into v_difference_count
  from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: player_rating_states columns or defaults differ';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_constraint c
      where c.conrelid = v_relation_oid) <> 4 then
    raise exception 'POSTCHECK_FAILED: player_rating_states constraint count differs';
  end if;

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
        'player_rating_states_pkey'::text,
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
        'player_rating_states_account_id_fkey'::text,
        'f'::"char",
        v_relation_oid,
        v_profiles_oid,
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
            where a.attrelid = v_profiles_oid
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
        'player_rating_states_rating_check'::text,
        'c'::"char",
        v_relation_oid,
        null::oid,
        array[
          (
            select a.attnum
            from pg_catalog.pg_attribute a
            where a.attrelid = v_relation_oid
              and a.attname = 'rating'
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
        'check (rating >= 0.00 and rating <= 10.00)'::text
      ),
      (
        'player_rating_states_time_check'::text,
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
      c.conname::text,
      c.contype,
      c.conrelid,
      case when c.contype = 'f' then c.confrelid end,
      c.conkey,
      case when c.contype = 'f' then c.confkey end,
      case when c.contype = 'f' then c.confupdtype end,
      case when c.contype = 'f' then c.confdeltype end,
      case when c.contype = 'f' then c.confmatchtype end,
      c.condeferrable,
      c.condeferred,
      c.convalidated,
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.lower(
            pg_catalog.pg_get_constraintdef(c.oid, true)
          ),
          '[[:space:]]+',
          ' ',
          'g'
        )
      )
    from pg_catalog.pg_constraint c
    where c.conrelid = v_relation_oid
  ),
  differences as (
    (select * from expected_constraints except select * from actual_constraints)
    union all
    (select * from actual_constraints except select * from expected_constraints)
  )
  select pg_catalog.count(*)
    into v_difference_count
  from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: player_rating_states constraints differ';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_index i
      where i.indrelid = v_relation_oid) <> 1
     or not exists (
       select 1
       from pg_catalog.pg_index i
       join pg_catalog.pg_class c on c.oid = i.indexrelid
       where i.indrelid = v_relation_oid
         and c.relname = 'player_rating_states_pkey'
         and i.indisprimary
         and i.indisunique
         and i.indisvalid
         and i.indisready
         and i.indnkeyatts = 1
         and i.indnatts = 1
         and i.indkey[0] = (
           select a.attnum
           from pg_catalog.pg_attribute a
           where a.attrelid = v_relation_oid
             and a.attname = 'account_id'
             and a.attnum > 0
             and not a.attisdropped
         )
     ) then
    raise exception 'POSTCHECK_FAILED: player_rating_states indexes differ';
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
      ('backend_auth', 'player_rating_states', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false)
  ),
  actual as (
    select
      n.nspname::text,
      c.relname::text,
      grantor.rolname::text,
      case
        when acl.grantee = 0 then 'PUBLIC'::text
        else grantee.rolname::text
      end,
      acl.privilege_type::text,
      acl.is_grantable
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        c.relacl,
        pg_catalog.acldefault('r', c.relowner)
      )
    ) acl
    join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
    left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where c.oid = v_relation_oid
      and acl.grantee <> c.relowner
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*)
    into v_difference_count
  from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: player_rating_states table ACL differs';
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
      ('backend_auth', 'player_rating_states', 'account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_auth', 'player_rating_states', 'created_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_auth', 'player_rating_states', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false)
  ),
  actual as (
    select
      n.nspname::text,
      c.relname::text,
      a.attname::text,
      grantor.rolname::text,
      case
        when acl.grantee = 0 then 'PUBLIC'::text
        else grantee.rolname::text
      end,
      acl.privilege_type::text,
      acl.is_grantable
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(a.attacl) acl
    join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
    left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where a.attrelid = v_relation_oid
      and a.attnum > 0
      and not a.attisdropped
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*)
    into v_difference_count
  from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: player_rating_states column ACL differs';
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
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', v_relation_oid, 'rating', 'INSERT'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', v_relation_oid, 'rating', 'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', v_relation_oid, 'is_verified', 'INSERT'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', v_relation_oid, 'is_verified', 'UPDATE'
     ) then
    raise exception 'POSTCHECK_FAILED: player_rating_states runtime privileges differ';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = v_relation_oid
      and not t.tgisinternal
  ) then
    raise exception 'POSTCHECK_FAILED: player_rating_states has an unexpected trigger';
  end if;

  if exists (
    select 1
    from backend_auth.player_rating_states states
    join backend_auth.accounts accounts on accounts.id = states.account_id
    where states.rating <> 3.00
       or states.is_verified
       or states.created_at <> accounts.created_at
       or states.updated_at <> accounts.updated_at
  )
     or exists (
       select profiles.account_id
       from backend_auth.player_profiles profiles
       except
       select states.account_id
       from backend_auth.player_rating_states states
     )
     or exists (
       select states.account_id
       from backend_auth.player_rating_states states
       except
       select profiles.account_id
       from backend_auth.player_profiles profiles
     ) then
    raise exception 'POSTCHECK_FAILED: default backend rating state differs';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and c.relkind = 'r';

  if v_count <> 16 then
    raise exception 'POSTCHECK_FAILED: expected 16 backend_auth tables, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint c
  join pg_catalog.pg_namespace n on n.oid = c.connamespace
  where n.nspname = 'backend_auth';

  if v_count <> 160 then
    raise exception 'POSTCHECK_FAILED: expected 160 backend_auth constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and not t.tgisinternal;

  if v_count <> 33 then
    raise exception 'POSTCHECK_FAILED: expected 33 backend_auth user triggers, found %',
      v_count;
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
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'POSTCHECK_FAILED: existing backend_auth.% structure or fingerprint changed',
        v_expected.table_name;
    end if;
  end loop;

  if v_details_oid is null
     or pg_catalog.obj_description(v_details_oid, 'pg_class') is distinct from
       '018_backend_auth_player_profile_editable_fields:'
         || backend_auth.relation_fingerprint(
           v_details_oid::pg_catalog.regclass
         ) then
    raise exception 'POSTCHECK_FAILED: player_profile_details changed';
  end if;
end;
$postcheck$;

with row_counts(table_name, row_count) as (
  select 'accounts', pg_catalog.count(*) from backend_auth.accounts
  union all select 'player_profiles', pg_catalog.count(*) from backend_auth.player_profiles
  union all select 'player_profile_details', pg_catalog.count(*) from backend_auth.player_profile_details
  union all select 'player_rating_states', pg_catalog.count(*) from backend_auth.player_rating_states
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
    backend_auth.relation_fingerprint(
      c.oid::pg_catalog.regclass
    ) as fingerprint
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'backend_auth'
    and c.relkind = 'r'
)
select pg_catalog.jsonb_build_object(
  'migration', '019_backend_auth_player_rating_state',
  'ready', true,
  'catalog_counts', pg_catalog.jsonb_build_object(
    'tables', 16,
    'constraints', 160,
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
  'relation_fingerprints', (
    select pg_catalog.jsonb_object_agg(
      relation_state.table_name,
      relation_state.fingerprint
      order by relation_state.table_name
    )
    from relation_state
  )
) as backend_auth_player_rating_state_postcheck;

reset role;
rollback;
