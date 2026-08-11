# TD-003 — Static quality gates and dead-export detection

- Status: `planned`
- Priority: P1
- Effort: M (2–4 days)
- Risk: medium
- Dependencies: TD-001
- Primary files: root/backend manifests, lint/format configs, targeted source
- Migration: not needed

## Evidence and problem

There are no mandatory lint, format, frontend type-check or dead-import/export
scripts. Backend TypeScript is strict but does not enable unused checks.
Frontend JavaScript has no static contract beyond Vite parsing. Large refactors
can leave unused files, stale dependency arrays and accidental browser globals.

## Scope

Add minimal maintained gates for React hooks, imports, dangerous globals,
format verification and unused tracked modules. Prefer check-only adoption with
small allowlists/ratchets; do not bulk-format the repository or mix thousands
of unrelated whitespace changes with semantic fixes.

## TDD/ratchet plan

1. Capture current violations by rule and file.
2. Turn on correctness rules first: hooks, no-undef, duplicate imports,
   unreachable code, unsafe promise handling where supported.
3. Add a repository-specific rule/script that fails on new imports of
   `supabaseClient` after TD-006/007 and on newly orphaned runtime files.
4. Enable backend unused checks only after proving generated/decorator patterns
   are not false positives.
5. Record every temporary allowlist with owner task and removal condition.

## Acceptance criteria

- Stable `lint`, `format:check` and dead-code/import commands exist.
- Gates report actionable file/line output and do not rewrite during checks.
- No blanket `eslint-disable`, ignored source directory or lowered TypeScript
  strictness.
- Root/backend existing tests and builds pass.

## Do not change

Runtime behavior, design, API schemas, SQL or infrastructure/CI.

## Independent review gate

Reviewer checks rule value, false-negative exclusions, dependency size and that
no mass formatting obscures behavior changes.

## Completion evidence

- Baseline violations / final allowlist:
- Gates/tests/build:
- Review score/findings:
- Commit/push/deployment:
