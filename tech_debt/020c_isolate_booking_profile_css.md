# TD-020c — Isolate booking/profile CSS

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: high visual risk
- Dependencies: TD-017b, TD-018a, TD-020b
- Primary files: booking/profile presenters and scoped styles
- Migration: not needed

## Plan and acceptance

Move booking and profile/settings/photo rules into scoped ownership after their
presenters stabilize. Characterize availability, detail/status banners, forms,
keyboard, photo overlay and long PII values at mobile widths.

- no selector crosses booking/profile or other screens;
- fixed/portal overlays remain viewport anchored and focus-safe;
- safe-area, scroll restoration and exact current design remain;
- raw colors become existing semantic tokens only when computed parity proves it.

## Review evidence

Fresh reviewer score ≥9 with mobile visual/accessibility matrix; record full
gates, commit/push and booking/profile TMA rollout.
