# TD-021 — Add route-level lazy loading and shrink the main chunk

- Status: `planned`
- Priority: P2
- Effort: M (2–4 days)
- Risk: medium
- Dependencies: TD-013, TD-016e, TD-017b, TD-018a, TD-020d
- Primary files: App navigation/composition, Vite build boundaries
- Migration: not needed

## Evidence and problem

Production currently emits one large JavaScript chunk (roughly 928 kB before
gzip in recent builds). Every screen, admin flow, booking and match capability
loads at startup. Navigation remains internal state, so safe lazy boundaries
should follow the reducer established in TD-013 rather than arbitrary dynamic
imports.

## TDD/performance plan

- auth/splash and Home render without downloading admin/booking/result chunks;
- opening each screen loads one expected chunk and preserves current state/back;
- chunk failure enters TD-002 sanitized recovery with retry;
- no duplicate React/runtime/vendor copy;
- collect exact initial JS bytes and cold render timing before/after.

## Acceptance criteria

- Main entry reduction target is set from baseline (initial goal ≥25% without
  harmful micro-chunks).
- Lazy fallback is accessible and visually consistent.
- Existing navigation, credential boundary and API call timing are unchanged.
- Vite large-chunk warning is eliminated or remaining intentional chunk is
  documented with measured reason.

## Non-goals

No React Router/deep links unless separately approved after TD-013; no service
worker/offline cache.

## Independent review gate

Reviewer inspects chunk graph, failure/retry and duplicate dependencies. Score
≥9, full root gates and frontend rollout.
