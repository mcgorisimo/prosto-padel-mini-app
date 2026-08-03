-- Read-only postcheck for 031_backend_player_profile_photos.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $postcheck$
declare
  v_asset_oid oid := pg_catalog.to_regclass(
    'backend_auth.player_profile_photo_assets'
  );
  v_state_oid oid := pg_catalog.to_regclass(
    'backend_auth.player_profile_photo_states'
  );
  v_function_oid oid := pg_catalog.to_regprocedure(
    'backend_auth.guard_player_profile_photo_state_transition()'
  );
  v_column_names text[];
  v_constraint_names text[];
  v_index_names text[];
  v_insert_columns text[];
  v_update_columns text[];
  v_fk_columns text[];
  v_fk_referenced_columns text[];
begin
  if v_asset_oid is null or v_state_oid is null or v_function_oid is null then
    raise exception 'POSTCHECK_FAILED: migration 031 object is missing';
  end if;

  if pg_catalog.pg_get_userbyid((
       select relation.relowner from pg_catalog.pg_class relation
       where relation.oid = v_asset_oid
     )) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((
       select relation.relowner from pg_catalog.pg_class relation
       where relation.oid = v_state_oid
     )) <> 'backend_auth_owner'
     or pg_catalog.pg_get_userbyid((
       select routine.proowner from pg_catalog.pg_proc routine
       where routine.oid = v_function_oid
     )) <> 'backend_auth_owner' then
    raise exception 'POSTCHECK_FAILED: migration 031 owner differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class relation
    where relation.oid in (v_asset_oid, v_state_oid)
      and (
        relation.relkind <> 'r'
        or relation.relpersistence <> 'p'
        or relation.relrowsecurity
        or relation.relforcerowsecurity
      )
  ) then
    raise exception 'POSTCHECK_FAILED: profile photo relation access mode differs';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_column_names
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = v_asset_oid
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_column_names is distinct from array[
       'asset_id', 'account_id', 'generation', 'storage_prefix', 'media_type',
       'full_dimension', 'full_byte_size', 'content_sha256', 'created_at'
     ]::text[] then
    raise exception 'POSTCHECK_FAILED: profile photo asset columns differ';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = v_asset_oid
      and attribute.attnum > 0
      and not attribute.attisdropped
      and (
        not attribute.attnotnull
        or pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) <>
          case attribute.attname
            when 'asset_id' then 'uuid'
            when 'account_id' then 'uuid'
            when 'generation' then 'bigint'
            when 'storage_prefix' then 'text'
            when 'media_type' then 'text'
            when 'full_dimension' then 'integer'
            when 'full_byte_size' then 'bigint'
            when 'content_sha256' then 'bytea'
            when 'created_at' then 'bigint'
          end
      )
  ) then
    raise exception 'POSTCHECK_FAILED: profile photo asset column shape differs';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_column_names
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = v_state_oid
    and attribute.attnum > 0
    and not attribute.attisdropped;

  if v_column_names is distinct from
     array['account_id', 'active_asset_id', 'version', 'created_at', 'updated_at']::text[] then
    raise exception 'POSTCHECK_FAILED: profile photo state columns differ';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = v_state_oid
      and attribute.attnum > 0
      and not attribute.attisdropped
      and (
        (attribute.attname <> 'active_asset_id' and not attribute.attnotnull)
        or (attribute.attname = 'active_asset_id' and attribute.attnotnull)
        or pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) <>
          case attribute.attname
            when 'account_id' then 'uuid'
            when 'active_asset_id' then 'uuid'
            when 'version' then 'bigint'
            when 'created_at' then 'bigint'
            when 'updated_at' then 'bigint'
          end
      )
  ) then
    raise exception 'POSTCHECK_FAILED: profile photo state column shape differs';
  end if;

  select pg_catalog.array_agg(constraint_row.conname order by constraint_row.conname)
  into v_constraint_names
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_asset_oid;

  if v_constraint_names is distinct from array[
       'player_profile_photo_assets_account_generation_asset_key',
       'player_profile_photo_assets_account_generation_key',
       'player_profile_photo_assets_account_id_fkey',
       'player_profile_photo_assets_byte_size_check',
       'player_profile_photo_assets_digest_check',
       'player_profile_photo_assets_dimension_check',
       'player_profile_photo_assets_generation_check',
       'player_profile_photo_assets_media_type_check',
       'player_profile_photo_assets_pkey',
       'player_profile_photo_assets_storage_prefix_check',
       'player_profile_photo_assets_storage_prefix_key',
       'player_profile_photo_assets_time_check'
     ]::text[] then
    raise exception 'POSTCHECK_FAILED: profile photo asset constraint allowlist differs';
  end if;

  select pg_catalog.array_agg(constraint_row.conname order by constraint_row.conname)
  into v_constraint_names
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = v_state_oid;

  if v_constraint_names is distinct from array[
       'player_profile_photo_states_account_id_fkey',
       'player_profile_photo_states_active_asset_fkey',
       'player_profile_photo_states_pkey',
       'player_profile_photo_states_time_check',
       'player_profile_photo_states_version_check'
     ]::text[] then
    raise exception 'POSTCHECK_FAILED: profile photo state constraint allowlist differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid in (v_asset_oid, v_state_oid)
      and (
        constraint_row.condeferrable
        or constraint_row.condeferred
        or not constraint_row.convalidated
      )
  ) then
    raise exception 'POSTCHECK_FAILED: profile photo constraint mode differs';
  end if;

  select
    pg_catalog.array_agg(source_attribute.attname order by source_key.ordinality),
    pg_catalog.array_agg(target_attribute.attname order by source_key.ordinality)
  into v_fk_columns, v_fk_referenced_columns
  from pg_catalog.pg_constraint constraint_row
  cross join lateral pg_catalog.unnest(constraint_row.conkey)
    with ordinality source_key(attribute_number, ordinality)
  join pg_catalog.pg_attribute source_attribute
    on source_attribute.attrelid = constraint_row.conrelid
   and source_attribute.attnum = source_key.attribute_number
  join lateral pg_catalog.unnest(constraint_row.confkey)
    with ordinality target_key(attribute_number, ordinality)
    on target_key.ordinality = source_key.ordinality
  join pg_catalog.pg_attribute target_attribute
    on target_attribute.attrelid = constraint_row.confrelid
   and target_attribute.attnum = target_key.attribute_number
  where constraint_row.conrelid = v_state_oid
    and constraint_row.conname = 'player_profile_photo_states_active_asset_fkey'
    and constraint_row.confrelid = v_asset_oid;

  if v_fk_columns is distinct from
       array['account_id', 'version', 'active_asset_id']::text[]
     or v_fk_referenced_columns is distinct from
       array['account_id', 'generation', 'asset_id']::text[] then
    raise exception 'POSTCHECK_FAILED: cross-account photo binding guard differs';
  end if;

  select pg_catalog.array_agg(index_relation.relname order by index_relation.relname)
  into v_index_names
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation on index_relation.oid = index_row.indexrelid
  where index_row.indrelid = v_asset_oid;

  if v_index_names is distinct from array[
       'player_profile_photo_assets_account_generation_asset_key',
       'player_profile_photo_assets_account_generation_key',
       'player_profile_photo_assets_pkey',
       'player_profile_photo_assets_storage_prefix_key'
     ]::text[] then
    raise exception 'POSTCHECK_FAILED: profile photo asset index allowlist differs';
  end if;

  select pg_catalog.array_agg(index_relation.relname order by index_relation.relname)
  into v_index_names
  from pg_catalog.pg_index index_row
  join pg_catalog.pg_class index_relation on index_relation.oid = index_row.indexrelid
  where index_row.indrelid = v_state_oid;

  if v_index_names is distinct from array['player_profile_photo_states_pkey']::text[] then
    raise exception 'POSTCHECK_FAILED: profile photo state index allowlist differs';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_index index_row
    where index_row.indrelid in (v_asset_oid, v_state_oid)
      and (not index_row.indisvalid or not index_row.indisready)
  ) then
    raise exception 'POSTCHECK_FAILED: profile photo index is not ready';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid = v_state_oid
        and not trigger_row.tgisinternal
        and trigger_row.tgname = 'player_profile_photo_states_transition_guard'
        and trigger_row.tgenabled = 'O'
        and trigger_row.tgtype = 23
        and trigger_row.tgfoid = v_function_oid) <> 1
     or exists (
       select 1
       from pg_catalog.pg_trigger trigger_row
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
    raise exception 'POSTCHECK_FAILED: profile photo trigger boundary differs';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_language language on language.oid = routine.prolang
    where routine.oid = v_function_oid
      and language.lanname = 'plpgsql'
      and not routine.prosecdef
      and not routine.proretset
      and routine.provolatile = 'v'
      and routine.proconfig = array['search_path=pg_catalog, pg_temp']::text[]
  )
     or pg_catalog.has_function_privilege(
       'backend_auth_app', v_function_oid, 'EXECUTE'
     ) then
    raise exception 'POSTCHECK_FAILED: profile photo transition function differs';
  end if;

  if not pg_catalog.has_table_privilege('backend_auth_app', v_asset_oid, 'SELECT')
     or not pg_catalog.has_table_privilege('backend_auth_app', v_state_oid, 'SELECT')
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_asset_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     )
     or pg_catalog.has_table_privilege(
       'backend_auth_app', v_state_oid,
       'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
     ) then
    raise exception 'POSTCHECK_FAILED: profile photo table privileges differ';
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
    raise exception 'POSTCHECK_FAILED: profile photo asset INSERT boundary differs';
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
    raise exception 'POSTCHECK_FAILED: profile photo assets are not append-only';
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
    raise exception 'POSTCHECK_FAILED: profile photo state write boundary differs';
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
    raise exception 'POSTCHECK_FAILED: profile photo relation has an unexpected ACL grantee';
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
    raise exception 'POSTCHECK_FAILED: profile photo column ACL differs';
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
    raise exception 'POSTCHECK_FAILED: profile photo function ACL differs';
  end if;

  if exists (select 1 from backend_auth.player_profile_photo_assets)
     or exists (select 1 from backend_auth.player_profile_photo_states) then
    raise exception 'POSTCHECK_FAILED: migration 031 storage is not empty';
  end if;

  if pg_catalog.obj_description(v_asset_oid, 'pg_class') <>
       '031_backend_player_profile_photos:'
         || backend_auth.relation_fingerprint(v_asset_oid::pg_catalog.regclass)
     or pg_catalog.obj_description(v_state_oid, 'pg_class') <>
       '031_backend_player_profile_photos:'
         || backend_auth.relation_fingerprint(v_state_oid::pg_catalog.regclass) then
    raise exception 'POSTCHECK_FAILED: migration 031 fingerprint differs';
  end if;
