-- 031_backend_player_profile_photos.sql
-- Adds storage metadata for backend-owned player profile photos.
-- This migration stores no image bytes, uploads no objects and changes no profile rows.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_relation record;
  v_update_columns text[];
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'MIGRATION_PRECONDITION_FAILED: PostgreSQL 14 or newer is required';
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
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_owner attributes are unsafe';
  end if;

  if v_app.rolname is null
     or not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_app attributes are unsafe';
  end if;

  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
     or pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: role membership boundary differs';
  end if;

  if pg_catalog.to_regnamespace('backend_auth') is null
     or pg_catalog.pg_get_userbyid((
       select namespace.nspowner
       from pg_catalog.pg_namespace namespace
       where namespace.nspname = 'backend_auth'
     )) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth schema is missing or owner differs';
  end if;

  for v_relation in
    select *
    from (values
      ('accounts', '015_backend_auth_foundation'),
      ('player_profiles', '015_backend_auth_foundation'),
      ('player_profile_details', '018_backend_auth_player_profile_editable_fields')
    ) expected(relation_name, migration_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth'
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
      raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth.% differs from %',
        v_relation.relation_name,
        v_relation.migration_name;
    end if;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'backend_auth'
      and relation.relname = any (array[
        'player_profile_photo_assets',
        'player_profile_photo_assets_pkey',
        'player_profile_photo_assets_account_generation_key',
        'player_profile_photo_assets_account_generation_asset_key',
        'player_profile_photo_assets_storage_prefix_key',
        'player_profile_photo_states',
        'player_profile_photo_states_pkey'
      ]::text[])
  )
     or pg_catalog.to_regprocedure(
       'backend_auth.guard_player_profile_photo_state_transition()'
     ) is not null then
    raise exception 'MIGRATION_PRECONDITION_FAILED: migration 031 target object already exists';
  end if;

  if pg_catalog.has_schema_privilege('backend_auth_app', 'backend_auth', 'CREATE') then
    raise exception 'MIGRATION_PRECONDITION_FAILED: backend_auth_app schema CREATE is unsafe';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_update_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'backend_auth.player_profile_details'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and pg_catalog.has_column_privilege(
      'backend_auth_app',
      'backend_auth.player_profile_details',
      attribute.attname,
      'UPDATE'
    );

  if v_update_columns is distinct from
     array['first_name', 'last_name', 'updated_at', 'phone', 'side_preference']::text[] then
    raise exception 'MIGRATION_PRECONDITION_FAILED: editable profile column boundary differs';
  end if;
end;
$preconditions$;

set local role backend_auth_owner;

