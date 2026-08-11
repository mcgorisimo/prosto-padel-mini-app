# TD-023 — Decompose backend `MatchApiService`

- Status: `planned`
- Priority: P1
- Effort: M–L (3–5 days)
- Risk: high
- Dependencies: TD-022, TD-029
- Primary files: `backend/src/matches/match-api.service.ts` (~1,278 lines), spec
- Migration: not needed

## Evidence and problem

The service contains validation/presentation helpers before the class and
coordinates feed/detail/create/update/join/leave plus waitlist/lineup coupling.
One change exercises a large fixture and can blur transaction/idempotency
ownership.

## TDD/extraction plan

- Characterize each public command/query outcome, transaction sequence and
  repository call before extraction.
- Extract pure request/domain validation and response projection first.
- Separate read queries from mutation orchestration while retaining one public
  facade/controller contract.
- Preserve waitlist promotion/direct join and lineup side-effect ordering.
- Replace broad fixtures with narrow `satisfies` ports where possible.

## Acceptance criteria

- Public service API and HTTP results are exact.
- Create/join/leave idempotency/version/account ownership unchanged.
- No transaction is split or nested differently.
- No product capability or SQL/schema change.
- Each extracted unit has direct table-driven tests.

## Independent review gate

Reviewer focuses on last-slot concurrency assumptions, owner scope, stale
versions and partial side effects. Score ≥9, backend and root gates/rollout.
