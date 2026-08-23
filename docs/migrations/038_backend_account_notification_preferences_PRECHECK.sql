-- Read-only precheck for 038_backend_account_notification_preferences.sql.

begin read only;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $precheck$
declare
  v_owner pg_catalog.pg_roles%rowtype;
  v_app pg_catalog.pg_roles%rowtype;
  v_relation record;
  v_outbox_oid oid := pg_catalog.to_regclass(
    'backend_match.telegram_notification_outbox'
  );
begin
  if pg_catalog.current_setting('server_version_num')::integer < 140000 then
    raise exception 'PRECHECK_FAILED: PostgreSQL 14 or newer is required';
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
    raise exception 'PRECHECK_FAILED: backend_auth_owner attributes are unsafe';
  end if;

  if v_app.rolname is null
     or not v_app.rolcanlogin
     or v_app.rolsuper
     or v_app.rolcreaterole
     or v_app.rolcreatedb
     or v_app.rolreplication
     or v_app.rolbypassrls then
    raise exception 'PRECHECK_FAILED: backend_auth_app attributes are unsafe';
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
    raise exception 'PRECHECK_FAILED: role membership boundary differs';
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
    raise exception 'PRECHECK_FAILED: backend schema boundary differs';
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
      ),
      (
        'backend_match',
        'telegram_notification_outbox',
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
      raise exception 'PRECHECK_FAILED: %.% differs from %',
        v_relation.schema_name,
        v_relation.relation_name,
        v_relation.migration_name;
    end if;
  end loop;

  if pg_catalog.to_regclass(
       'backend_auth.account_notification_preferences'
     ) is not null
     or pg_catalog.to_regclass(
       'backend_auth.account_notification_preferences_pkey'
     ) is not null then
    raise exception 'PRECHECK_FAILED: migration 038 target object already exists';
  end if;

  if (
       select pg_catalog.count(*)
       from pg_catalog.pg_constraint constraint_row
       where constraint_row.conrelid = v_outbox_oid
         and constraint_row.conname in (
           'telegram_notification_outbox_failure_check',
           'telegram_notification_outbox_state_check'
         )
         and pg_catalog.strpos(
           pg_catalog.pg_get_constraintdef(constraint_row.oid, true),
           'preference_disabled'
         ) = 0
     ) <> 2 then
    raise exception 'PRECHECK_FAILED: migration 030 outbox failure contract differs';
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
    raise exception 'PRECHECK_FAILED: application schema CREATE is unsafe';
  end if;
end;
$precheck$;

select pg_catalog.jsonb_build_object(
  'ready', true,
  'migration', '038_backend_account_notification_preferences',
  'base_commit', '864727d02bec93a44e17491570667f65bc7fbe06',
  'semantics', pg_catalog.jsonb_build_object(
    'missing_preference_row', 'effective_enabled',
    'runtime_connected', false,
    'outbox_terminal_failure_before', 'preference_disabled_absent'
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
  'relation_fingerprints', pg_catalog.jsonb_build_object(
    'accounts', backend_auth.relation_fingerprint(
      'backend_auth.accounts'::pg_catalog.regclass
    ),
    'telegram_notification_destinations',
      backend_auth.relation_fingerprint(
        'backend_auth.telegram_notification_destinations'::pg_catalog.regclass
      ),
    'telegram_notification_outbox',
      backend_auth.relation_fingerprint(
        'backend_match.telegram_notification_outbox'::pg_catalog.regclass
      )
  )
) as backend_account_notification_preferences_precheck;

rollback;
