# TD-016 — Decompose `MatchDetailsScreen.jsx` by capability

- Status: `planned`
- Priority: P1
- Effort: M (1–3 days; chat capability only)
- Risk: high
- Dependencies: TD-007c, TD-014c, TD-015, TD-019
- Primary file: `src/components/MatchDetailsScreen.jsx` (~3,049 lines)
- Migration: not needed

## Evidence and problem

One closure owns base details, optimistic slots, invitations, chat, waitlist,
lineup, results, copy timers, modals and polling. Roughly forty state fields and
multiple effects/actions make dependency changes restart unrelated workflows.

## Bounded scope and tests

Extract only the chat controller/view: initial page, older-page cursor,
deduplication/order, failed draft preservation, send single-flight, stale match
response and polling ownership. Invitation/waitlist/lineup/result remain for
TD-016a–TD-016d; final presenter/modal cleanup is TD-016e.

## Acceptance criteria

- Main screen composes the chat controller without owning chat state/effects.
- Chat has one request owner and resets on match/account change.
- Existing chat semantics and accessible UI are exact; other capabilities are
  byte-for-byte untouched.
- No payment or unsupported owner/admin operation is introduced.

## Independent review gate

Fresh reviewer audits chat plus integration seams; score ≥9 and no P0/P1.
Frontend rollout required.
