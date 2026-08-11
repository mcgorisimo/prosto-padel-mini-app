# TD-014a — Extract App reservation/court store

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-014
- Primary files: `src/App.jsx`, reservation/court hooks and unit/E2E specs
- Migration: not needed

## Problem and target

Reservation list, read-only reconciliation, linked detail and court-name catalog
state live in App. Extract them into one account-scoped controller without
changing YCLIENTS authority or adding cancellation/reschedule.

## TDD plan

- freeze list/load/refresh, exact linked detail and unknown recovery states;
- prove admin-deleted bookings disappear and admin date/time/court moves refresh;
- prove stale refresh after logout/account switch is ignored;
- inject facade/clock/abort dependencies and remove duplicated App state.

## Acceptance criteria

- Reservation/court state has one owner and never enters public match feed.
- Existing polling/request caps, status projection and UI text remain truthful.
- No provider write, payment-field change or contact feature is added.
- App retains invitation/notification/chat ownership until later tasks.

## Review/completion evidence

No-context reviewer audits source-of-truth and stale-response safety, score ≥9;
record all gates, commit/push and booking smoke on deployed test commit.
