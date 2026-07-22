# Local Docker test contour

This is an isolated, synthetic-only contour for PostgreSQL, the NestJS backend,
nginx, and an opt-in one-shot `db-tools` container. PostgreSQL and backend have
no host port mapping. Only nginx is reachable, at `127.0.0.1:8080`.

The project-approved versions are Node.js `>=20.11.0` and PostgreSQL `>=14`.
This contour pins Node.js `20.11.0` and PostgreSQL `14`.

## Prepare and start

Run from the repository root:

```bash
cp infra/test/.env.test.example infra/test/.env.test
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test config
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test up --build -d postgres backend nginx
curl --fail http://127.0.0.1:8080/api/v1/health
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test ps
```

Expected: Compose configuration is valid, all three services become healthy,
and health returns a successful response. Stop if port `5432` or `3000` is
published, if nginx is bound beyond `127.0.0.1:8080`, or if any value is not
synthetic.

`db-tools` is not started by normal `up`. It is attached only to the internal
network and receives these mounts:

- `/workspace/migrations` from `docs/migrations`, read-only;
- `/workspace/test/sql` from `infra/test/sql`, read-only;
- `/workspace/test/scripts` from `infra/test/scripts`, read-only;
- `/workspace/test/backups` from `infra/test/backups`, read-write.

Migration 015 is not in `docker-entrypoint-initdb.d`, an entrypoint, Compose
startup, or an npm script. Every database operation below is a separate manual
`db-tools` run through a guarded wrapper. No local PostgreSQL client is needed.

## Guard model

Every wrapper requires `ALLOW_LOCAL_TEST_DB_OPERATIONS=YES`, exact host
`postgres`, exact port `5432`, a database matching
`^prosto_padel_test_[a-z0-9_]+$`, and a non-empty user. It rejects ambiguous
hosts, sockets, loopback, production-like names, and ambient libpq target
variables. Each client call receives host, port, database, and user explicitly;
passwords are never printed.

The commands below set the target database, opt-in, and confirmations explicitly
on the `db-tools` container. Only the prompted synthetic role password is passed
from the host. Other connection values and the synthetic connection password
come from `infra/test/.env.test`.

## Migration-cycle workflow

The default database is `prosto_padel_test_migration_cycle`.

`POSTGRES_DB` creates that default database only when PostgreSQL initializes a
new named volume. If the volume already exists and the migration-cycle database
is missing, create it with this separate guarded action:

```bash
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test run --rm \
  -e DATABASE_NAME=prosto_padel_test_migration_cycle \
  -e ALLOW_LOCAL_TEST_DB_OPERATIONS=YES \
  db-tools bash /workspace/test/scripts/create-test-database.sh
```

### 1. Provision the two test roles

```bash
read -rsp 'Synthetic backend_auth_app password: ' BACKEND_AUTH_APP_PASSWORD && echo
export BACKEND_AUTH_APP_PASSWORD
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test run --rm \
  -e DATABASE_NAME=prosto_padel_test_migration_cycle \
  -e ALLOW_LOCAL_TEST_DB_OPERATIONS=YES \
  -e BACKEND_AUTH_APP_PASSWORD \
  db-tools bash /workspace/test/scripts/provision-test-roles.sh
unset BACKEND_AUTH_APP_PASSWORD
```

Expected: only `backend_auth_owner`, `backend_auth_app`, and database ACL are
created or validated; schema `backend_auth` is not created. Stop on any unsafe
existing role, unexpected target header, or non-zero exit.

### 2. Run the standalone read-only PRECHECK

```bash
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test run --rm \
  -e DATABASE_NAME=prosto_padel_test_migration_cycle \
  -e ALLOW_LOCAL_TEST_DB_OPERATIONS=YES \
  db-tools bash /workspace/test/scripts/precheck.sh
```

Expected: PRECHECK succeeds and confirms a free 015 namespace. Stop on any
`PRECHECK_FAILED` result. Independently review the source migration before the
next step.

### 3. Apply 015 once and require POSTCHECK

```bash
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test run --rm \
  -e DATABASE_NAME=prosto_padel_test_migration_cycle \
  -e ALLOW_LOCAL_TEST_DB_OPERATIONS=YES \
  -e CONFIRM_APPLY_015=APPLY_015_TO_CONFIRMED_EMPTY_TEST_DB \
  db-tools bash /workspace/test/scripts/apply-015.sh
```

The wrapper runs PRECHECK in this invocation, consumes a temporary marker,
applies the source migration, and automatically runs POSTCHECK. Expected: both
apply and POSTCHECK succeed. Stop on any failure; there is no automatic
rollback, and a POSTCHECK failure requires manual diagnosis.

### 4. Publish an atomic backup set

```bash
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test run --rm \
  -e DATABASE_NAME=prosto_padel_test_migration_cycle \
  -e ALLOW_LOCAL_TEST_DB_OPERATIONS=YES \
  db-tools bash /workspace/test/scripts/backup.sh
```

Expected: the wrapper's final line prints one exact directory such as
`/workspace/test/backups/20260722T120000Z_<uuid>`. Its host-side counterpart is
under `infra/test/backups` and contains `database.dump`, `globals.sql`, and
`manifest.txt`. These must be the directory's only three entries. Stop if
validation, checksums, strict entry validation, or atomic publication fails.
Record only its final directory name for restore:

```bash
BACKUP_SET='20260722T120000Z_replace-with-printed-uuid'
```

### 5. Roll back the still-empty foundation

