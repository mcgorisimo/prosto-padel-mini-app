# TD-010 — Remove unreachable D2 controlled-write/cancel foundation

- Status: `planned`
- Priority: P1
- Effort: M (2–4 days)
- Risk: medium-high
- Dependencies: TD-003, TD-009
- Primary files: `backend/src/integrations/yclients/yclients-controlled-*`,
  reservation cancellation service/port/adapter/tests, D2 runbooks
- Migration: not needed

## Evidence and problem

D2 left a large self-contained controlled lifecycle/launcher/cleanup cluster in
`backend/src`. It is not imported by Nest runtime. A separate cancellation
service and YCLIENTS DELETE adapter are also not wired, while the approved
product contract says cancellation/reschedule are performed only by a human
administrator in YCLIENTS. Historical evidence must remain available, but
unreachable write code should not look reusable runtime code.

## Pre-deletion proof

- Build an import/DI/script graph for every candidate.
- Confirm no package script, runbook recovery procedure or deployed runtime
  imports it.
- Confirm D2 cleanup is finished and evidence paths/SQL remain documented.
- Retain read-only admin reconciliation code used by current bookings.

## TDD/implementation

1. Add negative module-boundary tests proving no app route/service exposes PUT,
   DELETE, cancel or reschedule.
2. Preserve tests for the approved read-only exact/list reconciliation.
3. Delete historical executable code only after zero-consumer proof. Preserve
   its exact Git commit and archival runbook/evidence; never relocate executable
   provider-write TypeScript into another compiled or importable tree.
4. Remove cancellation domain/adapter only if no future compiled dependency.
   Preserve canonical deleted/read proof validation and reservation states still
   needed by read-only reconciliation of administrator changes.

## Acceptance criteria

- Runtime source exposes create/read/refresh only.
- No executable blind retry or app-originated cancel/reschedule path exists.
- Historical audit evidence is clearly archived, not falsified or erased.
- Backend gates and root E2E remain green; no migration/provider call.

## Independent review gate

Reviewer focuses on accidental deletion of live reconciliation/recovery and
must independently prove the removed graph is unreachable. Score ≥9.
