# TD-029 — Real-PostgreSQL integration lane for match owner/concurrency

- Status: `planned`
- Priority: P0
- Effort: M (2–4 days)
- Risk: medium
- Dependencies: TD-032
- Primary files: new backend integration specs/fixtures; existing match repos
- Schema: no new migration; execute already approved migrations in disposable DB

## Evidence and problem

Backend E2E currently runs only health/module boundaries with database disabled.
Match repository unit tests return prepared rows and inspect SQL strings rather
than executing PostgreSQL. A prior live syntax error escaped such tests. Core
owner scope, row locks and last-slot concurrency need real database proof.

## Required real-DB scenarios

- public feed excludes private/past matches;
- account feed includes only owner/active participant scope;
- foreign account cannot read/mutate private aggregate;
- two concurrent joins for the last slot yield one success/one conflict;
- same request key+digest is idempotent; different digest is rejected;
- direct join racing FIFO promotion never creates a fifth slot;
- transaction rollback leaves no partial participant/command/outbox state.

## Test boundary

Reuse `backend/test/auth-integration/auth-integration.env.ts` and
`backend/src/database/auth-integration.guard.ts` (extend generically without
weakening their current auth lane), a local PostgreSQL database, restricted
application role, deterministic seed/assert/cleanup and fake all external
providers. Reuse reviewed migrations; do not change cloud/Compose/production
infrastructure in this task.

The runner must fail closed before connecting unless every safety condition is
true: loopback host, explicit allowlisted test database name, non-runtime test
credentials and an enabled disposable-test marker. Runtime, test-server and
production connection strings are always rejected. Every run uses a unique
deterministic namespace and cleans it on success and failure; a cleanup failure
is a failed test, never silently ignored.

## Acceptance criteria

- One documented command runs the lane repeatedly from clean state.
- Tests execute real SQL/constraints/locks and leave database empty.
- Failures produce no PII/secrets and are parallel-safe or explicitly serial.
- Guard tests prove non-loopback, unknown database names and runtime/prod-shaped
  connection values are rejected before any network request.

## Independent review gate

Reviewer checks tests would fail if lock/scope/idempotency SQL were removed.
Score ≥9. Test-only deployment is `not_needed` unless runtime changes emerge.