```bash
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test run --rm \
  -e DATABASE_NAME=prosto_padel_test_migration_cycle \
  -e ALLOW_LOCAL_TEST_DB_OPERATIONS=YES \
  -e CONFIRM_ROLLBACK_015=DROP_EMPTY_BACKEND_AUTH_SCHEMA \
  db-tools bash /workspace/test/scripts/rollback-015.sh
```

Expected: the unchanged rollback SQL accepts its own transaction-bound guard,
drops only the verified empty foundation, and retains roles. Stop if it reports
rows, drift, a wrong confirmation, or any error.

### 6. Prove a clean second apply

Repeat the standalone PRECHECK command from step 2, then repeat the guarded
apply command from step 3. Expected: PRECHECK, apply, and automatic POSTCHECK
all succeed again. Stop at the first unexpected result.

### 7. Restore into a new database

The required roles must already exist and pass their attribute checks. The
restore wrapper validates the set and archive before its first connection,
checks the roles, refuses an existing target, creates the target itself, proves
it empty, restores in one transaction, and runs POSTCHECK. `globals.sql` is
checked for the two required roles and absence of password clauses, but is never
executed automatically. The backup-set directory must contain exactly
`database.dump`, `globals.sql`, and `manifest.txt`; any extra file or directory
is refused.

```bash
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test run --rm \
  -e DATABASE_NAME=prosto_padel_test_migration_restore_001 \
  -e ALLOW_LOCAL_TEST_DB_OPERATIONS=YES \
  db-tools bash /workspace/test/scripts/restore.sh "$BACKUP_SET"
```

Expected: a new database different from the manifest source is created,
restored, and passes POSTCHECK. Stop if the set is outside the backups root, is
a symlink, has a checksum mismatch, contains unsafe globals, names an existing
target, or fails any catalog check. If failure occurs after creation, the
wrapper prints the exact preserved test database name for diagnosis and never
deletes it automatically. Deletion is a separate approved action after
inspection; no ready-to-run cleanup command is printed.

## Behavior database preparation

Creation is a separate manual action:

```bash
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test run --rm \
  -e DATABASE_NAME=prosto_padel_test_behavior \
  -e ALLOW_LOCAL_TEST_DB_OPERATIONS=YES \
  db-tools bash /workspace/test/scripts/create-test-database.sh
```

Expected: a new database is created; an existing name is refused. Then repeat
provisioning, PRECHECK, and guarded apply against that explicit database:

```bash
read -rsp 'Synthetic backend_auth_app password: ' BACKEND_AUTH_APP_PASSWORD && echo
export BACKEND_AUTH_APP_PASSWORD
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test run --rm \
  -e DATABASE_NAME=prosto_padel_test_behavior \
  -e ALLOW_LOCAL_TEST_DB_OPERATIONS=YES \
  -e BACKEND_AUTH_APP_PASSWORD \
  db-tools bash /workspace/test/scripts/provision-test-roles.sh
unset BACKEND_AUTH_APP_PASSWORD

docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test run --rm \
  -e DATABASE_NAME=prosto_padel_test_behavior \
  -e ALLOW_LOCAL_TEST_DB_OPERATIONS=YES \
  db-tools bash /workspace/test/scripts/precheck.sh

docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test run --rm \
  -e DATABASE_NAME=prosto_padel_test_behavior \
  -e ALLOW_LOCAL_TEST_DB_OPERATIONS=YES \
  -e CONFIRM_APPLY_015=APPLY_015_TO_CONFIRMED_EMPTY_TEST_DB \
  db-tools bash /workspace/test/scripts/apply-015.sh
```

Expected: provisioning and PRECHECK succeed, then apply and automatic POSTCHECK
succeed. Stop after that: stage 07.5.2 does not add or run integration tests.

After separately approved future synthetic tests make this schema non-empty,
verify fail-closed rollback only against the explicit behavior database. Before
running the command, confirm all three conditions:

- the only target is `prosto_padel_test_behavior`;
- the expected result is `ROLLBACK_015_REFUSED_NONEMPTY`, with the non-empty
  schema preserved;
- if the command succeeds and drops the schema, the behavior check failed and
  work must stop immediately.

```bash
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test run --rm \
  -e DATABASE_NAME=prosto_padel_test_behavior \
  -e ALLOW_LOCAL_TEST_DB_OPERATIONS=YES \
  -e CONFIRM_ROLLBACK_015=DROP_EMPTY_BACKEND_AUTH_SCHEMA \
  db-tools bash /workspace/test/scripts/rollback-015.sh
```

Do not insert data merely to perform that check at this stage.

## Stop and backup warnings

```bash
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test down
```

This stops and removes containers and the network but preserves the named
PostgreSQL volume.

`docker compose down -v` irreversibly deletes the local PostgreSQL volume. It is
forbidden without a deliberate decision and is intentionally not provided as
an executable command here.

Keep these mechanisms distinct:

- a VM/disk snapshot captures infrastructure state but does not replace a
  logical database dump;
- a Docker volume backup protects local volume data but is tied to its storage
  and consistency procedure;
- `database.dump` is the portable logical database archive but does not include
  cluster-global roles;
- `globals.sql` records cluster globals without role passwords for review and
  portability, but restore never executes it automatically.

A test backup stored on the same VM is not an external disaster-recovery copy.

## PowerShell status

PowerShell wrappers mirror the guards and remain a supplemental interface for
static verification. The supported operational path, including future Selectel
VM use with the same Compose service name `postgres`, is Bash inside
`db-tools`. It does not depend on `Read-Host -MaskInput` or a locally installed
PostgreSQL client.
