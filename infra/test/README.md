# Local Docker test contour

This is an isolated, synthetic-only contour for PostgreSQL, the NestJS backend,
nginx, and an opt-in one-shot `db-tools` container. PostgreSQL and backend have
no host port mapping. Only nginx is reachable, at `127.0.0.1:8080`.
Nginx joins the ordinary `test_edge` bridge for loopback publication and the
internal `test_internal` network for backend access. PostgreSQL and `db-tools`
remain attached only to `test_internal`. Backend also joins the dedicated
`test_egress` bridge so outbound integrations can use HTTPS without exposing a
host port or attaching PostgreSQL to an internet-capable network.

The project-approved versions are Node.js `>=20.11.0` and PostgreSQL `>=14`.
This contour pins Node.js `20.11.0` and PostgreSQL `14`.

## Prepare and start

Run from the repository root:

```bash
cp infra/test/.env.test.example infra/test/.env.test
docker compose -f infra/test/compose.yaml --env-file infra/test/.env.test config --services
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

## Frontend Telegram backend login build flag

`VITE_TELEGRAM_BACKEND_LOGIN_ENABLED` is a public build-time Vite setting, not
a runtime setting or a secret. Its Dockerfile and Compose default is `false`.
With that value the frontend does not call the Telegram backend login endpoint,
even if the backend endpoint remains enabled. Supabase remains the current
session and data plane in both flag states.

Changing the value requires rebuilding and recreating only `frontend`; changing
an environment variable on an already-built container has no effect. For a
separately approved Selectel rollout, set
`VITE_TELEGRAM_BACKEND_LOGIN_ENABLED=true` in the server's non-secret
environment file, then rebuild and recreate only `frontend` with the base
Compose file followed by `compose.runtime-backend.yaml`. Roll back by restoring
the value to `false` and rebuilding and recreating only `frontend` in the same
way. Do not perform either deployment while preparing or reviewing this
repository change.

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

## Persistent runtime backend override

This is a deployment runbook for a separately approved Selectel operation. Do
not execute its commands while merely preparing or reviewing repository
changes.

The base `compose.yaml` remains the disposable/local contour and the only file
used by `db-tools` and `auth-integration-runner`. The persistent runtime backend
is selected explicitly with both files:

```text
-f infra/test/compose.yaml
-f infra/test/compose.runtime-backend.yaml
```

The override changes only `backend`. PostgreSQL and `db-tools` continue to use
`prosto_padel_test`; the backend connects to
`prosto_padel_test_migration_cycle` as `backend_auth_app`. The override uses the
Compose `!reset null` merge tag to remove the base `DATABASE_URL` and all direct
Telegram secret variables. Stop if the installed Compose version cannot parse
that tag. This safe command validates interpolation and merge syntax while
printing nothing:

```bash
docker compose \
  -f infra/test/compose.yaml \
  -f infra/test/compose.runtime-backend.yaml \
  --env-file infra/test/.env.test \
  config --quiet
```

After that succeeds, this safe form may be used to print service names only:

```bash
docker compose \
  -f infra/test/compose.yaml \
  -f infra/test/compose.runtime-backend.yaml \
  --env-file infra/test/.env.test \
  config --services
```

Never run or share unfiltered `docker compose config` output on the server. It
can expand and print existing database environment credentials. Do not enable
shell tracing around any runtime-secret operation.

The four required files are:

- the `backend_auth_app` password;
- the Telegram bot token;
- the Telegram identity lookup pepper in canonical base64;
- the Telegram login workflow HMAC secret in canonical base64.

Create them manually through the approved server secret process, outside the
Git repository. Each file must be a regular, non-symlink file owned by
`prostopadel` with mode `600`. Put only its corresponding secret in the file;
the backend removes a final CR/LF itself. Configure only their non-secret host
paths in `infra/test/.env.test`, using the four `*_FILE_HOST` variables from the
example. Never put the file contents in that env file, Compose, an image build
argument, or Git.

Set these non-secret server values explicitly in `infra/test/.env.test`:

- `TELEGRAM_AUTH_ENABLED=false` until the approved activation;
- `TELEGRAM_INIT_DATA_MAX_AGE_SECONDS=<approved value>`;
- `TELEGRAM_LOGIN_UUID_NAMESPACE=<stable approved UUID>`.

No default max age or UUID is supplied by the override. Missing values stop
Compose interpolation. The authentication feature itself remains disabled by
default.

### Mandatory UID/GID stop point

The backend image runs as its existing unprivileged `node` user. A bind mount
retains host numeric ownership, so mode `600` works only when the host
`prostopadel` UID/GID matches the actual runtime `node` UID/GID. Do not assume
that it does.

After building only the backend image, compare the IDs without the runtime
override or secret mounts:

```bash
docker compose \
  -f infra/test/compose.yaml \
  --env-file infra/test/.env.test \
  build backend