end;
$postcheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '031_backend_player_profile_photos',
  'row_counts', pg_catalog.jsonb_build_object(
    'accounts', (select pg_catalog.count(*) from backend_auth.accounts),
    'player_profiles', (select pg_catalog.count(*) from backend_auth.player_profiles),
    'player_profile_details', (
      select pg_catalog.count(*) from backend_auth.player_profile_details
    ),
    'player_profile_photo_assets', (
      select pg_catalog.count(*) from backend_auth.player_profile_photo_assets
    ),
    'player_profile_photo_states', (
      select pg_catalog.count(*) from backend_auth.player_profile_photo_states
    )
  ),
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'accounts', backend_auth.relation_fingerprint(
      'backend_auth.accounts'::pg_catalog.regclass
    ),
    'player_profiles', backend_auth.relation_fingerprint(
      'backend_auth.player_profiles'::pg_catalog.regclass
    ),
    'player_profile_details', backend_auth.relation_fingerprint(
      'backend_auth.player_profile_details'::pg_catalog.regclass
    ),
    'player_profile_photo_assets', backend_auth.relation_fingerprint(
      'backend_auth.player_profile_photo_assets'::pg_catalog.regclass
    ),
    'player_profile_photo_states', backend_auth.relation_fingerprint(
      'backend_auth.player_profile_photo_states'::pg_catalog.regclass
    )
  ),
  'backend_auth_catalog_counts', pg_catalog.jsonb_build_object(
    'tables', (
      select pg_catalog.count(*)
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth' and relation.relkind = 'r'
    ),
    'constraints', (
      select pg_catalog.count(*)
      from pg_catalog.pg_constraint constraint_row
      join pg_catalog.pg_class relation on relation.oid = constraint_row.conrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth'
    ),
    'user_triggers', (
      select pg_catalog.count(*)
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid = trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'backend_auth' and not trigger_row.tgisinternal
    )
  )
) as backend_player_profile_photos_postcheck;

rollback;
