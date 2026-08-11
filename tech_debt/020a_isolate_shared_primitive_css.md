# TD-020a — Isolate shared primitive/modal CSS

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: medium-high visual risk
- Dependencies: TD-020
- Primary files: shared buttons/inputs/cards/modal primitive styles and specs
- Migration: not needed

## Plan

Capture computed styles at 375/480px, then move only reusable primitive and
overlay rules into scoped ownership. Preserve semantic tokens from TD-020,
focus-visible, reduced motion, safe-area, scroll lock and stacking order.

## Acceptance criteria

- Primitive selectors cannot leak into screens and require no screen-specific
  `!important` override.
- Modal/sheet styles have one owner across profile, matches and booking.
- Visual/computed-style delta is zero except separately approved bug fixes.
- No inline color/token replacement outside this slice.

## Review evidence

No-context visual/a11y review score ≥9; record screenshots, focused/full gates,
commit/push and mobile TMA rollout.
