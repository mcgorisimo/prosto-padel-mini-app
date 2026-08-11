# TD-008 — Remove demo bots and local rating truth from production

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: medium
- Dependencies: TD-007c
- Primary files: `MatchDetailsScreen.jsx`, `testSeed.js`, `ratingEngine.js`,
  `RatingChart.jsx`, profile/history consumers
- Migration: not needed

## Evidence and problem

Opening a backend match currently evaluates `getTestBots()` unconditionally;
that function seeds `dp_test_bots` in localStorage before bot UI is later
hidden. `ratingEngine.loadHistory()` can create a random 25-day local rating
history (`TODO`), while backend profile/match results own the real rating. This
creates silent production side effects and two competing truths.

## TDD plan

1. RED: opening backend feed/detail/profile creates neither `dp_test_bots` nor
   `dp_rating_history`; current implementation fails this.
2. Prove bot controls never appear or influence backend slots/results.
3. Characterize the truthful UI when backend exposes only current rating and no
   rating-history endpoint: no fabricated chart points or random values.
4. Remove production imports/storage writes. Preserve pure level/color/rating
   calculation functions still used at observable boundaries.
5. Delete test seed/history helpers only after zero consumers.

## Acceptance criteria

- No random or demo rating data in production state/storage/UI.
- Backend rating/current result remains unchanged.
- Rating UI explicitly handles unavailable history without pretending it is
  real; design changes are limited to truthful empty state.
- Existing localStorage unrelated to rating is untouched.

## Non-goals

Do not add rating-history backend endpoints or redesign rating rules.

## Independent review gate

Reviewer checks side effects, truthful UX and that real backend rating logic was
not removed. Record score ≥9, tests/build and frontend rollout.
