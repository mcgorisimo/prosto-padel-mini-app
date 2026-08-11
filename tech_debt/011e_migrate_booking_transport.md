# TD-011e — Migrate booking clients to shared frontend transport

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high provider/idempotency risk
- Dependencies: TD-011d
- Primary files: `src/lib/bookingAvailabilityClient.js`, booking reservation
  methods in frontend client, shared transport and specs
- Migration: not needed

## Evidence and problem

Booking availability/create/list/detail/recovery keep transport mechanics that
overlap the shared frontend transport. Drift is dangerous because read retries
and create unknown-outcome semantics are deliberately different.

## TDD plan

- freeze URLs/query encoding/body caps/timeouts/abort and bearer headers;
- freeze availability read retry policy separately from create/recovery policy;
- prove a dispatched create with uncertain response is never blindly retried;
- migrate bounded mechanics only, keeping booking codecs and request-key state
  in their existing domain owners until TD-017/017a/017b.

## Acceptance criteria

- One frontend implementation owns fetch timeout/abort/bounded-body mechanics.
- Booking read/write operation policy remains explicit and test-enforced.
- Request keys, payloads, errors and unknown recovery are identical.
- No payment, provider cancel/reschedule or new product behavior is added.

## Review evidence

Fresh no-context reviewer audits wire/idempotency parity, score ≥9; record all
gates, candidate/closure commits and booking smoke on exact test deployment.
