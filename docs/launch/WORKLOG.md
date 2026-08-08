# Launch sprint — рабочий журнал

Обновлять после каждого завершённого или заблокированного этапа. Записывать
только проверенные факты: commit, тесты, migration status, внешние блокеры и
следующий конкретный шаг.

## Базовое состояние — 2026-08-06

- Ветка на момент создания журнала: `main`.
- Commit: `f1abe74`.
- Worktree: clean.
- Целевая инфраструктура подтверждена пользователем: Selectel only.
- В production source ещё присутствуют Supabase import/runtime branches.
- Root dependency ещё содержит `@supabase/supabase-js`.
- Native iOS/Android project отсутствует.
- Последняя проверка до создания плана:
  - frontend build: PASS;
  - frontend E2E: BLOCKED отсутствующими staging Supabase env, тест должен быть заменён backend staging E2E;
  - backend typecheck: PASS;
  - backend unit: PASS, 108 suites / 2843 tests;
  - backend E2E: PASS, 2 suites / 4 tests;
  - backend build: PASS.

## Статус этапов

| Этап | Статус | Ветка/commit | Проверки | Блокер/следующий шаг |
|---|---|---|---|---|
| D1 Backend-only/contracts | done | `main` / deployed `c04074459948d0bf545e865b885aea7a4e5fec3c` | frontend E2E PASS (82/1 skipped); focused fail-closed 2/2 PASS; frontend build PASS; backend all PASS; Selectel test smoke PASS | D1 закрыт; следующий отдельный этап — D2 |
| D2 YCLIENTS reservation core | in_progress | `main` / Selectel test `fa5eb38c6608d07c0140f39467dfebe3a058862b` | migration 033 applied/verified; backend/frontend runtime healthy; automated gates PASS; fresh-create business smoke STOP | newest strict provider create still failed local finalization: `confirm_binding/storage_failure` and fallback `storage_failure`, leaving pending/unbound/held; do not delete/retry; next gate is code-only diagnostic correction review |
| D3 Match ↔ reservation lifecycle | pending | — | — | reflect admin cancellation without provider DELETE, owner participant removal, match ↔ reservation binding |
| D4 Payment Core | pending | — | — | payment provider, pricing/payment snapshot, чеки и возвраты |
| D5 Settings/moderation/compliance | pending | — | — | standalone phone/email auth, verified backend email, approved club support/contact source and clickable action; затем schema review |
| D6 Selectel readiness/load | pending | — | — | backend staging fixture, live concurrency и Selectel production readiness |
| D7 Release candidate | pending | — | — | после D1–D6 |
| Mobile/store track | pending | — | — | developer account status и native decision |

Статусы: `pending`, `in_progress`, `blocked`, `done`, `reopened`.

## Deployment status

| Этап | Среда | Целевой commit | Статус | Проверка |
|---|---|---|---|---|
| D1 Backend-only/contracts | Selectel test | `c04074459948d0bf545e865b885aea7a4e5fec3c` | `test_deployed` | frontend healthy; HTTPS root/health и новый asset 200; TMA auth/profile/feed/details/booking availability PASS; bundle/log audit PASS |
| D2 YCLIENTS reservation core | Selectel test | `fa5eb38c6608d07c0140f39467dfebe3a058862b` | `business_smoke_failed` | infrastructure/health/log gates PASS, but new create remained pending/unbound after provider success; admin delete/Home refresh smoke must not proceed until a reviewed correction is rolled out |
| D2 persistence/privacy proposal | not applicable | docs-only checkpoint | `not_needed` | только Markdown; runtime, schema, containers и конфигурация не менялись |
| D2 YCLIENTS contract matrix | not applicable | docs-only checkpoint поверх `3e8739b` | `not_needed` | только Markdown; API/DB/server/runtime не вызывались и не менялись |
| D2 YCLIENTS controlled test plan | not applicable | `040773172a2fa556ffaaf1d12dac540095070976` + docs-only correction from that exact base | `not_needed` | plan only; provider/server/DB/runtime calls и writes не выполнялись |
| D2 YCLIENTS read foundation | not applicable | correction `7fedddd5daf2e817aa977509ab120879915a8f26` + live-contract correction from that exact base | `not_needed` | code не импортирован Nest modules/controllers/runtime; image, config, server и containers не менялись |

Допустимые deployment-статусы: `not_needed`, `pending`, `test_deployed`,
`production_deployed`, `deployment_deferred_by_user`.

## Активные внешние блокеры

Это входы последующих этапов, а не незавершённая работа D1.

1. YCLIENTS availability/preflight/create и exact/bounded read contracts уже
   подтверждены. App-originated reschedule/cancel отсутствуют; webhook disabled.
   Declared booking contact contract одобрен, verification перенесена в D5.
   Перед rollout нужны approved bounded operator lookup для `unknown` create и
   provisioning root-only snapshot key; support/contact source is
   `deferred_to_D5_by_owner` and is not a D2 rollout blocker. Provider
   `api_id` uniqueness не предполагается и provider write не retry-ится.
2. Не подтверждён платёжный провайдер, sandbox и фискальные настройки.
3. Не записаны фактические Selectel resources/accesses для staging/production.
4. Не известны тип и дата создания Google Play developer account.
5. Не известен статус Apple Developer account.

Секретные значения сюда не записывать. Указывать только наличие, назначение и
место безопасного хранения.

## Журнал решений

| Дата | Решение | Причина | Последствия |
|---|---|---|---|
| 2026-08-06 | Selectel only; Supabase удалить полностью | прямое решение владельца продукта | backend/PostgreSQL становятся единственным runtime-контуром |
| 2026-08-06 | Match, reservation и payment разделены | нельзя выводить финансовую/CRM истину из `scenario` | нужны явные связи и state machines |
| 2026-08-06 | Один плательщик в первом MVP | снизить риск возвратов и недобора | split payments отложены |
| 2026-08-06 | Недельная цель — launch candidate, не гарантированная публикация stores | внешнее ревью и Google 14-day rule не контролируются кодом | store track запускается параллельно |
| 2026-08-06 | Реальный YCLIENTS test rollout подтвердил availability/preflight/create | company `2079564`, server secret-файлы, права, resource mapping, bearer boundary и write guard проверены; бронь появилась в YCLIENTS | create больше не внешний блокер; D2 можно начинать с локального reservation/operation domain, webhook остаётся выключенным |
| 2026-08-06 | Owner видит собственный полный client snapshot; `club_admin` после backend role/permission check видит полный snapshot без masking/reveal | явное privacy-решение владельца | чужие players доступа не имеют; decrypt только на backend; каждый admin read требует security audit event без PII |
| 2026-08-06 | D2 persistence/privacy contract и весь proposal checklist одобрены; SQL и contract tests разрешены только для review | явное решение владельца продукта | migration 033 можно подготовить, но нельзя применять; runtime wiring и Selectel rollout требуют нового отдельного одобрения |
| 2026-08-06 | Официальный YCLIENTS contract допускает code-only exact get/bounded list/rate limiter, но не доказывает provider idempotency или webhook authenticity | read-only provider checkpoint | write adapter/runtime остаются gated controlled tests; webhook выключен, unknown write не повторяется вслепую |
| 2026-08-06 | Customer-facing cancellation policy — 24 часа; внутренний refundable grace включает интервал до `23:30:00` включительно | финальное решение владельца продукта | сравнение `startsAt - cancellationRequestedAt` выполняется по UTC instants; меньше `23:30:00` — late/no refund; late cancellation всё равно требует canonical YCLIENTS cancel proof для освобождения корта; D4 решает/исполняет refund и хранит policy/version snapshot, D2 payment fields не меняет |

### 2026-08-06 — D1 / backend-only inventory и production boundary

- Задача/ветка: `codex/week1-backend-only`.
- Commit: checkpoint `aa5cd86489f4d8a5cc757990212b3c2ced7630d8`
  (`refactor: make TMA backend-only`); на момент checkpoint D1 был `in_progress`.
- Изменённые файлы: auth/runtime boundary, frontend E2E contour, package manifests,
  test Docker config и launch docs; точный список передаётся через `git status`.
- Реализовано:
  - зафиксирована таблица `runtime call → backend replacement → test`;
  - зафиксирован external access gate без значений секретов;
  - backend Telegram session/profile стали единственным production TMA gate;
  - email/password legacy auth UI удалён, disabled backend mode fail-closed;
  - в backend mode прекращены legacy match read/realtime paths;
  - Supabase SDK, transitive dependencies, Vite keys и test-container args удалены;
  - Supabase-bound mock/live specs и service-role fixture удалены из runnable
    contour; staging замена не создавалась без утверждённого fixture contract.
- Migration: schema не менялась. Reservation structure зафиксирована только для
  review; SQL migration не создана и не одобрена.
- Tests:
  - frontend E2E: PASS, 82 passed / 1 skipped;
  - frontend focused disabled-mode E2E: PASS, 1 test;
  - frontend focused invalid-feature-setting E2E: PASS, 1 test;
  - frontend build: PASS, 1615 modules;
  - backend typecheck: PASS;
  - backend unit: PASS, 108 suites / 2843 tests;
  - backend E2E: PASS, 2 suites / 4 tests;
  - backend build: PASS.
- Ручная проверка: `npm ls @supabase/supabase-js --all` пуст; в production
  bundle/package/infra/E2E env отсутствуют `@supabase/supabase-js` и
  `VITE_SUPABASE_*`; root dependencies `package-lock.json` совпадают с
  `package.json`; `git diff --check` PASS; значения секретов не читались и не
  записывались.
- E2E handoff: удалённые auth/match/chat/invitation/waitlist/profile/booking
  сценарии сопоставлены существующим backend contract suites в
  `D1_BACKEND_ONLY_INVENTORY.md`; добавлены минимальные проверки fail-closed
  legacy boundary до network и bearer join rejection mapping без legacy fallback.
- Известные риски:
  - недостижимые legacy source branches и fail-closed boundary ещё находятся в
    bundle до поэтапного удаления consumers;
  - backend booking create не сохраняет local reservation/match binding;
  - backend-owned verified email contract отсутствует, поэтому production
    booking validation не должна подставлять synthetic email.
- Внешний блокер: для YCLIENTS остаются get/lookup, reschedule, cancel, provider
  idempotency, unknown-outcome reconciliation, webhook verification и rate limits;
  отдельно не подтверждены payment provider, Selectel resources и backend
  staging seed/assert/cleanup.
- Для продолжения нужны:
  - по YCLIENTS только подтверждённые get/lookup, reschedule, cancel, provider
    idempotency, unknown-outcome reconciliation, webhook verification и rate-limit
    contracts; company, credentials, availability/preflight/create и resource
    mapping повторно не запрашивать;
  - выбранный payment provider, sandbox/production доступы, two-stage payment,
    webhook verification, receipt/VAT/accounting и cancel/refund policy;
  - Selectel project/roles, staging/production PostgreSQL, private network,
    pooler/SSL/DNS/TLS, S3 bucket/access, secret storage, deploy/registry и alerts;
  - утверждённый backend staging deterministic seed/assert/cleanup contract и
    отдельное явное одобрение любой migration.
- Следующий конкретный шаг: после review начать только code-only D2 reservation
  domain/state machine/ports с unit tests, без controller wiring и реальных
  YCLIENTS writes. Reservation migration сначала вынести на отдельное явное
  одобрение; схему пока не менять.

### 2026-08-06 — D1 / корректировка YCLIENTS test rollout

- Задача/ветка: `codex/week1-backend-only`; только read-only анализ и launch docs.
- Подтверждено владельцем продукта по реальному test rollout:
  - company ID `2079564`;
  - Partner/User credentials и права работают из server-side secret-файлов;
  - услуги, корты, даты, свободные слоты и resource mapping читаются;
  - preflight/create, bearer boundary и write guard работают;
  - бронь из Mini App появилась в YCLIENTS.
- Текущий код подтверждает наличие availability/preflight/create и fail-closed
  write guards. Provider get/lookup, reschedule, cancel и reconciliation worker
  отсутствуют; deterministic `api_id` не доказывает provider idempotency.
- Webhook: выключен; verification contract отсутствует, новых callback/write
  операций в этом анализе не выполнялось.
- Migration: `structure proposed for review only`; SQL не создавался, схема не
  менялась и migration не применялась.
- Tests: runtime не менялся, полный набор не перезапускался; документационный
  diff проверяется через `git diff --check`.
- Следующий безопасный slice: code-only reservation types/state machine/repository
  и provider ports с unit tests для same-key/digest и `unknown`, без production
  wiring. SQL, webhook и реальные provider writes не входят в slice.

### 2026-08-06 — D1 / closure review

- Задача/ветка: `codex/week1-backend-only`.
- Checkpoint: `aa5cd86489f4d8a5cc757990212b3c2ced7630d8`.
- Статус: D1 `done`. Последующие gaps назначены D2–D6/mobile и не являются
  незавершённой кодовой работой D1. Обязательный deployment gate выполнен на
  Selectel test для commit `c04074459948d0bf545e865b885aea7a4e5fec3c`.
- Независимый read-only review:
  - auth/session: P0/P1/P2 нет; backend session + backend-owned profile остаются
    единственным production TMA gate, disabled/invalid configuration fail-closed;
  - dependency/infra: P0/P1/P2 нет; SDK/transitive dependencies и production
    Supabase network/config markers отсутствуют, secrets остаются server-side;
  - E2E: P0/P1 нет; удалены три legacy spec и один service-role helper,
    критические auth/profile/match/chat/invitation/waitlist/notification/booking
    сценарии сопоставлены backend-contract suites.
- P2 handoff:
  - D2: local reservation binding, get/lookup, unknown/idempotency,
    reschedule/cancel/reconciliation/webhook и точные booking edge cases;
  - D3: cancel match, owner participant removal, match ↔ reservation;
  - D4: payment provider, pricing/payment snapshot, чеки и возвраты;
  - D5/mobile: standalone phone/email auth и verified backend email; текущий
    production booking submit не подставляет synthetic email и остаётся
    fail-closed до backend-owned verified email;
  - D6: backend staging seed/assert/cleanup, live PostgreSQL persistence/security,
    concurrent last-slot join и Selectel production readiness.
- Migration: `structure proposed for review only`; schema не менялась, SQL не
  создавался и migration не применялась.
- Tests:
  - frontend E2E: PASS, 82 passed / 1 skipped;
  - frontend focused disabled setting: PASS, 1 test;
  - frontend focused invalid setting: PASS, 1 test;
  - frontend build: PASS, 1615 modules;
  - backend typecheck: PASS;
  - backend unit: PASS, 108 suites / 2843 tests;
  - backend E2E: PASS, 2 suites / 4 tests;
  - backend build: PASS.
- Dependency/bundle: `npm.cmd ls @supabase/supabase-js --all` вернул `(empty)`;
  root manifest соответствует lockfile; в `dist` нет `@supabase/supabase-js`,
  `VITE_SUPABASE_*`, `supabase.co`, `/rest/v1` и `/auth/v1`.
- Проверки не читали и не выводили значения секретов. Webhook не включался,
  внешние writes не выполнялись. Payment-поля и schema не менялись.
- Следующий конкретный шаг: запускать отдельный этап D2 YCLIENTS reservation core.

### 2026-08-06 — D1 / Selectel test rollout

- Задача/ветка: финальный deployment gate D1 на `main`.
- Deployed commit: `c04074459948d0bf545e865b885aea7a4e5fec3c`, detached HEAD.
- Git integration: `merged_main` / `pushed_main`.
- Deployment: `test_deployed`; production не менялся.
- Containers changed: пересобран и пересоздан только frontend:
  - old container `7ac08cdaa1f4…`, old image `sha256:e461d25f4015…`;
  - new container `efee81b73ca4…`, new image `sha256:45044ab7b891…`,
    состояние `running/healthy`;
  - backend, nginx и PostgreSQL сохранили прежние container/image IDs и не
    пересоздавались; restart count всех контейнеров — 0.
- Health/HTTP: HTTPS root 200, HTTPS health 200, новый asset
  `/assets/index-D3-4N8r0.js` 200 (`578212` bytes).
- Bundle/config audit: отсутствуют Supabase SDK, `VITE_SUPABASE_*` и Supabase
  network URL; backend auth enabled; YCLIENTS API/write enabled без изменений;
  webhook disabled.
- Business smoke: Mini App открытие, backend login, профиль, лента, детали матча
  и booking availability — PASS. Реальная бронь в этом smoke не создавалась.
- Log audit: новых `5xx`, `error`, `fatal` и `unhandled` нет.
- Migration/config: schema, `.env.test`, database/payment configuration не
  менялись. Этот последующий WORKLOG update является docs-only и имеет
  deployment status `not_needed`.
- Статус: D1 `done`; следующий отдельный этап — D2.

### 2026-08-06 — D2 / code-only reservation domain checkpoint

- Задача/ветка: `codex/week1-d2-reservation-core`.
- Commit: D2 checkpoint в текущем branch head; push/merge не выполнялись.
- Изменённые файлы:
  - `backend/src/reservations/reservation.types.ts`;
  - `backend/src/reservations/reservation-request-digest.ts`;
  - `backend/src/reservations/reservation.state-machine.ts`;
  - `backend/src/reservations/reservation.state-machine.spec.ts`;
  - `backend/src/reservations/reservation-provider.port.ts`;
  - `backend/src/database/court-reservation.repository.ts`;
  - `docs/launch/WORKLOG.md`.
- Реализовано:
  - отдельные `CourtReservation` и `ReservationOperation` entities/types;
  - независимая state machine create/reschedule/cancel с terminal outcomes;
  - детерминированный length-prefixed SHA-256 request digest;
  - same key + same digest возвращает прежнюю operation, другой digest
    отклоняется;
  - uncertain write переходит в `unknown`; provider port разделяет initial
    write и reconciliation и не принимает `unknown` в повторный write;
  - `cancel_pending` и `unknown` сохраняют занятость слота;
  - repository/provider ports добавлены без production implementation/wiring.
- Migration: `not needed`; SQL/schema не создавались и не менялись.
- Tests:
  - frontend E2E: PASS, 82 passed / 1 skipped;
  - frontend build: PASS, 1615 modules;
  - backend typecheck: PASS;
  - backend unit: PASS, 109 suites / 2853 tests;
  - backend E2E: PASS, 2 suites / 4 tests;
  - backend build: PASS.
- Ручная проверка: focused reservation unit suite PASS, 10/10; `git diff
  --check` PASS; SQL, controllers, modules, env/secrets, webhook, App.jsx,
  payment-поля и существующий YCLIENTS write path не менялись.
- Read-only P0/P1 review: последующий correction review нашёл ownership scope,
  provider payload и calendar validation gaps; исправления зафиксированы ниже.
- Известные риски: это только code-only domain; состояния ещё не сохраняются и
  не влияют на runtime booking flow.
- Внешний блокер: остаются подтверждённые YCLIENTS get/lookup, reschedule,
  cancel, provider idempotency/search, timeout reconciliation, webhook
  verification/dedupe/order и rate-limit contracts; webhook выключен.
- Следующий конкретный шаг: отдельно согласовать persistence contract/migration,
  затем реализовать production repository/provider/orchestration wiring и
  выполнить Selectel test rollout точного integrated commit.
