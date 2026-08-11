# TD-028a — Bound Telegram Bot API response bodies

- Status: `planned`
- Priority: P1
- Effort: S–M (1–2 days)
- Risk: medium-high availability/security risk
- Dependencies: TD-032
- Primary files: `backend/src/notifications/telegram-bot.client.ts` and specs
- Migration: not needed

## Evidence and problem

The Telegram Bot client reads `response.text()` without a bounded streaming
cap. A large/malicious upstream body can consume unbounded memory. This is
separate from YCLIENTS transport and must be fixed without broad HTTP redesign.

## TDD plan

- add exact-under/at/over-limit responses, missing/invalid content length,
  chunked stream, abort, network error and non-JSON/non-2xx cases;
- prove over-limit handling cancels the reader and returns a sanitized error;
- implement a local bounded reader or reuse TD-031 primitive only if already
  available without creating dependency inversion;
- record the cap rationale from the actual Telegram response shapes.

## Acceptance criteria

- No Telegram response path uses unbounded `text()/json()/arrayBuffer()`.
- Timeout/abort and retry policy do not change accidentally.
- Upstream body/token/chat data is absent from logs/public errors.
- Mutation delivery is never blindly retried on uncertain outcome.

## Review evidence

Fresh security review score ≥9; record focused/backend/root gates, commit/push
and notification smoke/logs on the exact test deployment.
