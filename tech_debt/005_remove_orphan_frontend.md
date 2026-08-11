# TD-005 — Remove proven unreferenced frontend modules

- Status: `planned`
- Priority: P1
- Effort: S–M (1–2 days)
- Risk: low
- Dependencies: TD-003, TD-004d
- Primary files: proven orphan candidates under `src/`, their exclusive tests/
  styles and the TD-003 import/dead-export inventory
- Migration: not needed

## Evidence and candidates

Static search currently finds no runtime/test imports for old standalone auth
screens, `AddPlayerModal`, `MatchConfirmationModal`, `MatchList`, `StatsRow`,
`useLocalStorage` and related obsolete schemas. `BookingCalendar`/`BookingModal`
form an isolated dead pair. Tracked zero-byte `src/TrainingModal.jsx` is also a
candidate. Candidate names must be re-proven at execution time; similarly named
`src/components/TrainingModal.jsx` is live and must not be confused with it.

## TDD plan

1. RED/guard: add an import-graph/dead-entry assertion from TD-003 and freeze
   login → feed → detail → join → chat → private booking E2E smoke.
2. For each candidate, use `rg` and build graph to prove zero consumers,
   including dynamic imports, tests, CSS selectors and documentation links.
3. Delete in small groups; build and focused smoke after every group.
4. Remove only comments/schema entries that refer exclusively to deleted code.

## Acceptance criteria

- Every deleted file has written zero-consumer evidence.
- Production bundle, visible screens and E2E behavior are unchanged.
- No barrel/dynamic import points at deleted modules.
- Git diff contains deletion/related cleanup only.

## Explicit exclusions

Do not delete live `src/components/TrainingModal.jsx`, `testSeed.js` (TD-008),
Supabase facade (TD-006/007), historical migrations or ignored local Telegram
bot files. Zero-byte `src/TrainingModal.jsx` may be deleted only after the same
tracked/dynamic import proof as every other candidate.

## Independent review gate

Reviewer independently rebuilds the import graph and searches each deleted
basename. Target score ≥9 with no P0/P1.

## Completion evidence

- Deleted files and proof:
- Tests/build/bundle comparison:
- Review score/findings:
- Commit/push/deployment:
