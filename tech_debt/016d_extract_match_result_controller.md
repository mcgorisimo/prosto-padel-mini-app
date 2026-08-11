# TD-016d — Extract MatchDetails result controller

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-015d, TD-016c
- Primary files: `MatchDetailsScreen.jsx`, result controller/spec
- Migration: not needed

## Target and TDD

Extract result draft, validation, submit/read state and conflict recovery. First
freeze score/set constraints, eligibility, version checks, unknown outcomes,
rating-related read projection and accessible error presentation.

## Acceptance criteria

- Result state/actions have one owner; pure validation is exhaustively unit-tested.
- Mutation is not blindly retried and cannot be duplicated by double submit.
- No local rating truth or new result rules are introduced.
- Wire payloads, error mapping and visible state are unchanged.

## Review evidence

Fresh reviewer audits domain invariants and retry safety, score ≥9; record gates,
commit/push and deployed result read/mutation smoke where safe.
