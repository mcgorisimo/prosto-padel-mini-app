# TD-007c — Remove legacy match mutations and Supabase facade

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-007b
- Primary files: `App.jsx`, `MatchDetailsScreen.jsx`, `backendMatchAdapter.js`,
  `invitationApi.js`, `waitlistApi.js`, `supabaseClient.js`, E2E specs
- Migration: not needed

## Evidence and problem

After TD-007–007b, remaining legacy match create/join/leave/update branches and
their facade files should be unreachable. Keeping them prevents a mechanical
proof that the frontend is backend-only and preserves misleading test seams.

## TDD/deletion plan

1. Characterize create-no-court, join/leave, slot persistence, optimistic/version
   conflicts and paid-court fail-closed behavior.
2. Remove legacy mutation branches and obsolete normalization signatures.
3. Run exact import/export/reference analysis before deleting facade files.
4. Remove tests that simulate legacy success; preserve negative backend tests.

## Acceptance criteria

- `rg`, dependency analysis and production bundle show no Supabase runtime marker.
- Match operations retain payload, bearer, request-key and error semantics.
- Missing product operations stay unavailable and are not implemented locally.
- `supabaseClient.js` and now-orphaned adapters are deleted only with zero-consumer
  proof; no historic SQL/schema audit evidence is deleted.

## Non-goals

No app cancel/reschedule, match cancellation, participant removal, visibility
conversion, training backend or payment-field change.

## Review/completion evidence

Fresh reviewer receives exact baseline/candidate, validates deletion proof and
scores ≥9. Record bundle scan, all gates, commit/push and test rollout.
