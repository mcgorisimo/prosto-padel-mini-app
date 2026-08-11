# TD-011c — Extract lineup/result/admin codecs and compose client facade

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-011b, TD-007c
- Primary files: `src/lib/backendSessionClient.js`, lineup/result/admin modules
- Migration: not needed

## Problem and target

Complete the decomposition by moving lineup, result and admin/search codecs and
turning `backendSessionClient.js` into a small explicit composition facade.

## TDD plan

- characterize lineup/result versions, scores, eligibility and unknown states;
- characterize admin/search authorization and PII-safe errors;
- add complete exported action-key and descriptor/freeze parity snapshots;
- extract domains, then delete duplicated helpers from the facade.

## Acceptance criteria

- Facade contains composition/public compatibility only, with measured size drop.
- Every domain shares one bounded transport and retains strict runtime validation.
- Admin payloads never leak into player responses/logs.
- No circular domain dependencies or React/storage imports are introduced.

## Review/completion evidence

Fresh reviewer audits the whole final boundary and scores ≥9. Record method
inventory, focused/full gates, commit/push and exact test deployment.
