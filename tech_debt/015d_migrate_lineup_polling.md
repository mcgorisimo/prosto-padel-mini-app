# TD-015d — Migrate lineup polling to shared scheduler

- Status: `planned`
- Priority: P1
- Effort: M (1–2 days)
- Risk: high
- Dependencies: TD-015, TD-016c
- Primary files: extracted lineup controller and specs
- Migration: not needed

## TDD plan

Characterize visibility, version/participant key, edit-versus-refresh ordering,
terminal behavior, single-flight, backoff/jitter, stale switch and cleanup;
replace only lineup periodic reads.

## Acceptance criteria

- Hidden/terminal states use the exact justified request budget.
- No read overwrites a newer edit/version or crosses account/match.
- Mutations are outside coalescing/retry; UI and backend contract stay exact.
- Result polling remains unchanged until TD-015e.

## Review evidence

Fresh reviewer audits versions/races, score ≥9; record measurement, gates,
commits and deployed lineup smoke.
