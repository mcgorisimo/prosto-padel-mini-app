# TD-032 — Backend coverage ratchet and spec maintainability

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: low-medium
- Dependencies: TD-003
- Primary files: Jest configs/scripts and oversized specs
- Migration: not needed

## Evidence and problem

Backend has many strong unit suites but no mandatory coverage command/ratchet.
Several specs exceed 1,000–2,000 lines. This early safety task establishes a
truthful ratchet before backend refactors and splits only one representative
oversized spec; further splits stay with the domain task that changes them.

## Plan

1. Capture statement/branch/function/line coverage by domain without excluding
   difficult runtime files merely to raise numbers.
2. Set a truthful baseline ratchet; new files and extracted pure modules require
   high/complete branch coverage.
3. Split one representative giant spec by public capability/state group with
   shared immutable builders, proving the pattern without a multi-domain edit.
4. Add a test-title inventory to prevent silent case loss.
5. Keep compile-time `@ts-expect-error` contract tests intact.

## Acceptance criteria

- `npm.cmd run test:coverage` in backend is deterministic and fails regression.
- Coverage exclusions are minimal and documented by exact reason/task.
- The representative split preserves assertions/cases and improves focused
  execution; the baseline is available to TD-029/030 and TD-022–031.
- No runtime source change is bundled unless separately required/tested.

## Independent review gate

Reviewer checks gaming/exclusions and assertion parity. Score ≥9; normally
`deployment: not_needed` for test/config-only work.
