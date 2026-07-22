#!/usr/bin/env bash
set -Eeuo pipefail

# shellcheck source=_common.sh
source "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/_common.sh"

[[ $# -eq 2 ]] || die 'usage: diagnose-restore-fingerprint.sh <source-database> <restored-database>'

source_database="$1"
restored_database="$2"
readonly source_database restored_database

for database in "$source_database" "$restored_database"; do
  [[ "$database" =~ ^prosto_padel_test_[a-z0-9_]+$ ]] ||
    die "database must match ^prosto_padel_test_[a-z0-9_]+$: $database"
  case "$database" in
    *production*|*prod*|*main*|*live*)
      die "production-like database name is forbidden: $database"
      ;;
  esac
done

[[ "$source_database" != "$restored_database" ]] ||
  die 'source and restored database names must differ'

DATABASE_NAME="$source_database"
initialize_test_db_operation 'compare restored relation fingerprints (read-only)'
require_command psql

export PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c search_path=pg_catalog,pg_temp'
readonly PGOPTIONS

IFS= read -r -d '' DIAGNOSTIC_SQL <<'SQL' || true
with relation_row as materialized (
  select rel.*
  from pg_catalog.pg_class rel
  where rel.oid = 'backend_auth.accounts'::pg_catalog.regclass
), components as materialized (
  select
    pg_catalog.jsonb_build_object(
      'name', rel.oid::pg_catalog.regclass::text,
      'kind', rel.relkind,
      'owner', rel.relowner,
      'acl', rel.relacl
    ) as relation_block,
    pg_catalog.jsonb_build_object(
      'name', rel.oid::pg_catalog.regclass::text,
      'kind', rel.relkind,
      'owner', rel.relowner
    ) as relation_without_acl_block,
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'number', a.attnum,
        'name', a.attname,
        'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
        'not_null', a.attnotnull,
        'identity', a.attidentity,
        'generated', a.attgenerated,
        'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid, false),
        'acl', a.attacl
      ) order by a.attnum)
      from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef d
        on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
    ), '[]'::pg_catalog.jsonb) as columns_block,
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'number', a.attnum,
        'name', a.attname,
        'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
        'not_null', a.attnotnull,
        'identity', a.attidentity,
        'generated', a.attgenerated,
        'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid, false)
      ) order by a.attnum)
      from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef d
        on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
    ), '[]'::pg_catalog.jsonb) as columns_without_acl_block,
    coalesce((
      -- Mirror the migration's portable PostgreSQL 14 constraint fingerprint.
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', c.conname,
        'type', c.contype,
        'deferrable', c.condeferrable,
        'deferred', c.condeferred,
        'validated', c.convalidated,
        'table', c.conrelid::pg_catalog.regclass::text,
        'keys', coalesce((
          select pg_catalog.jsonb_agg(a.attname::text order by
            case when c.contype = 'c' then a.attname::text collate "C" end,
            case when c.contype <> 'c' then k.key_position end)
          from pg_catalog.unnest(c.conkey)
            with ordinality k(attnum, key_position)
          join pg_catalog.pg_attribute a
            on a.attrelid = c.conrelid and a.attnum = k.attnum
        ), '[]'::pg_catalog.jsonb),
        'backing_index', case when c.conindid = 0 then null
          else c.conindid::pg_catalog.regclass::text end,
        'referenced_table', case when c.confrelid = 0 then null
          else c.confrelid::pg_catalog.regclass::text end,
        'referenced_keys', coalesce((
          select pg_catalog.jsonb_agg(a.attname::text order by k.key_position)
          from pg_catalog.unnest(c.confkey)
            with ordinality k(attnum, key_position)
          join pg_catalog.pg_attribute a
            on a.attrelid = c.confrelid and a.attnum = k.attnum
        ), '[]'::pg_catalog.jsonb),
        'match_type', c.confmatchtype,
        'on_update', c.confupdtype,
        'on_delete', c.confdeltype,
        'definition', pg_catalog.pg_get_constraintdef(c.oid, true)
      ) order by c.conname::text collate "C")
      from pg_catalog.pg_constraint c
      where c.conrelid = rel.oid
    ), '[]'::pg_catalog.jsonb) as constraints_block,
    coalesce((
      -- Preserve the pre-fix representation solely to explain existing backups.
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', c.conname,
        'type', c.contype,
        'deferrable', c.condeferrable,
        'deferred', c.condeferred,
        'validated', c.convalidated,
        'keys', c.conkey::text,
        'referenced_table', case when c.confrelid = 0 then null
          else c.confrelid::pg_catalog.regclass::text end,
        'referenced_keys', c.confkey::text,
        'on_update', c.confupdtype,
        'on_delete', c.confdeltype,
        'definition', pg_catalog.pg_get_constraintdef(c.oid, false)
      ) order by c.conname)
      from pg_catalog.pg_constraint c
      where c.conrelid = rel.oid
    ), '[]'::pg_catalog.jsonb) as legacy_constraints_block,
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', idx.relname,
        'unique', i.indisunique,
        'primary', i.indisprimary,
        'valid', i.indisvalid,
        'ready', i.indisready,
        'definition', pg_catalog.pg_get_indexdef(i.indexrelid, 0, false),
        'predicate', pg_catalog.pg_get_expr(i.indpred, i.indrelid, false)
      ) order by idx.relname)
      from pg_catalog.pg_index i
      join pg_catalog.pg_class idx on idx.oid = i.indexrelid
      where i.indrelid = rel.oid
    ), '[]'::pg_catalog.jsonb) as indexes_block,
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'name', t.tgname,
        'enabled', t.tgenabled,
        'definition', pg_catalog.pg_get_triggerdef(t.oid, false)
      ) order by t.tgname)
      from pg_catalog.pg_trigger t
      where t.tgrelid = rel.oid and not t.tgisinternal
    ), '[]'::pg_catalog.jsonb) as triggers_block,
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'column', a.attname,
        'acl', a.attacl
      ) order by a.attnum)
      from pg_catalog.pg_attribute a
      where a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
    ), '[]'::pg_catalog.jsonb) as raw_column_acl
  from relation_row rel
), table_acl_rows as (
  select
    case when acl.grantor = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(acl.grantor)::text end as grantor_name,
    case when acl.grantee = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(acl.grantee)::text end as grantee_name,
    acl.privilege_type,
    acl.is_grantable
  from relation_row rel
  cross join lateral pg_catalog.aclexplode(
    coalesce(rel.relacl, pg_catalog.acldefault('r', rel.relowner))
  ) acl
), column_acl_rows as (
  select
    a.attnum as column_number,
    a.attname::text as column_name,
    case when acl.grantor = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(acl.grantor)::text end as grantor_name,
    case when acl.grantee = 0 then 'PUBLIC'
      else pg_catalog.pg_get_userbyid(acl.grantee)::text end as grantee_name,
    acl.privilege_type,
    acl.is_grantable
  from relation_row rel
  join pg_catalog.pg_attribute a
    on a.attrelid = rel.oid and a.attnum > 0 and not a.attisdropped
  cross join lateral pg_catalog.aclexplode(
    coalesce(a.attacl, pg_catalog.acldefault('c', rel.relowner))
  ) acl
), normalized_acl as (
  select
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'grantor', grantor_name,
        'grantee', grantee_name,
        'privilege', privilege_type,
        'grantable', is_grantable
      ) order by grantor_name collate "C", grantee_name collate "C",
                 privilege_type collate "C", is_grantable)
      from table_acl_rows
    ), '[]'::pg_catalog.jsonb) as normalized_table_acl,
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'column', column_name,
        'grantor', grantor_name,
        'grantee', grantee_name,
        'privilege', privilege_type,
        'grantable', is_grantable
      ) order by column_number, grantor_name collate "C", grantee_name collate "C",
                 privilege_type collate "C", is_grantable)
      from column_acl_rows
    ), '[]'::pg_catalog.jsonb) as normalized_column_acl
), diagnostic as (
  select
    pg_catalog.current_database()::text as database_name,
    coalesce(pg_catalog.obj_description(rel.oid, 'pg_class'), '<NULL>')
      as saved_comment_fingerprint,
    backend_auth.relation_fingerprint(rel.oid::pg_catalog.regclass)
      as current_relation_fingerprint,
    case when pg_catalog.obj_description(rel.oid, 'pg_class') =
      '015_backend_auth_foundation:' ||
        backend_auth.relation_fingerprint(rel.oid::pg_catalog.regclass)
      then 'true' else 'false' end as fingerprint_matches,
    pg_catalog.pg_get_userbyid(rel.relowner)::text as owner_name,
    rel.relowner::text as owner_oid,
    pg_catalog.md5(c.relation_block::text) as relation_block_hash,
    pg_catalog.md5(c.columns_block::text) as columns_block_hash,
    pg_catalog.md5(c.constraints_block::text) as constraints_block_hash,
    pg_catalog.md5(c.indexes_block::text) as indexes_block_hash,
    pg_catalog.md5(c.triggers_block::text) as triggers_block_hash,
    pg_catalog.md5(c.relation_without_acl_block::text) as relation_without_acl_hash,
    pg_catalog.md5(c.columns_without_acl_block::text) as columns_without_acl_hash,
    c.constraints_block,
    pg_catalog.md5(c.legacy_constraints_block::text) as legacy_constraints_block_hash,
    c.legacy_constraints_block,
    coalesce(pg_catalog.to_jsonb(rel.relacl)::text, 'null') as raw_table_acl,
    a.normalized_table_acl::text as normalized_table_acl,
    c.raw_column_acl::text as raw_column_acl,
    a.normalized_column_acl::text as normalized_column_acl
  from relation_row rel
  cross join components c
  cross join normalized_acl a
)
select item, value
from diagnostic d
cross join lateral (values
  ('database_name', d.database_name),
  ('saved_comment_fingerprint', d.saved_comment_fingerprint),
  ('current_relation_fingerprint', d.current_relation_fingerprint),
  ('fingerprint_matches', d.fingerprint_matches),
  ('owner_name', d.owner_name),
  ('owner_oid', d.owner_oid),
  ('relation_block_hash', d.relation_block_hash),
  ('columns_block_hash', d.columns_block_hash),
  ('constraints_block_hash', d.constraints_block_hash),
  ('indexes_block_hash', d.indexes_block_hash),
  ('triggers_block_hash', d.triggers_block_hash),
  ('raw_table_acl', d.raw_table_acl),
  ('normalized_table_acl', d.normalized_table_acl),
  ('raw_column_acl', d.raw_column_acl),
  ('normalized_column_acl', d.normalized_column_acl),
  ('relation_without_acl_hash', d.relation_without_acl_hash),
  ('columns_without_acl_hash', d.columns_without_acl_hash),
  ('constraints_block', d.constraints_block::text),
  ('legacy_constraints_block_hash', d.legacy_constraints_block_hash),
  ('legacy_constraints_block', d.legacy_constraints_block::text)
) result(item, value);
SQL
readonly DIAGNOSTIC_SQL

