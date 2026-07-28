-- 020_backend_match_storage_POSTCHECK.sql
-- Read-only verification for empty private backend-owned match storage.

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
  v_matches_oid oid := pg_catalog.to_regclass('backend_match.matches')::oid;
  v_participants_oid oid :=
    pg_catalog.to_regclass('backend_match.match_participants')::oid;
  v_commands_oid oid :=
    pg_catalog.to_regclass('backend_match.match_commands')::oid;
  v_profiles_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profiles')::oid;
  v_extension_schema text;
  v_difference_count bigint;
  v_count bigint;
  v_expected record;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'POSTCHECK_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if pg_catalog.to_regnamespace('backend_match') is null
     or pg_catalog.pg_get_userbyid(
       (select n.nspowner
        from pg_catalog.pg_namespace n
        where n.nspname = 'backend_match')
     ) <> 'backend_auth_owner'
     or pg_catalog.obj_description(
       pg_catalog.to_regnamespace('backend_match'),
       'pg_namespace'
     ) is distinct from
       '020_backend_match_storage:private backend-owned match aggregate' then
    raise exception 'POSTCHECK_FAILED: backend_match schema owner or marker differs';
  end if;

  with expected(
    schema_name,
    grantor,
    grantee,
    privilege_type,
    is_grantable
  ) as (
    values
      (
        'backend_match'::text,
        'backend_auth_owner'::text,
        'backend_auth_app'::text,
        'USAGE'::text,
        false
      )
  ),
  actual as (
    select
      n.nspname::text,
      grantor.rolname::text,
      case
        when acl.grantee = 0 then 'PUBLIC'::text
        else grantee.rolname::text
      end,
      acl.privilege_type::text,
      acl.is_grantable
    from pg_catalog.pg_namespace n
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        n.nspacl,
        pg_catalog.acldefault('n', n.nspowner)
      )
    ) acl
    join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
    left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where n.nspname = 'backend_match'
      and acl.grantee <> n.nspowner
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*)
    into v_difference_count
  from differences;

  if v_difference_count <> 0
     or not pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'USAGE'
     )
     or pg_catalog.has_schema_privilege(
       'backend_auth_app',
       'backend_match',
       'CREATE'
     ) then
    raise exception 'POSTCHECK_FAILED: backend_match schema ACL differs';
  end if;

  if v_matches_oid is null
     or v_participants_oid is null
     or v_commands_oid is null
     or v_profiles_oid is null then
    raise exception 'POSTCHECK_FAILED: required relations are missing';
  end if;

  with expected(
    object_name,
    object_kind
  ) as (
    values
      ('matches'::text, 'r'::"char"),
      ('matches_pkey'::text, 'i'::"char"),
      ('matches_no_active_court_overlap'::text, 'i'::"char"),
      ('matches_owner_starts_at_idx'::text, 'i'::"char"),
      ('matches_feed_idx'::text, 'i'::"char"),
      ('match_participants'::text, 'r'::"char"),
      ('match_participants_pkey'::text, 'i'::"char"),
      ('match_participants_active_slot_key'::text, 'i'::"char"),
      ('match_participants_active_account_key'::text, 'i'::"char"),
      ('match_participants_match_history_idx'::text, 'i'::"char"),
      ('match_participants_account_history_idx'::text, 'i'::"char"),
      ('match_commands'::text, 'r'::"char"),
      ('match_commands_pkey'::text, 'i'::"char"),
      ('match_commands_match_sequence_key'::text, 'i'::"char"),
      ('match_commands_actor_applied_at_idx'::text, 'i'::"char"),
      ('match_commands_participant_id_idx'::text, 'i'::"char")
  ),
  actual as (
    select c.relname::text, c.relkind
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'backend_match'
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
    raise exception 'POSTCHECK_FAILED: backend_match object allowlist differs';
  end if;

  for v_expected in
    select *
    from (values
      ('matches', v_matches_oid, 21),
      ('match_participants', v_participants_oid, 9),
      ('match_commands', v_commands_oid, 10)
    ) expected(table_name, relation_oid, column_count)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class c
      where c.oid = v_expected.relation_oid
        and c.relkind = 'r'
        and c.relpersistence = 'p'
        and not c.relrowsecurity
        and not c.relforcerowsecurity
        and pg_catalog.pg_get_userbyid(c.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(c.oid, 'pg_class') =
          '020_backend_match_storage:'
            || backend_auth.relation_fingerprint(
              c.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'POSTCHECK_FAILED: backend_match.% relation mode, owner, or fingerprint differs',
        v_expected.table_name;
    end if;

    if (
      select pg_catalog.count(*)
      from pg_catalog.pg_attribute a
      where a.attrelid = v_expected.relation_oid
        and a.attnum > 0
        and not a.attisdropped
    ) <> v_expected.column_count then
      raise exception 'POSTCHECK_FAILED: backend_match.% column count differs',
        v_expected.table_name;
    end if;
  end loop;

  with expected(
    table_name,
    column_position,
    column_name,
    data_type,
    not_null,
    identity_kind,
    generated_kind,
    default_expression
  ) as (
    values
      ('matches', 1, 'id', 'uuid', true, '', '', null),
      ('matches', 2, 'owner_account_id', 'uuid', true, '', '', null),
      ('matches', 3, 'created_at', 'bigint', true, '', '', null),
      ('matches', 4, 'updated_at', 'bigint', true, '', '', null),
      ('matches', 5, 'starts_at', 'bigint', true, '', '', null),
      ('matches', 6, 'duration_minutes', 'smallint', true, '', '', null),
      ('matches', 7, 'court_id', 'text', true, '', '', null),
      ('matches', 8, 'court_name', 'text', true, '', '', null),
      ('matches', 9, 'court_type', 'text', true, '', '', null),
      ('matches', 10, 'kind', 'text', true, '', '', null),
      ('matches', 11, 'visibility', 'text', true, '', '', null),
      ('matches', 12, 'scenario', 'text', true, '', '', null),
      ('matches', 13, 'status', 'text', true, '', '', null),
      ('matches', 14, 'title', 'text', false, '', '', null),
      ('matches', 15, 'description', 'text', true, '', '', '''''::text'),
      ('matches', 16, 'rating_min', 'smallint', false, '', '', null),
      ('matches', 17, 'rating_max', 'smallint', false, '', '', null),
      ('matches', 18, 'is_rating_match', 'boolean', true, '', '', 'false'),
      ('matches', 19, 'price_per_person_snapshot', 'numeric(12,2)', false, '', '', null),
      ('matches', 20, 'version', 'bigint', true, '', '', '1'),
      ('matches', 21, 'terminal_at', 'bigint', false, '', '', null),
      ('match_participants', 1, 'id', 'uuid', true, '', '', null),
      ('match_participants', 2, 'match_id', 'uuid', true, '', '', null),
      ('match_participants', 3, 'account_id', 'uuid', true, '', '', null),
      ('match_participants', 4, 'slot_number', 'smallint', true, '', '', null),
      ('match_participants', 5, 'status', 'text', true, '', '', '''active''::text'),
      ('match_participants', 6, 'joined_at', 'bigint', true, '', '', null),
      ('match_participants', 7, 'updated_at', 'bigint', true, '', '', null),
      ('match_participants', 8, 'left_at', 'bigint', false, '', '', null),
      ('match_participants', 9, 'version', 'bigint', true, '', '', '1'),
      ('match_commands', 1, 'command_id', 'uuid', true, '', '', null),
      ('match_commands', 2, 'match_id', 'uuid', true, '', '', null),
      ('match_commands', 3, 'actor_account_id', 'uuid', true, '', '', null),
      ('match_commands', 4, 'command_sequence', 'bigint', true, '', '', null),
      ('match_commands', 5, 'request_digest', 'bytea', true, '', '', null),
      ('match_commands', 6, 'command_type', 'text', true, '', '', null),
      ('match_commands', 7, 'applied_at', 'bigint', true, '', '', null),
      ('match_commands', 8, 'participant_id', 'uuid', false, '', '', null),
      ('match_commands', 9, 'result_type', 'text', true, '', '', null),
      ('match_commands', 10, 'match_version', 'bigint', true, '', '', null)
  ),
  actual as (
    select
      c.relname::text,
      a.attnum::integer,
      a.attname::text,
      pg_catalog.format_type(a.atttypid, a.atttypmod),
      a.attnotnull,
      a.attidentity::text,
      a.attgenerated::text,
      pg_catalog.pg_get_expr(d.adbin, d.adrelid, true)
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    left join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid
     and d.adnum = a.attnum
    where n.nspname = 'backend_match'
      and c.relkind = 'r'
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
    raise exception 'POSTCHECK_FAILED: backend_match columns or defaults differ';
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
      ('matches', 'matches_pkey', 'p', null, null, array['id'], null, null, null, null, false, false, true),
      ('matches', 'matches_owner_account_id_fkey', 'f', 'backend_auth', 'player_profiles', array['owner_account_id'], array['account_id'], 'a', 'a', 's', false, false, true),
      ('matches', 'matches_time_check', 'c', null, null, array['created_at', 'starts_at', 'updated_at'], null, null, null, null, false, false, true),
      ('matches', 'matches_duration_minutes_check', 'c', null, null, array['duration_minutes'], null, null, null, null, false, false, true),
      ('matches', 'matches_court_id_check', 'c', null, null, array['court_id'], null, null, null, null, false, false, true),
      ('matches', 'matches_court_name_check', 'c', null, null, array['court_name'], null, null, null, null, false, false, true),
      ('matches', 'matches_court_type_check', 'c', null, null, array['court_type'], null, null, null, null, false, false, true),
      ('matches', 'matches_kind_check', 'c', null, null, array['kind'], null, null, null, null, false, false, true),
      ('matches', 'matches_visibility_check', 'c', null, null, array['visibility'], null, null, null, null, false, false, true),
      ('matches', 'matches_scenario_check', 'c', null, null, array['scenario'], null, null, null, null, false, false, true),
      ('matches', 'matches_status_check', 'c', null, null, array['status'], null, null, null, null, false, false, true),
      ('matches', 'matches_title_check', 'c', null, null, array['title'], null, null, null, null, false, false, true),
      ('matches', 'matches_description_check', 'c', null, null, array['description'], null, null, null, null, false, false, true),
      ('matches', 'matches_rating_range_check', 'c', null, null, array['rating_max', 'rating_min'], null, null, null, null, false, false, true),
      ('matches', 'matches_price_per_person_snapshot_check', 'c', null, null, array['price_per_person_snapshot'], null, null, null, null, false, false, true),
      ('matches', 'matches_version_check', 'c', null, null, array['version'], null, null, null, null, false, false, true),
      ('matches', 'matches_terminal_check', 'c', null, null, array['created_at', 'starts_at', 'status', 'terminal_at'], null, null, null, null, false, false, true),
      ('matches', 'matches_format_check', 'c', null, null, array['is_rating_match', 'kind', 'rating_max', 'rating_min', 'scenario', 'status', 'visibility'], null, null, null, null, false, false, true),
      ('matches', 'matches_no_active_court_overlap', 'x', null, null, array['court_id', '<expression>'], null, null, null, null, false, false, true),
      ('match_participants', 'match_participants_pkey', 'p', null, null, array['id'], null, null, null, null, false, false, true),
      ('match_participants', 'match_participants_match_id_fkey', 'f', 'backend_match', 'matches', array['match_id'], array['id'], 'a', 'a', 's', false, false, true),
      ('match_participants', 'match_participants_account_id_fkey', 'f', 'backend_auth', 'player_profiles', array['account_id'], array['account_id'], 'a', 'a', 's', false, false, true),
      ('match_participants', 'match_participants_slot_number_check', 'c', null, null, array['slot_number'], null, null, null, null, false, false, true),
      ('match_participants', 'match_participants_status_check', 'c', null, null, array['status'], null, null, null, null, false, false, true),
      ('match_participants', 'match_participants_time_check', 'c', null, null, array['joined_at', 'left_at', 'updated_at'], null, null, null, null, false, false, true),
      ('match_participants', 'match_participants_lifecycle_check', 'c', null, null, array['left_at', 'status'], null, null, null, null, false, false, true),
      ('match_participants', 'match_participants_version_check', 'c', null, null, array['version'], null, null, null, null, false, false, true),
      ('match_commands', 'match_commands_pkey', 'p', null, null, array['command_id'], null, null, null, null, false, false, true),
      ('match_commands', 'match_commands_match_sequence_key', 'u', null, null, array['match_id', 'command_sequence'], null, null, null, null, false, false, true),
      ('match_commands', 'match_commands_match_id_fkey', 'f', 'backend_match', 'matches', array['match_id'], array['id'], 'a', 'a', 's', false, false, true),
      ('match_commands', 'match_commands_actor_account_id_fkey', 'f', 'backend_auth', 'player_profiles', array['actor_account_id'], array['account_id'], 'a', 'a', 's', false, false, true),
      ('match_commands', 'match_commands_participant_id_fkey', 'f', 'backend_match', 'match_participants', array['participant_id'], array['id'], 'a', 'a', 's', false, false, true),
      ('match_commands', 'match_commands_request_digest_check', 'c', null, null, array['request_digest'], null, null, null, null, false, false, true),
      ('match_commands', 'match_commands_sequence_check', 'c', null, null, array['command_sequence', 'match_version'], null, null, null, null, false, false, true),
      ('match_commands', 'match_commands_applied_at_check', 'c', null, null, array['applied_at'], null, null, null, null, false, false, true),
      ('match_commands', 'match_commands_result_check', 'c', null, null, array['command_type', 'participant_id', 'result_type'], null, null, null, null, false, false, true)
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
          case
            when key_column.attnum = 0 then '<expression>'::text
            else constrained_attribute.attname::text
          end
          order by
            case
              when constraint_row.contype = 'c'
                then constrained_attribute.attname::text
            end,
            key_column.position
        )
        from pg_catalog.unnest(constraint_row.conkey)
          with ordinality key_column(attnum, position)
        left join pg_catalog.pg_attribute constrained_attribute
          on constrained_attribute.attrelid = constraint_row.conrelid
         and constrained_attribute.attnum = key_column.attnum
      ),
      (
        select pg_catalog.array_agg(
          referenced_attribute.attname::text
          order by key_column.position
        )
        from pg_catalog.unnest(constraint_row.confkey)
          with ordinality key_column(attnum, position)
        join pg_catalog.pg_attribute referenced_attribute
          on referenced_attribute.attrelid = constraint_row.confrelid
         and referenced_attribute.attnum = key_column.attnum
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
    join pg_catalog.pg_namespace relation_namespace
      on relation_namespace.oid = relation.relnamespace
    left join pg_catalog.pg_class referenced_relation
      on referenced_relation.oid = constraint_row.confrelid
    left join pg_catalog.pg_namespace referenced_namespace
      on referenced_namespace.oid = referenced_relation.relnamespace
    where relation_namespace.nspname = 'backend_match'
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
    raise exception 'POSTCHECK_FAILED: backend_match constraint allowlist differs';
  end if;

  with expected(
    table_name,
    constraint_name,
    normalized_definition
  ) as (
    values
      (
        'matches',
        'matches_time_check',
        'check (created_at >= 0 and created_at <= ''9007199254740991''::bigint and updated_at >= created_at and updated_at <= ''9007199254740991''::bigint and starts_at >= created_at and starts_at <= ''9007199254740991''::bigint)'
      ),
      (
        'matches',
        'matches_duration_minutes_check',
        'check (duration_minutes = 60 or duration_minutes = 90 or duration_minutes = 120 or duration_minutes = 150)'
      ),
      (
        'matches',
        'matches_court_id_check',
        'check (char_length(court_id) >= 1 and char_length(court_id) <= 64 and btrim(court_id) = court_id and court_id !~ ''[[:cntrl:]]''::text)'
      ),
      (
        'matches',
        'matches_court_name_check',
        'check (char_length(court_name) >= 1 and char_length(court_name) <= 128 and btrim(court_name) = court_name and court_name !~ ''[[:cntrl:]]''::text)'
      ),
      (
        'matches',
        'matches_court_type_check',
        'check (char_length(court_type) >= 1 and char_length(court_type) <= 64 and btrim(court_type) = court_type and court_type !~ ''[[:cntrl:]]''::text)'
      ),
      (
        'matches',
        'matches_kind_check',
        'check (kind = ''match''::text or kind = ''private''::text)'
      ),
      (
        'matches',
        'matches_visibility_check',
        'check (visibility = ''public''::text or visibility = ''private''::text)'
      ),
      (
        'matches',
        'matches_scenario_check',
        'check (scenario = ''community''::text or scenario = ''social''::text or scenario = ''private''::text)'
      ),
      (
        'matches',
        'matches_status_check',
        'check (status = ''open''::text or status = ''searching''::text or status = ''confirmed''::text or status = ''upcoming''::text or status = ''completed''::text or status = ''cancelled''::text)'
      ),
      (
        'matches',
        'matches_title_check',
        'check (title is null or char_length(title) >= 1 and char_length(title) <= 160 and btrim(title) = title and title !~ ''[[:cntrl:]]''::text)'
      ),
      (
        'matches',
        'matches_description_check',
        'check (char_length(description) <= 2000)'
      ),
      (
        'matches',
        'matches_rating_range_check',
        'check (rating_min is null and rating_max is null or rating_min is not null and rating_max is not null and rating_min >= 0 and rating_min <= 6 and rating_max >= 0 and rating_max <= 6 and rating_min <= rating_max)'
      ),
      (
        'matches',
        'matches_price_per_person_snapshot_check',
        'check (price_per_person_snapshot is null or price_per_person_snapshot <> ''nan''::numeric and price_per_person_snapshot > 0::numeric and price_per_person_snapshot <= 1000000::numeric)'
      ),
      (
        'matches',
        'matches_version_check',
        'check (version >= 1 and version <= ''9007199254740991''::bigint)'
      ),
      (
        'matches',
        'matches_terminal_check',
        'check (status = ''completed''::text and terminal_at >= starts_at and terminal_at <= ''9007199254740991''::bigint or status = ''cancelled''::text and terminal_at >= created_at and terminal_at <= ''9007199254740991''::bigint or status <> ''completed''::text and status <> ''cancelled''::text and terminal_at is null)'
      ),
      (
        'matches',
        'matches_format_check',
        'check (kind = ''match''::text and visibility = ''public''::text and (scenario = ''community''::text or scenario = ''social''::text) and rating_min is not null and rating_max is not null and (status = ''open''::text or status = ''searching''::text or status = ''confirmed''::text or status = ''upcoming''::text or status = ''completed''::text or status = ''cancelled''::text) or kind = ''private''::text and visibility = ''private''::text and scenario = ''private''::text and rating_min is null and rating_max is null and not is_rating_match and (status = ''upcoming''::text or status = ''completed''::text or status = ''cancelled''::text))'
      ),
      (
        'match_participants',
        'match_participants_slot_number_check',
        'check (slot_number >= 2 and slot_number <= 4)'
      ),
      (
        'match_participants',
        'match_participants_status_check',
        'check (status = ''active''::text or status = ''left''::text or status = ''removed''::text)'
      ),
      (
        'match_participants',
        'match_participants_time_check',
        'check (joined_at >= 0 and joined_at <= ''9007199254740991''::bigint and updated_at >= joined_at and updated_at <= ''9007199254740991''::bigint and (left_at is null or left_at >= joined_at and left_at <= ''9007199254740991''::bigint))'
      ),
      (
        'match_participants',
        'match_participants_lifecycle_check',
        'check (status = ''active''::text and left_at is null or status <> ''active''::text and left_at is not null)'
      ),
      (
        'match_participants',
        'match_participants_version_check',
        'check (version >= 1 and version <= ''9007199254740991''::bigint)'
      ),
      (
        'match_commands',
        'match_commands_request_digest_check',
        'check (octet_length(request_digest) = 32)'
      ),
      (
        'match_commands',
        'match_commands_sequence_check',
        'check (command_sequence >= 1 and command_sequence <= ''9007199254740991''::bigint and match_version = command_sequence)'
      ),
      (
        'match_commands',
        'match_commands_applied_at_check',
        'check (applied_at >= 0 and applied_at <= ''9007199254740991''::bigint)'
      ),
      (
        'match_commands',
        'match_commands_result_check',
        'check (command_type = ''create_match''::text and result_type = ''match_created''::text and participant_id is null or command_type = ''join_match''::text and result_type = ''participant_joined''::text and participant_id is not null or command_type = ''leave_match''::text and result_type = ''participant_left''::text and participant_id is not null)'
      )
  ),
  actual as (
    select
      relation.relname::text,
      constraint_row.conname::text,
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.lower(
            pg_catalog.pg_get_constraintdef(
              constraint_row.oid,
              true
            )
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
      and constraint_row.contype = 'c'
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
    raise exception 'POSTCHECK_FAILED: backend_match CHECK definitions differ';
  end if;

  select n.nspname into v_extension_schema
  from pg_catalog.pg_extension e
  join pg_catalog.pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'btree_gist';

  if v_extension_schema is distinct from 'public'
     or not pg_catalog.has_schema_privilege(
       'backend_auth_owner',
       'public',
       'USAGE'
     )
     or not exists (
       select 1
       from pg_catalog.pg_extension extension_row
       join pg_catalog.pg_namespace namespace
         on namespace.oid = extension_row.extnamespace
       join pg_catalog.pg_opclass opclass
         on opclass.opcnamespace = namespace.oid
        and opclass.opcname = 'gist_text_ops'
        and opclass.opcintype = 'pg_catalog.text'::pg_catalog.regtype
       join pg_catalog.pg_am access_method
         on access_method.oid = opclass.opcmethod
        and access_method.amname = 'gist'
       join pg_catalog.pg_depend dependency
         on dependency.classid =
           'pg_catalog.pg_opclass'::pg_catalog.regclass
        and dependency.objid = opclass.oid
        and dependency.refclassid =
          'pg_catalog.pg_extension'::pg_catalog.regclass
        and dependency.refobjid = extension_row.oid
        and dependency.deptype = 'e'
       where extension_row.extname = 'btree_gist'
         and namespace.nspname = 'public'
     )
     or not exists (
       select 1
       from pg_catalog.pg_constraint constraint_row
       join pg_catalog.pg_index index_row
         on index_row.indexrelid = constraint_row.conindid
       join pg_catalog.pg_class index_relation
         on index_relation.oid = index_row.indexrelid
       join pg_catalog.pg_am access_method
         on access_method.oid = index_relation.relam
       where constraint_row.conrelid = v_matches_oid
         and constraint_row.conname = 'matches_no_active_court_overlap'
         and constraint_row.contype = 'x'
         and access_method.amname = 'gist'
         and (
           select pg_catalog.array_agg(operator.oprname::text order by item.position)
           from pg_catalog.unnest(constraint_row.conexclop)
             with ordinality item(operator_oid, position)
           join pg_catalog.pg_operator operator
             on operator.oid = item.operator_oid
         ) = array['=', '&&']::text[]
         and (
           select pg_catalog.array_agg(opclass.opcname::text order by item.position)
           from pg_catalog.unnest(index_row.indclass)
             with ordinality item(opclass_oid, position)
           join pg_catalog.pg_opclass opclass
             on opclass.oid = item.opclass_oid
         ) = array['gist_text_ops', 'range_ops']::text[]
         and (
           select pg_catalog.array_agg(namespace.nspname::text order by item.position)
           from pg_catalog.unnest(index_row.indclass)
             with ordinality item(opclass_oid, position)
           join pg_catalog.pg_opclass opclass
             on opclass.oid = item.opclass_oid
           join pg_catalog.pg_namespace namespace
             on namespace.oid = opclass.opcnamespace
         ) = array['public', 'pg_catalog']::text[]
         and pg_catalog.btrim(
           pg_catalog.regexp_replace(
             pg_catalog.lower(
               pg_catalog.pg_get_expr(
                 index_row.indexprs,
                 index_row.indrelid,
                 true
               )
             ),
             '[[:space:]]+',
             ' ',
             'g'
           )
         ) =
           'int8range(starts_at, starts_at + duration_minutes::bigint * 60, ''[)''::text)'
         and pg_catalog.btrim(
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
         ) =
           'status = any (array[''open''::text, ''searching''::text, ''confirmed''::text, ''upcoming''::text])'
     ) then
    raise exception 'POSTCHECK_FAILED: canonical btree_gist or active court overlap exclusion differs';
  end if;

  with expected(
    table_name,
    index_name,
    access_method,
    is_unique,
    is_primary,
    is_exclusion,
    key_columns,
    normalized_predicate
  ) as (
    values
      ('matches', 'matches_pkey', 'btree', true, true, false, array['id'], null),
      ('matches', 'matches_no_active_court_overlap', 'gist', false, false, true, array['court_id', '<expression>'], 'status = any (array[''open''::text, ''searching''::text, ''confirmed''::text, ''upcoming''::text])'),
      ('matches', 'matches_owner_starts_at_idx', 'btree', false, false, false, array['owner_account_id', 'starts_at', 'id'], null),
      ('matches', 'matches_feed_idx', 'btree', false, false, false, array['visibility', 'kind', 'status', 'starts_at', 'id'], null),
      ('match_participants', 'match_participants_pkey', 'btree', true, true, false, array['id'], null),
      ('match_participants', 'match_participants_active_slot_key', 'btree', true, false, false, array['match_id', 'slot_number'], 'status = ''active''::text'),
      ('match_participants', 'match_participants_active_account_key', 'btree', true, false, false, array['match_id', 'account_id'], 'status = ''active''::text'),
      ('match_participants', 'match_participants_match_history_idx', 'btree', false, false, false, array['match_id', 'joined_at', 'id'], null),
      ('match_participants', 'match_participants_account_history_idx', 'btree', false, false, false, array['account_id', 'joined_at', 'id'], null),
      ('match_commands', 'match_commands_pkey', 'btree', true, true, false, array['command_id'], null),
      ('match_commands', 'match_commands_match_sequence_key', 'btree', true, false, false, array['match_id', 'command_sequence'], null),
      ('match_commands', 'match_commands_actor_applied_at_idx', 'btree', false, false, false, array['actor_account_id', 'applied_at', 'command_id'], null),
      ('match_commands', 'match_commands_participant_id_idx', 'btree', false, false, false, array['participant_id'], 'participant_id is not null')
  ),
  actual as (
    select
      relation.relname::text,
      index_relation.relname::text,
      access_method.amname::text,
      index_row.indisunique,
      index_row.indisprimary,
      index_row.indisexclusion,
      (
        select pg_catalog.array_agg(
          case
            when key_column.attnum = 0 then '<expression>'::text
            else attribute.attname::text
          end
          order by key_column.position
        )
        from pg_catalog.unnest(index_row.indkey)
          with ordinality key_column(attnum, position)
        left join pg_catalog.pg_attribute attribute
          on attribute.attrelid = index_row.indrelid
         and attribute.attnum = key_column.attnum
      ),
      case
        when index_row.indpred is null then null::text
        else pg_catalog.btrim(
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
          ),
          '()'
        )
      end
    from pg_catalog.pg_index index_row
    join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_row.indexrelid
    join pg_catalog.pg_am access_method
      on access_method.oid = index_relation.relam
    where namespace.nspname = 'backend_match'
      and index_row.indisvalid
      and index_row.indisready
      and index_row.indnkeyatts = index_row.indnatts
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
    raise exception 'POSTCHECK_FAILED: backend_match index allowlist differs';
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
      ('backend_match', 'matches', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
      ('backend_match', 'match_participants', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false),
      ('backend_match', 'match_commands', 'backend_auth_owner', 'backend_auth_app', 'SELECT', false)
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
      and relation.relkind = 'r'
      and acl.grantee <> relation.relowner
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
    raise exception 'POSTCHECK_FAILED: backend_match table ACL differs';
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
      ('backend_match', 'matches', 'id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'owner_account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'created_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'starts_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'duration_minutes', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'court_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'court_name', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'court_type', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'kind', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'visibility', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'scenario', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'status', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'title', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'description', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'rating_min', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'rating_max', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'is_rating_match', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'price_per_person_snapshot', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'version', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'matches', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'matches', 'status', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'matches', 'version', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'matches', 'terminal_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_participants', 'id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_participants', 'match_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_participants', 'account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_participants', 'slot_number', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_participants', 'status', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_participants', 'joined_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_participants', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_participants', 'version', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_participants', 'status', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_participants', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_participants', 'left_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_participants', 'version', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_match', 'match_commands', 'command_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_commands', 'match_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_commands', 'actor_account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_commands', 'command_sequence', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_commands', 'request_digest', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_commands', 'command_type', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_commands', 'applied_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_commands', 'participant_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_commands', 'result_type', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_match', 'match_commands', 'match_version', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false)
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
    join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
    join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
    left join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where namespace.nspname = 'backend_match'
      and relation.relkind = 'r'
      and attribute.attnum > 0
      and not attribute.attisdropped
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
    raise exception 'POSTCHECK_FAILED: backend_match column ACL differs';
  end if;

  if exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
       join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
       where namespace.nspname = 'backend_match'
         and not trigger_row.tgisinternal
     )
     or exists (
       select 1
       from pg_catalog.pg_proc procedure_row
       join pg_catalog.pg_namespace namespace
         on namespace.oid = procedure_row.pronamespace
       where namespace.nspname = 'backend_match'
     )
     or exists (
       select 1
       from backend_match.matches
     )
     or exists (
       select 1
       from backend_match.match_participants
     )
     or exists (
       select 1
       from backend_match.match_commands
     ) then
    raise exception 'POSTCHECK_FAILED: backend_match must contain only empty storage relations';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = constraint_row.connamespace
  where namespace.nspname = 'backend_match';

  if v_count <> 36 then
    raise exception 'POSTCHECK_FAILED: expected 36 backend_match constraints, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class relation on relation.oid = index_row.indrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'backend_match';

  if v_count <> 13 then
    raise exception 'POSTCHECK_FAILED: expected 13 backend_match indexes, found %',
      v_count;
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'backend_auth'
    and relation.relkind = 'r';

  if v_count <> 16 then
    raise exception 'POSTCHECK_FAILED: existing backend_auth table count changed';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_constraint constraint_row
  join pg_catalog.pg_namespace namespace
    on namespace.oid = constraint_row.connamespace
  where namespace.nspname = 'backend_auth';

  if v_count <> 160 then
    raise exception 'POSTCHECK_FAILED: existing backend_auth constraint count changed';
  end if;

  select pg_catalog.count(*) into v_count
  from pg_catalog.pg_trigger trigger_row
  join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'backend_auth'
    and not trigger_row.tgisinternal;

  if v_count <> 33 then
    raise exception 'POSTCHECK_FAILED: existing backend_auth trigger count changed';
  end if;

  for v_expected in
    select *
    from (values
      ('accounts', '015_backend_auth_foundation:'),
      ('player_profiles', '015_backend_auth_foundation:'),
      ('external_identities', '015_backend_auth_foundation:'),
      ('external_identity_lookup_digests', '015_backend_auth_foundation:'),
      ('authentication_operations', '015_backend_auth_foundation:'),
      ('telegram_proof_consumptions', '015_backend_auth_foundation:'),
      ('auth_session_families', '015_backend_auth_foundation:'),
      ('auth_session_credentials', '015_backend_auth_foundation:'),
      ('auth_session_commands', '015_backend_auth_foundation:'),
      ('fresh_authentication_evidence', '015_backend_auth_foundation:'),
      ('reauthentication_grants', '015_backend_auth_foundation:'),
      ('otp_challenges', '015_backend_auth_foundation:'),
      ('otp_commands', '015_backend_auth_foundation:'),
      ('security_audit_events', '015_backend_auth_foundation:'),
      ('player_profile_details', '018_backend_auth_player_profile_editable_fields:'),
      ('player_rating_states', '019_backend_auth_player_rating_state:')
    ) expected(table_name, comment_prefix)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth'
        and relation.relname = v_expected.table_name
        and relation.relkind = 'r'
        and pg_catalog.pg_get_userbyid(relation.relowner) = 'backend_auth_owner'
        and pg_catalog.obj_description(relation.oid, 'pg_class') =
          v_expected.comment_prefix
            || backend_auth.relation_fingerprint(
              relation.oid::pg_catalog.regclass
            )
    ) then
      raise exception 'POSTCHECK_FAILED: existing backend_auth.% structure or fingerprint changed',
        v_expected.table_name;
    end if;
  end loop;
end;
$postcheck$;

with backend_auth_row_counts(table_name, row_count) as (
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
backend_auth_relation_state as (
  select
    relation.relname as table_name,
    backend_auth.relation_fingerprint(
      relation.oid::pg_catalog.regclass
    ) as fingerprint
  from pg_catalog.pg_class relation
  join pg_catalog.pg_namespace namespace
    on namespace.oid = relation.relnamespace
  where namespace.nspname = 'backend_auth'
    and relation.relkind = 'r'
),
backend_match_relation_state as (
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
  'migration', '020_backend_match_storage',
  'ready', true,
  'btree_gist', pg_catalog.jsonb_build_object(
    'installed', true,
    'schema', 'public',
    'text_opclass', 'gist_text_ops'
  ),
  'backend_auth_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', 16,
    'constraints', 160,
    'user_triggers', 33
  ),
  'backend_match_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', 3,
    'constraints', 36,
    'indexes', 13,
    'user_triggers', 0,
    'functions', 0
  ),
  'backend_auth_row_counts', (
    select pg_catalog.jsonb_object_agg(
      backend_auth_row_counts.table_name,
      backend_auth_row_counts.row_count
      order by backend_auth_row_counts.table_name
    )
    from backend_auth_row_counts
  ),
  'backend_auth_relation_fingerprints', (
    select pg_catalog.jsonb_object_agg(
      backend_auth_relation_state.table_name,
      backend_auth_relation_state.fingerprint
      order by backend_auth_relation_state.table_name
    )
    from backend_auth_relation_state
  ),
  'backend_match_row_counts', pg_catalog.jsonb_build_object(
    'matches', (select pg_catalog.count(*) from backend_match.matches),
    'match_participants', (
      select pg_catalog.count(*) from backend_match.match_participants
    ),
    'match_commands', (
      select pg_catalog.count(*) from backend_match.match_commands
    )
  ),
  'backend_match_relation_fingerprints', (
    select pg_catalog.jsonb_object_agg(
      backend_match_relation_state.table_name,
      backend_match_relation_state.fingerprint
      order by backend_match_relation_state.table_name
    )
    from backend_match_relation_state
  )
) as backend_match_storage_postcheck;

reset role;
rollback;
