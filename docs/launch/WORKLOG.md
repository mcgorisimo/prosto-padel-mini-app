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
| D2 YCLIENTS reservation core | done | closure history through exact cleanup source `4515549f58d714624a333fbb059dd4054b1e1439`; Selectel test runtime `ac5b4be4e88c6b45ec8d290a1c68e01a41dc635d` | migration 033 applied/verified; all automated gates PASS; create/delete sync, admin-reschedule T1-T4, repeated-refresh no-churn, fully-bound cleanup and eight-row legacy cleanup live acceptance PASS | D2 closed; next stage is D3 match ↔ reservation lifecycle; payment, webhook and production remain separate gates |
| D3 Match ↔ reservation lifecycle | done | Selectel test runtime `78a1cef68f74854a9d6e316ffd235ffbd42b38f8` | migration 034 `applied_verified`; root E2E 91/1 skipped and build PASS; owner TMA unbooked/ЮKassa fail-closed smoke, health/assets/exact logs PASS | D3 closed; real ЮKassa payment, paid YCLIENTS create/link and compensation belong to D4 |
| D4 Payment Core | in_progress | foundation `3f1fe58`; persistence/concurrency contract `main` / `origin/main` `6477cac` | D4.1 focused 2/28, full gates and P0/P1 review PASS; docs-contract local gates and P0/P1 review PASS; deployment `not_needed` | next repository/mock-concurrency code slice requires a separate command; SQL, provider/fiscal selection and runtime remain separate gates |
| D5 Settings/moderation/compliance | pending | — | — | standalone phone/email auth, verified backend email, approved club support/contact source and clickable action; затем schema review |
| D6 Selectel readiness/load | pending | — | — | backend staging fixture, live concurrency и Selectel production readiness |
| D7 Release candidate | pending | — | — | после D1–D6 |
| Mobile/store track | pending | — | — | developer account status и native decision |

Статусы: `pending`, `in_progress`, `blocked`, `done`, `reopened`.

## Deployment status

| Этап | Среда | Целевой commit | Статус | Проверка |
|---|---|---|---|---|
| D1 Backend-only/contracts | Selectel test | `c04074459948d0bf545e865b885aea7a4e5fec3c` | `test_deployed` | frontend healthy; HTTPS root/health и новый asset 200; TMA auth/profile/feed/details/booking availability PASS; bundle/log audit PASS |
| D2 YCLIENTS reservation core | Selectel test | `ac5b4be4e88c6b45ec8d290a1c68e01a41dc635d` | `test_deployed` | backend-only rollout health/log/auth PASS; create/delete and admin-reschedule matrix remain proved; three unchanged owner refreshes preserved reservation version and hold counts |
| D3 Match ↔ reservation lifecycle | Selectel test | `78a1cef68f74854a9d6e316ffd235ffbd42b38f8` | `test_deployed` | all containers healthy/restart 0; HTTPS root/health and exact asset 200; owner TMA proved paid-court entry disabled and existing unbooked-match action visible/fail-closed; booking POST 0; exact nginx 5xx 0 |
| D2 persistence/privacy proposal | not applicable | docs-only checkpoint | `not_needed` | только Markdown; runtime, schema, containers и конфигурация не менялись |
| D2 YCLIENTS contract matrix | not applicable | docs-only checkpoint поверх `3e8739b` | `not_needed` | только Markdown; API/DB/server/runtime не вызывались и не менялись |
| D2 YCLIENTS controlled test plan | not applicable | `040773172a2fa556ffaaf1d12dac540095070976` + docs-only correction from that exact base | `not_needed` | plan only; provider/server/DB/runtime calls и writes не выполнялись |
| D2 YCLIENTS read foundation | not applicable | correction `7fedddd5daf2e817aa977509ab120879915a8f26` + live-contract correction from that exact base | `not_needed` | code не импортирован Nest modules/controllers/runtime; image, config, server и containers не менялись |
| D3 match ↔ reservation audit | not applicable | docs-only checkpoint on `codex/week1-d3-match-reservation` | `not_needed` | Markdown only; runtime, schema, containers, YCLIENTS and Selectel test were not changed |

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

### 2026-08-08 — D2 / post-dispatch create finalization control projection

- This local correction starts from clean docs/evidence HEAD
  `97b79cccabb152492a5b07c91a5d34800f646526`; Selectel test remains exact
  runtime `fa5eb38c6608d07c0140f39467dfebe3a058862b`. No Selectel, YCLIENTS or
  PostgreSQL call was made in this slice.
- The retained live evidence proves that both `confirm_binding` and the fresh
  `mark_unknown` fallback failed inside their common repository persistence
  path, but it does not prove which encrypted-snapshot field or SQL statement
  produced the old generic `storage_failure`. The code-level failure boundary
  was exact: both post-dispatch transitions unnecessarily joined and decrypted
  the full PII client snapshot before they could persist a provider result.
- Claimed create finalization now locks the owner reservation and exact create
  operation, then compares a PII-free persisted control projection against the
  already-started immutable operation: owner/actor/reservation/operation IDs,
  type/status, idempotency key, request digest, external API ID, target,
  previous status, created time and provider-attempt markers. Only an exact
  match may reach the unchanged domain transition and atomic reservation plus
  operation updates. The finalizer does not select/decrypt client ciphertext;
  a mismatch fails closed before either update. It accepts only `confirm` or
  `mark_unknown`, never a retrying provider action.
- Booking contact is now checked with the same strict client-snapshot validator
  before persistence/provider dispatch, closing the validation/rehydration
  mismatch. Logs still receive only reservation/operation correlation IDs,
  business stage, allowlisted outcome and a new allowlisted persistence stage;
  no contact value, token, record hash, ciphertext or raw error is emitted.
- Regression coverage proves strict control-row matching, row locks, zero
  client-snapshot join/decrypt during finalization, no PII/hash in SQL values or
  diagnostics, fail-closed mismatch before updates, one provider dispatch and
  fresh unknown fallback behavior. Focused PASS: backend typecheck and `3
  suites / 37 tests`. Full PASS: backend unit `132 suites / 3290 tests`, backend
  E2E `2 suites / 4 tests`, backend build; root E2E `85 passed / 1 skipped` and
  root build (`1616` modules, existing CJS/chunk warnings only). The first
  sandboxed root build hit the known managed-worktree esbuild access boundary;
  the identical approved build outside that boundary passed. `git diff
  --check` PASS (line-ending warnings only).
- The live YCLIENTS record from the stopped smoke and its local
  `pending_confirmation`/held reservation were not read, retried, deleted or
  changed. Migration 033, schema, payment fields, provider contracts and
  frontend are unchanged. Independent read-only review found no actionable
  P0/P1. Deployment impact is `pending_integration_rollout`: backend runtime
  code changed locally, while push/merge/deploy are explicitly outside this
  correction gate. A new live booking must not be attempted before this clean
  checkpoint is integrated and rolled out separately.

### 2026-08-08 — D2 / control-projection rollout and fresh create smoke STOP

- Git delivery PASS: exact checkpoint
  `507896ff67077dc146618f146cb7ed484a1a1aae` was pushed to
  `codex/week1-d2-reservation-core`; clean local `main` was fast-forwarded from
  `fa5eb38c6608d07c0140f39467dfebe3a058862b` to the same exact SHA and pushed.
- Selectel test precheck PASS at clean checkout `fa5eb38...`: Compose config was
  valid, all four containers were healthy with restart count `0`, and proxy
  health returned `200`. The server fetched `origin/main`, proved exact
  `507896f...`, detached the clean application checkout at it, built the
  backend image and recreated only `prosto-padel-test-backend-1`.
- Backend changed from `d850a600e83a...` to `a3bf38ef947e...`. Frontend remains
  `8a572cd993d3...`, nginx `e5b98b53a385...` and PostgreSQL
  `5e36d4dc1a5c...`. All four remained healthy with restart count `0`.
  Internal/external health and root returned `200`; unauthenticated bookings
  retained `401`. A separate stable twenty-second audit found zero
  error/fatal/unhandled/panic/exception signals in every container.
- The owner then created exactly one fresh Telegram Mini App booking for
  service `30539694`, resource/court `5762283`, starting
  `2026-08-15T07:00:00+03:00`. The strict provider-created branch was reached,
  but the UI and PostgreSQL reservation
  `953f1810-9a65-4a1b-bee5-c2b9d9cd4f12` remained
  `pending_confirmation`; operation
  `1b183ad8-3cd4-4788-b7f8-79805f326cce` remained `pending` with a started but
  unfinished provider attempt and no appointment/record/encrypted-hash binding.
- The new allowlisted diagnostic proved the narrower shared failure point:
  both `confirm_binding` and the single `persist_unknown_fallback` failed as
  `storage_failure` at `operation_update`. The reservation update was rolled
  back atomically in both transactions; no partial binding or false confirmed
  state exists, and the slot hold remains active. No second POST was sent.
- Read-only catalog verification found the runtime migration-033 operation
  constraints present, no custom trigger on `reservation_operations`, and all
  eighteen columns used by the update granted to `backend_auth_app`. Operation
  times were ordered (`created_at=1786189969`, provider attempt and current
  update at `1786189970`). The exact SQLSTATE/constraint name was not retained
  by the allowlist, so this evidence does not claim a more specific low-level
  cause. Every PostgreSQL inspection used `BEGIN READ ONLY`, a five-second
  statement timeout and `ROLLBACK`; no client-snapshot/raw PII row, token,
  ciphertext, record hash or provider body was read or printed.
- Smoke status is `STOP / pending_confirmation`, not PASS. The owner must not
  submit this request again or delete/treat the provider record as locally
  confirmed. Runtime stays healthy at exact `507896f...`; production is
  unchanged. A separate reviewed code-only correction is required before any
  further live create smoke. Its minimum scope is safe classification of the
  `operation_update` SQL failure plus a regression against the exact
  migration-033 terminal/time constraints; no migration or provider retry is
  implied by this evidence.

### 2026-08-08 — D2 / operation-update monotonic-time correction

- This code-only correction starts from local evidence HEAD `9d755566796e9deaee0896a712994181845dee0a`.
  Selectel test remains on exact runtime `507896ff67077dc146618f146cb7ed484a1a1aae`;
  no YCLIENTS, PostgreSQL, SSH/server, provider or production call/write was
  made. The existing pending reservation and its active hold were not changed,
  retried or cleaned.
- A migration-033 regression now reproduces the operation-update failure class:
  a claimed provider attempt may have a persisted start/update second newer
  than a final application timestamp. The repository previously wrote that
  raw timestamp as `provider_attempt_finished_at`, `terminal_at`/`unknown_at`
  and `updated_at`, which can violate the exact
  `reservation_operations_time_check` ordering. This is a proven code/schema
  defect matching the failed statement class; the retained live evidence still
  does not claim the exact historical SQLSTATE or constraint name.
- Claimed-create finalization now derives one monotonic effective timestamp
  from the locked reservation update time, immutable operation creation time,
  persisted provider-attempt start and persisted operation update time. Both
  confirm and fail-closed unknown transitions use that same timestamp
  atomically. No provider binding is synthesized, no parser is weakened and no
  POST/retry path was added.
- Persistence diagnostics now preserve only an allowlisted semantic cause.
  Migration-033 time, terminal-shape and provider-binding checks have fixed
  public cause names; unknown check violations and other SQLSTATE classes are
  reduced to fixed categories. Raw SQLSTATE, arbitrary constraint/detail,
  error message, row values, contact PII, token and record hash are discarded.
- Regression coverage proves the one-second clock case, exact migration-033
  ordering text, the `operation_update` stage/cause mapping, generic handling
  of an unknown constraint name, absence of private values, and propagation
  through the PII-safe booking diagnostic sink. Focused PASS: backend typecheck
  and `4 suites / 46 tests`. Full PASS: backend typecheck, unit `132 suites /
  3291 tests`, E2E `2 suites / 4 tests`, and build; root build PASS (`1616`
  modules). Parallel root E2E attempts exposed unrelated WebKit resource
  timeouts (`78/1/7`, then `82/1/3`); the identical full suite with one worker
  passed `85/1` without code or assertion changes. `git diff --check` PASS.
- Independent read-only review of all nine changed files is CLEAN: no
  actionable P0/P1. It confirmed the migration-033 clock regression would fail
  on the previous code, the single effective timestamp covers both confirm and
  unknown finalization, raw PostgreSQL metadata cannot cross the diagnostic
  boundary, and no provider/runtime/schema/payment surface was added.
- Migration 033 and all schema/payment/frontend/runtime wiring remain
  unchanged. Deployment impact is `pending_integration_rollout`: backend code
  changes are local only. No further live booking or cleanup is permitted by
  this checkpoint; integration/Selectel rollout and a new controlled create
  smoke require a separate explicit gate after independent review.

### 2026-08-08 — D2 / monotonic finalization backend-only rollout

- Git delivery PASS: exact reviewed checkpoint
  `59c2b9499116642f441772be41bc77a6d7c85900` was pushed to
  `codex/week1-d2-reservation-core`; clean local `main` fast-forwarded from
  `507896ff67077dc146618f146cb7ed484a1a1aae` to the same exact SHA and pushed.
- Selectel test precheck PASS: application checkout was clean at `507896f...`,
  fetched `origin/main=59c2b94...`, then detached cleanly at the exact reviewed
  SHA. Compose config validation passed using the existing approved
  `compose.yaml`, `compose.runtime-backend.yaml` and server-side `.env.test`.
- Only the backend image was rebuilt and only
  `prosto-padel-test-backend-1` was recreated. Its container ID changed from
  `a3bf38ef947e...` to `a456e881a5b6...`. PostgreSQL remained
  `5e36d4dc1a5c...`, frontend `8a572cd993d3...`, and nginx
  `e5b98b53a385...`; all four are `healthy` with restart count `0`.
- Stable-window postcheck PASS: proxy root and health returned `200`,
  unauthenticated `GET /api/v1/bookings` retained `401`, and backend/frontend/
  nginx/PostgreSQL each had zero `error|fatal|unhandled|panic|exception`
  markers in the bounded post-rollout log window. Final server checkout is
  clean and exact `59c2b949...`.
- No migration/schema/DB write, YCLIENTS/provider call, booking create, env or
  secret change, frontend/nginx/PostgreSQL rebuild, cleanup or production
  change occurred. Deployment status is `pending_manual_booking_smoke`: the
  next step is exactly one new Telegram Mini App booking, which must persist as
  `confirmed` before any manual YCLIENTS deletion/read-only refresh check.
  Existing pending reservations must not be resubmitted.

### 2026-08-09 — D2 / provider-finish bigint SQL correction

- The owner created the single permitted fresh smoke booking after rollout
  `59c2b9499116642f441772be41bc77a6d7c85900`; the corresponding record appeared
  in YCLIENTS, but the app remained `pending_confirmation`. Read-only diagnosis
  confirmed reservation `b286b04e-66af-4237-84fb-10bc2a9c99c9` and operation
  `7f1be31c-998d-4cd1-8564-c476fdcade94` stayed unbound/pending with exactly one
  started and unfinished provider attempt. The slot hold remains active.
- The new diagnostic allowlist reported both `confirm_binding` and the single
  `persist_unknown_fallback` as `storage_failure / operation_update /
  unknown_postgres_error`. A bounded PostgreSQL log check read only the `ERROR`
  header in the exact failure minute, excluding DETAIL/STATEMENT/parameters:
  PostgreSQL reported that `provider_attempt_finished_at` is `bigint` while the
  `CASE` expression was inferred as `text`. This occurred twice, matching the
  confirm transaction and fail-closed unknown fallback. No PII, token,
  ciphertext, record hash or raw provider body was read or printed.
- Root cause is exact: `CASE WHEN provider_attempt_started_at IS NULL THEN NULL
  ELSE $14 END` did not provide PostgreSQL a numeric type for either branch.
  The repository now uses `NULL::bigint` and `$14::bigint`; no migration/schema
  change is needed. The previously added monotonic effective timestamp remains
  unchanged and its live ordering was valid.
- Reservation-local error classification now maps SQLSTATE `42804` only to the
  fixed semantic cause `datatype_mismatch`. The shared PostgreSQL classifier
  and unrelated repositories remain unchanged. Raw code/message/statement and
  arbitrary metadata still cannot cross the booking diagnostic boundary.
- Regression coverage asserts the exact typed SQL fragment, the
  `operation_update / datatype_mismatch` projection, discarded raw error text,
  unchanged fresh unknown fallback and migration-033 time invariants. Focused
  PASS: backend typecheck and `5 suites / 77 tests`. Full PASS: backend
  typecheck, unit `132 suites / 3291 tests`, E2E `2 suites / 4 tests`, build;
  root E2E `85 passed / 1 skipped` with one worker and root build (`1616`
  modules, existing warnings only). `git diff --check` PASS.
- Independent read-only review is CLEAN with no actionable P0/P1. It confirmed
  the explicit casts close the observed `42804`, the mapping is reservation-
  local, atomic confirm/unknown and one-dispatch safety are unchanged, and raw
  database/provider/contact data cannot cross the diagnostic boundary.
- This correction is code-only and local. No DB/YCLIENTS/provider/server call
  occurred after the read-only diagnosis; no existing reservation/hold was
  changed, retried or cleaned. Selectel test remains exact `59c2b94...` and
  deployment is `pending_integration_rollout`. A new booking is forbidden until
  this checkpoint passes independent review and a separate backend-only rollout.

### 2026-08-09 — D2 / provider-finish bigint backend-only rollout

- Git delivery PASS: exact reviewed checkpoint
  `743386c7d0626cf253e92934f5bf5923e6ba1c26` was pushed to the D2 branch;
  clean local `main` fast-forwarded from `59c2b9499116642f441772be41bc77a6d7c85900`
  to the same SHA and was pushed without a merge commit.
- Selectel test precheck PASS at clean exact `59c2b94...`; `origin/main` was
  fetched and verified as `743386c...`, the application checkout detached
  cleanly at that SHA, and the existing two-file Compose config plus server-side
  env validation passed.
- Only the backend image was rebuilt and only
  `prosto-padel-test-backend-1` was recreated. Its ID changed from
  `a456e881a5b6...` to `040cb8968cfe...`. PostgreSQL stayed
  `5e36d4dc1a5c...`, frontend `8a572cd993d3...`, nginx
  `e5b98b53a385...`; every container is healthy with restart count `0`.
- Stable-window postcheck PASS: proxy root and health returned `200`,
  unauthenticated bookings retained `401`, and bounded critical-marker counts
  were zero for backend/frontend/nginx/PostgreSQL. Final server checkout is
  clean and exact `743386c...`.
- No migration/schema/DB write, YCLIENTS/provider call, booking create, env or
  secret change, frontend/nginx/PostgreSQL rebuild, cleanup or production
  change occurred. Deployment is `pending_manual_booking_smoke`: the owner may
  now submit exactly one new previously unused slot through Telegram Mini App.
  Existing pending reservations must not be resubmitted or deleted during this
  smoke; the fresh result must first be proved `confirmed` locally.

### 2026-08-09 — D2 / primary-tab pull-to-refresh checkpoint

- The post-rollout create smoke for exact `743386c...` reached the intended
  terminal state: reservation `2cf39988-358d-4009-b64c-c017d3c1d0b5` and its
  create operation were persisted `confirmed`, with the complete encrypted
  YCLIENTS binding and both provider-attempt timestamps. The owner then deleted
  the bound record in YCLIENTS and used the existing explicit refresh. Access
  logs prove the owner exact-read route was called, but PostgreSQL remained
  `confirmed` with one active hold and seven reconciliation attempts. This
  narrows the remaining defect to fail-closed deleted-record classification;
  the frontend gesture in this checkpoint does not relax that proof boundary.
- By owner decision, normal refresh UX is now pull-to-refresh rather than a
  button. A shared touch component runs only from the top of the current page,
  requires a vertical threshold, ignores horizontal/short/multitouch gestures,
  rejects a second refresh while one is active and shows an accessible loading
  indicator. Reduced-motion is respected and no dependency was added.
- All five primary bottom-navigation sections are covered. Home refreshes the
  bounded owner booking set, account matches and backend profile; Matches
  refreshes the backend feed; Booking refreshes availability and, when present,
  the exact owner reservation; Rating refreshes account/profile data; Profile
  refreshes profile, account matches, invitations and notifications. Home and
  both booking views no longer expose ordinary refresh buttons. Existing error
  retry actions are unchanged.
- The booking refresh remains read-only and bounded: at most the existing three
  owner reservations are reconciled sequentially, and no POST/PUT/DELETE,
  cancel/reschedule route, payment field, schema, migration, secret or provider
  write was introduced. Backend source is unchanged, so backend suites were not
  required for this frontend-only slice.
- Focused WebKit PASS: pull gesture `3/3`; affected booking/Home suites `32/32`.
  Final full root E2E PASS: `88 passed / 1 skipped` with one worker. Root build
  PASS (`1617` modules; existing chunk/CJS warnings only). `git diff --check`
  PASS. Read-only P0/P1 review found no actionable issue in gesture gating,
  bounded refresh mapping, credential handling or write boundaries.
- Deployment impact is `pending_integration_rollout`: the frontend bundle and
  AuthGate/App runtime changed locally and are not yet pushed, merged or
  deployed. Selectel test remains healthy on exact `743386c...`; its containers,
  DB, env and production were not changed by this checkpoint. The outstanding
  deleted-record reconciliation defect remains a separate backend correction.

### 2026-08-09 — D2 / exact deleted record without provider api_id correction

- Gate `97e8b418a9f77b3b659dd60515a89ca4ba84600f` was pushed to the
  D2 branch, fast-forwarded into `main` and deployed frontend-only to Selectel
  test. The owner confirmed the pull-to-refresh gesture in Telegram. Only the
  frontend container changed; backend, nginx and PostgreSQL remained healthy
  with restart count `0`.
- The same gesture did not remove the manually deleted booking. A bounded
  `BEGIN READ ONLY` PostgreSQL check found the latest fully-bound reservation
  `2cf39988-358d-4009-b64c-c017d3c1d0b5` still `confirmed`, its create
  operation `confirmed`, reconciliation attempts `9` and one active hold.
  No ciphertext, record hash, contact PII or secret was selected.
- Two bounded read-only exact YCLIENTS checks used the existing strict admin
  parser; the first retained only the outcome and the second only allowlisted
  boolean presence/equality flags. Exact GET returned `found` with the same
  company/record/resource/service/datetime, positive duration and
  `deleted=true`, but provider `api_id` was absent. The 404-only deleted-list
  fallback was therefore not called. No provider write or raw body was read or
  retained.
- Root cause is exact: the booking refresh rejected every exact result without
  `api_id` before reaching persistence, even when the already-bound exact
  record was canonically deleted. The correction permits an absent provider
  `api_id` only for `deleted=true` from the exact-record path and only when the
  reservation plus terminal create operation both carry the same persisted
  YCLIENTS `recordId`. Active exact records and the bounded-list/404 fallback
  still require the original external `api_id`; mismatched, malformed or
  extra-field proof objects fail closed before reservation/hold mutation.
- Regression coverage proves the live response shape becomes `cancelled` and
  releases the hold, while an active missing-ID record, a different record,
  an extra-field proof and a mismatched API ID remain stale/held. Focused PASS:
  backend typecheck and `2 suites / 43 tests`. Full PASS: backend unit
  `132 suites / 3298 tests`, E2E `2 suites / 4 tests`, build; root E2E
  `88 passed / 1 skipped` with one worker and root build (`1617` modules,
  existing CJS/chunk warnings only). The first root build attempt was blocked
  by the local filesystem sandbox; the identical approved rerun passed.
- Independent read-only review is CLEAN with no actionable P0/P1. It confirmed
  the proof marker is internal-only, owner/company/reservation and terminal
  create bindings are revalidated under the transaction, exact-404/list stays
  API-ID strict, and cancellation plus active-hold release remain atomic.
- Migration 033, schema, frontend, payment fields and provider write surfaces
  are unchanged. No DB write, booking create, DELETE/PUT/POST, cleanup,
  production change, push, merge or deployment was performed by this
  correction. Deployment impact is `pending_integration_rollout`: Selectel
  backend remains the previously built `743386c...` image until separate
  review and backend-only rollout approval.

### 2026-08-09 — D2 / exact deleted record backend rollout and smoke

- Git delivery PASS: reviewed checkpoint
  `9bee483119a829de4ed74c20d94271ab740d6bcc` was pushed to the D2
  branch, clean `main` fast-forwarded from `97e8b418...` to the same exact SHA
  and both remote refs were verified without a merge commit.
- Selectel test fetched and detached cleanly at exact `9bee483...`; the existing
  two-file Compose configuration passed validation. Only the backend image was
  rebuilt and only `prosto-padel-test-backend-1` was recreated, changing its ID
  from `040cb8968cfe...` to `81dfc03e2f1e...`. Frontend remained
  `0fd5cbb20a80...`, nginx `e5b98b53a385...` and PostgreSQL
  `5e36d4dc1a5c...`; all four are healthy with restart count `0`.
- Post-rollout checks PASS: root and health returned `200`, unauthenticated
  bookings retained `401`, and bounded backend critical-log markers were zero.
  The owner then used Telegram pull-to-refresh once; the previously deleted
  fully-bound reservation `2cf39988-358d-4009-b64c-c017d3c1d0b5`
  disappeared from the app. A bounded `BEGIN READ ONLY` postcheck proved local
  status `cancelled`, reconciliation attempt `10` and active hold count `0`.
- Read-only legacy inventory found eight older unbound local test reservations:
  six remain `pending_confirmation/pending` and two `unknown/unknown`; none has
  a reservation or operation YCLIENTS record binding and every one retains one
  active local hold. They cannot receive canonical deleted-record proof and
  therefore remain visible fail-closed. No cleanup or status/hold mutation was
  performed; any archival/removal requires a separate exact DB cleanup gate.
- No new booking, provider POST/PUT/DELETE, migration/schema/env/secret,
  frontend/nginx/PostgreSQL rebuild or production change occurred. Selectel
  test deployment is exact `9bee483...`; the deleted-record correction is
  `test_deployed` and verified, while legacy unbound cleanup remains separate
  D2 work.

### 2026-08-09 — D2 / create-finalization and active-list acceptance checkpoint

- The eight legacy unbound reservations and `.env.test` ownership investigation
  are explicitly deferred by the owner. Their reviewed cleanup artifacts remain
  preserved in the separate `codex/week1-d2-reservation-core` branch and were
  not executed, merged or included in this primary-flow branch.
- The earlier `confirm_binding/storage_failure` root cause is proved and already
  fixed in deployed history: PostgreSQL inferred the untyped
  `provider_attempt_finished_at` `CASE` as text, producing SQLSTATE `42804`.
  Commit `743386c7d0626cf253e92934f5bf5923e6ba1c26` made both branches explicit
  `bigint`; the next fresh create persisted one complete encrypted provider
  binding and atomically reached `confirmed`. No create retry or second YCLIENTS
  record was used.
- The deployed `9bee483119a829de4ed74c20d94271ab740d6bcc`
  correction remains strict: only the same fully-bound terminal create record
  may use exact `deleted=true` without provider `api_id`; an active missing-ID
  record, different record, malformed result or ambiguous list stays stale and
  held. The proved Selectel chain is: fresh app create → local confirmed/full
  binding → administrator deletion in YCLIENTS → owner pull-to-refresh → booking
  absent from active UI → persisted `cancelled` with zero active holds.
- Added explicit regression names for the two acceptance boundaries: one strict
  provider create finalizes exactly once with full appointment/record/hash
  binding, and a refreshed `cancelled` reservation is excluded from active Home.
  Existing regressions continue to cover exact deleted-without-API-ID, active
  missing-ID fail-closed, foreign record mismatch, post-dispatch storage failure
  fallback without duplicate POST and pull-to-refresh read-only behavior.
- Focused PASS: backend booking service `1 suite / 28 tests`; root booking WebKit
  `12/12`. Full PASS: backend typecheck, unit `132 suites / 3299 tests`, E2E
  `2 suites / 4 tests`, build; root E2E `89 passed / 1 skipped`; root build
  `1617` modules with existing CJS/chunk warnings only. The first direct
  Playwright invocation had no owned Vite server and is not evidence; the exact
  focused file then passed through the required owned-server `test:e2e` harness.
- This checkpoint changes only tests and launch evidence; production runtime,
  backend/frontend bundles, migration 033, schema, payment fields, webhook and
  app-originated cancel/reschedule surfaces are unchanged. Deployment impact is
  `not_needed` for this test/docs checkpoint. Selectel test remains exact
  `9bee483...`; no YCLIENTS/API/DB/server call or write, push, merge, deploy or
  production change occurred.

### 2026-08-09 — D2 / booking-screen alignment correction

- The owner confirmed the primary acceptance flow on Selectel test: an
  administrator-deleted YCLIENTS booking disappears from the booking section
  after application refresh, and the read-only synchronization is working.
  This checkpoint changes only the visual post-create behavior reported in the
  same Telegram smoke; it does not alter that reconciliation contract.
- The booking date and court horizontal strips now remain inside their parent
  bounds with symmetric edge spacing. After a successful create, the page
  returns to its top, the success confirmation is shown once as an inline
  status below availability, and the duplicate global success toast no longer
  covers the date controls. Error and unknown-outcome notifications are
  unchanged.
- The focused WebKit regression proves symmetric strip bounds, one inline
  success status, no global success toast and scroll position `0`: `1/1` PASS.
  Final full root E2E PASS: `89 passed / 1 skipped` with one worker. The first
  default-parallel run produced three unrelated 30-second timeouts
  (`86 passed / 1 skipped`); all three passed in a focused single-worker rerun,
  and the complete single-worker rerun then passed. Root build PASS (`1617`
  modules; existing CJS/chunk warnings only). `git diff --check` PASS.
- Read-only P0/P1 review found no actionable issue. The diff contains no
  backend, API, DB, migration, payment-field, provider write, cancellation or
  reschedule change. Backend suites were not needed for this frontend-only
  correction.
- Deployment impact is `pending_integration_rollout`: the frontend bundle is
  changed locally and still requires an explicit push/fast-forward and
  frontend-only Selectel test rollout. Selectel test remains on exact runtime
  `9bee483119a829de4ed74c20d94271ab740d6bcc`; no server, container, YCLIENTS,
  database or production action was performed by this checkpoint.

### 2026-08-09 — D2 / booking-screen alignment frontend rollout

- Git delivery PASS: exact checkpoint
  `5daa2c0ba3884d0024f115bf6b4c1805e60f468d` was pushed to
  `codex/week1-d2-create-delete-sync`; clean local `main` fast-forwarded from
  `9bee483119a829de4ed74c20d94271ab740d6bcc` to the same SHA and `main` was
  pushed without a merge commit.
- Selectel test precheck PASS at clean detached `9bee483...`: the two-file
  Compose configuration was valid, all four containers were healthy with
  restart count `0`, internal root/health returned `200` and unauthenticated
  bookings retained `401`.
- The application checkout fetched and detached cleanly at exact `5daa2c0...`.
  Only the frontend image was rebuilt and only
  `prosto-padel-test-frontend-1` was recreated. Its ID changed from
  `0fd5cbb20a80...` to `76839a2ae14c...`; backend remained
  `81dfc03e2f1e...`, nginx `e5b98b53a385...` and PostgreSQL
  `5e36d4dc1a5c...`. Every container is healthy with restart count `0`.
- Postcheck PASS: internal and HTTPS root/health returned `200`, exact frontend
  asset `assets/index-CPjKRAcu.js` returned `200`, unauthenticated bookings
  returned `401`, and bounded critical-marker counts were `0` for backend,
  frontend, nginx and PostgreSQL. The server checkout is clean and exact
  `5daa2c0...`.
- No backend, nginx or PostgreSQL rebuild, DB/schema/migration/env/secret,
  YCLIENTS/API/provider call or write, payment-field, production or cleanup
  action occurred. Automated rollout is `test_deployed`; the remaining gate is
  one owner Telegram Mini App smoke confirming the booking screen stays aligned
  and the inline success message does not cover the date/court controls.

### 2026-08-09 — D2 / fixed confirmation sheet and keyboard correction

- Owner Telegram smoke of exact deployed `5daa2c0...` confirmed the date/court
  alignment, but found a separate regression: the booking confirmation sheet
  moved with the booking page instead of remaining fixed, the background page
  could scroll, and focusing the email field allowed the keyboard viewport to
  split the sheet/footer layout.
- Root cause is exact and frontend-only. `PullToRefresh` keeps a CSS transform
  on its content wrapper even at zero distance; CSS transforms establish a
  containing block for descendant `position: fixed`, so the nested overlay was
  fixed to the scrolling wrapper rather than to the Telegram viewport.
- The confirmation overlay now renders through a React portal directly under
  `document.body`. Opening it preserves the current page offset and locks the
  html/body background; closing restores that offset, while successful create
  still intentionally returns to page top. The sheet body remains the only
  vertical scroll area, and its footer/CTA stays pinned to the bottom when the
  viewport contracts for the keyboard. The email input now uses a `16px` font
  to prevent iOS focus zoom from scaling and displacing the interface.
- Focused iPhone/WebKit regression PASS `1/1`: portal ownership, fixed viewport
  position, html/body lock, compact `520px` keyboard viewport, visible pinned
  CTA, internal body scrolling, `16px` anti-zoom input, unlock and post-create
  top restoration are all asserted. Full root E2E PASS `89 passed / 1 skipped`;
  root build PASS (`1617`
  modules, existing CJS/chunk warnings only); `git diff --check` PASS.
- Read-only P0/P1 review found no actionable issue. No backend, API, provider,
  DB/schema/migration, payment-field, app-originated cancel/reschedule or
  production change is present. Backend gates were not needed for this
  frontend-only slice.
- Deployment impact is `pending_integration_rollout`. Selectel test remains
  clean and healthy on exact `5daa2c0...`; this correction has not been pushed,
  merged or deployed and requires a new frontend-only rollout plus owner
  Telegram keyboard smoke.

### 2026-08-09 — D2 / fixed confirmation sheet frontend rollout

- Git delivery PASS: exact checkpoint
  `e55b9d8bd1af35b98fe4f7aae287aaef59413be9` was pushed to
  `codex/week1-d2-create-delete-sync`; clean local `main` fast-forwarded from
  `5daa2c0ba3884d0024f115bf6b4c1805e60f468d` to the same exact SHA and was
  pushed without a merge commit.
- Selectel test precheck PASS at clean exact `5daa2c0...`: Compose validation,
  four healthy containers with restart count `0`, root/health `200` and
  unauthenticated bookings `401` all matched the expected baseline.
- The application checkout fetched and detached cleanly at exact `e55b9d8...`.
  Only the frontend image was rebuilt and only
  `prosto-padel-test-frontend-1` was recreated. Its ID changed from
  `76839a2ae14c...` to `bc06ddc03c89...`; backend stayed
  `81dfc03e2f1e...`, nginx `e5b98b53a385...` and PostgreSQL
  `5e36d4dc1a5c...`. All four are healthy with restart count `0`.
- Postcheck PASS: clean exact checkout; internal/HTTPS root and health `200`;
  exact asset `assets/index-Dm40-sKH.js` `200`; unauthenticated bookings `401`;
  bounded backend/frontend/nginx/PostgreSQL critical-marker counts all `0`.
- No backend/nginx/PostgreSQL rebuild, YCLIENTS/API/provider or DB call/write,
  schema/migration/env/secret, payment-field, cleanup or production action was
  performed. Automated rollout is `test_deployed`.
- Remaining manual gate is no-write only: in Telegram select an available slot,
  confirm that the sheet stays fixed at the screen bottom and the background
  cannot scroll, focus/type in the email field and confirm the keyboard causes
  no zoom/split while the CTA remains visible, then close the sheet without
  creating a booking and confirm the prior page position is restored.

### 2026-08-09 — D2 / fixed sheet owner Telegram acceptance

- The owner completed the no-write Telegram Mini App smoke on exact deployed
  `e55b9d8bd1af35b98fe4f7aae287aaef59413be9` and confirmed the reported
  confirmation-sheet and email-keyboard interface defects are fixed.
