# TD-024 — Extract pure codecs from `PostgresMatchRepository`

- Status: `planned`
- Priority: P1
- Effort: M–L (3–6 days)
- Risk: high
- Dependencies: TD-022, TD-023, TD-029
- Primary files: `postgres-match.repository.ts` (~2,063 lines), spec, new codecs
- Migration: not needed; SQL must not change

## Evidence and problem

The repository class starts only around line 1,394. Before it are many SQL
constants, row shapes, hydration, validation, command reconstruction and error
mapping. Reviewers cannot easily distinguish pure persisted-data decoding from
locking/query behavior.

## RED matrix

Direct codec tests for malformed cardinality, duplicate participants/commands,
invalid bigint/epoch/status, command/version/digest mismatch, public/private
projection, corrupt reservation target and idempotent retry reconstruction.
Freeze current rejection categories and sanitized diagnostics.

## Implementation

Extract row types/codecs, aggregate hydrator, persistence plan and SQL constants
into focused internal files. Keep the repository class responsible for query,
lock and transaction order. Move code without rewriting algorithms.

## Acceptance criteria

- Repository class target under ~900 lines with clear query methods.
- SQL text/parameters, `FOR UPDATE`/advisory lock and query ordering exact.
- `MatchRepository` interface and all public outcomes unchanged.
- Corrupt rows fail closed with no raw row/PII leakage.

## Independent review gate

Reviewer diffs SQL and transaction traces, fuzzes codecs and checks no relaxed
validation. Score ≥9, all backend/root gates and backend rollout.
