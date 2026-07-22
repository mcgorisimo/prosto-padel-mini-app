#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

initialize_test_db_operation 'restore into a newly created test database'
require_command psql
require_command createdb
require_command pg_restore
require_command sha256sum
require_command realpath
require_command find

[[ $# -eq 1 ]] || die 'usage: restore.sh <backup-set-directory>'
[[ -d "$BACKUPS_DIR" ]] || die "backups directory is missing: $BACKUPS_DIR"

backup_input="$1"
if [[ "$backup_input" != /* ]]; then
  backup_input="$BACKUPS_DIR/$backup_input"
fi
[[ -d "$backup_input" ]] || die "backup set directory does not exist: $backup_input"
[[ ! -L "$backup_input" ]] || die 'backup set directory must not be a symlink'

backups_root="$(realpath -e -- "$BACKUPS_DIR")"
backup_dir="$(realpath -e -- "$backup_input")"
[[ "$(dirname -- "$backup_dir")" == "$backups_root" ]] ||
  die 'backup set must be a direct child of infra/test/backups'

while IFS= read -r -d '' backup_entry; do
  entry_name="${backup_entry##*/}"
  case "$entry_name" in
    database.dump|globals.sql|manifest.txt) ;;
    *) die "backup set contains an unexpected entry: $entry_name" ;;
  esac
done < <(find "$backup_dir" -mindepth 1 -maxdepth 1 -print0)

dump_file="$backup_dir/database.dump"
globals_file="$backup_dir/globals.sql"
manifest_file="$backup_dir/manifest.txt"
for required_path in "$dump_file" "$globals_file" "$manifest_file"; do
  [[ -f "$required_path" ]] || die "required backup file is missing: $required_path"
  [[ ! -L "$required_path" ]] || die "backup files must not be symlinks: $required_path"
  [[ "$(realpath -e -- "$required_path")" == "$required_path" ]] ||
    die "backup file resolves outside its expected path: $required_path"
  [[ -s "$required_path" ]] || die "required backup file is empty: $required_path"
done

manifest_value() {
  local key="$1"
  local count
  local value
  count="$(grep -c "^${key}=" "$manifest_file" || true)"
  [[ "$count" == '1' ]] || die "manifest key must occur exactly once: $key"
  value="$(sed -n "s/^${key}=//p" "$manifest_file")"
  value="${value%$'\r'}"
  [[ -n "$value" ]] || die "manifest value must not be empty: $key"
  printf '%s' "$value"
}

[[ "$(wc -l < "$manifest_file" | tr -d '[:space:]')" == '9' ]] ||
  die 'manifest must contain exactly nine fields'
if grep -Evq '^(format_version|database|host|port|user|utc_timestamp|postgresql_client_version|dump_sha256|globals_sha256)=' "$manifest_file"; then
  die 'manifest contains an unknown or malformed field'
fi

format_version="$(manifest_value format_version)"
source_database="$(manifest_value database)"
source_host="$(manifest_value host)"
source_port="$(manifest_value port)"
source_user="$(manifest_value user)"
source_timestamp="$(manifest_value utc_timestamp)"
client_version="$(manifest_value postgresql_client_version)"
expected_dump_sha256="$(manifest_value dump_sha256)"
expected_globals_sha256="$(manifest_value globals_sha256)"

[[ "$format_version" == '1' ]] || die 'unsupported backup manifest format'
[[ "$source_database" =~ ^prosto_padel_test_[a-z0-9_]+$ ]] || die 'manifest source database is unsafe'
[[ "$source_database" != "$DATABASE_NAME" ]] || die 'restore target must differ from the source database'
[[ "$source_host" == 'postgres' && "$source_port" == '5432' ]] || die 'manifest source target is not the allowed Compose PostgreSQL service'
[[ -n "$(trim_value "$source_user")" && "$source_user" == "$(trim_value "$source_user")" ]] || die 'manifest user is invalid'
[[ "$source_timestamp" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || die 'manifest UTC timestamp is invalid'
[[ -n "$(trim_value "$client_version")" ]] || die 'manifest PostgreSQL client version is invalid'
[[ "$expected_dump_sha256" =~ ^[0-9a-f]{64}$ ]] || die 'manifest dump SHA-256 is invalid'
[[ "$expected_globals_sha256" =~ ^[0-9a-f]{64}$ ]] || die 'manifest globals SHA-256 is invalid'

actual_dump_sha256="$(sha256sum "$dump_file" | awk '{print $1}')"
actual_globals_sha256="$(sha256sum "$globals_file" | awk '{print $1}')"
[[ "$actual_dump_sha256" == "$expected_dump_sha256" ]] || die 'database.dump SHA-256 mismatch'
[[ "$actual_globals_sha256" == "$expected_globals_sha256" ]] || die 'globals.sql SHA-256 mismatch'

grep -Iq . "$globals_file" || die 'globals.sql is not readable text'
if grep -Eiq '(^|[^[:alnum:]_])password([^[:alnum:]_]|$)' "$globals_file"; then
  die 'globals.sql contains a role password clause and will not be accepted'
fi
grep -Eq '^CREATE ROLE backend_auth_owner;[[:space:]]*$' "$globals_file" || die 'globals.sql lacks the backend_auth_owner role definition'
grep -Eq '^CREATE ROLE backend_auth_app;[[:space:]]*$' "$globals_file" || die 'globals.sql lacks the backend_auth_app role definition'

# Archive validation is deliberately completed before the first database connection.
pg_restore --list "$dump_file" >/dev/null

roles_are_safe="$(run_psql_database postgres -X -A -t -q --set=ON_ERROR_STOP=1 --command="
select case when
  exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'backend_auth_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb
      and not rolcreaterole and not rolinherit and not rolreplication and not rolbypassrls
  )
  and exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'backend_auth_app'
      and rolcanlogin and not rolsuper and not rolcreatedb
      and not rolcreaterole and not rolinherit and not rolreplication and not rolbypassrls
  )
  and not pg_catalog.pg_has_role('backend_auth_app', 'backend_auth_owner', 'MEMBER')
  and pg_catalog.pg_has_role(current_user, 'backend_auth_owner', 'MEMBER')
then 'YES' else 'NO' end;")"
[[ "$roles_are_safe" == 'YES' ]] ||
  die 'required roles are missing or unsafe; run provision-test-roles.sh separately, then retry restore'

database_exists="$(run_psql_database postgres -X -A -t -q --set=ON_ERROR_STOP=1 --command="
select case when exists (
  select 1 from pg_catalog.pg_database where datname = '$DATABASE_NAME'
) then 'YES' else 'NO' end;")"
[[ "$database_exists" == 'NO' ]] || die "restore target database already exists: $DATABASE_NAME"

postcheck_file="$MIGRATIONS_DIR/015_backend_auth_foundation_POSTCHECK.sql"
require_file "$postcheck_file"

created_target='NO'
report_manual_cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$created_target" == 'YES' ]]; then
    printf 'Restore failed; test database preserved for diagnosis: %s\n' "$DATABASE_NAME" >&2
    printf 'Delete it only as a separate approved action after inspection.\n' >&2
  fi
  exit "$status"
}
trap report_manual_cleanup EXIT

