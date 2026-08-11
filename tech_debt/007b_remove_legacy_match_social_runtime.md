# TD-007b — Remove legacy chat/waitlist/lineup/result runtime

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-007a
- Primary files: `MatchDetailsScreen.jsx`, domain adapters, E2E specs
- Migration: not needed

## Evidence and problem

Chat, waitlist, lineup and result flows still compile legacy facade branches
even though authenticated backend contracts are the only reachable runtime.
This multiplies state transitions and leaves impossible success modes in tests.

## TDD plan

1. Freeze chat pagination/send/moderation, waitlist join/leave/promotion view,
   lineup state and result submission/read behavior.
2. Add negative cases proving backend failure remains visible and cannot fall
   back to legacy/local mutation.
3. Delete domain legacy branches one capability at a time without moving UI.
4. Recheck owner/participant authorization, cursors, versioning and request keys.

## Acceptance criteria

- These four domains use backend bearer contracts exclusively.
- Unknown mutation outcomes remain recoverable and are never retried blindly.
- Accessible names, empty/error states and request ordering are unchanged.
- Match create/join/leave/update remains owned by TD-007c.

## Review/completion evidence

No-context reviewer traces every operation to one endpoint, reports P0/P1/P2
and score ≥9. Record full gates, commit/push and exact rollout evidence.
