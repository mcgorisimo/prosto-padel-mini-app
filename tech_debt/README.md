# Technical debt execution register

This directory is the execution source of truth for maintainability work that
does **not** add a new product capability. Every numbered Markdown file is one
bounded task with its own tests, independent review, commit and deployment
decision.

## Scope boundary

Included:

- removal of proven unreachable or unreferenced legacy code;
- decomposition of god-components, large clients, services and repositories;
- characterization tests and TDD refactoring;
- frontend/backend coverage and static-quality gates;
- reduction of duplicated validation, transport, state and error mapping;
- source-of-truth and tracked-document cleanup;
- bundle/code-splitting work after component boundaries are stable.

Explicitly excluded from this register:

- Yandex Cloud, Selectel, Docker/Compose, Kubernetes, networking, DNS, TLS,
  secret delivery, monitoring, CI/CD and deployment automation;
- Managed PostgreSQL, PgBouncer, connection budgets, backups, restore, HA,
  readiness, load infrastructure and capacity configuration;
- D4 payments/ЮKassa, D5 verification/compliance, native iOS/Android work;
- new product flows such as match cancellation, participant removal,
  private/public conversion or a backend training domain;
- app-originated YCLIENTS cancellation/reschedule (club administrator only);
- schema migrations without a separate proposal, review and owner approval;
- changes to `paymentStatus`, `ownerPaid`, `holdAmount`, `prepay`.

Global/IP/multi-replica rate limiting is also outside this register because its
correctness depends on trusted-proxy identity and shared infrastructure state.
Account-scoped authorization and existing request budgets remain mandatory
invariants inside each affected application task; a new global rate-limit
policy requires a separate security/infrastructure decision.

If a refactor reveals a missing product or infrastructure capability, record it
as an external blocker in the current task; do not silently expand scope.

## Mandatory workflow for every task

1. Confirm clean `main`, exact `origin/main`, latest `WORKLOG` and deployed test
   commit.
2. Change the task status from `planned` to `in_progress` and record the exact
   baseline SHA.
3. Add or strengthen characterization tests first. The new regression must fail
   for the intended reason before implementation whenever a meaningful red
   phase is possible.
4. Refactor in small slices. Preserve API payloads, error codes, domain
   invariants, accessible names, UI design and provider-write policy.
5. Run the focused tests after every slice.
6. Run repository gates:
   - root: `npm.cmd run test:e2e`, `npm.cmd run build`;
   - backend diff: additionally `npm.cmd run typecheck`, `npm.cmd run test:unit`,
     `npm.cmd run test:e2e`, `npm.cmd run build` in `backend/`;
   - every applicable repository ratchet established by completed prerequisite
     tasks, never only the original AGENTS commands. This explicitly includes
     root unit/coverage after TD-001, lint/format/dead-export gates after TD-003,
     backend coverage after TD-032, protected real-PostgreSQL lanes after
     TD-029/030 for affected repositories, contract-generation drift after
     TD-034, encoding verification after TD-035 and the Vite warning gate after
     TD-036, dependency-audit gates after TD-037/037a, plus any focused command
     introduced by the current task.
   Record `not_applicable` with a concrete scope reason for a gate that does not
   apply; never silently omit a completed prerequisite's mandatory command.
7. Create one local candidate implementation commit with the task in `review`.
   It contains code/tests and pre-delivery test evidence, but is not pushed yet.
8. Start a fresh **no-context** review sub-agent. Give it only the repository
   path, baseline SHA, exact candidate SHA, task file and the instruction to
   inspect independently. It must report P0/P1/P2 and a score from 1 to 10.
9. Fix all P0/P1 and bounded P2, rerun gates, squash/amend the local candidate,
   and repeat with a fresh reviewer until there are no P0/P1 and score is ≥9.
   The final candidate SHA is immutable: any later runtime or test-source byte
   change invalidates review and returns to this step.
10. Push the exact reviewed candidate and apply the `AGENTS.md` deployment gate.
    Runtime changes require that exact candidate on Selectel test with health,
    business smoke and logs, unless the owner explicitly defers. Production is
    never changed without a direct instruction.
11. Mark `done` last in one **docs-only closure commit** limited to the task file,
    `README.md` status and `docs/launch/WORKLOG.md`. Store baseline/candidate
    SHAs, exact reviewer prompt, agent/task identifier and verbatim report,
    gates, push and deployment/deferral evidence. Push this closure commit.
    The closure may not change runtime/test/config/dependency bytes and has
    `deployment: not_needed` because the reviewed candidate was already handled.

