# TD-001 — Frontend unit/coverage characterization harness

- Status: `review`
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

- Baseline SHA: `2ae6d4f64eeb628dfa5cd8849aba9c69cf0346f8`
- RED evidence: `npm.cmd run test:unit` exited `1` with `Missing script:
  "test:unit"` before the runner/config/dependencies existed.
- Focused/unit/coverage: `npm.cmd run test:unit` PASS, 7 files / 24 tests.
  `npm.cmd run test:coverage` PASS, 7 files / 24 tests;
  baseline ratchet is statements `51`, branches `85`, functions `66`, lines
  `51` over the four characterized production helpers. `npm.cmd ci` PASS.
- Root E2E/build: default 9-worker E2E reproduced the known resource issue
  (`81 passed / 1 skipped / 10 timeouts`); the documented controlled full run
  `npm.cmd run test:e2e -- --workers=4` PASS (`91 passed / 1 skipped`). Root
  build PASS, 1,618 modules; existing Vite CJS/large-chunk warnings remain.
- Dependency/security evidence: exact Vitest `3.2.4` was rejected after audit
  exposed its critical advisory; final Vitest/coverage `3.2.7` removes all
  critical audit findings. The five pre-existing toolchain findings (`1 low / 1
  moderate / 3 high`) are not suppressed or force-fixed and are bounded in
  TD-037/TD-037a.
- Review score/findings: first review of `1b222a35...` scored `9.1/10` with no
  P0/P1 and one bounded P2: cleanup lacked a cross-test leak regression. Added
  a sequential portal/root, timer, fetch/crypto/env/storage isolation probe;
  second review of `09764ea4...` scored `9.4/10`, confirmed the fix and found no
  P0/P1 plus one bounded docs P2: compatible dependency patches were needlessly
  blocked by late TD-036. TD-037 now depends only on TD-001; final exact-SHA
  review of `73b1e276...` scored `9.3/10`, found no P0/P1 and noted the README
  row still appeared after TD-036 despite dependency-driven execution. TD-037
  is now also ordered before TD-036; final acceptance review is pending.
- Commit/push: pending local candidate commit; not pushed.
- Deployment impact decision: pending. Manifest/lockfile changes trigger the
  AGENTS dependency gate even when dependencies are dev-only; record the actual
  built image/bundle impact and either roll out the exact commit or obtain an
  explicit owner deferral.
