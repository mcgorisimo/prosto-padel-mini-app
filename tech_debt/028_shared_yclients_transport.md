# TD-028 — Add one bounded shared YCLIENTS HTTP transport

- Status: `planned`
- Priority: P1
- Effort: M–L (3–5 days)
- Risk: high
- Dependencies: TD-010, TD-027
- Primary files: runtime YCLIENTS API/admin-read clients, limiter, new transport
- Migration: not needed

## Evidence and problem

YCLIENTS clients duplicate authentication, limiter permit, timeout, status and
body parsing. Admin read enforces streaming caps, while several catalog/booking
paths call unbounded `response.text()`. Divergent transport rules risk memory
growth and inconsistent uncertainty classification.

## Contract test matrix first

401/403, 408/425/429, 5xx, unexpected 2xx; timeout/abort; streaming body at and
above cap; malformed/empty JSON; limiter saturation; caller cancellation; one
permit and one fetch per operation. Mutation tests prove zero blind retries and
body is not consumed for rejected status when current contract says so.

## Target design

Shared internal transport owns canonical base URL/auth headers, limiter,
timeout/abort and bounded streaming. Endpoint clients own URL/payload and strict
response decoding/outcomes. Use operation-specific body limits.

## Acceptance criteria

- No runtime YCLIENTS code uses unbounded body reads.
- One transport behavior matrix, exact endpoint payload/header parity.
- Existing queue/rate policy and no-retry semantics unchanged.
- No live YCLIENTS call during implementation/tests.

## Independent review gate

Reviewer stresses memory/abort/unknown outcome/security. Score ≥9, backend/root
gates and backend rollout with read-only booking smoke only.