Thus each task has one reviewed implementation commit and one auditable docs-
only closure commit. A genuinely docs-only task may use a single reviewed
closure commit when no runtime/test/config/dependency artifact exists.

## Status vocabulary

- `planned` — documented, not started;
- `in_progress` — implementation is active on one task only;
- `review` — implementation complete, independent review is running;
- `delivery` — exact reviewed candidate is being pushed/deployed;
- `blocked` — an explicit external decision is required;
- `done` — tests, review, commit/push and deployment decision are recorded.

At most one numbered task may be `in_progress`, `review` or `delivery` at a
time. Tasks may be split before implementation, but two tasks must never edit
the same god-file concurrently.

## Ordered backlog

| Order | Task | Priority | Depends on | Status |
|---:|---|---|---|---|
| 001 | Frontend unit/coverage characterization harness | P1 | — | done |
| 002 | Root React error boundary and sanitized recovery | P0 | 001 | done |
| 003 | Static quality gates and dead-export detection | P1 | 001 | planned |
| 004 | Establish Playwright inventory and fixture safety baseline | P1 | 001, 002, 003 | planned |
| 004a | Split backend match lifecycle Playwright spec | P1 | 004 | planned |
| 004b | Split backend session lifecycle Playwright spec | P1 | 004a | planned |
| 004c | Split Telegram login Playwright spec | P1 | 004b | planned |
| 004d | Split booking Playwright specs and close decomposition | P1 | 004c | planned |
| 005 | Remove proven unreferenced frontend modules | P1 | 003, 004d | planned |
| 006 | Remove Supabase-era profile/auth frontend boundary | P1 | 002–005 | planned |
| 007 | Remove legacy match feed/realtime mode | P1 | 006 | planned |
| 007a | Remove legacy invitations/notifications | P1 | 007 | planned |
| 007b | Remove legacy chat/waitlist/lineup/result | P1 | 007a | planned |
| 007c | Remove legacy match mutations and Supabase facade | P1 | 007b | planned |
| 008 | Remove demo bots and local rating truth from production | P1 | 007c | planned |
| 009 | Remove inert backend shell modules and CRM placeholders | P2 | 003 | planned |
| 010 | Remove unreachable D2 controlled-write/cancel foundation | P1 | 003, 009 | planned |
| 032 | Establish backend coverage baseline/ratchet | P1 | 003 | planned |
| 029 | Real-PostgreSQL match owner/concurrency baseline | P0 | 032 | planned |
| 030 | Real-PostgreSQL reservation invariant baseline | P0 | 032 | planned |
| 011 | Extract shared frontend backend transport and auth/profile codecs | P1 | 001, 006 | planned |
| 011a | Extract match feed/detail/invitation client codecs | P1 | 011, 007a | planned |
| 011b | Extract chat/waitlist/notification client codecs | P1 | 011a, 007b | planned |
| 011c | Extract lineup/result/admin client codecs and compose facade | P1 | 011b, 007c | planned |
| 011d | Migrate Telegram login to shared frontend transport | P1 | 011c | planned |
| 011e | Migrate booking clients to shared frontend transport | P1 | 011d | planned |
| 012 | Decompose Telegram backend login lifecycle and React binding | P1 | 001, 011c, 011d | planned |
| 013 | Replace ad-hoc App navigation with a pure reducer | P1 | 007c, 012 | planned |
| 014 | Extract App match feed/account/detail store | P1 | 013 | planned |
| 014a | Extract App reservation/court store | P1 | 014 | planned |
| 014b | Extract App invitation/notification store | P1 | 014a | planned |
| 014c | Extract App chat store and finish composition root | P1 | 014b | planned |
| 015 | Build visibility-aware polling scheduler primitive | P1 | 014c | planned |
| 015a | Migrate notification polling to shared scheduler | P1 | 014b, 015 | planned |
| 019 | Create one accessible modal/sheet primitive | P1 | 001, 002 | planned |
| 016 | Extract MatchDetails chat controller | P1 | 007c, 014c, 015, 019 | planned |
| 015b | Migrate chat polling to shared scheduler | P1 | 015, 016 | planned |
| 016a | Extract MatchDetails invitation controller | P1 | 015b, 016 | planned |
| 016b | Extract MatchDetails waitlist controller | P1 | 016a | planned |
| 015c | Migrate waitlist polling to shared scheduler | P1 | 015, 016b | planned |
| 016c | Extract MatchDetails lineup controller | P1 | 015c, 016b | planned |
| 015d | Migrate lineup polling to shared scheduler | P1 | 015, 016c | planned |
| 016d | Extract MatchDetails result controller | P1 | 015d, 016c | planned |
| 015e | Migrate result polling and close polling ownership | P1 | 015, 016d | planned |
| 016e | Finish MatchDetails presenter/modal decomposition | P1 | 015e, 016d, 019 | planned |
| 017 | Extract Booking availability workflow | P1 | 011e, 014c, 019 | planned |
| 017a | Extract Booking create/recovery/link workflow | P1 | 017 | planned |
| 017b | Extract Booking detail and finish presenter | P1 | 017a | planned |
| 018 | Extract profile photo controller | P2 | 014c, 019 | planned |
| 018a | Finish profile/settings presenter decomposition | P2 | 018 | planned |
| 020 | Consolidate root/global CSS cascade and tokens | P2 | 019 | planned |
| 020a | Isolate shared primitive/modal CSS | P2 | 020 | planned |
| 020b | Isolate match-detail CSS | P2 | 016e, 020a | planned |
| 020c | Isolate booking/profile CSS | P2 | 017b, 018a, 020b | planned |
| 020d | Isolate remaining screen CSS and close global debt | P2 | 020c | planned |
| 021 | Add route-level lazy loading and shrink the main chunk | P2 | 013, 016e, 017b, 018a, 020d | planned |
| 022 | Extract backend `MatchesModule` from `AuthModule` | P1 | 009, 010, 029, 030, 032 | planned |
| 023 | Decompose backend `MatchApiService` | P1 | 022, 029 | planned |
| 024 | Extract pure codecs from `PostgresMatchRepository` | P1 | 022, 023, 029 | planned |
| 025 | Standardize invitation repository codecs | P2 | 024 | planned |
| 025a | Standardize chat/notification repository codecs | P2 | 025 | planned |
| 025b | Standardize waitlist/lineup repository codecs | P2 | 025a | planned |
| 025c | Standardize result/reservation repository codecs | P2 | 025b, 030 | planned |
| 026 | Split session credential persistence mapping from SQL | P2 | 025, 032 | planned |
| 027 | Introduce narrow booking orchestration ports | P1 | 022, 030 | planned |
| 028 | Add one bounded shared YCLIENTS HTTP transport | P1 | 010, 027 | planned |
| 028a | Bound Telegram Bot API response bodies | P1 | 032 | planned |
| 031 | Consolidate strict HTTP parsing and public error taxonomy | P1 | 022–030, 028a | planned |
| 034 | Generate contract foundation for profile/session | P2 | 011c, 031–032 | planned |
| 034a | Generate match feed/detail/mutation contracts | P2 | 034 | planned |
| 034b | Generate invitation contracts | P2 | 034a | planned |
| 034c | Generate chat/notification contracts | P2 | 034b | planned |
| 034d | Generate waitlist contracts | P2 | 034c | planned |
| 034e | Generate lineup contracts | P2 | 034d | planned |
| 034f | Generate result contracts | P2 | 034e | planned |
| 034g | Generate booking contracts and remove manual frontend schemas | P2 | 034f | planned |
| 037 | Remediate compatible root dependency advisories | P1 | 001 | planned |
| 036 | Remove deprecated Vite CJS Node API usage | P2 | 001, 021 | planned |
| 037a | Upgrade the Vite security boundary | P1 | 036, 037 | planned |
| 035 | Repair source-of-truth docs and add encoding verification | P2 | all prior tasks | planned |

The table order is the execution order; IDs remain grouped by original debt
area. Tests and analyzers precede deletion/refactoring. Real-PostgreSQL and
coverage baselines precede high-risk backend changes. Typed contracts come only
after backend modules stop moving.

## Global invariants

- Backend/PostgreSQL remains the only application data runtime.
- Telegram backend session/profile remains the only TMA auth gate.
- Private bookings never enter the public match feed.
- A match may exist without a court; a court reservation is a separate entity.
- YCLIENTS is authoritative for availability and reservation existence.
- No blind external-write retry; unknown outcomes remain recoverable.
- Cancellation and reschedule stay administrator-only in YCLIENTS.
- Owner/account scoping, idempotency keys, version checks and PII redaction are
  preserved.
- Existing design and accessible text do not change unless the task explicitly
  documents a truthful replacement for legacy/demo behavior.
