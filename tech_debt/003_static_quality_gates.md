# TD-003 — Static quality gates and dead-export detection

- Status: `review`
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

- Baseline SHA: `0e2f1fa1d7a7c67059981398c9e8d685a02b2549` (clean pushed
  TD-002 closure). Root had 83 tracked `.js`/`.jsx` files under
  `src/tests/scripts`; backend has 360 tracked TypeScript files under
  `backend/src`. Neither manifest currently declares ESLint, Prettier, Knip or
  an equivalent static gate; no lint/format/dead-code configuration exists.
- Tooling is pinned to the newest releases compatible with the repository's
  Node `20.11.0` container baseline: ESLint `9.39.5`, Prettier `3.9.6`, Knip
  `5.88.1` and TypeScript `5.9.3`. ESLint 10 and Knip 6 were not selected
  because their engines require a newer Node 20 minor. The root-only tools are
  dev dependencies.
- ESLint checks 98 root and operational backend JavaScript/JSX/config files.
  The measured legacy set is
  exactly 105 issues in 45 files: `no-unused-vars=70`,
  `react-hooks/exhaustive-deps=21`, `no-empty=11`, `no-control-regex=2` and
  `react-hooks/rules-of-hooks=1`. Each violating file and the ESLint config are
  pinned by SHA-256; a new or edited violating file fails with normal
  file/line diagnostics. No source directory or rule is blanket-disabled.
- Prettier checks 485 root/backend source, test, manifest and config files.
  There are 391 legacy nonconforming files. Each is pinned independently by
  path and content SHA-256 rather than ignored, so editing one requires
  formatting it or an explicit reviewed baseline update. No bulk-format diff
  was made. Repository text is normalized to LF before hashing and formatting,
  so the same Git blob has the same baseline on Windows and Linux; this removed
  20 historical findings caused only by checkout EOL while adding the two
  previously uncovered backend runner modules.
- Knip reports 16 unused files, unused exports in 38 files and unused exported
  types in 70 files; it reports zero dependency, unlisted dependency, binary or
  duplicate findings. Six E2E files contain legitimate Vite-root browser
  imports that Knip cannot resolve; their exact findings are pinned instead of
  using a blanket `ignoreUnresolved`. Its normalized issue-set digest is pinned
  without byte offsets, which vary with checkout EOL; semantic file, symbol,
  line and column data remain part of the digest.
- Seven legacy `supabaseClient` import occurrences in five files are separately
  ratcheted across every tracked/nonignored JS/TS module extension, including
  root configs and backend runners. Multiplicity and statically computed string
  imports are preserved, so additions fail; removal belongs to TD-006/TD-007.
  Ten local bot-prototype files under `src/` are not tracked by Git and are
  already in `.gitignore`; only Knip needs their exact filesystem exclusions.
  TD-010 owns removing those exclusions after the prototypes are deleted or
  moved outside the application workspace.
- Backend `noUnusedLocals` and `noUnusedParameters` are enabled without lowering
  strictness. The initial compiler probe found 25 issues; all were reduced to
  zero by removing unused imports/constants and prefixing two intentionally
  unused test callback parameters. No runtime expression was changed.
- Backend operational `.mjs`/`.cjs` runners are included in ESLint, Prettier and
  the backend Knip workspace. `@nestjs/schematics` is a direct dev dependency
  because `backend/nest-cli.json` directly names it as its collection; relying
  on the current `@nestjs/cli` transitive tree would leave an undeclared direct
  build-tool contract. Production dependency count remains unchanged.
- TDD: the new ratchet unit was RED while its helper did not exist, then GREEN.
  It covers immutable legacy hashes, new/edited violations, order-independent
  issue-set digests and static/dynamic restricted imports.
- Gates/tests/build: clean root/backend `npm ci`; `lint`, `format:check` and
  `dead-code:check` PASS; root unit `9 files / 35 tests`; coverage PASS at
  `56.89/86.86/71.05/56.89`; controlled root E2E `94 passed / 1 skipped`;
  root build PASS (`1619` modules). Backend typecheck PASS, unit
  `138 suites / 3366 tests`, E2E `2 suites / 4 tests`, and build PASS.
  `git diff --check` PASS. Existing Vite CJS/large-chunk and transitive
  deprecation warnings remain outside this task.
- Review score/findings: first fresh no-context review task
  `/root/td003_review_1` inspected exact range `0e2f1fa...bd8dbcc`, scored
  `7/10` and failed it with one P1 and three bounded P2 findings. Reviewer prompt
  was read-only inspection of the exact range for rule value, false negatives,
  ratchets, import scope/multiplicity, Node 20.11 compatibility, dependency
  size, backend cleanup, evidence accuracy and P0/P1/P2 score. It found import
  occurrence deduplication/incomplete extensions, broad unresolved suppression,
  undocumented local-file exclusions and the stale `39`-file Knip count. The
  correction adds RED/GREEN multiplicity, computed-import and extension tests,
  scans all tracked JS/TS variants, removes broad unresolved suppression,
  narrows/documents the local-only Knip exclusion and corrects the count to
  `38`. Second fresh no-context review task `/root/td003_review_2` inspected
  exact range `0e2f1fa...621c615`, found no P0/P1, but scored `8.8/10` and failed
  on one bounded P2: comments between `from` and a specifier plus static template
  interpolation could evade the regex. RED regressions now cover both forms;
  the interim bounded static-string parser handled those cases. Third fresh
  no-context review task `/root/td003_review_3` inspected exact range
  `0e2f1fa...1e89509`, scored `6.8/10` / FAIL with one P1 and two P2. It proved
  that any token-blind parser remained unsafe around comments, strings, dynamic
  import options and parentheses inside literals; it also found mixed
  browser/Node ESLint globals and corrected the baseline inventory from 93 to
  83. The scanner now uses the TypeScript AST/compiler API and the ESLint scopes
  are split. Fourth fresh no-context review task `/root/td003_review_4` inspected
  exact range `0e2f1fa...3adc17a`, scored `6.3/10` / FAIL with one P1 and three
  bounded P2 findings: checkout-EOL-dependent hashes/Knip byte offsets, two
  uncovered backend runner modules, unwrapped TypeScript/CommonJS static import
  forms, and stale candidate state. Text hashing is now LF-canonical, Knip omits
  only byte offsets, both runners are covered by all three gates, and focused
  regressions cover `as`/`satisfies`/type assertions plus parenthesized and
  `module.require`. Fifth fresh no-context review task `/root/td003_review_5`
  inspected exact range `0e2f1fa...fbbc498`, scored `8.0/10` / FAIL with one P1
  and two P2 findings: `(module).require` and locally shadowed CommonJS symbols,
  TypeScript import-type nodes, and the five-commit candidate history. The
  scanner now uses TypeScript symbol resolution to reject local shadows while
  recognizing global/ambient CommonJS calls, unwraps the receiver and covers
  import-type plus element-access forms. All unpublished TD-003 commits are
  squashed into the single candidate required by the workflow before the next
  exact-SHA review. Sixth fresh no-context review task `/root/td003_review_6`
  inspected the single exact candidate `0e2f1fa...d199a0b`, found no P0/P1 but
  scored `8.8/10` / FAIL for one P2: a changed Knip digest emitted only a generic
  follow-up command. The failure path now prints deterministic current findings
  with paths and available line/column/category before throwing; its formatter
  has a focused regression. Seventh fresh no-context review task
  `/root/td003_review_7` inspected exact `0e2f1fa...20896ab`, again found no
  P0/P1 but scored `8.8/10` / FAIL for one P2: the formatter handled nested
  `enumMembers` but not Knip's analogous `classMembers`. Diagnostic formatting
  is now generic for every array category and every nested parent/member map;
  focused evidence covers both member categories. A new exact-SHA review remains
  required. Eighth fresh no-context review task `/root/td003_review_8` inspected
  exact `0e2f1fa...928bebc`, found no P0/P1 but scored `8.2/10` / FAIL for two
  P2 findings: Knip `duplicates` is an array of symbol arrays, and tracked
  `playwright.config.js` was missing from Prettier inventory. Diagnostic
  traversal is now recursive across nested arrays/maps with per-symbol
  locations, and the Playwright config is a sticky legacy format finding. A new
  exact-SHA review remains required.
- Candidate state is `review`; exact correction SHA is supplied by the Git
  review request. Push/deployment remain pending a passing fresh no-context
  review and the mandatory Selectel test rollout because dependency manifests
  and backend build inputs changed. DB/schema, migrations, YCLIENTS, payments
  and production are unchanged.
