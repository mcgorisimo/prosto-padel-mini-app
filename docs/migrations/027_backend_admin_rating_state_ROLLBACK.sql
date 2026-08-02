-- Fail-closed rollback for an unused migration 027.
-- Once an admin command exists, use a reviewed forward migration.

begin;
set local search_path = pg_catalog, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preconditions$
declare
  v_relation record;
begin
  if not pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER') then
    raise exception 'ROLLBACK_PRECONDITION_FAILED: current user cannot assume backend_auth_owner';
  end if;

  for v_relation in
    select *
    from (values
      ('backend_auth', 'accounts', '015_backend_auth_foundation'),
      ('backend_auth', 'player_rating_states', '027_backend_admin_rating_state'),
      ('backend_auth', 'player_rating_admin_commands', '027_backend_admin_rating_state')
    ) expected(schema_name, relation_name, migration_name)
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
          v_relation.migration_name || ':'
            || backend_auth.relation_fingerprint(relation.oid::pg_catalog.regclass)
    ) then
      raise exception 'ROLLBACK_PRECONDITION_FAILED: %.% differs from %',
        v_relation.schema_name,
        v_relation.relation_name,
        v_relation.migration_name;
    end if;
  end loop;
end;
$preconditions$;

set local role backend_auth_owner;

-- Account provisioning acquires accounts before player_rating_states, and the
-- later admin writer must use the same relation order before inserting its
-- command. Lock every referenced relation before the audit table so DROP does
-- not acquire an undeclared accounts lock after player_rating_states.
lock table
  backend_auth.accounts,
  backend_auth.player_rating_states,
  backend_auth.player_rating_admin_commands
in access exclusive mode;

do $empty_guard$
begin
  if exists (select 1 from backend_auth.player_rating_admin_commands) then
    raise exception 'ROLLBACK_REFUSED: admin rating audit exists; use a forward migration';
  end if;
end;
$empty_guard$;

revoke update (is_verified)
  on backend_auth.player_rating_states
  from backend_auth_app;

drop table backend_auth.player_rating_admin_commands;

do $restore_comment$
begin
  execute pg_catalog.format(
    'comment on table backend_auth.player_rating_states is %L',
    '026_backend_match_rating_applications:'
      || backend_auth.relation_fingerprint(
        'backend_auth.player_rating_states'::pg_catalog.regclass
      )
  );
end;
$restore_comment$;

do $assertions$
declare
  v_update_columns text[];
begin
  if pg_catalog.to_regclass(
       'backend_auth.player_rating_admin_commands'
     ) is not null then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 027 relation remains';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'UPDATE'
     ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: player_rating_states table UPDATE is unsafe';
  end if;

  select pg_catalog.array_agg(attribute.attname order by attribute.attnum)
  into v_update_columns
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'backend_auth.player_rating_states'::pg_catalog.regclass
    and attribute.attnum > 0
    and not attribute.attisdropped
    and pg_catalog.has_column_privilege(
      'backend_auth_app',
      'backend_auth.player_rating_states',
      attribute.attname,
      'UPDATE'
    );

  if v_update_columns is distinct from array['rating', 'updated_at']::text[] then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 026 rating writer boundary was not restored';
  end if;

  if pg_catalog.obj_description(
       'backend_auth.player_rating_states'::pg_catalog.regclass,
       'pg_class'
     ) <>
     '026_backend_match_rating_applications:'
       || backend_auth.relation_fingerprint(
         'backend_auth.player_rating_states'::pg_catalog.regclass
       ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: player_rating_states fingerprint was not restored';
  end if;
end;
$assertions$;

reset role;
commit;

select '027_backend_admin_rating_state rolled back before first admin command'
  as result;
