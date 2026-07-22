#!/usr/bin/env bash
set -Eeuo pipefail

source "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/_common.sh"

initialize_test_db_operation 'migration 015 PRECHECK (read-only)'
require_command psql
PRECHECK_FILE="$MIGRATIONS_DIR/015_backend_auth_foundation_PRECHECK.sql"
require_file "$PRECHECK_FILE"

run_psql -X --set=ON_ERROR_STOP=1 --file="$PRECHECK_FILE"
