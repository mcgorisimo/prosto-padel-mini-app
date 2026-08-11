# TD-014c — Extract App chat store and finish composition root

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-014b
- Primary files: `src/App.jsx`, selected-match chat hook and specs
- Migration: not needed

## Problem and target

The final large account/domain state in App is selected-match chat. Extract its
pagination/send/moderation ownership, then verify App is a composition/rendering
root rather than a hidden second store.

## TDD plan

- characterize selected-match switch, pagination, duplicate cursor, send and
  moderation version/error paths;
- prove late pages/sends cannot populate a new match or account;
- extract controller, remove duplicate refs/state and measure App responsibility;
- add a composition contract test listing the stores/reducer wired by App.

## Acceptance criteria

- Chat state has one owner with abort/single-flight semantics preserved.
- App holds navigation/composition only; no moved domain state remains duplicated.
- No cross-store implicit mutation; coordination is explicit and typed/tested.
- UI design, routes, accessible labels and backend call order remain unchanged.

## Review/completion evidence

No-context reviewer audits App for residual god-state and races, score ≥9;
record size/responsibility delta, all gates, commit/push and rollout.
