# TD-004 — Establish Playwright inventory and fixture safety baseline

- Status: `planned`
- Priority: P1
- Effort: M (1–2 days)
- Risk: low-medium
- Dependencies: TD-001, TD-002, TD-003
- Primary files: Playwright config, test-title inventory, one minimal shared
  cleanup/route helper and its self-test
- Migration: not needed

## Evidence and problem

Current large specs include approximately: backend match lifecycle 5.7k lines,
backend session lifecycle 2.7k, Telegram login 1.6k and booking availability
1.1k. Many tests import source modules inside browser context, replace globals
and store state under `window.__backend*`. Default high worker counts have
produced resource timeout flakes; controlled four-worker runs are stable.

## Scope

Record an executable title/count/feature matrix, fix the official worker budget
at the proven stable value and establish one minimal cleanup/route helper with a
self-test. Do not split a large spec here; TD-004a–TD-004d own those files.

## TDD/characterization plan

1. Record exact current test titles/count and enabled/disabled feature matrix.
2. Freeze the supported iPhone/WebKit project and explicit worker budget.
3. Add one helper contract proving routes/globals/pages/roots are disposed.
4. Prove traces/screenshots remain available on failure.
5. Store the exact title inventory for later split parity checks.

## Acceptance criteria

- One official `npm.cmd run test:e2e` is stable on the documented worker budget.
- No test assertion/product behavior is lost; test title inventory is mapped.
- Baseline helper has a bounded API and no credential/global leakage.
- Existing spec files/test assertions are otherwise unchanged.

## Do not change

Production source except testability seams separately reviewed; no product
features or broad snapshot assertions.

## Independent review gate

Reviewer checks inventory completeness, worker determinism and fixture isolation.
Score ≥9; test/config-only deployment impact is recorded factually.

## Completion evidence

- Before/after title map and duration:
- E2E/build:
- Review score/findings:
- Commit/push/deployment: normally `not_needed`
