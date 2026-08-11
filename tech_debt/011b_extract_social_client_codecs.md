# TD-011b — Extract chat/waitlist/notification client codecs

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days)
- Risk: high
- Dependencies: TD-011a, TD-007b
- Primary files: `src/lib/backendSessionClient.js`, new social client modules
- Migration: not needed

## Problem and target

Chat, waitlist and notification validators/actions still share one large client
scope. Extract these three cohesive domains while keeping cursor, moderation,
membership and account-isolation semantics exact.

## TDD plan

- characterize pagination/cursor boundaries, malformed authors and body caps;
- characterize waitlist version/conflict outcomes and notification open/read;
- prove abort and account switch discard stale pages;
- extract codecs/actions behind the same facade and shared transport.

## Acceptance criteria

- Domain modules are pure or dependency-injected and do not read local storage.
- No mutation is blindly retried; error classes/messages stay public-safe.
- Public facade keys and call ordering remain unchanged.
- Lineup/result/admin remain for TD-011c.

## Review/completion evidence

No-context reviewer audits cursor/account isolation and error parity, score ≥9;
record all gates, commit/push and deployment evidence.
