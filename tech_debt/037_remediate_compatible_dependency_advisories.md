# TD-037 — Remediate compatible root dependency advisories

- Status: `planned`
- Priority: P1
- Effort: M (1–2 days)
- Risk: medium build/test risk
- Dependencies: TD-001
- Primary files: root `package.json`, `package-lock.json`, dependency/audit gates
- Migration: not needed

## Evidence and problem

TD-001's read-only `npm audit --json` found existing non-Vite advisories in
PostCSS, Nano ID and Babel dependency paths. They are development/toolchain
dependencies, but path/source-map advisories should not stay hidden behind the
new test stack. Compatible patch/minor resolutions must be separated from the
Vite major migration in TD-037a.

## TDD/characterization plan

1. Store exact audit packages/advisory IDs and `npm ls` paths without copying
   environment data or registry credentials.
2. Prove root build, unit/coverage, Playwright and CSS output before changes.
3. Apply the smallest compatible direct/transitive resolutions; use `overrides`
   only with exact compatibility proof and an owner comment.
4. Re-run audit and assert no critical/high advisory remains outside the
   explicitly deferred Vite/esbuild major-upgrade path.

## Acceptance criteria

- PostCSS/Nano ID/Babel advisory paths are resolved without `--force`.
- Lockfile is reproducible with `npm ci`; root gates and CSS/bundle behavior pass.
- No application/runtime feature, schema, provider or infrastructure change.
- Remaining Vite/esbuild advisories are exact inputs to TD-037a, not suppressed.

## Review evidence

Fresh no-context dependency/security review score ≥9; record audit before/after,
all gates, exact candidate/closure commits and dependency deployment gate.
