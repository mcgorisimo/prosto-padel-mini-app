# TD-004c — Split Telegram login Playwright spec

- Status: `planned`
- Priority: P1
- Effort: M (1–2 days)
- Risk: medium-high auth risk
- Dependencies: TD-004b
- Primary files: Telegram backend login spec and focused fixtures
- Migration: not needed

## Plan and acceptance

Separate lifecycle/transport/credential/React binding cases using the baseline
inventory, while preserving initData secrecy and all failure assertions.

- exact title/assertion parity and stable worker execution;
- fake Telegram objects, timers, crypto, storage and fetch fully restored;
- no credential/initData enters output, traces or cross-test state;
- tests accurately label pure/contract/component/UI scope.

## Review evidence

Fresh no-context auth/test review score ≥9; record title map, gates, commits and
deployment impact.