- The fixed bottom position, background lock and stable email input/keyboard UI
  are accepted. No new booking, YCLIENTS/API/provider or DB call/write, runtime
  change, container restart, push, merge, rollout or production action was
  performed for this factual acceptance entry.
- Deployment remains `test_deployed` at exact `e55b9d8...`. D2 stays
  `in_progress` until the managing closure decision; legacy unbound cleanup is
  still deferred and is not part of the accepted primary D2 flow.

### 2026-08-09 — D2 / Home reflects administrator reschedule on open

- The owner created a fresh Selectel-test reservation for the final manual
  administrator-reschedule acceptance. Read-only PostgreSQL precheck proved
  local `confirmed`, complete encrypted provider binding, one active hold and
  one terminal confirmed create operation. The owner then moved the same
  YCLIENTS record through the CRM. YCLIENTS availability reflected the move,
  but `Home -> My bookings` still showed the old target.
- Read-only PostgreSQL postcheck proved the local reservation and its sole
  active hold still had the original target. The frontend cause was exact:
  entering Home and returning the Mini App to the foreground called only the
  persisted owner list; canonical per-reservation read-only reconciliation was
  reserved for an explicit Home pull gesture. Therefore no backend exact read
  had updated the stored target yet.
- Home open/re-entry and visible-app refresh now use the existing bounded
  `refreshBackendReservations` path: one owner list, at most three sequential
  exact reads through the authenticated backend action, then one final list.
  The existing in-flight guard remains; there is no polling, provider write,
  PUT/DELETE, retry or unbounded fan-out.
- The account/Home E2E now models provider state separately from persisted
  state. It proves an administrator move is invisible to the first list,
  becomes persisted only after exact read, and is rendered with the new court
  and time when Home is reopened. It then proves the same bounded path removes
  the booking after an administrator deletion, with zero frontend writes.
- Focused Home regression PASS `1/1`. The default 9-worker root run produced
  four resource-sensitive UI timeouts (`85 passed / 1 skipped`), including the
  same target scenario which had already passed focused. The complete
  single-worker rerun PASS: `89 passed / 1 skipped`. Root production build PASS
  (`1617` modules; existing CJS/chunk warnings only). Backend suites were not
  run because backend source/contracts were unchanged. `git diff --check`
  PASS (line-ending warnings only).
- Read-only P0/P1 review found no actionable issue. The changed runtime path is
  frontend-only, owner-authenticated, bounded to three sequential reads and
  guarded against overlap. No application-originated reschedule/cancel route,
  provider write surface, payment field or sensitive logging was added.
- Deployment impact is `pending_integration_rollout`: this changes the frontend
  refresh behavior and is not present on Selectel test yet. Runtime remains
  exact `e55b9d8bd1af35b98fe4f7aae287aaef59413be9`; no YCLIENTS/provider, DB,
  server, schema/migration, payment-field, webhook or production write was
  performed by this correction. D2 remains `in_progress` until exact frontend
  rollout and owner smoke prove Home shows the moved target.

### 2026-08-09 — D2 / Home reschedule refresh rollout and live contract correction

- Git delivery and frontend-only Selectel rollout of exact
  `abc5985a3436476a1b98c50f6640ba9f0d67ec6b` completed successfully. The
  branch and `main` were fast-forwarded/pushed to the same SHA; the application
  checkout is clean at that SHA. Only the frontend container was recreated
  (`29d0167f...`, image `sha256:1117b890...`); backend remained
  `81dfc03e...`, nginx `e5b98b...` and PostgreSQL `5e36d4...`. All containers
  were healthy with restart count `0`; root/health returned `200`, the exact
  frontend asset `assets/index-D8k40S5E.js` returned `200`, unauthenticated
  bookings returned `401`, and bounded critical log marker counts were `0`.
- The owner reopened/refreshed Home, but the moved booking still showed its old
  court/time. Read-only PostgreSQL evidence proved that Home had invoked exact
  reconciliation repeatedly (`reconciliation_attempts=14`) while the same
  confirmed reservation, terminal create binding and active hold retained the
  old target. This excludes a missing frontend refresh as the remaining cause.
- One explicitly bounded, read-only exact YCLIENTS GET through the already
  deployed strict admin-read client returned the same persisted record and
  company, active `deleted=false`, one expected service, the new court/time and
  provider duration, but no `api_id`. No raw body, PII, token or record hash was
  read into evidence or logged. The live contract therefore proves that a
  manual CRM reschedule can preserve `recordId` while clearing/omitting
  `api_id`.
- The backend correction remains fail-closed but accepts this one exact shape:
  an active record without `api_id` may update the target only when the strict
  exact GET record matches both the reservation's encrypted persisted binding
  and the terminal confirmed/reconciled-confirmed create operation record ID.
  Company, record, single service, datetime and duration parsing remain strict.
  A foreign record, deleted/active proof mismatch, extra proof field, malformed
  body, 404, list candidate or ambiguous response stays stale. The locked row
  must still be the same expected `confirmed` version, so a stale active
  response cannot resurrect a concurrently cancelled reservation. The old hold
  is released and exactly one replacement hold is inserted atomically under
  the existing migration 033 exclusion constraint.
- Regression coverage PASS: focused backend repository/service `2 suites / 50
  tests`; backend typecheck, unit `132 suites / 3305 tests`, E2E `2 suites / 4
  tests` and build; root E2E `89 passed / 1 skipped` with one owned Vite worker;
  root build PASS (`1617` modules, existing CJS/chunk warnings only);
  `git diff --check` PASS (line-ending warnings only).
- Independent read-only P0/P1 review is CLEAN. It verified that the locked
  expected-version/status gate closes stale-active resurrection, while exact
  binding, parser, atomic hold replacement and no-write boundaries remain
  intact.
- No provider write, POST/PUT/DELETE, blind retry, DB mutation/cleanup,
  schema/migration, payment-field, webhook, app-originated cancel/reschedule or
  production action was performed. This correction changes backend runtime and
  is `pending_integration_rollout`; Selectel test remains on exact
  `abc5985a3436476a1b98c50f6640ba9f0d67ec6b`. D2 remains `in_progress` until
  the exact correction is integrated and backend-only rolled out, then the
  owner refreshes Home and PostgreSQL proves the same reservation has the new
  target with the old hold released and exactly one new active hold.

### 2026-08-09 — D2 / cross-date administrator-reschedule live contract correction

- Exact backend correction `b52659299e1b8f8ed625b859a10afd551f4f48cd`
  was integrated and backend-only rolled out to Selectel test before this
  diagnosis. The owner then exercised T4 through the YCLIENTS CRM: date, time
  and court were all changed on one fresh confirmed reservation.
- Read-only PostgreSQL evidence proved one local confirmed reservation, the
  original full terminal create binding, one active hold and no duplicate
  create. The local target remained the old date/time/court after an owner
  refresh. A single bounded, PII-safe exact provider read proved that YCLIENTS
  preserved the same record ID and returned the new date/time/court,
  `deleted=false`, the expected single service and duration.
- The exact live blocker was `api_id`: this fresh record exposes a canonical
  RFC 4122 UUID rather than the previously documented numeric/decimal-string
  shape. The strict safe reader therefore returned `unknown` before the
  already-reviewed exact-record/terminal-create binding proof could run. This
  also explains the separate confirmed-plus-stale banner on the new booking;
  it does not indicate a duplicate provider record.
- The read client now accepts only a canonical RFC 4122 UUID as an opaque
  provider `api_id`. Its value is not returned, logged or compared, and it
  cannot satisfy numeric idempotency or bounded candidate matching. Malformed,
  signed, padded, exponent, leading-zero and out-of-range values remain
  fail-closed. Exact refresh still requires the persisted record ID and the
  terminal confirmed create-operation binding before target/hold mutation.
- Regressions prove an exact UUID record is safely parsed without exposing the
  UUID and that UUID neighbors cannot become bounded-list candidates. Focused
  backend tests PASS (`2 suites / 100 tests`); backend typecheck, unit (`132
  suites / 3306 tests`), E2E (`2 suites / 4 tests`) and build PASS; root E2E
  PASS (`89 passed / 1 skipped`) and root build PASS (`1617` modules; existing
  CJS/chunk warnings only). `git diff --check` PASS (line-ending warnings only).
- Independent read-only P0/P1 review is CLEAN. It confirmed that the UUID is
  omitted from the safe projection, cannot satisfy numeric candidate or
  idempotency equality, and that exact persisted-record plus terminal-create
  binding and locked expected-version hold mutation remain unchanged.
- No YCLIENTS/provider write, POST/PUT/DELETE, DB mutation/cleanup,
  schema/migration, payment-field, webhook, app-originated cancel/reschedule or
  production action was performed. This backend correction is
  `pending_integration_rollout`; T4 must be repeated against the exact deployed
  checkpoint and prove the DB target/new hold plus UI. T2 and T3 then remain
  separate manual acceptance scenarios. D2 stays `in_progress`.

### 2026-08-09 — D2 / opaque UUID read correction backend-only rollout

- Git delivery PASS: exact reviewed checkpoint
  `fb02bf3f1959970cda7d2d9d9dbd01f0f00d6aad` was pushed to the D2 branch;
  remote `main` fast-forwarded from `b526592...` to the same SHA without a
  merge commit. Both remote refs were verified exact.
- Selectel precheck PASS at clean `b526592...`; `origin/main` was fetched and
  verified as `fb02bf3...`, then the application checkout detached cleanly at
  that exact commit. The existing two-file Compose configuration validated
  without printing expanded configuration or secrets.
- Only the backend image was rebuilt and only
  `prosto-padel-test-backend-1` was recreated. Its container ID changed from
  `d66ae14fd6de...` to `2a8a58f7f047...` (image `sha256:85877e520f3b...`).
  Frontend remained `29d0167f496d...`, nginx `e5b98b53a385...` and PostgreSQL
  `5e36d4dc1a5c...`; all four are healthy with restart count `0`.
- Postcheck PASS: internal and public root/health returned `200`, unauthenticated
  bookings retained `401`, and bounded critical-marker counts were `0` for all
  four containers. A network-free mocked check of the compiled backend proved
  that a canonical UUID `api_id` yields `found` while the opaque value is not
  projected. The first synthetic invocation rejected an invalid test-only
  limiter option before fetch; the corrected invocation passed and no provider
  call occurred.
- No YCLIENTS/API/provider call or write, DB mutation, schema/migration,
  frontend/nginx/PostgreSQL rebuild, env/secret, payment, webhook or production
  change was performed. Deployment is `pending_T4_owner_refresh`: the owner
  must refresh the already-moved reservation without creating another booking.
  Acceptance requires the same local reservation to remain confirmed, local
  target to become 22 August 08:45 / court 2, the old hold to be released and
  exactly one new active hold to remain. T2/T3 stay pending and D2 remains
  `in_progress`.

### 2026-08-09 — D2 / T4 cross-date/time/court live acceptance

- The owner refreshed the already-moved reservation on exact deployed backend
  `fb02bf3f1959970cda7d2d9d9dbd01f0f00d6aad`; no new booking was created.
  The owner confirmed Home now displays 22 August, 08:45, court 2.
- A bounded `BEGIN READ ONLY` PostgreSQL postcheck proved the same single local
  reservation remains `confirmed`, still binds the same provider record and
  has the provider target 22 August 08:45 / court 2. There is exactly one local
  create operation and one reservation bound to that provider record.
- The old 21 August 09:45 / court 8 hold has active count `0`; exactly one
  active hold matches the new target. No duplicate create/reservation or
  second active hold exists. This closes T4 (different date, time and court).
- No provider/API write, application-originated PUT/DELETE, DB write/cleanup,
  runtime/config change, schema/migration, payment, webhook or production
  action was performed by the postcheck. T2 and T3 remain separate live
  acceptance scenarios; D2 remains `in_progress`.

### 2026-08-09 — D2 / T2 cross-date/same-time/same-court live acceptance

- The owner moved the same already-bound YCLIENTS record to a different date
  while preserving 08:45 and court 2, then refreshed Home. The owner confirmed
  Home displays 18 August, 08:45, court 2.
- One bounded exact provider GET through the deployed strict reader and one
  bounded `BEGIN READ ONLY` PostgreSQL postcheck agreed on the same record ID,
  service, 18 August 08:45 target, 90-minute duration and court resource. The
  local reservation and create operation both remain `confirmed`.
- Exactly one reservation is bound to the provider record, exactly one create
  operation exists, the prior 22 August hold has active count `0`, and exactly
  one active hold matches the new target. No duplicate create or second active
  hold exists. This closes T2 (different date, same time and court).
- No provider write, application-originated PUT/DELETE, DB write/cleanup,
  runtime/config change, schema/migration, payment, webhook or production
  action was performed by the verification. T3 remains pending. Repeated
  successful reads did create additional released hold history while retaining
  only one active hold; that separate freshness/hold-churn defect B remains
  explicitly open after the transfer matrix. D2 remains `in_progress`.

### 2026-08-09 — D2 / T3 and administrator-reschedule matrix live acceptance

- The owner moved the same bound record to a different date and different time
  while preserving court 2, then refreshed Home. The owner confirmed Home
  displays 17 August, 18:00, court 2.
- One bounded exact provider GET through the deployed strict reader and one
  bounded `BEGIN READ ONLY` PostgreSQL postcheck agreed on the same record ID,
  service, 17 August 18:00 target, 90-minute duration and court resource. The
  single local reservation and its single create operation remain `confirmed`.
- The prior 18 August 08:45 / court 2 hold has active count `0`; exactly one
  active hold matches the new target. One reservation remains bound to the
  record and no duplicate create or second active hold exists. This closes T3.
- The live administrator-reschedule matrix is now complete on Selectel test:
  T1 same date/different time PASS; T2 different date/same time/same court PASS;
  T3 different date/different time/same court PASS; T4 different date/time/court
  PASS. Every cross-date case preserved the same provider record ID, one local
  confirmed reservation and one active target hold while releasing the prior
  hold; Home displayed only the new target after refresh.
- No provider write, application-originated PUT/DELETE, DB write/cleanup,
  runtime/config change, schema/migration, payment, webhook or production
  action was performed by the verification. D2 remains `in_progress` because
  defect B is separately proved: repeated successful exact refreshes of an
  unchanged target currently release/reinsert the same hold and increment
  reservation history/version. Only one hold remains active, but the redundant
  churn requires a code-only correction and review before D2 closure.

### 2026-08-09 — D2 / exact-refresh hold-churn correction (defect B)

- Root cause was the PostgreSQL exact-refresh persistence path: every canonical
  active read updated the reservation version, released its current hold and
  inserted an identical hold even when status and the complete target were
  already current. Live matrix evidence showed total hold history grow
  `7 -> 10 -> 13` while only one hold remained active.
- Under the existing owner reservation row lock, an exact refresh is now a
  reservation/hold no-op only when the persisted status and full target already
  equal the canonical provider effect and the hold invariant is also exact:
  one matching active hold for a confirmed record or zero active holds for an
  already-cancelled record. Only allowlisted reconciliation metadata advances;
  reservation version and hold history stay unchanged.
- A concurrent identical refresh may therefore return fresh after observing the
  already-applied locked state. A different target, active proof after local
  cancellation, missing/mismatched hold or other inconsistent state remains
  `binding_mismatch`/stale and cannot mutate or recreate a slot hold.
- Focused repository/service tests PASS (`2 suites / 54 tests`). Backend
  typecheck PASS; unit PASS (`132 suites / 3310 tests`); E2E PASS (`2 suites / 4
  tests`); build PASS. Root E2E PASS (`89 passed / 1 skipped`) and root build
  PASS (`1617` modules; existing CJS/chunk warnings only). `git diff --check`
  PASS (line-ending warnings only).
- Independent read-only P0/P1 review is CLEAN. It confirmed the owner row lock,
  exact terminal create binding, full target and hold cardinality checks, safe
  stale-version no-op, cancelled non-resurrection and fail-closed metadata
  update without any mutation-path or runtime-surface regression.
- No YCLIENTS/API/provider call or write, DB/server mutation, migration/schema,
  frontend, payment-field, webhook, app-originated cancel/reschedule, push,
  merge, deployment or production action was performed. This backend runtime
  correction is `pending_integration_rollout`; Selectel test remains on exact
  `fb02bf3f1959970cda7d2d9d9dbd01f0f00d6aad`. D2 remains `in_progress` until
  the exact correction is rolled out and repeated unchanged pull-to-refresh is
  proved to keep reservation version and total/active hold counts unchanged.

### 2026-08-09 — D2 / exact-refresh no-churn Selectel acceptance

- Git delivery PASS: exact reviewed checkpoint
  `ac5b4be4e88c6b45ec8d290a1c68e01a41dc635d` was pushed to the D2 branch and
  remote `main` fast-forwarded from `fb02bf3...` to the same SHA without a merge
  commit; both remote refs were verified exact.
- Selectel test precheck PASS at clean `fb02bf3...`; the server fetched and
  detached cleanly at exact `ac5b4be...`. The root-owned deployment boundary
  remained unchanged, the server-side Compose env file remained `0600`, and
  the two-file Compose configuration validated without exposing values.
- Only `prosto-padel-test-backend-1` was rebuilt/recreated, changing container
  ID from `2a8a58f7f047...` to `4a837f0226ad...`. Frontend stayed
  `29d0167f496d...`, nginx `e5b98b53a385...` and PostgreSQL
  `5e36d4dc1a5c...`; all four remained healthy with restart count `0`.
- HTTP/auth/log postchecks PASS: root and health returned `200`, unauthenticated
  bookings returned `401`, and bounded critical-marker counts were `0` for the
  backend, frontend, nginx and PostgreSQL.
- Read-only PostgreSQL baseline for the fully-bound matrix reservation was
  `confirmed`, reservation version `17`, with `15` total holds, exactly `1`
  active hold and exactly `1` active hold matching the full current target.
  The owner then performed three unchanged Home pull-to-refresh gestures.
  The bounded read-only postcheck remained exactly version `17` and holds
  `15 / 1 / 1`, proving no reservation version bump and no hold release/insert
  churn while the expected reconciliation metadata continued separately.
- No YCLIENTS/provider write, POST/PUT/DELETE, direct DB mutation/cleanup,
  schema/migration, frontend/nginx/PostgreSQL rebuild, env/secret, payment,
  webhook or production change was performed. Core D2 live acceptance is now
  proved; D2 remains `in_progress` only until the separate managing closure
  decision. Legacy unbound cleanup remains deferred and is not D2 acceptance.

### 2026-08-10 — D2 / closure cleanup stopped fail-closed

- Read-only inventory found exactly three active, fully-bound D2 test
  reservations. Each was `confirmed`, had one terminal confirmed create
  operation with matching company/appointment/record and keyed record proof,
  and held exactly one active slot. Strict exact YCLIENTS GET classified all
  three provider records as active and fully matching; no broad search or PII
  output was used.
- The first and only permitted controlled DELETE was sent for provider record
  `1896208857` and returned `unauthorized`. Execution stopped immediately:
  there was no retry, alternate endpoint, PUT, POST or DELETE for records
  `1896396891` and `1896181131`. One subsequent exact read-only GET proved
  record `1896208857` remained active, so the DELETE had no provider effect.
- PostgreSQL postcheck remained unchanged for all three reservations:
  `confirmed`, the original full record binding, and exactly one active hold
  each. Direct status/hold updates are forbidden for bound reservations. The
  next safe path is for the owner to delete these exact three proven test
  records in YCLIENTS UI and then perform one owner pull-to-refresh so the
  normal read-only reconciliation can prove `cancelled` and zero active holds.
- The exact eight-row legacy inventory is still unbound with one active hold
  per reservation, but its current split is `5` pending/pending and `3`
  unknown/unknown. In particular reservation
  `3d49b170-61a6-4b77-b497-ad62b4f414f6` is now unknown/unknown, while exact
  reviewed script commit `f6f93a6880ec563e4b380f6d169c3de601cc8e1f`
  (SHA-256
  `b551d59d3108e7c2f7cfe6a2014aaa9a78f47d0c4b2b9ed476cb8842c0e9b173`)
  requires that row in its six-row pending set. The required PRECHECK therefore
  cannot match. The script was not transferred or executed; no backup/claim
  artifact, transaction or DB mutation was created. A code-only correction,
  new SHA, independent review and separate execution approval are required.
- Runtime postcheck is unchanged at exact
  `ac5b4be4e88c6b45ec8d290a1c68e01a41dc635d`. Backend `4a837f0226ad...`,
  frontend `29d0167f496d...`, nginx `e5b98b53a385...` and PostgreSQL
  `5e36d4dc1a5c...` are healthy with restart count `0`; health returned `200`
  and bounded critical log-marker counts were `0` for all four containers.
- D2 remains `in_progress`. Closure commit, D2/main push, fast-forward and
  deployment were not performed. This is a docs-only factual STOP handoff;
  application tests were not run because no runtime source changed.

### 2026-08-10 — D2 / fully-bound test-booking cleanup accepted

- The owner deleted the three exact proven D2 test records in YCLIENTS UI and
  then performed one pull-to-refresh in `Home -> My bookings`. No automated
  retry, alternate DELETE, direct DB update or provider write was performed by
  Codex after the earlier unauthorized/no-effect request.
- Bounded read-only PostgreSQL postcheck PASS: provider records `1896181131`,
  `1896208857` and `1896396891` now map to the same three local reservations in
  status `cancelled`, with exactly `0` active holds for each. The owner
  confirmed all three disappeared from the active Home bookings UI.
- Fully-bound cleanup is complete through the normal canonical reconciliation
  path. The remaining closure blocker is only the exact eight-row legacy
  unbound cleanup: its current `5` pending / `3` unknown split does not match
  the reviewed script's `6` / `2` PRECHECK. D2 therefore remains
  `in_progress`; no closure push, main fast-forward or deployment was done.

### 2026-08-10 — D2 / legacy cleanup 5-pending / 3-unknown correction

- From clean local base `0f5355c231e5d2050143210061792c31139d5886`,
  the exact reviewed legacy cleanup artifact was restored into the current D2
  branch and corrected only for the previously proved current status split.
  Reservation `3d49b170-61a6-4b77-b497-ad62b4f414f6` moved from both pending
  declarations to both unknown declarations; its exact status projection is
  now unknown/unknown, and the two guarded pending update counts changed from
  `6` to `5`. The eight-ID target set, negative control, backup/no-clobber
  boundary, SERIALIZABLE transaction, lock/update order, terminal result,
  release count and postcheck remain unchanged.
- Corrected exact script SHA-256 is
  `f6a9e06ea416198a248d586db604cf3a4e9eb3b8ef3a6c80be7b49e743eb8142`.
  The static contract now separately pins the five pending IDs and three
  unknown IDs in both script declarations, rejects the former six-row count,
  and still pins the exact script bytes and all original safety invariants.
- Focused static contract PASS: `1 suite / 9 tests`. Backend typecheck PASS;
  full unit PASS (`133 suites / 3319 tests`), E2E PASS (`2 suites / 4 tests`)
  and build PASS. Root E2E PASS (`89 passed / 1 skipped`) and build PASS
  (`1617` modules; existing CJS/chunk warnings only). `git diff --check` PASS.
- Independent byte-level P0/P1 review is CLEAN. It proved the corrected SQL
  differs from reviewed `f6f93a...` only by moving `3d49...` into both unknown
  sets/projection and changing the two guarded counts from `6` to `5`; target
  set, negative control, backup claim, locks, transaction, terminal updates
  and postcheck are unchanged. The Russian approval template is byte-identical
  to the reviewed base; an initial PowerShell display-encoding false positive
  was explicitly rechecked and withdrawn.
- No PostgreSQL connection, YCLIENTS/API/SSH/server call, cleanup execution,
  backup/approval artifact, DB/provider write, runtime/schema/migration,
  payment, webhook, push, merge, deployment or production action occurred.
- Deployment is `not_needed`: this review-only SQL artifact and static test are
  not imported by application runtime. D2 remains `in_progress`; one-time
  execution still requires independent review, the exact correction commit and
  a new approval bound to that commit and SHA-256.

### 2026-08-10 — D2 / cleanup execution and closure

- Fully-bound cleanup remained accepted: the owner deleted the three exact D2
  test records in YCLIENTS UI, one normal owner refresh reconciled all three to
  `cancelled`, every active hold count became `0`, and the owner confirmed the
  three cards disappeared from active Home bookings. No direct DB update was
  used for provider-bound reservations.
- The exact legacy artifact from source commit
  `4515549f58d714624a333fbb059dd4054b1e1439`, SHA-256
  `f6a9e06ea416198a248d586db604cf3a4e9eb3b8ef3a6c80be7b49e743eb8142`,
  was delivered to a fresh root-owned layout and verified `0600`; its artifact
  parent was root-owned `0700` and the atomic claim was absent. A bounded
  read-only precheck again proved exactly `5` pending / `3` unknown, eight null
  provider bindings and eight active holds.
- The first temporary PostgreSQL client launch failed before connection because
  Compose env names were not mapped into that client. It created no claim,
  backup, container residue or DB effect; a bounded read-only no-effect check
  proved the same `5 / 3 / 8` state. After a network-none credential-handoff
  preflight, the exact SQL started once through a temporary PostgreSQL 14 client
  and returned `D2_LEGACY_UNBOUND_CLEANUP_PASS|8|8`.
- PostgreSQL 14 printed five `SHELL_ERROR` meta-command compatibility warnings:
  those conditional branches were not portable even though each associated
  shell command succeeded. No retry occurred. Independent postchecks, rather
  than the PASS line alone, proved the durable outcome: root-owned `0700`
  no-clobber claim, one non-empty root-owned `0600` backup line, eight rejected
  reservations with null provider bindings, eight reconciled/rejected create
  operations, eight released holds, zero active holds and the cancelled
  negative control unchanged. The consumed claim remains; the script is
  archived and must not be reused.
- The owner performed one Home pull-to-refresh and confirmed all eight legacy
  cards disappeared. A final bounded read-only DB check remained exactly
  `8 rejected / 8 reconciled-rejected / 0 active holds / 8 released holds`.
- Runtime and containers were not rebuilt or reconfigured. Selectel test stays
  on exact `ac5b4be4e88c6b45ec8d290a1c68e01a41dc635d`; backend
  `4a837f0226ad...`, frontend `29d0167f496d...`, nginx `e5b98b53a385...` and
  PostgreSQL `5e36d4dc1a5c...` remained healthy with restart count `0`, health
  returned `200`, and the final bounded two-minute critical-marker count was
  `0` for all four containers. The earlier failed pre-connection launcher left
  one classified PostgreSQL `FATAL role "-d" does not exist` line and no
  runtime fault.
- D2 is `done`. This closure is docs-only and deployment is `not_needed`:
  accepted application runtime remains exact `ac5b4be...`, with containers
  unchanged. No schema/migration, provider POST/PUT, payment-field, webhook,
  production, runtime/config or application code change belongs to closure.

### 2026-08-10 — D3 / match ↔ reservation read-only audit

- Baseline verified before work: `main = origin/main =
  6b369553d2c96d7487710ae1712d435b9d7825d2`, clean. The D3 audit branch is
  `codex/week1-d3-match-reservation`. Accepted Selectel test runtime remains
  exact `ac5b4be4e88c6b45ec8d290a1c68e01a41dc635d` from D2.
- Current backend create derives `searching`, `confirmed` or `upcoming` from
  `scenario`; `social` and direct-API `private` require a selected static court
  but do not read or bind a D2 reservation. Match storage has no reservation
  relation and its active-court exclusion treats planned/unbooked match rows as
  real court holds.
- Current frontend derives “court booked” from `scenario = social`, private
  shape, legacy flags/statuses or `paymentStatus = full`. Feed filters, cards
  and details therefore can display a court guarantee without canonical
  YCLIENTS confirmation. Payment fields were inspected only as false truth
  inputs and were not changed.
- Actual backend flows are create/feed/detail/join/leave/description update.
  Backend owner participant removal and match cancellation are absent; their
  controls are hidden behind the legacy-extension boundary. Private/public
  conversion and training remain legacy-only. Backend private creation is UI
  disabled, while D2 private reservations are already excluded from the public
  match repository/feed.
- D2 exact refresh has the required canonical move/deletion/unknown semantics,
  but updates only reservation state. Existing match notifications are
  waitlist-specific and cannot represent court confirmed/moved/cancelled
  without new reviewed persistence.
- P0 gaps: false booking truth, no durable ownership/one-to-one link, and no
  atomic D2 refresh projection/participant notification. P1 gaps: false match
  court overlap, overloaded match status, direct private create ambiguity,
  static-vs-YCLIENTS court identity mismatch, waitlist-only notifications and
  missing backend lifecycle commands.
- Migration is required. The review-only proposal is
  `D3_MATCH_RESERVATION_AUDIT_AND_PERSISTENCE_PROPOSAL.md`: an append/history
  match-reservation link with partial active uniqueness, composite ownership,
  full-binding checks, canonical D2 slot holds as the only court-lock authority
  and a deduplicated lifecycle event/recipient ledger. No SQL was prepared or
  applied.
- First proposed implementation slice is code-only, runtime-disabled pure
  link/projection types and state-machine tests. The next gate is owner review
  of the persistence contract; migration SQL remains forbidden without a
  separate explicit approval.
- This checkpoint changes Markdown only. Application tests/builds were not run
  because runtime source and schema did not change. Deployment is `not_needed`;
  no API, YCLIENTS, PostgreSQL, SSH, server, container, secret, payment, webhook
  or production action was performed.

### 2026-08-10 — D3 / runtime-disabled link and projection domain

- Added pure, runtime-disconnected match ↔ reservation types and state machine.
  A link can activate only for the same owner, a non-terminal match, exact
  expected match/reservation versions and a D2 `confirmed` reservation with a
  complete YCLIENTS appointment/record/hash binding. Link state stores no PII
  or record hash.
- The activation transition rejects another active reservation for the match,
  another active match for the reservation, stale versions and provider record
  rebinding. Final persistence uniqueness remains assigned to the proposed
  partial unique indexes; no repository or schema was added in this slice.
- Canonical unchanged refresh has no link/match/event churn. All four move
  shapes (same-day time, different-day same-time, different-day/time and
  different-day/time/court) produce one `court_moved` seed. Canonical
  cancellation releases the link and produces `court_cancelled` without
  changing the match to a terminal state. Unknown/stale/unavailable refresh
  preserves the last confirmed link and produces no event.
- The pure court projection has only explicit `unbooked` and `confirmed`
  outcomes. It does not accept scenario or payment fields as inputs. Missing or
  mismatched current confirmed provider proof fails closed to `unbooked`;
  uncertain provider knowledge preserves the previous confirmation as stale.
- Focused state-machine suite PASS: `1 suite / 25 tests`. Backend typecheck
  PASS; full unit PASS (`134 suites / 3344 tests`); E2E PASS (`2 suites / 4
  tests`); build PASS. Root E2E PASS (`89 passed / 1 skipped`) and root build
  PASS (`1617` modules; existing CJS/chunk warnings only).
- Runtime-boundary review: the new domain is imported only by its focused spec
  and its own type/state-machine files; Nest modules/controllers, match/D2
  repositories and frontend are unchanged. `git diff --check` PASS.
- No SQL/migration, DB/API/YCLIENTS/SSH call, provider write, runtime wiring,
  payment field, webhook, push, merge, deployment or production action was
  performed. Deployment is `not_needed` for this disconnected code-only slice;
  Selectel test remains on accepted D2 runtime `ac5b4be4...`. The next gate is
  review of this checkpoint and explicit approval before preparing migration
  SQL for review.

### 2026-08-10 — D3 / migration 034 review package

- Owner approved preparation for review only. Added migration 034,
  read-only PRECHECK/POSTCHECK, fail-closed rollback, runbook and a static
  contract suite. Migration status is `prepared_for_review`, `not_applied`;
  runtime remains disconnected.
- The proposed storage adds an append/history match-reservation link, immutable
  PII-free lifecycle events and per-recipient read state. Composite ownership
  FKs, partial unique active-match/active-reservation indexes and deferred
  cross-domain triggers reject false confirmation, duplicate active links,
  stale reservation versions and partial move/cancellation transactions.
- Migration 034 removes `matches_no_active_court_overlap`: planned/unbooked
  match values no longer act as a court hold. The existing D2
  `reservation_slot_holds_no_overlap` remains the only canonical database court
  collision authority. Match cancellation/completion can release only with the
  bounded storage reason `match_terminal`; canonical reservation cancellation
  keeps the match alive and releases only its court guarantee.
- Runtime ACL is column-scoped. Provider appointment/record identity and link
  ownership are immutable; link/event/recipient history cannot be deleted or
  truncated; events contain no PII, record hash, payment or provider secret.
- Final static migration contract PASS (`1 suite / 8 tests`); backend typecheck
  PASS; full unit PASS (`135 suites / 3352 tests`), E2E PASS (`2 suites / 4
  tests`) and build PASS. Root E2E PASS (`89 passed / 1 skipped`) and build PASS
  (`1617` modules; existing CJS/chunk warnings only).
- No PostgreSQL/YCLIENTS/API/SSH/server call was made. Migration 034 was not
  executed, PRECHECK/POSTCHECK/rollback were not run, and no database row,
  schema, container, secret, payment field, webhook or production resource was
  changed. Selectel test remains on accepted D2 runtime `ac5b4be4...`.
- Deployment is `not_needed`: only review-only SQL/docs and a static contract
  spec changed; none is imported by Nest/frontend runtime. The next gate is
  independent review of the exact checkpoint, then a separate owner approval
  before backup -> PRECHECK -> migration -> POSTCHECK. Runtime wiring remains a
  later, separately approved slice.

### 2026-08-10 — D3 / migration 034 release-reason review correction

- Exact checkpoint review found one P1 in the review-only SQL: PostgreSQL CHECK
  constraints accept `NULL`, so a released link with a null `release_reason`
  could satisfy the previous release-shape expression and skip both canonical
  proof branches in the transition trigger.
- Migration 034 now requires `release_reason is not null` in both the table
  constraint and transition guard. The static contract pins both protections.
- Focused migration contract PASS (`1 suite / 8 tests`), backend typecheck PASS
  and `git diff --check` PASS. The earlier full application gates remain green;
  runtime source did not change in this correction.
- Migration remains `not_applied`; PRECHECK/POSTCHECK/rollback, PostgreSQL,
  YCLIENTS, SSH, server, containers and runtime were not invoked or changed.
  Deployment remains `not_needed` for this review-only correction.

### 2026-08-10 — D3 / Selectel test migration 034 apply STOP

- Exact approved checkpoint:
  `a7fc8858ce2a3908beb8ec3d5dec18a414cb8174`. Local branch/worktree was clean;
  application `main`/`origin/main` remained `6b369553...` and were not changed.
  Exact remote SQL SHA-256 matched local artifacts: migration `cbb6040b...`,
  PRECHECK `73582827...`, POSTCHECK `4584ffdb...`, rollback `ff896ec7...`.
- Selectel test preflight PASS: application checkout was clean at accepted D2
  runtime `ac5b4be4...`; backend/frontend/nginx/PostgreSQL were running and
  healthy with restart count `0`.
- Root-owned backup set PASS at
  `/root/prosto-padel-migration-audit/034-a7fc885-20260810T085632Z-433b27b4-c138-4ebd-86e5-8c98d2713b32`:
  directory `0700`; `database.dump` (`608647` bytes), `globals.sql` (`1195`
  bytes), `database.list`, manifest and checksum files were `0600`.
  `pg_restore --list` and SHA-256 verification PASS.
- Read-only PRECHECK PASS with empty stderr: `ready=true`, target absent,
  canonical D2 slot-hold authority present, legacy match overlap present,
  `12` matches and `0` confirmed reservations.
- Exact migration ran once with `psql -X --set=ON_ERROR_STOP=1` and STOPPED
  non-zero while compiling `guard_match_reservation_link_transition()`:
  `ERROR: "v_reservation" is not a scalar variable` at
  `into v_match_status, v_reservation`. Output contains `BEGIN` and no
  `COMMIT`; the failed open transaction was rolled back when the psql session
  closed. Per owner stop-rule, no retry or independent DB verification was
  run, so migration status remains `not_applied_unverified_after_failed_apply`.
