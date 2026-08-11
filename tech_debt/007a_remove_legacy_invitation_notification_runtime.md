# TD-007a — Remove legacy invitations/notifications runtime

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-007
- Primary files: `App.jsx`, invitation/notification adapters and E2E specs
- Migration: not needed

## Evidence and problem

Backend-only runtime is established, but invitation and notification flows still
carry fail-closed legacy source branches and tests for a provider that cannot be
used. Keeping those paths compiled obscures which backend bearer contract owns
state and can accidentally turn a backend rejection into local fallback.

## TDD plan

1. Characterize incoming/outgoing invitations, create/accept/decline/cancel,
   notification list/read/open and account-switch cleanup.
2. Prove backend rejection never triggers a second transport or local success.
3. Remove only invitation/notification legacy reads, mutations and test seams.
4. Reprove exact URLs, request keys, error mapping and visible UI states.

## Acceptance criteria

- Invitation/notification production calls have one backend owner.
- No legacy subscription, mutation or fallback remains for these domains.
- Stale responses cannot cross accounts; private data is never merged into feed.
- Chat/waitlist/lineup/result and match mutation code remain untouched.

## Review/completion evidence

Fresh no-context review audits removed branches and endpoint parity, scores ≥9,
and records focused/full tests, bundle search, commit, push and deployment gate.
