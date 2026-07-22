#!/usr/bin/env bash
set -Eeuo pipefail

source "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/_common.sh"

initialize_test_db_operation 'provision migration 015 test roles'
require_command psql
PROVISION_FILE="$TEST_ROOT/sql/000_provision_test_roles.sql"
require_file "$PROVISION_FILE"

[[ -n "${BACKEND_AUTH_APP_PASSWORD:-}" ]] ||
  die 'BACKEND_AUTH_APP_PASSWORD is required and is never printed'
(( ${#BACKEND_AUTH_APP_PASSWORD} >= 16 )) ||
  die 'BACKEND_AUTH_APP_PASSWORD must contain at least 16 characters'

run_psql \
  -X \
  --set=ON_ERROR_STOP=1 \
  --variable="backend_auth_app_password=$BACKEND_AUTH_APP_PASSWORD" \
  --file="$PROVISION_FILE"

unset BACKEND_AUTH_APP_PASSWORD