create table backend_auth.player_profile_photo_assets (
  asset_id uuid not null,
  account_id uuid not null,
  generation bigint not null,
  storage_prefix text not null,
  media_type text not null,
  full_dimension integer not null,
  full_byte_size bigint not null,
  content_sha256 bytea not null,
  created_at bigint not null,
  constraint player_profile_photo_assets_pkey primary key (asset_id),
  constraint player_profile_photo_assets_account_id_fkey
    foreign key (account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint player_profile_photo_assets_account_generation_key
    unique (account_id, generation),
  constraint player_profile_photo_assets_account_generation_asset_key
    unique (account_id, generation, asset_id),
  constraint player_profile_photo_assets_storage_prefix_key
    unique (storage_prefix),
  constraint player_profile_photo_assets_generation_check check (
    generation between 1 and 9007199254740991
  ),
  constraint player_profile_photo_assets_storage_prefix_check check (
    storage_prefix =
      'profile-photos/' || account_id::text || '/' || generation::text || '/' || asset_id::text
  ),
  constraint player_profile_photo_assets_media_type_check check (
    media_type = 'image/webp'
  ),
  constraint player_profile_photo_assets_dimension_check check (
    full_dimension between 256 and 4096
  ),
  constraint player_profile_photo_assets_byte_size_check check (
    full_byte_size between 1 and 10485760
  ),
  constraint player_profile_photo_assets_digest_check check (
    pg_catalog.octet_length(content_sha256) = 32
  ),
  constraint player_profile_photo_assets_time_check check (
    created_at between 0 and 9007199254740991
  )
);

create table backend_auth.player_profile_photo_states (
  account_id uuid not null,
  active_asset_id uuid,
  version bigint not null,
  created_at bigint not null,
  updated_at bigint not null,
  constraint player_profile_photo_states_pkey primary key (account_id),
  constraint player_profile_photo_states_account_id_fkey
    foreign key (account_id)
    references backend_auth.player_profiles (account_id)
    on update no action on delete no action not deferrable,
  constraint player_profile_photo_states_active_asset_fkey
    foreign key (account_id, version, active_asset_id)
    references backend_auth.player_profile_photo_assets (
      account_id,
      generation,
      asset_id
    )
    on update no action on delete no action not deferrable,
  constraint player_profile_photo_states_version_check check (
    version between 1 and 9007199254740991
  ),
  constraint player_profile_photo_states_time_check check (
    created_at between 0 and 9007199254740991
    and updated_at between created_at and 9007199254740991
  )
);

create function backend_auth.guard_player_profile_photo_state_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.version <> 1 or new.created_at <> new.updated_at then
      raise exception 'BACKEND_AUTH_PLAYER_PROFILE_PHOTO_STATE_TRANSITION_INVALID';
    end if;

    return new;
  end if;

  if tg_op <> 'UPDATE' then
    raise exception 'BACKEND_AUTH_PLAYER_PROFILE_PHOTO_STATE_TRANSITION_INVALID';
  end if;

  if new.account_id is distinct from old.account_id
     or new.created_at is distinct from old.created_at then
    raise exception 'BACKEND_AUTH_PLAYER_PROFILE_PHOTO_STATE_BINDING_IMMUTABLE';
  end if;

  if old.version >= 9007199254740991
     or new.version <> old.version + 1
     or new.updated_at < old.updated_at
     or new.active_asset_id is not distinct from old.active_asset_id then
    raise exception 'BACKEND_AUTH_PLAYER_PROFILE_PHOTO_STATE_TRANSITION_INVALID';
  end if;

  return new;
end;
$function$;

create trigger player_profile_photo_states_transition_guard
before insert or update on backend_auth.player_profile_photo_states
for each row
execute function backend_auth.guard_player_profile_photo_state_transition();

revoke all on table
  backend_auth.player_profile_photo_assets,
  backend_auth.player_profile_photo_states
from public, backend_auth_app;

revoke all on function backend_auth.guard_player_profile_photo_state_transition()
from public, backend_auth_app;

grant select on table
  backend_auth.player_profile_photo_assets,
  backend_auth.player_profile_photo_states
to backend_auth_app;

grant insert (
  asset_id,
  account_id,
  generation,
  storage_prefix,
  media_type,
  full_dimension,
  full_byte_size,
  content_sha256,
  created_at
) on backend_auth.player_profile_photo_assets to backend_auth_app;

grant insert (
  account_id,
  active_asset_id,
  version,
  created_at,
  updated_at
) on backend_auth.player_profile_photo_states to backend_auth_app;

grant update (
  active_asset_id,
  version,
  updated_at
) on backend_auth.player_profile_photo_states to backend_auth_app;

do $comments$
begin
  execute pg_catalog.format(
    'comment on table backend_auth.player_profile_photo_assets is %L',
    '031_backend_player_profile_photos:'
      || backend_auth.relation_fingerprint(
        'backend_auth.player_profile_photo_assets'::pg_catalog.regclass
      )
  );

  execute pg_catalog.format(
    'comment on table backend_auth.player_profile_photo_states is %L',
    '031_backend_player_profile_photos:'
      || backend_auth.relation_fingerprint(
        'backend_auth.player_profile_photo_states'::pg_catalog.regclass
      )
  );
end;
$comments$;

do $assertions$
declare
  v_asset_oid oid := 'backend_auth.player_profile_photo_assets'::pg_catalog.regclass;
  v_state_oid oid := 'backend_auth.player_profile_photo_states'::pg_catalog.regclass;
  v_function_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.guard_player_profile_photo_state_transition()'
  );
  v_insert_columns text[];
  v_update_columns text[];