- POSTCHECK and rollback were not run. Runtime wiring, application checkout,
  containers, env/secrets, YCLIENTS, production and payment fields were not
  changed. No push, merge or application deployment occurred.
- Next safe gate requires separate approval: correct only the invalid PL/pgSQL
  composite assignment, add a static regression, review and commit a new exact
  checkpoint. Any future database attempt requires a new explicit approval and
  fresh backup/PRECHECK; the failed checkpoint must not be retried.

### 2026-08-10 — D3 / migration 034 composite-target correction

- Under explicit code-only approval, the invalid mixed PL/pgSQL target
  `into v_match_status, v_reservation` was replaced by two owner-scoped
  statements: one scalar `SELECT INTO` for match status and one rowtype
  `SELECT ... .* INTO` for the D2 reservation. Each lookup has its own
  fail-closed `FOUND`/ownership error gate.
- The static contract now requires both valid forms, forbids the failed mixed
  form and pins both owner-binding guards. A targeted audit found no other
  mixed scalar/rowtype target in migration 034; the remaining two-target
  assignment contains scalar UUID/bigint variables only.
- Focused migration contract PASS (`1 suite / 9 tests`), backend typecheck PASS
  and full backend unit PASS (`135 suites / 3353 tests`). `git diff --check`
  PASS. Backend/root E2E and builds were not rerun because only review-only SQL,
  its static spec and WORKLOG changed; no runtime source/import changed.
- PostgreSQL, Selectel/SSH, PRECHECK/POSTCHECK, migration apply, rollback,
  runtime, containers, YCLIENTS and production were not invoked or changed in
  this correction. Deployment is `not_needed`.

### 2026-08-10 — D3 / Selectel test migration 034 second attempt STOP before apply

- Exact approved checkpoint was
  `e210bb8542f4e521e797e4efacd292caa96d6fdd`; local branch/worktree was clean.
  Application `main`/`origin/main` remained `6b369553...`. Exact remote
  SHA-256 matched the reviewed artifacts: migration `8ec5d52f...`, PRECHECK
  `73582827...`, POSTCHECK `4584ffdb...` and rollback `ff896ec7...`.
- Selectel test read-only preflight PASS: the application checkout remained
  clean at D2 runtime `ac5b4be4...`; backend/frontend/nginx/PostgreSQL were
  healthy/running with restart count `0`.
- A new root-owned backup set was created and verified at
  `/root/prosto-padel-migration-audit/034-e210bb8-20260810T092127Z-db5a0307-0d74-4170-9bb1-40f3bfa21d3d`.
  The directory is `0700`; `database.dump` (`608647` bytes), `globals.sql`
  (`1195` bytes), `database.list`, manifest and checksum files are `0600`.
  `pg_restore --list` and `sha256sum -c` both PASS.
- Exact read-only PRECHECK itself PASS with exit `0` and empty stderr:
  `ready=true`, `target_absent=true`, canonical D2 slot-hold authority present,
  legacy match overlap present, `12` matches and `0` confirmed reservations.
- The subsequent read-only evidence-formatting command exited `1` because its
  `stat -c` format was incorrectly quoted and shell pipes were interpreted.
  It had already displayed the complete successful PRECHECK result and zero-byte
  stderr, but the owner rule required an immediate stop on any error.
- Migration apply, POSTCHECK and rollback were therefore not run. Migration 034
  remains `not_applied`, confirmed by this attempt's `target_absent=true`.
  Runtime wiring, application deployment, containers, env/secrets, YCLIENTS,
  production and payment fields were not changed.
- Next gate requires a new explicit owner decision. The SQL checkpoint itself
  has not failed this attempt; no retry or database write is authorized by this
  handoff.

### 2026-08-10 — D3 / migration 034 approved continuation STOP before apply

- The owner approved continuation from the already verified backup/PRECHECK for
  checkpoint `e210bb8542f4e521e797e4efacd292caa96d6fdd`, with one apply followed
  by exact read-only POSTCHECK and an immediate-stop rule on any error.
- Local worktree was clean; HEAD was the descendant docs-only handoff commit
  `c813847...`, and the approved checkpoint remained an ancestor. Remote
  artifact verification again returned the exact reviewed SHA-256 values for
  migration `8ec5d52f...` and POSTCHECK `4584ffdb...`.
- A supplementary read-only shell assertion against the saved PRECHECK output
  exited `1` because its strict `grep` pattern did not match the psql-rendered
  JSON spacing/quoting. This was an evidence-command defect, not a PostgreSQL,
  migration or PRECHECK failure.
- Per the explicit immediate-stop rule, migration apply, POSTCHECK and rollback
  were not run. PostgreSQL/schema, runtime, containers, env/secrets, YCLIENTS,
  production and payment fields remain unchanged. Migration 034 remains
  `not_applied`; the authorization for one apply was not exercised.
- A future continuation should execute the already approved SQL directly, with
  no additional ad-hoc preflight assertions; it requires a new explicit owner
  instruction because this continuation was stopped on a command error.

### 2026-08-10 — D3 / Selectel test migration 034 applied, POSTCHECK STOP

- Under explicit owner approval, the exact reviewed migration 034 from
  `/root/prosto-padel-migration-audit/034-e210bb8-20260810T092127Z-db5a0307-0d74-4170-9bb1-40f3bfa21d3d`
  was applied exactly once to Selectel test with
  `psql -X --set=ON_ERROR_STOP=1`. Apply exit was `0`, stderr was empty and the
  saved output contains `COMMIT`.
- The exact read-only POSTCHECK then exited `1` and the operation stopped
  immediately. Saved failure:
  `POSTCHECK_FAILED: backend_match.match_reservation_links constraints differ`
  at the POSTCHECK inline block constraint comparison. No repeat apply,
  rollback or further PostgreSQL query was run.
- Migration status is `applied_not_verified`. The POSTCHECK transaction was
  read-only and did not commit any data change. Apply and POSTCHECK evidence is
  preserved as `APPLY.output.txt`, `APPLY.stderr.txt`,
  `POSTCHECK.output.txt` and `POSTCHECK.stderr.txt` in the same root-only audit
  directory.
- Local static inspection points to a checker expectation gap: the exact
  constraint-name array for `match_reservation_links` does not include the
  constraint-trigger bindings created later by the migration. This is a
  hypothesis only; it was not tested against PostgreSQL after the stop rule.
- Runtime wiring, application deployment, containers, env/secrets, YCLIENTS,
  production and payment fields were not changed. The next safe gate is a
  code-only review of the POSTCHECK expectation plus a contract regression;
  migration 034 must not be applied again.

### 2026-08-10 — D3 / migration 034 POSTCHECK constraint-trigger correction

- Under explicit code-only approval, the failed exact constraint sets were
  corrected to include PostgreSQL `pg_constraint` rows with `contype = 't'`
  created by `CREATE CONSTRAINT TRIGGER`: two rows for
  `match_reservation_links`, one for `match_reservation_events` and one for
  `match_reservation_event_recipients`.
- Added a static regression that binds each of those four trigger names to its
  migration target table and requires the same name inside that table's exact
  POSTCHECK constraint tuple. Migration 034 itself was not changed and retains
  SHA-256 `8ec5d52f9735001d140581956068367b7e7b33189e9874200f34a6b2d964dd35`.
  Corrected POSTCHECK SHA-256 is
  `2c033eb939f7e1ad0149f18ef17280b7a2fce674996a3640883f9d26ad097b10`.
- Focused migration contract PASS (`1 suite / 10 tests`); backend typecheck
  PASS; full backend unit PASS (`135 suites / 3354 tests`); backend E2E PASS
  (`2 suites / 4 tests`); backend build PASS. Root E2E PASS (`89 passed / 1
  skipped`); root build PASS (`1617` modules); `git diff --check` PASS.
- PostgreSQL, Selectel/SSH, migration apply, rollback, runtime wiring,
  deployment, YCLIENTS and production were not invoked or changed. Deployment
  is `not_needed` for this checker/test-only correction. Migration status
  remains `applied_not_verified`.
- Next gate: review the exact correction checkpoint, then separately authorize
  transfer of only the corrected POSTCHECK and one read-only POSTCHECK run.
  Migration 034 must not be applied again.

### 2026-08-10 — D3 / Selectel test migration 034 applied and verified

- Owner approved transfer of only the corrected POSTCHECK from checkpoint
  `f4bcee2244ba6d9bb5d72cb2f75db0dde53c17dc` and one exact read-only run.
  The corrected artifact was preserved separately as
  `034_backend_match_reservation_links_POSTCHECK.f4bcee2.sql`; its remote
  SHA-256 exactly matched
  `2c033eb939f7e1ad0149f18ef17280b7a2fce674996a3640883f9d26ad097b10`.
- The single corrected POSTCHECK exited `0` with empty stderr and returned
  `verified=true`, `new_tables_empty=true`, `runtime_connected=false`,
  `match_overlap_removed=true` and `d2_slot_hold_authority_preserved=true`.
  Its read-only transaction ended with `ROLLBACK` as designed.
- Evidence is root-owned in
  `/root/prosto-padel-migration-audit/034-e210bb8-20260810T092127Z-db5a0307-0d74-4170-9bb1-40f3bfa21d3d/POSTCHECK.corrected-f4bcee2.output.txt`
  with the adjacent zero-byte stderr file. Migration 034 status is now
  `applied_verified`; it must not be applied again.
- No migration write, rollback migration, runtime wiring, application
  deployment, container change, YCLIENTS write or production action occurred
  in this verification gate. Selectel test application runtime remains the D2
  deployment `ac5b4be4...`; deployment is `not_needed` for the corrected
  read-only checker.
- Next D3 gate is runtime implementation/wiring review against the verified
  schema, followed later by integration into `main` and a separately approved
  Selectel test rollout with health, business smoke and log checks.

### 2026-08-10 — D3 / local match ↔ reservation runtime slice

- Migration 034 remains `applied_verified`. The verified schema is now wired
  locally to a bearer-protected owner flow that links a match only to the
  owner's canonically confirmed D2 reservation with complete YCLIENTS binding.
  Match and reservation uniqueness, ownership, transaction locking and exact
  same-binding retries remain fail-closed.
- Backend match feed/detail responses now expose explicit `unbooked` or
  `confirmed` court-booking state. Planned date/time/court never imply a booked
  court. Confirmed projection reads are bounded to one joined PostgreSQL query
  for up to 50 matches; participant commands use the active reservation time.
- The D2 exact read-only refresh updates the D3 link in the same transaction:
  an admin move changes the effective match court/date/time and appends one
  `court_moved` event; an admin cancellation releases the court guarantee,
  appends `court_cancelled` and leaves the match itself intact. The refresh lock
  order was reviewed and corrected to avoid reservation/advisory deadlock.
- Lifecycle events are included in the existing recipient-scoped notification
  feed and mark-read boundary. The frontend shows truthful booked/unbooked
  state, lets only the backend match organizer open D2 create, links only a
  `booking_created` confirmation, and offers a safe retry if the booking was
  created but the link response failed.
- No app-originated reservation cancel/reschedule, provider PUT/DELETE, new
  migration, database/Selectel/YCLIENTS write, payment-field change, Supabase
  dependency or production action was added.
- Verification PASS: backend typecheck; backend unit `138 suites / 3366 tests`;
  backend E2E `2 suites / 4 tests`; backend build; root E2E `90 passed / 1
  skipped`; root build `1617 modules`; `git diff --check`.
- Read-only local P0/P1 review: no open finding. D3 remains `in_progress`.
  Deployment is `deployment_deferred_by_user`; Selectel test application
  runtime remains D2 commit `ac5b4be4...`, with no container/health/smoke/log
  action in this local gate.
- Next gate: review the local checkpoint, then separately approve integration
  into `main` and a coordinated Selectel test rollout (backend before frontend)
  followed by health, TMA business smoke and log checks.

### 2026-08-10 — D3 / Selectel test rollout, manual TMA smoke pending

- Git delivery PASS: clean local `main` was fast-forwarded from
  `6b369553d2c96d7487710ae1712d435b9d7825d2` to reviewed runtime checkpoint
  `646ed7f4878a16557f0a40951e2d617203bd59ae` without a merge commit and pushed;
  `main` and `origin/main` matched that SHA before rollout.
- Selectel test preflight PASS at clean detached D2 runtime `ac5b4be4...`:
  the fetched `origin/main` matched the approved SHA, the two-file Compose
  configuration was valid, all four containers were healthy with restart count
  `0`, internal root/health returned `200` and unauthenticated bookings returned
  the expected fail-closed `401`. The checkout then moved cleanly to exact
  detached `646ed7f...`.
- Rollout order was backend first, frontend second. Only those two images and
  containers changed:
  - backend container `4a837f0226ad...` / image `37ff7ad80388...` became
    `576a9da1a35b...` / image `84c1d6e53543...`;
  - frontend container `29d0167f496d...` / image `1117b8904190...` became
    `82391a277c2a...` / image `cc2011b6b849...`;
  - nginx remained `e5b98b53a385...`; PostgreSQL remained
    `5e36d4dc1a5c...`.
- Automated postcheck PASS: every container is `healthy` with restart count
  `0`; internal and HTTPS root/health returned `200`; exact frontend asset
  `/assets/index-DzE6qk8k.js` returned `200` with `604575` bytes; unauthenticated
  matches and bookings each returned `401`. Bounded 30-minute log counts were
  backend/frontend/nginx/PostgreSQL critical markers `0` and nginx 5xx `0`.
  The server checkout is clean and exact `646ed7f...`.
- Direct-browser boundary smoke PASS: the production page loaded the expected
  title, showed the fail-closed message that Telegram login is available only
  inside Mini App and emitted zero browser-console errors. This is not accepted
  as Telegram authentication evidence. The available automation surface had no
  controllable authenticated Telegram Desktop or Telegram Web session, so no
  synthetic `initData` was used.
- No migration/schema/DB operation, YCLIENTS/provider call or write, booking,
  app-originated cancel/reschedule, payment-field, env/secret, nginx/PostgreSQL
  rebuild, production or rollback action occurred during this rollout.
- D3 remains `in_progress` and deployment status remains `pending` until the
  owner opens the exact Selectel Mini App in Telegram and confirms the D3
  read-only business smoke. After that smoke, repeat the bounded health/log
  check and record the final D3 closure separately.

### 2026-08-10 — D3 / live feed SQL hotfix checkpoint

- The owner created two public future matches in the Selectel Telegram Mini
  App, one intended without a booking and one through the booking path. Both
  `POST /api/v1/matches` requests returned `201` and bounded read-only database
  evidence confirmed two `match_created` rows. Neither match had an active
  reservation link at diagnosis time. Public and owner feed requests then
  consistently returned `500`, so D3 remains `in_progress` and the live smoke
  is failed, not accepted.
- Exact read-only reproduction under runtime role `backend_auth_app` proved the
  cause before any runtime change: the new feed SQL used invalid PostgreSQL
  syntax `pg_catalog.extract(epoch FROM ...)`. PostgreSQL stopped at that token,
  while fake-transaction unit tests had not parsed the SQL.
- The code-only hotfix replaces all four public/owner feed occurrences with
  canonical `EXTRACT(EPOCH FROM ...)`. The regression now inspects both feed
  queries and rejects reintroduction of the invalid qualified form. No schema,
  migration, reservation state, YCLIENTS/provider operation, payment field or
  frontend behavior changed.
- Corrected SQL was executed separately inside a bounded read-only transaction
  under `backend_auth_app`; it returned a public-feed count of `3` and ended in
  `ROLLBACK`. Verification PASS: focused repository `52/52`; backend typecheck;
  backend unit `138 suites / 3366 tests`; backend E2E `2 suites / 4 tests`;
  backend build; root E2E `90 passed / 1 skipped`; root build `1617` modules;
  `git diff --check`.
- Deployment is `pending`: Selectel test still runs application checkpoint
  `646ed7f4878a16557f0a40951e2d617203bd59ae`. The next gate is exact hotfix
  integration and backend-only test rollout, followed by feed/mine HTTP smoke,
  owner TMA recheck and bounded logs. Existing match rows must not be recreated.

### 2026-08-10 — D3 / live feed SQL backend-only hotfix rollout

- Git delivery PASS: reviewed hotfix `e686cf18d2f911c9e1d83cce521c93e230f1108c`
  fast-forwarded clean `main` from `89857c64cfb6b4f2050561d32a241258d47a2913`
  without a merge commit and was pushed to exact `origin/main`.
- Selectel test preflight PASS at clean detached `646ed7f...`; fetched
  `origin/main` matched the approved hotfix, Compose quiet validation passed,
  all containers were healthy/restart `0` and health returned `200`. The clean
  checkout then moved to exact detached `e686cf1...`.
- Only backend was rebuilt and recreated. Backend container/image changed from
  `576a9da1a35b...` / `84c1d6e53543...` to `7ca6956f77fb...` /
  `8c6fc396c2b7...`. Frontend remained `82391a277c2a...`, nginx remained
  `e5b98b53a385...` and PostgreSQL remained `5e36d4dc1a5c...`.
- Automated postcheck PASS: all four containers are healthy with restart count
  `0`; internal and HTTPS health returned `200`; unauthenticated matches retained
  fail-closed `401`; backend critical markers were `0` and nginx 5xx after
  rollout were `0`. Server checkout is clean and exact `e686cf1...`.
- No schema/migration/DB write, reservation mutation, YCLIENTS/provider call,
  frontend/nginx/PostgreSQL rebuild, env/secret, payment-field or production
  action occurred. D3 remains `in_progress` only for the authenticated owner TMA
  recheck: fully reopen the app and confirm the two existing matches now appear
  in public/account views without recreating them.

### 2026-08-10 — D3 / truthful planned-court creation checkpoint

- Owner TMA smoke for the backend feed hotfix PASS: both previously created
  matches appeared without recreation. Recent authenticated public/account feed
  requests returned `200`; backend critical markers and nginx 5xx remained `0`.
- Bounded read-only persistence evidence showed that the match created through
  the old «Бронь + Сбор» screen had no D2 reservation and no YCLIENTS binding.
  The legacy frontend nevertheless claimed a guaranteed/confirmed booking,
  which was a product-truthfulness P1 rather than a provider failure.
- The social creation path now describes the selected date/time/court as a plan,
  explicitly says that the court is not booked, and directs the organizer to the
  existing separate «Забронировать корт» action after match creation. The
  underlying D3 two-stage flow, match payload and payment fields were not
  changed; no reservation/provider operation was executed.
- Verification PASS: focused disclosure regression `1/1`; root E2E `90 passed /
  1 skipped`; root build `1617` modules; `git diff --check` PASS. Backend source,
  schema/migrations, DB, YCLIENTS and production were not changed.
- Deployment is `pending` because the frontend bundle changes. Selectel test
  still runs backend hotfix `e686cf18d2f911c9e1d83cce521c93e230f1108c`
  with the prior D3 frontend container. Next gate is review/integration and a
  frontend-only Selectel test rollout, then health, TMA copy smoke and logs.

### 2026-08-10 — D3 / truthful planned-court frontend rollout

- Git delivery PASS: reviewed checkpoint
  `48edb417ec65e729cf01d42777522b138e5cbfed` fast-forwarded clean `main`
  without a merge commit and was pushed to exact `origin/main`.
- Selectel test preflight PASS at clean detached backend-hotfix runtime
  `e686cf18...`: fetched `origin/main` matched the approved checkpoint, Compose
  validation passed, all containers were healthy/restart `0` and root/health
  returned `200`. Checkout then moved cleanly to exact `48edb417...`.
- Frontend alone was rebuilt/recreated. Its container/image changed from
  `82391a277c2a...` / `cc2011b6b849...` to `374ad9821962...` /
  `31f4cdf2eeb4...`. Backend remained `7ca6956f77fb...`, nginx remained
  `e5b98b53a385...` and PostgreSQL remained `5e36d4dc1a5c...`.
- Automated postcheck PASS: every container is healthy with restart count `0`;
  internal and HTTPS root/health returned `200`; exact asset
  `/assets/index-Dm36BHlZ.js` returned `200` with `605199` bytes. The new
  `Court planned` marker is present and the old `Confirmed & Reserved` marker
  is absent. Bounded backend critical markers and nginx 5xx are both `0`.
- No backend/schema/migration/DB/YCLIENTS/provider/payment/env/secret,
  nginx/PostgreSQL rebuild or production action occurred. Automated deployment
  is `test_deployed`; D3 remains `in_progress` for owner TMA copy smoke and the
  later real D2 reservation-link smoke. No new match or booking is required for
  the copy check.

### 2026-08-10 — D3 / PayKeeper transition gate checkpoint

- Owner rejected the temporary planned-court-without-payment product flow and
  selected PayKeeper. Final contract: a no-court match is created immediately;
  both «new match with court» and «Забронировать корт» on an existing unbooked
  match enter the same checkout where the organizer pays the full court price.
  A paid-court match is not considered booked until both PayKeeper payment and
  the YCLIENTS reservation are canonically confirmed.
- Official PayKeeper documentation confirms signed POST payment callbacks with
  retries, payment status lookup, asynchronous full/partial reverse, receipts,
  and optional authorization/hold with later capture. Account-specific hold
  capability, sandbox/cabinet URL, callback secret, API credentials and fiscal
  settings remain D4 gates; no secret value was requested or stored.
- Transitional frontend is fail-closed: the paid-court creation card remains
  visible but disabled, and the existing unbooked-match button remains visible
  but cannot navigate to D2 create before PayKeeper is enabled. Standalone
  no-court match creation remains available. This prevents new unpaid
  match-linked YCLIENTS writes while D4 is pending.
- Scope is frontend/config/docs/tests only; backend, schema/migrations, DB,
  YCLIENTS, provider calls, payment fields, secrets and production are
  unchanged. Deployment is `pending` until the exact checkpoint is integrated
  and the Selectel test frontend is rolled out with health, TMA and log checks.
- Verification PASS: focused paid-court regressions `2/2`; first full root E2E
  run had `90 passed / 1 skipped` plus one resource timeout at an unchanged
  BookingScreen click, whose focused rerun passed `1/1`; controlled full rerun
  with four workers passed `91 / 1 skipped`. Root build PASS (`1618` modules)
  and `git diff --check` PASS.

### 2026-08-10 — D3 / PayKeeper transition gate Selectel test rollout

- Git delivery PASS: reviewed checkpoint
  `b3c6b7fdc081ff70c2fcec34f4a8882790643015` was fast-forwarded into clean
  `main` and pushed; local `main`, `origin/main` and the clean Selectel test
  checkout matched that exact SHA.
- Frontend alone was rebuilt and recreated. Frontend container/image changed
  from `374ad98219623e699cc4cff230a0b6f883d78b270345c7b181f0fb9b2cd9a1ca` /
  `sha256:31f4cdf2eeb4caf5d4ea1ca14371596ed46e90d9f6a63b84387e76964c4c1e6c`
  to `c6b8c69a14951086b54de6e9dcfc98e24b4d4006e77a4ed8fc9cc8d43e839211` /
  `sha256:493801a7c6b26a95bf1d2b05f5535d0268f7a9785f775dfce102315fcf7edfab`.
  Backend remained `7ca6956f77fb...`, nginx `e5b98b53a385...` and PostgreSQL
  `5e36d4dc1a5c...`.
- Automated postcheck PASS: all four containers are healthy with restart count
  `0`; internal and HTTPS root/health returned `200`; exact asset
  `/assets/index-Do_BVi4B.js` returned `200` with `605758` bytes. The new
  `PayKeeper checkout` marker is present and the obsolete `Court planned`
  marker is absent. Since `2026-08-10T12:52:39Z`, backend critical markers and
  nginx 5xx counts are both `0`.
- No backend/schema/migration/DB/YCLIENTS/provider/payment-field/env/secret,
  nginx/PostgreSQL or production change occurred. Deployment is
  `test_deployed`; D3 remains `in_progress` only for the owner Telegram Mini App
  transition smoke. No booking, payment or YCLIENTS write is required for this
  smoke.

### 2026-08-10 — D3 / payment provider correction to ЮKassa

- Owner corrected the provider decision: ЮKassa is the selected payment
  provider; PayKeeper was recorded in error. No PayKeeper backend integration,
  credential, payment, webhook, schema or provider call had been implemented.
- The local fail-closed UI/config regression now uses ЮKassa naming and a
  provider-specific `yookassa_pending` reason. The product contract is
  unchanged: a no-court match can be created immediately; both «new match with
  court» and the existing unbooked-match «Забронировать корт» action enter the
  same future full-court checkout and cannot create a YCLIENTS reservation
  before payment orchestration is enabled.
- Official ЮKassa documentation confirms 24-hour provider idempotency for
  POST/DELETE, two-stage payments with `capture=false` and
  `waiting_for_capture`, capture/cancel, payment/refund status GET, webhook
  events and refunds. Hold support and expiry depend on the selected payment
  method, so the exact D4 saga remains subject to store capability review.
- Verification PASS: focused YooKassa fail-closed UI regression `1/1`; full
  root E2E `91 passed / 1 skipped`; root production build PASS (`1618`
  modules); production bundle contains the ЮKassa marker and no PayKeeper
  marker; `git diff --check` PASS. Backend tests were not repeated because no
  backend source or image changed.
- This correction changes the frontend bundle and is
  `pending_integration_rollout`. Selectel test remains exact
  `b3c6b7fdc081ff70c2fcec34f4a8882790643015`, which still displays the wrong
  PayKeeper label. No DB/YCLIENTS/payment/provider/secret/production action was
  performed.

### 2026-08-10 — D3 / ЮKassa correction frontend-only Selectel rollout

- Git delivery PASS: exact reviewed checkpoint
  `78a1cef68f74854a9d6e316ffd235ffbd42b38f8` fast-forwarded clean `main`
  without a merge commit and was pushed; local `main`, `origin/main` and the
  final clean detached Selectel checkout matched that exact SHA.
- Selectel preflight PASS at clean `b3c6b7f...`: two-file persistent-runtime
  Compose validation succeeded; all four containers were healthy with restart
  count `0`; internal root/health returned `200`. No change was made before the
  exact target and clean checkout were verified.
- Only frontend was rebuilt/recreated. Frontend container/image changed from
  `c6b8c69a14951086b54de6e9dcfc98e24b4d4006e77a4ed8fc9cc8d43e839211` /
  `sha256:493801a7c6b26a95bf1d2b05f5535d0268f7a9785f775dfce102315fcf7edfab`
  to `dbeb04aea1bbc657f6a681b5e9840e07b5eb2a41af12892f64b49c3d14390ae6` /
  `sha256:387a55f227b0d109f49bc83c44653becd18ac7b0537951f6bf2989a679680cab`.
  Backend stayed `7ca6956f77fb...`, nginx `e5b98b53a385...` and PostgreSQL
  `5e36d4dc1a5c...`.
- Automated postcheck PASS: all containers are `running/healthy` with restart
  count `0`; internal and HTTPS root/health returned `200`; exact asset
  `/assets/index-DRfmeOuD.js` returned `200` with `605749` bytes. The bundle has
  one `ЮKassa checkout` marker and zero `PayKeeper checkout` markers. Bounded
  logs since `2026-08-10T13:11:47Z` have backend/frontend/nginx critical count
  `0` and nginx 5xx count `0`.
- Direct-browser boundary smoke PASS: the page rendered the expected Telegram-
  only login boundary and had no browser console errors; one non-blocking
  Telegram WebApp version warning came from the official Telegram script.
  No authenticated Telegram browser/Desktop surface was available to the
  operator, so synthetic `initData` was not used.
- No backend/DB/schema/migration/YCLIENTS/payment/provider/env/secret,
  nginx/PostgreSQL or production change occurred. Deployment remains `pending`
  only for the owner authenticated TMA click-smoke: verify that «Матч с кортом»
  is visible but disabled with ЮKassa copy, and that «Забронировать корт» in an
  existing unbooked match remains visible but shows the fail-closed notice
  without opening booking or creating a provider record.

### 2026-08-10 — D3 / owner TMA acceptance and closure

- Owner authenticated Telegram Mini App evidence PASS. The create-match screen
  shows «Матч с кортом» with the ЮKassa checkout label, full-court payment copy
  and a disabled «Оплата подключается» action. The no-court match entry remains
  available independently.
- Existing unbooked-match detail evidence PASS: the match is explicitly marked
  «Корт НЕ забронирован», the «Забронировать корт» action remains visible, and
  pressing it shows «Оплата корта через ЮKassa подключается. Бронь без оплаты
  не создаётся.» without navigating to D2 booking.
- Final bounded Selectel postcheck PASS at clean exact runtime
  `78a1cef68f74854a9d6e316ffd235ffbd42b38f8`: all four containers remain
  `running/healthy` with restart count `0`; HTTPS root/health are `200`;
  backend/frontend critical counts are `0`; exact nginx HTTP status-field 5xx
  count is `0`. There were zero `POST /api/v1/bookings` requests after rollout,
  proving the fail-closed click did not submit a booking.
- D3 is `done` and `test_deployed`. Real ЮKassa payment orchestration, the
  paid YCLIENTS create/link business smoke, receipts/refunds and external-write
  compensation are D4 scope. No backend/DB/YCLIENTS/payment/provider/secret or
  production action occurred during this acceptance.

### 2026-08-10 — project technical SPEC handoff

- Added root `SPEC.md` from clean `main = origin/main = 5e41ab70146a7ae555f6e8935fa426ab110a5c7c`.
  It records the factual frontend/backend stack, Selectel test topology,
  domain invariants, API/database boundaries, deployment discipline, D4–D7 and
  mobile gaps, prioritized technical debt and the 300–400-user readiness list.
- The first root E2E run on the default 9 workers had two resource-timeout
  flakes after `89 passed / 1 skipped`; neither touched an assertion. The
  controlled complete rerun on 4 workers PASS: `91 passed / 1 skipped`.
  Root production build PASS: `1618` modules; existing large-chunk and Vite CJS
  warnings remain. Backend gates were not run because no backend/runtime source
  changed. Markdown diff check is PASS.
- Deployment is `not_needed`: documentation only. Selectel test remains exact
  runtime `78a1cef68f74854a9d6e316ffd235ffbd42b38f8`; containers, DB, YCLIENTS,
  ЮKassa, secrets and production were not contacted or changed.

### 2026-08-10 — profile photo viewport overlay correction

- Root cause confirmed: `ProfilePhotoManager` was rendered below the always-
  transformed `.pull-to-refresh__content`. That transform became the containing
  block for the photo overlays' `position: fixed`, so the actions, full-photo
  view and cropper were positioned against the long profile page instead of the
  phone viewport and could require scrolling to find.
- `PlayerProfile.jsx` now portals all three photo overlays directly into
  `document.body`. No visual design, profile API or backend behavior changed.
- The focused Playwright regression reproduced the bug before the fix at the
  new body/viewport assertion and PASS after the fix. The complete controlled
  root E2E run PASS: `91 passed / 1 skipped`; root production build PASS:
  `1618` modules. Backend gates were not run because backend source did not
  change. `git diff --check` PASS.
- Git delivery PASS: the pre-existing technical specification was isolated in
  docs-only commit `03d7fe56174078b20d5cde4257de99be0cdc27f7`; the runtime correction is exact
  commit `b0a500cac7cf1b5b7a2cf2adcc5be6a7eb9c135d`. Both were pushed to clean
  `main = origin/main` without a merge commit.
- Frontend-only Selectel test rollout PASS at exact clean detached runtime
  `b0a500c...`. Only `prosto-padel-test-frontend-1` changed, from container/image
  `dbeb04aea1bb...` / `sha256:387a55f227b...` to
  `036764a2510a...` / `sha256:1034adca3dc4...`. Backend, nginx and PostgreSQL
  retained their exact container/image IDs. All four containers are
  `running/healthy`, restart count `0`; internal and HTTPS root/health returned
  `200`; exact asset `/assets/index-DNzg8ZT1.js` returned `200` with `605894`
  bytes.
- Bounded logs since `2026-08-10T20:55:21Z` contain no application error,
  fatal, unhandled or HTTP 5xx. Direct-browser boundary smoke PASS with the
  expected Telegram-only login message and no browser errors; the sole warning
  is the existing Telegram WebApp 6.0 swipe warning. The focused mobile
  Playwright profile-photo flow is the business regression; owner-authenticated
  TMA click confirmation remains the final visual acceptance.
- Deployment status: `test_deployed_pending_owner_tma_smoke`. No backend, DB,
  schema/migration, YCLIENTS, payment/provider, secret or production change
  occurred.

### 2026-08-11 — technical-debt execution register

- From clean `main = origin/main = 886e7c0aa2126dfd4f910194199d476134ec02c6`,
  added `tech_debt/README.md` and 78 bounded task files. The register covers
  characterization/TDD, proven legacy removal, god-component/client/repository
  decomposition, frontend/backend coverage, real-PostgreSQL invariant lanes,
  strict transports/contracts, CSS/accessibility and source-of-truth cleanup.
- Infrastructure work is explicitly excluded: Yandex Cloud/Selectel design,
  Managed PostgreSQL/PgBouncer, Docker/Compose, networking, CI/CD, monitoring,
  load/capacity and deployment automation remain a separate future track.
  Payment/product additions, app YCLIENTS cancel/reschedule, schema changes and
  legacy payment fields are also outside this cleanup register.
- Mandatory per-task flow is now reproducible: TDD/characterization → local
  candidate commit → fresh no-context review of exact SHA → fix/re-review until
  no P0/P1 and score ≥9 → exact push/test rollout or explicit deferral → docs-
  only closure commit that records review and deployment evidence and marks the
  task `done` last. All quality ratchets established by completed prerequisites
  remain mandatory for later tasks.
- Independent catalog reviews were read-only and sequential. Scores progressed
  `7/10` (`tech_debt_catalog_review`) → `8/10`
  (`tech_debt_catalog_rereview`) → `8.7/10`
  (`tech_debt_catalog_final_review`) → final PASS `9.7/10`
  (`tech_debt_catalog_acceptance_review`). Final review reported zero P0, P1
  and P2; it verified exactly 78 unique table IDs/files, matching metadata, an
  acyclic feasible order, bounded tasks and preserved safety/product invariants.
- Tests/build were not run because only Markdown files changed. Structural
  catalog validation and `git diff --check` PASS. Deployment is `not_needed`:
  runtime, bundle, containers, dependencies, DB/schema/migrations, YCLIENTS,
  payment/provider config, secrets and production were not touched. Selectel
  test remains on frontend/runtime commit `b0a500cac7cf1b5b7a2cf2adcc5be6a7eb9c135d`
  with the previously recorded healthy container/HTTP/smoke/log result.
- Next task is TD-001, `Frontend unit/coverage characterization harness`; only
  one numbered task may be active at a time.

### 2026-08-11 — TD-001 frontend unit/coverage candidate

- Baseline is clean pushed `2ae6d4f64eeb628dfa5cd8849aba9c69cf0346f8`.
  Added a Vitest 3.2.7 + jsdom/Testing Library harness, bounded two-worker unit
  execution, global timer/mock/storage/portal cleanup and deterministic fetch/
  crypto helpers. No production runtime module or product behavior changed.
- RED was the factual missing `test:unit` script. GREEN: 6 files / 22 direct
  unit/component tests cover existing match, booking-home, paid-court and Moscow
  date helpers plus React interaction/effect/portal cleanup. Unit PASS in 1.34 s;
  coverage PASS in 1.98 s with baseline thresholds `51/85/66/51` for statements/
  branches/functions/lines. Clean `npm ci` PASS.
- Dependency choice is explicit: latest Vitest 4 requires Vite 6+, so the
  compatible Vite-5 line is used. Vitest 3.2.4 was rejected after audit found a
  critical advisory; 3.2.7 removes critical findings. Five existing root
  toolchain findings remain visible (`1 low / 1 moderate / 3 high`) and produced
  new planned TD-037/TD-037a rather than an unsafe `npm audit fix --force`.
- Root default E2E at 9 workers reproduced the known resource flake: 81 passed,
  1 skipped and 10 simultaneous match-spec timeouts. The complete controlled
  rerun on the established four-worker budget PASS: 91 passed / 1 skipped.
  Production build PASS: 1,618 modules; existing CJS and large-chunk warnings
  remain owned by TD-036/TD-021.
