# TD-015c — Migrate waitlist polling to shared scheduler

- Status: `planned`
- Priority: P1
- Effort: M (1–2 days)
- Risk: high
- Dependencies: TD-015, TD-016b
- Primary files: extracted waitlist controller and specs
- Migration: not needed

## TDD plan

Cover visibility, match/account/version ownership, join/leave versus refresh,
single-flight, backoff/jitter and cleanup. Measure before/after and replace only
waitlist periodic read ownership.

## Acceptance criteria

- Zero hidden polling and at most one read per waitlist ownership key.
- Mutations/FIFO authority remain backend-owned and outside read coalescing.
- Version/conflict/UI behavior and immediate load are unchanged.
- Chat/lineup/result consumers are untouched.

## Review evidence

Fresh concurrency/domain review score ≥9; record budget, gates, commits and
deployed waitlist smoke.