declare -A source_result=()
declare -A restored_result=()

load_diagnostic() {
  local database="$1"
  local result_name="$2"
  local output
  local key
  local value
  local required_key
  local -n result="$result_name"

  output="$(run_psql_database "$database" -X -A -t -q \
    --set=ON_ERROR_STOP=1 \
    --field-separator=$'\t' \
    --command="$DIAGNOSTIC_SQL")" ||
    die "fingerprint diagnostic failed for database: $database"

  while IFS=$'\t' read -r key value; do
    [[ -n "$key" ]] || continue
    [[ ! ${result[$key]+present} ]] || die "duplicate diagnostic key: $key"
    result["$key"]="$value"
  done <<<"$output"

  for required_key in \
    database_name saved_comment_fingerprint current_relation_fingerprint \
    fingerprint_matches owner_name owner_oid relation_block_hash \
    columns_block_hash constraints_block_hash indexes_block_hash \
    triggers_block_hash raw_table_acl normalized_table_acl raw_column_acl \
    normalized_column_acl relation_without_acl_hash columns_without_acl_hash \
    constraints_block legacy_constraints_block_hash legacy_constraints_block
  do
    [[ ${result[$required_key]+present} ]] ||
      die "diagnostic result lacks key $required_key for database: $database"
  done

  [[ "${result[database_name]}" == "$database" ]] ||
    die "diagnostic connected to an unexpected database: ${result[database_name]}"
}