- First no-context review of local candidate `1b222a35...` scored `9.1/10`
  with no P0/P1 and one bounded P2: cleanup was implemented but no test proved
  cleanup of deliberately leaked state between tests. Added a sequential
  regression that leaves a React root/portal, fake timers, stubbed fetch/crypto/
  env and both browser storages dirty, then proves the next test starts clean.
- Second no-context review of amended `09764ea4...` scored `9.4/10`, reported
  no P0/P1 and confirmed the isolation regression. Its only bounded P2 was a
  planning dependency: compatible PostCSS/Nano ID/Babel remediation should not
  wait for late Vite CJS work. TD-037 now depends on TD-001; TD-037a retains the
  Vite-major prerequisites.
- Acceptance review of `73b1e276...` scored `9.3/10`, reported no P0/P1 and one
  bounded ordering P2: the authoritative table still placed TD-037 after late
  TD-036. The row is now ordered before TD-036, consistent with its TD-001-only
  dependency; a new exact candidate SHA requires final acceptance review.
- TD-001 remains in `review`. No backend gates were run because no backend file
  changed. Candidate amend, repeated gates, fresh no-context review, push and
  dependency/frontend Selectel rollout are still pending.

### 2026-08-11 — TD-001 closure and Selectel test rollout

- Final immutable candidate
  `e67ea7b19d529ddf52f8ef2e076e2579773dcf9f` was pushed to exact
  `origin/main`. Fresh no-context release review
  `/root/td001_release_review` scored `9.7/10` with zero P0/P1/P2 and confirmed
  the production-source boundary, honest coverage scope, cross-test isolation,
  dev-only dependency graph and acyclic `TD-037 → TD-036 → TD-037a` ordering.
- Verification PASS: unit `7 files / 24 tests`; coverage `7 / 24` at actual
  statements/branches/functions/lines `51.85/85.93/66.66/51.85` over ratchets
  `51/85/66/51`; clean `npm ci`; controlled root E2E `91 passed / 1 skipped`;
  root build `1618` modules; `git diff --check`. The default nine-worker E2E
  attempt reproduced the existing resource flake (`81 passed / 1 skipped / 10
  timeouts`) before the complete four-worker PASS. Backend gates were
  `not_applicable` because backend source did not change.
- Selectel preflight PASS at clean detached `b0a500c...`: fetched
  `origin/main` matched the candidate; two-file Compose quiet validation passed;
  all four containers were healthy/restart `0`; internal and HTTPS root/health
  were `200`. Checkout then moved cleanly to exact detached `e67ea7b...`.
- Frontend alone was rebuilt/recreated. Container/image changed from
  `036764a2510a...` / `sha256:1034adca3dc4...` to `d6e625d033b5...` /
  `sha256:11fe29e9d05c...`. Backend `7ca6956f77fb...`, nginx
  `e5b98b53a385...` and PostgreSQL `5e36d4dc1a5c...`, including their image
  IDs, remained unchanged.
- Postcheck PASS: clean exact detached checkout; every container healthy with
  restart `0`; internal and HTTPS root/health `200`; exact production asset
  `/assets/index-DNzg8ZT1.js` returned `200`, `605894` bytes and contained zero
  Vitest/jsdom/Testing Library markers. Direct-browser smoke rendered the exact
  Telegram-only login boundary without console errors; the only warning is the
  existing official Telegram WebApp 6.0 swipe warning. Bounded frontend,
  backend and nginx critical counts and nginx 5xx count are all `0` since
  frontend start `2026-08-11T13:23:55Z`.
- TD-001 is `done` and `test_deployed`. This docs-only closure changes no
  runtime/test/config/dependency byte, so its own deployment is `not_needed`;
  deployed application commit remains exact `e67ea7b...`. DB/schema/migrations,
  YCLIENTS, payments/provider, secrets and production were not changed. Next
  task is TD-002; only one numbered task remains active at a time.

### 2026-08-11 — TD-002 root error-boundary candidate

- Baseline is clean pushed closure `5406651759682703cc96da2e7e61581148b6a1c6`.
  RED: the focused unit test failed because `RootErrorBoundary` did not exist.
  Inspection also found and removed a P0 legacy `index.html` `window.onerror`
  handler that exposed raw error text and a line number through `alert`.
- Added a class boundary around `AuthGate` while leaving splash/session timing
  unchanged. It catches React descendant render/lifecycle failures, shows a
  mobile-safe accessible recovery screen, focuses an explicit retry action and
  remounts its subtree only after that action. It does not claim to catch async
  callbacks, event-handler failures or errors outside its React subtree.
- Diagnostic reporting exposes only frozen allowlisted stage
  `authenticated_app_render`; the exception and component stack are neither
  rendered nor passed to the reporter. A failing reporter cannot replace the
  recovery screen. Unit regressions cover normal rendering, sensitive-data
  exclusion, focus, explicit remount, bounded repeat failure and reporter
  failure. The unit regression covers the stage-only reporter; WebKit covers
  the ordinary Telegram auth gate, absence of the unsafe global handler,
  fallback and retry.
- First fresh no-context review of candidate `ef786588...` scored `8.4/10`:
  no P0, one P1 and one P2. It correctly found that React/WebKit still emitted
  a caught raw exception through browser diagnostics and that the standalone
  Playwright mount did not prove the actual `main.jsx` wrapper. Both findings
  were reproduced before correction: the new `pageerror` assertion failed with
  the synthetic bearer/initData/PII/provider string twice.
- Added the confidentiality bootstrap as the first application-owned head
  script, before Telegram and React. It replaces browser `console.error` with
  the static occurrence marker `[prosto-padel] client error details suppressed`
  and uses first-registered capture listeners plus `stopImmediatePropagation`
  for window-targeted `error` and `unhandledrejection`, so later listeners
  cannot receive the raw payload. Non-window resource errors pass through to
  existing element/React `onError` recovery. This does not claim async/event
  errors are recovered and does not change server logging. WebKit now proves
  both diagnostic confinement and resource-handler delivery. Its fallback test
  replaces `AuthGate` before real application startup, proving recovery through
  the actual `main.jsx` integration.
- Second fresh review of candidate `1c63b83...` scored `8.1/10`: no P0, one P1
  and one P2. It found that the then module-installed bubble listener did not
  confine payloads from other listeners and that stage-only reporting was
  overstated as WebKit coverage. Both were corrected. Third fresh review of
  candidate `0efb6dd...` scored `8.2/10`: no P0/P2 and one P1. It found that
  unconditional capture suppression also blocked resource error handlers,
  including the existing broken-avatar fallback. The handler now ignores
  non-window error targets; focused WebKit passes `3/3` with the new resource
  regression. Review of `2db97ab...` scored `9.2/10` with no P0/P1 and one P2:
  the first full-run inventory omitted one `did not run`; documentation now
  accounts for all 95 tests. Review of `f3fb504...` scored `9.3/10` with no
  P0/P1 and one bounded P2: the bootstrap pushed `<meta charset>` beyond the
  conforming first-1024-byte prescan window. Charset now precedes the bootstrap,
  which remains the first executable application-owned script. A new exact-SHA
  final review remains required.
- Final verification PASS: focused boundary unit `4/4`; focused WebKit `3/3`;
  full unit `8 files / 28 tests`; coverage aggregate
  `56.89/86.86/71.05/56.89`, with the boundary held to
  `100/100/100/100`; root build `1619` modules; `git diff --check`. The default
  nine-worker E2E completed `91 passed / 1 skipped / 2 failed / 1 did not run`;
  the failures were the two known resource flakes in unchanged
  notifications/profile-photo tests. Their single-worker rerun passed `2/2`,
  and the final full controlled four-worker run passed `94 / 1 skipped`.
  Existing Vite CJS/large-
  chunk warnings remain. Backend gates
  are `not_applicable` because backend source did not change.
- Final immutable candidate is
  `044aeffb71077fcde52d2eabadcc6145610f0f64`. Fresh no-context review task
  `/root/td002_final_review_4` scored `9.8/10` with zero P0/P1/P2. Exact prompt
  and verbatim report are stored in `tech_debt/002_root_error_boundary.md`.

### 2026-08-11 — TD-002 closure and Selectel test rollout

- Candidate `044aeffb71077fcde52d2eabadcc6145610f0f64` was pushed to exact
  `origin/main`, then checked out detached on the clean Selectel test worktree.
  Preflight confirmed the previous deployed TD-001 runtime `e67ea7b...`, quiet
  two-file Compose validation, all healthy/restart `0`, and HTTPS root/health
  `200`.
- Only frontend was rebuilt/recreated. Container/image changed from
  `d6e625d033b5...` / `sha256:11fe29e9d05c...` to `15a637d33d6c...` /
  `sha256:d873752c9238...`. Backend `7ca6956f77fb...`, nginx
  `e5b98b53a385...` and PostgreSQL `5e36d4dc1a5c...`, including their image
  IDs, remained unchanged.
- Postcheck PASS: exact clean detached checkout; all containers healthy/restart
  `0`; HTTPS root/health `200`; exact asset `/assets/index-CD2hPLLo.js` returned
  `200` and `608422` bytes. The UTF-8 prescan, static diagnostic marker and
  absence of the legacy `window.onerror`/`alert` source were confirmed in the
  deployed HTML. Bounded frontend/backend/nginx `error|fatal|unhandled` counts
  and nginx 5xx are all `0` since frontend start
  `2026-08-11T15:04:11.610115996Z`.
- Direct-browser smoke PASS: the deployed page reached the expected
  Telegram-only `outside_telegram` boundary; the recovery fallback did not
  appear; no dialog or browser error log appeared. The official Telegram SDK
  owns a runtime `window.onerror` on the real page, while the removed legacy
  raw-alert source remains absent from shipped HTML.
- TD-002 is `done` and `test_deployed`. This closure commit changes only the
  task, register and WORKLOG Markdown, so its own deployment is `not_needed`;
  deployed application remains exact `044aeffb...`. Backend, DB/schema,
  migrations, YCLIENTS, payments/provider, secrets and production were not
  changed. Next task is TD-003; only one numbered task remains active.

### 2026-08-11 — TD-003 static quality gates baseline

- TD-003 is `in_progress` from clean pushed baseline
  `0e2f1fa1d7a7c67059981398c9e8d685a02b2549`. Selectel test remains deployed
  at reviewed runtime `044aeffb71077fcde52d2eabadcc6145610f0f64`.
- Root had 83 tracked `.js`/`.jsx` files under `src/tests/scripts`; backend has
  360 tracked TypeScript files under `backend/src`. Root/backend manifests have
  no ESLint, Prettier, Knip or equivalent dependencies/scripts, and no static
  gate configuration exists. Baseline violation counts remain to be measured
  with pinned candidate tools before selecting narrow ratchets.
- Scope is check-only quality tooling plus repository-specific regression tests;
  no bulk formatting, runtime behavior, infra, DB/schema, YCLIENTS, payments or
  production changes are authorized.

### 2026-08-11 — TD-003 static quality gates candidate preparation

- Added pinned Node-20.11-compatible check-only tooling: ESLint `9.39.5`,
  Prettier `3.9.6`, Knip `5.88.1` and TypeScript `5.9.3`. The new `lint`,
  `format:check` and `dead-code:check` scripts enumerate tracked plus nonignored new files, never
  rewrite during checks, and pin both their configs and every allowed legacy
  finding by exact SHA/digest.
- ESLint measured 105 legacy issues in 45 of 96 checked files
  (`no-unused-vars=70`, hooks dependencies `21`, empty blocks `11`, control
  regex `2`, conditional hook `1`). Prettier initially measured 409 individually hashed
  legacy files among 482 checked. Knip measured 16 unused files, unused exports
  in 38 files and unused exported types in 70 files, with no dependency,
  unlisted, binary or duplicate findings. Six E2E files have exact pinned
  Vite-root browser imports instead of a blanket unresolved-import suppression.
  Seven legacy `supabaseClient` occurrences in five files are separately
  ratcheted; additions fail and removals remain owned by TD-006/TD-007.
- Enabled backend `noUnusedLocals` and `noUnusedParameters`. The strict probe
  went from 25 findings to zero through import/constant cleanup and two
  underscore-prefixed intentionally unused test callback parameters. No runtime
  branch, API/schema, SQL, UI or payment field changed.
- TDD evidence: the focused ratchet test first failed because its helper module
  was absent, then passed `3/3`; it also caught and drove the correction of a
  nondeterministic Knip-array digest. Final clean-install verification: root and
  backend `npm ci` PASS; static gates PASS; root unit `9/31`; coverage
  `56.89/86.86/71.05/56.89`; root E2E on four workers `94/1 skipped`; root
  build `1619` modules. Backend typecheck PASS, unit `138/3366`, E2E `2/4`,
  build PASS; `git diff --check` PASS.
- Candidate commit, fresh no-context review and Selectel test rollout remain
  pending. Deployment is required because dependency manifests and backend
  build inputs changed, even though runtime behavior is intended to remain
  unchanged. Current Selectel runtime remains reviewed `044aeffb...`.

### 2026-08-11 — TD-003 first independent review correction

- Fresh no-context `/root/td003_review_1` reviewed exact
  `0e2f1fa...bd8dbcc`, scored `7/10` and failed it with one P1 and three bounded
  P2 findings. It found that import deduplication hid repeated restricted
  imports, some JS/TS extensions and computed literals were outside the scan,
  broad `ignoreUnresolved` could hide new Vite-root typos, the local-only Knip
  exclusions lacked ownership, and the recorded unused-export file count was
  stale (`39` instead of `38`).
- Correction TDD first failed `2/4`, then passed `4/4`. Restricted-import
  coverage now scans every tracked/nonignored JS/TS module variant, preserves
  each occurrence and catches statically computed string concatenation. The
  actual legacy baseline is seven occurrences in five files.
- ESLint now receives only Git tracked/nonignored files, so it needs no local
  prototype exclusions. Knip's broad unresolved suppression was removed; exact
  legitimate Vite-root browser findings in six E2E files are now ratcheted.
  Ten exact `src/` bot prototypes remain Knip-only exclusions because they are
  untracked and already `.gitignore`d; TD-010 owns removing the exclusions when
  those local files are deleted or moved outside the app workspace.
- Repeat correction gates PASS: lint `96 files / 105 ratcheted issues`, format
  `482 / 409 ratcheted`, Knip with seven restricted occurrences, focused ratchet
  `4/4`, full root unit `9/32`, unchanged coverage
  `56.89/86.86/71.05/56.89`, build `1619` modules and controlled root E2E
  `94/1 skipped`. A corrected commit and new fresh exact-SHA review remain
  pending. No runtime/API/schema/SQL/UI/payment behavior was changed.

### 2026-08-11 — TD-003 second independent review correction

- Fresh no-context `/root/td003_review_2` reviewed exact
  `0e2f1fa...621c615`. It found no P0/P1 and confirmed the first review's four
  findings were corrected, but scored `8.8/10` / FAIL for one bounded P2:
  comments between `from` and a specifier and a static template expression such
  as `` `./supabase${'Client'}.js` `` could evade the raw regex.
- TDD reproduced both cases before implementation. The restricted-import gate
  now uses a bounded deterministic static-string parser for whitespace/comments,
  quoted and template literals, literal interpolation, `+` concatenation and
  JavaScript escapes. Focused ratchet remains `4/4`; lint, format and Knip PASS
  with the same 105/409/seven legacy baselines. A new correction commit and a
  third fresh exact-SHA review remain required.

### 2026-08-12 — TD-003 third independent review correction

- Fresh no-context `/root/td003_review_3` reviewed exact
  `0e2f1fa...1e89509`, scored `6.8/10` / FAIL and found one P1 plus two P2. The
  interim token-blind parser still false-matched comments/string contents and
  missed valid dynamic import/require variants; Node-only scripts/configs also
  inherited browser globals, and the baseline root inventory was 83 tracked
  `.js`/`.jsx` files rather than 93.
- Replaced the custom source scanner with the TypeScript `5.9.3` compiler AST,
  pinned as a direct dev dependency compatible with Node 20.11. It recognizes
  import/export declarations, import-equals, dynamic `import()` and `require()`,
  while evaluating only static quoted/template/concatenated string expressions.
  Comments, ordinary strings and nonstatic expressions are ignored. Focused
  regressions cover trivia between tokens, import options, parentheses inside a
  literal, false-positive comments/strings and nonstatic concatenation.
- ESLint now gives browser globals only to frontend and mixed browser E2E files;
  root configs and quality scripts receive Node globals only. Baseline inventory
  documentation is corrected. The rewritten lockfile now conforms to Prettier,
  so the current ratcheted legacy count is 408 rather than the historical 409.
  Clean installs PASS for root and backend. Repeat gates PASS: lint `96/105`,
  format `482/408`, Knip with seven restricted occurrences, root unit and
  coverage `9 files / 33 tests` at `56.89/86.86/71.05/56.89`, root build `1619`
  modules, controlled four-worker E2E `94/1 skipped`, backend typecheck, unit
  `138/3366`, E2E `2/4` and build. The first default-reporter E2E run completed
  all `94/1 skipped` tests but its HTML-report process did not exit before the
  outer timeout; the required controlled text-reporter rerun exited `0`.
  `git diff --check` passed and the correction was committed as `3adc17a`, then
  supplied to the fourth fresh exact-SHA review.

### 2026-08-12 — TD-003 fourth independent review correction

- Fresh no-context `/root/td003_review_4` reviewed exact
  `0e2f1fa...3adc17a`, scored `6.3/10` / FAIL and found one P1 plus three bounded
  P2 issues. The Windows CRLF checkout made lint/format hashes and Knip byte
  offsets differ from the Node 20.11 Linux target; backend runner `.mjs`/`.cjs`
  modules were outside the general gates; and static TypeScript assertion plus
  CommonJS wrapper forms could evade the restricted-import scan. The task and
  register also remained `in_progress` instead of entering `review`.
- Repository reads now normalize CRLF/lone CR to LF before any baseline hash or
  Prettier comparison. The Knip semantic digest omits only EOL-dependent `pos`
  byte offsets while retaining file/name/line/column/category and occurrence
  multiplicity. A direct comparison of normalized Windows `src/App.jsx` with
  its Git LF blob produced the same SHA-256. The cross-platform baseline is 105
  ESLint issues, 390 Prettier files and the same Knip semantic finding set.
- Both backend auth integration runners are now covered by ESLint, Prettier and
  the backend Knip workspace. Current gates cover `98` lint files and `484`
  format files. Knip remains `16` unused files, exports in `38`, types in `70`,
  six exact unresolved E2E files and zero dependency findings.
- The AST evaluator now unwraps `as`, `satisfies` and type assertions and accepts
  parenthesized `require` plus `module.require`. Focused regressions cover all
  reported forms, EOL normalization and location-independent Knip semantics:
  `7/7` PASS. The direct backend `@nestjs/schematics` dev dependency is retained
  intentionally because `backend/nest-cli.json` directly names that collection;
  production dependency count is unchanged.
- Full repeat gates PASS: lint `98/105`, format `484/390`, Knip with seven
  restricted occurrences, root unit and coverage `9 files / 35 tests` at
  `56.89/86.86/71.05/56.89`, root build `1619` modules, controlled four-worker
  E2E `94/1 skipped`, backend typecheck, unit `138/3366`, E2E `2/4` and build.
  Task/register state is now `review`; `git diff --check`, immutable correction
  commit and a fifth fresh exact-SHA review remain before any push or rollout.

### 2026-08-12 — TD-003 fifth independent review correction

- Fresh no-context `/root/td003_review_5` reviewed exact
  `0e2f1fa...fbbc498`, scored `8.0/10` / FAIL and found one P1 plus two P2. The
  AST scan missed `(module).require`, falsely counted a locally shadowed
  `require`, omitted TypeScript import-type nodes, and the unpublished range
  still contained five implementation/correction commits rather than the one
  squashed task candidate required by `tech_debt/README.md`.
- Restricted-import collection now builds an isolated no-lib/no-resolve
  TypeScript program and uses its symbol checker. Global/ambient CommonJS
  `require` and `module` calls remain covered, while local parameters/imports/
  variables with those names are ignored. Transparent receiver wrappers,
  `module['require']` and `type T = import('...').T` are covered. Focused ratchet
  remains `7/7` PASS with eight positive static variants and two shadow-negative
  variants in the CommonJS/TypeScript case.
- Final root repeat gates PASS: lint `98/105`, format `484/390`, Knip/seven,
  unit and coverage `9/35` at `56.89/86.86/71.05/56.89`, build `1619` modules,
  controlled E2E `94/1 skipped`; `git diff --check` remains required after docs.
  Backend content did not change after its last PASS results: typecheck, unit
  `138/3366`, E2E `2/4`, build. Task/register stay `review`; the local unpublished
  TD-003 range will be soft-squashed to one candidate commit before the sixth
  fresh no-context review. Push, rollout, DB/schema, provider and production
  remain untouched.

### 2026-08-12 — TD-003 sixth independent review correction

- The unpublished TD-003 range was soft-squashed without changing its index or
  worktree content into one commit `d199a0b`, exactly one commit ahead of the
  clean pushed baseline. Fresh no-context `/root/td003_review_6` reviewed exact
  `0e2f1fa...d199a0b`, found no P0/P1 and verified all previous corrections, but
  scored `8.8/10` / FAIL for one P2: Knip digest mismatch discarded the captured
  report and printed only a generic remediation command.
- The mismatch path now formats the current Knip report immediately: unused-file
  paths and every issue's path, available line/column, category and symbol are
  printed deterministically before the gate throws. Byte-only `pos` remains
  excluded. Focused regression covers unused file, unresolved dependency,
  unused export and enum member output; ratchet `7/7`, lint `98/105`, format
  `484/390` and Knip/seven PASS.
- Root repeat PASS: unit/coverage `9/35`, unchanged coverage percentages, build
  `1619` modules and compact four-worker E2E `94/1 skipped` with exit `0`. One
  preceding list-reporter run also completed all `94/1` tests but its Windows
  cleanup did not exit before the outer timeout; no process or port remained.
  `git diff --check` remains before amend. Candidate remains one unpublished
  `review` commit after amend. Backend source is unchanged from its full PASS;
  server/runtime, DB/schema, providers, payments and production remain untouched.

### 2026-08-12 — TD-003 seventh independent review correction

- Fresh no-context `/root/td003_review_7` reviewed the one-commit exact range
  `0e2f1fa...20896ab`, found no P0/P1 and reconfirmed every previous correction,
  but scored `8.8/10` / FAIL for one P2. Knip 5 represents both `enumMembers`
  and `classMembers` as nested parent/member maps; the new failure formatter
  special-cased only the former, so a class-member-only mismatch could still
  print no actionable detail.
- Diagnostic formatting is now shape-generic: every array category is printed,
  and every object category is traversed as deterministic parent/member arrays.
  The focused regression now proves path, line, column, category and symbol for
  `classMembers Widget.legacyMethod` as well as enum members, unresolved imports,
  exports and unused files. Focused ratchet `7/7`, lint `98/105`, format
  `484/390` and Knip/seven PASS. Root unit/coverage `9/35` and build `1619`
  modules PASS; runtime code is unchanged from the earlier clean E2E exit `0`.
  The repeat dot-reporter run completed all `94/1 skipped` tests but its Windows
  wrapper again failed to exit after the final summary and hit the outer timeout;
  no product test failed. That harness cleanup instability belongs to TD-004 and
  is not hidden as a passing command here. `git diff --check` remains before
  amending the same single unpublished `review` commit and starting an eighth
  fresh no-context review. Server/runtime, DB/schema, providers, payments and
  production remain untouched.

### 2026-08-12 — TD-003 eighth independent review correction

- Fresh no-context `/root/td003_review_8` reviewed the one-commit exact range
  `0e2f1fa...928bebc`, found no P0/P1 and verified the prior corrections, but
  scored `8.2/10` / FAIL for two P2 findings. Knip's `duplicates` category is an
  array of symbol arrays, so the diagnostic printed one JSON blob instead of
  each available location; tracked `playwright.config.js` was also absent from
  the Prettier inventory despite being nonconforming.
- Knip diagnostic traversal is now recursive for arrays and parent/member maps;
  the focused regression proves separate path/line/column/category/symbol output
  for both duplicate symbols as well as flat, enum and class categories.
  `playwright.config.js` is now part of the sticky format baseline. Current gates
  PASS: lint `98/105`, format `485/391`, Knip/seven and focused ratchet `7/7`.
  Full root repeat PASS: unit/coverage `9/35`, unchanged coverage, build `1619`
  modules and four-worker E2E `94/1 skipped` with exit `0`. `git diff --check`,
  amend of the same single unpublished `review` commit and a ninth fresh
  no-context review remain. Backend/runtime, server, DB/schema, providers,
  payments and production remain untouched.

### 2026-08-12 — TD-003 closed and deployed to Selectel test

- Baseline `0e2f1fa1d7a7c67059981398c9e8d685a02b2549`; exact single
  reviewed candidate `1779efb713f3ba4ddc5ffd574c37127570328387` was pushed to
  `main`. Fresh no-context reviewer `/root/td003_review_9` returned PASS
  `9.6/10`, with `P0=0`, `P1=0`, `P2=0`; the exact prompt and verbatim report
  are preserved in `tech_debt/003_static_quality_gates.md`.
- Final repository gates: lint `98 files / 105 ratcheted findings`, format
  `485 / 391`, Knip/dead-code and seven restricted imports PASS, focused
  ratchet `7/7`, root unit `9/35`, coverage
  `56.89/86.86/71.05/56.89`, build `1619` modules and controlled root E2E
  `94 passed / 1 skipped` with exit `0`. Backend typecheck, unit
  `138 suites / 3366 tests`, E2E `2/4` and build PASS; `git diff --check` PASS.
- Selectel test checkout is detached, exact and clean at `1779efb`. Frontend
  container `50644090c6ea...` / image `sha256:135a897a3f84...` and backend
  container `45a31e1af7aa...` / image `sha256:5594d55d9fb...` were rebuilt and
  recreated; both are healthy with restart count zero. Nginx and PostgreSQL
  retained their previous container/image IDs and restart count zero.
- HTTPS root and `/api/v1/health` returned `200`. New asset
  `/assets/index-CD2hPLLo.js` returned `200`, `608422` bytes, SHA-256
  `00c57d7618b75f72fe5b537158807d594aa529000de68d058be9011ea8a7de0e`.
  In-app-browser smoke showed title `Просто Падел — клубное приложение` and the
  expected outside-Telegram gate; no root error fallback, dialog or browser
  error log appeared. Bounded logs: frontend/backend
  `error/fatal/unhandled=0/0/0`, nginx `5xx=0`.
- Existing Vite chunk/CJS warnings remain. The backend image's Node `20.11.0`
  reports a dev-only transitive engine warning requesting `20.11.1`; build and
  runtime are healthy, and runtime production dependencies did not change.
  Infrastructure image upgrades remain outside this register.
- DB/schema, migrations, env, providers, payments and production were not
  changed. TD-003 is `done`. This closure changes Markdown only, so closure
  deployment is `not_needed`; deployed runtime remains `1779efb`.

### 2026-08-21 — D4.1 provider-neutral payment order/attempt candidate

- The first bounded D4.1 slice adds runtime-disconnected `PaymentOrder` and
  initiate-only `PaymentAttempt` state machines, length-prefixed SHA-256 request
  digests and a provider-neutral acquiring port. The immutable order snapshot
  binds positive minor-unit money, pricing contract/digest, receipt contract and
  privacy-adapter contact digest, plus the cancellation-policy version.
- One active attempt is enforced by the domain transition. The client ledger key
  and provider idempotency key are separate, exact retries return the persisted
  attempt, an uncertain write becomes `unknown`, blind writes stay blocked and
  only reconciliation can resolve it. Acquiring commands contain no receipt
  contact, tax field or raw PII; fiscal receipt execution remains a separate
  role and is not assigned to any provider by this slice.
- Focused payment tests PASS: `2 suites / 28 tests`. Full gates PASS: root lint
  `98 files / 105 ratcheted findings`, format `491 / 391`, Knip/dead-code with
  seven unchanged restricted legacy imports, E2E `94 passed / 1 skipped` and
  build `1619 modules`; backend typecheck, unit `140 suites / 3394 tests`, E2E
  `2 suites / 4 tests` and build. The Knip baseline digest changed only for the
  reviewed exports of this intentionally runtime-disconnected domain boundary.
- No provider was selected. Refund, webhook inbox, compensation, fiscal receipt
  execution, persistence/concurrency adapter and migration proposal remain later
  bounded D4 slices. Existing `paymentStatus`, `ownerPaid`, `holdAmount` and
  `prepay` were not changed. No SQL/migration, schema, DB, env/secret, frontend,
  Nest registration, server/provider call, push, merge or fast-forward occurred.
- Deployment is `deployment_deferred_by_user`: this local backend candidate must
  not be integrated or rolled out in the current gate. Selectel was not contacted;
  the latest documented test runtime remains `1779efb`.
- Independent read-only review verified exact staged diff hash `bedc48855e21f6f8411c4651f8261b6d051b53f7`
  and returned PASS with `P0=0`, `P1=0`. The only post-review change records
  that result here; the final exact diff is rechecked before the local commit.
  Next step is a clean task 00 handoff before any integration decision.

### 2026-08-21 — D4 payment persistence/concurrency review contract

- A separate local docs-only slice on `codex/d4-payment-persistence-contract`
  from exact `origin/main` `3f1fe58` defines the acceptance contract for atomic
  attempt start, owner-scoped idempotency, one active `pending`/`unknown`
  attempt, fixed lock ordering, a durable external-write dispatch fence, crash
  windows and read-only reconciliation.
- The proposal explicitly records the unresolved runtime prerequisite: the
  current domain has no transition command ID/evidence digest, so exact replay
  control must be designed in a later code-only slice before orchestration. It
  does not claim that repository atomicity, dispatch recovery or terminal replay
  is already implemented.
- Local gates PASS: document Prettier, root lint `98/105`, format `491/391`,
  Knip/dead-code with seven unchanged restricted legacy imports, E2E `94 passed
  / 1 skipped` and build `1619 modules`. Backend gates are `not_applicable`
  because no backend file changed.
- No code, repository, SQL/migration, schema, DB, runtime/Nest, provider/API,
  server/SSH, env/secret or legacy payment field was changed or invoked. No
  commit, push, integration or deployment occurred. Deployment is `not_needed`
  because the diff is documentation only and D4 payment code remains
  runtime-disconnected. Independent review of exact staged diff `c1ca7397528c793fe2d8fca8bd93176003af4a7f`
  returned PASS with `P0=0`, `P1=0`; a separate local commit gate remains.

### 2026-08-21 — D4 persistence/concurrency contract integrated

- Exact reviewed docs-only candidate `6477cac6ac98011af7d0c1aa2cbeb78b0fe3ae3e`
  with tree `f055c5f50c4f17b1ac9e6d3b2d490559d27fc193` was fast-forwarded
  into clean local `main` without a merge commit and pushed to `origin/main`.
  Local and remote-tracking main matched that SHA with divergence `0/0` after
  the push.
- The integrated diff contains only
  `D4_PAYMENT_PERSISTENCE_CONCURRENCY_CONTRACT.md` and this WORKLOG. It adds no
  executable code, SQL/migration, schema, repository, runtime/Nest wiring,
  provider/API integration, dependency, env or secret.
- The exact integrated diff had already passed document formatting, root lint,
  format, dead-code, E2E `94 passed / 1 skipped`, build `1619 modules` and
  independent review with `P0=0`, `P1=0`; integration introduced no content
  change, so those gates were not repeated.
- Deployment is `not_needed`: the change is documentation only and D4 payment
  foundation remains disconnected from runtime. Selectel was not changed or
  contacted for this contract gate; no DB/schema, provider/API or production
  action occurred.
- The contract is delivered. Any repository types, deterministic mocked
  concurrency tests, observation replay control, migration proposal or runtime
  work requires a new separately approved bounded slice.

### 2026-08-21 — D5.1 migration 035 runtime-disconnected candidate closeout

- On exact detached `main` base
  `a3c2fe0c2b03f3e4f18b30001c7ceb780969fdf8`, the five-file migration 035
  candidate adds only private backend PostgreSQL persistence for resumable,
  versioned player onboarding: normalized declared email, ordered onboarding
  state, bounded code-only initial-level survey answers and append-only exact
  consent-document acceptances. It adds no Nest/API/frontend wiring.
- Declared canonical phone and normalized email are required only for onboarding
  completion. Neither contact is marked verified, no contact uniqueness is
  claimed, and `player_rating_states.is_verified` remains rating verification
  only. Public-player search/profile projections are unchanged and receive no
  contact PII.
- `PRECHECK` and `POSTCHECK` are read-only exact catalog checks. Application
  access is least-privilege and column-scoped; consent acceptances and completed
  onboarding are immutable. `ROLLBACK` locks the affected relations and refuses
  destructive rollback after onboarding/contact data exists.
- Focused migration contract PASS: `1 suite / 7 tests`. This worktree has no
  installed `node_modules`; the successful rerun used an already installed
  local dependency tree whose backend `package.json` and `package-lock.json`
  SHA-256 values exactly match this worktree. No dependency was installed or
  changed.
- No migration was applied to a database. No DB/schema, runtime/Nest, API,
  frontend, server/SSH, Selectel, provider, secret/env, payment field or
  production state was changed. No commit, push, merge or integration occurred.
  Deployment is `not_needed` for this uncommitted runtime-disconnected local
  candidate; DB/schema application remains a separate explicit owner gate.
- Independent read-only review of the exact six-file candidate snapshot returned
  PASS with `P0=0, P1=0`. The only post-review change records that result here;
  the final exact diff is rechecked before the separate local commit decision.
  Migration apply and every runtime rollout remain separately gated.

### 2026-08-21 — D5.1 migration 035 PRECHECK stop and local correction

- Exact candidate commit `4377141277d0eeec6d13c38f6fa1d04335187326`
  was integrated into clean local/remote `main` before the separately approved
  database gate. Selectel test target identity was confirmed read-only as host
  `prosto-padel-test-01`, compose project `prosto-padel-test`, PostgreSQL
  `14.23`, database `prosto_padel_test_migration_cycle`, primary/not in recovery;
  the PostgreSQL container was healthy with restart count `0`.
- Exact migration 035 PRECHECK ran in a read-only transaction and failed closed
  before DDL. Error:
  `PRECHECK_FAILED: backend_auth.player_rating_states differs from 019_backend_auth_player_rating_state`.
  Migration 035 was not applied; POSTCHECK and ROLLBACK were not run. Server
  checkout, containers, runtime, env/secrets, provider/API and production were
  unchanged.
- Root cause is local and deterministic: migration 027 canonically re-comments
  `backend_auth.player_rating_states` with fingerprint owner
  `027_backend_admin_rating_state`, while all four migration-035 SQL artifacts
  incorrectly required the obsolete migration-019 owner. The correction changes
  only those checks and the corresponding rollback diagnostic to canonical 027;
  it does not alter tables, columns, ACLs, transition logic or runtime wiring.
- Focused regression now requires canonical 027 in apply/PRECHECK/POSTCHECK/
  ROLLBACK and rejects every return to `019_backend_auth_player_rating_state`.
  Focused migration contract PASS: `1 suite / 8 tests`; `git diff --check` PASS.
  No dependency was installed or changed.
- This correction slice made no SSH/DB/schema call and performed no commit,
  push, integration or deployment. Deployment is `not_needed`; the documented
  Selectel test runtime remains `1779efb` and the migration remains
  `not_applied`. A corrected commit/integration and a new explicit DB gate are
  required before PRECHECK may be retried.
- Independent read-only P0/P1 review of the exact six-file correction diff
  returned PASS with `P0=0, P1=0`. The only post-review change records that
  result here; the final exact diff is rechecked before a separate local commit
  decision.

### 2026-08-21 — D5.1 migration 035 applied and verified on Selectel test

