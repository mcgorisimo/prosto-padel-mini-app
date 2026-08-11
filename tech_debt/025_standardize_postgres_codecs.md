# TD-025 — Standardize invitation repository PostgreSQL codecs

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: medium-high
- Dependencies: TD-024
- Primary files: `postgres-codecs.ts`; invitation repository and specs
- Migration: not needed; SQL must not change

## Evidence and problem

Repository source repeats strict record/scalar/cardinality helpers. This first
task defines the shared helper ownership and migrates only invitations. Chat,
notification, waitlist, lineup, result and reservation follow in TD-025a–025c.

## TDD plan

1. Extend shared codec tests for null/prototype objects, bigint range, epoch,
   exact/optional cardinality and sanitized failure.
2. Add parity tests comparing current domain outcomes before migration.
3. Migrate the invitation repository; remove each local helper only after all
   its branches are covered.
4. Keep domain-specific row shapes/error mapping close to the domain.

## Acceptance criteria

- `postgres-codecs.ts` is the one owner of generic strict record/scalar/
  cardinality decoding; TD-026 may consume but must not redefine these helpers.
- No giant generic mapper, unsafe cast or reduced exact-key validation.
- Invitation SQL, error reasons, transaction/lock order and interface exact.
- Measurable duplicate reduction recorded by helper occurrence counts.

## Independent review gate

Fresh review of the invitation slice; score ≥9 and no P0/P1. Backend gates and
backend rollout required.
