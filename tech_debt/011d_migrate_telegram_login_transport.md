# TD-011d — Migrate Telegram login to shared frontend transport

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high auth/security risk
- Dependencies: TD-011c
- Primary files: `src/lib/telegramBackendLogin.js`, shared transport and specs
- Migration: not needed

## Evidence and problem

Telegram login has a separate bounded reader, timeout/abort and fetch mechanics
from the transport established in TD-011. Parallel implementations can drift on
body caps, cancellation and sanitized errors even when login retry policy is
intentionally domain-specific.

## TDD plan

- freeze initData request bytes, headers, credentials mode and endpoint;
- cover exact/over body cap, chunked stream, timeout, abort-before/after headers,
  invalid JSON/status and credential/session response strictness;
- migrate mechanics to shared transport through explicit login policy hooks;
- retain login-specific retry/refresh decisions outside the transport core.

## Acceptance criteria

- No second implementation of bounded streaming/timeout/fetch remains in login.
- Telegram initData/credentials never enter logs/public errors.
- Auth fail-closed, retry count/order and secure credential lifecycle are exact.
- Shared transport cannot acquire browser credential storage or auth state.

## Review evidence

Fresh no-context auth/security review score ≥9; record focused/full gates,
candidate/closure commits and exact frontend rollout.