- Exact corrected source commit
  `0162d01765a1ab653c0932e8c94eee4862097f24` was present in clean local and
  remote `main`. Reviewed artifact SHA-256 values were migration
  `3400a283cfae623b019782c50366fb6ef46b863baeda55d5fc9991a37e8e8aba`,
  PRECHECK `e34706d96d27baf3d51377f0959f1f9d8a8857d9740337802e21dcbd5d85176c`
  and POSTCHECK
  `03059abd3c7239fca0cde3602ba4a7c33a91c4ab6ca8c58135c7178edba41323`.
- Selectel test target was confirmed read-only as host
  `prosto-padel-test-01`, Compose project `prosto-padel-test`, PostgreSQL
  `14.23`, database `prosto_padel_test_migration_cycle`, primary/not in
  recovery. Database user `prosto_padel_test` is a direct member of
  `backend_auth_owner`; the PostgreSQL container was healthy with restart count
  `0`.
- Exact PRECHECK was streamed directly from the reviewed local artifact without
  creating a server file. It exited `0`, returned `ready=true`,
  `target_absent=true` and `runtime_connected=false`, and ended with `ROLLBACK`.
  The corrected canonical `027_backend_admin_rating_state` fingerprint gate
  passed.
- Exact migration 035 was then streamed and applied exactly once. It exited `0`,
  reached `COMMIT` and returned
  `035_backend_player_onboarding_foundation applied; runtime remains disconnected`.
- Exact read-only POSTCHECK exited `0`, returned `verified=true`,
  `new_tables_empty=true`, `runtime_connected=false`,
  `rating_state_unchanged=true` and `contact_verification_added=false`, and ended
  with `ROLLBACK`. Migration status is `applied_verified`; migration 035 must
  not be applied again. The rollback migration was not run.
- Server checkout, application containers/runtime, env/secrets, provider/API and
  production were unchanged. No Selectel rollout/restart occurred. Deployment
  is `not_needed` for this runtime-disconnected schema foundation; the
  application runtime remains `1779efb`. Application health/business smoke/log
  checks were not run because no runtime was deployed.
- This closeout changes only this WORKLOG entry. It performs no commit, push,
  integration, SSH/DB/schema command or runtime action. Independent read-only
  review of the exact one-file diff returned PASS with `P0=0, P1=0`; the only
  post-review change records that result here, and the final exact diff is
  rechecked before a separate local commit decision.

### 2026-08-21 — D5.1 authenticated onboarding read/resume candidate

- On exact detached base `57abac76bfea7a38f2936dfa6ed09b1389c455ed`,
  this bounded backend-only slice adds `GET /api/v1/onboarding/me` behind the
  existing Telegram session bearer guard. The account and role come only from
  the authenticated principal; query parameters and cookies cannot select a
  different owner. The repository performs one static parameterized SELECT
  over the already applied migration-035 relations and makes no write.
- A player profile with no onboarding row is returned as a derived first-run
  `required` state without creating data or inventing flow/survey versions. An
  existing draft returns its current step, revision, code-only survey answers
  and current-flow consent document versions so a later client can resume it.
  The response excludes account IDs, timestamps, rating fields and contact
  verification claims. Canonical phone and normalized email are explicitly
  returned only with `assurance=declared`; D5.2 verification remains separate.
- Focused owner-boundary coverage PASS: `4 suites / 66 tests`, including
  first-run without a row, resumable draft, cross-owner fail-closed behavior,
  non-player ownership, malformed/absent bearer credentials, safe persistence
  and HTTP errors, and PII-free logging. Full gates PASS: root E2E sequential
  rerun `94 passed / 1 skipped` and build `1619 modules`; backend typecheck,
  unit `144 suites / 3456 tests`, E2E `2 suites / 4 tests` and build. The first
  root E2E attempt ran concurrently with five other gates and had two unrelated
  match-UI timeouts; both passed in the clean full sequential rerun.
- No onboarding mutation/completion API, frontend/TMA UI, Supabase path,
  contact verification, admin backoffice, migration, schema/DB command,
  provider/API write, SSH, server/container, env/secret or production action was
  added or performed. No commit, push or integration occurred. The matching
  dependency trees were used through temporary local junctions only; no package
  or lock file was installed or changed.
- This slice changes backend runtime wiring, so deployment is
  `deployment_deferred_by_user`. Selectel was not contacted and no rollout,
  restart, health, business smoke or log check was performed; the latest
  documented Selectel test runtime remains `1779efb`. Migration 035 remains
  `applied_verified` and was not reapplied. Independent read-only review of the
  exact 12-file candidate returned acceptance PASS with `P0=0, P1=0`. The only
  post-review change records that result here; the final exact diff is rechecked
  before a separate commit decision.

### 2026-08-21 — D5.1 onboarding read/resume deployed to Selectel test

- Exact reviewed backend commit
  `841e2abe4d3959441e20b9a2fb6ec1a3b8580959` was integrated into `main` and
  deployed only to host `prosto-padel-test-01`, Compose project
  `prosto-padel-test`. The server checkout is detached, exact and clean at that
  commit. Migration 035 was confirmed `applied_verified` by its exact read-only
  POSTCHECK and was not applied again.
- Only the backend container was rebuilt and recreated. It is running and
  healthy with restart count `0` at container `6f538b64837c...` / image
  `sha256:305cb25f4fc5...`. PostgreSQL, frontend and nginx retained their previous
  container/image IDs; all remained running and healthy with restart count `0`.
- Post-rollout internal backend `/api/v1/health` returned `200`, and HTTPS
  `/api/v1/health` returned `200`. Unauthorized HTTPS
  `GET /api/v1/onboarding/me` returned `401` with `cache-control: no-store` and
  `pragma: no-cache`. Bounded post-rollout checks found backend
  `error/fatal/unhandled=0` and nginx HTTP `5xx=0`.
- Authenticated runtime `GET /api/v1/onboarding/me` is
  `blocked_by_client_inspector`: the current Telegram Desktop Mini App exposes
  neither Inspect/DevTools nor a debug listener. No credential, response body or
  PII was extracted or printed. This is a client-observability limitation, not
  an authentication failure and not a completed authenticated runtime smoke.
- Authenticated contract proof currently rests on the already green focused
  mocked bearer coverage (`4 suites / 66 tests`) plus the full backend E2E gate
  (`2 suites / 4 tests`). A manual first-run/resume/ownership TMA smoke remains
  required after the separately gated frontend onboarding rollout. If proof is
  required earlier, a PII-free instrumented test mechanism needs its own exact
  owner approval before implementation or use.
- Deployment status is `applied_with_authenticated_smoke_blocked` for Selectel
  test at exact commit `841e2abe4d3959441e20b9a2fb6ec1a3b8580959`.
  PostgreSQL/schema, migration state, env/secrets, provider/API, frontend, nginx,
  production and every non-backend container were unchanged by this rollout.
  This closeout changes only this WORKLOG; its deployment is `not_needed`.

### 2026-08-22 — D5.1 onboarding draft write candidate

- On exact detached base `14bac13eb9eb8fc19de30dc949cd36ab2845836b`,
  this bounded backend-only slice adds authenticated
  `PATCH /api/v1/onboarding/me` creation/update for the current player's
  resumable draft. The account and role come only from the existing bearer
  principal; the exact body can provide only `expectedRevision`, name and
  declared phone/email. Flow/survey versions, state, completion, consent,
  survey, verification and rating fields remain backend-owned and cannot be
  selected by the caller.
- First-run requires `expectedRevision=null` and creates migration-035 state at
  `in_progress/profile/revision=1`. Resume requires the exact current revision
  and increments it once without advancing the step or changing versions,
  survey answers or consents. A dedicated transaction locks owner profile then
  onboarding state, rejects missing/non-player ownership, completed state and
  stale revisions before any mutation, updates only name plus declared
  canonical phone/backend-normalized email, and rereads the owner in the same
  transaction. Any anomaly after the first write throws so a partial profile
  update cannot commit.
- Contacts remain explicitly `assurance=declared`; no phone/email verification
  claim or `rating.isVerified` coupling was added. HTTP and persistence errors
  are fixed and generic; request bodies, contact values, credentials, account
  IDs and database diagnostics are not logged or copied into errors. No
  frontend/TMA UI, Supabase path, admin backoffice, completion, consent/survey
  mutation, migration or schema change was added.
- Focused onboarding PASS: `5 suites / 123 tests`, covering first-run, resume,
  owner derivation, missing/non-player ownership, stale revision, completed
  state, rollback-on-post-write anomaly, exact request allowlists and PII-safe
  errors/logging. Full gates PASS: backend typecheck, unit
  `145 suites / 3513 tests`, E2E `2 suites / 4 tests` and build; root E2E
  `94 passed / 1 skipped` and build `1619 modules`. The first root build was
  blocked only by sandbox directory access; the identical approved local retry
  passed. Matching dependency trees were used through temporary local
  junctions only; no package or lock file was installed or changed.
- No commit, push, integration, SSH/DB/schema command, provider/API write,
  server/container action, env/secret change or production action occurred.
  This candidate changes backend runtime, so deployment is
  `deployment_deferred_by_user`. Selectel test was not contacted; the latest
  deployed backend remains exact
  `841e2abe4d3959441e20b9a2fb6ec1a3b8580959`, with its documented health/log
  checks green and authenticated GET smoke still
  `blocked_by_client_inspector`. Migration 035 remains `applied_verified` and
  was not reapplied. Independent read-only review of the exact 12-file
  candidate returned acceptance PASS with `P0=0, P1=0`; the final exact diff is
  rechecked before a separate local commit decision.

### 2026-08-22 — D5.1 onboarding draft write deployed to Selectel test

- Exact reviewed backend commit
  `22e7097389d104f2f35801c1ce8a0ac012b02a9c` was integrated into `main` and
  deployed only to host `prosto-padel-test-01`, Compose project
  `prosto-padel-test`. The server checkout is detached, exact and clean at that
  commit. Migration 035 was confirmed `applied_verified` by its exact read-only
  POSTCHECK and was not applied again.
- Only the backend container was rebuilt and recreated. It is running and
  healthy with restart count `0` at container `99c4b88e823f...` / image
  `sha256:5b2da4e96b989...`. PostgreSQL, frontend and nginx retained their exact
  previous container/image IDs; all remained running and healthy with restart
  count `0`.
- Post-rollout internal backend `/api/v1/health` returned `200`, and HTTPS
  `/api/v1/health` returned `200`. Unauthorized HTTPS
  `GET /api/v1/onboarding/me` and `PATCH /api/v1/onboarding/me` each returned
  `401` with `cache-control: no-store` and `pragma: no-cache`. The unauthenticated
  PATCH was rejected by the bearer guard and performed no onboarding mutation.
- Bounded post-rollout checks found backend
  `error/fatal/unhandled/uncaught=0` and nginx HTTP `5xx=0`. Authenticated
  create/update smoke was not executed and remains
  `pending_separate_api_write_approval`; no credential or PII was extracted,
  printed or logged. The existing focused contract proof remains green at
  `5 suites / 123 tests`, with backend E2E `2 suites / 4 tests`.
- Deployment status is `applied_with_authenticated_write_smoke_pending` for
  Selectel test at exact commit
  `22e7097389d104f2f35801c1ce8a0ac012b02a9c`. PostgreSQL/schema, migration
  state, env/secrets, provider/API, frontend, nginx, production and every
  non-backend container were unchanged by this rollout. This closeout changes
  only this WORKLOG; its own deployment is `not_needed`.
- Docs-only closeout gates PASS: root E2E `94 passed / 1 skipped` and root build
  `1619 modules`. The initial sandbox attempts stopped before tests/build when
  Vite/esbuild could not traverse the external dependency junction; the exact
  approved retry used an existing dependency tree with an identical lockfile
  SHA-256 and passed. The temporary junction was removed, and no package or
  lock file was installed or changed.
- Independent read-only review of the exact one-file closeout diff returned
  acceptance PASS with `P0=0, P1=0`.

### 2026-08-22 — D5.1 migration 036 runtime function ACL candidate

- On exact base `5259274ccab022fe5b536fdcadc6d3e3b457addc`, the failed
  PII-free onboarding draft smoke was traced to the intentional migration-035
  function EXECUTE prohibition: the runtime role cannot evaluate the survey
  CHECK function, and the transition trigger function is the next required
  runtime dependency. Migration 035 remains immutable and `applied_verified`.
- This runtime-disconnected forward candidate changes only ACLs. It grants
  `backend_auth_app` EXECUTE on exactly
  `backend_auth.is_onboarding_survey_answer_codes(jsonb)` and
  `backend_auth.guard_player_onboarding_state_transition()`, while PUBLIC keeps
  no EXECUTE. It does not replace or alter either function, touch relation
  definitions/comments/fingerprints, or read/write/delete persisted PII or
  domain data.
- PRECHECK requires the exact migration-035 prohibition and canonical 035/027
  fingerprints. POSTCHECK requires owner plus application as the only direct
  EXECUTE grantees and revalidates unchanged function definitions. ROLLBACK
  removes only the application grants and restores the exact 035 ACL. All
  gates tolerate the existing synthetic fixture and expose only counts, never
  credential, identifiers, contacts or bodies.
- Focused migration contract PASS: `1 suite / 6 tests`, covering the narrow
  grant, canonical 035/027 fingerprints, exact owner/application ACL without
  grant option, original 035 prohibition, rollback and non-empty synthetic
  fixture compatibility. Full gates PASS: backend typecheck, clean unit rerun
  `146 suites / 3519 tests`, E2E `2 suites / 4 tests` and build; root E2E
  `94 passed / 1 skipped` and build `1619 modules`. The first backend unit run
  had one unrelated five-second session-lifecycle timeout; its isolated rerun
  passed `32/32`, followed by the clean full rerun. The first root E2E attempt
  stopped before tests because sandboxed Vite could not traverse the external
  dependency junction; the exact approved retry passed. Matching lockfile
  dependency trees were used only through removed temporary junctions; no
  dependency or lockfile changed.
- Independent read-only review of the exact six-file candidate returned
  acceptance PASS with `P0=0, P1=0`. The only post-review change records that
  result here; the final exact diff is rechecked before a separate local commit
  decision. No commit, push, integration, SSH/DB/schema apply,
  restart/rebuild/rollout, provider/API write, secrets/env change or production
  action has occurred. Deployment is `not_needed` for this local
  runtime-disconnected candidate; a DB apply would require a separate gate.

### 2026-08-22 — D5.1 migration 036 applied and verified on Selectel test

- Exact integrated source commit
  `7a95808bacd969a7a49204403c40d167ae317682` was used only to stream reviewed
  migration artifacts through the loaded Windows SSH agent directly into the
  Selectel test PostgreSQL container. The confirmed target was host
  `prosto-padel-test-01`, Compose project `prosto-padel-test`, PostgreSQL
  `14.23`, database `prosto_padel_test_migration_cycle`, primary/not in
  recovery. The migration user is a member of `backend_auth_owner`, while
  `backend_auth_app` is not.
- Exact read-only PRECHECK SHA-256
  `18D8C26429D2418939108576FD54FEA780192F85C4C9690CB8C149A354707CED`
  exited `0`, completed its catalog/fingerprint/ACL checks, returned
  `ready=true`, the exact migration-035 EXECUTE prohibition,
  `public_execute=false` and `synthetic_fixture_compatible=true`, and ended
  with `ROLLBACK`.
- Exact migration SHA-256
  `16E9924CC4FB7CBB34E578113E1DAB82C306CD6BDC4A5D6E9049FEC69D0A5BE3`
  was then applied exactly once. It exited `0`, granted
  `backend_auth_app` EXECUTE only on
  `backend_auth.is_onboarding_survey_answer_codes(jsonb)` and
  `backend_auth.guard_player_onboarding_state_transition()`, reached `COMMIT`
  and performed no relation or data mutation.
- Exact read-only POSTCHECK SHA-256
  `D0E81EF8CFE0A5B906609B56D20137C52C5C308B291741B217DB431F95BE8052`
  exited `0`, returned `verified=true`, `backend_auth_app_execute=true`,
  `public_execute=false`, `function_definitions_changed=false`,
  `relations_or_data_changed=false` and
  `synthetic_fixture_compatible=true`, and ended with `ROLLBACK`. Observed
  onboarding/consent row counts remained `0`; no identifier, credential,
  contact or body was printed.
- Migration 036 is now `applied_verified` and must not be applied again. Its
  rollback was not run. Server checkout, all containers, application runtime,
  env/secrets, provider/API, frontend and production were unchanged; no
  restart, rebuild or rollout occurred. Deployment is
  `applied_verified_runtime_unchanged`. Application health/business smoke/log
  checks were not run because this gate changed only PostgreSQL function ACL;
  the separately approved authenticated onboarding write smoke remains the
  next runtime proof.
- This docs-only closeout changes only this WORKLOG. Required local gates PASS:
  root E2E `94 passed / 1 skipped` and root build `1619 modules`. A matching
  lockfile dependency tree was used only through a removed temporary junction;
  no dependency or lockfile changed. Independent read-only review of the exact
  one-file closeout diff returned acceptance PASS with `P0=0, P1=0`; the only
  post-review change records that result here, and the final exact diff is
  rechecked before a separate local commit decision. No commit, push,
  integration, SSH/DB/schema command or runtime action is part of this closeout.

### 2026-08-22 — D5.1 authenticated onboarding draft smoke passed on Selectel test

- Exact integrated commit
  `6d52349e22d438e8fe11fa3bd3a9323538289a82` has the same backend runtime tree
  as deployed commit `22e7097389d104f2f35801c1ce8a0ac012b02a9c`.
  Read-only preflight confirmed host `prosto-padel-test-01`, Compose project
  `prosto-padel-test`, a clean detached server checkout at the deployed commit,
  and unchanged backend container
  `99c4b88e823f1c97253bedb4a8641438306ae60474834b245d3a6682cdd439f7` /
  image
  `sha256:5b2da4e96b9890695cc390a2f827dff1fd9a9bf05571be30e8f63eb07bc282f2`,
  running healthy with restart count `0`. Internal `/api/v1/health` returned
  `200`.
- Exact read-only migration-036 POSTCHECK SHA-256
  `D0E81EF8CFE0A5B906609B56D20137C52C5C308B291741B217DB431F95BE8052`
  returned `verified=true`, `backend_auth_app_execute=true`,
  `public_execute=false`, unchanged function definitions/relations/data and
  `synthetic_fixture_compatible=true`, then ended with `ROLLBACK`. Migration
  036 remained `applied_verified`; it was not applied again.
- One syntax-checked, stream-only Node runner executed inside the unchanged
  backend container under correlation
  `01bb92b8-5102-473e-98d2-f165e16cf758`. It locally signed fresh synthetic
  Telegram initData from the existing read-only secret mount and produced the
  exact PASS sequence: login `200/new`; first GET `required` with revision
  `null`; first-run PATCH revision `1`; resume GET revision `1`; update PATCH
  revision `2`; stale PATCH with expected revision `1` returned `409`; final
  GET remained revision `2`; logout returned `204`; the old bearer then
  returned `401`.
- The approved test writes retained one new PII-free synthetic
  account/profile/onboarding/auth/audit fixture. Its canonical phone/email are
  synthetic declared contacts only and are not verified; Telegram notification
  permission was omitted. No cleanup, rollback, deletion or anonymization was
  attempted, matching the approved fail-closed fixture policy. Credential,
  bearer, initData, response bodies, identifiers and contact values were never
  printed.
- Bounded checks from smoke start
  `2026-08-21T22:26:13.166Z` found backend
  `error/fatal/unhandled/uncaught=0` and nginx HTTP `5xx=0`. Final backend state
  remained running/healthy with restart count `0` and the same container/image.
  Server checkout, files, containers, DB schema/migrations, application runtime,
  env/secrets, provider API, frontend and production were unchanged; no restart,
  rebuild or rollout occurred. Deployment is
  `applied_verified_with_authenticated_write_smoke_pass`.
- This docs-only closeout changes only this WORKLOG. The first root E2E run
  completed `92 passed / 1 skipped` with two unrelated 30-second UI timeouts;
  their focused rerun passed `2/2`, and a full clean rerun passed
  `94 passed / 1 skipped`. Root build PASS (`1619 modules`). A matching
  lockfile dependency tree was used only through a removed temporary junction;
  no dependency or lockfile changed. Independent read-only review of the exact
  one-file closeout diff returned acceptance PASS with `P0=0, P1=0`; the only
  post-review change records that result here, and the final exact diff is
  rechecked before a separate local commit decision. No commit, push,
  integration, SSH/DB/schema command, API write or runtime action is part of
  this closeout.

### 2026-08-22 — D5.1 authenticated onboarding completion candidate

- On exact detached base
  `adfa641329ce2b90cb3f8cb6d8fd0c3fae7e82c7`, read-only schema review confirmed
  that applied migrations 035/036 are sufficient for this narrow completion
  contract: migration 035 already provides the owner state, append-only consent
  ledger, optimistic revision/step/completion guard and required contact checks;
  migration 036 provides the runtime role's exact two function EXECUTE grants.
  No migration, SQL/schema change or DB command was added or run.
- The backend-only candidate adds authenticated owner-scoped
  `POST /api/v1/onboarding/me/complete`. Its exact body contains only
  `expectedRevision`, echoed `flowVersion`, the three versioned consent
  acceptances and a versioned code-only survey. Account and role come only from
  the existing bearer principal; profile name and declared canonical phone /
  normalized email are read under the owner lock and cannot be supplied or
  overridden by the completion body.
- Immutable backend policy `tma_v1` requires `terms`, `privacy` and
  `cancellation` document version `2026-08-01`. Survey
  `initial_level_v1` requires exactly the `experience` question with one of
  `beginner`, `intermediate` or `advanced`. Structurally valid but stale/different
  policy payloads fail with a fixed conflict; incomplete/extra/unsafe request
  shapes fail before persistence.
- Completion locks owner profile then onboarding state and is allowed only from
  exact `in_progress/level_survey` at the supplied revision with a nonblank name,
  canonical E.164 phone and normalized email. In one transaction it inserts the
  exact current consent acceptances, performs one guarded transition to
  `completed` with the complete survey and `revision + 1`, then rereads the same
  owner. Any anomaly after a write throws a fixed persistence error so the
  transaction rolls back.
- An exact retry is read-only success only when completed revision equals
  `expectedRevision + 1` and final flow/survey/answers/current consent versions
  match exactly. A stale in-progress revision and any different completed retry
  return fixed conflicts without another write. Contacts remain
  `assurance=declared`; no phone/email verification, `rating.isVerified`, rating
  mutation, PII logging, raw database diagnostics or request-body logging was
  added.
- This slice deliberately does not add consent/survey progress mutations. The
  existing draft writer keeps `currentStep=profile`, so reaching
  `level_survey` remains a separate future bounded backend slice; completion does
  not silently skip that state boundary. No frontend/TMA UI, Supabase path,
  admin backoffice, dependency, env/secret, server/provider API or production
  change is included.
- Focused completion PASS: `4 suites / 118 tests`; focused migrations 035/036
  contract PASS: `2 suites / 14 tests`. Full gates PASS: backend typecheck, unit
  `147 suites / 3563 tests`, E2E `2 suites / 4 tests` and build; root E2E
  `94 passed / 1 skipped` and build `1619 modules`. Matching lockfile dependency
  trees were used through removed temporary junctions; no dependency or lockfile
  changed. The first root E2E launch was blocked by sandbox access to the
  external junction; the exact clean rerun outside that restriction passed.
- Additional root lint PASS (`98 files / 105 unchanged legacy issues`). The
  non-mandatory format/dead-code diagnostics remain baseline-limited: format
  identified the already unformatted unmodified migration-036 spec plus legacy
  formatting in touched module files; Knip reproduced the existing inventory,
  but its line-sensitive digest changed because the already exported
  `PlayerOnboardingServiceDependencies` moved with the new imports. No new
  completion file or export was reported unused. No unrelated format/baseline
  file was changed; mandatory AGENTS gates above are green.
- This candidate changes backend runtime, so deployment is
  `deployment_deferred_by_user`. Selectel test was not contacted; its documented
  backend remains exact `22e7097389d104f2f35801c1ce8a0ac012b02a9c` with the
  prior authenticated draft smoke, health and bounded logs green. No commit,
  push, integration, SSH/DB/schema command, restart/rebuild/rollout or external
  write occurred. Independent read-only acceptance review of the exact candidate
  diff passed with `P0=0, P1=0`; the only post-review change records the review
  result and diagnostic facts in this entry and is subject to a final exact-diff
  recheck before a separate local commit decision.

### 2026-08-22 — D5.1 onboarding completion Selectel test rollout checkpoint

- Exact completion commit
  `852ca925ea19bbc5a724cf41422c6a0e70cb3bb4` was integrated into `main` and
  deployed backend-only to Selectel test host `prosto-padel-test-01`, Compose
  project `prosto-padel-test`. The server checkout was clean and exact at that
  commit after rollout. Applied migrations 035/036 were not reapplied; exact
  migration-036 POSTCHECK SHA-256
  `D0E81EF8CFE0A5B906609B56D20137C52C5C308B291741B217DB431F95BE8052`
  passed as the authoritative verifier for the current migration-035
  fingerprints and post-036 function ACL.
- Only the backend container was rebuilt and recreated. It remained healthy
  with restart count `0` at container
  `450da5cef5649637f377bd231d229da67c6731fc536dcbcc89e793bb1047be7b` /
  image
  `sha256:fc033510fdffbec7362e8e9dea193ebcc8121a736fe43c7ebd54e694f1c5c960`;
  internal `/api/v1/health` returned `200`. Frontend container
  `50644090c6ea738721c306cfa7174e4897f8d15a0c6cd6963b36f60a7399a428`,
  nginx container
  `e5b98b53a385aef67465e097753fb54b060596d3c620af3cfb484a175d624be7`
  and PostgreSQL container
  `5e36d4dc1a5c3e2fa658382cfc4a8dff7fe3ea2ba1a9834bb89cc83df743f7be`
  were unchanged.
- Public HTTPS health and unauthorized no-store GET/PATCH
  `/api/v1/onboarding/me` plus POST `/api/v1/onboarding/me/complete` were not
  verified. Test DNS initially had no authoritative A record, and direct
  SNI verification correctly failed because the active certificate covers only
  production `app.prostopdl.ru`, not `test-app.prostopdl.ru`. The owner has now
  added `A test-app.prostopdl.ru -> 135.106.155.112` in REG.RU, but repeated
  read-only checks still return no record from both authoritative servers and
  public resolvers. Publication is pending; no repeated REG.RU action is
  requested. TLS/nginx/certificate work and public rollout verification remain
  separate gates after authoritative DNS confirmation.
- Authenticated completion smoke remains
  `pending_separate_api_write_approval`. It is also intentionally unreachable
  from the current real user flow because the draft writer keeps
  `currentStep=profile`; a separate owner-scoped resumable progress contract
  must enforce `profile -> consents -> level_survey` without silent skip before
  completion can be exercised through TMA. Real consent acceptance and user
  completion UI remain blocked until Terms, Privacy and Cancellation texts and
  their exposed versions are approved; `2026-08-01` is backend test policy only.
- Deployment status is `applied_verification_blocked_by_test_dns_tls`: the exact
  backend runtime is applied and internally healthy, while public HTTPS,
  unauthorized routing, bounded post-verification logs and authenticated
  completion smoke remain open. This local checkpoint changes only this
  WORKLOG; its own deployment is `not_needed`. No SSH/DB/schema/provider API
  command, server/container/runtime/env change, commit, push or production
  action was performed for this closeout.
- Required docs-only gates PASS: root E2E `94 passed / 1 skipped` and root build
  `1619 modules`. Initial attempts stopped before their checks because this
  isolated worktree has no local `node_modules`; a dependency tree with the
  exact same root lockfile SHA-256 was then used through a temporary junction.
  The first build retry was blocked by sandbox traversal of that junction, and
  the exact unrestricted retry passed. The temporary junction was removed; no
  dependency, package or lockfile was installed or changed.
- Local read-only review of the exact one-file checkpoint diff returned
  acceptance PASS with `P0=0, P1=0`. This final line records only that review
  result; the resulting diff was rechecked for exact one-file scope and
  whitespace errors before handoff.

### 2026-08-22 — D5.1 migration 037 onboarding progress transition candidate

- On exact base `596e2ab86569403db65c227abe084aef7fa934cc`, read-only
  review found that applied migration 035 still orders onboarding as
  `profile -> contacts -> consents -> level_survey`, while the approved product
  flow stores declared phone/email in the profile draft and requires the
  product-visible sequence `profile -> consents -> level_survey`. Hiding two
  state UPDATEs in one API call would silently skip `contacts` and advance the
  optimistic revision twice, so migrations 035/036 are insufficient without a
  forward function correction. Applied artifacts 035/036 remain unchanged.
- Runtime-disconnected migration 037 replaces only
  `backend_auth.guard_player_onboarding_state_transition()`. It preserves
  same-step draft revision updates, allows direct `profile -> consents`, keeps
  `contacts -> consents` only for legacy resume, allows
  `consents -> level_survey` and preserves the existing
  `level_survey -> completed` checks. New `profile -> contacts`, backward and
  other skip transitions fail closed. In-progress survey answers remain empty.
- Entry into `consents` requires a nonblank name, canonical E.164 declared phone
  and normalized declared email; the same profile readiness is revalidated on
  entry into `level_survey` so a later draft edit cannot bypass it.
  `level_survey` also requires all three consent kinds for the same flow and
  accepted within the onboarding time window. Exact current document versions
  deliberately remain an application policy check: no legal version or
  `2026-08-01` is hardcoded in SQL. Declared contacts are not marked verified;
  rating and contact verification are untouched.
- PRECHECK pins the exact migration-035 relation/function fingerprints and the
  post-036 owner/application EXECUTE ACL. POSTCHECK pins the new 037 guard
  fingerprint and transition markers while requiring
  `backend_auth_app EXECUTE=true`, `PUBLIC EXECUTE=false` and unchanged relation
  fingerprints/data counts. ROLLBACK restores the exact migration-035 guard
  definition while preserving the migration-036 runtime ACL. Existing
  synthetic fixtures and any retained legacy `contacts` state are accepted;
  none is mutated, cleaned up, logged or exposed.
- Focused migration-037 contract PASS: `1 suite / 8 tests`; combined 035/036/037
  regression PASS: `3 suites / 22 tests`. The first focused run failed five
  assertions because its extractor expected a literal COMMENT target after the
  candidate switched to the safe dynamic fingerprint form; the extractor alone
  was corrected and the clean focused rerun passed.
- Mandatory gates PASS: backend typecheck, unit `148 suites / 3571 tests`, E2E
  `2 suites / 4 tests` and build; root E2E `94 passed / 1 skipped` and build
  `1619 modules`. Existing dependency trees with exact matching root/backend
  lockfile SHA-256 values were used only through validated temporary junctions;
  both junctions were removed and no dependency, package or lockfile changed.
- This candidate has no API/service/controller/frontend wiring and does not
  change application runtime until a separately approved DB apply and later
  code/rollout gates. Deployment is `not_needed` for this local
  runtime-disconnected candidate. No commit, push, integration, SSH/DB/schema
  command, TLS/nginx/restart/rollout, provider/API write, secrets/env change or
  production action occurred.
- Local read-only review initially found one P1: profile readiness had to be
  revalidated on `consents -> level_survey` because the existing draft writer
  can still edit contacts after leaving `profile`. The guard and regression
  were corrected, all focused/backend/root gates above were rerun and passed,
  and the exact final six-file candidate review returned `P0=0, P1=0`. The only
  post-review change records this result; final scope and whitespace were
  rechecked before handoff.

### 2026-08-22 — D5.1 migration 037 applied and verified on Selectel test

- Exact integrated source commit
  `003e741e67ef21b1ee52a1dd2fa7303336b6dfe3` was used only to stream the
  reviewed migration artifacts through the loaded Windows SSH agent directly
  into Selectel test PostgreSQL. The confirmed target was host
  `prosto-padel-test-01`, Compose project `prosto-padel-test`, PostgreSQL
  `14.23`, database `prosto_padel_test_migration_cycle`, primary/not in
  recovery. Database user `prosto_padel_test` is a member of
  `backend_auth_owner`, while `backend_auth_app` is not.
- Exact read-only PRECHECK SHA-256
  `3AD45EFE2BFEDEB68374537FD1BA477589B69C246D8E421E88C438986F82CEA5`
  exited `0` with empty stderr, returned `ready=true`, confirmed the canonical
  migration-035 function/relation baseline and migration-036 function ACL, and
  ended with `ROLLBACK`. It observed one onboarding row, zero legacy
  `contacts` rows and zero consent rows without exposing identifiers or PII.
- Exact migration SHA-256
  `700C801EE71A265EC3889D3A77B61FC20B43F31C0682171F71513987E47BFB43`
  was applied exactly once with exit `0` and empty stderr and reached `COMMIT`.
  It replaced only
  `backend_auth.guard_player_onboarding_state_transition()`, restored the exact
  post-036 function ACL and did not alter relations or persisted data.
- Exact read-only POSTCHECK SHA-256
  `4843E1FD1618D06300C51C77E1774A8407C9A043DE171EE96DF30472D0B2F57A`
  exited `0` with empty stderr, returned `verified=true` and ended with
  `ROLLBACK`. It verified direct `profile -> consents`, prohibited new
  `profile -> contacts`, retained legacy `contacts -> consents`, allowed
  `consents -> level_survey`, and confirmed
  `backend_auth_app EXECUTE=true`, `PUBLIC EXECUTE=false`, unchanged relation
  definitions/data and synthetic fixture compatibility. Observed counts
  remained one onboarding row, zero legacy `contacts` rows and zero consent
  rows.
- Migration 037 is `applied_verified` and must not be applied again. Its
  rollback migration was not run. Server checkout, files, containers,
  application runtime, env/secrets, TLS/nginx, provider API, frontend and
  production were unchanged; no restart, rebuild or rollout occurred.
  Deployment is `applied_verified_runtime_unchanged`.
- Required docs-only gates PASS: root E2E `94 passed / 1 skipped` and root build
  `1619 modules`. The isolated worktree and existing dependency tree had the
  same normalized lockfile SHA-256 and exact Git lockfile blob. The initial
  build attempt was blocked only by sandbox traversal of the temporary
  dependency junction; the exact unrestricted retry passed. The junction was
  removed, and no dependency, package or lockfile was installed or changed.
- Independent local read-only review of the exact one-file closeout diff
  returned acceptance PASS with `P0=0, P1=0`; scope and whitespace checks also
  passed. The next safe gate is a separate local docs-only commit. Backend
  progress API wiring remains a later code slice; real consent UI remains
  blocked until the Terms, Privacy and Cancellation texts and exposed versions
  are approved.

### 2026-08-22 — D5.1 authenticated onboarding progress contract candidate

- On exact detached base/main
  `f1514a6319a01bdb22fac885ad61366ecd9e671e`, applied and verified migration
  037 is sufficient for this slice: its guarded transition matrix permits
  `profile -> consents`, legacy resume `contacts -> consents` and
  `consents -> level_survey` while rejecting new `profile -> contacts`, silent
  skips and backward transitions. Migrations 035/036/037 are unchanged and no
  new migration is required or proposed.
- Added authenticated owner-scoped POST `/api/v1/onboarding/me/progress` over
  the existing Telegram bearer guard. The strict request contract accepts only
  an expected optimistic revision, exact flow version and the immediate next
  step; `level_survey` additionally requires exactly Terms, Privacy and
  Cancellation versions from the current backend policy. Player ownership is
  derived only from the bearer principal; non-player and missing/foreign owners
  fail closed without cross-owner data exposure. Responses are `no-store` and
  persistence errors do not retain or expose PII diagnostics.
- The Postgres writer locks the owner profile and onboarding state in the
  existing transaction boundary, advances exactly one guarded step and one
  revision, and records the three supplied test-policy consent rows atomically
  with `consents -> level_survey`. Entry into either step revalidates nonblank
  name, canonical E.164 declared phone and normalized declared email. Exact
  retries return the already advanced state without another write; stale
  revision and a same-revision different target/version return distinct
  conflicts. Declared phone/email remain unverified, and contact verification,
  `rating.isVerified`, payment fields, completion and survey answers are
  untouched.
