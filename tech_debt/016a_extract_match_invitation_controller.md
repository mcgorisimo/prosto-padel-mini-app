# TD-016a — Extract MatchDetails invitation controller

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: medium-high
- Dependencies: TD-015b, TD-016
- Primary files: `MatchDetailsScreen.jsx`, new invitation controller/spec
- Migration: not needed

## Target and TDD

Move invitation modal/open state, eligible-player search, create/cancel/accept/
decline orchestration and refresh ownership from the presenter. First freeze
authorization, stale search, duplicate submit, version conflict, accessible
focus/close behavior and exact backend action count.

## Acceptance criteria

- One injected controller owns invitation state/actions; presenter renders it.
- Late search/action results cannot update another match/account.
- Errors remain public-safe; no legacy fallback or blind retry is introduced.
- Shared modal primitive is used without design or accessible-name regression.

## Review evidence

Fresh no-context review score ≥9; record RED/GREEN tests, full gates,
commit/push and test rollout.
