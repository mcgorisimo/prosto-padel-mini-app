# Telegram auth PostgreSQL integration tests

These tests are destructive only in the sense that they intentionally leave
their uniquely identified fixture rows behind. They must never be run against
production, a shared development database, or any database containing data
that must be retained.

## Manual preparation

1. Create a separate disposable PostgreSQL database whose exact name ends in
   `_auth_integration_test`.
2. Apply `docs/migrations/015_backend_auth_foundation.sql` manually, including
   its roles, grants, comments, and migration fingerprints.
3. Connect as the non-superuser `backend_auth_app` role.
4. Set all four environment variables:

   - `AUTH_INTEGRATION_TESTS_ENABLED=true`
   - `AUTH_INTEGRATION_DISPOSABLE_DATABASE=true`
   - `AUTH_INTEGRATION_DATABASE_URL=<URL of the disposable database>`
   - `AUTH_INTEGRATION_EXPECTED_DATABASE_NAME=<exact database name>`

5. Run:

   ```powershell
   npm.cmd --prefix backend run test:integration:auth
   ```

The harness never creates a database or schema, applies migration 015, grants
roles, repairs schema state, or rolls a migration back. Before the first data
change it verifies the exact database name, disposable suffix, application
role, non-superuser status, supported PostgreSQL version, migration schema,
the exact table/function/trigger/constraint/index inventories, recomputed
relation and function fingerprints, owners, and the runtime ACL boundary.
Stale migration comments do not pass without matching recomputed
fingerprints. A mismatch stops the suite with a fixed safe error.

The validated canonical connection URL is the only URL passed to the
integration Pool. The test-only Pool applies finite connection, query,
statement, lock, idle-transaction, and idle-connection timeouts to every
connection. Concurrency barriers also have a finite safety timeout below the
Jest suite timeout.

Each run uses a fresh UUID and unique synthetic Telegram subjects, request
keys, operation/account/identity/session IDs, and audit IDs. The committed
fixtures remain in the disposable database so that failed concurrency runs can
be inspected. Delete the entire disposable database manually after inspection;
no database deletion or cleanup command is part of the automated test script.

The status cases for `blocked`, `pending_deletion`, and `anonymized` are not in
this suite yet. Production currently has no safe account-status setup port, and
the integration harness deliberately does not bypass that boundary with an
arbitrary SQL `UPDATE`. Add those cases only after an approved fixture or
production status-transition boundary exists.

The PostgreSQL integration command was not run while this harness change was
prepared; its first execution remains a manual action against the disposable
database described above.

The test bot token, pepper, and workflow secret in the fixture are explicit
test-only constants. They are not imported by production wiring and must never
be replaced with real credentials.