- `2026-08-01` is used only by the backend test policy and focused synthetic
  tests. This candidate has no frontend/TMA consent UI and collects no real user
  acceptance in the current local/runtime-disconnected gate. Real consent
  acceptance and completion UI remain blocked until the Terms, Privacy and
  Cancellation texts and their actually exposed versions are approved.
- Focused progress regressions PASS: controller/service/Postgres writer/module
  `4 suites / 140 tests`, covering first transition, legacy resume, atomic
  consent transition, ownership/unauthorized handling, exact replay,
  stale/different conflict, historical plus current same-flow consent versions,
  incomplete profile, silent-skip rejection and PII-safe failures. Mandatory
  backend gates PASS: typecheck; unit `149 suites / 3607 tests`; E2E
  `2 suites / 4 tests`; build. Mandatory root
  gates PASS: E2E `94 passed / 1 skipped`; build `1619 modules`.
- Existing dependency trees were used only through two validated temporary
  junctions after root/backend normalized lockfile SHA-256 values matched the
  main worktree. Both junctions were removed after the gates; no dependency,
  package or lockfile was installed or changed. The first root build attempt
  was blocked only by sandbox traversal of the junction; the exact unrestricted
  retry passed.
- This candidate changes backend runtime, so deployment is
  `deployment_deferred_by_user`. Selectel test was not contacted; the documented
  deployed backend remains exact
  `852ca925ea19bbc5a724cf41422c6a0e70cb3bb4`, while migration 037 remains
  `applied_verified` and must not be reapplied. No commit, push, integration,
  SSH/DB/schema command, TLS/nginx/restart/rollout, provider/API write,
  secrets/env change or production action occurred.
- The independent local read-only review initially found one P1: a new policy
  helper selected the first consent row per kind, so an older same-flow document
  version ordered before the current version could make an otherwise valid
  progress reread fail. Membership is now checked by exact kind plus version;
  a historical/current coexistence regression was added and every focused,
  backend and root gate above was rerun. The exact corrected candidate review
  returned `P0=0, P1=0`; only this review record was added afterward and final
  scope, whitespace and manifest checks were repeated before handoff.

### 2026-08-22 — D5.1 onboarding progress Selectel test rollout checkpoint

- Exact integrated commit
  `450479eb82697542ab5e2f5f8ca83c504c2fe735` was targeted only at Selectel
  test host `prosto-padel-test-01`, Compose project `prosto-padel-test`.
  Read-only preflight confirmed the prior clean detached checkout at
  `852ca925ea19bbc5a724cf41422c6a0e70cb3bb4`, actual remote `origin/main` at
  the target commit and unchanged healthy backend/frontend/nginx/PostgreSQL
  containers with restart count `0`.
- Exact canonical-LF read-only migration-037 POSTCHECK SHA-256
  `4843E1FD1618D06300C51C77E1774A8407C9A043DE171EE96DF30472D0B2F57A`
  exited `0` with empty stderr, returned `verified=true`, confirmed the current
  migration-035/036/037 fingerprints, transition matrix and function ACL, and
  ended with `ROLLBACK`. Migration 037 remained `applied_verified` and was not
  applied again; relation definitions and persisted data were unchanged.
- The first rollout attempt began at `2026-08-22T10:46:44Z`. Fetch and detached
  checkout advanced the clean server tree to the target commit, but Compose
  stopped before build/recreate because the command had not specified the
  required environment source and therefore could not resolve
  `TELEGRAM_LOGIN_UUID_NAMESPACE`. No container or image changed, no rollback
  was attempted and no guessed environment value was supplied.
- Bounded read-only diagnosis identified the documented runtime source as
  `/home/prostopadel/prosto-padel-mini-app/infra/test/.env.test`, a regular
  non-symlink file owned by `prostopadel` with mode `0600`. All eleven required
  backend keys were declared and nonempty; all nine referenced secret files
  were regular non-symlinks owned by `prostopadel` with mode `0600`. Direct
  environment values and mount source paths matched the already running backend
  without revealing any value or secret. Two legacy `VITE_SUPABASE_*` key names
  remain in that source but were absent from the backend container and are not
  consumed by this backend-only Compose service; no Supabase key was passed to
  the rebuilt backend. Their eventual removal remains a separate bounded
  env-cleanup gate.
- The retry began at `2026-08-22T10:56:11Z`, used the exact base and runtime
  Compose files plus explicit `--env-file` and passed `config --quiet` without
  printing expanded configuration. Only backend was rebuilt and recreated:
  old container
  `450da5cef5649637f377bd231d229da67c6731fc536dcbcc89e793bb1047be7b`
  was replaced by
  `490ab45823b7f4f2900e55616a0741ac2d4f34fbb91cd4ea73044e26de0d5a55`
  using image
  `sha256:1550ae332d2ee8e5875bd8a1992a42f44ec8b3f91ff1c3514fe2ceac3c624615`.
  The new backend is running/healthy with restart count `0`; its internal
  `/api/v1/health` returned `200`.
- Internal unauthorized GET and PATCH `/api/v1/onboarding/me`, POST
  `/api/v1/onboarding/me/progress` and POST
  `/api/v1/onboarding/me/complete` each returned `401` with `no-store=true`.
  The first stream runner omitted `docker exec -i` and therefore issued no
  request; its corrected read-only rerun produced the four PASS results above.
  Bounded logs from retry start returned backend critical count `0` and nginx
  HTTP 5xx count `0`.
- Frontend container
  `50644090c6ea738721c306cfa7174e4897f8d15a0c6cd6963b36f60a7399a428`,
  nginx container
  `e5b98b53a385aef67465e097753fb54b060596d3c620af3cfb484a175d624be7`
  and PostgreSQL container
  `5e36d4dc1a5c3e2fa658382cfc4a8dff7fe3ea2ba1a9834bb89cc83df743f7be`
  remained unchanged, running and healthy with restart count `0`. Final server
  checkout is clean and exact at the target commit. Env/secrets, DB/schema,
  frontend, nginx/TLS configuration, provider API and production were not
  changed; public HTTPS/TLS checks were not run.
- Authenticated progress smoke is
  `pending_separate_api_write_approval`. Deployment is
  `applied_with_authenticated_progress_smoke_pending`. This local closeout
  changes only this WORKLOG and has deployment `not_needed`. The next gate is a
  local commit of this reviewed one-file closeout; authenticated progress smoke
  remains the next functional D5.1 checkpoint after that commit is integrated.
- Mandatory root gates used the unchanged root lockfile through a validated
  read-only `node_modules` junction, removed immediately afterward. The first
  full `npm.cmd run test:e2e` run had one unrelated UI stability timeout in
  `booking-availability-client.spec.js`; the exact focused rerun passed `1/1`,
  and a clean full rerun passed `94` with `1` intentional skip. Final
  `npm.cmd run build` passed with `1619` modules transformed.

### 2026-08-22 — D5.1 authenticated onboarding progress smoke verified on Selectel test

- Exact integrated commit
  `94d9d94fe40bcb3a071fe4a52a6cc1b878b558eb` contains only the rollout
  closeout over the backend tree deployed from exact commit
  `450479eb82697542ab5e2f5f8ca83c504c2fe735`. Read-only preflight confirmed
  the clean server checkout at the deployed backend commit, unchanged backend
  container
  `490ab45823b7f4f2900e55616a0741ac2d4f34fbb91cd4ea73044e26de0d5a55` /
  image
  `sha256:1550ae332d2ee8e5875bd8a1992a42f44ec8b3f91ff1c3514fe2ceac3c624615`,
  running/healthy state, restart count `0` and internal health `200`.
- Exact read-only migration-037 POSTCHECK SHA-256
  `4843E1FD1618D06300C51C77E1774A8407C9A043DE171EE96DF30472D0B2F57A`
  exited `0` with empty stderr, returned `verified=true`, reconfirmed
  `backend_auth_app EXECUTE=true` and `PUBLIC EXECUTE=false`, and ended with
  terminal `ROLLBACK`. Migration 037 remains `applied_verified` and was not
  applied again.
- The corrected syntax-checked in-memory PII-safe runner had SHA-256
  `22331A123CFFEECB9041474488CC7D5D472D206F8CE92409F1536EF64062F3B3`
  and was executed exactly once through `docker exec -i`. It explicitly
  constrained the synthetic Telegram subject to a safe integer in
  `4000000000000000..4499999999999999` and below the backend maximum
  `2^52-1`; no subject, account, session or correlation identifier was
  printed.
- The exact authenticated sequence passed:
  `login 200/new -> GET required/null -> PATCH profile/revision 1 -> progress
  consents/revision 2 -> GET resume/2 -> exact idempotent retry/2 -> progress
  level_survey with three synthetic backend test-policy consents/revision 3 ->
  GET resume/3 -> exact idempotent retry/3 -> stale progress/409 -> GET
  unchanged/3 -> logout/204 -> old bearer/401`. Every checked response was
  `no-store`; phone/email remained declared and no verification or rating
  claim was introduced.
- The allowed API-backed writes retained one PII-free synthetic fixture with
  declared synthetic contacts and three synthetic backend test-policy consent
  records, without notification permission. These records are not real user
  consent acceptances. No secret, bearer, initData, response body, contact,
  identifier or PII was emitted by the runner.
- Bounded logs from the corrected smoke start returned backend critical count
  `0` and nginx HTTP 5xx count `0`. Final read-only verification reconfirmed
  the exact clean checkout, unchanged backend container/image, healthy state
  and restart count `0`.
- No checkout file, container, DB schema/migration, runtime, env/secret,
  frontend, nginx/TLS configuration, provider API or production state changed
  during this smoke verification. D5.1 backend progress deployment is
  `applied_verified_with_authenticated_progress_smoke_pass`; this docs-only
  closeout itself has deployment `not_needed`.
- D5.1 remains open for the separate frontend/TMA onboarding and tests,
  dependent DNS/TLS/public verification and final manual TMA smoke. Real
  consent acceptance and completion UI remain blocked until the Terms,
  Privacy and Cancellation texts and their exposed versions are approved.
- Required docs-only root gates PASS: E2E `94 passed / 1 skipped` and build
  `1619 modules`. The first E2E attempt stopped before tests because this
  isolated worktree has no local `node_modules`. The existing dependency tree
  was then used through a temporary junction only after the root lockfiles
  matched by exact Git blob
  `a5db96ca2068b6020b181a05c9461bbf7e3f49e1` and normalized-LF SHA-256
  `36F6B0109D39A8E06249B3E2B6214DD8631D21849660A9961FF64E815E7E415D`.
  The first build attempt was blocked only by sandbox traversal of that
  junction; the exact unrestricted retry passed. The junction was removed,
  and no dependency, package or lockfile was installed or changed.
- Independent local read-only review of the exact one-file closeout diff
  returned acceptance PASS with `P0=0, P1=0`; final scope and whitespace were
  rechecked after recording this result. The next safe gate is a separate
  local docs-only commit; no rollout is needed for this documentation change.

### 2026-08-22 — D5.1 frontend onboarding client/state foundation candidate

- On exact detached base/main
  `2afd025e248e6898fffca13d446c561ec787e77c`, the existing Telegram session
  boundary keeps the bearer credential caller-owned and uses Telegram
  SecureStorage without browser-storage fallback. Existing private frontend
  clients already use `cache: no-store`, `credentials: omit`, bounded response
  parsing and abortable requests. The new bounded onboarding client follows
  those contracts without importing the legacy Supabase profile path.
- Added an owner-credential-scoped client/state foundation for exact GET and
  PATCH `/api/v1/onboarding/me`, POST `/api/v1/onboarding/me/progress` and POST
  `/api/v1/onboarding/me/complete`. It is not imported by `App.jsx` or any
  runtime component. Strict request allowlists reject owner overrides,
  verification/rating claims, silent step skips and extra fields before fetch;
  draft email is normalized to trimmed lowercase and phone must already be
  canonical E.164. Contacts remain `declared` only.
- Successful responses require the exact backend onboarding state shape and a
  `no-store` response directive. The parser returns deeply frozen in-memory
  state, accepts bounded historical consent versions, and fails closed on
  account/session identifiers, verification/rating fields, malformed bodies or
  expanded response fields. The module does not reference localStorage,
  sessionStorage, logging or a persistent PII cache.
- GET, progress and completion use bounded retry/abort behavior. Network,
  timeout and exact `onboarding_service_unavailable` outcomes retry at most
  three times with the byte-identical normalized request body; 401, stale
  revision and different-request conflicts are not retried. Because PATCH draft
  has optimistic revision but no backend replay contract, an unknown network or
  timeout outcome is not retried and returns `unknown_outcome` for a later GET
  reconciliation. An explicit 503 remains retryable. No frontend request key or
  database authority was added.
- Focused format and ESLint checks PASS. Focused Vitest PASS:
  `1 suite / 8 tests`, covering first-run read/profile save, resume,
  unauthorized, stale/different conflict, draft unknown-outcome no-retry,
  byte-identical idempotent progress retry, exact progress/completion payloads,
  PII-safe storage/log boundaries and fail-closed expanded fields. The first
  runnable suite had one expectation mismatch because the fixture expected
  unsorted consents while the client correctly canonicalized them; only the
  fixture was corrected and the clean rerun passed.
- Mandatory root gates PASS: E2E `94 passed / 1 skipped`; build `1619 modules`.
  After the first review correction, one full E2E run had an unrelated lineup
  click timeout; the exact failing test then passed `1/1`, and clean full E2E
  reruns after both review corrections passed `94/1`. No product correction was
  needed for that existing test.
  The unchanged module count confirms that this unimported foundation does not
  enter the frontend bundle. The isolated worktree used the existing dependency
  tree through a temporary junction after normalized-LF lockfile SHA-256
  `36F6B0109D39A8E06249B3E2B6214DD8631D21849660A9961FF64E815E7E415D`
  matched; the junction was removed and no dependency, package or lockfile was
  installed or changed.
- Independent local read-only P0/P1 review found two P1 findings before
  acceptance. First, the response parser imposed an arbitrary 32-row
  consent-history limit that is not present in the backend contract and could
  reject a valid long-lived resume; the count cap was removed while the existing
  32 KiB response bound remained, with a historical-plus-current same-kind
  regression. Second, draft writes were incorrectly retried after an unknown
  network outcome even though the backend draft writer has no replay contract;
  draft now returns `unknown_outcome` without a retry, while replay-idempotent
  progress/complete retain byte-identical retries. Focused regressions cover both
  corrections, and all focused and mandatory gates passed afterward. Final
  acceptance: `P0=0, P1=0`.
- The DNS dependency is cleared by owner-confirmed read-only verification:
  `test-app.prostopdl.ru A 135.106.155.112` resolves on `ns1.reg.ru`,
  `ns2.reg.ru`, `1.1.1.1` and `8.8.8.8`; authoritative SOA serial is
  `1787388524` and TTL is `86400`. The REG.RU action is complete and needs no
  further owner action. This does not authorize TLS/nginx/server/runtime writes;
  test-host TLS/SNI/certificate correction and verification remain a separate
  future gate.
- No real consent acceptance was collected and no onboarding or completion UI
  was added. Terms, Privacy and Cancellation texts and exposed versions remain
  an explicit blocker for real consent UI. Supabase, contact verification,
  `rating.isVerified`, admin backoffice, migration/schema, backend, payment and
  provider boundaries are unchanged.
- Because the new client is not runtime-reachable, this local code/test/docs
  candidate has deployment `not_needed`. No commit, push, integration,
  SSH/DB/schema command, TLS/nginx/restart/rollout, provider/API write,
  secrets/env change or production action occurred. The next bounded frontend
  slice after review/commit is TMA onboarding gate and profile first-run/resume
  UI wiring; consent/survey/completion UI remains blocked as described above.

### 2026-08-22 — D5.1 TMA onboarding profile gate candidate

- On exact detached base/main
  `e7c0a7b1f74276047003e14317243f19201c3387`, the existing Telegram backend
  session lifecycle now exposes only credential-bound onboarding GET/PATCH
  operations to `AuthGate`; the bearer remains private to the lifecycle and is
  never passed into a component. Incomplete onboarding fails closed before
  `App.jsx`, while an exact completed state keeps the existing application path
  unchanged. `App.jsx` itself was not changed.
- Added the first-run/resume profile screen for required first name, optional
  last name, canonical E.164 phone and normalized email. The PATCH uses the
  server `expectedRevision`; a stale revision performs one GET reconciliation
  and never replays PATCH. An unknown PATCH outcome requires an explicit GET
  before another write, and an unauthorized response clears the existing
  private session boundary. Legacy `contacts` resumes on the same bounded
  profile screen; later `consents`/`level_survey` states remain fail-closed and
  expose no acceptance, survey or completion controls.
- Phone/email are explicitly described as declared contacts only. No contact
  verification or `rating.isVerified` claim was added. Form state stays in
  React memory; production code does not write PII or credentials to
  localStorage, sessionStorage, IndexedDB, URLs or logs. No Supabase import or
  fallback, progress/completion mutation, consent version, migration, backend,
  admin, rating, payment or env change was introduced.
- The new screen reuses the existing TMA palette and typography, respects top
  and bottom safe areas, remains vertically scrollable for the mobile keyboard
  and landscape, uses 48 px inputs/actions, visible labels and focus rings,
  semantic required fields, inline errors with first-invalid focus and
  accessible live save/reconciliation feedback. The transient successful auth
  banner is not rendered over the ready profile form.
- Focused Vitest PASS: `2 suites / 14 tests`. Focused Telegram auth/onboarding
  Playwright PASS: `32 passed / 1 intentional skip`, covering first-run,
  resume, exact optimistic PATCH, stale GET reconciliation without write
  replay, unauthorized session invalidation and browser-storage/console PII
  boundaries.
- Mandatory root gates PASS. The first full E2E run passed `97`, skipped `1`
  intentionally and had one unrelated existing avatar-badge test timeout only
  during its final unmount; its exact retry passed `1/1`, and the clean full
  rerun passed `98 / 1 intentional skip`. `npm.cmd run build` passed with
  `1621` modules transformed; the existing large-chunk advisory remains.
  Dependencies were not installed or changed: the unchanged lockfile matched
  normalized-LF SHA-256
  `36F6B0109D39A8E06249B3E2B6214DD8631D21849660A9961FF64E815E7E415D`
  before using the existing dependency tree through a temporary local junction.
- Two independent read-only reviews were bounded to the exact candidate. The
  mobile UI/accessibility review initially found two P1 issues: the transient
  auth banner could cover the form header and required fields lacked semantic
  required state. Both were corrected with regressions. Final exact-diff
  re-review by the UI/accessibility and auth/state/test reviewers returned
  acceptance PASS with `P0=0, P1=0`; no scope creep was found.
- DNS remains cleared: `test-app.prostopdl.ru` resolves to
  `135.106.155.112`; no REG.RU action is needed. TLS/SNI/nginx/server work was
  not performed and remains a separate future gate. This runtime-reachable
  frontend candidate has `deployment_deferred_by_user`: no commit, push,
  integration, SSH/DB/schema command, TLS/nginx/restart/rollout, provider/API
  write, secrets/env change or production action occurred.
- D5.1 remains open after this profile slice. Consent/survey/progress UI still
  requires a separate frontend slice, and real consent acceptance/completion UI
  remains blocked until the Terms, Privacy and Cancellation texts and exposed
  versions are approved. After later integration and test rollout, the owner
  must visually verify the profile form in Telegram Mini App with the keyboard
  open, long text, safe-area insets and stale/error feedback before the final
  manual TMA onboarding smoke.

### 2026-08-22 — D5.1 test-host TLS/SNI correction verified

- DNS verification PASS: `test-app.prostopdl.ru A 135.106.155.112` resolved on
  authoritative `ns1.reg.ru` and `ns2.reg.ru` and public `1.1.1.1` and
  `8.8.8.8`. The isolated test hostname therefore no longer depends on a
  pending REG.RU publication action.
- On Selectel test host `prosto-padel-test-01` / `135.106.155.112`, the active
  host-systemd nginx listener on `443` received a separate SNI site for
  `test-app.prostopdl.ru`, proxying only the existing test upstream
  `127.0.0.1:8080`. The test SNI config SHA-256 is
  `564ca28d5086c70c44fa0c97c227736c3f892346950397ed944f5022892e22a9`.
- A separate Let's Encrypt certificate was issued only for
  `test-app.prostopdl.ru`: subject/SAN `CN=test-app.prostopdl.ru` /
  `DNS:test-app.prostopdl.ru`, issuer `Let's Encrypt YE2`, validity
  `2026-08-22 12:29:50 UTC` through `2026-11-20 12:29:49 UTC`, SHA-256
  fingerprint
  `22:67:8E:6B:4B:B3:7F:70:87:28:0A:36:60:C1:CE:DF:B9:BD:D8:98:80:6E:78:E3:E8:5A:0C:47:10:99:02:6B`.
  The certificate renewal timer is enabled and active.
- The production `app.prostopdl.ru` site was not changed: its active config
  retained SHA-256
  `d6e6484a1917ae061cea986ae3926c34a87278140313873989b3b30a6da0438a`,
  and its certificate retained SHA-256 fingerprint
  `EA:30:36:4C:FC:98:A9:38:6F:74:D2:B3:A4:49:1A:14:5F:7E:98:84:F4:A6:71:15:43:0D:40:A0:22:BA:E5:A2`.
- Nginx config validation PASS, the listener owner was reloaded once, and the
  bounded post-reload nginx journal error count was `0`. Windows Schannel
  verification with normal TLS/SNI validation and no `--insecure` returned
  `ssl_verify_result=0`; HTTPS `GET /api/v1/health` returned `200` from exact
  remote IP `135.106.155.112`. A CRLF artifact affected only the first
  read-only fingerprint command after the successful reload; direct read-only
  SNI and Schannel verification then passed without another issuance or reload.
- Server checkout remained clean and unchanged at
  `450479eb82697542ab5e2f5f8ca83c504c2fe735`. Backend
  `490ab45823b7`, frontend `50644090c6ea`, nginx `e5b98b53a385` and PostgreSQL
  `5e36d4dc1a5c` containers remained unchanged and healthy. No checkout,
  frontend/backend container, DB/schema, env/secrets, provider DNS/API or
  production change occurred.
- The verified infrastructure state is
  `deployment=test_tls_applied_verified_runtime_containers_unchanged`. This
  local append-only docs closeout itself has deployment `not_needed`; it does
  not deploy the integrated profile frontend commit
  `7e98cb45645ddc8d32e2436a15f401a3e74ef264`, which remains a separate test
  rollout gate before visual and manual TMA onboarding smoke.
- Mandatory root gates for this exact one-file closeout PASS:
  `npm.cmd run test:e2e` passed `98 / 1 intentional skip`, and
  `npm.cmd run build` passed with `1621` modules transformed; the existing
  large-chunk advisory remains. Dependencies were not installed or changed:
  normalized-LF `package-lock.json` SHA-256 remained
  `36F6B0109D39A8E06249B3E2B6214DD8631D21849660A9961FF64E815E7E415D`,
  and the temporary local dependency junction was removed after the gates.
- Independent read-only P0/P1 review of the exact one-file closeout found no
  factual, scope or deployment-status issue: acceptance PASS with
  `P0=0, P1=0`.

### 2026-08-22 — D5.1 TMA onboarding profile frontend Selectel test rollout

- Exact integrated commit
  `552cd1d048dc2399687285c6b816197e94186f76` was targeted only at Selectel
  test host `prosto-padel-test-01` / `135.106.155.112`, Compose project
  `prosto-padel-test`. The final read-only preflight passed before any rollout
  write: server checkout was clean at
  `450479eb82697542ab5e2f5f8ca83c504c2fe735`, actual remote `origin/main` was
  the target commit, the documented `.env.test` was present with owner
  `prostopadel` and mode `0600`, and all four existing containers were healthy
  with restart count `0`. Two earlier read-only Docker metadata probes stopped
  without writes because the non-root account had neither socket access nor
  passwordless sudo; the successful preflight used the existing root SSH
  boundary without exposing credentials or environment values.
- Before rollout, frontend container
  `50644090c6ea738721c306cfa7174e4897f8d15a0c6cd6963b36f60a7399a428` /
  image
  `sha256:135a897a3f84d73184b6501395eca460e846ea4aee1f9e2cf8177102cfcca7f3`
  was running and healthy with restart count `0`. Backend
  `490ab45823b7f4f2900e55616a0741ac2d4f34fbb91cd4ea73044e26de0d5a55`,
  nginx `e5b98b53a385aef67465e097753fb54b060596d3c620af3cfb484a175d624be7`
  and PostgreSQL
  `5e36d4dc1a5c3e2fa658382cfc4a8dff7fe3ea2ba1a9834bb89cc83df743f7be`
  were exact expected containers and also healthy with restart count `0`.
- The clean detached checkout was fast-forwarded to the exact target. The
  explicit `.env.test`, `compose.yaml` and `compose.runtime-backend.yaml`
  invocation passed `config --quiet` without printing expanded configuration.
  The frontend-only build passed with `1621` modules transformed and
  `VITE_TELEGRAM_BACKEND_LOGIN_ENABLED=true`; the existing large-chunk advisory
  remains. Only frontend was rebuilt and force-recreated with `--no-deps`.
- New frontend container
  `a1c62b4d09bc55243af67e1aead54fa00a7ce63f3750283485edb4879751733e` /
  image
  `sha256:4dadee43e10c7be63bae71011daf1d27458ceaa0091f650adc4f29ef0269ce5c`
  is running and healthy with restart count `0`. Backend, nginx and PostgreSQL
  retained the exact container IDs above and remained healthy with restart
  count `0`; final server checkout is clean and exact at the target commit.
- Windows Schannel checks used normal certificate/SNI validation without
  `--insecure`. HTTPS frontend `/` returned `200`, and HTTPS
  `/api/v1/health` returned `200`; both returned `ssl_verify_result=0` from
  exact remote IP `135.106.155.112`. Bounded logs from rollout start
  `2026-08-22T13:46:25Z` returned frontend HTTP 5xx `0`, frontend critical
  `0`, nginx HTTP 5xx `0` and nginx critical `0`.
- Test SNI config SHA-256 remained
  `564ca28d5086c70c44fa0c97c227736c3f892346950397ed944f5022892e22a9`,
  and production `app.prostopdl.ru` config SHA-256 remained
  `d6e6484a1917ae061cea986ae3926c34a87278140313873989b3b30a6da0438a`.
  No backend/nginx/PostgreSQL container, TLS/nginx config, env/secrets,
  DB/schema, provider API or production change occurred.
- Manual authenticated TMA profile smoke is
  `pending_separate_owner_gate`; it was not combined with rollout. Deployment
  is `applied_with_manual_tma_profile_smoke_pending`. This local append-only
  docs closeout itself has deployment `not_needed`; no commit, push,
  integration, SSH/DB/schema command, restart/rebuild/rollout, provider/API
  write, secrets/env change or production action occurred while preparing it.
- Mandatory root gates for this exact one-file closeout PASS:
  `npm.cmd run test:e2e` passed `98 / 1 intentional skip`, and
  `npm.cmd run build` passed with `1621` modules transformed; the existing
  large-chunk advisory remains. Dependencies were not installed or changed:
  normalized-LF `package-lock.json` SHA-256 remained
  `36F6B0109D39A8E06249B3E2B6214DD8631D21849660A9961FF64E815E7E415D`,
  and the temporary local dependency junction was removed after the gates.
- Independent read-only P0/P1 review of the exact one-file closeout found no
  factual, scope or deployment-status issue: acceptance PASS with
  `P0=0, P1=0`.

### 2026-08-22 — D5.1 manual TMA onboarding profile visual smoke

- The owner opened `test-app.prostopdl.ru` through Telegram Mini App against
  deployed runtime tree
  `552cd1d048dc2399687285c6b816197e94186f76`; integrated `main`
  `a98ab137afdfbfe88b40afebd6f341966179f7c8` differs only by the already
  recorded rollout documentation. Automatic Telegram authentication passed
  without a separate registration/login screen, and the backend-owned profile
  gate rendered successfully.
- The first owner screenshot showed the populated profile form and its visible
  success status, so a profile save had already been performed manually by the
  owner outside agent scope before the final no-submit continuation. The agent
  did not initiate or replay PATCH/progress/complete. PII values visible in the
  owner-provided screenshots were not transcribed into repository files, tool
  commands, logs or this worklog.
- Manual visual checks PASS for top/bottom safe-area clearance, absence of
  horizontal overflow, visible field labels and declared-contact disclosure,
  approximately 48 px inputs/action, and a visible high-contrast focus state.
  With the native mobile keyboard open, the focused field remained uncovered;
  the owner separately reported `keyboard_scroll_bottom=PASS` and
  `long_text_layout=PASS` without another screenshot or submit.
- Inline validation was intentionally
  `not_exercised_no_submit`. Its client-side field errors, first-invalid focus
  and no-write invalid-submit behavior remain covered by the reviewed focused
  profile UI/client tests and Telegram auth/onboarding Playwright regressions.
  Final manual visual acceptance is `P0=0, P1=0`.
- Manual smoke status is
  `deployment=applied_verified_with_manual_tma_profile_visual_smoke_pass`.
  The final continuation performed no submit, credential extraction, agent
  API/DB/provider write, SSH, checkout/container/runtime/config/env change or
  production action. This local append-only docs closeout itself has deployment
  `not_needed` and performs no commit, push or integration.
- D5.1 remains open for the separately bounded consent/survey frontend work.
  Real consent acceptance and completion UI remain blocked until the Terms,
  Privacy and Cancellation texts and their user-visible versions are approved.
- Mandatory root gates for this exact one-file closeout PASS:
  `npm.cmd run test:e2e` passed `98 / 1 intentional skip`, and
  `npm.cmd run build` passed with `1621` modules transformed; the existing
  large-chunk advisory remains. Dependencies were not installed or changed:
  normalized-LF `package-lock.json` SHA-256 remained
  `36F6B0109D39A8E06249B3E2B6214DD8631D21849660A9961FF64E815E7E415D`,
  and the temporary local dependency junction was removed after the gates.
- Independent read-only P0/P1 review of the exact one-file closeout found no
  factual, scope, PII-boundary or deployment-status issue: acceptance PASS
  with `P0=0, P1=0`.

### 2026-08-22 — D5.1 frontend onboarding progress lifecycle foundation

- The clean isolated worktree started from exact integrated `main`
  `ff9dddc93dabbd74e03fed1e9e367bac32942718`. Added the narrow
  `advanceOwnOnboarding` bridge from the existing `playerOnboardingClient`
  through the private Telegram bearer lifecycle. The bridge presents the
  credential only to the bounded client call, forwards its abort signal and
  accepts an `advanced` response only when its exact parsed state is
  `in_progress` at the requested `consents` or `level_survey` step.
- The focused browser lifecycle regression passed `1 / 1`. It covers both
  successful progress states, an exact idempotent retry, stale revision,
  different-request conflict, structurally malformed state, unauthorized
  session clearing, private credential presentation and absence of the
  synthetic credential/declared contacts from browser `localStorage`.
- `AuthGate`, `OnboardingProfileGate` and `playerOnboardingClient` were not
  changed. No consent, survey or completion UI was added; no real consent was
  collected; no Terms/Privacy/Cancellation text or document version was
  invented. The backend test-policy version `2026-08-01` was not added to the
  frontend. No API/DB/provider write, SSH, migration, rollout/restart,
  env/secrets change or production action occurred.
- Mandatory root gates PASS: `npm.cmd run test:e2e` passed
  `99 / 1 intentional skip`, and `npm.cmd run build` passed with `1621`
  modules transformed; the existing large-chunk advisory remains.
  Dependencies were not installed or changed: normalized-LF
  `package-lock.json` SHA-256 remained
  `36F6B0109D39A8E06249B3E2B6214DD8631D21849660A9961FF64E815E7E415D`.
- This source change affects a future frontend bundle but has no UI caller in
  this slice. Commit, integration and test rollout were explicitly excluded,
  so deployment is `deployment_deferred_by_user`; Selectel test remains on
  runtime tree `552cd1d048dc2399687285c6b816197e94186f76` with no container,
  health, smoke or log change in this local slice.
- D5.1 remains open. Real consent acceptance and completion UI stay blocked
  until approved, user-visible Terms, Privacy and Cancellation texts, URLs and
  exact document versions exist. Survey submission remains coupled to the
  separately gated completion contract and was not exposed here.
- Independent read-only review of the exact three-file candidate found no
  scope, auth-boundary, PII-safety, contract or deployment-status issue:
  acceptance PASS with `P0=0, P1=0`.

### 2026-08-23 — D5.3 legal documents v0.2 local draft candidate

- Started from clean detached `main`
  `3b26099413325982a5dbc476d2ffb9434a2efffc`. Created only the dedicated
  `docs/legal/` catalog with `README.md`, `TERMS_DRAFT.md`,
  `PRIVACY_POLICY_DRAFT.md`, `CANCELLATION_POLICY_DRAFT.md` and
  `PERSONAL_DATA_CONSENT_DRAFT.md`. Every file begins with the required
  unpublished/unapproved/legal-review draft banner.
- The files are the canonical working v0.2; earlier chat-rendered long text is
  explicitly non-canonical. Unknown company details, contacts, document
  versions/effective dates, provider/OFD roles, retention, cross-border facts
  and public URLs remain machine-findable `{{UPPER_SNAKE_CASE}}` placeholders.
  Competitor documents were not used as legal sources or copied.
- The draft keeps two short UI actions but separates their semantics: the first
  binds `terms`, `privacy` acknowledgement and `cancellation`; the second is a
  voluntary consent only for optional profile functions and requires a future
  independent `personal_data_processing` evidence key. The existing backend
  `2026-08-01` policy remains test-only and is not presented as a published
  version. Completed onboarding remains immutable; any later re-consent needs a
  separate append-only lifecycle.
- Public/versioned legal URLs, routing before and after auth, publication,
  BotFather/store metadata and publication smoke remain separate gates. The
  current draft marks prospective identified match roster, unresolved provider
  facts, recipient-by-recipient cross-border mapping, retention/deletion and
  mobile publication as blocked/not ready rather than promising implementation.
- Independent official-source legal review and independent D5.1
  consent/product-contract review initially returned bounded P1 findings. The
  main agent corrected consent voluntariness and scope, minor-account boundary,
  profile recipient boundary, all-recipient cross-border mapping, cancellation
  remedies/actual-expense safeguards, mobile blockers, public access and
  re-consent lifecycle. Final exact-file re-reviews both passed with
  `P0=0, P1=0`.
- Tests and build are `not_run/not_needed`: the candidate changes Markdown only
  and has no runtime, bundle, backend, schema, dependency, config or
  infrastructure impact. Deployment is `not_needed`. No commit, push, merge,
  API/DB/schema/provider write, SSH, REG.RU/DNS/TLS action, Selectel rollout,
  secret/env change or production action occurred.
- D5.1 real consent UI remains blocked until the owner fills and approves the
  remaining facts and versions and a later separately authorised code/schema
  candidate satisfies the four-key evidence, public URL and re-consent
  contracts. Notification settings, account deletion/session revoke,
  UGC/moderation and D5.4 Admin Backoffice remain outside this slice.

### 2026-08-23 — D5.3 data-processing matrix and owner-input checklist

- Continued the local Markdown-only legal candidate at exact detached
  `main`/`origin/main` base `3b26099413325982a5dbc476d2ffb9434a2efffc`.
  Added `docs/legal/DATA_PROCESSING_MATRIX_DRAFT.md` and
  `docs/legal/OWNER_INPUT_CHECKLIST.md`; linked both canonical working
  registers from `docs/legal/README.md`. The four v0.2 Terms, Privacy,
  Cancellation and personal-data-consent drafts were not revised in this
  slice.
- The matrix is an evidence-backed inventory of current code/schema contracts,
  not a published policy or final legal classification. It separates Telegram,
  Selectel/PostgreSQL and YCLIENTS/YPLACES flows; leaves Sber acquiring,
  online-KKT and OFD as future/contract facts; and records unresolved legal
  basis, localization/cross-border, retention, deletion/anonymization and
  audit/log boundaries without PII, secrets or new Supabase contracts.
