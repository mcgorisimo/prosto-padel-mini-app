# TD-017a — Extract Booking create/recovery/link workflow

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-017
- Primary files: `BookingScreen.jsx`, create/recovery controller/specs
- Migration: not needed

## Target and TDD

Move booking client-data validation, request-key lifecycle, create dispatch,
unknown-outcome recovery and resulting reservation link into an injected state
machine. Characterize double submit, lost response, key/digest mismatch, account
switch and provider-uncertain outcomes before moving code.

## Acceptance criteria

- One controller owns exactly one create attempt/request key.
- Unknown write outcome never triggers blind create retry and stays recoverable.
- Name/phone/email requirements and PII-safe errors remain exact.
- Payment fields and app cancellation/reschedule stay untouched.

## Review evidence

Fresh reviewer audits idempotency/PII/unknown recovery, score ≥9; record all
gates, commit/push and controlled test booking smoke policy.
