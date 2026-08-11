# TD-020 — Consolidate root/global CSS cascade and semantic tokens

- Status: `planned`
- Priority: P2
- Effort: M (1–3 days)
- Risk: high visual risk
- Dependencies: TD-019
- Primary files: `src/index.css` (~1,406 lines), component inline styles
- Migration: not needed

## Evidence and problem

The global stylesheet contains repeated root/overflow rules and conflicting
theme compatibility blocks whose result depends on source order. This task
only establishes a truthful root cascade and semantic token source. Component,
modal and screen isolation is handled by TD-020a–TD-020d.

## Characterization before changes

At 375px and 480px capture computed root/body/application styles for splash,
auth and the primary shell. Assert safe-area bottom, focus-visible, reduced
motion, no horizontal overflow and scroll restoration.

## Slices

1. Consolidate root/body/scroll ownership and semantic dark tokens.
2. Remove contradictory compatibility blocks with computed-style parity.
3. Replace only root/shell raw colors with semantically equivalent tokens.
4. Leave modal/component/screen rules for TD-020a–TD-020d.

## Acceptance criteria

- One token source and no contradictory theme compatibility blocks.
- Root/shell cascade has one explicit owner and documented layer/order.
- Measured visual delta is zero unless a pre-existing bug is separately
  documented and approved.
- Bundle/build warnings and root CSS size are recorded before/after.

## Independent review gate

Reviewer compares root/shell screenshots/computed styles and mobile overflow.
Score ≥9; full TMA visual smoke and frontend rollout required.
