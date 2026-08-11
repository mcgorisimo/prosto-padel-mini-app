# TD-026 — Split session credential persistence mapping from SQL

- Status: `planned`
- Priority: P2
- Effort: M (2–4 days)
- Risk: high
- Dependencies: TD-025, TD-032
- Primary file: `postgres-session-credential-lifecycle.repository.ts`
  (~1,626 lines), specs
- Migration: not needed; do not rewrite the session state machine

## Evidence and problem

The repository class begins around line 1,175 after SQL constants and many
credential-family hydration, command-history, audit and error helpers. The
separate pure session state machine is already heavily tested and should remain
stable.

## TDD plan

Add direct codec/plan tests for credential family hydration, command ordering,
rotation/revocation/reuse terminal states, corrupt operation binding, digest and
audit mapping. Assert secrets/raw hashes never appear in errors or snapshots.

## Implementation

Extract credential-domain row/command mapping and persistence-plan functions.
Consume generic strict record/scalar/cardinality primitives from
`postgres-codecs.ts` as established by TD-025; do not redefine or change their
semantics. Leave the repository responsible for executing exact SQL and
preserving audit/lock/query order. Do not merge this work with state-machine
redesign.

## Acceptance criteria

- Public repository/state-machine exports exact.
- SQL/parameters/transaction/audit order and retry semantics unchanged.
- Pure mapping is exhaustively tested without mocked SQL execution.
- Credential bytes/identifiers remain redacted and zeroization unchanged.

## Independent review gate

Reviewer audits secrecy, replay/reuse, terminal states and transaction parity.
Score ≥9, backend/root gates and backend rollout.