- The checklist uses only `known`, `pending_26_aug`, `requires_contract`,
  `owner_decision` and `legal_review`. It requests the corporate/contact,
  provider-contract and owner-decision facts authorised for this slice and
  explicitly prohibits passwords, API tokens, merchant credentials, keys,
  certificates, cabinet access and document scans. New ООО details remain
  `pending_26_aug` until `2026-08-26`.
- Independent privacy/data-map and D5.1/product reviews initially returned
  bounded P1 findings. The exact candidate was corrected to inventory ingress
  IP/header forwarding while leaving runtime access/error-log fields and
  retention unknown, classify YCLIENTS `book_staff`/resource data
  conditionally, and distinguish the current in-app waitlist/match-reservation
  feed from the narrower Telegram waitlist/invitation outbox while leaving new
  and private-booking notification categories `future_unknown`. After all
  corrections and mandatory gates, both final exact-candidate re-reviews
  passed with `P0=0, P1=0`.
- Only Markdown files changed, with no code, runtime, frontend bundle, backend,
  schema, dependency, config or infrastructure impact. Deployment is
  `not_needed`; deployed environment and commit, containers, health/HTTP,
  manual smoke and logs are unchanged and not applicable to this local
  docs-only slice. Mandatory root test/build results are recorded below.
- Mandatory root gates PASS. Two default nine-worker E2E runs reached
  `97 passed / 1 intentional skip` but ended with unrelated UI click/timeouts;
  every failed case passed its exact focused rerun. A complete stability rerun
  with four workers passed `99 / 1 intentional skip`. `npm.cmd run build`
  passed with `1621` modules transformed and the existing large-chunk advisory.
  Sandbox-only Vite/esbuild attempts could not traverse the external dependency
  junction; the successful retries used an existing dependency tree whose
  lockfile Git blob exactly matched this worktree
  (`a5db96ca2068b6020b181a05c9461bbf7e3f49e1`). No dependency or lockfile was
  installed or changed, and the temporary junction was removed after the gates.
- No commit, push, merge, publication, API/DB/schema/provider write, SSH,
  REG.RU/DNS/TLS action, Selectel rollout, secret/env change or production
  action occurred. Next gate is another separately authorised local docs-only
  update after the owner supplies the confirmed `2026-08-26` corporate and
  contractual facts; D5.1 consent UI remains blocked meanwhile.

### 2026-08-23 — D5.3 owner decisions and age-model supersession

- Continued the uncommitted Markdown-only legal candidate at exact detached
  `main`/`origin/main` base `3b26099413325982a5dbc476d2ffb9434a2efffc`.
  Updated the seven canonical `docs/legal/` draft/index/register files only;
  no legal document was approved or published.
- The final owner age decision replaces the earlier 18+-only model. Minors may
  register and use social functions with a legal representative's consent;
  paid orders and payments are made by an adult user or with such consent, and
  a minor may be a participant. No mandatory 18+ checkbox, age verification,
  verified-age/verified-parental-consent claim, DOB, passport/document or
  parental-verification field was added. The old decision remains in the
  decision history as `superseded_by_owner_2026_08_23`; exact wording and
  sufficiency of consent evidence remain a final legal-review blocker.
- Confirmed contacts are represented without fallback invention:
  `info@prostopdl.ru` is working only for privacy/personal-data requests and
  consent withdrawal; support email is absent; official support phone and
  social links remain pending. Training cancellation/transfer has the
  owner-approved 24-hour customer-facing full-refund boundary.
- The target authenticated visibility and retention/deletion policy are
  recorded as owner-approved product candidates, not as current implementation
  or universal statutory rules. Broad profile/history visibility remains
  `publication_blocked` pending legal basis/evidence and exact field/runtime
  alignment. Account deletion/revoke-all, inactivity cleanup, processor
  propagation and backup deletion replay remain separate future gates.
- Independent official-source/legal consistency and D5.1/product-contract
  read-only reviews of the exact seven-file candidate both passed with
  `P0=0, P1=0`. This is draft consistency review, not a legal opinion.
- Mandatory root gates PASS: `npm.cmd run test:e2e -- --workers=4` passed
  `99 / 1 intentional skip`; `npm.cmd run build` passed with `1621` modules and
  the existing large-chunk advisory. The first sandbox-only E2E start could not
  traverse the external dependency junction; the successful gate used the
  pre-existing dependency tree whose lockfile Git blob exactly matched this
  worktree (`a5db96ca2068b6020b181a05c9461bbf7e3f49e1`). No dependency or
  lockfile was installed or changed, and the temporary junction was removed.
- Deployment is `not_needed`: only local Markdown changed. No commit, push,
  merge, publication, code/schema/migration/runtime/env change, DB/provider/API
  write, SSH, REG.RU/DNS/TLS action, Selectel rollout or production action
  occurred. Company facts remain pending until `2026-08-26`; provider/OFD and
  cross-border facts remain pending contracts/legal review.

### 2026-08-23 — D5.3 preparation closure checkpoint

- Continued from exact detached `main`/`origin/main` base
  `3b26099413325982a5dbc476d2ffb9434a2efffc`. Exact scope is limited to the
  seven canonical Markdown files under `docs/legal/` and this append-only
  `docs/launch/WORKLOG.md`; no unrelated working-tree change was present or
  touched.
- D5.3 preparation checkpoint is `done`, while D5.3 overall remains `not_done`.
  The legal candidate remains
  `draft_not_published_not_legally_approved`; all implementation, final
  approval and publication actions are separate future gates.
- Unresolved facts remain visible and machine-findable:
  `pending_26_aug` covers ООО requisites and official addresses;
  `requires_contract` covers Sber/online-KKT/OFD, YCLIENTS/YPLACES and Selectel
  entity/region/cross-border facts; `pending_owner_later` covers support
  phone/social links, effective versions and public legal URLs. Placeholders
  were not removed or replaced by assumptions.
- The checkpoint retains the latest owner decisions: privacy-only
  `info@prostopdl.ru` with no support email; the minor/representative-consent
  model without a mandatory 18+ checkbox or verified-age claim; allowlisted
  authenticated profile/rating/public-match-history visibility with contact,
  private-booking, payment and service-ID exclusions plus a legal/evidence
  publication blocker; the 24-hour training cancellation boundary; and the
  owner-approved retention/deletion policy candidate.
- Independent legal/source-consistency and D5.1/product-contract read-only
  reviews of the exact legal candidate both passed with `P0=0, P1=0`.
  Required banners, local Markdown links, placeholder format, table structure,
  final newlines, whitespace and secret-pattern scans passed. Official
  reference URLs were checked read-only; the future public legal hostname
  remains an explicit untested placeholder. `git diff --check` passed apart
  from the existing line-ending advisory for WORKLOG.
- Tests are `not_run/not_needed` for this closure checkpoint because it changes
  Markdown status/documentation only and has no runtime, frontend bundle,
  backend, schema, dependency, config or infrastructure impact. Previous gate
  results remain historical evidence and were not re-run or re-labelled as a
  test of this metadata-only checkpoint.
- Deployment is `not_needed`; deployed environment/commit, containers,
  health/HTTP, manual smoke and logs are unchanged and not applicable. One
  local docs-only checkpoint commit is authorised on
  `codex/d5-3-compliance-drafts`; exact SHA is reported in the handoff. No
  push, merge, publication, deploy, code/runtime/DB/schema/server/REG.RU/env,
  provider/API or production action is authorised by this checkpoint.
- Company/address facts return after `2026-08-26`; contract facts and later
  owner contacts/versions/URLs remain follow-up docs gates. The next independent
  D5 slice that does not require those facts is NotificationPreferences/privacy
  settings readiness; it must start under a separate owner command.

### 2026-08-23 — D5.3 NP1 notification-preference migration 038 local candidate

- Continued from the clean local D5.3 checkpoint branch
  codex/d5-3-compliance-drafts at exact HEAD
  864727d02bec93a44e17491570667f65bc7fbe06; main and origin/main
  remained 3b26099413325982a5dbc476d2ffb9434a2efffc. Exact scope is one
  focused migration-contract test, the five migration-038 artifacts and this
  append-only WORKLOG entry. No frontend or runtime source file changed.
- The runtime-disconnected migration candidate creates empty
  backend_auth.account_notification_preferences with one account-owned
  boolean, telegram_match_notifications_enabled, canonical timestamps and an
  optimistic version. It has no default and no backfill: the later runtime
  contract must interpret no row as effective enabled, while an explicit false
  row remains independent from Telegram destination permission and later
  Telegram logins.
- The only existing-schema change in the candidate extends the
  backend_match.telegram_notification_outbox terminal allowlist with
  preference_disabled, valid only for an abandoned delivery. Existing
  destination/outbox rows are not changed. The current covered Telegram
  sources are match invitations and waitlist-promotion match notifications;
  the in-app feed, other reservation notifications, email/SMS/marketing/native
  push, private-booking notifications and profile-visibility settings remain
  outside NP1.
- PRECHECK and POSTCHECK are read-only and end in ROLLBACK. The application
  role receives table SELECT plus exact column-scoped INSERT/UPDATE only; no
  chat ID, external identity, contact or message/provider payload is added.
  Fail-closed rollback is allowed only before the first preference row and
  before any preference_disabled outbox evidence, and restores the exact
  migration-030 constraints and fingerprint without CASCADE.
- Focused migration-contract test PASS:
  backend-account-notification-preferences-migration.spec.ts passed 9 / 9.
  Mandatory backend gates PASS: typecheck; unit 150 / 150 suites and
  3616 / 3616 tests; e2e 2 / 2 suites and 4 / 4 tests; build. Mandatory root
  stable gates PASS: test:e2e with four workers passed
  99 / 1 intentional skip; build passed with 1621 modules transformed and the
  existing large-chunk advisory.
- The first default nine-worker root E2E run reached
  94 passed / 1 intentional skip and five unrelated UI tests timed out; all
  five passed in the complete four-worker stability rerun. Initial sandboxed
  stable E2E and build attempts could not traverse the existing external
  dependency junction; approved local retries outside the filesystem sandbox
  passed. No dependency was installed or changed. The new test file passes its
  exact Prettier check; unrelated pre-existing format findings were not edited.
- Migration 038 was not applied. The exact auth-integration inventory still
  models the pre-038 catalog and is intentionally deferred to the later
  repository/runtime slice after the separate test-database migration gate.
  Deployment is not_needed for this runtime-disconnected local candidate.
  No commit, push, merge, DB/schema write, Selectel/provider/API call,
  rollout/restart, server/env/secret change or production action occurred.
- Independent exact-candidate P0/P1 review follows this factual gate record.
  The next authorised action, if this candidate passes review, is a separate
  local commit gate only; integration/push and test-database application remain
  later separate owner commands.
- Independent read-only review of the exact NP1 candidate completed with
  P0 = 0 and P1 = 0. It accepted the runtime-disconnected scope, bounded ACL,
  read-only PRECHECK/POSTCHECK, fail-closed exact rollback, and terminal-only
  preference_disabled outcome. The README additionally makes the operator
  rollback boundary explicit: rollback is unavailable after a
  preference-aware runtime has been deployed.

### 2026-08-23 — D5.3 NP1 migration 038 applied on Selectel test

- Exact reviewed source commit
  `cf90e366318f50e0bbc9d1f7baf049d1a5c9ebe2` was already integrated in local
  and remote `main`. Canonical streamed artifact SHA-256 values were PRECHECK
  `9669413c3793d7cd96a295aa2de5427ae20337846f9227ebf26127b00ebf6a1b`,
  migration `230dcf399c71ddf446a3ee4d2b149948febe65de1d32f9cfeb2d6b3d753d9f3a`,
  POSTCHECK `1ebc0e2a3cf1ef13de47d3b88e740acd197a8a14a85011e1e8b57d069400a8ce`
  and unused ROLLBACK
  `958a4d9fee4cb287231afde1d330fd4d860e44ebfd5d5bea6558631f2ae0ccb6`.
- The confirmed target was Selectel test host `prosto-padel-test-01`, Compose
  project `prosto-padel-test`, PostgreSQL `14.23`, primary database
  `prosto_padel_test_migration_cycle`. The clean server checkout remained
  unchanged at `3b26099413325982a5dbc476d2ffb9434a2efffc`; exact reviewed SQL was
  streamed without creating a server checkout artifact or changing runtime.
- Only the existing backend container was stopped for the constraint window.
  A verified custom-format database backup was created at root-only directory
  `/root/prosto-padel-db-backups/migration038_20260823T132840Z_ORobg0`:
  `714122` bytes, owner `root:root`, mode `0600`, SHA-256
  `f317a3ceba7af0a8d9d479c0491f3ede1f8bf06cda9ec7d0b0fdd1267989a2c8`;
  `pg_restore --list` passed without restoring data.
- Exact read-only PRECHECK exited `0`, ended with `ROLLBACK`, returned
  `ready=true` and recorded counts accounts `8`, Telegram destinations `3`,
  outbox `1`. Its root-only evidence output SHA-256 is
  `5e02884e452c246d7f149c32ebbae79bf577736ab30c00a94ab2ac16b67bfadd`.
- Exact migration 038 exited `0`, reached `COMMIT` and created the empty
  `backend_auth.account_notification_preferences` contract plus the terminal
  `preference_disabled` outbox outcome. Apply-output SHA-256 is
  `2fdb9e8dbda951717e12b94b9afa7e076d47efa37e1f5f93ffa50a94b19aa1c2`.
  The ROLLBACK artifact was not run.
- Exact read-only POSTCHECK exited `0`, ended with `ROLLBACK` and returned
  `verified=true`, `runtime_connected=false`, preference rows `0`, with the
  original counts unchanged at accounts `8`, destinations `3`, outbox `1`.
  A separate read-only count confirmed zero `preference_disabled` outcomes.
  POSTCHECK-output SHA-256 is
  `761d232d08571f8dbf228f77dd0fd0dab7b85aab2aaa5f18dbb02c0619b1bdf1`.
- The same backend container
  `490ab45823b7f4f2900e55616a0741ac2d4f34fbb91cd4ea73044e26de0d5a55`
  and image
  `sha256:1550ae332d2ee8e5875bd8a1992a42f44ec8b3f91ff1c3514fe2ceac3c624615`
  restarted `running/healthy` with restart count `0`. HTTPS health returned
  `200`, TLS verification `0`, remote IP `135.106.155.112`. The maintenance
  window contained expected nginx 5xx while backend was stopped and one during
  health startup; the stable post-healthy window had backend critical `0`,
  nginx 5xx `0` and nginx critical `0`.
- Migration status is `applied_verified_runtime_unchanged`; all four original
  containers are running/healthy with restart count `0`. No image, runtime,
  frontend, nginx/TLS, checkout, config, env/secret, provider/API or production
  change occurred. This append-only closeout is Markdown-only; automated tests
  are `not_run/not_needed`, deployment rollout is `not_needed`, and its next
  gate is a separate local commit before the dependent repository/runtime
  preference slice starts.

### 2026-08-23 — D5.3 NP2 account notification-preferences backend local candidate

- Continued from clean local/remote `main` base
  `050c5b0a9157437ec34be14d0913f4df889e492a`. The bounded candidate adds only
  bearer-protected own-account `GET/PATCH /api/v1/notification-preferences/me`,
  its service/PostgreSQL repository and focused tests, exact migration-038 auth
  catalog evidence, module wiring, and this append-only record. No frontend,
  notification dispatcher/enqueue/send, Telegram login/destination, payment,
  privacy-setting, schema or migration artifact changed.
- `GET` interprets an absent
  `backend_auth.account_notification_preferences` row as the compatibility
  default `telegramMatchNotificationsEnabled=true`, `version=null`; an
  explicit row returns its stored boolean and positive version. `PATCH`
  accepts only that boolean plus `expectedVersion`: `null` performs a
  conflict-safe first insert, while an observed positive safe-integer version
  performs one account-scoped compare-and-swap update and increments version.
  Stale or racing writes return the fixed `409` conflict contract.
- The account comes only from the authenticated bearer principal (player or
  club_admin); no account, credential, destination or chat selector is accepted
  from the body, query or cookie. Responses are an exact two-field allowlist
  with `no-store`; persistence and HTTP errors fail closed without database,
  credential or Telegram details.
- The auth-integration catalog now requires migration 038 exactly: the table
  fingerprint, five columns, four constraints, account PK/FK, table SELECT,
  five column INSERT and three column UPDATE grants. Focused repository,
  service, HTTP, module-wiring and catalog regressions passed together:
  `5 / 5` suites and `134 / 134` tests.
- Mandatory backend gates PASS: typecheck; unit `153 / 153` suites and
  `3675 / 3675` tests; e2e `2 / 2` suites and `4 / 4` tests; build. Mandatory
  root stability gates PASS: e2e with four workers `99 passed / 1 intentional
  skip`; build transformed `1621` modules with the existing large-chunk
  advisory. The first sandbox-only root attempt could not traverse the existing
  external dependency junction; the authorised local retry outside that
  filesystem sandbox passed. No dependency or lockfile changed.
- The destructive auth-integration harness was not run because it requires a
  separately prepared disposable database and leaves fixture rows; its exact
  catalog validator is covered by the passing unit regression. Migration 038
  was not reapplied and no DB/Selectel/provider/API action occurred.
- This candidate changes backend runtime, so local implementation is complete
  but the NP2 stage remains `deployment_deferred_by_user` and is not marked
  done. No commit, push, merge, image/config/env change, rollout/restart,
  server/DB/schema/provider or production action is authorised in this gate.
  Independent exact-diff review completed after correcting the focused-test
  count in this record: `P0=0`, `P1=0`, acceptance PASS and
  `git diff --check` PASS. The reviewer made no file or external-state change.

### 2026-08-23 — D5.3 NP2 backend deployed to Selectel test

- Selectel test host `prosto-padel-test-01` was updated from the already
  integrated exact commit
  `8f09e6c207eb51f5501ea95dab0777f01b39688e`, tree
  `3642fb2837348f5d488b36f27936104f27b47607`. The server checkout was clean
  before rollout and remained clean at that exact detached commit afterward.
- Before the image build, the canonical migration-038 POSTCHECK artifact
  SHA-256
  `1ebc0e2a3cf1ef13de47d3b88e740acd197a8a14a85011e1e8b57d069400a8ce`
  ran read-only and ended with `ROLLBACK`: `verified=true`, preference rows
  `0`, accounts `8`, Telegram destinations `3`, outbox `1`. Migration 038 was
  not reapplied and no direct DB/schema/migration command changed state.
- Only the backend image and container changed. Backend container
  `490ab45823b7f4f2900e55616a0741ac2d4f34fbb91cd4ea73044e26de0d5a55`,
  image
  `sha256:1550ae332d2ee8e5875bd8a1992a42f44ec8b3f91ff1c3514fe2ceac3c624615`
  was replaced by container
  `d1a105a92f28dd602667a27ad3ff9edfdfe0cc451d11b6eb9f302644d902ad3c`,
  image
  `sha256:4fd3eca202f08af8e4413d61c28590184569f5dee680d463d5db7616add24230`.
  It is `running/healthy`, restart count `0`.
- Frontend container
  `b6e4954d503b9eed986607f8997ba5743b1177306b0e547473edcb60726398ee`,
  nginx `e5b98b53a385aef67465e097753fb54b060596d3c620af3cfb484a175d624be7`
  and PostgreSQL
  `5e36d4dc1a5c3e2fa658382cfc4a8dff7fe3ea2ba1a9834bb89cc83df743f7be`
  retained their exact IDs, images, healthy state and restart count `0`.
  Compose config, env/secrets, nginx/TLS, PostgreSQL, provider and production
  were not changed.
- Internal health and public
  `https://test-app.prostopdl.ru/api/v1/health` returned `200`; public TLS
  verification was `0` and the resolved remote IP was `135.106.155.112`.
  Stable post-healthy logs had backend critical `0`, nginx 5xx `0` and nginx
  critical `0`.
- The bearer smoke used a fresh PII-free synthetic Telegram subject and
  locally signed initData inside the unchanged backend secret boundary; no
  token, bearer, subject or contact value was printed or saved, and no Telegram
  provider API was called. It passed unauthorised GET/PATCH `401`, missing-row
  `true/version=null`, PATCH `false/version=1`, persistence across a second
  login, PATCH `true/version=2`, stale-version `409`, final GET and logout with
  revoked-bearer `401`. The required application-level smoke evidence retains
  one synthetic preference row in enabled state at version `2`; both synthetic
  sessions were revoked.
- NP2 test rollout is `done` for this exact commit. The exact implementation
  gates and independent `P0=0`, `P1=0` review were completed before commit;
  they were not rerun during rollout. This append-only Markdown closeout is the
  only local change and has deployment `not_needed`; commit/push of the
  closeout remains a separate gate.

### 2026-08-23 — D5.1 full frontend onboarding flow local candidate

- Started from the clean detached exact `main` commit
  `050c5b0a9157437ec34be14d0913f4df889e492a`. The candidate changes only the
  existing Telegram-authenticated frontend onboarding boundary, its focused
  tests, test-build public configuration wiring and this append-only WORKLOG
  entry. No second login/registration flow, Supabase call, backend/schema,
  dependency or payment/rating/contact-verification change was added.
- The existing auth gate now routes the current owner through resumable
  `profile -> consents -> level_survey -> completed` states. Profile PATCH is
  followed by the existing progress contract; consent progress and completion
  use the existing credential-bound lifecycle. Expected revisions are preserved,
  stale conflicts reconcile with one read and never replay a write, and an
  already completed onboarding renders the application without showing the
  onboarding flow again.
- Legal presentation is configurable through public Vite build settings for a
  published/policy-aligned flag plus the Terms, Privacy and Cancellation HTTPS
  URLs and versions. The default test configuration is fail-closed with empty
  URLs and both flags disabled: drafts are not presented as published documents,
  checkboxes and consent/completion writes are unavailable. Backend policy value
  `2026-08-01` remains test-only and is not evidence of a real acceptance. The
  later live gate requires owner-approved public documents and versions after
  the `2026-08-26` requisites, plus explicit backend-policy alignment.
- The available UI uses the existing TMA shell/tokens and safe areas, 48 px
  controls, keyboard-safe scrolling, visible inline errors and linked required
  checkbox/radio semantics. No PII, Telegram init data or bearer is stored in
  browser storage or written to logs. No real Selectel consent/completion request
  or other API/DB/provider write was performed.
- Focused frontend tests PASS: `23 / 23` across the onboarding policy, full-flow,
  profile-gate and client suites. Mandatory root gates PASS:
  `npm.cmd run test:e2e` passed `99 / 1 intentional skip`; `npm.cmd run build`
  passed with `1623` modules transformed and the existing large-chunk advisory.
  The first sandboxed build could not traverse the pre-existing external
  dependency junction; the approved retry against the same installed dependency
  tree passed. No dependency or lockfile was installed or changed.
- Two independent bounded reviews covered mobile UI/accessibility and the
  auth/state/test/PII boundary. Their P1 findings for historical consent resume,
  form semantics, backend-policy alignment and container build propagation were
  corrected. The final independent read-only review of the exact complete
  candidate, including new files, build configuration and this WORKLOG entry,
  passed with `P0=0, P1=0`.
- This candidate changes the frontend bundle and test Compose build inputs, so
  deployment is `deployment_deferred_by_user`. No commit, push, integration,
  SSH, checkout/container change, Selectel rollout/restart, DB/schema,
  TLS/nginx, env/secret, provider/API or production action occurred. The deployed
  test environment, deployed commits, containers, health/HTTP, manual smoke and
  logs remain unchanged from their latest separately recorded state.

### 2026-08-23 — D5.1 full frontend onboarding flow rebased local checkpoint

- Local `main` and local `origin/main` had advanced to exact
  `23fc0544bbf5520edfda1a801c7d74921d9ceee6`, a descendant of the original
  candidate base. In the clean isolated worktree, exact reviewed commit
  `a9dc0a75085ed42762a09b6b582332cb6382a9e9` was reapplied with
  `cherry-pick --no-commit` onto detached `23fc0544bbf5520edfda1a801c7d74921d9ceee6`.
  No `main`/`origin` ref changed and no replacement commit was created.
- The only merge conflict was this append-only WORKLOG. All NP2 implementation
  and rollout record content from current `main` was preserved in its existing
  order, the D5.1 record was retained after it, and all conflict
  markers were removed. The other fourteen D5.1 files applied without conflict;
  no D5.3 backend/runtime source was edited by the resolution.
- Focused onboarding tests passed `23 / 23`. Mandatory root gates on the rebased
  candidate passed: `npm.cmd run test:e2e` returned `99 passed / 1 intentional
  skip`, and `npm.cmd run build` transformed `1623` modules with the existing
  large-chunk advisory. The external dependency tree had the same Git lockfile
  blob `a5db96ca2068b6020b181a05c9461bbf7e3f49e1`; no dependency or lockfile was
  installed or changed, and the temporary local junction was removed afterward.
- Deployment remains `deployment_deferred_by_user`. No commit, push,
  integration, SSH, Selectel/container action, consent/completion API request,
  DB/schema, TLS/nginx, env/secret, provider/API or production action occurred.
  Independent read-only review of this exact rebased diff passed with
  `P0=0, P1=0` and no findings.

### 2026-08-23 — D5.1 full onboarding frontend deployed fail-closed on Selectel test

- Selectel test preflight passed on host `prosto-padel-test-01`, Compose project
  `prosto-padel-test`. The clean detached server checkout advanced from exact
  `8f09e6c207eb51f5501ea95dab0777f01b39688e` to integrated exact
  `1184868880750e4634de10517a12bb34d121f1ba` and remained clean afterward.
  Remote `origin/main` was confirmed at that exact target before checkout update.
- The canonical `infra/test/.env.test` contained none of the eight onboarding
  legal build keys: neither publication/policy-alignment flag was enabled and no
  legal URL or version was defined. No env file was edited. Compose
  `config --quiet` passed; the frontend image built `1623` modules with the
  legal flags visibly resolved to `false/false` and empty URL/version defaults.
- Only the frontend container changed. Previous container
  `b6e4954d503b9eed986607f8997ba5743b1177306b0e547473edcb60726398ee`
  was replaced by
  `3935b73b770917830e8e867a289f09b4a22fd58ecbc26178fb80d35be65259ef`,
  image
  `sha256:81c9b6d22e81c1daa4c9fcca8383a69ce9730ebcf5870fd18a4f5c19d70c6b12`.
  It is running/healthy with restart count `0`.
- Backend container
  `d1a105a92f28dd602667a27ad3ff9edfdfe0cc451d11b6eb9f302644d902ad3c`,
  nginx `e5b98b53a385aef67465e097753fb54b060596d3c620af3cfb484a175d624be7`
  and PostgreSQL
  `5e36d4dc1a5c3e2fa658382cfc4a8dff7fe3ea2ba1a9834bb89cc83df743f7be`
  retained their exact IDs, images, running/healthy state and restart count `0`.
  DB/schema, env/secrets and TLS/nginx configuration were unchanged.
- Public frontend and `/api/v1/health` both returned HTTP `200` with mandatory
  TLS verification result `0` at `135.106.155.112`. A browser smoke loaded the
  deployed bundle while locally intercepting every `/api/v1/**` route. A
  synthetic mocked session resumed directly at `consents`; the fail-closed legal
  unavailable gate was visible, while published legal links, checkboxes and the
  enabled consent gate each counted `0`. Progress, completion and unexpected API
  request counts were all `0`. No real credential or PII was used or printed,
  and no authenticated backend or consent/completion write occurred.
- From rollout start `2026-08-23T15:58:33Z`, bounded frontend critical and 5xx
  counts were `0/0`; bounded nginx critical and 5xx counts were also `0/0`.
  Deployment status is
  `deployment=applied_verified_with_legal_gate_fail_closed`.
- Mandatory root gates for this exact one-file closeout passed:
  `npm.cmd run test:e2e` returned `99 passed / 1 intentional skip`, and
  `npm.cmd run build` transformed `1623` modules with the existing large-chunk
  advisory. The temporary dependency junction used the identical lockfile Git
  blob `a5db96ca2068b6020b181a05c9461bbf7e3f49e1`, changed no dependency or
  lockfile, and was removed after the gates.
- This closeout itself is local documentation only. No commit, push,
  integration, additional SSH/DB/schema command, restart/rebuild/rollout,
  provider/API write, secret/env change or production action occurred after the
  recorded rollout. Independent read-only review of this exact one-file diff
  passed with `P0=0, P1=0` and no findings.

### 2026-08-23 — D5.1 temporary test-only legal alignment local candidate

- Started from clean detached exact `main`
  `c809b28384e2a99731804de7a4aad4aeefee8cb4`. The candidate is bounded to the
  existing onboarding policy/service, test-only Compose/frontend packaging,
  focused tests and this append-only record. Migrations 035–037 remain
  sufficient and unchanged; no DB/schema/data, credential, provider, Supabase,
  payment, rating or contact-verification change was added.
- Removed the runtime dependency on hardcoded consent version `2026-08-01`.
  Backend consent/progress/completion policy is now fail-closed runtime
  configuration, disabled by default, and accepts all three exact versions only
  when PostgreSQL and `PLAYER_ONBOARDING_LEGAL_POLICY_ENABLED` are enabled.
  Disabled or incomplete policy rejects level-survey progress and completion
  before persistence while profile and resumable pre-consent work remain
  available.
- The temporary Selectel test contract is exact and deliberately separate from
  production: `terms-test-2026-08-23-v1`, `privacy-test-2026-08-23-v1` and
  `cancellation-test-2026-08-23-v1`, each under the version-matching
  `https://test-app.prostopdl.ru/legal/test-only/` path. The test frontend image
  packages only the current repository drafts at those paths, displays a
  prominent test-only/non-production notice, uses `noindex` and `no-store`, and
  renders fetched Markdown only through `textContent`. The drafts remain visibly
  incomplete and are not represented as final or production documents.
- Frontend legal configuration now distinguishes `test_only` from production,
  rejects a production host, mismatched path/version or test version in a
  production scope, and exposes consent controls only when publication,
  backend-alignment and exact configuration gates all pass. No PII, Telegram
  initData or bearer is stored or logged. Focused frontend tests passed `14 / 14`;
  focused backend tests passed `128 / 128`.
- Mandatory root gates passed: `npm.cmd run test:e2e` returned `99 passed / 1
  intentional skip`, and `npm.cmd run build` transformed `1623` modules with the
  existing large-chunk advisory. Backend typecheck, e2e `4 / 4` and build passed.
  The native Windows full unit invocation passed `3686` tests and exposed one
  pre-existing CRLF-sensitive migration-038 fixture failure in an unchanged
  file; a bounded read-only rerun normalising CRLF only for that exact fixture
  passed all `3687 / 3687`. Candidate-only ESLint passed. Repository-wide
  format/lint ratchets still report pre-existing unchanged baseline files and
  were not broadened into this D5.1 diff.
- This local candidate does not yet edit the real `infra/test/.env.test`, commit,
  push, integrate, publish pages, recreate backend/frontend or execute any
  consent/completion request. Deployment is
  `deployment_pending_separate_commit_integration_test_env_and_rollout_gates`;
  production remains untouched.
- A version change alone does not currently re-open onboarding for an already
  completed player. Before the planned post-requisites document versions can
  require renewed consent, a separate owner-approved backend/schema/frontend
  re-consent lifecycle must be designed and reviewed; accepted immutable
  versions must never be overwritten in place.
- Independent read-only P0/P1 review of the exact 27-file candidate passed with
  `P0=0, P1=0`. The re-consent lifecycle is recorded as explicit remaining
  scope rather than hidden inside or falsely claimed by this candidate.

### 2026-08-23 — D5.1 temporary test-only legal alignment deployed on Selectel test

- The separate Selectel test env/config gate added exactly thirteen onboarding
  legal keys to the canonical `infra/test/.env.test`; every key was present
  exactly once after the write. File mode `600` and owner
  `prostopadel:prostopadel` were preserved, no secret value was printed, and no
  container or runtime was changed by the configuration-only gate.
- Rollout preflight passed on host `prosto-padel-test-01`, Compose project
  `prosto-padel-test`. The clean detached checkout advanced from exact
  `1184868880750e4634de10517a12bb34d121f1ba` to clean integrated exact
  `16006c0b6e885e56a2479887996cd505bb48aa69`. Compose `config --quiet` passed;
  the backend/frontend build started at `2026-08-23T18:27:51Z`, and the
  two-container recreate started at `2026-08-23T18:29:04Z`.
- Only backend and frontend containers changed. Backend became
  `f9039bbf87f2f388f33a701484e9bb51c23c5a82b08609ac06855f1d590333d4`, image
  `sha256:85d5af96570f39a96bbe0200fb0fca6ddeef80f42da15f62235ce4fe8083f3b8`;
  frontend became
  `bf22f74874bd0064126b89fa4777da02ddecb95602fcb8f6550e180b6d003443`, image
  `sha256:32a5ae5a0359bfa0ec9d722ed160d360f6ae8d11ffb08b5d4b52c1d021e79e80`.
  Both were healthy with restart count `0`. Nginx
  `e5b98b53a385aef67465e097753fb54b060596d3c620af3cfb484a175d624be7` and
  PostgreSQL
  `5e36d4dc1a5c3e2fa658382cfc4a8dff7fe3ea2ba1a9834bb89cc83df743f7be`
  retained their exact IDs, healthy state and restart count `0`.
- Public frontend and `/api/v1/health` returned HTTP `200` with mandatory TLS
  verification result `0`. Terms, Privacy and Cancellation test-only URLs each
  returned `200` with `no-store`, `noindex` and an explicit temporary
  Selectel-test marker. Unauthorized onboarding GET, PATCH, progress and
  completion checks each returned `401 no-store`; authenticated requests and
  consent/progress/completion writes counted `0`.
- The full rollout window contained one explicitly retained transient nginx
  event at `2026-08-23T18:29:06.334331343Z`:
  `GET /api/v1/health -> 502`, during backend recreation. The separate stable
  window from `2026-08-23T18:29:07Z` passed with backend, frontend and nginx
  critical counts `0` and 5xx counts `0`; the final checkout remained clean and
  all four containers remained healthy with restart count `0`.
- No DB/schema, TLS/nginx configuration, provider/API or production change was
  made, and no rollback was run. Deployment status is
  `deployment=applied_verified_with_transient_rollout_502_and_stable_window_pass`.
  This append-only closeout is documentation-only with deployment
  `not_needed`; the future replacement versions still require the separately
  approved re-consent lifecycle for already-completed players.
- Mandatory root gates completed on the exact one-file closeout. The first
  parallel WebKit E2E run reported four unrelated UI timeouts (`95 passed / 1
  intentional skip / 4 timed out`); one clean rerun against the unchanged
  candidate and dependency tree passed `99 / 1 intentional skip`. The first
  sandboxed build could not traverse the verified external dependency junction;
  the exact unsandboxed retry passed with `1623` modules transformed and the
  existing large-chunk advisory. No dependency, lockfile or runtime file was
  installed or changed by either retry.
- Independent read-only review of this exact one-file closeout diff passed with
  `P0=0, P1=0` and no findings.

### 2026-08-23 — D5.1 authenticated test-only full onboarding smoke on Selectel test

- The one-time PII-free authenticated smoke ran against host
  `prosto-padel-test-01`, Compose project `prosto-padel-test`, for integrated
  exact `main` commit `f7565d2e91987b245a79b121f0c5be3f99fdc54b`, whose
  runtime tree is identical to deployed exact commit
  `16006c0b6e885e56a2479887996cd505bb48aa69`. Preflight reconfirmed the clean
  exact server checkout, migration 037 as `applied_verified` without repeat
  apply, exactly thirteen configured test-only legal keys without displaying
  values, internal health `200`, and all four containers healthy with restart
  count `0`.
- The syntax-checked in-memory runner had SHA-256
  `1F068C45E9D45CF3A978C1D3E11879F18DC81122E364AC4F158A6BCAA5C24D2A`.
  It was streamed once into the existing backend container, was not persisted,
  and started at `2026-08-23T19:13:31.069Z`. No secret, bearer, initData,
  identifier, contact value, request/response body or other PII was printed.
