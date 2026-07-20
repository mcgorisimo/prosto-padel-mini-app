-- 012_training_domain_ROLLBACK.sql
-- Removes only positively identified migration 012 objects, including a
-- partially present set. It never uses CASCADE and never touches legacy tables,
-- create_booking, the overlap constraint, or shared functions.
--
-- If a 012 table contains rows, confirmation must be transaction-local and must
-- have the form CONFIRM_DELETE_TRAINING_012_DATA:<current_transaction_id>.
-- No confirmation is enabled by this script. See README for the guarded flow.

begin;
set local search_path = pg_catalog, public, pg_temp;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  v_relation_name text;
  v_relation regclass;
  v_row_count bigint;
  v_total_rows bigint := 0;
  v_object_comment text;
  v_stored_fingerprint text;
  v_schema_fingerprint text;
  v_function_signature text;
  v_function regprocedure;
  v_function_fingerprint text;
  v_function_owner oid;
  v_transaction_id text;
  v_expected_confirmation text;
begin
  foreach v_relation_name in array array[
    'public.training_coach_assignments',
    'public.training_status_history',
    'public.training_requests'
  ]::text[] loop
    v_relation := pg_catalog.to_regclass(v_relation_name);

    if v_relation is not null then
      execute pg_catalog.format(
        'lock table %s in access exclusive mode',
        v_relation
      );

      select coalesce(pg_catalog.obj_description(c.oid, 'pg_class'), '')
      into v_object_comment
      from pg_catalog.pg_class c
      where c.oid = v_relation
        and c.relkind in ('r', 'p')
        and c.relowner = (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user);

      if v_object_comment is null
         or v_object_comment not like 'migration=012_training_domain;%'
         or substring(v_object_comment from 'schema_md5=([0-9a-f]{32})') is null then
        raise exception 'ROLLBACK_ABORTED: % is not a confirmed migration 012 table owned by current_user',
          v_relation_name;
      end if;

      v_stored_fingerprint := substring(
        v_object_comment from 'schema_md5=([0-9a-f]{32})'
      );

      select pg_catalog.md5(
        pg_catalog.jsonb_build_object(
          'relation', pg_catalog.jsonb_build_object(
            'name', rel.oid::pg_catalog.regclass::text,
            'kind', rel.relkind,
            'owner', pg_catalog.pg_get_userbyid(rel.relowner),
            'row_security', rel.relrowsecurity,
            'force_row_security', rel.relforcerowsecurity,
            'replica_identity', rel.relreplident,
            'options', rel.reloptions,
            'acl', rel.relacl
          ),
          'columns', coalesce((
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'number', a.attnum,
                'name', a.attname,
                'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
                'not_null', a.attnotnull,
                'identity', a.attidentity,
                'generated', a.attgenerated,
                'collation', a.attcollation,
                'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid, false)
              )
              order by a.attnum
            )
            from pg_catalog.pg_attribute a
            left join pg_catalog.pg_attrdef d
              on d.adrelid = a.attrelid and d.adnum = a.attnum
            where a.attrelid = rel.oid
              and a.attnum > 0
              and not a.attisdropped
          ), '[]'::jsonb),
          'constraints', coalesce((
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'name', con.conname,
                'type', con.contype,
                'deferrable', con.condeferrable,
                'deferred', con.condeferred,
                'validated', con.convalidated,
                'keys', con.conkey::text,
                'referenced_table', case
                  when con.confrelid = 0 then null
                  else con.confrelid::pg_catalog.regclass::text
                end,
                'referenced_keys', con.confkey::text,
                'on_update', con.confupdtype,
                'on_delete', con.confdeltype,
                'match_type', con.confmatchtype,
                'definition', pg_catalog.pg_get_constraintdef(con.oid, false)
              )
              order by con.conname
            )
            from pg_catalog.pg_constraint con
            where con.conrelid = rel.oid
          ), '[]'::jsonb),
          'indexes', coalesce((
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'name', idx.relname,
                'unique', i.indisunique,
                'primary', i.indisprimary,
                'valid', i.indisvalid,
                'ready', i.indisready,
                'key_count', i.indnkeyatts,
                'attribute_count', i.indnatts,
                'keys', i.indkey::text,
                'options', i.indoption::text,
                'expressions', pg_catalog.pg_get_expr(i.indexprs, i.indrelid, false),
                'predicate', pg_catalog.pg_get_expr(i.indpred, i.indrelid, false),
                'definition', pg_catalog.pg_get_indexdef(i.indexrelid, 0, false)
              )
              order by idx.relname
            )
            from pg_catalog.pg_index i
            join pg_catalog.pg_class idx on idx.oid = i.indexrelid
            where i.indrelid = rel.oid
          ), '[]'::jsonb),
          'policies', coalesce((
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'name', pol.polname,
                'permissive', pol.polpermissive,
                'command', pol.polcmd,
                'roles', (
                  select pg_catalog.jsonb_agg(
                    pg_catalog.pg_get_userbyid(role_oid)
                    order by pg_catalog.pg_get_userbyid(role_oid)
                  )
                  from pg_catalog.unnest(pol.polroles) as policy_roles(role_oid)
                ),
                'using', pg_catalog.pg_get_expr(pol.polqual, pol.polrelid, false),
                'with_check', pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid, false)
              )
              order by pol.polname
            )
            from pg_catalog.pg_policy pol
            where pol.polrelid = rel.oid
          ), '[]'::jsonb),
          'triggers', coalesce((
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'name', trg.tgname,
                'enabled', trg.tgenabled,
                'type', trg.tgtype,
                'columns', trg.tgattr::text,
                'function', trg.tgfoid::pg_catalog.regprocedure::text,
                'definition', pg_catalog.pg_get_triggerdef(trg.oid, false)
              )
              order by trg.tgname
            )
            from pg_catalog.pg_trigger trg
            where trg.tgrelid = rel.oid
              and not trg.tgisinternal
          ), '[]'::jsonb)
        )::text
      )
      into v_schema_fingerprint
      from pg_catalog.pg_class rel
      where rel.oid = v_relation;

      if v_schema_fingerprint is distinct from v_stored_fingerprint then
        raise exception using
          errcode = '55000',
          message = 'ROLLBACK_ABORTED_MIGRATION_012_TABLE_CHANGED',
          detail = pg_catalog.format(
            '%s has columns, defaults, constraints, indexes, policies, triggers, ACL, owner or RLS flags outside its stored 012 manifest. Roll back later migrations first.',
            v_relation_name
          );
      end if;

      execute pg_catalog.format('select count(*) from %s', v_relation)
      into v_row_count;
      v_total_rows := v_total_rows + v_row_count;
    end if;
  end loop;

  foreach v_function_signature in array array[
    'public.training_request_validate_booking()',
    'public.training_request_prevent_delete()',
    'public.training_status_history_prevent_mutation()'
  ]::text[] loop
    v_function := pg_catalog.to_regprocedure(v_function_signature);

    if v_function is not null then
      select
        coalesce(pg_catalog.obj_description(p.oid, 'pg_proc'), ''),
        pg_catalog.md5(
          pg_catalog.replace(
            pg_catalog.replace(
              coalesce(pg_catalog.pg_get_functiondef(p.oid), ''),
              E'\r\n',
              E'\n'
            ),
            E'\r',
            E'\n'
          )
        ),
        p.proowner
      into v_object_comment, v_function_fingerprint, v_function_owner
      from pg_catalog.pg_proc p
      where p.oid = v_function
        and p.proowner = (select r.oid from pg_catalog.pg_roles r where r.rolname = current_user);

      if v_object_comment is null
         or v_object_comment not like 'migration=012_training_domain;%'
         or substring(v_object_comment from 'definition_md5=([0-9a-f]{32})')
            is distinct from v_function_fingerprint
         or substring(v_object_comment from 'owner_oid=([0-9]+)')
            is distinct from v_function_owner::text then
        raise exception 'ROLLBACK_ABORTED: % definition, owner, security mode or search_path differs from migration 012',
          v_function_signature;
      end if;
    end if;
  end loop;

  if v_total_rows > 0 then
    v_transaction_id := pg_catalog.pg_current_xact_id()::text;
    v_expected_confirmation :=
      'CONFIRM_DELETE_TRAINING_012_DATA:' || v_transaction_id;

    if pg_catalog.current_setting(
         'prosto_padel.rollback_012_confirm_data_loss',
         true
       ) is distinct from v_expected_confirmation then
      raise exception using
        errcode = '55000',
        message = 'ROLLBACK_ABORTED_TRAINING_012_DATA_EXISTS',
        detail = pg_catalog.format(
          '%s rows exist. A transaction-local confirmation bound to current transaction %s is required.',
          v_total_rows,
          v_transaction_id
        );
    end if;
  end if;
end;
$$;

-- Child tables first, then the protected parent. DROP TABLE removes only the
-- table-owned objects already proven equal to their stored 012 manifests.
-- Unknown external dependencies fail because CASCADE is intentionally absent.
drop table if exists public.training_coach_assignments;
drop table if exists public.training_status_history;
drop table if exists public.training_requests;

-- Table triggers are now gone, so only positively identified standalone trigger
-- functions remain to be removed.
drop function if exists public.training_status_history_prevent_mutation();
drop function if exists public.training_request_prevent_delete();
drop function if exists public.training_request_validate_booking();

commit;

select pg_catalog.jsonb_build_object(
  'migration', '012_training_domain',
  'status', 'ROLLBACK_012_COMPLETE',
  'legacy_objects_modified', false,
  'cascade_used', false,
  'confirmation_scope', 'current_transaction_id'
) as training_domain_rollback_result;
