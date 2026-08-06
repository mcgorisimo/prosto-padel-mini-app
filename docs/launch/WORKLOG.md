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
| D2 YCLIENTS reservation core | in_progress | D2 branch / matrix `46bc35c7b6be5848bb5556b14eaee6fa33a20c2e` / controlled-plan correction `a08de13c95e7cf67ff272942f484d2e3d3ebd988` / read foundation correction `7fedddd5daf2e817aa977509ab120879915a8f26` + live-contract correction from that exact base | migration 033 applied/verified; backend 113/2971 unit, 2/4 E2E, typecheck/build PASS; root build PASS; root E2E 61 passed / 1 skipped / 21 unrelated `outside_telegram` failures | review live-contract correction checkpoint; basic и optional provider tests требуют два отдельных approval; runtime wiring не начат |
| D3 Match ↔ reservation lifecycle | pending | — | — | cancel match, owner participant removal, match ↔ reservation binding |
| D4 Payment Core | pending | — | — | payment provider, pricing/payment snapshot, чеки и возвраты |
| D5 Settings/moderation/compliance | pending | — | — | standalone phone/email auth и verified backend email; затем schema review |
| D6 Selectel readiness/load | pending | — | — | backend staging fixture, live concurrency и Selectel production readiness |
| D7 Release candidate | pending | — | — | после D1–D6 |
| Mobile/store track | pending | — | — | developer account status и native decision |

Статусы: `pending`, `in_progress`, `blocked`, `done`, `reopened`.

## Deployment status

| Этап | Среда | Целевой commit | Статус | Проверка |
|---|---|---|---|---|
| D1 Backend-only/contracts | Selectel test | `c04074459948d0bf545e865b885aea7a4e5fec3c` | `test_deployed` | frontend healthy; HTTPS root/health и новый asset 200; TMA auth/profile/feed/details/booking availability PASS; bundle/log audit PASS |
| D2 YCLIENTS reservation core | Selectel test | correction `7c31d29b639d6b29016d2378ccc7006df6129b52` | `pending` | migration 033 `applied_verified`, tables empty и runtime disconnected; runtime/containers остаются на D1 commit |
| D2 persistence/privacy proposal | not applicable | docs-only checkpoint | `not_needed` | только Markdown; runtime, schema, containers и конфигурация не менялись |
| D2 YCLIENTS contract matrix | not applicable | docs-only checkpoint поверх `3e8739b` | `not_needed` | только Markdown; API/DB/server/runtime не вызывались и не менялись |
| D2 YCLIENTS controlled test plan | not applicable | `040773172a2fa556ffaaf1d12dac540095070976` + docs-only correction from that exact base | `not_needed` | plan only; provider/server/DB/runtime calls и writes не выполнялись |
| D2 YCLIENTS read foundation | not applicable | correction `7fedddd5daf2e817aa977509ab120879915a8f26` + live-contract correction from that exact base | `not_needed` | code не импортирован Nest modules/controllers/runtime; image, config, server и containers не менялись |

Допустимые deployment-статусы: `not_needed`, `pending`, `test_deployed`,
`production_deployed`, `deployment_deferred_by_user`.

## Активные внешние блокеры

Это входы последующих этапов, а не незавершённая работа D1.

1. YCLIENTS official docs подтверждают exact get/list и общий rate ceiling. До
   write wiring остаются controlled/provider confirmations: `api_id`
   uniqueness/search/idempotency, cross-resource reschedule full/partial payload,
   repeat cancel + deleted readback и webhook source verification/event identity.
   Basic lifecycle и optional duplicate-`api_id` experiment требуют отдельных
   явных approvals; ни один пока не разрешён.
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
