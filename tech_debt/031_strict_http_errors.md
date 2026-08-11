# TD-031 — Consolidate strict HTTP parsing and public error taxonomy

- Status: `planned`
- Priority: P1
- Effort: M–L (3–5 days)
- Risk: medium-high
- Dependencies: TD-022–TD-030, TD-028a
- Primary files: controller/http decoder families, new common strict HTTP code
- Migration: not needed

## Evidence and problem

Controllers repeat public error creation, principal extraction and no-store
headers. Several HTTP decoder files lack direct specs; controller examples do
not exhaust exact-key/prototype/identity validation. Similar repository failures
are mapped repeatedly to `temporary_unavailable` with domain-specific tables.

## TDD matrix

- reject extra/missing keys, arrays, null and non-plain/prototype objects;
- bounds, Unicode/code-point limits and client-controlled identity rejection;
- every domain reason maps to exact status/code/message and no-store headers;
- unexpected exception maps to stable sanitized 500/503 without raw details;
- principal is server-owned and never accepted from body/query;
- public error serialization cannot contain PII, SQL or provider bodies.

## Implementation

Introduce small strict JSON and public error/header helpers. Migrate one
controller family at a time. Keep domain reason unions and mapping tables local;
do not create an untyped global catch-all.

## Acceptance criteria

- Shared mechanics have one tested implementation.
- Serialized HTTP contract is byte-for-byte compatible.
- All previously untested decoders receive direct table-driven specs.
- No weakened validation or controller-wide broad `any`/cast.

## Independent review gate

Reviewer fuzzes parsers and compares public responses before/after. Score ≥9,
backend/root gates and backend rollout.
