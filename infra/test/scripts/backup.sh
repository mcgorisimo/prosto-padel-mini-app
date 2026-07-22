#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=_common.sh
source "$SCRIPT_DIR/_common.sh"

initialize_test_db_operation "backup"
require_command pg_dump
require_command pg_dumpall
require_command pg_restore
require_command sha256sum
require_command mktemp

[[ -r /proc/sys/kernel/random/uuid ]] || die "Cannot obtain a UUID for the backup directory."
backup_uuid="$(tr '[:upper:]' '[:lower:]' < /proc/sys/kernel/random/uuid)"
[[ "$backup_uuid" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || \
  die "The generated backup UUID is invalid."

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
final_name="${timestamp}_${backup_uuid}"
final_dir="$BACKUPS_DIR/$final_name"
[[ ! -e "$final_dir" ]] || die "Refusing to overwrite existing backup directory: $final_dir"

temp_dir="$(mktemp -d "$BACKUPS_DIR/.backup-${backup_uuid}.XXXXXX")"
cleanup() {
  if [[ -n "${temp_dir:-}" && -d "$temp_dir" ]]; then
    rm -rf -- "$temp_dir"
  fi
}
trap cleanup EXIT

dump_file="$temp_dir/database.dump"
globals_file="$temp_dir/globals.sql"
manifest_file="$temp_dir/manifest.txt"

run_pg_dump --format=custom --file="$dump_file"
run_pg_dumpall --globals-only --no-role-passwords --file="$globals_file"

[[ -s "$dump_file" ]] || die "Database dump is empty."
pg_restore --list "$dump_file" >/dev/null

[[ -s "$globals_file" ]] || die "Globals SQL is empty."
grep -Iq . "$globals_file" || die "Globals SQL is not readable text."
if grep -Eiq '(^|[^[:alnum:]_])password([^[:alnum:]_]|$)' "$globals_file"; then
  die "Globals SQL unexpectedly contains a role password clause."
fi
grep -Eq '^CREATE ROLE backend_auth_owner;[[:space:]]*$' "$globals_file" || die "Globals SQL lacks the backend_auth_owner role definition."
grep -Eq '^CREATE ROLE backend_auth_app;[[:space:]]*$' "$globals_file" || die "Globals SQL lacks the backend_auth_app role definition."

dump_sha256="$(sha256sum "$dump_file" | awk '{print $1}')"
globals_sha256="$(sha256sum "$globals_file" | awk '{print $1}')"
client_version="$(pg_dump --version | tr -d '\r\n')"

cat >"$manifest_file" <<EOF
format_version=1
database=$DATABASE_NAME
host=$DATABASE_HOST
port=$DATABASE_PORT
user=$DATABASE_USER
utc_timestamp=$timestamp
postgresql_client_version=$client_version
dump_sha256=$dump_sha256
globals_sha256=$globals_sha256
EOF

[[ -s "$manifest_file" ]] || die "Backup manifest is empty."
grep -q '^dump_sha256=[0-9a-f]\{64\}$' "$manifest_file" || die "Dump SHA-256 is invalid."
grep -q '^globals_sha256=[0-9a-f]\{64\}$' "$manifest_file" || die "Globals SHA-256 is invalid."

mv -T --no-clobber -- "$temp_dir" "$final_dir"
if [[ -d "$temp_dir" || ! -d "$final_dir" ]]; then
  die "Atomic no-clobber publication of the backup directory failed."
fi
temp_dir=""
trap - EXIT

printf 'Backup published: %s\n' "$final_dir"