run_createdb "$DATABASE_NAME"
created_target='YES'

user_object_count="$(run_psql -X -A -t -q --set=ON_ERROR_STOP=1 --command="
select
  (select pg_catalog.count(*) from pg_catalog.pg_namespace n
   where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast', 'public')
     and n.nspname !~ '^pg_(temp|toast_temp)_')
  + (select pg_catalog.count(*) from pg_catalog.pg_class c
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and n.nspname !~ '^pg_(temp|toast_temp)_')
  + (select pg_catalog.count(*) from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and n.nspname !~ '^pg_(temp|toast_temp)_')
  + (select pg_catalog.count(*) from pg_catalog.pg_type t
     join pg_catalog.pg_namespace n on n.oid = t.typnamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and n.nspname !~ '^pg_(temp|toast_temp)_'
       and (
         not t.typisdefined
         or (
           t.typtype = 'b'
           and not exists (
             select 1 from pg_catalog.pg_type element_type
             where element_type.typarray = t.oid
           )
         )
         or t.typtype in ('d', 'e', 'r', 'm')
         or (
           t.typtype = 'c'
           and not exists (
             select 1 from pg_catalog.pg_class row_relation
             where row_relation.reltype = t.oid
               and row_relation.relkind in ('r', 'p', 'v', 'm', 'f')
           )
         )
       ))
  + (select pg_catalog.count(*) from pg_catalog.pg_extension where extname <> 'plpgsql')
  + (select pg_catalog.count(*) from pg_catalog.pg_operator o
     join pg_catalog.pg_namespace n on n.oid = o.oprnamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and n.nspname !~ '^pg_(temp|toast_temp)_')
  + (select pg_catalog.count(*) from pg_catalog.pg_collation c
     join pg_catalog.pg_namespace n on n.oid = c.collnamespace
     where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       and n.nspname !~ '^pg_(temp|toast_temp)_')
  + (select pg_catalog.count(*) from pg_catalog.pg_policy)
  + (select pg_catalog.count(*) from pg_catalog.pg_publication)
  + (select pg_catalog.count(*) from pg_catalog.pg_subscription);")"
[[ "$user_object_count" == '0' ]] || die "new restore target is unexpectedly non-empty: $user_object_count objects"

run_pg_restore --exit-on-error --single-transaction "$dump_file"
if ! run_psql -X --set=ON_ERROR_STOP=1 --file="$postcheck_file"; then
  die 'restore completed but POSTCHECK failed; manual diagnosis is required'
fi

printf 'Restore and POSTCHECK succeeded for new database: %s\n' "$DATABASE_NAME"
