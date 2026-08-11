# TD-004a — Split backend match lifecycle Playwright spec

- Status: `planned`
- Priority: P1
- Effort: M (2–3 days)
- Risk: medium
- Dependencies: TD-004
- Primary files: backend match lifecycle spec, bounded domain specs/helpers
- Migration: not needed

## Plan

Using TD-004's title inventory, separate feed/detail/join, invitations, chat,
waitlist, lineup/result and negative legacy-boundary cases without changing
production behavior. Move pure cases to TD-001 only with assertion/title parity.

## Acceptance criteria

- Every original test title/assertion maps to one new owner; count gaps are zero.
- Shared fixtures are immutable/bounded and clean all window/route/root state.
- Feature modes, four-worker stability, traces and failure diagnostics remain.
- No product assertion is weakened or replaced by broad snapshots.

## Review evidence

Fresh no-context test review score ≥9; record title map/durations, all gates,
candidate/closure commits and deployment impact.
