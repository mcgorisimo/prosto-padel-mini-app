# TD-025a — Standardize chat/notification PostgreSQL codecs

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: medium-high
- Dependencies: TD-025
- Primary files: chat/notification repositories, `postgres-codecs.ts`, specs
- Migration: not needed; SQL must not change

## TDD plan

Freeze exact rows/cardinality/cursors/authors/timestamps and persistence error
mapping, then migrate only chat and notification generic decoding to the shared
helpers established by TD-025. Domain row shapes and errors stay local.

## Acceptance criteria

- SQL text, parameters, locks, transactions, cursors and interfaces are exact.
- Malformed/prototype/extra-key/bigint/epoch cases fail as strictly as before.
- No unsafe cast, giant mapper or duplicate generic helper remains in this slice.
- Helper occurrence reduction and parity test inventory are recorded.

## Review evidence

Fresh no-context backend review score ≥9; record all backend/root gates,
commit/push and deployment impact/rollout.
