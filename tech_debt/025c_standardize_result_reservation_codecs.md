# TD-025c — Standardize result/reservation PostgreSQL codecs

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-025b, TD-030
- Primary files: result/reservation repositories, shared codecs and specs
- Migration: not needed; SQL must not change

## TDD plan

Freeze result versions/scores and reservation status/provider-binding/snapshot/
operation row parsing, including nullable/exact cardinality and epoch/bigint
edges. Reuse shared generic codecs without merging domain error taxonomies.

## Acceptance criteria

- SQL, advisory locks, transactions, AEAD snapshot handling and interfaces exact.
- Unknown/recovery statuses cannot be coerced into success by generic decoding.
- No PII is added to errors or fixtures.
- Result/reservation domain mappers remain focused and strictly covered.

## Review evidence

Fresh reviewer audits result and reservation invariants, score ≥9; record real-
PG/focused/full gates, commit/push and backend rollout.
