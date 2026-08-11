# TD-017b — Extract Booking detail and finish presenter

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-017a
- Primary files: `BookingScreen.jsx`, detail controller/presenters/specs
- Migration: not needed

## Target and TDD

Extract persisted list/detail selection and exact read-only YCLIENTS refresh,
then reduce the screen to availability/create/detail presenters. Cover admin
same-day time move, date-only move, date+time move, date+time+court move,
admin deletion and temporarily unverifiable read.

## Acceptance criteria

- Canonical provider proof updates date/time/court/status in list and detail.
- Deleted booking disappears according to established UI contract; uncertain
  read preserves truthful held/unknown state rather than claiming deletion.
- No PUT/DELETE/provider write route or button exists in runtime/UI.
- Presenter has no transport/reconciliation implementation.

## Review evidence

Fresh reviewer traces all move/delete cases and scores ≥9. Record E2E/manual TMA
matrix, full gates, commit/push and exact deployed commit/logs.
