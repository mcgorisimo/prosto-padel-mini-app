# TD-017 — Decompose `BookingScreen.jsx` workflows

- Status: `planned`
- Priority: P1
- Effort: M (2–3 days; availability workflow only)
- Risk: high
- Dependencies: TD-011e, TD-014c, TD-019
- Primary file: `src/components/BookingScreen.jsx` (~1,391 lines)
- Migration: not needed

## Evidence and problem

BookingScreen combines exact reservation detail/refresh, service→court→date→
time availability cascade, selection/pricing, create/recovery, match linking,
sheet scroll lock and all rendering. Chained effects use local `active` flags
and query-key objects, but stale out-of-order combinations are not centrally
modeled.

## TDD plan

- change duration/court/date before prior promises resolve; stale result cannot
  overwrite current query;
- unmount ignores completion and cancels readers where possible;
- details mode makes no availability/create call except exact read;
- partial service/time results remain truthful;
- details mode makes no accidental create/recovery request.

## Target boundaries

Pure availability reducer/query keys plus `useBookingAvailability`. Creation,
recovery and match linking are TD-017a; exact details/presenter cleanup is
TD-017b.

## Acceptance criteria

- Central stale-response rejection and explicit state transitions.
- Existing availability request payloads/counts, pricing and UI unchanged.
- Create/detail code is behaviorally untouched; no cancel/reschedule/payment change.
- Each controller reaches complete branch coverage.

## Independent review gate

Reviewer stresses race/unknown/idempotency and scroll lifecycle. Score ≥9,
root gates and frontend rollout.
