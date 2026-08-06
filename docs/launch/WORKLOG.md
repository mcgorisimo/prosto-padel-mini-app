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
| D2 YCLIENTS reservation core | in_progress | `codex/week1-d2-reservation-core` / `c47c245` + correction + review checkpoints | focused migration contract 7/7 PASS; backend typecheck PASS; предыдущий full gate PASS | persistence/privacy contract одобрен; migration 033 `prepared_for_review`, `not_applied`; wiring/contracts и Selectel test rollout остаются |
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
| D2 YCLIENTS reservation core | Selectel test | — | `pending` | code-only checkpoints ещё не integrated/deployed; среда остаётся на D1 commit |
| D2 persistence/privacy proposal | not applicable | docs-only checkpoint | `not_needed` | только Markdown; runtime, schema, containers и конфигурация не менялись |

Допустимые deployment-статусы: `not_needed`, `pending`, `test_deployed`,
`production_deployed`, `deployment_deferred_by_user`.

## Активные внешние блокеры

Это входы последующих этапов, а не незавершённая работа D1.

1. Для YCLIENTS остаются только get/lookup, reschedule, cancel, provider
   idempotency, unknown-outcome reconciliation, webhook verification и rate limits.
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
