# Auth integration runner

`auth-integration-runner` is a one-shot, test-only Node.js container for
the PostgreSQL authentication integration suite. It is available only
through the `auth-integration` Compose profile and must be started with
`docker compose run --rm`. An ordinary `docker compose up -d` does not
select the profile and therefore does not create this runner.

The image uses the project's pinned Node.js version, installs the exact
backend production and development dependency graph with `npm ci`, and
copies only the backend package manifests, TypeScript configuration,
source, and tests from the `backend` build context. It runs as the
unprivileged `node` user with a read-only root filesystem and a temporary
`/tmp`. It has no ports, host mounts, Docker socket, or access to the edge
network.

## Mandatory database preparation

Never run the suite against production, the ordinary test database, or
any database containing data that must be retained. Before the first
suite execution, manually:

1. back up the ordinary test database;
2. create `prosto_padel_test_auth_integration_test`;
3. provision `backend_auth_owner` and `backend_auth_app`;
4. run migration 015 PRECHECK;
5. apply migration 015 with the guarded apply wrapper;
6. run the standalone POSTCHECK.

The runner does not create or delete databases, provision roles, apply
SQL, repair schema state, or make backups. The integration harness keeps
its own pre-connection and database catalog guards.

## Image and test discovery check

This command builds the same runner image and lists its two integration
specs without starting PostgreSQL, creating a Pool, or requiring any
database environment:

```bash
docker compose \
  -f infra/test/compose.yaml \
  --env-file infra/test/.env.test \
  --profile auth-integration \
  run --rm --no-deps --build \
  auth-integration-runner --listTests
```

This is only an image and Jest discovery check. It is not database
readiness verification.

## Manual suite execution

The recommended path passes a test-only password transiently. The
runner uses Node.js `encodeURIComponent` plus a standard `URL`
round-trip to construct exactly the canonical URL required by the
integration guard for:

```text
backend_auth_app@postgres:5432/prosto_padel_test_auth_integration_test
```

It never prints the URL and removes the password-only variable before
starting Jest. The Jest child receives only the four integration
variables required by the existing harness. Its URL guard validates the
resulting URL before creating a Pool.

From the repository root on the test server:

```bash
read -rsp 'Integration database password: ' AUTH_INTEGRATION_DATABASE_PASSWORD
echo
export AUTH_INTEGRATION_DATABASE_PASSWORD
trap 'unset AUTH_INTEGRATION_DATABASE_PASSWORD' EXIT HUP INT TERM

docker compose \
  -f infra/test/compose.yaml \
  --env-file infra/test/.env.test \
  --profile auth-integration \
  run --rm --build \
  -e AUTH_INTEGRATION_TESTS_ENABLED=true \
  -e AUTH_INTEGRATION_DISPOSABLE_DATABASE=true \
  -e AUTH_INTEGRATION_EXPECTED_DATABASE_NAME=prosto_padel_test_auth_integration_test \
  -e AUTH_INTEGRATION_DATABASE_PASSWORD \
  auth-integration-runner

RUNNER_STATUS=$?
unset AUTH_INTEGRATION_DATABASE_PASSWORD
trap - EXIT HUP INT TERM
test "$RUNNER_STATUS" -eq 0
```

Do not enable shell tracing and do not print or persist the generated
connection URL. An already canonical
`AUTH_INTEGRATION_DATABASE_URL` may instead be passed explicitly, but it
must not be stored in Compose, `.env.test`, Git, an image layer, or a
shell history entry. Never pass both the URL and password variables.

PostgreSQL remains reachable only as `postgres` inside `test_internal`;
port 5432 is not published. The runner has no public or application
port. Its `depends_on` only waits for the existing PostgreSQL service to
be healthy; database creation and migration remain manual actions.

Test data remains in the disposable database for diagnosis. Delete the
whole database manually only after inspecting the results. Never use
`docker compose down -v`: it would remove the shared PostgreSQL volume.

The `blocked`, `pending_deletion`, and `anonymized` account-status
scenarios remain intentionally out of scope until a safe fixture
boundary exists.
