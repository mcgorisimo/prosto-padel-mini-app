# TD-016e — Finish MatchDetails presenter/modal decomposition

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high visual/integration risk
- Dependencies: TD-015e, TD-016d, TD-019
- Primary files: `MatchDetailsScreen.jsx`, extracted presenters/modals/specs
- Migration: not needed

## Problem and plan

After capability controllers move, remove residual orchestration, repeated modal
shells and oversized inline render branches. Characterize every public/owner/
participant/private state at phone widths, then extract pure presenters in
small slices. Do not redesign or change product availability.

## Acceptance criteria

- Screen composes controllers and focused presenters; no capability has two owners.
- All overlays use the accessible primitive and open at the viewport position.
- Focus restore, Escape/backdrop behavior, safe-area and scroll lock pass.
- Measured component responsibility/size drops without snapshot-only testing.

## Review evidence

No-context reviewer exercises all roles/modal paths, score ≥9; record visual/
computed-style checks, full gates, commit/push and TMA rollout.