- Git integration: `committed`; push/merge не выполнялись по явной команде.
- Deployment: `pending`; D2 нельзя отмечать `done` до
  integration в `main`, Selectel test rollout, health, business smoke и log audit.
- Deployed environment/commit: D2 не deployed; Selectel test остаётся на D1
  commit `c04074459948d0bf545e865b885aea7a4e5fec3c`.
- Containers changed: none.
- Health/HTTP: не запускались без D2 rollout; последний D1 test gate PASS.
- Business smoke: не запускался без D2 rollout; реальные YCLIENTS writes в D2
  checkpoint не выполнялись.
- Log audit: не запускался без D2 rollout.

### 2026-08-06 — D2 / reservation domain correction checkpoint

- Задача/ветка: `codex/week1-d2-reservation-core`.
- Commits: первый checkpoint `c47c24506743d579ed9cfadc8ad658a0f768f93f`
  сохранён без изменения; correction checkpoint — текущий branch head после этой
  записи. Push/merge не выполнялись.
- Изменённые файлы: reservation types/digest/state machine/provider port/unit
  tests, repository port и `docs/launch/WORKLOG.md`.
- Реализовано:
  - `CourtReservation` и `ReservationOperation` привязаны к `ownerAccountId`,
    start/transition — к `actorAccountId`;
  - repository lookup/start/transition явно account-scoped, idempotency scope —
    `(ownerAccountId, idempotencyKey)`;
  - existing-operation retry проверяет owner, reservation, operation/request
    type, key и сохранённый digest до возврата прежней operation;
  - provider write/reconciliation commands содержат полный immutable snapshot:
    `apiId`, target, client phone/fullName/email и текущий YCLIENTS binding для
    reschedule/cancel; PII не логируется;
  - request digest покрывает owner, external reference, client snapshot и все
    target-поля внешнего эффекта;
  - ISO datetime validation выровнена с YCLIENTS calendar-date round trip и
    отклоняет невозможные даты.
- Migration: `not needed` для correction checkpoint; schema/SQL не менялись.
  Будущее хранение client snapshot и privacy/retention contract является только
  proposal и требует отдельного review/явного одобрения до любой migration.
- Tests:
  - frontend E2E: PASS, 82 passed / 1 skipped;
  - frontend build: PASS, 1615 modules;
  - backend typecheck: PASS;
  - backend unit: PASS, 109 suites / 2869 tests;
  - backend E2E: PASS, 2 suites / 4 tests;
  - backend build: PASS.
- Ручная проверка: focused reservation suite PASS, 26/26; `git diff --check`
  PASS; scope guard подтверждает отсутствие schema/migrations, controllers,
  modules, runtime YCLIENTS changes, webhook/env/secrets, App.jsx и payment-полей.
- Read-only P0/P1 review: обязательные P1 замечания correction pass закрыты;
  новых P0/P1 в diff не найдено.
- Известные риски: code-only ports/entities ещё не имеют persistence, privacy
  retention policy и runtime orchestration.
- Внешний блокер: остаются подтверждённые YCLIENTS get/lookup, reschedule,
  cancel, provider idempotency/search, timeout reconciliation, webhook
  verification/dedupe/order и rate-limit contracts; webhook выключен.
- Следующий конкретный шаг: отдельно согласовать persistence/privacy contract и
  migration proposal, затем production repository/provider/orchestration wiring,
  integration в `main` и Selectel test rollout точного commit.
- Git integration: correction checkpoint `committed`; push/merge не выполнялись.
- Deployment: `pending`; D2 остаётся `in_progress` до Selectel test rollout,
  health, business smoke и log audit.
- Deployed environment/commit: D2 не deployed; Selectel test остаётся на D1
  commit `c04074459948d0bf545e865b885aea7a4e5fec3c`.
- Containers changed: none.
- Health/HTTP: не запускались без D2 rollout; последний D1 test gate PASS.
- Business smoke: не запускался без D2 rollout; реальные YCLIENTS writes в
  correction pass не выполнялись.
- Log audit: не запускался без D2 rollout.

### 2026-08-06 — D2 / persistence/privacy/migration proposal

- Задача/ветка: `codex/week1-d2-reservation-core`.
- Commit: отдельный docs-only checkpoint в текущем branch head; push/merge не
  выполнялись.
- Изменённые файлы:
  - `docs/launch/D2_RESERVATION_PERSISTENCE_PROPOSAL.md`;
  - `docs/launch/WORKLOG.md`.
- Подготовлено к явному решению владельца:
  - поля reservation, operation и отдельного encrypted client snapshot;
  - account-scoped ownership/idempotency, active-operation/slot-hold/provider
    binding constraints и admin lookup indexes;
  - рекомендованное для Selectel application-layer AEAD хранение PII с отдельным
    keyed digest и ключами вне БД;
  - atomic repository transaction contract, reconciliation и zero-downtime
    migration/rollback order;
  - approval checklist и граница неподтверждённых YCLIENTS contracts.
- Migration: только `proposal_for_explicit_approval`; SQL/migration не создавались,
  schema не менялась. Подготовка и применение SQL требуют отдельных явных команд.
- Tests: frontend/backend suites и builds `not run / not needed`, потому что diff
  docs-only и не меняет исполняемый код, зависимости или конфигурацию.
- Ручная проверка: `git diff --check` PASS; scope guard подтверждает только два
  Markdown-файла.
- Read-only P0/P1 review: новых P0/P1 в docs diff не найдено.
- Следующий конкретный шаг: владелец принимает решения из approval checklist;
  после одобрения отдельным этапом можно готовить review-only SQL и persistence
  contract tests. Runtime wiring остаётся отдельной работой.
- Внешний блокер: YCLIENTS get/lookup, reschedule, cancel, provider
  idempotency/search, timeout reconciliation и webhook verification/dedupe/order/
  rate limits ещё не подтверждены; webhook выключен.
- Git integration: docs-only checkpoint `committed`; push/merge не выполнялись.
- Deployment этого checkpoint: `not_needed`, потому что изменена только
  документация. Общий deployment status D2 остаётся `pending`, D2 —
  `in_progress`.
- Deployed environment/commit: Selectel test остаётся на D1 commit
  `c04074459948d0bf545e865b885aea7a4e5fec3c`.
- Containers changed: none.
- Health/HTTP, business smoke, log audit: `not run / not needed` для docs-only
  checkpoint; последний D1 test gate PASS.

### 2026-08-06 — D2 / approved client snapshot access model

- Задача/ветка: `codex/week1-d2-reservation-core`.
- Commit: отдельный docs-only checkpoint в текущем branch head; push/merge не
  выполнялись.
- Изменённые файлы: `docs/launch/D2_RESERVATION_PERSISTENCE_PROPOSAL.md` и
  `docs/launch/WORKLOG.md`.
- Одобрено владельцем:
  - owner видит собственные полные `fullName`, `phone`, `email`;
  - `club_admin` получает полный decrypted snapshot после backend role/permission
    check, без masking и отдельного reveal;
  - другие players не получают чужие client data;
  - decrypt выполняется только backend; каждый admin read fail-closed создаёт
    audit event с actor, operation/reservation, timestamp и purpose/endpoint без
    копии PII; PII/ciphertext/keys исключены из logs/errors/traces.
- Approval status: закрыт только access-control пункт. Остальной persistence/
  privacy/migration checklist не считается одобренным.
- Migration: `proposal_for_explicit_approval`; SQL/migration не создавались,
  schema/runtime не менялись.
- Tests: `not run / not needed`, потому что diff docs-only.
- Ручная проверка: `git diff --check` PASS; изменены только два Markdown-файла.
- Git integration: docs-only checkpoint `committed`; push/merge не выполнялись.
- Deployment: `not_needed` для docs-only checkpoint; общий D2 остаётся
  `in_progress` с deployment status `pending`.
- Deployed environment/commit: Selectel test остаётся на D1 commit
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; containers не менялись,
  health/smoke/log checks для этого docs-only checkpoint не нужны.

### 2026-08-06 — D2 / approved persistence migration prepared for review

- Задача/ветка: `codex/week1-d2-reservation-core`.
- Предыдущий docs-only checkpoint admin-access decision: `b1e33b1`; текущий
  checkpoint — отдельный branch head после этой записи. Push/merge не
  выполнялись.
- Изменённые файлы:
  - migration 033 SQL, PRECHECK, POSTCHECK, guarded ROLLBACK и README;
  - `backend/src/database/backend-reservation-persistence-migration.spec.ts`;
  - `docs/launch/D2_RESERVATION_PERSISTENCE_PROPOSAL.md`;
  - `docs/launch/WORKLOG.md`.
- Contract: `approved`. SQL: `prepared_for_review`, `not_applied`.
- Подготовлено:
  - новый isolated `backend_reservation` schema с reservations, operations и
    AEAD-encrypted client snapshots;
  - ownership/idempotency, one-active-operation, slot-hold, optimistic version,
    reconciliation и bounded provider lookup constraints/indexes;
  - отдельный append-only admin-read audit ledger с actor,
    reservation/operation, time, purpose/endpoint и UUID correlation metadata,
    без PII/ciphertext/keys;
  - существующий auth audit ledger не переиспользован: его event/FK allowlist
    auth-specific, а его изменение запрещено границей этапа;
  - `external_api_id` server-derived contract отражён non-unique lookup index;
    uniqueness для `external_api_id`/appointment до подтверждения не заявлена.
- Migration apply: НЕ выполнялся ни локально, ни на Selectel. Schema/database
  state не менялись; backfill и реальные YCLIENTS writes не выполнялись.
- Tests:
  - focused migration contract: PASS, 1 suite / 7 tests;
  - backend typecheck: PASS;
  - backend build: `not run / not needed` — runtime source/modules не менялись,
    новый test file полностью проверен typecheck и focused Jest;
  - backend full unit/E2E и root E2E/build: `not run / not required` для
    unapplied migration artifacts + static contract test; предыдущий D2 full
    gate остаётся PASS.
- Ручная проверка: `git diff --check` PASS; scope guard подтверждает отсутствие
  изменений existing tables/endpoints/modules/controllers/runtime wiring,
  payment/match/webhook/env/App.jsx.
- Read-only P0/P1 security/concurrency/privacy review: рассинхронизация snapshot
  digest key version устранена composite FK; произвольные audit purpose/endpoint
  заменены фиксированными non-PII codes; новых P0/P1 не найдено.
- Rollback boundary: только все четыре пустые relation под ACCESS EXCLUSIVE lock;
  после первой записи rollback fail-closed, `CASCADE` отсутствует.
- Следующий конкретный шаг: review точного checkpoint. Применение migration,
  persistence/RBAC/audit runtime wiring и Selectel rollout — только после новых
  отдельных явных одобрений.
- Deployment: `pending`; D2 остаётся `in_progress`.
- Deployed environment/commit: Selectel test остаётся на D1 commit
  `c04074459948d0bf545e865b885aea7a4e5fec3c`.
- Containers changed: none.
- Health/HTTP, business smoke, log audit: не запускались, потому что migration не
  применялась и runtime/server не менялись; последний D1 test gate PASS.

### 2026-08-06 — D2 / migration 033 P1 correction

- Задача/ветка: `codex/week1-d2-reservation-core`.
- Base checkpoint: `e051494`; correction checkpoint — отдельный текущий branch
  head после этой записи. Push/merge не выполнялись.
- Изменённые файлы: migration 033 SQL/PRECHECK/POSTCHECK/ROLLBACK/README,
  migration contract spec, persistence proposal и `WORKLOG.md`.
- Исправлены P1 review findings:
  - exact-start uniqueness заменена общей `reservation_slot_holds` relation с
    GiST exclusion для пересекающихся `[start, end)` intervals разных
    reservations одного company/resource;
  - reschedule сохраняет current hold и добавляет FK-bound target hold; same
    reservation self-overlap разрешён, DB guard сверяет interval с immutable
    operation target, unknown удерживает оба;
  - client snapshot использует per-snapshot random DEK, в БД хранится только
    wrapped DEK; crypto erase удаляет wrapped material, а versioned trigger
    запрещает восстановление;
  - DB CHECK связывает create с previous `unbooked`/`rejected`, а
    reschedule/cancel — только с previous `confirmed`.
- Migration: `prepared_for_review`, `not_applied`. SQL не запускался локально и
  на Selectel; schema/database/runtime не менялись.
- Tests:
  - focused migration contract: PASS, 1 suite / 8 tests;
  - backend typecheck: PASS;
  - backend/root build и E2E: `not run / not needed`, потому что runtime source,
    modules и endpoints не менялись, migration не применялась.
- Ручная проверка: `git diff --check` PASS; scope ограничен review migration,
  static contract test и launch docs.
- Read-only P0/P1 review: interval/reschedule concurrency, per-snapshot erase и
  previous-status gaps закрыты; новых P0/P1 не найдено.
- Rollback boundary: все пять relation должны быть пусты под ACCESS EXCLUSIVE
  lock; после первой записи fail-closed, `CASCADE` отсутствует.
- Deployment: `pending`; D2 остаётся `in_progress`.
- Deployed environment/commit: Selectel test остаётся на D1 commit
  `c04074459948d0bf545e865b885aea7a4e5fec3c`.
- Containers changed: none.
- Health/HTTP, business smoke, log audit: не запускались — migration не
  применялась, runtime/server не менялись.

### 2026-08-06 — D2 / Selectel test migration 033 apply stop

- Git integration: D2 checkpoint
  `4451dddc3cf229419a9de574d9ed98a7aa6f78c9` fast-forward integrated в
  `main` и pushed; local `main` и `origin/main` совпадают, worktree чистый.
- Backup: PASS для `prosto_padel_test_migration_cycle`; опубликован root-only
  backup set `20260806T183151Z_90250559-df50-4540-a8e8-dbabbbeaa404`
  (`database.dump`, `globals.sql`, `manifest.txt`), directory mode `700`, files
  mode `600`; штатные archive/checksum/manifest guards PASS.
- PRECHECK: PASS, `ready=true`, target schema absent, canonical `btree_gist`
  GiST opclasses и foundation fingerprints подтверждены.
- Migration: `applied`, но пока не `verified`. Точный SQL commit `4451ddd`
  выполнен с `ON_ERROR_STOP=1` и завершился `COMMIT`; runtime remains
  disconnected, backfill и YCLIENTS writes отсутствуют.
- POSTCHECK: STOPPED до завершения exact validation. Read-only checker упал в
  первом trigger block: `pg_trigger.tgname` агрегируется как `name[]`, но
  сравнивается с `text[]`; тот же локальный defect есть в трёх trigger blocks.
  После ошибки дальнейшие DB commands, повторный POSTCHECK и rollback не
  выполнялись.
- Audit artifacts: exact migration files и PRECHECK/APPLY/POSTCHECK outputs
  сохранены в root-only server directory
  `/root/prosto-padel-migration-audit/033-4451ddd-20260806T183151Z`.
- Containers changed: runtime frontend/backend/nginx/PostgreSQL не
  пересобирались и не пересоздавались; backup использовал удалённый после
  завершения one-shot `db-tools` container.
- Deployment: `pending`; D2 остаётся `in_progress`. Runtime Selectel test
  продолжает работать на D1 commit
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; production не менялся.
- Health/HTTP, business smoke, log audit: после POSTCHECK error не запускались
  из-за обязательного stop rule.
- Следующий конкретный шаг: отдельным одобрением исправить только POSTCHECK
  casts/contract test, провести read-only review, затем повторить POSTCHECK.
  SQL migration повторно не применять и rollback не выполнять.

### 2026-08-06 — D2 / migration 033 POSTCHECK correction checkpoint

- Base handoff: `218e7676925fd7105fb1737b625a9d7044d7caa4`.
- Scope: изменены только POSTCHECK, migration contract spec и `WORKLOG.md`;
  migration/precheck/rollback/runtime/config не менялись.
- Correction: во всех трёх trigger checks `pg_trigger.tgname` приводится к
  `text` и детерминированно сортируется по тому же `tgname::text`, поэтому
  сравнение выполняется как `text[]` к `text[]`.
- Regression: static contract требует ровно три corrected aggregation и
  запрещает прежнюю `name[]` форму.
- Checks: focused migration contract PASS, 1 suite / 8 tests; backend typecheck
  PASS; `git diff --check` и финальный read-only scope review выполняются перед
  checkpoint commit.
- Migration status: `applied_verified` на Selectel test. Corrected read-only
  POSTCHECK вернул `ready=true`, все пять row counts `0`, exact relation
  fingerprints и `runtime_connected=false`; transaction завершилась `ROLLBACK`.
  Migration 033 повторно не применять; backup/PRECHECK/rollback и другие DB
  writes не выполнять.
- Deployment: `pending`; runtime/container/env/production не меняются.
- Git integration: correction
  `7c31d29b639d6b29016d2378ccc7006df6129b52` fast-forward integrated и pushed
  в `main` после exact three-file scope check.
- Selectel audit: server fetched exact correction commit без checkout; corrected
  POSTCHECK SHA-256 совпал с Git artifact, output сохранён root-only как
  `POSTCHECK.corrected-7c31d29.output.txt` (mode `600`).
- Containers changed: none; frontend/backend/nginx/PostgreSQL сохранили прежние
  IDs, `running/healthy`, restart count `0`. Server runtime checkout остаётся
  detached на D1 `c04074459948d0bf545e865b885aea7a4e5fec3c`.
- Следующий конкретный шаг: отдельный persistence/runtime wiring slice после
  подтверждения оставшихся YCLIENTS contracts; D2 остаётся `in_progress`.

### 2026-08-06 — D2 / YCLIENTS provider contract matrix checkpoint

- Задача/ветка: `codex/week1-d2-reservation-core`; base `main`
  `3e8739b2e9308976bccfd125883f03917fa22962`, worktree был clean.
- Изменённые файлы: `docs/launch/D2_YCLIENTS_CONTRACT_MATRIX.md` и
  `docs/launch/WORKLOG.md`.
- Read-only inventory: текущий YCLIENTS client/service реализует только
  availability/preflight/create; provider adapter — заглушка; webhook принимает
  только untrusted coalesced signal и остаётся выключенным. Секреты и provider
  resource IDs не читались и не выводились.
- Official contract evidence:
  - exact admin get и bounded record list с deleted/change-date fields
    достаточны для code-only read adapter;
  - documented rate ceiling — `200/min` или `5/sec` на один IP;
  - admin/online reschedule и cancel endpoints существуют, но provider
    idempotency/version, partial-update preservation и post-delete readback не
    заявлены;
  - `api_id` — внешний идентификатор, без documented uniqueness/filter/replay;
  - webhook отправляется один раз, без retry/history/order guarantee; signature,
    event ID/provider timestamp и source allowlist не документированы.
- Safety decision: timeout/uncertain write остаётся `unknown`; blind
  create/update/delete retry запрещён. `cancel_pending/unknown` не освобождают
  слот. Webhook — только signal после будущей source verification и canonical
  authenticated GET.
- Readiness: можно реализовать только runtime-disabled exact get, bounded list,
  safe parsers, shared limiter и fail-closed reconciliation orchestration. Write
  adapter/wiring требуют controlled tests/provider confirmation, перечисленных
  в contract matrix, и нового review.
