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
| D3 Match ↔ reservation lifecycle | in_progress | Selectel test runtime `b3c6b7fdc081ff70c2fcec34f4a8882790643015` | migration 034 `applied_verified`; match feed hotfix and truthful booked/unbooked projection live; PayKeeper transition gate root E2E 91/1 skipped and build PASS; Selectel health/assets/logs PASS | owner TMA smoke: paid-court creation remains visible but disabled; existing unbooked match keeps «Забронировать корт», which must fail closed until D4 |
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
| D2 YCLIENTS reservation core | Selectel test | `ac5b4be4e88c6b45ec8d290a1c68e01a41dc635d` | `test_deployed` | backend-only rollout health/log/auth PASS; create/delete and admin-reschedule matrix remain proved; three unchanged owner refreshes preserved reservation version and hold counts |
| D3 Match ↔ reservation lifecycle | Selectel test | `b3c6b7fdc081ff70c2fcec34f4a8882790643015` | `test_deployed` | frontend-only PayKeeper transition gate deployed; all containers healthy/restart 0; HTTPS root/health and exact asset 200; bundle marker and bounded logs PASS; owner TMA transition smoke pending |
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
