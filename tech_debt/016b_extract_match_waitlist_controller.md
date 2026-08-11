# TD-016b — Extract MatchDetails waitlist controller

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-016a
- Primary files: `MatchDetailsScreen.jsx`, waitlist controller/spec
- Migration: not needed

## Target and TDD

Extract waitlist state, join/leave actions, owner view and promotion refresh.
Characterize capacity/version conflicts, FIFO display, duplicate submission,
late response after match switch and explicit error/loading states first.

## Acceptance criteria

- Waitlist state/actions have one owner and injected backend dependency.
- No local promotion or participant mutation invents backend truth.
- Version/request-key semantics and accessible UI remain exact.
- Chat/invitation/lineup/result controllers remain isolated.

## Review evidence

Fresh reviewer focuses concurrency and backend authority, score ≥9; record gates,
commit/push and deployed match-detail smoke.