begin
  if pg_catalog.pg_get_userbyid((
       select relation.relowner from pg_catalog.pg_class relation
       where relation.oid = v_asset_oid
     )) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((
       select relation.relowner from pg_catalog.pg_class relation
       where relation.oid = v_state_oid
     )) <> 'backend_auth_owner'
     or v_function_oid is null
     or pg_catalog.pg_get_userbyid((
       select routine.proowner from pg_catalog.pg_proc routine
       where routine.oid = v_function_oid
     )) <> 'backend_auth_owner' then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo object owner differs';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_attribute attribute
      where attribute.attrelid = v_asset_oid
        and attribute.attnum > 0 and not attribute.attisdropped) <> 9
     or (select pg_catalog.count(*) from pg_catalog.pg_attribute attribute
         where attribute.attrelid = v_state_oid
           and attribute.attnum > 0 and not attribute.attisdropped) <> 5 then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo column count differs';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = v_asset_oid) <> 12
     or (select pg_catalog.count(*) from pg_catalog.pg_constraint constraint_row
         where constraint_row.conrelid = v_state_oid) <> 5 then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo constraint count differs';
  end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_index index_row
      where index_row.indrelid = v_asset_oid) <> 4
     or (select pg_catalog.count(*) from pg_catalog.pg_index index_row
         where index_row.indrelid = v_state_oid) <> 1 then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo index count differs';
  end if;

  if v_function_oid is null
     or (select pg_catalog.count(*) from pg_catalog.pg_trigger trigger_row
         where trigger_row.tgrelid = v_state_oid
           and not trigger_row.tgisinternal
           and trigger_row.tgname = 'player_profile_photo_states_transition_guard'
           and trigger_row.tgenabled = 'O'
           and trigger_row.tgtype = 23
           and trigger_row.tgfoid = v_function_oid) <> 1
     or exists (
       select 1 from pg_catalog.pg_trigger trigger_row
       where trigger_row.tgrelid in (v_asset_oid, v_state_oid)
         and not trigger_row.tgisinternal
         and not (
           trigger_row.tgrelid = v_state_oid
           and trigger_row.tgname = 'player_profile_photo_states_transition_guard'
           and trigger_row.tgenabled = 'O'
           and trigger_row.tgtype = 23
           and trigger_row.tgfoid = v_function_oid
         )
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo trigger boundary differs';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app', v_asset_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_state_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or not pg_catalog.has_table_privilege('backend_auth_app', v_asset_oid, 'SELECT')
     or not pg_catalog.has_table_privilege('backend_auth_app', v_state_oid, 'SELECT') then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo table privileges differ';
  end if;

  if pg_catalog.has_function_privilege(
       'backend_auth_app', v_function_oid, 'EXECUTE'
     ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo function privilege differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(
      pg_catalog.coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) acl
    where relation.oid in (v_asset_oid, v_state_oid)
      and acl.grantee not in (
        relation.relowner,
        'backend_auth_app'::pg_catalog.regrole
      )
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo relation ACL differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc routine
    cross join lateral pg_catalog.aclexplode(
      pg_catalog.coalesce(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
    ) acl
    where routine.oid = v_function_oid
      and acl.grantee <> routine.proowner
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo function ACL differs';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_insert_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = v_asset_oid
    and attribute.attnum > 0
    and not attribute.attisdropped
    and pg_catalog.has_column_privilege(
      'backend_auth_app', v_asset_oid, attribute.attname, 'INSERT'
    );

  if v_insert_columns is distinct from array[
       'asset_id', 'account_id', 'generation', 'storage_prefix', 'media_type',
       'full_dimension', 'full_byte_size', 'content_sha256', 'created_at'
     ]::text[] then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo asset INSERT boundary differs';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_update_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = v_asset_oid
    and attribute.attnum > 0
    and not attribute.attisdropped
    and pg_catalog.has_column_privilege(
      'backend_auth_app', v_asset_oid, attribute.attname, 'UPDATE'
    );

  if v_update_columns is not null then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo assets are not append-only';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_insert_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = v_state_oid
    and attribute.attnum > 0
    and not attribute.attisdropped
    and pg_catalog.has_column_privilege(
      'backend_auth_app', v_state_oid, attribute.attname, 'INSERT'
    );

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_update_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = v_state_oid
    and attribute.attnum > 0
    and not attribute.attisdropped
    and pg_catalog.has_column_privilege(
      'backend_auth_app', v_state_oid, attribute.attname, 'UPDATE'
    );

  if v_insert_columns is distinct from
       array['account_id', 'active_asset_id', 'version', 'created_at', 'updated_at']::text[]
     or v_update_columns is distinct from
       array['active_asset_id', 'version', 'updated_at']::text[] then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo state write boundary differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute
    cross join lateral pg_catalog.aclexplode(attribute.attacl) acl
    where attribute.attrelid in (v_asset_oid, v_state_oid)
      and attribute.attnum > 0
      and not attribute.attisdropped
      and (
        acl.grantee <> 'backend_auth_app'::pg_catalog.regrole
        or acl.is_grantable
        or acl.privilege_type not in ('INSERT', 'UPDATE')
      )
  ) then
    raise exception 'MIGRATION_ASSERTION_FAILED: profile photo column ACL differs';
  end if;

  if exists (select 1 from backend_auth.player_profile_photo_assets)
     or exists (select 1 from backend_auth.player_profile_photo_states) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 031 storage is not empty';
  end if;

  if pg_catalog.obj_description(v_asset_oid, 'pg_class') <>
       '031_backend_player_profile_photos:'
         || backend_auth.relation_fingerprint(v_asset_oid::pg_catalog.regclass)
     or pg_catalog.obj_description(v_state_oid, 'pg_class') <>
       '031_backend_player_profile_photos:'
         || backend_auth.relation_fingerprint(v_state_oid::pg_catalog.regclass) then
    raise exception 'MIGRATION_ASSERTION_FAILED: migration 031 fingerprint differs';
  end if;
end;
$assertions$;

reset role;
commit;

select '031_backend_player_profile_photos applied; run POSTCHECK before backend photo rollout'
  as result;
