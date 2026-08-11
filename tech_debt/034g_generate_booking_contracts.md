# TD-034g — Generate booking contracts and remove manual frontend schemas

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-034f
- Primary files: booking contract source/artifact, backend DTOs/frontend codecs
- Migration: not needed

## TDD plan

Generate availability/create/list/detail/recovery/read-only reconciliation
contracts. Compare all status/provider-binding/unknown/deleted/admin-moved wire
fixtures, exact-key and PII exclusions. Remove the final corresponding manual
frontend schemas only after generator drift/fuzz/parity tests pass.

## Acceptance criteria

- Booking public contract contains only necessary client-safe fields.
- Unknown write/read outcomes and canonical provider proof remain distinguishable.
- No provider PUT/DELETE, app cancel/reschedule or payment-field change appears.
- Final frontend contract duplication and remaining facade size are measured.

## Review evidence

Fresh reviewer audits PII, wire and recovery semantics, score ≥9; record all
gates, candidate/closure commits and deployed booking smoke/logs.
