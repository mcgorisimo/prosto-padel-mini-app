# TD-001 — Frontend unit/coverage characterization harness

- Status: `planned`
- Priority: P1
- Effort: M (2–3 days)
- Risk: medium
- Dependencies: none
- Primary files: `package.json`, new root test config/setup, new `src/**/*.test.*`
- Migration: not needed

## Evidence and problem

The root package has only Playwright E2E and build scripts. Five browser specs
contain more than 11k lines and mix pure validator tests, component harnesses,
HTTP contract tests and real UI flows. There is no fast unit runner, DOM
component runner or coverage report. Refactoring pure reducers/validators today
requires expensive browser imports and global `window.__*` harnesses.

## Scope

Introduce a minimal React-compatible unit test stack (prefer Vitest + jsdom +
Testing Library unless repository constraints prove another smaller option).
Provide deterministic fake timers, fetch/crypto helpers and cleanup. Add
scripts for focused unit tests and coverage. Do not migrate the entire E2E
suite in this task.

## TDD plan

1. RED: add tests for existing exported pure functions from
   `backendMatchAdapter.js`, `backendBookingHomeAdapter.js`,
   `paidCourtCheckout.js` and `moscowDateTime.js`; prove the runner initially
   does not exist.
2. GREEN: configure the runner and make those unchanged production modules pass.
3. Add one React smoke proving render, user interaction, effect cleanup and
   portal cleanup work in jsdom.
4. Add coverage scoped to files touched by unit tests. Start with a documented
   baseline; require 100% branch coverage for every newly extracted pure module
   rather than imposing an arbitrary whole-legacy threshold.

## Acceptance criteria

- `npm.cmd run test:unit` and `npm.cmd run test:coverage` are deterministic.
- No production branch or bundle dependency on test libraries.
- Fake timers and globals are restored after every test.
- Existing Playwright count/behavior and production build remain unchanged.
- README/AGENTS commands are updated only with factual new gates.

## Do not change

API requests, Telegram session storage, UI design, routing, payment fields,
YCLIENTS behavior or backend code.

## Independent review gate

Reviewer must inspect isolation, coverage exclusions, global cleanup and whether
the chosen dependencies are the minimum required. Target: no P0/P1, score ≥9.

## Completion evidence

- Baseline SHA:
- RED evidence:
- Focused/unit/coverage:
- Root E2E/build:
- Review score/findings:
- Commit/push:
- Deployment impact decision: pending. Manifest/lockfile changes trigger the
  AGENTS dependency gate even when dependencies are dev-only; record the actual
  built image/bundle impact and either roll out the exact commit or obtain an
  explicit owner deferral.
