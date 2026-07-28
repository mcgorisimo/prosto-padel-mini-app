-- 018_backend_auth_player_profile_editable_fields_POSTCHECK.sql
-- Read-only verification for migration 018.

begin;
set transaction read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_relation_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
  v_difference_count bigint;
begin
  if v_relation_oid is null
     or pg_catalog.pg_get_userbyid(
       (select c.relowner from pg_catalog.pg_class c where c.oid = v_relation_oid)
     ) <> 'backend_auth_owner'
     or pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
       '018_backend_auth_player_profile_editable_fields:'
         || backend_auth.relation_fingerprint(
           v_relation_oid::pg_catalog.regclass
         ) then
    raise exception 'POSTCHECK_FAILED: player_profile_details owner or fingerprint differs';
  end if;

  with expected(
    column_position,
    column_name,
    data_type,
    not_null,
    default_expression
  ) as (
    values
      (1, 'account_id', 'uuid', true, null::text),
      (2, 'first_name', 'text', true, null::text),
      (3, 'last_name', 'text', false, null::text),
      (4, 'username', 'text', false, null::text),
      (5, 'photo_url', 'text', false, null::text),
      (6, 'language_code', 'text', false, null::text),
      (7, 'created_at', 'bigint', true, null::text),
      (8, 'updated_at', 'bigint', true, null::text),
      (9, 'phone', 'text', false, null::text),
      (10, 'side_preference', 'text', false, null::text)
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
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = v_relation_oid
      and a.attnum > 0
      and not a.attisdropped
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: player_profile_details columns differ';
  end if;

  with expected(name, definition) as (
    values
      (
        'player_profile_details_phone_check'::text,
        'check (phone is null or char_length(phone) >= 8 and char_length(phone) <= 16 and phone ~ ''^\+[1-9][0-9]{6,14}$''::text)'::text
      ),
      (
        'player_profile_details_side_preference_check'::text,
        'check (side_preference is null or (side_preference = any (array[''Left''::text, ''Both''::text, ''Right''::text])))'::text
      )
  ),
  actual as (
    select
      c.conname::text,
      pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.pg_get_constraintdef(c.oid, true),
          '[[:space:]]+',
          ' ',
          'g'
        )
      )
    from pg_catalog.pg_constraint c
    where c.conrelid = v_relation_oid
      and c.conname in (
        'player_profile_details_phone_check',
        'player_profile_details_side_preference_check'
      )
      and c.contype = 'c'
      and c.convalidated
      and not c.condeferrable
      and not c.condeferred
  ),
  normalized_expected as (
    select
      name,
      pg_catalog.lower(
        pg_catalog.regexp_replace(definition, '[[:space:]]+', ' ', 'g')
      ) as definition
    from expected
  ),
  differences as (
    (select * from normalized_expected except select * from actual)
    union all
    (select * from actual except select * from normalized_expected)
  )
  select pg_catalog.count(*) into v_difference_count from differences;

  if v_difference_count <> 0
     or (select pg_catalog.count(*)
         from pg_catalog.pg_constraint c
         where c.conrelid = v_relation_oid) <> 10 then
    raise exception 'POSTCHECK_FAILED: player_profile_details constraints differ';
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
      ('backend_auth', 'player_profile_details', 'account_id', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_auth', 'player_profile_details', 'first_name', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_auth', 'player_profile_details', 'last_name', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_auth', 'player_profile_details', 'username', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_auth', 'player_profile_details', 'photo_url', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_auth', 'player_profile_details', 'language_code', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_auth', 'player_profile_details', 'created_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_auth', 'player_profile_details', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'INSERT', false),
      ('backend_auth', 'player_profile_details', 'first_name', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_auth', 'player_profile_details', 'last_name', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_auth', 'player_profile_details', 'phone', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_auth', 'player_profile_details', 'side_preference', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false),
      ('backend_auth', 'player_profile_details', 'updated_at', 'backend_auth_owner', 'backend_auth_app', 'UPDATE', false)
  ),
  actual as (
    select
      n.nspname::text,
      c.relname::text,
      a.attname::text,
      grantor.rolname::text,
      grantee.rolname::text,
      acl.privilege_type::text,
      acl.is_grantable
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(a.attacl) acl
    join pg_catalog.pg_roles grantor on grantor.oid = acl.grantor
    join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
    where a.attrelid = v_relation_oid
      and a.attnum > 0
      and not a.attisdropped
  ),
  differences as (
    (select * from expected except select * from actual)
    union all
    (select * from actual except select * from expected)
  )
  select pg_catalog.count(*) into v_difference_count from differences;

  if v_difference_count <> 0 then
    raise exception 'POSTCHECK_FAILED: player_profile_details column ACL differs';
  end if;

  if not pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_relation_oid,
       'SELECT'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_relation_oid,
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app',
       v_relation_oid,
       'DELETE'
     )
     or exists (
       select 1
       from pg_catalog.pg_trigger t
       where t.tgrelid = v_relation_oid
         and not t.tgisinternal
     ) then
    raise exception 'POSTCHECK_FAILED: player_profile_details runtime boundary differs';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'migration', '018_backend_auth_player_profile_editable_fields',
  'relation', 'backend_auth.player_profile_details',
  'row_count', (
    select pg_catalog.count(*)
    from backend_auth.player_profile_details
  ),
  'ready', true
) as backend_auth_player_profile_editable_fields_postcheck;

rollback;
