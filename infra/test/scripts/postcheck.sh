#!/usr/bin/env bash
set -Eeuo pipefail

source "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/_common.sh"

initialize_test_db_operation 'migration 015 POSTCHECK (read-only)'
require_command psql
POSTCHECK_FILE="$MIGRATIONS_DIR/015_backend_auth_foundation_POSTCHECK.sql"
require_file "$POSTCHECK_FILE"

run_psql -X --set=ON_ERROR_STOP=1 --file="$POSTCHECK_FILE"
