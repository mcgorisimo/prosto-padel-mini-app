# TD-034c — Generate chat/notification contracts

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-034b
- Primary files: contract artifacts and chat/notification backend/frontend codecs
- Migration: not needed

## TDD plan

Generate chat page/message/moderation and notification list/read/open contracts.
Compare exact wire fixtures, cursors, authors, body bounds, account identity,
status/error and forbidden internal fields before deleting manual codecs.

## Acceptance criteria

- Runtime exact validation/body caps remain at least as strict.
- Cursor/request-key/retry and account-isolation semantics are unchanged.
- Admin/internal/PII fields cannot enter player schemas.
- Waitlist/lineup/result/booking contracts remain untouched.

## Review evidence

Fresh no-context security/wire review score ≥9; record deterministic generation,
parity matrix, all gates, candidate/closure commits and rollout.
