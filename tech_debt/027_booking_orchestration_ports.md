# TD-027 — Introduce narrow booking orchestration ports

- Status: `planned`
- Priority: P1
- Effort: M (2–4 days)
- Risk: high
- Dependencies: TD-022, TD-030
- Primary files: `booking-reservation.service.ts` and spec, booking/provider
  ports, Nest wiring
- Migration: not needed

## Evidence and problem

BookingReservationService accepts many concrete PostgreSQL and YCLIENTS classes.
Its test harness uses `as never`, masking interface drift. Broad catches collapse
different internal failures, while provider dispatch uncertainty has strict
business consequences.

## TDD plan

- replace fake construction with narrow structural ports using `satisfies`;
- characterize exact transaction/call order for create, read, exact refresh,
  unknown recovery and finalization;
- inject persistence failure before dispatch, provider definite rejection,
  timeout/unknown after possible dispatch and finalization failure;
- prove public outcomes remain exact and no PII is logged;
- prove no provider POST retry after uncertain dispatch.

## Acceptance criteria

- Service constructor depends only on operations it uses.
- Nest injects current concrete implementations through adapters/tokens without
  runtime behavior change.
- Tests require no `as never` or oversized fake class.
- Internal failure category is diagnosable without changing public API.

## Independent review gate

Reviewer traces every side effect and unknown outcome. Score ≥9, backend/root
gates and backend rollout; no provider writes in tests.
