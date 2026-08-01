-- Fail-closed rollback for an unused migration 026.
-- Once a rating application exists, use a reviewed forward migration.

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
      raise exception 'ROLLBACK_PRECONDITION_FAILED: %.% differs from migration 026',
        v_relation.schema_name,
        v_relation.relation_name;
    end if;
  end loop;
end;
$preconditions$;

set local role backend_auth_owner;

lock table
  backend_auth.player_rating_states,
  backend_match.match_rating_applications,
  backend_match.match_rating_changes
in access exclusive mode;

do $empty_guard$
begin
  if exists (select 1 from backend_match.match_rating_applications)
     or exists (select 1 from backend_match.match_rating_changes) then
    raise exception 'ROLLBACK_REFUSED: rating history exists; use a forward migration';
  end if;
end;
$empty_guard$;

revoke update (rating, updated_at)
  on backend_auth.player_rating_states
  from backend_auth_app;

drop table backend_match.match_rating_changes;
drop table backend_match.match_rating_applications;

do $restore_comment$
begin
  execute pg_catalog.format(
    'comment on table backend_auth.player_rating_states is %L',
    '019_backend_auth_player_rating_state:'
      || backend_auth.relation_fingerprint(
        'backend_auth.player_rating_states'::pg_catalog.regclass
      )
  );
end;
$restore_comment$;

do $assertions$
begin
  if pg_catalog.to_regclass('backend_match.match_rating_applications') is not null
     or pg_catalog.to_regclass('backend_match.match_rating_changes') is not null then
    raise exception 'ROLLBACK_ASSERTION_FAILED: migration 026 relation remains';
  end if;

  if pg_catalog.has_table_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'rating', 'UPDATE'
     )
     or pg_catalog.has_column_privilege(
       'backend_auth_app', 'backend_auth.player_rating_states', 'updated_at', 'UPDATE'
     ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: rating writer privilege remains';
  end if;

  if pg_catalog.obj_description(
       'backend_auth.player_rating_states'::pg_catalog.regclass,
       'pg_class'
     ) <>
     '019_backend_auth_player_rating_state:'
       || backend_auth.relation_fingerprint(
         'backend_auth.player_rating_states'::pg_catalog.regclass
       ) then
    raise exception 'ROLLBACK_ASSERTION_FAILED: player_rating_states fingerprint was not restored';
  end if;
end;
$assertions$;

reset role;
commit;

select '026_backend_match_rating_applications rolled back before first rating write' as result;
