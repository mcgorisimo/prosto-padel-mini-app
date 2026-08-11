# TD-015e — Migrate result polling and close polling ownership

- Status: `planned`
- Priority: P1
- Effort: M (1–2 days)
- Risk: high
- Dependencies: TD-015, TD-016d
- Primary files: extracted result controller, polling inventory and specs
- Migration: not needed

## TDD plan

Cover hidden/terminal/result-version states, submission versus refresh, account/
match switch, single-flight, bounded failure retry and cleanup. Migrate result,
then inventory notification/chat/waitlist/lineup/result to prove no legacy timer.

## Acceptance criteria

- All five streams use the one scheduler and have measured active/hidden budgets.
- Terminal results stop polling only where the current contract permits.
- No mutation is coalesced/retried and no stale read overwrites newer truth.
- `rg`/tests prove legacy five-second timer ownership is absent from domains.

## Review evidence

Fresh no-context final polling review score ≥9; record complete stream matrix,
gates, candidate/closure commits and TMA rollout/logs.