- The exact API-backed sequence passed: `login/new -> GET required/null -> PATCH
  profile/1 -> progress consents/2 -> GET resume consents/2 -> progress
  level_survey/3 -> GET resume level_survey/3 -> completion/4 -> exact completion
  retry completed/4 -> different completion request 409 -> GET completed/4 ->
  logout 204 -> old bearer 401 -> login existing -> GET completed/4 without
  repeated onboarding -> logout 204 -> second old bearer 401`.
- The permitted writes retained one PII-free synthetic player fixture with
  declared contacts, no notification permission, the test flow/survey answer
  and the exact temporary Terms, Privacy and Cancellation test-policy consent
  records. Those records are test-only evidence and are not represented as real
  user consent. No rollback, delete or anonymisation was performed.
- Post-smoke verification reconfirmed the clean unchanged checkout and the exact
  unchanged backend, frontend, nginx and PostgreSQL containers, images, healthy
  state and restart count `0`; internal health remained `200`. From the smoke
  start, bounded backend, frontend and nginx critical counts were `0` and HTTP
  5xx counts were `0`. Files, containers, DB schema/migrations, runtime,
  env/secrets, TLS/nginx configuration, provider state and production were
  unchanged.
- Mandatory root gates passed for this exact documentation-only closeout. The
  first E2E invocation stopped before executing tests because the isolated
  worktree had no local `node_modules`; the existing dependency tree was then
  verified against the identical lockfile Git blob
  `a5db96ca2068b6020b181a05c9461bbf7e3f49e1` and attached temporarily. The
  unchanged candidate passed `npm.cmd run test:e2e` with `99 passed / 1
  intentional skip` and `npm.cmd run build` with `1623` modules transformed and
  the existing large-chunk advisory. The junction was removed afterward; no
  dependency or lockfile was installed or changed.
- Deployment status is
  `deployment=applied_verified_with_authenticated_test_only_full_onboarding_smoke_pass`.
  This append-only closeout is documentation-only with deployment `not_needed`;
  its commit and integration remain separate gates. The future replacement
  legal versions still require the separately approved re-consent lifecycle for
  already-completed players; immutable accepted versions must not be overwritten.

### 2026-08-23 — D5.1 combined profile and legal-consent frontend correction candidate

- Started from the clean detached exact integrated `main` commit
  `36a9f06a141e7a63e9b57d2b4e1fa68522a840fb`. The correction is limited to the
  existing onboarding flow/profile components, their CSS and focused tests, the
  Telegram lifecycle E2E expectation and this append-only record. `AuthGate`,
  the credential lifecycle/client, backend state machine, migrations 035–037,
  database schema/data and policy configuration remain unchanged.
- The separate large `Документы и согласия` screen was removed. Onboarding
  states `profile`, legacy `contacts` and resumable `consents` now render the
  same first visual step with server-owned name, canonical phone and normalized
  email fields followed by three compact required checkbox rows. Each row links
  to the exact configured versioned Terms, Privacy or Cancellation document;
  unpublished or policy-unaligned configuration remains fail-closed inline and
  exposes no consent controls or enabled primary action.
- The single `Продолжить` action stays disabled until the profile draft is valid
  and all three checkboxes are selected. It preserves existing optimistic
  revisions and executes only the required backend transitions in order: a new
  profile uses `PATCH -> profile/contacts to consents -> consents to
  level_survey`, while resume at `consents` uses `PATCH -> consents to
  level_survey`. Any stale, reconciled, cancelled, unknown or rejected stage
  stops the chain without silent skip or automatic write replay. The level
  survey is now the second visual step; completed onboarding still enters the
  existing application directly.
- The combined form keeps PII and checkbox state only in React memory, never in
  browser storage or logs. Declared phone/email remain explicitly unverified.
  The temporary test-only warning is compact but still states that the versions
  are not a production publication. Existing safe-area/keyboard scroll behavior,
  visible labels/focus, inline field errors, 48 px controls and disabled/loading
  semantics were retained or strengthened following the `ui-ux-pro-max` mobile
  form checklist. Profile/consent controls and survey answers are semantically
  disabled for their full in-flight request, legal links remain readable, and
  adjacent checkbox/link touch targets have an `8 px` gap.
- Focused profile/flow/policy tests passed `20 / 20`, including explicit legacy
  `contacts` resume and in-flight control-lock coverage. Candidate-only
  Prettier passed for the formatted
  component/test files and candidate-only ESLint passed for every changed
  JS/JSX file. The first mandatory root E2E run passed every changed
  onboarding/auth scenario but reported two unrelated 30-second UI timeouts in
  unchanged waitlist and booking-confirmation tests (`97 passed / 1 intentional
  skip / 2 timed out`). One clean rerun against the unchanged candidate passed
  `99 / 1 intentional skip`. Two later verification reruns again kept every
  changed onboarding/auth scenario green while unrelated unchanged chat/home/
  booking and profile-photo UI flakes varied (`96 / 1 / 3` and `98 / 1 / 1`);
  no candidate test failed. The final exact corrected candidate then passed the
  complete root E2E gate cleanly (`99 / 1 intentional skip`). Mandatory root
  build passed with `1623` modules transformed and the existing large-chunk
  advisory.
- Repository-wide format/lint ratchets were also run. Lint remains blocked only
  by the unchanged `AuthGate.jsx` baseline (`13` findings). The format ratchet
  still lists its inherited baseline plus the exact changed legacy CSS/E2E
  files because their historical formatting outside the bounded hunks was
  intentionally preserved; full-file churn was removed after independent scope
  review. No baseline cleanup was folded into this D5.1 slice. The verified
  temporary dependency junction used the identical lockfile Git blob
  `a5db96ca2068b6020b181a05c9461bbf7e3f49e1` and was removed before handoff; no
  dependency or lockfile was installed or changed.
- Independent bounded state/PII and mobile UI/accessibility reviews of the exact
  corrected diff both passed with `P0=0`, `P1=0`. The UI review's initial three
  P1 findings (in-flight control locking and touch-target separation) were
  corrected and re-reviewed before this handoff.
- This candidate changes the frontend bundle, so deployment is
  `deployment_deferred_by_user` pending separate commit, integration and
  frontend-only Selectel test rollout gates. No commit, push, SSH, container,
  API/DB/schema, env/secret, TLS/nginx, provider or production action occurred;
  the prior deployed runtime and successful API-level full-onboarding smoke
  remain unchanged. Manual TMA verification must target the corrected frontend
  only after its separately approved test rollout.

### 2026-08-23 — D5.1 combined profile and legal-consent frontend rollout on Selectel test

- Read-only preflight passed on host `prosto-padel-test-01`, Compose project
  `prosto-padel-test`. The canonical test env contained exactly one occurrence
  of each of the thirteen required onboarding legal key names; no value or
  secret was printed. The clean detached server checkout advanced from exact
  `16006c0b6e885e56a2479887996cd505bb48aa69` to clean integrated exact
  `4a32831eed8ed4c3c3683f1a199b22de0b8747df`.
- Compose `config --quiet` passed. The frontend-only build started at
  `2026-08-23T20:44:56Z`, and the frontend-only forced recreate started at
  `2026-08-23T20:45:04Z`. Previous frontend container
  `bf22f74874bd0064126b89fa4777da02ddecb95602fcb8f6550e180b6d003443`
  was replaced by
  `483b97ed5ef72b3dfd359a9fd918ec97586621a6c207414b8e2bbb82c594e6a9`,
  image
  `sha256:28b2512addbb0f86665c7cfd8f2ec0bc7f196768980f047491b6664620fdfe79`.
  The new frontend is healthy with restart count `0`.
- Backend
  `f9039bbf87f2f388f33a701484e9bb51c23c5a82b08609ac06855f1d590333d4`,
  nginx
  `e5b98b53a385aef67465e097753fb54b060596d3c620af3cfb484a175d624be7`
  and PostgreSQL
  `5e36d4dc1a5c3e2fa658382cfc4a8dff7fe3ea2ba1a9834bb89cc83df743f7be`
  retained their exact container IDs, healthy state and restart count `0`.
- Public frontend and `/api/v1/health` returned HTTP `200` with mandatory TLS
  verification result `0`. The exact temporary Terms, Privacy and Cancellation
  test-only URLs each returned HTTP `200` with TLS verification result `0`.
  Bounded frontend and nginx logs since `2026-08-23T20:45:04Z` contained
  critical count `0` and 5xx count `0` for both containers.
- Authenticated onboarding requests and consent/progress/completion writes were
  not executed (`0`). Environment/secrets, DB/schema, TLS/nginx configuration,
  provider/API and production were unchanged. Deployment status is
  `deployment=applied_with_manual_tma_combined_onboarding_smoke_pending`;
  manual authenticated TMA verification remains a separate owner-approved gate.
- Mandatory local root gates passed against this exact one-file closeout diff:
  `npm.cmd run test:e2e` completed with `99 passed / 1 intentional skip`, and
  `npm.cmd run build` completed with `1623` modules transformed and only the
  existing large-chunk advisory. This WORKLOG-only closeout does not alter a
  runtime artifact, so its own deployment impact is `deployment=not_needed`.

### 2026-08-24 — D5.1 combined onboarding manual smoke FAIL and survey gap

- The owner's live Telegram Mini App check supersedes the pending-smoke
  closeout above. The combined profile/consent screen advanced to a survey that
  contained only the `experience` question. Submitting that answer showed an
  error with `Обновить анкету`; after the owner selected reload, the completed
  state was read and the application opened. This is a manual smoke `FAIL`, not
  a completed D5.1 acceptance. The applied frontend rollout remains intact, but
  its status is corrected append-only to
  `deployment=applied_with_manual_tma_combined_onboarding_smoke_failed_investigation_required`.
- Read-only contract inspection proves the submit-error/reload-completed cause.
  `POST /api/v1/onboarding/me/complete` lacks an explicit
  `@HttpCode(HttpStatus.OK)`, and its backend controller regression therefore
  expects Nest's default HTTP `201`. The frontend onboarding client accepts a
  successful response only when `status === 200`; a valid completed body paired
  with `201` falls through to `rejected/internal_error`. The database transaction
  has already committed, so the following owner-scoped GET reads `completed` and
  the gate enters the application. Existing unit tests mock the frontend success
  as `200` and separately assert backend `201`, so they did not cover the real
  cross-boundary status mismatch.
- PII-safe runtime preflight reconfirmed clean exact deployed checkout
  `4a32831eed8ed4c3c3683f1a199b22de0b8747df`. No request was repeated and no
  credential, body, contact or identifier was read. A new access-event aggregate
  could not be obtained under the existing SSH identity: host nginx logs require
  the `adm` group, non-interactive sudo requires a password, and the Docker socket
  rejects that identity. No credential was requested and no privilege boundary
  was bypassed; the cause above is established by the exact producer/consumer
  contract and the owner's observed committed-state reconciliation.
- The current `initial_level_v1` policy is a one-question temporary contract and
  is superseded; it is not the final initial-level survey. The approved target is
  five code-only questions: match count, rally stability, glass play,
  serve/return/net play and match experience during the year. Every option maps
  server-side to `0..4`; the deterministic total `0..20` maps to
  `D / D+ / C / C+ / B / B+ / A` buckets and applies the approved match-count,
  glass, technical-answer and tournament-experience caps. Those labels match the
  canonical order and boundaries in `ratingEngine`, but the result remains a
  separate initial self-assessment: it does not write numeric player rating or
  `isVerified`. Because completed `initial_level_v1` evidence already exists, the
  final five-question contract must use a new immutable survey/scoring version
  rather than reinterpret stored answers.
- Applied migration 035, with migration 037's current transition guard, can
  safely retain five bounded answer-code pairs in `survey_answers jsonb` (limit
  `16`), identified by `survey_version`. It has no column for the computed score
  or initial-level label, while the completion writer stores and compares exactly
  the client-supplied answer map. Encoding a computed result as another answer
  would break exact retry semantics; using `player_rating_states` would violate
  the rating boundary. A new data-preserving migration is therefore required.
  The minimal proposal adds nullable, constrained `initial_level_score` (`0..20`)
  and `initial_level_label` (`D`, `D+`, `C`, `C+`, `B`, `B+`, `A`) to the private
  onboarding state, preserves legacy completed rows without backfill, grants the
  runtime role only the needed column-level completion update, and requires both
  fields for the new survey version. SQL, scoring code and runtime wiring remain
  blocked pending a separate owner approval.
- The future UI remains one question per screen with progress and back navigation.
  Its result screen is intentionally compact: `Ваш начальный уровень: X` plus the
  button that enters the application. Score, formula, caps and calculation reasons
  stay internal to the versioned backend contract/tests and PII-free admin/debug
  evidence; they are not shown to the user. No code, SQL, schema/data, API,
  container, env/secret, provider or production change was made in this
  diagnostic checkpoint. This append-only correction is docs-only with
  `deployment=not_needed`.

### 2026-08-24 — D5.1 migration 039 initial-level result candidate

- On exact detached local base
  `9dbac1669a046900bef6290ae6b83fd4fdf533de`, after the append-only manual-smoke
  correction above, owner approval authorized only a runtime-disconnected
  migration candidate. Applied migrations 035–037 remain byte-for-byte
  unchanged; no backend/frontend runtime wiring is included.
- Candidate `039_backend_player_onboarding_initial_level_result` adds only two
  private nullable columns to `backend_auth.player_onboarding_states`:
  `initial_level_score smallint` constrained to `0..20` and
  `initial_level_label text` constrained to `D / D+ / C / C+ / B / B+ / A`.
  Existing completed rows remain compatible with both values `NULL`; there is
  no backfill or data mutation. Both values are required together only for a
  completed immutable `initial_level_v2` result and are forbidden on legacy or
  in-progress states.
- The candidate grants `backend_auth_app` only column-level `UPDATE` on the two
  result fields, retains no table-level `UPDATE`, retains `PUBLIC` without
  access, pins the migration-035 relation and migration-037 guard fingerprints,
  and leaves the guard definition, every other relation, existing columns and
  data unchanged. PRECHECK and POSTCHECK are read-only and terminally roll back;
  ROLLBACK refuses to discard any `initial_level_v2` or computed-result data.
- This checkpoint creates only SQL/PRECHECK/POSTCHECK/ROLLBACK, its focused
  migration regression and this append-only evidence. It does not implement
  scoring or API/UI behavior, does not apply SQL to any database and changes no
  checkout, container, runtime, environment, secret, provider or production
  state. Deployment for this local candidate is `deployment=not_needed`; any
  commit, integration and Selectel test schema gate remain separately blocked.
- Focused migration regression passed (`7/7`). Mandatory backend typecheck,
  backend E2E (`4/4`) and backend build passed. Root build passed with `1623`
  modules and only the existing large-chunk advisory. The first two root E2E
  runs each had a different existing match-lifecycle timeout; the bounded retry
  with four workers passed `99` tests with `1` intentional skip.
- The complete backend unit command ran `3694` tests: `3693` passed and the one
  failure is the unchanged migration-038 spec's CRLF-sensitive exact substring
  lookup in its rollback artifact. Neither that spec nor any migration-038 file
  is in this candidate diff; the focused migration-039 regression remains green.
  This pre-existing Windows full-suite baseline failure is recorded rather than
  hidden or repaired outside the authorized D5.1-039 scope.
- Independent read-only review of the exact candidate diff found no blocking
  issues: `P0=0`, `P1=0`. No correction was required after review.

### 2026-08-24 — D5.1 migration 039 applied and verified on Selectel test

- Exact integrated source commit
  `a38493ef291347551027246be202294d3640ff64` was used only to stream the
  reviewed migration artifacts through the loaded Windows SSH agent directly
  into Selectel test PostgreSQL. The confirmed target was host
  `prosto-padel-test-01`, Compose project `prosto-padel-test`, PostgreSQL
  `14.23`, database `prosto_padel_test_migration_cycle`, primary/not in
  recovery. The PostgreSQL container
  `5e36d4dc1a5c3e2fa658382cfc4a8dff7fe3ea2ba1a9834bb89cc83df743f7be`
  was running, healthy and at restart count `0` before the gate.
- Exact read-only PRECHECK SHA-256
  `E78E3D56C5FF4DC85AE9E6D257D30ABCBDFF35078AA4F519D1A1EE4B3906A859`
  exited `0` with empty stderr, returned `ready=true`, matched exact local base
  `9dbac1669a046900bef6290ae6b83fd4fdf533de`, observed zero
  `initial_level_v2` rows and ended with a separate terminal `ROLLBACK` line.
- Exact migration SHA-256
  `F191ED634070CBBC8332216E7CC9A121901F7DAEDBDB6EBA55E3A19729F88187`
  was applied exactly once with exit `0` and empty stderr. It emitted exactly
  one separate `COMMIT` line, no `ROLLBACK` line and the expected migration-039
  result marker. No server-side migration file was created.
- Exact read-only POSTCHECK SHA-256
  `F98744A79E6C3F4363CD4F7F49502327FFD567286799897562B7A8A6C523035D`
  exited `0` with empty stderr, confirmed the migration-039 relation
  fingerprint, exact owner-granted non-grantable column-level `UPDATE` ACL for
  `backend_auth_app`, no table-level or `PUBLIC UPDATE`, synthetic fixture
  compatibility and zero `initial_level_v2` rows, then ended with a separate
  terminal `ROLLBACK` line. Existing completed rows remain without backfill;
  their new result fields remain nullable and no data mutation was performed.
- Migration 039 is `applied_verified` and must not be applied again. Its
  rollback migration was not run. Checkout, container definitions, application
  runtime, env/secrets, TLS/nginx, provider API and production were not changed;
  no fetch, checkout, restart, rebuild or rollout command was executed.
  Deployment is `applied_verified_runtime_unchanged`.
- An additional optional post-gate read-only checkout/container inventory was
  stopped by the remote Git command with exit `128` before its container query
  ran. Its stderr reason was not emitted by the wrapper, so no narrower cause is
  asserted here. The successful PRECHECK/APPLY/POSTCHECK evidence above is
  unaffected, and no write of any kind was executed after POSTCHECK.
- Required local root gates covered the complete suite. The first four-worker
  E2E run passed `95` tests with `1` intentional skip and had four WebKit
  timeouts in unchanged UI scenarios; the exact four timed-out scenarios then
  passed `4/4` sequentially with one worker. Root build passed with `1623`
  modules and only the existing large-chunk advisory. The dependency lockfile
  matched the existing installed tree exactly; no dependency or lockfile was
  installed or changed.
- This closeout changes only this append-only WORKLOG entry. It performs no
  commit, push, integration, SSH/DB/schema command, runtime action, API/provider
  write or production change; its own deployment impact is
  `deployment=not_needed`.
- Independent read-only review of the exact one-file closeout diff found no
  blocking issues: `P0=0`, `P1=0`. No correction was required after review.

### 2026-08-24 — D5.1 backend initial-level v2 scoring candidate

- Work started from clean exact detached main
  `5b7e79a842611464632c9c7dea168425432f433b`. Applied-verified migration 039 is
  sufficient: its nullable constrained `initial_level_score` and
  `initial_level_label` columns plus exact column-level runtime ACL support the
  required atomic completion update. No new migration or schema change is
  needed in this slice; applied migrations 035–039 remain unchanged.
- The backend-owned survey policy now uses immutable version
  `initial_level_v2` and accepts exactly five code-only answers: match count,
  rally stability, glass play, serve/return/net play and match experience in
  the last year. Clients still submit only option IDs. Any missing, additional,
  legacy one-question or unknown answer is rejected before persistence; no
  client-supplied score or level is accepted.
- Deterministic server scoring maps each answer to internal `0..4`, totals
  `0..20` and applies the approved `D / D+ / C / C+ / B / B+ / A` buckets and
  caps: zero matches at `D+`, up to ten matches at `C`, weak glass at `C+`,
  `B+` only with at least 31 matches and every technical answer at least `3`,
  and `A` only with 100+ matches, maximum technical answers and tournament
  experience. The labels and order match the existing `ratingEngine` boundary,
  but this result remains separate from player rating and `isVerified`.
- The completion writer independently recalculates the result, locks the exact
  owner/state, saves answers, score and label in one guarded revision update,
  and verifies the returned values. An exact retry is read-only and succeeds
  only when revision, answers, consent versions and computed result all match;
  stale or different requests remain bounded conflicts. PII, credentials,
  answer bodies and result details are not logged.
- The public onboarding response shape and frontend were intentionally not
  changed in this backend-only slice. Exposing only the server-computed label to
  the future compact result screen, replacing the five-question frontend flow
  and correcting completion HTTP reconciliation remain separate D5.1 gates.
- Focused scoring/policy/service/PostgreSQL writer regressions passed `106/106`.
  Backend typecheck, backend E2E (`4/4`) and backend build passed. The complete
  backend unit command ran `3731` tests: `3730` passed and the sole failure is
  the unchanged migration-038 CRLF-sensitive substring baseline outside this
  diff. Root E2E passed `99` tests with `1` intentional skip; root build passed
  with `1623` modules and only the existing large-chunk advisory.
- Changed backend files were formatted directly and add no new lint or dead-code
  finding. Repository-wide format/lint/dead-code ratchets remain blocked only
  by the same inherited main baselines: unchanged unformatted files, the
  unchanged `AuthGate.jsx` 13 lint findings, and a Knip issue set byte-for-byte
  identical to current main (`Compare-Object` difference count `0`). No baseline
  cleanup was included.
- This candidate changes backend runtime behavior and therefore has
  `deployment_deferred_by_user` pending separate commit,
  integration and Selectel test backend rollout/smoke gates. No commit, push,
  SSH/DB/schema command, container action, API/provider write, env/secret change
  or production action occurred in this local checkpoint.
- Independent read-only review of the exact candidate diff passed acceptance
  with `P0=0`, `P1=0`; no correction remained after the factual test-count
  update.

### 2026-08-24 — D5.1 initial-level v2 backend rollout on Selectel test

- The authorized backend-only rollout targeted host `prosto-padel-test-01` and
  Compose project `prosto-padel-test`. The first read-only probe stopped before
  writes because root Git rejected the checkout as a dubious ownership path and
  the Docker metadata template used an unsupported helper. The corrected probe
  ran Git as checkout owner `prostopadel` and used a compatible Docker format;
  it then passed every precondition without changing Git, containers or config.
- The clean detached server checkout advanced by fast-forward from exact
  `4a32831eed8ed4c3c3683f1a199b22de0b8747df` to integrated exact
  `83055aa595d6e477d6094034c60b89ba0c27b3bf` and remained clean. Actual remote
  `origin/main` matched the target before the checkout update. The canonical
  `.env.test` remained a regular non-symlink owned by
  `prostopadel:prostopadel` with mode `0600`; no env or secret value was printed
  or changed.
- Exact migration-039 POSTCHECK SHA-256
  `F98744A79E6C3F4363CD4F7F49502327FFD567286799897562B7A8A6C523035D`
  passed with exit `0`, empty stderr, `applied=true` and terminal `ROLLBACK`.
  Migration 039 was not applied again and no DB/schema write occurred.
- Compose `config --quiet` passed using the canonical `.env.test`,
  `infra/test/compose.yaml` and `infra/test/compose.runtime-backend.yaml` without
  printing expanded configuration. Backend-only build ran from
  `2026-08-24T08:45:09Z` through `2026-08-24T08:45:31Z`; backend recreate ran
  from `2026-08-24T08:45:43Z` through `2026-08-24T08:45:44Z` with
  `--no-deps --force-recreate`.
- Only backend container
  `f9039bbf87f2f388f33a701484e9bb51c23c5a82b08609ac06855f1d590333d4`
  was replaced, by
  `319a43559bbdb094746a534196bb1a166d2e5c6926d7394ab96db68f72bcdf3d`
  using image
  `sha256:df19c39cf6948cfbd6373c529367382fb2d41bb4b8fb3169bf36b7a7ba42cd95`.
  The new backend was healthy with restart count `0`. Frontend
  `483b97ed5ef72b3dfd359a9fd918ec97586621a6c207414b8e2bbb82c594e6a9`,
  nginx `e5b98b53a385aef67465e097753fb54b060596d3c620af3cfb484a175d624be7`
  and PostgreSQL
  `5e36d4dc1a5c3e2fa658382cfc4a8dff7fe3ea2ba1a9834bb89cc83df743f7be`
  remained unchanged, healthy and at restart count `0`.
- Internal backend health and public HTTPS `/api/v1/health` returned `200`; the
  public check used normal certificate validation with TLS verify result `0`.
  Unauthorized GET/PATCH `/api/v1/onboarding/me`, POST
  `/api/v1/onboarding/me/progress` and POST
  `/api/v1/onboarding/me/complete` each returned `401` with `no-store` and no
  response body was emitted. No authenticated onboarding request was executed.
- Bounded count-only logs from recreate start `2026-08-24T08:45:43Z` reported
  backend critical `0`, backend `5xx=0`, nginx critical `0` and nginx `5xx=0`.
  Checkout stayed clean at the exact target; frontend/nginx/PostgreSQL, DB/schema,
  env/secrets, TLS/nginx config, provider API and production were unchanged.
- Runtime deployment status is
  `deployment=applied_with_authenticated_initial_level_v2_smoke_pending`;
  `authenticated initial_level_v2 smoke=pending_separate_api_write_approval`.
  This append-only closeout itself is docs-only with `deployment=not_needed` and
  performs no commit, push, integration, SSH/DB/schema command, container action,
  API/provider write, env/secret change or production action.
- Required local root gates passed: E2E completed with `99` passed and `1`
  intentional skip; build completed with `1623` modules and only the existing
  large-chunk advisory. The first build invocation stopped before compilation
  because the sandbox could not traverse the verified dependency junction; the
  identical read-enabled retry passed. The temporary junction was removed, no
  dependency or lockfile changed, and the final Git scope remained only this
  WORKLOG file.
- Independent read-only review of the exact one-file closeout diff passed
  acceptance with `P0=0`, `P1=0`; no correction was required.

### 2026-08-24 — D5.1 authenticated initial-level v2 backend smoke on Selectel test

- The one-time PII-free authenticated smoke targeted Selectel test host
  `prosto-padel-test-01` and Compose project `prosto-padel-test`. Preflight
  confirmed the clean exact deployed checkout
  `83055aa595d6e477d6094034c60b89ba0c27b3bf`, whose backend tree is identical
  to integrated main `0bbccb154fdaea273c72954825a8636f6371c614`, backend container
  `319a43559bbdb094746a534196bb1a166d2e5c6926d7394ab96db68f72bcdf3d`,
  image `sha256:df19c39cf6948cfbd6373c529367382fb2d41bb4b8fb3169bf36b7a7ba42cd95`,
  healthy status, restart count `0` and internal health `200`.
- Exact migration-039 POSTCHECK SHA-256
  `F98744A79E6C3F4363CD4F7F49502327FFD567286799897562B7A8A6C523035D`
  passed again read-only with exit `0`, empty stderr, `applied=true` and terminal
  `ROLLBACK`. Migration 039 remained `applied_verified` and was not applied
  again.
- The syntax-checked in-memory runner SHA-256
  `D10A274C64E62D5B28256BE3B5C14189D18018BB2B4DD289DF71A117618FF34E`
  ran remotely exactly once, from `2026-08-24T09:10:26.437Z` through
  `2026-08-24T09:10:26.746Z`, with exit `0` and empty stderr. Local orchestration
  and syntax guards stopped two earlier preparation attempts before SSH/API/DB
  execution, so they created no session or fixture and did not duplicate the
  authorized runner.
- The complete sequence passed: `login/new` -> `GET required/null` ->
  `PATCH profile/revision 1` -> `progress consents/revision 2` -> `progress
  level_survey` with the exact three test-only legal versions at revision `3` ->
  `completion` for `tma_v1` plus five `initial_level_v2` option IDs at revision
  `4` -> exact completion retry returning the same completed revision `4` ->
  different completion request returning `409` -> `GET completed/4` -> logout
  `204` -> old bearer `401` -> second login as existing -> `GET completed/4`
  without repeated onboarding -> logout `204` -> second old bearer `401`.
- Read-only fixture evidence confirmed `status=completed`, `revision=4`,
  `survey_version=initial_level_v2`, `initial_level_score=20` and
  `initial_level_label=A`. Player rating and `isVerified` remained unchanged.
  Exactly one PII-free synthetic fixture remains with declared synthetic contacts
  and three test-only consent records that are not real user acceptances;
  notification permission was not requested.
- Secret material, bearer tokens, Telegram init data, request/response bodies,
  identifiers, contacts and PII were not emitted. Final bounded count-only logs
  from the runner start reported backend critical `0`, backend `5xx=0`, nginx
  critical `0` and nginx `5xx=0`.
- The checkout remained clean and exact; backend stayed healthy at restart count
  `0`. Frontend, nginx and PostgreSQL container identities remained unchanged.
  No checkout/file, container, DB schema/migration, runtime, env/secret,
  TLS/nginx, provider API or production change occurred during the smoke.
  Deployment status is
  `deployment=applied_verified_with_authenticated_initial_level_v2_smoke_pass`.
  This append-only closeout itself is docs-only with `deployment=not_needed`.
- Required local root build passed with `1623` modules and only the existing
  large-chunk advisory. The full root E2E run completed with `98` passed, `1`
  intentional skip and one 30-second timeout in the unchanged backend-chat draft
  scenario; the exact timed-out scenario then passed `1/1` sequentially through
  the repository's server-owning E2E wrapper. Earlier local gate attempts stopped
  before test execution because the isolated worktree had no dependency tree and
  sandboxed esbuild could not traverse the verified dependency junction. The
  identical read-enabled runs above used the installed tree whose `package.json`
  and lockfile content matched this checkout; the temporary junction was removed
  and no dependency, lockfile or runtime artifact remains changed.
- Independent read-only review of the exact one-file closeout diff passed
  acceptance with `P0=0`, `P1=0`; no correction was required.

### 2026-08-24 — D5.1 completed initial-level label response contract candidate

- Work started from clean exact detached main
  `c4c4ecf6d5fcaf5346976394b020a4de4e6312c1`. Applied-verified migration 039
  already persists the constrained server-computed label, so no migration or
  schema change is needed for this slice; applied migrations remain unchanged.
- The owner-scoped PostgreSQL onboarding reader now loads only
  `initial_level_label` in addition to the existing state fields and validates
  it fail-closed. Authenticated GET and completion responses expose
  `initialLevelLabel` only when the persisted state is `completed` with survey
  version `initial_level_v2`. The response never exposes the score, formula,
  caps, calculation reasons, rating or `isVerified`.
- Required, in-progress and legacy completed states retain their previous exact
  response shape without `initialLevelLabel`. The frontend onboarding client
  accepts only the seven allowed labels for completed `initial_level_v2`,
  requires the label there, and rejects missing, invalid or extra response
  fields including `initialLevelScore`. No UI, browser storage or logging path
  was changed.
- Completion now explicitly returns HTTP `200`, matching the existing strict
  frontend client contract and avoiding a false client error after a successful
  atomic completion. Authentication, owner scoping, declared contact assurance,
  PII-safe errors and no-store behavior remain unchanged.
- Focused backend controller/service/PostgreSQL-reader regressions passed
  `151/151`; focused frontend-client regressions passed `15/15`. Backend
  typecheck, backend E2E (`4/4`) and backend build passed. The complete backend
  unit command ran `3739` tests: `3738` passed and its only failure is the
  unchanged migration-038 CRLF-sensitive substring baseline outside this diff.
  Root E2E passed `99` tests with `1` intentional skip; root build passed with
  `1623` modules and only the existing large-chunk advisory.
- This candidate changes backend runtime behavior and the frontend client
  contract. Deployment is `deployment_deferred_by_user` pending separate
  commit, integration and Selectel test backend+frontend rollout/smoke gates.
  No commit, push, integration, SSH/DB/schema command, container action,
  API/provider write, env/secret change or production action occurred in this
  local checkpoint.
- Independent read-only review of the exact 11-file candidate diff passed
  acceptance with `P0=0`, `P1=0`; no correction was required.

### 2026-08-24 — D5.1 initial-level label contract rollout on Selectel test

- Read-only preflight passed on test host `prosto-padel-test-01`, Compose
  project `prosto-padel-test`. The clean checkout was exact
  `83055aa595d6e477d6094034c60b89ba0c27b3bf`, actual remote `origin/main` was
  exact `af526cd1429983dd9ffb13507fc1b58b36667fc0`, and the expected backend,
  frontend, nginx and PostgreSQL containers were healthy with restart count
  `0` before any rollout write.
- Exact migration-039 POSTCHECK SHA-256
  `F98744A79E6C3F4363CD4F7F49502327FFD567286799897562B7A8A6C523035D`
  passed read-only with exit `0`, empty stderr, `applied=true` and terminal
  `ROLLBACK`. Migration 039 was not applied again. An earlier local byte check
  stopped before SSH because the working-tree LF representation did not match
  the recorded CRLF stream hash; the verified exact CRLF stream above was the
  only POSTCHECK executed remotely.
- The server checkout advanced by fast-forward from exact
  `83055aa595d6e477d6094034c60b89ba0c27b3bf` to clean exact
  `af526cd1429983dd9ffb13507fc1b58b36667fc0`. Compose `config --quiet` passed
  using the canonical `.env.test`, `infra/test/compose.yaml` and
  `infra/test/compose.runtime-backend.yaml` without printing expanded config.
  Backend and frontend build ran from `2026-08-24T10:28:36Z` through
  `2026-08-24T10:29:03Z`; their recreate ran from `2026-08-24T10:29:03Z`
  through `2026-08-24T10:29:05Z` with `--no-deps --force-recreate`.
- Backend container
  `319a43559bbdb094746a534196bb1a166d2e5c6926d7394ab96db68f72bcdf3d`
  was replaced by
  `971520a7f5e1ec5d1dd734d6c73dc38b99b9240cd8b0738abb914b22bf80559d`
  using image
  `sha256:fc8499b1a632adb455b73b86a6d7de89afcf89c950d17b463fd5d406d4a4f60b`.
  Frontend container
  `483b97ed5ef72b3dfd359a9fd918ec97586621a6c207414b8e2bbb82c594e6a9`
  was replaced by
  `9ce1c0c8e7136331b86e2ffe0610c6db63e0ee5f67ed31845900f40ad9612933`
  using image
  `sha256:6fa5aaa8829a70e0fa2836e5985e6284efe2678d3f96794d2db147523e5f2ac7`.
  Nginx `e5b98b53a385aef67465e097753fb54b060596d3c620af3cfb484a175d624be7`
  and PostgreSQL
  `5e36d4dc1a5c3e2fa658382cfc4a8dff7fe3ea2ba1a9834bb89cc83df743f7be`
  were unchanged. All four containers finished healthy with restart count `0`.
- Internal backend health and public HTTPS frontend/API health returned `200`;
  public checks used normal TLS validation with verify result `0`. Unauthorized
  onboarding GET/PATCH/progress/complete requests each returned `401` with
  `no-store`, and no response body was emitted. No authenticated request was
  executed.
- Bounded logs from recreate start contained backend/frontend critical `0` and
  `5xx=0`, nginx critical `0`, and one transitional nginx `502` for
  `GET /api/v1/health` at `2026-08-24T10:29:05Z` while the backend was being
  recreated. The stable window from `2026-08-24T10:29:06Z` passed with
  backend/frontend/nginx critical `0` and `5xx=0`; checkout remained clean and
  exact.
- DB/schema, env/secrets, TLS/nginx config, provider API and production were not
  changed. Deployment status is
  `deployment=applied_with_transient_rollout_502_stable_window_pass_and_authenticated_label_smoke_pending`.
  This append-only closeout itself is docs-only with `deployment=not_needed`.
- Mandatory root gates for this docs-only closeout passed: E2E `99 passed`,
  `1` intentional skip; production build passed with `1623` modules and only
  the existing large-chunk advisory.
- Independent read-only review of the exact one-file closeout diff passed
  acceptance with `P0=0`, `P1=0`; no correction was required.
