# TD-037a — Upgrade the Vite security boundary

- Status: `planned`
- Priority: P1
- Effort: M (2–3 days)
- Risk: high build/dev-server risk
- Dependencies: TD-036, TD-037
- Primary files: Vite/React plugin dependencies, config, scripts, lockfile and
  build/dev/preview security tests
- Migration: not needed

## Evidence and problem

The current Vite 5 line is affected by path traversal/dev-server advisories and
an esbuild advisory; npm reports no compatible fix without a Vite major upgrade.
This is source/toolchain security work, not infrastructure design.

## TDD/characterization plan

- freeze build assets/base/env replacement and Playwright web-server startup;
- add loopback-only dev/preview and filesystem-deny regression where supported;
- upgrade Vite and the React plugin to one officially compatible supported set;
- verify Node engines in developer and existing container build contexts without
  changing cloud/container topology;
- run `npm ci`, unit/coverage, build, complete Playwright and bounded audit.

## Acceptance criteria

- Vite/esbuild high/moderate advisory paths are absent; no audit suppression.
- Dev/preview stay loopback by default and cannot serve denied workspace paths.
- Production bundle behavior/design and Telegram/YCLIENTS/backend contracts exact.
- Manifest/lock/container-image impact follows full test rollout; production is
  untouched without explicit owner instruction.

## Review evidence

Fresh no-context toolchain/security review score ≥9; record advisories, engine/
bundle parity, all gates, exact candidate/closure commits and rollout evidence.
