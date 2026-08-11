# TD-004d — Split booking Playwright specs and close test decomposition

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: medium-high
- Dependencies: TD-004c
- Primary files: booking availability/reservation/home specs and final inventory
- Migration: not needed

## Plan and acceptance

Split booking transport/availability/UI/reconciliation cases, then compare the
complete root Playwright inventory to TD-004.

- no test title/assertion/product mode is lost or duplicated accidentally;
- YCLIENTS writes stay fake, unknown create semantics and request counts exact;
- fixtures leave no PII, storage, routes, pages or roots behind;
- final specs are capability-oriented and official four-worker gate is stable;
- pure imports are moved/labeled only with demonstrated parity.

## Review evidence

Fresh reviewer audits complete before/after inventory and scores ≥9; record
durations, gates, candidate/closure commits and deployment impact.
