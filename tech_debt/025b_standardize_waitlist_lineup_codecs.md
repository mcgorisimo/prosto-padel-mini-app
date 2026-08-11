# TD-025b — Standardize waitlist/lineup PostgreSQL codecs

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-025a
- Primary files: waitlist/lineup repositories, shared codecs and specs
- Migration: not needed; SQL must not change

## TDD plan

Characterize owner/participant scope, FIFO/version/cardinality and lineup slot/
team row parsing. Migrate only generic record/scalar/cardinality mechanics to
the shared codecs; keep waitlist/lineup invariant mapping domain-local.

## Acceptance criteria

- Transaction/lock order, SQL and returned domain errors remain exact.
- Strict malformed-row and concurrency-related branches retain coverage.
- TD-026 may consume the shared helper but cannot redefine its semantics.
- Duplicate helper reduction is mechanical and measured.

## Review evidence

Fresh reviewer audits scope/locking/strictness, score ≥9; record gates,
commit/push and exact backend rollout status.
