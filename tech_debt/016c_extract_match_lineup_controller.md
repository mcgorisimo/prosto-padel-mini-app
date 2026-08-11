# TD-016c — Extract MatchDetails lineup controller

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: medium-high
- Dependencies: TD-015c, TD-016b
- Primary files: `MatchDetailsScreen.jsx`, lineup controller/spec
- Migration: not needed

## Target and TDD

Move lineup read/edit/version state out of the screen. Freeze role eligibility,
participant identity, team/slot validation, stale version conflicts, duplicate
submission and match-switch cancellation before extraction.

## Acceptance criteria

- Pure validation is separate from injected orchestration/state.
- Controller never accepts a player outside the canonical participant set.
- Backend errors/versions and UI state remain identical.
- No result calculation or new lineup product behavior is added.

## Review evidence

No-context review score ≥9; record characterization, full gates, commit/push and
test environment smoke/logs.