print_diagnostic() {
  local result_name="$1"
  local -n result="$result_name"
  local key

  printf '\n[%s]\n' "${result[database_name]}"
  for key in \
    saved_comment_fingerprint current_relation_fingerprint fingerprint_matches \
    owner_name owner_oid relation_block_hash columns_block_hash \
    constraints_block_hash indexes_block_hash triggers_block_hash \
    legacy_constraints_block_hash \
    raw_table_acl normalized_table_acl raw_column_acl normalized_column_acl
  do
    printf '%s=%s\n' "$key" "${result[$key]}"
  done
}

values_match() {
  local key="$1"
  [[ "${source_result[$key]}" == "${restored_result[$key]}" ]]
}

boolean_match() {
  if values_match "$1"; then
    printf 'true'
  else
    printf 'false'
  fi
}

join_csv() {
  local IFS=,
  if [[ $# -eq 0 ]]; then
    printf 'none'
  else
    printf '%s' "$*"
  fi
}

load_diagnostic "$source_database" source_result
load_diagnostic "$restored_database" restored_result

print_diagnostic source_result
print_diagnostic restored_result

declare -a matching_components=()
declare -a differing_components=()
for component in relation columns constraints indexes triggers; do
  if values_match "${component}_block_hash"; then
    matching_components+=("$component")
  else
    differing_components+=("$component")
  fi
done

only_raw_acl_representation_differs='false'
if values_match relation_without_acl_hash \
   && values_match columns_without_acl_hash \
   && values_match constraints_block_hash \
   && values_match indexes_block_hash \
   && values_match triggers_block_hash \
   && values_match normalized_table_acl \
   && values_match normalized_column_acl \
   && { ! values_match raw_table_acl || ! values_match raw_column_acl; }
then
  only_raw_acl_representation_differs='true'
fi

owner_oid_differs_with_same_name='false'
if values_match owner_name && ! values_match owner_oid; then
  owner_oid_differs_with_same_name='true'
fi

printf '\n[comparison]\n'
printf 'matching_component_hashes=%s\n' "$(join_csv "${matching_components[@]}")"
printf 'differing_component_hashes=%s\n' "$(join_csv "${differing_components[@]}")"
printf 'normalized_table_acl_matches=%s\n' "$(boolean_match normalized_table_acl)"
printf 'normalized_column_acl_matches=%s\n' "$(boolean_match normalized_column_acl)"
printf 'raw_table_acl_matches=%s\n' "$(boolean_match raw_table_acl)"
printf 'raw_column_acl_matches=%s\n' "$(boolean_match raw_column_acl)"
printf 'only_raw_acl_representation_differs=%s\n' "$only_raw_acl_representation_differs"
printf 'owner_oid_differs_with_same_name=%s\n' "$owner_oid_differs_with_same_name"
printf 'legacy_constraints_block_matches=%s\n' \
  "$(boolean_match legacy_constraints_block_hash)"

if ! values_match constraints_block_hash; then
  printf '\n[differing_component:constraints]\n'
  printf 'source=%s\n' "${source_result[constraints_block]}"
  printf 'restored=%s\n' "${restored_result[constraints_block]}"
fi

if ! values_match legacy_constraints_block_hash; then
  printf '\n[legacy_differing_component:constraints]\n'
  printf 'source=%s\n' "${source_result[legacy_constraints_block]}"
  printf 'restored=%s\n' "${restored_result[legacy_constraints_block]}"
fi
