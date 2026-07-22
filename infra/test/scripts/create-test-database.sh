#!/usr/bin/env bash
set -Eeuo pipefail

source "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/_common.sh"

initialize_test_db_operation 'create a new empty test database'
require_command psql
require_command createdb

database_exists="$(run_psql_database postgres -X -A -t -q --set=ON_ERROR_STOP=1 \
  --command="select case when exists (
    select 1 from pg_catalog.pg_database where datname = '$DATABASE_NAME'
  ) then 'YES' else 'NO' end;")"
[[ "$database_exists" == 'NO' ]] || die "database already exists: $DATABASE_NAME"

run_createdb "$DATABASE_NAME"
printf 'Created new test database: %s\n' "$DATABASE_NAME"