- Migration: 033 остаётся `applied_verified` на Selectel test, все пять таблиц
  пусты и runtime disconnected; SQL/PRECHECK/POSTCHECK/rollback не запускались.
- Tests: `not run / not needed` — diff docs-only, runtime/test source не менялся.
  Выполняется только `git diff --check`.
- Read-only P0/P1 review: P0 gate — webhook нельзя включать без подтверждённой
  аутентичности источника; P1 gates — не заявлять uniqueness `api_id`, не делать
  blind write retry, не переносить через incomplete payload и не освобождать слот
  без canonical cancel proof. Новых runtime изменений нет.
- Git integration: отдельный docs-only checkpoint commit; push/merge не
  выполняются.
- Deployment: `not_needed` для docs-only checkpoint; общий D2 остаётся
  `in_progress` с deployment `pending`.
- Deployed environment/commit: Selectel test runtime остаётся detached на D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; migration schema отдельно
  `applied_verified`, runtime к ней не подключён.
- Containers changed: none.
- Health/HTTP, business smoke, log audit: `not run / not needed` — server/runtime
  не менялись и YCLIENTS calls не выполнялись; последний D1 test gate остаётся
  PASS.
- Следующий конкретный шаг: review contract matrix; repository/provider wiring
  до итогового review не начинать.

### 2026-08-06 — D2 / YCLIENTS controlled test plan checkpoint

- Задача/ветка: `codex/week1-d2-reservation-core`; base matrix checkpoint
  `46bc35c7b6be5848bb5556b14eaee6fa33a20c2e`, исходный worktree clean.
- Изменённые файлы: `docs/launch/D2_YCLIENTS_CONTROLLED_TEST_PLAN.md` и
  `docs/launch/WORKLOG.md`.
- Plan only:
  - basic lifecycle использует disposable server-side identity, slots `A/B`,
    availability/preflight → create → exact/list visibility → full-payload
    cross-resource reschedule с `save_if_busy=false` → GET effect → cancel →
    exact/list deleted proof → repeat-delete;
  - basic budget максимум 14 requests, строго не чаще 1 request/second;
  - optional same-`api_id` duplicate-create изолирован в отдельный run/slots
    `C/D`, допускает максимум две disposable records и 12 requests;
  - timeout/429/5xx/invalid/ambiguous outcome немедленно даёт `unknown`, blind
    retries запрещены, slot release без canonical cancel proof запрещён;
  - root-only audit layout и allowlisted PII/secret-free evidence/cleanup
    procedure зафиксированы.
- Approval gate: перед basic нужен отдельный явный approval на create/reschedule/
  cancel/repeat-delete writes; optional duplicate experiment требует второго
  независимого approval с принятием риска двух записей. Текущий docs prompt не
  разрешает выполнение ни одного плана.
- Migration: 033 остаётся `applied_verified` на Selectel test, runtime
  disconnected; migration/PRECHECK/POSTCHECK/rollback не запускались.
- Tests: `not run / not needed` — изменены только Markdown, runtime и test source
  не менялись. Выполняется `git diff --check`.
- Read-only P0/P1 review: production/webhook/PII/blind-retry risks ограничены
  prerequisites, separate approvals и stop rules; request budgets, serialized
  rate, full reschedule payload и cancel proof закрывают concurrency/effect gaps.
  Provider semantics могут остаться `unknown`, что является предусмотренным
  terminal stop outcome плана.
- Git integration: отдельный docs-only checkpoint commit; push/merge не
  выполняются.
- Deployment: `not_needed` для docs-only checkpoint; общий D2 остаётся
  `in_progress` с deployment `pending`.
- Deployed environment/commit: Selectel test runtime остаётся detached на D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; schema 033 отдельно
  `applied_verified`, runtime к ней не подключён.
- Containers changed: none.
- Health/HTTP, business smoke, log audit: `not run / not needed` — server/runtime
  не менялись и YCLIENTS/API/DB/server calls не выполнялись.
- Следующий конкретный шаг: owner review и отдельное решение по basic lifecycle;
  optional duplicate experiment не разрешается basic approval. До решения
  repository/provider wiring не начинать.

### 2026-08-06 — D2 / controlled test plan unknown-write correction

- Задача/ветка: `codex/week1-d2-reservation-core`; exact reviewed plan base
  `040773172a2fa556ffaaf1d12dac540095070976`, matrix base
  `46bc35c7b6be5848bb5556b14eaee6fa33a20c2e`, исходный worktree clean.
- Correction commit: отдельный commit, содержащий эту запись; его exact SHA
  фиксируется Git handoff после создания commit (собственный SHA нельзя
  встроить в содержимое того же commit без дополнительного metadata commit).
- Изменены только `docs/launch/D2_YCLIENTS_CONTROLLED_TEST_PLAN.md` и
  `docs/launch/WORKLOG.md`; прежняя checkpoint history не переписывалась.
- Исправлено:
  - uncertain create шага 5 запрещает дальнейшие writes и допускает только один
    bounded read шага 7; без record ID шаг 6 пропускается;
  - uncertain reschedule шага 8 допускает только exact read шага 9, сохраняет
    holds `A+B` и запрещает cancel/repeat-delete;
  - uncertain first cancel шага 10 допускает только read-only шаги 11–12 и
    запрещает repeat-delete даже при найденном cancel proof;
  - uncertain repeat-delete шага 13 допускает только финальный read шага 14;
  - normal и contingency paths остаются внутри hard budget 14, без retries,
    расширения list window/page или undocumented cleanup writes;
  - optional duplicate-`api_id` run также прекращает cleanup writes после
    uncertain write и требует нового approval для cleanup.
- PASS/cleanup/approval: Basic PASS возможен только на normal path без uncertain
  write; bounded readback может завершиться безопасным terminal `unknown` из-за
  undocumented consistency. Отдельные approvals basic и optional сохраняются.
- Tests: `not run / not needed` — diff docs-only, runtime и test source не
  менялись. Выполняется `git diff --check`.
- Read-only P0/P1 review: blind write retry и дальнейшие writes после uncertain
  outcome запрещены; recovery ограничен заранее перечисленными read-only
  запросами и исходным hard budget. Открытых P0/P1 в correction diff не найдено.
- Migration: 033 остаётся `applied_verified`; migration/DB/YCLIENTS/API/server
  calls, PRECHECK/POSTCHECK/rollback и provider writes не выполнялись.
- Git integration: отдельный docs-only commit; push/merge не выполняются.
- Deployment: `not_needed` для docs-only correction; общий D2 остаётся
  `in_progress` с deployment `pending`.
