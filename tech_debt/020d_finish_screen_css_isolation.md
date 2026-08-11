# TD-020d — Isolate remaining screen CSS and close global debt

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: high visual risk
- Dependencies: TD-020c
- Primary files: remaining screens, `src/index.css`, scoped style files/specs
- Migration: not needed

## Plan and acceptance

Migrate the remaining auth/home/feed/rating/navigation screen-specific rules,
then leave `index.css` with documented root/tokens/reset ownership only.

- global selectors are limited to an explicit allowlist;
- no contradictory compatibility block or unexplained `!important` remains;
- visual/accessibility matrix passes all principal screens at 320/375/480px;
- CSS/bundle size and deleted rule/reference proof are recorded;
- no redesign, copy change or product feature is bundled.

## Review evidence

Fresh no-context visual/a11y review score ≥9; record final global selector audit,
all gates, commit/push and full TMA test rollout.