HOST_RUNTIME_IDS="$(id -u prostopadel):$(id -g prostopadel)"
CONTAINER_RUNTIME_IDS="$(
  docker compose \
    -f infra/test/compose.yaml \
    --env-file infra/test/.env.test \
    run --rm --no-deps --entrypoint sh backend \
    -c 'printf "%s:%s" "$(id -u)" "$(id -g)"'
)"
test "$HOST_RUNTIME_IDS" = "$CONTAINER_RUNTIME_IDS" || {
  echo 'STOP: backend runtime UID/GID does not match the secret-file owner' >&2
  exit 1
}
```

If the IDs differ, stop and design an approved non-root user mapping or secret
delivery boundary separately. Do not use `chmod 644`, make files
world-readable, change the persistent backend to root, or copy files into the
repository.

After creating the files and exporting the same non-secret host-path variables
used by Compose, verify ownership/mode without reading contents:

```bash
HOST_UID="$(id -u prostopadel)"
HOST_GID="$(id -g prostopadel)"
for secret_path in \
  "$BACKEND_AUTH_APP_PASSWORD_FILE_HOST" \
  "$TELEGRAM_BOT_TOKEN_FILE_HOST" \
  "$TELEGRAM_IDENTITY_LOOKUP_PEPPER_BASE64_FILE_HOST" \
  "$TELEGRAM_LOGIN_WORKFLOW_HMAC_SECRET_BASE64_FILE_HOST"
do
  test -f "$secret_path" &&
    test ! -L "$secret_path" &&
    test "$(stat -c '%u:%g:%a' "$secret_path")" = "$HOST_UID:$HOST_GID:600" ||
    {
      echo 'STOP: runtime secret file ownership or mode is unsafe' >&2
      exit 1
    }
done
```

Finally, prove that the actual container user can open every read-only mount.
This checks access only and never reads or prints contents:

```bash
docker compose \
  -f infra/test/compose.yaml \
  -f infra/test/compose.runtime-backend.yaml \
  --env-file infra/test/.env.test \
  run --rm --no-deps --entrypoint node backend \
  -e "const fs=require('node:fs'); for (const p of [
    '/run/secrets/backend-auth-app-password',
    '/run/secrets/telegram-bot-token',
    '/run/secrets/telegram-identity-lookup-pepper-base64',
    '/run/secrets/telegram-login-workflow-hmac-secret-base64'
  ]) fs.accessSync(p, fs.constants.R_OK)"
```

Only after every stop point passes may an approved deployment recreate the
backend alone:

```bash
docker compose \
  -f infra/test/compose.yaml \
  -f infra/test/compose.runtime-backend.yaml \
  --env-file infra/test/.env.test \
  up -d --build --no-deps backend

curl --fail http://127.0.0.1:8080/api/v1/health
```

`/api/v1/health` proves only that the backend process is running. It is a
static health response: it does not open a PostgreSQL connection and therefore
does not verify the `backend_auth_app` password, role grants, ACL, or access to
the `backend_auth` schema. A green health response is not approval to set
`TELEGRAM_AUTH_ENABLED=true`.

Stop after the health check. Enabling Telegram authentication requires a
separately designed and approved DB-backed readiness or authentication smoke
check. This runbook intentionally adds no readiness endpoint, SQL command, or
manual table query as a substitute for that future check.

The override does not publish PostgreSQL or backend ports and does not change
frontend, nginx, or their networks. For rollback, retain the mounted files, set
`TELEGRAM_AUTH_ENABLED=false`, and recreate only backend with the same override.
Do not fall back to the base backend database identity.

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