- Deployed environment/commit: Selectel test runtime остаётся detached на D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`, runtime к migration 033 не
  подключён; production не менялся.
- Containers changed: none.
- Health/HTTP, business smoke, log audit: `not run / not needed` — runtime/server
  не менялись и внешние calls отсутствовали.
- Следующий конкретный шаг: независимый review correction commit; только после
  отдельного approval можно выполнять basic lifecycle. Optional duplicate
  experiment по-прежнему требует второго независимого approval.

### 2026-08-06 — D2 / runtime-disabled YCLIENTS read foundation

- Задача/ветка: `codex/week1-d2-reservation-core`; exact reviewed base
  `a08de13c95e7cf67ff272942f484d2e3d3ebd988`, исходный worktree clean.
- Commit: отдельный локальный checkpoint, содержащий эту запись; exact SHA
  фиксируется Git handoff после commit. Push/merge не выполняются.
- Изменённые файлы: standalone YCLIENTS admin read client, conservative request
  limiter, read-only reconciliation primitives и их mocked unit/contract specs;
  `D2_RESERVATION_PERSISTENCE_PROPOSAL.md` и этот WORKLOG.
- Реализовано:
  - typed exact admin GET и один явно bounded list page с узкими documented
    filters, строгими page/count/date caps и без заявления lookup-by-`api_id`;
  - fail-closed parser возвращает только allowlisted effect fields, не выдаёт
    raw provider body, client PII или record hash;
  - безопасная классификация `unauthorized`, documented exact `not_found`,
    `rejected`, `rate_limited`, `unavailable`, `unknown` без автоматических
    retries;
  - shared limiter сериализует запросы и по умолчанию ограничивает их одним в
    секунду и 60 в минуту, то есть строже обоих provider ceilings;
  - exact known-record readback и one-page local candidate scan не выполняют
    initial write/fallback; zero, multiple и effect mismatch остаются `unknown`.
- Runtime boundary: новые файлы не импортированы в Nest module/controller или
  application runtime. PUT/DELETE/create runner, provider writes и duplicate
  experiment не реализованы.
- Cancellation decision: customer-facing правило остаётся «за 24 часа»;
  внутренний grace считает refundable при
  `startsAt - cancellationRequestedAt >= 23h30m`, включая ровно `23:30:00`.
  Сравнение — по UTC instants, display — timezone клуба. Late cancellation не
  запускает refund, но должна отменить provider record и освободить корт только
  после canonical cancel proof. Refund и policy/version snapshot принадлежат D4;
  D2 не меняет `paymentStatus`, `ownerPaid`, `holdAmount`, `prepay`.
- Migration: 033 остаётся `applied_verified` на Selectel test; runtime
  disconnected. Migration/DB/PRECHECK/POSTCHECK/rollback не запускались.
- Tests:
  - focused backend unit/contract: PASS, 3 suites / 76 tests;
  - backend typecheck: PASS;
  - backend unit: PASS, 113 suites / 2953 tests;
  - backend E2E: PASS, 2 suites / 4 tests;
  - backend build: PASS;
  - root build: PASS, 1615 modules; только штатное chunk-size warning;
  - root E2E: FAIL, 61 passed / 1 skipped / 21 failed; параллельный и повторный
    `--workers=1` прогоны одинаково получили `outside_telegram` во всех 21
    session/login failures. Frontend/auth/runtime source этим checkpoint не
    изменялся; failure зафиксирован как существующий harness/config blocker, а
    не скрыт и не исправлялся расширением D2 scope.
- Read-only P0/P1 review: реальные network/provider calls недостижимы без
  отдельного явного construction и runtime wiring; auth header не возвращается
  и не логируется; parser/result allowlist исключает PII/hash; readback не делает
  blind write retry, list fallback или дополнительную page; открытых P0/P1 в
  checkpoint diff не найдено.
- Внешние calls/writes: YCLIENTS/API/DB/server calls, provider writes и чтение
  secrets/env не выполнялись.
- Git integration: локальный checkpoint commit; push/merge/deploy запрещены и не
  выполняются.
- Deployment: `not_needed` для checkpoint — code существует, но не импортирован
  и недостижим из runtime; общий D2 остаётся `in_progress` с deployment
  `pending`.
- Deployed environment/commit: Selectel test runtime остаётся detached на D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; schema 033 отдельно
  `applied_verified`, runtime к ней не подключён; production не менялся.
- Containers changed: none.
- Health/HTTP, business smoke, log audit: `not run / not needed` — server,
  runtime и containers не менялись, внешние provider calls отсутствовали.
- Следующий конкретный шаг: независимый review read foundation; PUT/DELETE и
  executable controlled write runner не начинать до отдельного решения по
  безопасному provider contract/test gate.

### 2026-08-06 — D2 / YCLIENTS read foundation P1 correction

- Задача/ветка: `codex/week1-d2-reservation-core`; exact reviewed foundation
  base `b157851d0ef1c45681a713cc2daa1ee192fba617`, исходный worktree clean.
- Независимый review: P0 не найдено; прежнее утверждение foundation entry об
  отсутствии P1 superseded тремя findings ниже. History не переписывалась.
- Исправлено:
  - list parser строго валидирует provider pagination
    `meta.page/count/total_count`, согласованность размера страницы и возвращает
    отдельный completeness proof;
  - candidate reconciliation принимает только исчерпывающую `page=1` и
    независимо сверяет query/result page/count, total count и число records;
    incomplete/несогласованная выдача остаётся `unknown`, следующий page или
    write не выполняется;
  - admin read client требует явно переданный shared limiter; private fallback
    удалён, два client instances сериализуются через один gate;
  - success body читается bounded stream: oversized/invalid `Content-Length`
    отклоняется до reader, фактический поток cancel после 64 KiB, invalid UTF-8
    и JSON fail closed; `response.text()` не используется.
- Regression tests: missing/inconsistent/truncated pagination, ложный
  `exhaustive` от reader port, shared limiter для двух clients, ранний
  content-length reject и stream cancellation. Focused mocked suite: PASS,
  3 suites / 88 tests.
- Runtime boundary: PUT/DELETE/create runner, provider write/retry, Nest
  module/controller wiring и executable controlled runner не добавлялись. Новые
  external calls, env/secrets, schema/migration и payment fields не затронуты.
- Tests:
  - backend typecheck: PASS;
  - backend unit: PASS, 113 suites / 2965 tests;
  - backend E2E: PASS, 2 suites / 4 tests;
  - backend build: PASS;
  - root build: PASS, 1615 modules; только штатное chunk-size warning;
  - root E2E: FAIL, 61 passed / 1 skipped / 21 failed; неизменный
    `outside_telegram` session/login blocker воспроизведён без изменений
    frontend/auth/runtime source.
- Read-only P0/P1 correction review: pagination proof нельзя подменить одним
  флагом; oversized body не загружается через text; private limiter fallback и
  write/read retry отсутствуют; runtime import boundary сохранён. Открытых P0/P1
  в correction diff не найдено.
- Остаточные P2/следующие contracts: privacy-safe in-memory client identity/full
  payload ещё нужны для controlled plan шагов 6/8; datetime exact-string compare
  может дать безопасный false-negative `unknown`; multi-replica provider quota
  требует deployment-level coordination до runtime enablement.
- Migration: 033 остаётся `applied_verified` на Selectel test; runtime
  disconnected. DB/PRECHECK/POSTCHECK/rollback не запускались.
- Git integration: отдельный локальный correction commit; push/merge/deploy не
  выполняются.
- Deployment: `not_needed` — изменённый code остаётся недостижимым из runtime;
  общий D2 остаётся `in_progress` с deployment `pending`.
- Deployed environment/commit: Selectel test runtime остаётся detached на D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; schema 033 отдельно
  `applied_verified`, production не менялся.
- Containers changed: none.
- Health/HTTP, business smoke, log audit: `not run / not needed` — server,
  runtime и containers не менялись, внешние provider calls отсутствовали.
- Следующий конкретный шаг: независимый review correction commit. Write runner,
  provider writes и runtime wiring не начинать без нового отдельного scope.

### 2026-08-06 — D2 / YCLIENTS read live-contract correction

- Задача/ветка: `codex/week1-d2-reservation-core`; exact reviewed correction
  base `7fedddd5daf2e817aa977509ab120879915a8f26`, исходный worktree clean.
- Live-contract review: текущий официальный sample `GET /api/v1/records` имеет
  pagination `meta.page/total_count` без `meta.count`, а обычная соседняя запись
  может возвращать `api_id: ""`. Предыдущая запись о безусловно обязательном
  `meta.count` superseded этой append-only correction; history не переписывалась.
- Исправлено:
  - `meta.page` и nonnegative `meta.total_count` обязательны; optional
    `meta.count`, если присутствует, обязан быть positive и совпадать с request;
    completeness `page=1` доказывается только `total_count === rowCount`, а
    `rowCount > requested count` отклоняется;
  - `api_id` undefined/null/trimmed empty string означает отсутствие external
    ID; positive safe integer number принимается, остальные значения, включая
    numeric strings, fail closed;
  - любой classified non-200 response body явно cancel без чтения/логирования;
    ошибка cancel не меняет outcome, retry/fallback отсутствуют;
  - bounded streaming сохранён: exact response cap 256 KiB, list page cap 1 MiB
    при максимум 50 records и одном serialized in-flight request.
- Size residual: YCLIENTS не публикует maximum full-record response size.
  1 MiB даёт около 20 KiB на строку при count 50 и подтверждён mocked страницей
  полного размера; overflow остаётся безопасным `unknown`. До runtime enablement
  controlled read shape должен подтвердить достаточность cap либо потребовать
  отдельного review cap/count, но unbounded body запрещён.
- Regression tests: официальный meta shape без count, optional inconsistent
  count, empty neighboring `api_id` + numeric target candidate, numeric-string
  rejection, exact 401 и list 429/500 body cancellation с failed cancel,
  50-record page below cap и stream/content-length overflow. Focused mocked
  suite: PASS, 3 suites / 94 tests.
- Official sample compatibility: numeric record/company/staff/service IDs и ISO
  datetime с offset продолжают приниматься; raw body, Authorization, token, PII
  и record hash не возвращаются и не логируются.
- Runtime boundary: новые imports в Nest modules/controllers/runtime отсутствуют;
  write runner, PUT/DELETE/create, retries, provider calls и wiring не добавлены.
- Tests:
  - backend typecheck: PASS;
  - backend unit: PASS, 113 suites / 2971 tests;
  - backend E2E: PASS, 2 suites / 4 tests;
  - backend build: PASS;
  - root build: PASS, 1615 modules; только штатное chunk-size warning;
  - root E2E: FAIL, 61 passed / 1 skipped / 21 failed; тот же
    `outside_telegram` session/login blocker воспроизведён без frontend/auth diff.
- Read-only P0/P1 correction review: optional count не ослабляет exact page/total
  checks; empty external ID не становится numeric; non-200 bodies закрываются;
  оба success body paths остаются bounded; открытых P0/P1 не найдено.
- External state: YCLIENTS/API/DB/server calls, provider writes, чтение
  secrets/env, migration/PRECHECK/POSTCHECK/rollback не выполнялись.
- Git integration: отдельный локальный correction commit; push/merge/deploy не
  выполняются.
- Deployment: `not_needed` — code остаётся недостижимым из runtime; общий D2
  остаётся `in_progress` с deployment `pending`.
- Deployed environment/commit: Selectel test runtime остаётся detached на D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; migration 033 отдельно
  `applied_verified`, production не менялся.
- Containers changed: none.
- Health/HTTP, business smoke, log audit: `not run / not needed` — server,
  runtime и containers не менялись, внешние provider calls отсутствовали.
- Следующий конкретный шаг: независимый review live-contract correction commit;
  write runner/runtime wiring не начинать без нового отдельного scope.

### 2026-08-06 — D2 / deterministic root E2E harness correction

- Задача/ветка: `codex/week1-d2-reservation-core`; clean base
  `a68092461025b3f1273dd7c04998b7798257445e`. YCLIENTS read foundation не
  изменялся.
- Диагноз исходного gate: 61 passed / 1 skipped / 21 failed. Первые сохранённые
  auth/session failures: `restores through refresh, replaces SecureStorage and
  skips Telegram login` (`session_restored` → `outside_telegram`), `removes an
  invalid stored credential and performs one fresh Telegram login`
  (`authenticated` → `outside_telegram`), `discards a rotated credential rejected
  by session me before a fresh Telegram login` (`authenticated` →
  `outside_telegram`) и `does not hide a temporary refresh failure behind
  Telegram login` (`temporary_unavailable` → `outside_telegram`).
- Exact-main comparison: до correction blobs `scripts/e2e.cjs`, Playwright config,
  auth hook и оба auth/session spec совпадали с `main@3e8739b`; отдельный checkout
  main не запускался, чтобы не менять его worktree/state.
- Root cause:
  - runner принимал любой HTTP server на фиксированном `127.0.0.1:5173`, поэтому
    не доказывал checkout/config ownership;
  - Vite argument `--open=false` трактовался как open path `/false`; обычный Chrome
    на этом URL не является Telegram smoke;
  - чистый owned Vite с явным
    `VITE_TELEGRAM_BACKEND_LOGIN_ENABLED=true` воспроизвёл `outside_telegram`:
    live `telegram-web-app.js` перезаписывал synthetic `window.Telegram` до auth
    attach.
- Исправлено только в test harness/specs:
  - runner отказывается работать при занятом 5173, всегда стартует собственный
    Vite из текущего checkout, имеет per-request и общий bounded readiness,
    отслеживает ранний exit и гарантирует cleanup в `finally`/signals;
  - `--open=false` удалён без замены другим open flag; существующий `BROWSER=none`
    не даёт `server.open` из dev config открывать системный браузер;
  - все root E2E specs локально fulfill пустой Telegram SDK script; auth/session
    helpers делают это до `page.addInitScript`, поэтому WebKit использует только
    synthetic `window.Telegram`/`SecureStorage` и mocked backend routes без live
    Telegram request.
- Изменённые файлы: `scripts/e2e.cjs`, четыре `tests/e2e/*.spec.js` и этот
  append-only `WORKLOG.md`; application/backend runtime не менялся.
- Process/evidence: перед focused порт 5173 был свободен; runner зафиксировал owned
  Vite pid 21288, финальный full suite — pid 7380; после обоих прогонов порт снова
  свободен.
  Отдельный occupied-port contract завершился fail-closed до Vite/Playwright.
  Порождённые диагностикой Vite/esbuild остановлены. Отдельного Chrome process с
  URL `/false` в command line не было, поэтому пользовательские Chrome окна не
  завершались.
- Browser diagnostics focused-run: `pageerror` 0; 11 console errors — восемь
  локальных resource 404, два rejected invitation-list и один rejected
  notification-list. Credential/initData/requestKey leakage detector: false;
  эти сообщения не являлись причиной auth failure.
- Tests:
  - focused synthetic WebKit auth: PASS, 1/1;
  - occupied-port/no-reuse contract: PASS (runner отказался до запуска теста);
  - root E2E: PASS, 82 passed / 1 skipped / 0 failed;
  - root build: PASS, 1615 modules; только штатный chunk-size warning;
  - backend typecheck/unit/E2E/build: not run / not needed — backend source не
    изменялся.
- Smoke boundary: localhost проверялся только автоматическим headless WebKit с
  synthetic Telegram и mocked backend. Обычный localhost Chrome обязан показывать
  `outside_telegram`; это PASS fail-closed boundary, но не login/business smoke.
  Реальный ручной login/business smoke будет допустим только внутри Telegram Mini
  App на Selectel test после отдельного rollout точного commit.
- Migration: 033 остаётся `applied_verified`; повторно не применялась. DB/provider/
  YCLIENTS/server calls отсутствовали.
- Read-only P0/P1 review: auth/runtime/assertions не ослаблены; live SDK/network
  исключён из всего root E2E harness; foreign server не переиспользуется; owned
  process cleanup и port release подтверждены. Открытых P0/P1 в diff не найдено.
- Git integration: локальный checkpoint commit создаётся после этой записи; exact
  SHA возвращается в handoff. Push/merge не выполняются.
- Deployment: `not_needed` — изменены только test runner/specs/docs. Общий D2
  остаётся `in_progress`, integration/test rollout `pending`.
- Deployed environment/commit: Selectel test runtime без изменений на D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; production не менялся.
- Containers changed: none.
- Health/HTTP, manual business smoke, log audit: not run / not needed для этого
  tests-only checkpoint; future Selectel Telegram smoke не подменяется localhost.
- Следующий конкретный шаг: интеграционный review этого harness checkpoint вместе
  с D2 foundation; write runner/runtime wiring не начинать без отдельного scope.

## Шаблон записи после этапа

```text
### YYYY-MM-DD — Dn / название

- Задача/ветка:
- Commit:
- Изменённые файлы:
- Реализовано:
- Migration: not needed / proposed / approved / applied / verified
- Tests:
  - frontend E2E:
  - frontend build:
  - backend typecheck:
  - backend unit:
  - backend E2E:
  - backend build:
- Ручная проверка:
- Известные риски:
- Внешний блокер:
- Следующий конкретный шаг:
- Git integration: not_started / committed / pushed_branch / merged_main / pushed_main
- Deployment: not_needed / pending / test_deployed / production_deployed / deployment_deferred_by_user
- Deployed environment/commit:
- Containers changed:
- Health/HTTP:
- Business smoke:
- Log audit:
```

### 2026-08-07 — D2 / runtime-disabled controlled reschedule/cancel foundation

- Задача/ветка: `codex/week1-d2-reservation-core`; clean base
  `d6c905d4672790a098e5af006e6d43ff837e1eeb`.
- Реализован только code-only foundation, не импортируемый Nest modules/runtime:
  - строгий PII-bearing full-record snapshot для controlled backend harness и
    отдельная безопасная projection без client data/record hash;
  - exact admin GET snapshot reader и admin PUT/DELETE client с Partner+User
    auth, bounded 256 KiB streaming, body cancellation, общим limiter,
    `save_if_busy=false`, одним request и без retry/fallback;
  - full PUT строится только из canonical snapshot и approved target; меняются
    только resource/datetime, notification state обязан быть полностью off;
  - pure lifecycle A→B реализует steps 1–14 и C5/C8/C10/C13, один in-flight,
    интервал не менее 1 секунды, hard budget 14; uncertain write запрещает все
    последующие writes и допускает только утверждённый readback;
  - create не переопределён: runner зависит от существующего guarded
    `YclientsApiClient.createBookingRecord`; CLI/package script/env loader нет.
- Official contract check: GET/PUT/DELETE paths, Partner+User auth,
  `save_if_busy`, PUT `201`, DELETE `204` и rate ceilings сверены с актуальной
  официальной страницей YCLIENTS. PUT effect, repeat-delete, partial-update и
  no-effect write error semantics не документированы: PUT `201` означает только
  accepted и требует exact GET proof; все недоказанные write `4xx`, timeout,
  `408/425/429/5xx`, transport и invalid/ambiguous success остаются `unknown`.
- Residual contract risk: официальный exact GET не раскрывает полный nested
  shape service cost/discount и notification reminder fields. Parser намеренно
  fail-closed; отсутствие любого полного payload field даёт `unknown` до write.
  Это должно быть подтверждено controlled readback в отдельно одобренном test
  lifecycle, а не ослаблением parser.
- PII/privacy: fullName/phone/email существуют только в typed in-memory snapshot
  и outbound allowlisted PUT body; evidence содержит только A/B aliases,
  equality/effect flags, status classes, step/request count и timestamp. Raw
  request/response, Authorization, PII, record hash и provider IDs в evidence,
  errors и logs не попадают.
- Cancellation policy: D2 refund не реализует и payment fields не меняет.
  Утверждённый 23h30 grace остаётся D4 policy/version snapshot decision;
  освобождение слота в этом harness возможно только после canonical cancel
  proof.
- Изменённые файлы: `yclients-controlled-record.ts`,
  `yclients-controlled-admin.client.ts`, `yclients-controlled-lifecycle.ts`, два
  colocated unit/contract spec и этот append-only `WORKLOG.md`.
- Tests:
  - focused controlled YCLIENTS specs: PASS, 31/31;
  - backend typecheck: PASS;
  - backend unit: PASS, 115 suites / 3002 tests;
  - backend E2E: PASS, 2 suites / 4 tests;
  - backend build: PASS;
  - root E2E: PASS, 82 passed / 1 skipped / 0 failed;
  - root build: PASS, 1615 modules; первый sandboxed запуск получил локальный
    access-denied к `vite.config.js`, разрешённый повтор вне sandbox прошёл;
    остаётся только штатный chunk-size warning.
- External effects: YCLIENTS/API/DB/server calls, provider writes, secrets/env,
  migration, runtime/module/controller wiring отсутствовали. Migration 033 не
  повторялась и остаётся `applied_verified`.
- Deployment: `not_needed` — foundation недостижим из runtime, image/config/
  containers/frontend bundle не меняются. Общий D2 остаётся `in_progress`, его
  integration/test rollout — `pending`.
- Deployed environment/commit: Selectel test runtime без изменений на D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; production не менялся.
- Containers changed: none.
- Health/HTTP, manual Telegram business smoke, log audit: not run / not needed —
  server/runtime не менялись, controlled provider lifecycle не запускался.
- Independent read-only P0/P1 review: найдены и исправлены два P1 — auth/config
  failure repeat-delete больше не превращается в Basic PASS; recovery list
  calendar/range constraints теперь полностью проверяются до первого provider
  call. Добавлены точные regressions. Открытых P0/P1 после correction нет.
- Git integration: локальный checkpoint создаётся после независимого P0/P1
  review; push/merge/deploy не выполняются.
- Следующий approval gate: до executable runner/secret loading/runtime wiring и
  любых controlled YCLIENTS writes владелец отдельно одобряет exact checkpoint,
  disposable test identity/слоты A/B и basic lifecycle. Optional duplicate
  `api_id` experiment требует ещё одного отдельного high-risk approval.

### 2026-08-07 — D2 / official GET api_id and notification-shape correction

- Задача/ветка: `codex/week1-d2-reservation-core`; clean base
  `e6c8f1b089b6c15ccb7c99cf2d9b0fa14bcf8895`.
- Status: checkpoint `e6c8f1b` superseded для controlled writes до этой
  correction. D2 остаётся `in_progress`; executable runner и controlled
  lifecycle по-прежнему запрещены.
- Официальный contract уточнён по текущей странице YCLIENTS:
  - exact GET `/api/v1/record/{company_id}/{record_id}` показывает `api_id` как
    string (`""`, когда внешний ID отсутствует), а также `sms_before`,
    `sms_now`, `sms_now_text`, `email_now`, `notified`, `sms_remain_hours` и
    `email_remain_hours`; response не содержит `send_sms`;
  - PUT того же record принимает `api_id` string и `send_sms` boolean.
  Предыдущее утверждение про нераскрытые notification reminder fields было
  неточным: нераскрытым в sample остаётся nested element shape services/client,
  но перечисленные top-level notification fields документированы.
- Исправлено:
  - единая strict normalization принимает положительный safe integer number или
    уже canonical decimal string без whitespace/sign/exponent/leading zero и
    без превышения `Number.MAX_SAFE_INTEGER`; lossy parsing отсутствует;
  - пустой/whitespace string остаётся только safe-read признаком отсутствующего
    external ID; malformed/ambiguous значения fail closed;
  - safe exact/list readback нормализует system-created string `api_id` в
    существующий internal number, поэтому bounded candidate scan сравнивает его
    без изменения uniqueness/search claims;
  - controlled full GET parser больше не требует недокументированный
    `send_sms`, строго читает официальный notification shape и требует
    canonical positive `api_id`;
  - outbound PUT не копирует response observations: `send_sms=false`,
    `sms_remain_hours=0`, `email_remain_hours=0` являются явными безопасными
    command choices; SMS/email не запрашиваются.
- Lifecycle boundaries: C5/C8/C10/C13, hard budget 14, one in-flight,
  no-blind-retry и canonical cancel proof не изменены. Реальных provider writes
  и API calls не было.
- Tests:
  - focused api_id/read/reconciliation/full/lifecycle specs: PASS, 147/147;
  - backend typecheck: PASS;
  - backend unit: PASS, 116 suites / 3031 tests;
  - backend E2E: PASS, 2 suites / 4 tests;
  - backend build: PASS;
  - root E2E: PASS, 82 passed / 1 skipped / 0 failed;
  - root build: PASS, 1615 modules; только штатный chunk-size warning.
- External effects: secrets/env, YCLIENTS/API/DB/server calls, provider writes,
  migration, runtime/Nest/module/controller wiring отсутствовали. Migration 033
  не повторялась и остаётся `applied_verified`.
- Deployment: `not_needed` — correction code остаётся недостижимым из runtime;
  D2 integration/test rollout остаётся `pending`.
- Deployed environment/commit: Selectel test runtime без изменений на D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; containers/production не менялись.
- Health/HTTP, manual Telegram smoke, log audit: not run / not needed — runtime,
  server и containers не менялись.
- Independent read-only P0/P1 review: `P0/P1: none`; canonical normalization,
  safe/full parser split, notification-off PUT allowlist, lifecycle comparisons,
  PII и zero-runtime-import boundary проверены на всём staged correction diff.
- Git integration: отдельный local correction commit после final tests и
  независимого P0/P1 review; push/merge/deploy запрещены.
- Следующий шаг: вернуть correction commit на независимый review управляющего
  чата. Approval disposable identity/slots A/B пока не запрашивать.

### 2026-08-07 — D2 / controlled reschedule notification-state gate correction

- Задача/ветка: `codex/week1-d2-reservation-core`; clean base
  `ad924e484ae24094367a6c71c77b7c9ffa178f23`.
- Status: `ad924e484ae24094367a6c71c77b7c9ffa178f23` superseded для
  controlled writes. Его builder молча заменял наблюдаемые nonzero
  `sms_remain_hours`/`email_remain_hours` нулями и мог изменить reminder policy
  вместе с resource/datetime. Correction подготовлена для независимого review;
  любые controlled writes и approval disposable identity/slots A/B всё ещё
  запрещены и не запрашиваются. D2 остаётся `in_progress`.
- Исправлено:
  - official-shape exact GET parser по-прежнему принимает документированные
    notification/reminder observations, включая nonzero/true state, string
    `api_id` и отсутствие `send_sms`;
  - PUT builder теперь fail closed до limiter/fetch, если не доказано строгое
    off-состояние: `sms_before=0`, `sms_now=false`, `sms_now_text=''`,
    `email_now=false`, оба remain-hours равны нулю и `notified=false`;
  - `sms_now_text` сохраняется parser без trim, поэтому whitespace не может
    ошибочно стать доказанным пустым значением;
  - outbound `send_sms=false` остаётся явным command choice, а оба
    remain-hours берутся из проверенного snapshot и после gate равны нулю;
    silently-reset поведения больше нет;
  - normal controlled lifecycle fixture использует только доказанное off-state;
    C5/C8/C10/C13, hard budget 14, no-blind-retry и cancel proof не менялись.
- Regression coverage: parser отдельно читает non-off official fields; builder и
  write client отдельно отклоняют до fetch каждый unsafe state для
  `sms_before`, `sms_now`, nonempty/whitespace `sms_now_text`, `email_now`,
  `sms_remain_hours`, `email_remain_hours` и `notified`.
- Tests:
  - focused controlled admin/lifecycle specs: PASS, 41/41;
  - backend typecheck: PASS;
  - backend unit: PASS, 116 suites / 3039 tests;
  - backend E2E: PASS, 2 suites / 4 tests;
  - backend build: PASS;
  - root E2E: PASS, 82 passed / 1 skipped / 0 failed;
  - root build: PASS, 1615 modules; sandboxed запуск получил известный local
    access-denied к `vite.config.js`, тот же build вне sandbox прошёл, остаётся
    только штатный chunk-size warning.
- External effects: YCLIENTS/API/DB/server calls, provider writes, secrets/env,
  executable runner, migration и runtime/Nest/module/controller wiring
  отсутствовали. Migration 033 не повторялась и остаётся `applied_verified`.
- Deployment: `not_needed` — correction остаётся недостижимой из runtime;
  integration/test rollout D2 остаётся `pending`.
- Deployed environment/commit: Selectel test runtime без изменений на D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; containers/production не менялись.
- Health/HTTP, manual Telegram smoke, provider lifecycle и log audit: not run /
  not needed — server/runtime не менялись и внешние calls запрещены.
- Independent read-only review всего correction diff: `P0/P1: none`; отдельно
  проверены pre-fetch gate, exact notification text, verified reminder values,
  parser/write split, lifecycle и PII/runtime boundaries.
- Следующий шаг: создать отдельный локальный correction commit и вернуть его на
  независимый review управляющего чата; push/merge/deploy не выполнять.

### 2026-08-07 — D2 / executable controlled runner and read-only plan preparation

- Задача/ветка: `codex/week1-d2-reservation-core`; clean base
  `e2e88542ece27a384164084f320d788979444cde`. Предыдущие api_id/official GET/
  notification-gate corrections приняты; открытых P0/P1 на base нет.
- Добавлен отдельный runtime-disabled controlled runner:
  - default `dry_run` строго валидирует immutable plan, company и root-only
    identity binding, выдаёт только non-PII SHA-256 plan digest и делает 0
    provider requests;
  - execution требует mode `execute`, exact digest и отдельный one-time approval
    consume до создания lifecycle; missing/mismatch/consumed approval блокирует
    все provider calls;
  - concrete one-shot assembly использует существующие guarded create,
    availability/preflight, exact/bounded readers, controlled PUT/DELETE,
    общий conservative limiter, evidence sink и lifecycle C5/C8/C10/C13;
    Nest module, controller, frontend, env loader и package runtime не изменены;
  - plan digest связывает company, opaque identity config version, run-scoped
    external reference, A/B effect, bounded list contracts и controls 14/1/1s.
    Raw PII и обычный PII digest в projection отсутствуют; identity verifier
    отдельно доказывает соответствие root-only snapshot binding.
- Disposable identity: владелец предоставил fullName/phone/email в управляющем
  чате; значения не повторялись и не записывались в Git/WORKLOG/evidence. Binding
  `d2-disposable-identity-v1` подтверждён только как non-PII config version.
- Read-only Selectel test preparation:
  - mounted Partner/User credential files, API enabled flag и company `2079564`
    проверены только как `present/match`, без чтения/вывода значений;
  - выполнено 9 последовательных provider preparation requests: 7 safe GET и 2
    разрешённых semantic read-only `book_check`; raw bodies не сохранялись;
  - A: `2026-08-17T12:00:00+03:00`, Корт №1/resource `5730531`, service
    `30539679` «Аренда корта 1ч.», 3600 seconds, availability + preflight PASS;
  - B: `2026-08-18T12:00:00+03:00`, Корт №2/resource `5762241`, тот же service,
    3600 seconds, availability + preflight PASS;
  - availability является point-in-time evidence; будущий approved lifecycle
    обязан повторить steps 1–4 и остановиться до create при изменении слота.
- Exact plan digest:
  `5ab6f618addc65d2fb669d8adfa288e601fd9ac89ffa45529ec00c59e2fc916d`.
  Run-scoped external reference входит в digest, но не выводится в summary.
- Recovery/cleanup для `unknown`/`cleanup_required`, exact recordId readback,
  held-slot semantics и manual YCLIENTS UI cleanup с отдельным approval описаны в
  `D2_YCLIENTS_CONTROLLED_RUNBOOK.md`. Duplicate api_id experiment запрещён.
- Tests:
  - focused artifacts/runner/executable/lifecycle/admin specs: PASS, 63/63;
  - backend typecheck: PASS;
  - backend unit: PASS, 119 suites / 3061 tests;
  - backend E2E: PASS, 2 suites / 4 tests;
  - backend build: PASS;
  - root E2E: PASS, 82 passed / 1 skipped / 0 failed;
  - root build: PASS, 1615 modules; sandboxed запуск получил известный local
    access-denied к `vite.config.js`, повтор вне sandbox прошёл; только штатный
    chunk-size warning.
- External effects: реальные create/reschedule/cancel/repeat-delete calls,
  booking records, DB operations, migration, server/runtime/container/config
  changes отсутствовали. Migration 033 не повторялась (`applied_verified`).
- Deployment: `not_needed` — runner не импортируется application runtime и не
  имеет Nest/frontend wiring. D2 integration/test rollout остаётся `pending`.
- Deployed environment/commit: Selectel test runtime без изменений на D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; production не менялся;
  containers changed: none.
- Health/HTTP, Telegram smoke и runtime log audit: not run / not needed — runtime
  не менялся. Provider evidence ограничено разрешённой read-only plan preparation.
- Следующий шаг: независимый read-only P0/P1 review всего runner checkpoint.
  Approval на реальные writes пока не запрашивать; после clean review вернуть
  exact commit SHA, digest и формулировку отдельного one-time approval.
- Independent pre-commit review correction (append-only within this open
  checkpoint): initial review found two P1 safety gaps before any write was
  enabled. Process-memory approval could be replayed after restart, and a known
  create response had no durable recovery binding. Both are corrected:
  - concrete executable assembly now requires a cross-process approval gate;
    the root-only approval digest is claimed by an exclusive `0600` consumed
    marker before lifecycle construction, so a second process cannot reuse it;
  - successful create must persist an exclusive root-only allowlisted binding
    (`version`, slot A, appointment ID, record ID) before exact GET. Binding
    failure stops at request 5 with `cleanup_required`; PII, external reference,
    record hash, auth and raw bodies are forbidden from the artifact;
  - the root-only directory/file layout and crash/manual cleanup boundaries are
    now explicit in `D2_YCLIENTS_CONTROLLED_RUNBOOK.md`. No approval/binding file
    was created and no provider write was performed during this correction.
- Second independent pre-commit review correction: two additional P1s were
  found before checkpoint and closed. The executable now accepts only the
  canonical `https://api.yclients.com` origin (optional trailing slash only)
  before any identity/approval/client work; HTTP, foreign host, URL credentials,
  query, fragment and extra path have explicit zero-fetch regressions. The
  POSIX artifact store now requires the effective UID on the final `0700`
  directory and `0600` files, rejects writable/untrusted ancestors and symlinks,
  and verifies parent plus temp/final device/inode identity around atomic link
  and fsync. Owner/race regressions cover fail-closed behavior. No external call
  or filesystem artifact was created by these mocked tests.
- Final independent read-only P0/P1 review after both corrections: `none`.
  Canonical endpoint gating, effective-UID/inode-safe artifacts,
  approval-before-provider ordering, binding-before-evidence ordering,
  C5/C8/C10/C13, PII/hash/token exclusions, hard budget 14 and zero Nest/runtime
  imports were rechecked on the complete diff.

### 2026-08-07 — D2 / controlled runner operationalization correction

- Base/branch: clean local checkpoint
  `481c578e418cb6302cf072bb04524c488637f823` on
  `codex/week1-d2-reservation-core`. That checkpoint is superseded for real
  writes: no operational execution is approved.
- Independent review findings being corrected:
  - runtime execution objects must match exact dry-run/execute shapes; unknown,
    null or extra mode/keys return `invalid_execution` before identity,
    approval or lifecycle work;
  - a compiled owner-only entrypoint, concrete root-owned identity/token loader,
    exact plan builder and concrete file gates replace any need for ad-hoc
    Selectel JavaScript/TypeScript glue.
- Operational boundary:
  - launcher defaults to dry-run, requires effective UID 0, canonical API URL,
    the exact reviewed identity/token/artifact paths and exact CLI flags;
  - disposable PII exists only in a canonical root-owned `0600` identity file
    under a `0700` directory, is validated in memory and omitted from digest,
    argv, stdout/errors and evidence;
  - follow-up independent review found that the first operational draft bound
    only a static identity version and accepted alternate absolute paths. A
    public-signature correction was rejected because it enabled offline PII
    guesses. The final correction uses a domain-separated HMAC keyed by the two
    existing root-only token files and combines it with the public plan digest
    into an opaque execution `approvalDigest`; changed identity/token contents
    or paths cannot reuse the prior approval, and Git contains no public PII
    verifier, ordinary PII digest, token or raw PII;
  - exact company/service/A/B/list/external-reference plan reproduces digest
    `5ab6f618addc65d2fb669d8adfa288e601fd9ac89ffa45529ec00c59e2fc916d`;
  - launcher itself constructs the concrete cross-process approval and
    root-only exclusive binding gates before identity/provider work;
  - no Nest module/controller/frontend/package-runtime import was added.
- Delivery plan: `D2_YCLIENTS_OPERATIONAL_RUNBOOK.md` separates (1) future
  approval for D2 branch push + isolated root-only Selectel checkout/build/
  zero-provider dry-run from (2) a later exact one-time provider-write approval.
  Neither gate is approved or executed in this checkpoint.
- Tests/status:
  - focused controlled suites: 7 suites / 104 tests PASS;
  - backend typecheck PASS; unit 121 suites / 3102 tests PASS; E2E 2 suites /
    4 tests PASS; build PASS;
  - compiled launcher fail-closed smoke with no arguments: exact
    `invalid_arguments`, exit 2, zero external calls;
  - root Playwright: 82 passed / 1 skipped; root build PASS;
  - `git diff --check` PASS before checkpoint;
  - final independent read-only P0/P1 review: no actionable P0/P1. It verified
    the keyed privacy binding, double approval check plus atomic claim,
    identity/token/path TOCTOU behavior, PII-safe output and zero Nest/runtime
    imports.
- External YCLIENTS/API/DB/server calls, provider writes, migration, server
  access, actual secrets/env reads, push/merge/deploy and application
  runtime/container changes: none.
- Deployment: `not_needed` for this local code-only checkpoint; D2 remains
  `in_progress`, integration/test rollout `pending`. Selectel test application
  runtime remains D1 `c04074459948d0bf545e865b885aea7a4e5fec3c`, containers
  unchanged, production untouched.

### 2026-08-07 — D2 / Gate 1 delivery stopped before dry-run

- Owner authorized only push of exact operational checkpoint
  `e7ceeb49052f25b91aa4d20845cd41c4666d44e8` and isolated root-only Selectel
  test setup/build/dry-run. The branch `codex/week1-d2-reservation-core` was
  pushed at that exact SHA; `main` was not merged or changed.
- Selectel baseline before setup: application checkout remained D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; frontend/backend/nginx/PostgreSQL
  container IDs were recorded, all were healthy/running with restart count 0.
- Isolated layout `/root/prosto-padel-d2-controlled` was absent before Gate 1.
  It was created root-owned with mode `0700` for root, checkout, secrets and
  artifacts. The isolated checkout is detached at exact
  `e7ceeb49052f25b91aa4d20845cd41c4666d44e8` and remained clean.
- Build gate: `STOP`. Host-side `npm ci` could not start because `npm` is not
  installed on the Selectel host (`npm: command not found`). No alternate build
  mechanism was attempted because installing Node/npm or starting an ephemeral
  build container was outside the exact approval.
- Fail-closed consequences: disposable identity and existing token files were
  not provisioned; secrets directory count is 0. The compiled launcher was not
  run, so there is no `approvalDigest`. Artifacts directory count is 0:
  `approval.sha256`, consumed marker and provider binding are absent.
- Post-stop invariants: application checkout still equals D1 `c040744...`; all
  four original container IDs, images, running state and restart count 0 are
  unchanged. Application runtime/compose/env/containers/DB/production were not
  changed. No YCLIENTS API/provider call or booking create/PUT/DELETE occurred.
- Verification: `git diff --check` PASS. Project tests were not rerun because
  the only local change is this evidence-only WORKLOG entry; the authorized
  isolated backend build did not start due to the missing host npm executable.
- Status: Gate 1 `stopped_before_dry_run`; D2 remains `in_progress`. A new exact
  owner approval is required for one isolated build method before provisioning
  inputs or retrying dry-run. Gate 2 remains prohibited.

### 2026-08-07 — D2 / Gate 1 isolated dry-run PASS

- Owner separately authorized continuation of Gate 1 for exact checkpoint
  `e7ceeb49052f25b91aa4d20845cd41c4666d44e8` using temporary
  `node:20.11.0-bookworm-slim` containers only. Gate 2 and every YCLIENTS
  provider call/write remained prohibited.
- Isolated build:
  - the Node image was pulled into host image cache; all Gate 1 build containers
    used `--rm` and were removed;
  - the first shell-composed invocation performed no install/build because its
    inner npm command was lost by SSH quoting. It was replaced by two exact
    sequential `--rm` invocations: `npm ci`, then `npm run build`;
  - `npm ci` installed 587 packages and backend build PASS. Existing npm audit
    output reported 5 high vulnerabilities and the pinned Node `20.11.0` image
    emitted dependency engine warnings requiring `20.11.1`; no dependency,
    lockfile or image change was made in this gate;
  - compiled launcher exists and isolated checkout stayed detached/clean at
    exact `e7ceeb49052f25b91aa4d20845cd41c4666d44e8`.
- Inputs: existing approved YCLIENTS token files were copied server-side into
  the fixed root-owned `0600` paths without printing their contents or changing
  application env. The owner entered the disposable identity directly over
  SSH; its final file is root-owned `0600`. Raw PII/tokens were not recorded in
  output, artifacts or this evidence.
- Fail-closed preparation: the first network-disabled dry-run stopped on an
  invalid identity shape before any provider work; artifacts remained empty.
  After the owner corrected the two invalid fields, the exact compiled launcher
  was run once more in a separate `--network none --rm` container.
- Final dry-run result: `PASS`, exactly one safe JSON object:
  - outcome `dry_run_ready`;
  - plan digest
    `5ab6f618addc65d2fb669d8adfa288e601fd9ac89ffa45529ec00c59e2fc916d`;
  - provider request count `0`;
  - opaque approval digest
    `fd7c94c0606fb3929d212b397b907754beaf05f205fe2ce2d42bf47bb2f03aab`.
- Postcheck: artifacts count `0`; `approval.sha256`, consumed marker and
  `provider-binding.json` are absent. No Gate 1 temporary container remains.
  Application checkout remains D1 `c04074459948d0bf545e865b885aea7a4e5fec3c`;
  the original frontend/backend/nginx/PostgreSQL container IDs and images are
  unchanged, all running with restart count 0. Compose/env/PostgreSQL/runtime/
  production were not changed. Network-disabled dry-run plus zero request count
  confirms no YCLIENTS API call and no booking create/PUT/DELETE.
- Verification: evidence-only WORKLOG append; project tests not rerun/not needed.
  `git diff --check` PASS before the local docs checkpoint.
- Status: Gate 1 `PASS` and stopped after approval digest. D2 remains
  `in_progress`; isolated code is not application runtime/deployment. Gate 2 is
  not authorized and must not start without a new exact one-time owner approval
  binding checkpoint, plan digest and approval digest above.

### 2026-08-07 — D2 / controlled Gate 2 stopped at snapshot readback

- Owner approved exactly one Selectel test controlled lifecycle for checkpoint
  `e7ceeb49052f25b91aa4d20845cd41c4666d44e8`, plan digest
  `5ab6f618addc65d2fb669d8adfa288e601fd9ac89ffa45529ec00c59e2fc916d`
  and Gate 1 approval digest
  `fd7c94c0606fb3929d212b397b907754beaf05f205fe2ce2d42bf47bb2f03aab`.
  Hard budget was 14 requests; blind retries, duplicate experiment and any
  separate cleanup were expressly excluded.
- Precheck PASS: application runtime remained D1 `c040744...`; isolated
  checkout was clean/detached at exact `e7ceeb4...`; root-only input/artifact
  ownership and modes matched; artifacts were empty; all four application
  containers had their original IDs/images, running state and restart count 0.
- One `approval.sha256` was created as root-owned `0600`. The exact launcher
  atomically created the root-owned consumed marker before provider work. The
  execute container was `--rm`; no retry or second execute occurred.
- PII-safe provider evidence:
  - requests 1–4: availability/preflight A and B all `pass`;
  - request 5: create A `pass`; durable allowlisted binding was written before
    readback: appointment ID `1`, record ID `1891713981`, slot `A`;
  - request 6: exact GET A classified `unknown`, effect `ambiguous`;
  - terminal result: `cleanup_required`, reason `snapshot_incomplete`, request
    count `6`, hold `A`.
- Steps 7–14 were not executed. In particular, no list expansion, reschedule,
  cancel or repeat-delete occurred. The created YCLIENTS test record therefore
  remains held in slot A; no automatic/manual cleanup was authorized.
- Root-only audit:
  `/root/prosto-padel-yclients-audit/basic-20260807T085254Z-e7ceeb4/runner.jsonl`
  (`0600`); stderr is empty. Approval, consumed and provider-binding artifacts
  remain root-owned `0600`. Raw response bodies, record hash, tokens and PII
  were not recorded.
- Postcheck: Gate 2 temporary container count `0`. Application checkout remains
  `c040744...`; original frontend/backend/nginx/PostgreSQL container IDs/images
  remain running with restart count 0. Application runtime/compose/env/DB/
  production were not changed.
- Verification: evidence-only WORKLOG append; project tests not rerun/not
  needed. `git diff --check` PASS before the local docs checkpoint.
- Status: controlled lifecycle `cleanup_required`; D2 remains `in_progress`.
  No further provider call is allowed under the consumed approval. A new exact
  record-specific owner approval is required before any readback/cancel cleanup;
  until canonical cancel proof, slot A must be treated as held.

### 2026-08-07 — D2 / record 1891713981 cleanup plan prepared for review

- Owner authorized only a review-ready record-specific cleanup plan for
  YCLIENTS record `1891713981`; API/provider/DB/server calls and writes were not
  authorized.
- Added `D2_YCLIENTS_RECORD_1891713981_CLEANUP_PLAN.md`. It pins the durable
  record/appointment/slot A binding, requires manual club-admin equality
  verification, a separate runtime-disabled cleanup implementation and fresh
  identity-bound approval artifacts. The consumed lifecycle approval cannot be
  reused.
- Proposed future lifecycle is fail-closed and capped at four serialized
  requests: one bounded pre-delete projection, exactly one DELETE, exact GET
  readback and one bounded `with_deleted=true` readback. There is no create,
  reschedule, repeat-delete, fallback or blind retry. Any mismatch or uncertain
  outcome keeps slot A held until canonical cancel proof.
- This checkpoint performed no YCLIENTS/API/DB/Selectel call, provider write,
  manual cleanup, runtime/container/config change or deployment. Record
  `1891713981` therefore remains `cleanup_required` and slot A remains held.
- Verification: docs-only; project tests not run/not needed because no runtime,
  source, schema or test code changed. Deployment `not_needed`; application
  runtime remains `c04074459948d0bf545e865b885aea7a4e5fec3c` and was not
  contacted.
- D2 remains `in_progress`. Next gate is independent review followed by a
  separate owner decision on code-only cleanup implementation; execution is
  not approved.

### 2026-08-07 — D2 / cleanup-plan independent review correction

- Independent read-only review of docs checkpoint
  `5b78af6b36e3ddc356209878675f2aca83f25f80` found no P0 and three plan-level
  P1 gaps: no machine proof of active state before DELETE, client ownership
  depended only on an earlier UI check, and canonical cancel proof was
  underspecified. That checkpoint is superseded for cleanup implementation.
- Corrected the review-only plan without adding runtime code. The four-request
  proposal now starts with a cleanup-specific exact binding GET that must prove
  record/company/effect/external-reference, `deleted=false` and the full
  disposable identity in memory. A club-admin no-change window is mandatory
  because conditional DELETE/ETag semantics are not documented.
- Canonical cancel proof now requires both exact GET of the same projection with
  `deleted=true` and one exhaustive bounded `with_deleted=true` page containing
  exactly one matching deleted row. DELETE `204`, exact `404/not_found` or any
  incomplete/conflicting readback remains `unknown`; slot A stays held.
- Review/correction is docs-only. No YCLIENTS/API/DB/Selectel call, provider
  write, manual cleanup, runtime/container/config change or deployment was
  performed. Tests not run/not needed; deployment remains `not_needed`.
- D2 remains `in_progress`. Cleanup runner implementation and any execution
  each require later, separate approvals.

### 2026-08-07 — D2 / record-specific cleanup runner code checkpoint

- Owner authorized only code/test implementation of the runtime-disabled
  cleanup runner for record `1891713981` under reviewed plan checkpoint
  `cca07e9e3ce5a98d3f3bc910a215c240fdc7a850`. Runner execution, API/DB/server
  calls, provider writes, delivery, push, merge and deployment were excluded.
- Added a cleanup-specific strict exact parser/reader. It compares
  record/company/service/resource/datetime/external reference, `deleted` and
  the full disposable identity only in memory; its result/evidence contains no
  PII, record hash, token or raw body. The reschedule full parser was not
  weakened.
- Added a pure four-request lifecycle: exact active binding GET, exactly one
  DELETE, exact deleted GET and one exhaustive bounded `with_deleted=true`
  list. There is no create, PUT/reschedule, repeat-delete, fallback or blind
  retry. Uncertain DELETE permits only the two planned readbacks; exact+list
  deleted proof is required to release slot A.
- Added a separate dry-run-default owner-only launcher and assembly with exact
  endpoint/record/effect/source-binding/paths, shared one-request-per-second
  limiter, new isolated approval/consumed artifacts and deterministic cleanup
  plan digest
  `83a904bd7b04ba8f5565cf7ce01a41e365c49ed9466f84cc109341ee225b4532`.
  The approval digest remains opaque and identity/token-bound; the consumed
  basic-lifecycle approval cannot be reused.
- Mocked/temp-only focused gate: 5 suites / 62 tests PASS. No test contacted
  YCLIENTS.
- Backend verification: typecheck PASS; unit 126 suites / 3164 tests PASS; E2E
  2 suites / 4 tests PASS; build PASS.
- Root verification: the first sandboxed attempt stopped before Vite readiness
  because esbuild could not read the worktree parent (`Access denied`). The
  same commands were rerun outside that filesystem restriction: E2E 82 passed
  / 1 skipped, build PASS. Owned Vite was used; no foreign server was reused.
- Runtime/import boundary: no Nest module/controller/main imports the cleanup
  files; no package script or application wiring was added. No YCLIENTS/API/DB/
  Selectel call, provider write, server access, manual cleanup, migration,
  container/config/runtime change or deployment occurred. Deployment
  `not_needed`; Selectel application runtime remains
  `c04074459948d0bf545e865b885aea7a4e5fec3c` and was not contacted.
- D2 remains `in_progress`; record `1891713981` stays `cleanup_required` and
  slot A stays held. Next gate is independent P0/P1 review of this code
  checkpoint. Isolated delivery/dry-run and execution each require later,
  separate owner approvals.

### 2026-08-07 — D2 / record-specific cleanup Gate 1 delivery and dry-run

- Owner authorized only Gate 1 delivery and an isolated network-disabled
  dry-run of reviewed cleanup checkpoint
  `fce01e96a8a48f67292a17939ff50b6add34036c`. The exact commit was pushed to
  `codex/week1-d2-reservation-core`; `main` was not merged or changed.
- Selectel test baseline PASS before setup: application checkout was clean at
  D1 runtime `c04074459948d0bf545e865b885aea7a4e5fec3c`; frontend, backend,
  nginx and PostgreSQL were running and healthy with restart count `0`.
- Created only the isolated root-owned `0700` layout
  `/root/prosto-padel-d2-cleanup-1891713981`, with a clean detached checkout at
  exact `fce01e96...` and an empty root-owned `0700` artifacts directory.
  Existing identity/token/source-binding files were used only from their
  fixed root-owned `0600` paths; their contents were not printed or copied.
- The first container command had a shell-quoting error and stopped at npm
  usage before install/build. Its `--rm` container was removed, exact SHA,
  clean worktree and empty artifacts were revalidated, and no provider work
  occurred. The corrected isolated sequence then completed: `npm ci` PASS
  (existing engine/audit warnings recorded, no dependency fix attempted) and
  backend `npm run build` PASS in temporary `node:20.11.0-bookworm-slim`
  containers. The build container ran with `--network none`.
- Compiled cleanup launcher dry-run PASS in a separate `--rm --network none`
  container: outcome `dry_run_ready`, cleanup plan digest
  `83a904bd7b04ba8f5565cf7ce01a41e365c49ed9466f84cc109341ee225b4532`,
  opaque approval digest
  `be24705618391825d5b3d83cb5ca0b301c0c2d475e42a9ceb60ca50e2af107a9`,
  and `providerRequestCount=0`.
- Postcheck PASS: cleanup `approval`, `consumed` and `provider-binding`
  artifacts are absent and the temporary container is absent. Application
  checkout remains clean at `c040744...`; the original four container IDs,
  restart counts (`0`) and healthy/running states are unchanged. Frontend and
  `/api/v1/health` both returned HTTP `200`.
- No approval file was created, no execute mode was used, and network-disabled
  dry-run plus request count `0` confirms no YCLIENTS/API/provider call or
  create/PUT/DELETE. Record `1891713981` was not changed and slot A remains
  held. Application runtime, containers, compose/env, DB/schema/migrations and
  production were not changed.
- Verification for this factual handoff is docs-only: project tests were not
  rerun/not needed because the delivered source is the already reviewed exact
  checkpoint and the only local change is this append-only evidence entry.
  Deployment `not_needed`: the isolated cleanup harness is not connected to
  application runtime.
- Gate 1 `PASS`; D2 remains `in_progress`. Gate 2 execution is not authorized
  and requires a separate exact one-time approval bound to the checkpoint,
  cleanup plan digest and approval digest above.

### 2026-08-07 — D2 / record-specific cleanup Gate 2 stopped before DELETE

- Owner confirmed the club-admin UI binding and exclusive no-change window,
  then authorized exactly one cleanup execute for checkpoint
  `fce01e96a8a48f67292a17939ff50b6add34036c`, cleanup plan digest
  `83a904bd7b04ba8f5565cf7ce01a41e365c49ed9466f84cc109341ee225b4532`
  and opaque approval digest
  `be24705618391825d5b3d83cb5ca0b301c0c2d475e42a9ceb60ca50e2af107a9`.
- Fail-closed precheck PASS before approval creation: isolated checkout and
  compiled launcher were exact `fce01e96...`; cleanup artifacts were empty;
  root-only ownership/modes and source binding metadata matched. Application
  checkout remained D1 runtime `c04074459948d0bf545e865b885aea7a4e5fec3c`;
  the four application container IDs, restart counts (`0`), running/healthy
  states and both HTTP `200` checks matched the Gate 1 baseline.
- Created one root-owned `0600` `approval.sha256`. The exact launcher consumed
  it atomically into root-owned `0600` `approval.sha256.consumed` before the
  first provider request. Execute ran exactly once in an isolated `--rm`
  container; the consumed approval was not and cannot be reused.
- PII-safe result: request `1` was the cleanup pre-delete exact GET. It was
  classified `unknown`; lifecycle stopped immediately with outcome
  `cleanup_required`, reason `pre_delete_unverified`, request count `1` and
  hold `A`. DELETE was not sent. Post-delete exact GET and bounded
  `with_deleted=true` list were not called, so no canonical cancel proof
  exists and slot A remains held.
- Root-only audit is
  `/root/prosto-padel-d2-cleanup-1891713981/audit/execute-fce01e96.jsonl`
  (`0600`), with empty `0600` stderr and recorded launcher exit `2`. Audit
  contains only allowlisted evidence/outcome; no PII, token, record hash or raw
  provider body was recorded.
- Postcheck PASS: execute container is absent; application and isolated
  checkout SHAs are unchanged. The original frontend/backend/nginx/PostgreSQL
  container IDs, restart counts (`0`) and healthy/running states are unchanged;
  frontend and `/api/v1/health` remain HTTP `200`. Error/fatal marker counts in
  all four application container logs since precheck were `0/0/0/0`; runner
  stderr was empty. Runtime, containers, compose/env, DB/schema/migrations and
  production were not changed.
- This append-only factual handoff is docs-only. Project tests were not
  rerun/not needed because no source/runtime/schema/test code changed.
  Deployment `not_needed`; the cleanup harness remains isolated from
  application runtime. No new branch push, main merge or deployment occurred.
- D2 remains `in_progress`; cleanup remains `cleanup_required`. Any further
  provider read or cleanup attempt needs a new review-only diagnosis of the
  exact-read `unknown`, a separately reviewed correction/plan if required and
  fresh delivery/dry-run/execution approvals. The consumed Gate 2 approval
  does not authorize another request.

### 2026-08-07 — D2 / cleanup exact-read diagnostic correction

- Owner authorized only a code-only, runtime-disabled diagnostic correction
  for cleanup record `1891713981`. YCLIENTS/API/SSH/server calls, runner
  delivery/dry-run/execute, approval artifacts, provider writes, runtime
  wiring, DB/schema/migrations, push/merge/deploy and hold-A changes were
  excluded. Base evidence checkpoint was
  `66439687fa3e6f154ae5bab6811aa7c88f28e7e3`; worktree was clean.
- Root-cause review proved that retained `status=unknown` could not distinguish
  HTTP `404`, an unexpected HTTP status, bounded-body/stream/UTF-8/JSON failure,
  invalid success/data envelope or a strict binding mismatch. The correction
  does not claim which live branch occurred and does not relax the provider
  parser.
- Added allowlisted exact-read diagnostics only: numeric HTTP status for
  not-found/unexpected status, fixed body/envelope reason enums, and ten
  `{present,typeValid,equal}` field triples for record/company/resource/
  service/datetime/deleted/api_id and client phone/fullName/email. Diagnostics
  carry no provider values, PII, tokens, record hash, response size or raw
  request/response body.
- Strict `matched` acceptance remains the same exact company/record/effect/
  external-reference/client comparison. Lifecycle evidence now preserves
  `not_found` and `mismatch` instead of collapsing them into `unknown`. DELETE
  remains reachable only after `preDelete.outcome === matched`; no request,
  retry, fallback, budget or limiter behavior changed.
- Mocked focused verification: 3 suites / 63 tests PASS. Regressions cover all
  seven bounded-body reasons, `404`, unexpected status, envelope failures,
  every binding equality, missing/type-invalid flags, lifecycle no-DELETE and
  launcher serialization without PII/token/hash/body. No test contacted
  YCLIENTS.
- Backend verification: typecheck PASS; unit 126 suites / 3178 tests PASS; E2E
  2 suites / 4 tests PASS; build PASS.
- Root verification: synthetic Playwright E2E 82 passed / 1 skipped. The first
  sandboxed root build stopped before compilation because esbuild could not
  read the worktree parent (`Access denied`); the identical local command was
  rerun outside that filesystem restriction and PASSed (1615 modules, only the
  existing chunk-size/CJS warnings).
- Independent read-only review of the complete diff: actionable P0/P1 none.
  It confirmed unchanged strict acceptance/DELETE gate, boolean-only binding
  evidence, fail-closed bounded streaming/body cancellation, no extra request
  or retry and no Nest/module/controller/runtime import.
- No external call, provider operation, secret/env read, server access,
  approval artifact, runtime/container/config/database change or deployment
  occurred. Deployment `not_needed`: the correction is unreachable from the
  application runtime. Selectel test application remains D1 `c040744...` and
  was not contacted; production was not changed.
- D2 remains `in_progress`; record `1891713981` remains `cleanup_required` and
  slot A remains held. The consumed cleanup approval cannot be reused. A future
  one-request diagnostic read requires separately approved branch delivery,
  isolated dry-run and a fresh exact read-only approval; DELETE remains outside
  that diagnostic gate.

### 2026-08-07 — D2 / product scope correction and cancel-only workflow foundation

- Product owner superseded the previous live-reschedule plan: the application
  must not originate YCLIENTS `PUT`/reschedule. A player requests a move from a
  live administrator, the administrator edits YCLIENTS directly, and the app
  later synchronizes the current date/time/court by bounded read-only exact
  refresh/reconciliation. Webhook remains disabled. Existing controlled
  reschedule clients/runners stay runtime-disabled and must not be wired into
  production.
- The in-progress diagnostic cleanup Gate 1 was stopped on that decision before
  dry-run. The D2 branch had already been pushed at exact
  `7e0c1651164a263ac298a00c10486ca7dda7a127`. Selectel application checkout
  remained clean at `c04074459948d0bf545e865b885aea7a4e5fec3c`; the same four
  application container IDs remained running with restart count `0`.
- The old cleanup layout was preserved without deletion at
  `/root/prosto-padel-d2-cleanup-1891713981-gate2-archive-fce01e96`; its old
  approval/consumed artifacts remain root-owned `0600`. The fresh isolated
  checkout is clean at `7e0c165...`, its artifact directory is empty, the
  interrupted build left a compiled launcher, and no temporary Gate container
  remains. Build PASS was not claimed for that interrupted remote command.
  Cleanup dry-run/execute was not invoked, no new approval artifact was created,
  and no YCLIENTS/API call or provider write occurred. Automatic cleanup of test
  record `1891713981` is no longer a D2 goal; slot A remains conservatively held
  until a later canonical read observes an administrator action.
- Owner then authorized only a code-only, runtime-disabled cancellation
  workflow. Added a narrow cancel-only provider port: it exposes one
  `deleteOnce` and one exact record-ID read, with no generic write, reschedule,
  list fallback or retry. The provider command contains only scoped internal
  IDs, request digest, record ID and external API ID; client PII and record hash
  do not cross this boundary.
- Added owner-scoped transactional orchestration. A new cancellation atomically
  enters `cancel_pending`; same-key/same-digest retries return the persisted
  operation without a second DELETE, different owner/binding/digest fails before
  provider access, and concurrent retries cannot duplicate the write. One DELETE
  response is never sufficient to release the slot: only a strict exact safe
  projection with the same record/API IDs and `deleted=true` can confirm
  `cancelled`. A timeout, thrown/unknown DELETE, missing/malformed proof or
  terminal persistence uncertainty remains `unknown`/held with no blind retry.
  A known no-effect rejection returns the reservation to `confirmed` and keeps
  its hold.
- The exact proof intentionally does not compare court/datetime: those may have
  been changed by the live administrator. A separate read-only sync workflow
  will update the current target; the cancellation binding remains the immutable
  record ID plus external API ID.
- Corrected operation idempotency ordering: an existing valid same-key/same-
  digest operation is checked before the new-operation monotonic timestamp gate.
  This permits a completed cancellation retry carrying its original
  `cancellationRequestedAt` while preserving ownership, reservation/type,
  request-digest and key checks. The cancel-only service additionally requires
  `operation.createdAt` to equal that original request timestamp, so the
  policy-relevant instant cannot be changed on retry. Full YCLIENTS binding
  validation rejects malformed persisted record IDs before provider access. The
  timestamp gate still applies before any new operation starts.
- Focused mocked tests: reservation state machine + cancellation workflow
  `2 suites / 47 tests` PASS. Regressions cover accepted/uncertain/thrown DELETE,
  exact proof and mismatches, no retry, concurrent and completed idempotent
  retries, different timestamp/client/owner, invalid input/binding and record ID,
  persistence failures, held-slot behavior and absence of PII/hash from
  command/result projections.
- Backend gates: typecheck PASS; unit `127 suites / 3199 tests` PASS; E2E
  `2 suites / 4 tests` PASS; build PASS.
- Root build: the first sandboxed Vite attempt hit the existing esbuild
  filesystem `Access is denied` boundary before compilation; the identical
  build outside that filesystem sandbox PASS (`1615` modules, only existing
  CJS/chunk-size warnings). Root E2E initially exposed unrelated UI timeout
  flakes at 9 workers (`80/1/2`, then `81/1/1`); both failing specs passed
  focused `2/2`, and the final full owned-Vite run with `--workers=4` PASS
  `82 passed / 1 skipped` without assertion/runtime changes.
- Runtime/import boundary review: no Nest module, controller, application main,
  environment loader or executable entry point imports the new port/service.
  No schema/migration, DB, YCLIENTS/API/server call, payment field, frontend,
  push, merge or deployment occurred for this code slice. Deployment
  `not_needed`: code is unreachable from application runtime. Selectel test
  runtime remains `c040744...`; production was not changed.
- D2 remains `in_progress`. Before production repository/provider/controller
  wiring, this checkpoint needs independent read-only review. The next safe
  slice is a code-only adapter mapping the existing one-DELETE client and exact
  safe reader into this cancel-only port; app-originated reschedule stays
  forbidden.

### 2026-08-07 — D2 / cancel-only adapter foundation

- Independent read-only review of checkpoint
  `c615caec04f72f65408d39eddddaed0e92a8f061` found no P0 and three P1 before
  adapter wiring: the generic state-machine confirmation could bypass canonical
  cancel proof, the outer exact-read result was not exact-shape checked, and
  arbitrary provider rejection reasons could be mistaken for proved no-effect.
- Closed those boundaries code-only. Pending and reconciled cancel confirmation
  now require the exact `{recordId, apiId, deleted:true}` projection to match the
  persisted YCLIENTS record binding and immutable external reference inside the
  state machine. Missing, mismatched or extra proof remains rejected/held. The
  service accepts only an exact two-field `found` wrapper; missing or
  contradictory outer fields remain `unknown` and do not release the slot.
- Replaced the broad cancellation `rejected` port result with the narrow
  `not_sent` outcomes `provider_disabled|invalid_request`. Only those local
  pre-dispatch cases may restore `confirmed` without readback; every provider
  response, transport error or undocumented effect stays `unknown` and uses the
  one allowed exact read-only reconciliation.
- Added runtime-disabled `YclientsReservationCancellationAdapter`. It depends
  only on `Pick<YclientsAdminWriteClient,'cancel'>` and
  `Pick<YclientsAdminReadClient,'getRecord'>`, validates the PII-free command,
  invokes at most one DELETE or one exact GET per method, performs no retry/list
  fallback, projects only record/API/deleted fields and exposes no PUT,
  reschedule or generic write method. It is not imported by any Nest module,
  controller or application main.
- Focused mocked verification: state machine, cancel service and adapter `3
  suites / 77 tests` PASS. Full backend gates: typecheck PASS; unit `128 suites
  / 3229 tests` PASS; E2E `2 suites / 4 tests` PASS; build PASS.
- Root synthetic Playwright at the default 9 workers produced two unrelated
  resource timeout flakes in unchanged chat/profile-photo specs (`80 passed / 1
  skipped / 2 failed`); both exact failures then PASSed focused `2/2`, and the
  complete owned-Vite rerun with `--workers=4` PASSed `82 passed / 1 skipped`.
  Root build first hit the known sandbox-only esbuild parent-directory `Access
  denied`; the identical command outside that filesystem restriction PASSed
  (`1615` modules, existing chunk/CJS warnings only).
- No YCLIENTS/API/SSH/server/DB call, provider write, secret/env read,
  schema/migration, payment-field, frontend, runtime/Nest wiring, push, merge or
  deployment occurred. Deployment `not_needed`: all new code remains
  unreachable from application runtime. Selectel test application remains D1
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; production was not changed.
- Independent read-only review of the complete adapter diff: actionable P0/P1
  none. It confirmed both proof-gated terminal paths, exact outer/result shapes,
  pre-dispatch-only `not_sent`, one-call/no-retry behavior, PII/hash stripping,
  no PUT/reschedule surface and no Nest/module/controller/main import.
- D2 remains `in_progress`. Production repository/controller/runtime wiring
  requires a separate later approval; app-originated reschedule remains
  forbidden.

### 2026-08-07 — D2 / simplified scope and verified-contact blocker

- Started from clean branch checkpoint
  `b5856b6384e9e3ed5a1bf621ce0a60ee24e820d3`. The approved product scope now
  excludes every app-originated reschedule/PUT and cancel/DELETE surface: a
  live administrator performs both actions in YCLIENTS, while the application
  may only perform a bounded read-only refresh of the same immutable record
  binding and reflect new court/time or canonical deleted/cancelled state.
  Webhook stays disabled, and the abandoned cleanup of test record `1891713981`
  is not part of D2.
- Rechecked applied migration 033 against the requested repository and recovery
  contract. It already contains owner-scoped reservations/operations, encrypted
  client snapshots, idempotency and active-operation constraints, optimistic
  versioning/locking support, provider attempt timestamps, unknown outcome and
  reconciliation fields, slot holds/overlap protection and the required
  indexes/grants. Those fields are sufficient for the simplified D2
  create/read/read-only-reconciliation scope; there is no app cancellation
  command whose reason must be persisted. No change to migration 033 and no new
  reservation migration is justified by this review.
- The existing cancel-only state-machine/service/adapter checkpoint remains
  runtime-disabled historical foundation and is superseded for D2 production
  wiring. It must not be imported by a Nest module, controller, application
  main, frontend client or route. The future UI may expose one club-contact
  action for both manual transfer and cancellation only after its exact safe
  source is approved; it has no cancel or reschedule command.
- A focused import/route inventory confirmed the current boundary: no Nest
  module/controller/application main imports the cancellation adapter/service,
  the booking controller publishes no PUT/DELETE route, and the frontend has no
  booking cancel/reschedule command. Controlled write/cleanup runner sources
  remain isolated historical test tooling and are not runtime imports.
- A targeted search did not locate a dedicated booking-safe support/contact
  contract to power the future single admin-contact action. Its exact existing
  backend/config source must be identified before UI wiring; no private contact
  or hardcoded link may be introduced as a substitute.
- A separate blocking gap was proved before runtime implementation.
  `YclientsBookingService` requires non-empty valid `fullName`, `phone` and
  `email` for create, but the backend profile schema has only first/last name
  and an owner-editable phone. It has no email and no phone/email verification
  state; the existing player `isVerified` flag describes rating verification,
  not contact ownership. The current browser booking request supplies the
  client snapshot and currently has no profile email, so it cannot be used as
  the approved server-owned verified source.
- Continuing the vertical slice would therefore require trusting
  client-controlled PII, inventing an email, or treating an editable phone as
  verified. All are fail-open and contradict the approved contract. Per the
  explicit stop rule, repository/controller/runtime/frontend implementation
  stopped before code changes. A minimal review-only proposal is recorded in
  `D2_VERIFIED_BOOKING_CONTACT_MIGRATION_PROPOSAL.md`; it requests a separate
  expand-only verified-contact source and the product decisions needed before
  any SQL is prepared.
- Scope of this checkpoint is documentation only: `MASTER_PLAN.md`, the
  verified-contact proposal and this append-only entry. No application/backend
  source, controller/module/runtime wiring, frontend, SQL/schema/migration,
  payment field, YCLIENTS/API/SSH/server/DB call, secret/env access, provider
  write, push, merge or deployment occurred. Tests are `not_run/not_needed`
  because executable code and configuration did not change. `git diff --check`
  PASS (CRLF conversion warnings only). Independent read-only review of the
  complete three-file diff found no actionable P0/P1 and confirmed the
  simplified scope, migration 033 sufficiency, verified-contact blocker and
  privacy/RBAC/audit boundaries.
- Deployment is `not_needed` for this docs-only stop checkpoint. Selectel test
  application remains `c04074459948d0bf545e865b885aea7a4e5fec3c`; containers,
  health and production were not touched. D2 remains `in_progress`, blocked on
  explicit product/schema approval for the verified booking-contact authority,
  uniqueness, re-verification and retention decisions before SQL or runtime
  work resumes.

### 2026-08-07 — D2 / persisted create and read-only reconciliation vertical slice

- The owner superseded the verified-contact blocker with the MVP declared
  booking-contact contract. Backend profile first/last name and canonical E.164
  phone are server-sourced; only a normalized lowercase email is accepted from
  the authenticated owner's booking request. These values are not described as
  verified identity/auth factors; D5 owns phone/email verification. The prior
  verified-contact proposal is retained as history and marked deferred to D5.
- Implemented the concrete migration-033 PostgreSQL repository: owner-scoped
  reads/list, advisory idempotency locking, transactional operation start and
  transitions, provider-attempt/reconciliation metadata, optimistic/row locks,
  interval overlap mapping and AEAD-encrypted client/provider snapshots. Manual
  admin reschedule atomically releases the immutable old hold and inserts the
  exact provider-duration hold; canonical exact `deleted=true` releases it.
- Wired owner-authenticated `POST /bookings`, `GET /bookings`, request-key
  recovery and exact reservation GET/refresh. Create double-submit binds the
  same owner key+digest; dispatch is claimed immediately before one guarded
  POST. A post-dispatch timeout/crash becomes `unknown/held` and never retries
  POST. The owner receives a persisted recovery handle.
- Exact GET refresh accepts only the same company/record/api binding, one
  service and provider duration. It reflects administrator-changed court/time
  or canonical deleted/cancelled state; mismatch/404/invalid/timeout returns
  stale persisted data without mutation. Webhook and background polling remain
  disabled.
- All runtime YCLIENTS HTTP dispatches share the singleton conservative limiter.
  Its pending queue is bounded, and write attempt claim plus request timeout are
  created only inside the granted permit immediately before fetch. A stale
  pending operation with no attempt marker is safely rejected/released as not
  dispatched; a stale started attempt becomes `unknown/held`. Unknown-create
  reconciliation atomically claims at most one bounded candidate scan;
  subsequent owner refreshes perform no further scan. Migration 033 cannot
  safely promote that candidate without appointment ID, record ID and encrypted
  hash, so it remains `unknown/held`. The PII-safe, bounded read-only operator
  lookup is the rollout gate documented in
  `D2_UNKNOWN_CREATE_RECONCILIATION_PROPOSAL.md`; terminal automation still
  requires separately approved provider proof or expand-only migration.
  Stale classification locks reservation then create-operation rows in the
  same transaction, so a concurrent provider-attempt claim cannot coexist with
  a local rejection/slot release.
- Frontend booking flow now sends only booking email, keeps it in component
  memory, retains unknown request handles, restores the latest owner reservation
  and performs one exact refresh. It displays pending/unknown/confirmed/cancelled
  and current court/time. No cancel/reschedule command is exposed. Because no
  approved support destination exists in the repository, the UI truthfully says
  the club contact link is pending instead of presenting a fake action.
- Runtime boundaries: booking controller/module/frontend contain no PUT/DELETE,
  cancel/reschedule provider import or command. Existing cancel/controlled-runner
  code remains unreachable historical foundation. Payment fields
  `paymentStatus`, `ownerPaid`, `holdAmount`, `prepay` were not changed.
- Final local gates: backend typecheck PASS; unit 131 suites / 3271 tests PASS;
  E2E 2 suites / 4 tests PASS; build PASS. Root Playwright 84 passed / 1 skipped
  PASS on an owned Vite process; root build PASS (`1615` modules, existing
  chunk/CJS warnings only). The first sandboxed root build failed only because
  esbuild could not traverse the managed worktree; the approved unsandboxed
  build passed. `git diff --check` PASS (line-ending warnings only).
- Independent read-only review of the complete final diff found no actionable
  P0/P1. It specifically confirmed the reservation-to-operation lock ordering
  closes the stale-pending/provider-claim TOCTOU, the limiter queue and dispatch
  boundary are fail-closed, unknown reconciliation is bounded, and no runtime
  or UI PUT/DELETE/cancel/reschedule surface is reachable.
- Migration 033 remains `applied_verified`; no schema/migration or executable
  SQL was added/applied (the proposal records only a review-only SELECT shape).
  No YCLIENTS/API/SSH/Selectel/DB call, provider write, secret read,
  push, merge or deployment occurred. Deployment is `pending` because this
  checkpoint changes backend/frontend/config. Selectel test remains runtime
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; production is unchanged. D2 stays
  `in_progress` pending managing review, fast-forward integration and separately
  approved Selectel rollout/operator lookup.

### 2026-08-07 — D2 / administrator contact deferred to D5

- Owner decision: there is no official administrator contact source yet.
  Source selection and any clickable support/contact action are
  `deferred_to_D5_by_owner`; this is no longer a D2 rollout blocker.
- D2 retains truthful non-clickable text that cancellation and reschedule are
  performed through the club administrator. It must not invent a phone number,
  link, env setting or fallback.
- The independently reviewed vertical implementation remains exact checkpoint
  `4c7a4e4c7b75141c20beb48524aba9fb4891c653`. This follow-up is docs-only:
  application/backend/frontend/config/schema/runtime were not changed. Tests
  were not run because executable code did not change; `git diff --check` PASS.
- Deployment is `not_needed` for this docs-only decision record. No
  YCLIENTS/API/SSH/Selectel/DB call, provider write, secret access, push, merge
  or deployment occurred. Selectel test remains on
  `c04074459948d0bf545e865b885aea7a4e5fec3c`; production is unchanged.

### 2026-08-07 — D2 / Selectel test rollout applied, TMA smoke pending

- Git integration PASS: exact D2 branch checkpoint
  `b006263fe1f34d374791368cb3691fab89116a39` was pushed, `main` was
  fast-forwarded from `3e8739b2e9308976bccfd125883f03917fa22962` to that exact commit and
  pushed. The Selectel application checkout is clean and detached at the same
  exact SHA.
- A new 32-byte canonical base64 reservation-snapshot master key was generated
  on Selectel test outside Git. Only its non-secret host path and key version
  were added to the server `.env.test`; the key file is a regular non-symlink
  owned by `prostopadel:prostopadel` with mode `0600`. Host and backend runtime
  UID/GID match at `1000:1000`, and the runtime user can open all nine mounted
  secret files without their contents being printed.
- The approved migration-033 operator lookup ran inside a read-only transaction
  with `statement_timeout=5000ms` and `LIMIT 50`; result: `0 rows`. It selected
  no client snapshot, ciphertext, provider hash, contact data or token. No SQL
  write or migration was executed; migration 033 remains `applied_verified`.
- Compose quiet validation PASS. Exact backend/frontend images built PASS.
  Rollout recreated only backend and frontend:
  - backend: `8df1bf6b1947...` -> `29283ca28f29...`;
  - frontend: `efee81b73ca4...` -> `8af545a18ff4...`;
  - PostgreSQL stayed `5e36d4dc1a5c...`; nginx stayed `e5b98b53a385...`.
  All four containers are `running/healthy` with restart count `0`.
- Health/HTTP PASS: internal backend health returned the canonical `status=ok`
  response; HTTPS root `200`, HTTPS `/api/v1/health` `200`; unauthenticated
  `GET /api/v1/bookings` returned the expected fail-closed `401`.
- Log audit since rollout: backend `error/fatal/unhandled=0`, frontend
  `error=0`, nginx `error=0`. No provider create/PUT/DELETE call or other real
  YCLIENTS write was invoked during rollout/smoke; webhook remains disabled.
- Required real TMA smoke is not yet evidence-complete. Windows Telegram
  automation was unavailable and the isolated Telegram Web surface had no
  authenticated session. It was closed without login; no synthetic initData,
  account/session creation, booking create or provider call was attempted. An
  ordinary browser is not accepted as a Telegram smoke substitute.
- Deployment status remains `pending`, not `test_deployed`, until the owner
  opens the exact Selectel Mini App inside Telegram and confirms the read-only
  login/profile/reservation list/detail/refresh flow without submitting a
  booking. Production is unchanged.

### 2026-08-07 — D2 / TMA smoke PASS and late-slot diagnosis

- Owner confirmed the exact Selectel Telegram Mini App is working. The required
  read-only TMA smoke is PASS; no booking was submitted as part of this smoke.
  D2 deployment status is now `test_deployed` at exact application commit
  `b006263fe1f34d374791368cb3691fab89116a39`; production is unchanged.
- A bounded read-only YCLIENTS diagnosis used only the existing GET contracts
  and conservative one-request-per-second limiter. No create/PUT/DELETE or
  other provider write was invoked; no token, PII or raw provider body was
  printed.
- Provider evidence for `2026-08-08` proves Court 1 currently has a YCLIENTS
  resource working-window end of `22:00`, not `00:00`: latest starts are
  `21:00` for one hour, `20:30` for 1.5 hours and `20:00` for two hours. The
  same 1.5-hour cutoff was returned for the first three available dates, so the
  repeated late-day pattern is not explained by random bookings.
- Court 2 matches the approved club closing boundary at `00:00`: latest starts
  are `23:00` for one hour, `22:30` for 1.5 hours and `22:00` for two hours.
  Therefore `23:00` and `23:30` are correctly outside the allowed interval when
  1.5 hours is selected.
- Current UI maps every start absent from the provider's available-time list to
  the generic label `Занято`; it cannot distinguish an occupied interval from
  a resource schedule boundary. No code was changed in this diagnostic pass.
  Operational correction is to extend Court 1's YCLIENTS resource schedule to
  `00:00`; a separate optional UI correction may replace the generic label with
  truthful `Недоступно` unless a documented provider reason is available.

### 2026-08-07 — D2 / persisted-create datetime binding correction

- Owner TMA evidence showed the generic create failure for Court 6 on
  `2026-08-12` at `15:30` for 1.5 hours. Read-only diagnosis found two matching
  `POST /api/v1/bookings` responses with HTTP `503`, zero reservation/create
  operation rows in the preceding two hours and zero provider-attempt markers.
  The YCLIENTS write gate was enabled, but no provider create was dispatched;
  there is no duplicate or unknown provider outcome from those attempts.
- PII-safe PostgreSQL evidence identified the exact pre-dispatch cause: both
  transactions violated `court_reservations_target_check`. The repository used
  one parameter as both `$n::timestamptz` and the canonical text column. PostgreSQL
  inferred `timestamptz` for the parameter and implicitly rendered the text as
  `YYYY-MM-DD HH:MM:SS+00`, while migration 033 intentionally requires the
  canonical ISO `T` form.
- Corrected the repository to bind every paired target start/end value as text
  first, persist that exact text, and separately cast the same text to
  `timestamptz`. The correction covers initial reservation create, create
  operation start, terminal transition and administrator read-only refresh; no
  schema/migration, provider contract, payment field or frontend behavior was
  changed.
- Added a SQL contract regression that rejects the unsafe shared
  `timestamptz`-inferred parameter form and covers all ten paired conversions.
  Focused repository suite: `1 suite / 8 tests` PASS. Backend gates: typecheck
  PASS; unit `131 suites / 3272 tests` PASS; E2E `2 suites / 4 tests` PASS; build
  PASS. Root E2E PASS `84 passed / 1 skipped` on its owned Vite server; root
  build PASS (`1615` modules, existing chunk/CJS warnings only). The first root
  E2E attempt stopped before tests at the known managed-worktree esbuild
  `Access is denied` boundary; the identical unsandboxed command passed.
- `git diff --check` PASS (line-ending warnings only). No YCLIENTS/API write,
  migration, DB mutation, secret read, push, merge or deployment was performed
  for this correction. Deployment is `pending`: backend runtime changes and
  Selectel test still runs `b006263fe1f34d374791368cb3691fab89116a39` until a
  separate integration/rollout approval. Read-only P0/P1 review of the complete
  correction found no actionable issue: canonical text remains the authoritative
  persisted value, every paired timestamp derives from that same text, and
  provider dispatch/idempotency/runtime surfaces are unchanged. Production is
  unchanged.

### 2026-08-07 — D2 / datetime binding correction Selectel rollout

- Git delivery PASS: exact correction checkpoint
  `92c7af19f22fa20cc75c8c447015bda1ebc6ecaf` was pushed to
  `codex/week1-d2-reservation-core`; `main` was fast-forwarded from
  `b006263fe1f34d374791368cb3691fab89116a39` to the same exact commit and
  pushed. The clean local main worktree was fast-forwarded to the same SHA.
- Selectel test precheck PASS: application checkout was clean at `b006263...`,
  all four containers were healthy with restart count `0`, and the merged
  persistent-runtime Compose configuration passed quiet validation without
  printing secrets.
- Selectel fetched `origin/main`, proved the exact target SHA, detached the
  clean application checkout at `92c7af19...`, rebuilt the backend image and
  recreated only `prosto-padel-test-backend-1`. Backend container changed from
  `29283ca28f29...` to `b058838bcf95...`; PostgreSQL stayed
  `5e36d4dc1a5c...`, frontend stayed `8af545a18ff4...`, and nginx stayed
  `e5b98b53a385...`. All four are healthy with restart count `0`.
- Post-rollout HTTP PASS: internal health `200`, HTTPS health `200`, HTTPS root
  `200`, and unauthenticated `GET /api/v1/bookings` retained the fail-closed
  `401` boundary. Five-minute log audit: backend
  `error/fatal/unhandled=0`, nginx `error=0`, PostgreSQL
  `error/fatal/panic=0`.
- No migration, schema, DB write, secret change or provider request was made by
  the rollout. No YCLIENTS create/PUT/DELETE was invoked by the operator;
  production is unchanged. Runtime deployment is exact `92c7af19...` on
  Selectel test. Deployment correction remains `pending_manual_booking_smoke`
  until the owner submits one fresh booking in the Telegram Mini App and
  confirms the reservation appears in YCLIENTS; the operator must not submit a
  synthetic provider write as a substitute.

### 2026-08-07 — D2 / persisted reservation visible on Home

- Owner confirmed the fresh booking appeared in YCLIENTS. Read-only evidence
  shows its local reservation is retained as `pending_confirmation` with one
  started provider attempt and no terminal provider binding. The external
  create therefore must not be repeated. The exact reason the successful live
  result was not persisted as terminal is not provable from retained safe
  metadata and remains a separate fail-closed recovery concern.
- Root cause of the missing Home card was frontend-only: `Home` received the
  account match collection, while the owner-scoped persisted `GET /bookings`
  collection was consumed only inside `BookingScreen`. No persisted court
  reservation could reach the Home `Брони` tab.
- Added a narrow adapter and Home feed connection for future persisted owner
  reservations. `pending_confirmation`, `unknown`, `confirmed` and
  administrator-reflected `cancelled` use truthful labels; rejected or elapsed
  rows are not shown. Selecting a persisted reservation opens the booking
  screen/read-only detail path and cannot enter the legacy convert-to-match
  modal. No create retry, PUT, DELETE, cancel or reschedule action was added.
- Focused Playwright regressions PASS `2/2`: owner persisted booking mapping,
  Home rendering, pending label, read-only detail transition and zero booking
  writes. Full root E2E PASS `85 passed / 1 skipped`; root build PASS (`1616`
  modules, existing chunk/CJS warnings only). The first sandboxed build was
  blocked by managed-worktree filesystem traversal; the approved identical
  build outside that restriction passed. Backend tests were not run because no
  backend source, contract, dependency or runtime image changed.
- `git diff --check` PASS. Migration 033 remains `applied_verified`; schema,
  DB, YCLIENTS/provider and payment fields were not touched. Deployment is
  `pending`: this checkpoint changes the frontend bundle and requires a new
  exact integration/Selectel test rollout approval before it is visible in the
  Mini App. Selectel test still runs exact `92c7af19...`; production is
  unchanged.
- Read-only P0/P1 review found no actionable issue: the list is reachable only
  through the authenticated owner action, stale responses cannot overwrite a
  newer list request, the selected reservation ID is preserved for exact
  readback, and persisted bookings cannot enter legacy conversion or any
  provider-write surface.

### 2026-08-08 — D2 / customer-facing court labels and payment-status boundary

- Owner correctly identified that `5730531` is a YCLIENTS resource identifier,
  not a customer-facing court number. Persisted booking cards now resolve the
  selected resource through the existing authenticated read-only court catalog
  and display the provider label (`Корт №1`, `Корт №2`, etc.). Home performs
  sequential catalog reads for at most eight distinct service groups per app
  session; unavailable/invalid catalog data falls back to `Корт` and never
  exposes the internal resource ID. The booking detail card uses the same
  catalog.
- Product boundary clarified: reservation `pending_confirmation` means the
  YCLIENTS create/binding outcome is not yet canonically confirmed; it is not a
  payment status. A successful future D4 payment must not remove the booking
  from Home. The card remains in `Мои брони` with its court/date/time and D4 may
  add a separate truthful payment state such as paid only after payment proof.
  Payment must not turn an unresolved reservation binding into `confirmed`.
- No payment implementation or changes to `paymentStatus`, `ownerPaid`,
  `holdAmount` or `prepay` were made. No provider write, schema/migration,
  backend route or runtime cancel/reschedule surface was added.
- Focused Playwright PASS `3/3`; full root E2E PASS `85 passed / 1 skipped`;
  root build PASS (`1616` modules, existing chunk/CJS warnings only).
  Backend gates were not repeated because backend source and image did not
  change. `git diff --check` PASS. Deployment remains `pending`; Selectel test
  still runs exact `92c7af19...` until this frontend checkpoint receives a new
  push/integration/rollout approval. Production is unchanged.
- Read-only P0/P1 review found no actionable issue: catalog requests are
  authenticated GETs, serialized, deduplicated and capped across the app
  session; invalid/missing labels fail closed to a generic customer label, and
  neither resource lookup nor status rendering can dispatch a booking/payment
  write.

### 2026-08-08 — D2 / Home booking-card frontend rollout

- Git delivery PASS: `codex/week1-d2-reservation-core` was pushed at exact
  `d7812d3ef28eda7100bca6bdc5d56afa0be29703`; clean local `main` was
  fast-forwarded from `92c7af19f22fa20cc75c8c447015bda1ebc6ecaf` to the
  same exact commit and pushed.
- Selectel precheck PASS at clean checkout `92c7af19...`: persistent-runtime
  Compose validation passed, all four containers were healthy with restart
  count `0`, and internal root/health returned `200`.
- Selectel fetched and detached the clean application checkout at exact
  `d7812d3...`, built the frontend bundle and recreated only
  `prosto-padel-test-frontend-1`. Frontend container changed from
  `8af545a18ff4...` to `096935705c5c...`; backend stayed `b058838bcf95...`,
  nginx `e5b98b53a385...` and PostgreSQL `5e36d4dc1a5c...`. All remain healthy
  with restart count `0`.
- Postcheck PASS: internal root/health `200`; HTTPS root/health `200`; exact new
  asset `assets/index-DbLVbFo3.js` returned `200`; unauthenticated
  `GET /api/v1/bookings` retained the fail-closed `401` boundary. Fresh
  backend/frontend/nginx/PostgreSQL error-signal counts are all `0`.
- The operator made no YCLIENTS/provider call or write, DB/schema/migration,
  secret/env, backend, nginx or PostgreSQL change. Production is unchanged.
  Deployment verification remains `pending` only for the owner to reopen the
  exact Telegram Mini App and confirm the existing persisted booking is visible
  on Home with the correct `Корт №…` label and truthful status; ordinary browser
  smoke is not a Telegram authentication substitute.
- Owner subsequently reopened the exact Telegram Mini App and confirmed the
  persisted booking appears in `Главная → Брони`. The required real TMA Home
  booking-card smoke is PASS, so exact runtime `d7812d3...` is
  `test_deployed`. This confirms visibility only: the retained
  `pending_confirmation` state still requires a separate safe binding recovery
  and must not trigger another create or be treated as payment state.

### 2026-08-08 — D2 / PostgreSQL int4 reservation hydration correction

- A PII-safe, read-only Selectel diagnosis was run against exact deployed
  runtime `d7812d3ef28eda7100bca6bdc5d56afa0be29703`. The three latest create
  operations all had a started provider attempt, no finished marker, no local
  provider binding and one active hold. No database row was changed and no
  YCLIENTS/provider request was made.
- The encrypted client snapshots themselves decrypted successfully and passed
  the strict client shape and request-digest checks. Direct execution of the
  compiled repository hydration proved the exact failure: PostgreSQL `integer`
  crypto-version columns are returned by `pg` as runtime numbers, but the
  repository passed them to the canonical-decimal-string `bigint` decoder.
  Reservation hydration succeeded while operation hydration failed closed, so
  neither a successful terminal binding nor a stale `unknown` transition could
  be persisted.
- Added a separate strict positive PostgreSQL `int4` decoder and used it only
  for encryption/digest/AAD version columns. The existing strict `bigint`
  decoder remains unchanged. Regressions cover the real pg-driver number shape,
  reject strings/zero/negative/fraction/out-of-range values, hydrate a pending
  encrypted operation and hydrate a confirmed encrypted provider binding.
- This correction prevents the same failure for future create responses. After
  rollout, an old attempted pending operation can be classified safely as
  `unknown/held` and perform only the existing once-bounded readback. It is not
  promoted to `confirmed` without the complete persisted provider binding, and
  create is never repeated. Terminal recovery of an already lost response
  remains governed by `D2_UNKNOWN_CREATE_RECONCILIATION_PROPOSAL.md`.
- Verification PASS: focused unit `2 suites / 61 tests`; backend typecheck;
  backend unit `131 suites / 3282 tests`; backend E2E `2 suites / 4 tests`;
  backend build; root E2E `85 passed / 1 skipped`; root build (`1616` modules,
  existing CJS/chunk warnings only); `git diff --check`. The first sandboxed
  root build hit only the known managed-worktree esbuild `Access is denied`
  boundary; the approved identical build outside that boundary passed.
- Read-only P0/P1 review found no actionable issue: each schema `integer`
  crypto-version field now has the number-only int4 decoder, bigint IDs/times
  retain canonical string decoding, snapshot/hash plaintext is not logged, and
  no retry, provider, route, UI, payment or schema behavior was added.
- Deployment impact is `pending`: backend runtime changes. Selectel test remains
  exact `d7812d3...`; backend/frontend/nginx/PostgreSQL containers were not
  changed by diagnosis or local verification. Migration 033 remains
  `applied_verified`; production is unchanged.

### 2026-08-08 — D2 / PostgreSQL int4 hydration correction Selectel rollout

- Git delivery PASS: exact checkpoint
  `b2edf2348fffb0c5ba8647ad99b743b40ce79238` was pushed to
  `codex/week1-d2-reservation-core`; clean local `main` was fast-forwarded from
  `d7812d3ef28eda7100bca6bdc5d56afa0be29703` to the same checkpoint and pushed.
- Selectel test precheck PASS at clean checkout `d7812d3...`: persistent-runtime
  Compose validation passed, all four containers were healthy with restart
  count `0`, and internal health returned `200`.
- Selectel fetched and detached the clean application checkout at exact
  `b2edf234...`, rebuilt the backend image and recreated only
  `prosto-padel-test-backend-1`. Backend container changed from
  `b058838bcf95...` to `7a2cf73acede...`; frontend stayed
  `096935705c5c...`, nginx `e5b98b53a385...` and PostgreSQL
  `5e36d4dc1a5c...`. All four are healthy with restart count `0`.
- Postcheck PASS: internal health `200`, HTTPS health `200`, HTTPS root `200`,
  and unauthenticated `GET /api/v1/bookings` retained fail-closed `401`.
  Backend/frontend/PostgreSQL error-signal counts were `0`. Nginx recorded one
  expected transient upstream-connect failure during the backend replacement;
  the separate stable post-health window returned backend/nginx error-signal
  counts `0/0`.
- No migration, schema, DB write, secret/env, frontend/nginx/PostgreSQL change
  or operator YCLIENTS/provider request was made. Production is unchanged.
  Runtime deployment is exact `b2edf234...`; migration 033 remains
  `applied_verified`.
- Deployment verification is `pending_manual_fresh_booking_smoke`: the owner
  must submit one new booking in the exact Telegram Mini App and confirm it
  appears in YCLIENTS and in Home with local status `confirmed`. Existing
  lost-response bookings must not be submitted again by the operator and are
  not treated as payment proof.

### 2026-08-08 — D2 / persisted booking details navigation correction

- Owner TMA feedback proved that tapping a persisted booking on Home passed the
  correct owner-scoped reservation ID but opened the generic booking calendar;
  the exact reservation card was rendered only below that calendar. This was a
  frontend navigation/rendering defect, not a second provider create.
- `BookingScreen` now has an explicit reservation-details mode for a Home
  reservation ID. It performs the existing bounded exact authenticated read,
  shows a customer status label, club-timezone date/time, duration and mapped
  court, supports an explicit read-only refresh, and returns to Home through
  `Назад к моим броням`.
- Details mode fails closed when exact read is unavailable or rejected. It does
  not load availability services/dates/times, render the calendar or expose a
  create/cancel/reschedule action. The existing non-clickable administrator
  contact text is retained without inventing a phone, URL or fallback.
- A canonically synchronized `cancelled` reservation is no longer rendered in
  the active Home booking list. Its persisted audit/history row is retained;
  this is only an active-list presentation filter and never interprets a stale,
  pending or unknown reservation as cancelled.
- Regression coverage opens the Home booking, proves the details heading and
  fields, proves one exact read, zero booking writes and zero additional
  availability/catalog requests, proves absence of the calendar/create button,
  excludes a future cancelled reservation from active Home, and returns to
  Home.
- Verification PASS: focused E2E `2/2`; full root E2E
  `85 passed / 1 skipped`; root build PASS (`1616` modules, existing CJS/chunk
  warnings only); `git diff --check`. The first sandboxed build hit only the
  known managed-worktree esbuild `Access is denied` boundary; the identical
  approved build outside that boundary passed. Backend gates were not repeated
  because backend source did not change.
- Read-only P0/P1 review found no actionable issue: all hooks remain
  unconditional, exact-read failure cannot fall back to another reservation,
  details cannot dispatch availability/create calls, and no PII, payment field,
  provider PUT/DELETE, schema or backend behavior changed.
- Deployment impact is `pending`: frontend bundle changes. Selectel test still
  runs exact backend/application checkout `b2edf234...`; production is
  unchanged. A frontend-only rollout and real TMA booking-details smoke are
  required before this correction is `test_deployed`.

### 2026-08-08 — D2 / booking details frontend rollout and unbound inventory

- Git delivery PASS: exact checkpoint
  `02f746d58b202f2ff3a1ffa1641428597dcb44f6` was pushed to
  `codex/week1-d2-reservation-core`; clean local `main` was fast-forwarded to
  the same checkpoint and pushed.
- Selectel test fetched the exact clean checkpoint and rebuilt/recreated only
  `prosto-padel-test-frontend-1`. Its container ID changed from
  `096935705c5c...` to `52b8487ceba9...`; backend `7a2cf73acede...`, nginx
  `e5b98b53a385...` and PostgreSQL `5e36d4dc1a5c...` were unchanged. All four
  containers are healthy with restart count `0`.
- Postcheck PASS: internal health `200`, HTTPS health/root/new frontend asset
  `200`, unauthenticated `GET /api/v1/bookings` `401`, and backend/frontend/
  nginx/PostgreSQL error-signal counts in the stable five-minute window were
  all `0`. The frontend asset is `assets/index-CECF15bu.js`.
- A read-only PostgreSQL transaction with a five-second statement timeout
  inventoried four local reservations with no YCLIENTS record binding. All
  four are `pending_confirmation`; their latest create operation is `pending`,
  `provider_attempt_started_at` is present, `provider_attempt_finished_at` is
  absent, reconciliation has not run, and each retains one active slot hold.
  The PII-safe inventory is:
  - `94105b19-c497-4ff3-816b-bc28691daab5`: service `30539748`, resource
    `5730531`, `2026-08-12T20:30:00+03:00` for 1.5 hours;
  - `48c74dee-5248-4f75-8fc7-cfafc4a3223c`: service `30539748`, resource
    `5762274`, `2026-08-13T22:30:00+03:00` for 1.5 hours;
  - `d7a8a984-7131-4047-94da-38e39c5b597a`: service `30539748`, resource
    `5762274`, `2026-08-13T21:00:00+03:00` for 1.5 hours;
  - `1e1fa95a-c042-4141-a922-29a0d78bf61f`: service `30539694`, resource
    `5762280`, `2026-08-11T08:00:00+03:00` for 1.5 hours.
- The inventory transaction ended with `ROLLBACK`; no DB row changed. Manual
  deletion in YCLIENTS cannot canonically delete these local rows because the
  lost create responses left no persisted record/hash binding. Any cleanup of
  the four local rows and their holds requires a separate reviewed DB-write
  plan and explicit approval; no repeat create or provider cleanup is implied.
- No YCLIENTS/provider write, DB write, migration, backend/nginx/PostgreSQL
  rollout or production change was made. Owner TMA details/cancelled-list smoke
  remains the only rollout verification still requiring a manual check.

### 2026-08-08 — D2 / create finalization and deleted-readback correction

- The accepted read-only diagnosis proved a runtime control-flow defect after
  YCLIENTS create dispatch: the provider effect could already exist, while any
  exception or rejected transition from the atomic PostgreSQL finalization was
  collapsed by one generic `catch` into an `unknown` HTTP result. No durable
  fallback transition was attempted, so the database operation could remain
  `pending` with a started attempt and no binding until an owner detail read
  crossed the stale threshold. Home list reads did not invoke that exact owner
  refresh at all. This directly explains why the later manual YCLIENTS delete
  could not synchronize a locally unbound reservation.
- Migration 033 and the domain transition already support the safe terminal
  states: a strictly parsed create binding is written to reservation and
  operation atomically as `confirmed`; `unknown` keeps the active slot hold and
  records provider attempt completion without a binding. The exact historical
  PostgreSQL/provider-response trigger for the latest failed finalization is
  not recoverable from retained evidence because the old generic catch stored
  no failure category. This correction does not invent that cause: it adds a
  PII-safe allowlisted diagnostic containing only reservation/operation
  correlation IDs, finalization stage and classified persistence outcome.
- After a claimed provider dispatch, a failed/rejected `confirm` now performs
  exactly one fresh PostgreSQL `mark_unknown` finalization. It never repeats
  POST, never synthesizes a provider binding and never releases the hold. If
  PostgreSQL is still unavailable, the result remains truthful stale
  `pending_confirmation`; the existing stale owner-read classifier is retained
  as the later safe recovery path. Provider timeout, invalid response and other
  uncertain dispatched outcomes persist `unknown/held` through the same
  terminal path.
- A fully bound confirmed reservation whose exact GET returns canonical
  `not_found` now performs one bounded `with_deleted=true` page read for the
  exact stored day/resource/apiId/service/datetime. Local cancellation and hold
  release occur only for one exhaustive candidate with the same persisted
  record ID and `deleted=true`; a different/ambiguous/incomplete result remains
  confirmed but stale. No provider write, fallback window or blind retry was
  added.
- Home now exposes an explicit `Обновить` action for persisted bookings. One
  click first loads the owner list, performs at most three owner booking reads
  sequentially, then reloads the persisted list. The backend shared limiter
  continues to serialize provider reads. There is no timer/background polling,
  and an in-flight guard prevents concurrent refresh batches. A canonically
  synchronized cancelled booking disappears from the active Home list;
  pending/unknown are not hidden or reclassified.
- Regressions cover finalization persistence failure plus one unknown fallback,
  double persistence failure with one provider dispatch and PII-safe
  diagnostics, exact 404 + canonical deleted list proof, record mismatch and
  ambiguous candidates, bounded Home target selection, explicit refresh and
  zero frontend booking writes. Focused PASS: backend typecheck, `2 suites / 24
  tests`, Home E2E `1/1`. Full PASS: backend unit `132 suites / 3287 tests`,
  backend E2E `2 suites / 4 tests`, backend build; root E2E `85 passed / 1
  skipped`, root build (`1616` modules, existing CJS/chunk warnings only), and
  `git diff --check`. The first sandboxed root gate hit only the known managed
  worktree esbuild access boundary; the identical approved run outside that
  boundary passed.
- The five known legacy unbound test reservations and their holds were not
  changed or cleaned. No YCLIENTS/API/DB/server call, migration, payment field,
  webhook, cancel/reschedule route or provider write was made. Deployment
  impact is `pending`: backend and frontend runtime changed locally, while
  Selectel test remains exact `02f746d58b202f2ff3a1ffa1641428597dcb44f6` and
  production is unchanged. Required future test rollout smoke: one fresh TMA
  create must return/persist `confirmed`; then an administrator deletes that
  bound record in YCLIENTS and one explicit Home refresh must remove its active
  card, with health and PII-safe log review after each step.

### 2026-08-08 — D2 / create-finalization correction Selectel rollout

- Git delivery PASS: exact reviewed checkpoint
  `fa5eb38c6608d07c0140f39467dfebe3a058862b` was pushed to
  `codex/week1-d2-reservation-core`. Clean `main` was fast-forwarded from
  `02f746d58b202f2ff3a1ffa1641428597dcb44f6` to the same exact checkpoint;
  local and remote `main` both match it.
- Selectel precheck PASS at clean checkout `02f746d...`: backend, frontend,
  nginx and PostgreSQL were healthy with restart count `0`. Backend/frontend
  images built successfully from exact `fa5eb38...`; the application checkout
  was detached cleanly at that SHA and persistent-runtime Compose validation
  passed before any container replacement.
- Only backend and frontend were recreated. Backend changed from
  `7a2cf73acede...` to `d850a600e83a...`; frontend changed from
  `52b8487ceba9...` to `8a572cd993d3...`. Nginx remains
  `e5b98b53a385...` and PostgreSQL remains `5e36d4dc1a5c...`. All four are
  healthy with restart count `0`.
- Postcheck PASS: internal and HTTPS health/root returned `200`; exact frontend
  asset `assets/index-CMWbs4Ha.js` returned `200`; unauthenticated
  `GET /api/v1/bookings` retained the fail-closed `401` boundary. A separate
  stable twenty-second window found `0` error/exception/fatal/unhandled/panic
  signals in backend, frontend, nginx and PostgreSQL logs; all health states
  remained `healthy`.
- No migration/schema/DB write, operator YCLIENTS/provider call, secret/env,
  nginx/PostgreSQL container or production change occurred. Deployment remains
  `pending_manual_smoke`: the owner must create exactly one fresh booking in
  the Telegram Mini App and first prove the persisted state is `confirmed`.
  Only then should the same bound record be deleted manually in YCLIENTS and
  one explicit Home `Обновить` action used to prove the active card disappears.
  The five legacy unbound test reservations must not be resubmitted or cleaned
  by this smoke.

### 2026-08-08 — D2 / fresh create smoke STOP after finalization diagnostics

- The owner submitted exactly one fresh booking after the `fa5eb38...` rollout
  and confirmed that the record appeared in YCLIENTS. A bounded PostgreSQL
  `BEGIN READ ONLY` transaction with a five-second statement timeout inspected
  only PII-safe identifiers/status/flags for the newest local reservation
  `3d49b170-61a6-4b77-b497-ad62b4f414f6` and ended with `ROLLBACK`.
- Business smoke STOP: the reservation remained `pending_confirmation`; its
  create operation `e445ab50-e900-4d7f-b266-492d5f9740b5` remained `pending`,
  provider attempt was started but not finished, and reservation/operation
  record IDs plus encrypted record-hash binding were all absent. Therefore the
  strict prerequisite for manual deletion/read-only deleted sync was not met.
- The new allowlisted diagnostics narrowed the failure without exposing PII,
  token, record hash or raw provider body: the strictly parsed provider success
  reached `confirm_binding` and failed as `storage_failure`; the single fresh
  `persist_unknown_fallback` also failed as `storage_failure`. No second POST
  was sent.
- A second bounded read-only metadata check found valid operation time ordering,
  canonical target interval, PostgreSQL `integer` runtime shapes for all three
  crypto metadata versions, expected nonce/tag/digest lengths and a valid
  request-digest shape. Ciphertext and contact values were not read or printed.
  This rules out the previously fixed int4 metadata shape and operation timing
  as the new failure, but the current allowlist does not distinguish the common
  hydration/decryption/transition substage further.
- The owner must not delete this new YCLIENTS record, press create again or
  treat the local pending state as payment proof. Its local hold remains active.
  No DB/provider write, cleanup, migration, runtime/container/env or production
  change was made during diagnosis. Next permitted work must be a separate
  code-only diagnostic/correction slice followed by review and another exact
  rollout; the admin-delete/Home-refresh smoke remains blocked until a fresh
  booking persists a complete confirmed binding.
