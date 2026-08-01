-- Read-only postcheck for 026_backend_match_rating_applications.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_applications oid := pg_catalog.to_regclass(
    'backend_match.match_rating_applications'
  )::oid;
  v_changes oid := pg_catalog.to_regclass(
    'backend_match.match_rating_changes'
  )::oid;
  v_results oid := pg_catalog.to_regclass('backend_match.match_results')::oid;
  v_profiles oid := pg_catalog.to_regclass('backend_auth.player_profiles')::oid;
  v_rating_states oid := pg_catalog.to_regclass(
    'backend_auth.player_rating_states'
  )::oid;
  v_relation record;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'POSTCHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if v_applications is null or v_changes is null or v_results is null
     or v_profiles is null or v_rating_states is null then
    raise exception 'POSTCHECK_FAILED: required relation is missing';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_match', 'match_rating_applications'),
      ('backend_match', 'match_rating_changes'),
      ('backend_auth', 'player_rating_states')
    ) expected(schema_name, relation_name)
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
          '026_backend_match_rating_applications:'
            || backend_auth.relation_fingerprint(relation.oid::pg_catalog.regclass)
    ) then
      raise exception 'POSTCHECK_FAILED: %.% metadata or fingerprint differs',
        v_relation.schema_name,
        v_relation.relation_name;
    end if;
  end loop;

  if exists (
    with expected(
      table_name,
      ordinal,
      column_name,
      data_type,
      not_null,
      identity_kind,
      generated_kind,
      default_expression
    ) as (
      values
        ('match_rating_applications', 1, 'result_id', 'uuid', true, '', '', null::text),
        ('match_rating_applications', 2, 'match_id', 'uuid', true, '', '', null::text),
        ('match_rating_applications', 3, 'result_version', 'bigint', true, '', '', null::text),
        ('match_rating_applications', 4, 'winning_team', 'smallint', true, '', '', null::text),
        ('match_rating_applications', 5, 'team1_average_before', 'numeric(5,3)', true, '', '', null::text),
        ('match_rating_applications', 6, 'team2_average_before', 'numeric(5,3)', true, '', '', null::text),
        ('match_rating_applications', 7, 'expected_team1', 'numeric(7,6)', true, '', '', null::text),
        ('match_rating_applications', 8, 'formula_version', 'text', true, '', '', null::text),
        ('match_rating_applications', 9, 'applied_by_account_id', 'uuid', true, '', '', null::text),
        ('match_rating_applications', 10, 'applied_at', 'bigint', true, '', '', null::text),
        ('match_rating_changes', 1, 'result_id', 'uuid', true, '', '', null::text),
        ('match_rating_changes', 2, 'match_id', 'uuid', true, '', '', null::text),
        ('match_rating_changes', 3, 'account_id', 'uuid', true, '', '', null::text),
        ('match_rating_changes', 4, 'team_number', 'smallint', true, '', '', null::text),
        ('match_rating_changes', 5, 'court_side', 'text', true, '', '', null::text),
        ('match_rating_changes', 6, 'rating_before', 'numeric(4,2)', true, '', '', null::text),
        ('match_rating_changes', 7, 'rating_delta', 'numeric(4,2)', true, '', '', null::text),
        ('match_rating_changes', 8, 'rating_after', 'numeric(4,2)', true, '', '', null::text),
        ('match_rating_changes', 9, 'rated_matches_before', 'bigint', true, '', '', null::text),
        ('match_rating_changes', 10, 'k_factor', 'numeric(2,1)', true, '', '', null::text),
        ('match_rating_changes', 11, 'expected_score', 'numeric(7,6)', true, '', '', null::text),
        ('match_rating_changes', 12, 'applied_at', 'bigint', true, '', '', null::text)
    ),
    actual as (
      select
        relation.relname::text,
        attribute.attnum::integer,
        attribute.attname::text,
        pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)::text,
        attribute.attnotnull,
        attribute.attidentity::text,
        attribute.attgenerated::text,
        pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid, true)
      from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
      left join pg_catalog.pg_attrdef default_row
        on default_row.adrelid = attribute.attrelid
       and default_row.adnum = attribute.attnum
      where attribute.attrelid = any (array[v_applications, v_changes])
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: rating audit column allowlist differs';
  end if;

  if exists (
    with expected(
      table_name,
      constraint_name,
      constraint_type,
      is_deferrable,
      is_deferred,
      is_validated
    ) as (
      values
        ('match_rating_applications', 'match_rating_applications_pkey', 'p', false, false, true),
        ('match_rating_applications', 'match_rating_applications_match_id_key', 'u', false, false, true),
        ('match_rating_applications', 'match_rating_applications_identity_key', 'u', false, false, true),
        ('match_rating_applications', 'match_rating_applications_result_fkey', 'f', false, false, true),
        ('match_rating_applications', 'match_rating_applications_actor_fkey', 'f', false, false, true),
        ('match_rating_applications', 'match_rating_applications_result_version_check', 'c', false, false, true),
        ('match_rating_applications', 'match_rating_applications_winning_team_check', 'c', false, false, true),
        ('match_rating_applications', 'match_rating_applications_averages_check', 'c', false, false, true),
        ('match_rating_applications', 'match_rating_applications_expected_check', 'c', false, false, true),
        ('match_rating_applications', 'match_rating_applications_formula_check', 'c', false, false, true),
        ('match_rating_applications', 'match_rating_applications_time_check', 'c', false, false, true),
        ('match_rating_changes', 'match_rating_changes_pkey', 'p', false, false, true),
        ('match_rating_changes', 'match_rating_changes_slot_key', 'u', false, false, true),
        ('match_rating_changes', 'match_rating_changes_application_fkey', 'f', false, false, true),
        ('match_rating_changes', 'match_rating_changes_account_fkey', 'f', false, false, true),
        ('match_rating_changes', 'match_rating_changes_team_check', 'c', false, false, true),
        ('match_rating_changes', 'match_rating_changes_side_check', 'c', false, false, true),
        ('match_rating_changes', 'match_rating_changes_rating_check', 'c', false, false, true),
        ('match_rating_changes', 'match_rating_changes_count_check', 'c', false, false, true),
        ('match_rating_changes', 'match_rating_changes_k_factor_check', 'c', false, false, true),
        ('match_rating_changes', 'match_rating_changes_expected_check', 'c', false, false, true),
        ('match_rating_changes', 'match_rating_changes_time_check', 'c', false, false, true)
    ),
    actual as (
      select
        relation.relname::text,
        constraint_row.conname::text,
        constraint_row.contype::text,
        constraint_row.condeferrable,
        constraint_row.condeferred,
        constraint_row.convalidated
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      where constraint_row.conrelid = any (array[v_applications, v_changes])
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: rating audit constraint allowlist differs';
  end if;

  if exists (
    with expected(
      table_name,
      constraint_name,
      local_columns,
      referenced_schema,
      referenced_table,
      referenced_columns
    ) as (
      values
        (
          'match_rating_applications',
          'match_rating_applications_result_fkey',
          array['result_id', 'match_id']::text[],
          'backend_match',
          'match_results',
          array['id', 'match_id']::text[]
        ),
        (
          'match_rating_applications',
          'match_rating_applications_actor_fkey',
          array['applied_by_account_id']::text[],
          'backend_auth',
          'player_profiles',
          array['account_id']::text[]
        ),
        (
          'match_rating_changes',
          'match_rating_changes_application_fkey',
          array['result_id', 'match_id']::text[],
          'backend_match',
          'match_rating_applications',
          array['result_id', 'match_id']::text[]
        ),
        (
          'match_rating_changes',
          'match_rating_changes_account_fkey',
          array['account_id']::text[],
          'backend_auth',
          'player_rating_states',
          array['account_id']::text[]
        )
    ),
    actual as (
      select
        local_relation.relname::text,
        constraint_row.conname::text,
        array(
          select attribute.attname::text
          from pg_catalog.unnest(constraint_row.conkey)
            with ordinality key_column(attnum, position)
          join pg_catalog.pg_attribute attribute
            on attribute.attrelid = constraint_row.conrelid
           and attribute.attnum = key_column.attnum
          order by key_column.position
        ),
        referenced_namespace.nspname::text,
        referenced_relation.relname::text,
        array(
          select attribute.attname::text
          from pg_catalog.unnest(constraint_row.confkey)
            with ordinality key_column(attnum, position)
          join pg_catalog.pg_attribute attribute
            on attribute.attrelid = constraint_row.confrelid
           and attribute.attnum = key_column.attnum
          order by key_column.position
        )
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class local_relation on local_relation.oid = constraint_row.conrelid
      join pg_catalog.pg_class referenced_relation on referenced_relation.oid = constraint_row.confrelid
      join pg_catalog.pg_namespace referenced_namespace
        on referenced_namespace.oid = referenced_relation.relnamespace
      where constraint_row.conrelid = any (array[v_applications, v_changes])
        and constraint_row.contype = 'f'
        and constraint_row.confmatchtype = 's'
        and constraint_row.confupdtype = 'a'
        and constraint_row.confdeltype = 'a'
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: rating audit foreign keys differ';
  end if;

  if exists (
    with expected(table_name, constraint_name, definition) as (
      values
        ('match_rating_applications', 'match_rating_applications_result_version_check', 'check (result_version >= 2 and result_version <= ''9007199254740991''::bigint)'),
        ('match_rating_applications', 'match_rating_applications_winning_team_check', 'check (winning_team = 1 or winning_team = 2)'),
        ('match_rating_applications', 'match_rating_applications_averages_check', 'check (team1_average_before >= 0.000 and team1_average_before <= 10.000 and team2_average_before >= 0.000 and team2_average_before <= 10.000)'),
        ('match_rating_applications', 'match_rating_applications_expected_check', 'check (expected_team1 > 0.000000 and expected_team1 < 1.000000)'),
        ('match_rating_applications', 'match_rating_applications_formula_check', 'check (formula_version = ''doubles_elo_v1''::text)'),
        ('match_rating_applications', 'match_rating_applications_time_check', 'check (applied_at >= 0 and applied_at <= ''9007199254740991''::bigint)'),
        ('match_rating_changes', 'match_rating_changes_team_check', 'check (team_number = 1 or team_number = 2)'),
        ('match_rating_changes', 'match_rating_changes_side_check', 'check (court_side = ''left''::text or court_side = ''right''::text)'),
        ('match_rating_changes', 'match_rating_changes_rating_check', 'check (rating_before >= 0.00 and rating_before <= 10.00 and rating_after >= 0.00 and rating_after <= 10.00 and rating_delta >= ''-10.00''::numeric and rating_delta <= 10.00 and rating_after = rating_before + rating_delta)'),
        ('match_rating_changes', 'match_rating_changes_count_check', 'check (rated_matches_before >= 0 and rated_matches_before <= ''9007199254740991''::bigint)'),
        ('match_rating_changes', 'match_rating_changes_k_factor_check', 'check (rated_matches_before < 10 and k_factor = 0.4 or rated_matches_before >= 10 and k_factor = 0.1)'),
        ('match_rating_changes', 'match_rating_changes_expected_check', 'check (expected_score > 0.000000 and expected_score < 1.000000)'),
        ('match_rating_changes', 'match_rating_changes_time_check', 'check (applied_at >= 0 and applied_at <= ''9007199254740991''::bigint)')
    ),
    actual as (
      select
        relation.relname::text,
        constraint_row.conname::text,
        pg_catalog.btrim(pg_catalog.regexp_replace(
          pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
          '[[:space:]]+',
          ' ',
          'g'
        ))
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      where constraint_row.conrelid = any (array[v_applications, v_changes])
        and constraint_row.contype = 'c'
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: rating audit CHECK definitions differ';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indrelid = any (array[v_applications, v_changes])
      and (
        not index_row.indisvalid
        or not index_row.indisready
        or index_row.indisexclusion
        or index_row.indpred is not null
        or index_row.indexprs is not null
        or index_row.indnatts <> index_row.indnkeyatts
      )
  ) then
    raise exception 'POSTCHECK_FAILED: rating audit has a noncanonical index';
  end if;

  if exists (
    with expected(
      table_name,
      index_name,
      access_method,
      is_unique,
      is_primary,
      columns
    ) as (
      values
        ('match_rating_applications', 'match_rating_applications_pkey', 'btree', true, true, array['result_id']::text[]),
        ('match_rating_applications', 'match_rating_applications_match_id_key', 'btree', true, false, array['match_id']::text[]),
        ('match_rating_applications', 'match_rating_applications_identity_key', 'btree', true, false, array['result_id', 'match_id']::text[]),
        ('match_rating_applications', 'match_rating_applications_actor_history_idx', 'btree', false, false, array['applied_by_account_id', 'applied_at', 'result_id']::text[]),
        ('match_rating_applications', 'match_rating_applications_applied_at_idx', 'btree', false, false, array['applied_at', 'result_id']::text[]),
        ('match_rating_changes', 'match_rating_changes_pkey', 'btree', true, true, array['result_id', 'account_id']::text[]),
        ('match_rating_changes', 'match_rating_changes_slot_key', 'btree', true, false, array['result_id', 'team_number', 'court_side']::text[]),
        ('match_rating_changes', 'match_rating_changes_account_history_idx', 'btree', false, false, array['account_id', 'applied_at', 'result_id']::text[]),
        ('match_rating_changes', 'match_rating_changes_match_idx', 'btree', false, false, array['match_id', 'result_id', 'account_id']::text[])
    ),
    actual as (
      select
        relation.relname::text,
        index_relation.relname::text,
        access_method.amname::text,
        index_row.indisunique,
        index_row.indisprimary,
        array(
          select pg_catalog.pg_get_indexdef(index_row.indexrelid, position, true)
          from pg_catalog.generate_series(1, index_row.indnkeyatts) position
          order by position
        )
      from pg_catalog.pg_index index_row
      join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
      join pg_catalog.pg_class index_relation on index_relation.oid = index_row.indexrelid
      join pg_catalog.pg_am access_method on access_method.oid = index_relation.relam
      where index_row.indrelid = any (array[v_applications, v_changes])
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: rating audit index allowlist differs';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app', v_applications, 'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app', v_applications, 'INSERT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app', v_changes, 'SELECT'
     )
     or not pg_catalog.has_table_privilege(
       'backend_auth_app', v_changes, 'INSERT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_applications, 'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_changes, 'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
  ) then
    raise exception 'POSTCHECK_FAILED: rating audit table privileges differ';
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
        ('backend_match', 'match_rating_applications', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
        ('backend_match', 'match_rating_applications', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        ('backend_match', 'match_rating_changes', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
        ('backend_match', 'match_rating_changes', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        ('backend_auth', 'player_rating_states', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false)
    ),
    actual as (
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
      where relation.oid = any (array[v_applications, v_changes, v_rating_states])
        and acl_row.grantee <> relation.relowner
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: rating storage table ACL differs';
  end if;

  if not pg_catalog.has_column_privilege(
       'backend_auth_app', v_rating_states, 'rating', 'UPDATE'
     )
     or not pg_catalog.has_column_privilege(
       'backend_auth_app', v_rating_states, 'updated_at', 'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', v_rating_states, 'account_id', 'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', v_rating_states, 'is_verified', 'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', v_rating_states, 'created_at', 'UPDATE'
  ) then
    raise exception 'POSTCHECK_FAILED: rating writer column boundary differs';
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
        ('backend_auth', 'player_rating_states', 'account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        ('backend_auth', 'player_rating_states', 'rating', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
        ('backend_auth', 'player_rating_states', 'created_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        ('backend_auth', 'player_rating_states', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
        ('backend_auth', 'player_rating_states', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false)
    ),
    actual as (
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
      where attribute.attrelid = v_rating_states
        and attribute.attnum > 0
        and not attribute.attisdropped
    )
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  ) then
    raise exception 'POSTCHECK_FAILED: player_rating_states column ACL differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_trigger trigger_row
    where trigger_row.tgrelid = any (array[v_applications, v_changes])
      and not trigger_row.tgisinternal
  ) then
    raise exception 'POSTCHECK_FAILED: rating audit user trigger exists';
  end if;

  if exists (select 1 from backend_match.match_rating_applications)
     or exists (select 1 from backend_match.match_rating_changes) then
    raise exception 'POSTCHECK_FAILED: rating audit storage is not empty';
  end if;

  if exists (
    select 1
    from backend_match.match_results result_row
    join backend_match.matches match_row on match_row.id = result_row.match_id
    left join backend_match.match_rating_applications application_row
      on application_row.result_id = result_row.id
     and application_row.match_id = result_row.match_id
    where match_row.is_rating_match
      and result_row.status = 'confirmed'
      and application_row.result_id is null
  ) then
    raise exception 'POSTCHECK_FAILED: confirmed rating result has no rating application';
  end if;

  if (select pg_catalog.count(*) from backend_auth.player_profiles) <>
     (select pg_catalog.count(*) from backend_auth.player_rating_states) then
    raise exception 'POSTCHECK_FAILED: player rating state coverage differs';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '026_backend_match_rating_applications',
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
    'user_triggers', (
      select pg_catalog.count(*)
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_match' and not trigger_row.tgisinternal
    )
  ),
  'row_counts', pg_catalog.jsonb_build_object(
    'matches', (select pg_catalog.count(*) from backend_match.matches),
    'match_results', (select pg_catalog.count(*) from backend_match.match_results),
    'match_result_commands', (
      select pg_catalog.count(*) from backend_match.match_result_commands
    ),
    'confirmed_rating_results', (
      select pg_catalog.count(*)
      from backend_match.match_results result_row
      join backend_match.matches match_row on match_row.id = result_row.match_id
      where match_row.is_rating_match
        and result_row.status = 'confirmed'
    ),
    'player_profiles', (select pg_catalog.count(*) from backend_auth.player_profiles),
    'player_rating_states', (
      select pg_catalog.count(*) from backend_auth.player_rating_states
    ),
    'match_rating_applications', (
      select pg_catalog.count(*) from backend_match.match_rating_applications
    ),
    'match_rating_changes', (
      select pg_catalog.count(*) from backend_match.match_rating_changes
    )
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'matches', backend_auth.relation_fingerprint(
      'backend_match.matches'::pg_catalog.regclass
    ),
    'match_results', backend_auth.relation_fingerprint(
      'backend_match.match_results'::pg_catalog.regclass
    ),
    'match_result_commands', backend_auth.relation_fingerprint(
      'backend_match.match_result_commands'::pg_catalog.regclass
    ),
    'player_profiles', backend_auth.relation_fingerprint(
      'backend_auth.player_profiles'::pg_catalog.regclass
    ),
    'player_rating_states', backend_auth.relation_fingerprint(
      'backend_auth.player_rating_states'::pg_catalog.regclass
    ),
    'match_rating_applications', backend_auth.relation_fingerprint(
      'backend_match.match_rating_applications'::pg_catalog.regclass
    ),
    'match_rating_changes', backend_auth.relation_fingerprint(
      'backend_match.match_rating_changes'::pg_catalog.regclass
    )
  )
) as backend_match_rating_applications_postcheck;

rollback;
