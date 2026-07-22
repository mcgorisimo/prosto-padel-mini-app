#!/usr/bin/env bash
set -Eeuo pipefail

source "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/_common.sh"

initialize_test_db_operation 'rollback empty migration 015 foundation'
require_command psql
[[ "${CONFIRM_ROLLBACK_015:-}" == 'DROP_EMPTY_BACKEND_AUTH_SCHEMA' ]] ||
  die 'set CONFIRM_ROLLBACK_015=DROP_EMPTY_BACKEND_AUTH_SCHEMA for this one rollback'
unset CONFIRM_ROLLBACK_015
ROLLBACK_FILE="$MIGRATIONS_DIR/015_backend_auth_foundation_ROLLBACK.sql"
require_file "$ROLLBACK_FILE"

(
  cd "$MIGRATIONS_DIR"
  run_psql -X --set=ON_ERROR_STOP=1 <<'PSQL'
begin;
select pg_catalog.set_config(
  'backend_auth.rollback_015_confirm',
  'DROP_EMPTY_BACKEND_AUTH_015:' || pg_catalog.txid_current()::text,
  true
);
\ir 015_backend_auth_foundation_ROLLBACK.sql
PSQL
)
