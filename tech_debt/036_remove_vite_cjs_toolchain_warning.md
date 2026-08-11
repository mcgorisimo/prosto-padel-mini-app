# TD-036 — Remove deprecated Vite CJS Node API usage

- Status: `planned`
- Priority: P2
- Effort: S–M (1–2 days)
- Risk: medium build/tooling risk
- Dependencies: TD-001, TD-021
- Primary files: root package/config/scripts and build/test launcher contracts
- Migration: not needed

## Evidence and problem

The current production build emits Vite's deprecated CJS Node API warning.
`vite.config.js` is ESM syntax while the root package has no explicit module
type, and custom test/build launchers may still load Vite through CJS. Leaving
the warning hides future real warnings and creates an upgrade cliff.

## TDD/characterization plan

1. Capture the exact warning and identify its caller with diagnostic output;
   do not assume the config filename is the only cause.
2. Characterize dev/build/preview and Playwright web-server commands, config
   values, environment loading, asset paths and production bundle output.
3. Convert the smallest boundary to supported ESM APIs/config naming; avoid a
   repository-wide module-format migration unless separately split/reviewed.
4. Add a gate that fails if the deprecated CJS warning returns while preserving
   other warnings as visible output.

## Acceptance criteria

- Root build/test launchers use supported Vite Node APIs and emit no CJS warning.
- Dev/preview host, port, base, env and production asset behavior remain exact.
- No broad dependency upgrade or CI/deployment-infrastructure work is bundled.
- Manifest/lock/config impact follows the full AGENTS dependency/runtime gate.

## Review evidence

Fresh no-context toolchain review score ≥9; record warning before/after, all
gates, exact candidate/closure commits and deployment result/deferral.
