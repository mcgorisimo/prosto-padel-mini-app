# TD-015b — Migrate chat polling to shared scheduler

- Status: `planned`
- Priority: P1
- Effort: M (1–2 days)
- Risk: high
- Dependencies: TD-015, TD-016
- Primary files: extracted MatchDetails chat controller and specs
- Migration: not needed

## TDD plan

Measure chat call cadence and cover hidden tab, slow page overlap, cursor-aware
coalescing, match/account switch, send-versus-refresh ordering, bounded failure
backoff/jitter, resume and unmount. Migrate only the chat controller.

## Acceptance criteria

- One stream per exact account/match/cursor key and zero hidden periodic calls.
- Different cursors are never coalesced; late pages cannot cross match/account.
- Send/mutation is never coalesced or retried by a read scheduler.
- Chat UI, ordering, pagination and first visible load remain exact.

## Review evidence

Fresh reviewer audits cursors/races, score ≥9; record request budget, gates,
candidate/closure commits and deployed chat smoke.
