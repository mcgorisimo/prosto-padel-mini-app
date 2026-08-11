# TD-035 — Repair source-of-truth docs and encoding debt

- Status: `planned`
- Priority: P2
- Effort: M (2–4 days)
- Risk: low
- Dependencies: all prior tasks in `README.md`
- Primary files: `SPEC.md`, backend/root README/context/QA docs, archived
  Supabase/migration docs, encoding check
- Runtime/deployment: not needed for docs/check-only changes

## Evidence and problem

Tracked docs still describe Vercel/Supabase or YCLIENTS-disabled behavior as
current, while `MASTER_PLAN`, `WORKLOG`, code and SPEC say otherwise. Historical
Supabase schema/migrations can appear actionable. The repository does not yet
have a deterministic UTF-8 verification gate, so future encoding corruption
could be merged unnoticed. Stale instructions are operational debt; existing
mojibake must not be claimed or bulk-rewritten without byte-level evidence.

## Plan

1. Inventory tracked docs by authority and last valid runtime era.
2. Add one documentation index: current, historical/archive, migration evidence,
   generated artifacts.
3. Put explicit `ARCHIVED / DO NOT APPLY` banners/index around old Supabase-era
   docs without deleting audit history or mutating applied SQL.
4. Update README/QA examples to current backend-only/YCLIENTS truth.
5. Add UTF-8/check script for invalid byte sequences and replacement characters.
   Record exact files/bytes for any proven corruption and fix only those cases
   with semantic review; do not use broad pattern replacement or blind recoding.
6. Reconcile this register with completed task evidence and remove obsolete
   claims from SPEC.

## Acceptance criteria

- A new developer can identify current source of truth unambiguously.
- No historical migration is presented as safe/current or silently deleted.
- UTF-8 check is deterministic; Russian text renders correctly.
- No secrets, live host credentials or PII enter documentation.
- `git diff --check`, doc links and code snippets are valid.

## Independent review gate

No-context reviewer follows onboarding solely from docs and reports conflicts,
then scores ≥9. Commit/push required; deployment `not_needed` with reason.
