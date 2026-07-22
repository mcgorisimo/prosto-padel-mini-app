#!/usr/bin/env bash
set -Eeuo pipefail

source "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/_common.sh"

initialize_test_db_operation 'PRECHECK, apply migration 015, then POSTCHECK'
require_command psql
require_command mktemp

[[ "${CONFIRM_APPLY_015:-}" == 'APPLY_015_TO_CONFIRMED_EMPTY_TEST_DB' ]] ||
  die 'set CONFIRM_APPLY_015=APPLY_015_TO_CONFIRMED_EMPTY_TEST_DB for this one apply'
unset CONFIRM_APPLY_015

PRECHECK_FILE="$MIGRATIONS_DIR/015_backend_auth_foundation_PRECHECK.sql"
MIGRATION_FILE="$MIGRATIONS_DIR/015_backend_auth_foundation.sql"
POSTCHECK_FILE="$MIGRATIONS_DIR/015_backend_auth_foundation_POSTCHECK.sql"
require_file "$PRECHECK_FILE"
require_file "$MIGRATION_FILE"
require_file "$POSTCHECK_FILE"

marker_directory="$(mktemp -d "${TMPDIR:-/tmp}/prosto-padel-precheck.XXXXXX")"
marker_file="$marker_directory/precheck.marker"
cleanup_marker() {
  rm -rf -- "$marker_directory"
}
trap cleanup_marker EXIT

run_psql -X --set=ON_ERROR_STOP=1 --file="$PRECHECK_FILE"
printf 'database=%s\nhost=%s\nutc_timestamp=%s\n' \
  "$DATABASE_NAME" "$DATABASE_HOST" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >"$marker_file"
[[ -s "$marker_file" ]] || die 'PRECHECK marker was not created'

# Consume the marker before the first mutating SQL so this apply cannot reuse it.
rm -f -- "$marker_file"

run_psql -X --set=ON_ERROR_STOP=1 --file="$MIGRATION_FILE"

if ! run_psql -X --set=ON_ERROR_STOP=1 --file="$POSTCHECK_FILE"; then
  printf '%s\n' \
    'POSTCHECK failed after migration 015. No automatic rollback was attempted.' \
    'Stop and perform manual diagnosis against the confirmed test database.' >&2
  exit 1
fi

printf 'Migration 015 apply and automatic POSTCHECK succeeded.\n'
