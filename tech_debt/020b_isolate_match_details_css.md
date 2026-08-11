# TD-020b — Isolate match-detail CSS

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: high visual risk
- Dependencies: TD-016e, TD-020a
- Primary files: MatchDetails presenters and scoped styles
- Migration: not needed

## Plan and acceptance

Move match-detail/card/chat/waitlist/lineup/result screen rules from global and
inline ownership into scoped styles. Test owner/participant/public states,
empty/long text, keyboard, every overlay and 320/375/480px widths.

- no selector leaks into booking/profile/feed;
- semantic tokens and computed styles remain equivalent;
- no horizontal overflow, hidden action or broken safe-area/focus state;
- remove each obsolete global rule only after zero-consumer proof.

## Review evidence

Fresh visual/a11y reviewer score ≥9; record screenshot matrix, CSS occurrence/
size delta, full gates, commit/push and deployed match smoke.
