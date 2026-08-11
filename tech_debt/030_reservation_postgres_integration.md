# TD-030 — Real-PostgreSQL integration lane for reservation invariants

- Status: `planned`
- Priority: P0
- Effort: M (2–4 days)
- Risk: medium-high
- Dependencies: TD-032
- Primary files: new reservation DB integration specs/fixtures
- Schema: no new migration; use applied migrations 033/034 in disposable DB

## Evidence and problem

Reservation unit specs assert SQL fragments and model concurrency with mocks;
they do not prove advisory locks/exclusion constraints/owner request keys in
PostgreSQL. D2 guarantees one active hold/dispatch claim and strict owner scope,
which must remain portable across future database-hosting changes.

## Required scenarios

- concurrent overlapping holds for one court/interval;
- same owner+request key+digest retry returns one operation;
- same key with different digest conflicts;
- different owners cannot read/recover each other's reservation;
- concurrent dispatch claim allows at most one provider attempt owner;
- failed finalization rolls back local state;
- exact read reconciliation preserves/moves/cancels only from canonical fake
  provider proof; no real YCLIENTS call.

## Test boundary

Reuse `backend/test/auth-integration/auth-integration.env.ts` and
`backend/src/database/auth-integration.guard.ts` (extend generically without
weakening their current auth lane) with a loopback PostgreSQL instance,
restricted application role, deterministic cleanup and fake provider. Validate
migrations/constraints as they exist; do not design cloud/database
infrastructure or new schema here.

The runner refuses to connect unless host is loopback, database name is on an
explicit test allowlist, credentials are non-runtime and the disposable-test
marker is enabled. It must reject runtime/test-server/production connection
strings before network I/O. Use a unique deterministic namespace per run and
cleanup on success/failure; cleanup failure fails the lane.

## Acceptance criteria

- Real SQL/constraint/lock failures are observable and deterministic.
- Database and crypto test artifacts are cleaned; no PII fixtures leak.
- Removing the overlap/idempotency guard makes a test fail.
- Guard regressions prove non-loopback, unknown database names and runtime/prod-
  shaped values never open a connection.

## Independent review gate

Reviewer audits race realism, transaction isolation and false-positive mocks.
Score ≥9; normally test-only `deployment: not_needed`.
