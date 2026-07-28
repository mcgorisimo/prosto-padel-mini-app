-- 018_backend_auth_player_profile_editable_fields.sql
-- Adds backend-owned editable phone and side-preference fields and narrowly
-- grants the application role access to update user-editable profile columns.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_relation_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
  end if;

  if pg_catalog.to_regrole('backend_auth_owner') is null
     or pg_catalog.to_regrole('backend_auth_app') is null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: required backend_auth roles are missing';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: current user cannot SET ROLE backend_auth_owner';
  end if;

  if v_relation_oid is null
     or pg_catalog.pg_get_userbyid(
       (select c.relowner from pg_catalog.pg_class c where c.oid = v_relation_oid)
     ) <> 'backend_auth_owner'
     or pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
       '017_backend_auth_player_profile_details:'
         || backend_auth.relation_fingerprint(
           v_relation_oid::pg_catalog.regclass
         ) then
    raise exception 'MIGRATION_PRECONDITION_FAILED: player_profile_details is not the canonical migration 017 relation';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = v_relation_oid
      and a.attname in ('phone', 'side_preference')
      and not a.attisdropped
  )
     or exists (
       select 1
       from pg_catalog.pg_constraint c
       where c.conrelid = v_relation_oid
         and c.conname in (
           'player_profile_details_phone_check',
           'player_profile_details_side_preference_check'
         )
     ) then
    raise exception 'MIGRATION_CONFLICT: migration 018 objects already exist';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

alter table backend_auth.player_profile_details
  add column phone text,
  add column side_preference text,
  add constraint player_profile_details_phone_check check (
    phone is null
    or (
      char_length(phone) between 8 and 16
      and phone ~ '^\+[1-9][0-9]{6,14}$'
    )
  ),
  add constraint player_profile_details_side_preference_check check (
    side_preference is null
    or side_preference in ('Left', 'Both', 'Right')
  );

grant update (
  first_name,
  last_name,
  phone,
  side_preference,
  updated_at
) on backend_auth.player_profile_details to backend_auth_app;

do $comment$
begin
  execute pg_catalog.format(
    'comment on table backend_auth.player_profile_details is %L',
    '018_backend_auth_player_profile_editable_fields:'
      || backend_auth.relation_fingerprint(
        'backend_auth.player_profile_details'::pg_catalog.regclass
      )
  );
end;
$comment$;

do $assertions$
declare
  v_relation_oid oid :=
    pg_catalog.to_regclass('backend_auth.player_profile_details')::oid;
  v_column text;
begin
  if (select pg_catalog.count(*)
      from pg_catalog.pg_attribute a
      where a.attrelid = v_relation_oid
        and a.attnum > 0
        and not a.attisdropped) <> 10 then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_profile_details column count differs';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_constraint c
      where c.conrelid = v_relation_oid) <> 10 then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_profile_details constraint count differs';
  end if;

  if pg_catalog.obj_description(v_relation_oid, 'pg_class') is distinct from
     '018_backend_auth_player_profile_editable_fields:'
       || backend_auth.relation_fingerprint(
         v_relation_oid::pg_catalog.regclass
       ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: player_profile_details fingerprint differs';
  end if;

  foreach v_column in array array[
    'first_name',
    'last_name',
    'phone',
    'side_preference',
    'updated_at'
  ]::text[]
  loop
    if not pg_catalog.has_column_privilege(
      'backend_auth_app',
      v_relation_oid,
      v_column,
      'UPDATE'
    ) then
      raise exception 'MIGRATION_ASSERTION_FAILED: UPDATE privilege is missing for %',
        v_column;
    end if;
  end loop;

  foreach v_column in array array[
    'account_id',
    'username',
    'photo_url',
    'language_code',
    'created_at'
  ]::text[]
  loop
    if pg_catalog.has_column_privilege(
      'backend_auth_app',
      v_relation_oid,
      v_column,
      'UPDATE'
    ) then
      raise exception 'MIGRATION_ASSERTION_FAILED: UPDATE privilege is unsafe for %',
        v_column;
    end if;
  end loop;

  if pg_catalog.has_table_privilege(
    'backend_auth_app',
    v_relation_oid,
    'UPDATE'
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: table-level UPDATE must remain revoked';
  end if;
end;
$assertions$;

reset role;
commit;

select '018_backend_auth_player_profile_editable_fields applied; run POSTCHECK before backend rollout'
  as result;
