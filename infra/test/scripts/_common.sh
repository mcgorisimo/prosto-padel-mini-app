#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
TEST_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)"
WORKSPACE_ROOT="$(CDPATH= cd -- "$TEST_ROOT/.." && pwd -P)"
HOST_MIGRATIONS_DIR="$(CDPATH= cd -- "$TEST_ROOT/../.." && pwd -P)/docs/migrations"

if [[ -d "$HOST_MIGRATIONS_DIR" ]]; then
  MIGRATIONS_DIR="$HOST_MIGRATIONS_DIR"
else
  MIGRATIONS_DIR="$WORKSPACE_ROOT/migrations"
fi
BACKUPS_DIR="$TEST_ROOT/backups"

readonly SCRIPT_DIR TEST_ROOT WORKSPACE_ROOT MIGRATIONS_DIR BACKUPS_DIR

die() {
  printf 'REFUSED: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

require_file() {
  [[ -f "$1" ]] || die "required file is missing: $1"
}

trim_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

reject_ambient_libpq_target() {
  local variable_name
  local forbidden_variables=(
    PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE
    PGPASSFILE PGOPTIONS
  )

  for variable_name in "${forbidden_variables[@]}"; do
    if [[ ${!variable_name+x} ]]; then
      die "$variable_name must be unset; wrappers pass every target parameter explicitly"
    fi
  done

  unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE \
    PGPASSFILE PGOPTIONS
}

initialize_test_db_operation() {
  local action="$1"
  local expected_host
  local database_host
  local database_port
  local database_name
  local database_user

  [[ "${ALLOW_LOCAL_TEST_DB_OPERATIONS:-}" == "YES" ]] ||
    die 'set ALLOW_LOCAL_TEST_DB_OPERATIONS=YES for this manual test operation'

  reject_ambient_libpq_target

  [[ -n "${EXPECTED_TEST_DATABASE_HOST:-}" ]] ||
    die 'EXPECTED_TEST_DATABASE_HOST is required'
  [[ -n "${DATABASE_HOST:-}" ]] || die 'DATABASE_HOST is required'
  [[ -n "${DATABASE_PORT:-}" ]] || die 'DATABASE_PORT is required'
  [[ -n "${DATABASE_NAME:-}" ]] || die 'DATABASE_NAME is required'
  [[ -n "${DATABASE_USER:-}" ]] || die 'DATABASE_USER is required'

  expected_host="$(trim_value "$EXPECTED_TEST_DATABASE_HOST")"
  database_host="$(trim_value "$DATABASE_HOST")"
  database_port="$(trim_value "$DATABASE_PORT")"
  database_name="$(trim_value "$DATABASE_NAME")"
  database_user="$(trim_value "$DATABASE_USER")"

  [[ "$EXPECTED_TEST_DATABASE_HOST" == "$expected_host" ]] ||
    die 'EXPECTED_TEST_DATABASE_HOST must not contain surrounding whitespace'
  [[ "$DATABASE_HOST" == "$database_host" ]] ||
    die 'DATABASE_HOST must not contain surrounding whitespace'
  [[ "$DATABASE_PORT" == "$database_port" ]] ||
    die 'DATABASE_PORT must not contain surrounding whitespace'
  [[ "$DATABASE_NAME" == "$database_name" ]] ||
    die 'DATABASE_NAME must not contain surrounding whitespace'
  [[ "$DATABASE_USER" == "$database_user" ]] ||
    die 'DATABASE_USER must not contain surrounding whitespace'

  [[ "$expected_host" == 'postgres' ]] ||
    die 'EXPECTED_TEST_DATABASE_HOST must be exactly postgres'
  [[ "$database_host" == "$expected_host" ]] ||
    die 'DATABASE_HOST must exactly match EXPECTED_TEST_DATABASE_HOST'
  [[ "$database_host" != *','* && "$database_host" != *' '* ]] ||
    die 'DATABASE_HOST must be a single host without commas or spaces'
  [[ "$database_host" != *'://'* && "$database_host" != /* ]] ||
    die 'URI and Unix-socket DATABASE_HOST values are forbidden'
  case "${database_host,,}" in
    localhost|localhost.|127.*|::1|'[::1]'|0.0.0.0)
      die 'localhost, loopback, and wildcard database hosts are forbidden'
      ;;
  esac

  [[ "$database_port" == '5432' ]] || die 'DATABASE_PORT must be exactly 5432'
  [[ "$database_name" =~ ^prosto_padel_test_[a-z0-9_]+$ ]] ||
    die 'DATABASE_NAME must match ^prosto_padel_test_[a-z0-9_]+$'
  [[ -n "$database_user" ]] || die 'DATABASE_USER must not be whitespace-only'
  [[ "$database_user" != *$'\n'* && "$database_user" != *$'\r'* && "$database_user" != *$'\t'* ]] ||
    die 'DATABASE_USER must not contain control whitespace'

  case "${database_host,,} ${database_name,,}" in
    *production*|*prod*|*main*|*live*)
      die 'DATABASE_HOST and DATABASE_NAME must not contain production-like markers'
      ;;
  esac

  DATABASE_HOST="$database_host"
  DATABASE_PORT="$database_port"
  DATABASE_NAME="$database_name"
  DATABASE_USER="$database_user"
  readonly DATABASE_HOST DATABASE_PORT DATABASE_NAME DATABASE_USER

  printf 'Action: %s\n' "$action"
  printf 'Host: %s\n' "$DATABASE_HOST"
  printf 'Port: %s\n' "$DATABASE_PORT"
  printf 'Database: %s\n' "$DATABASE_NAME"
  printf 'User: %s\n' "$DATABASE_USER"
}

run_psql() {
  command psql \
    --host="$DATABASE_HOST" \
    --port="$DATABASE_PORT" \
    --dbname="$DATABASE_NAME" \
    --username="$DATABASE_USER" \
    "$@"
}

run_psql_database() {
  local target_database="$1"
  shift
  command psql \
    --host="$DATABASE_HOST" \
    --port="$DATABASE_PORT" \
    --dbname="$target_database" \
    --username="$DATABASE_USER" \
    "$@"
}

run_createdb() {
  local target_database="$1"
  command createdb \
    --host="$DATABASE_HOST" \
    --port="$DATABASE_PORT" \
    --username="$DATABASE_USER" \
    --maintenance-db=postgres \
    "$target_database"
}

run_pg_dump() {
  command pg_dump \
    --host="$DATABASE_HOST" \
    --port="$DATABASE_PORT" \
    --dbname="$DATABASE_NAME" \
    --username="$DATABASE_USER" \
    "$@"
}

run_pg_dumpall() {
  command pg_dumpall \
    --host="$DATABASE_HOST" \
    --port="$DATABASE_PORT" \
    --database="$DATABASE_NAME" \
    --username="$DATABASE_USER" \
    "$@"
}

run_pg_restore() {
  command pg_restore \
    --host="$DATABASE_HOST" \
    --port="$DATABASE_PORT" \
    --dbname="$DATABASE_NAME" \
    --username="$DATABASE_USER" \
    "$@"
}
