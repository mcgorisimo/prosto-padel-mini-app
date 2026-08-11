# TD-013 — Replace ad-hoc App navigation with a pure reducer

- Status: `planned`
- Priority: P1
- Effort: M (2–3 days)
- Risk: medium
- Dependencies: TD-007c, TD-012
- Primary file: `src/App.jsx`
- Migration: not needed

## Evidence and problem

Navigation is represented by independent `activeTab`, `screen`, selected match,
selected reservation and match-to-book identifiers. Notifications, invitations,
booking and back handlers mutate different subsets, allowing impossible stale
combinations. There is no pure transition model to test.

## TDD table

Define events and expected states for: tab switch; open/close match; create
match; notification/invitation open; open booking; book for existing match;
open/close exact reservation; invalid/stale selected entity; logout/account
change; back from each screen. Assert identifiers are cleared exactly when their
owner screen closes.

## Implementation

Create a pure reducer and event creators while preserving current in-memory
navigation (no Router/deep links yet). Replace handlers incrementally; keep
render conditions unchanged until every transition is covered.

## Acceptance criteria

- One discriminated navigation state prevents impossible combinations.
- Current tab order, visible screens, back behavior and scroll restoration are
  unchanged.
- Reducer has complete branch coverage and no network/UI side effects.
- `App.jsx` no longer directly coordinates unrelated navigation fields.

## Non-goals

No URLs, browser history, deep links or mobile navigation in this task.

## Independent review gate

Reviewer generates adversarial transition sequences and checks state cleanup.
Score ≥9, root gates and frontend rollout.
