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
| D1 Backend-only/contracts | done | `codex/week1-backend-only` / `aa5cd86489f4d8a5cc757990212b3c2ced7630d8` | frontend E2E PASS (82/1 skipped); focused fail-closed 2/2 PASS; frontend build PASS; backend all PASS | закрыт; downstream gaps назначены D2–D6/mobile |
| D2 YCLIENTS reservation core | pending | — | — | local binding, get/lookup, unknown, idempotency, reschedule/cancel/reconciliation/webhook contract |
| D3 Match ↔ reservation lifecycle | pending | — | — | cancel match, owner participant removal, match ↔ reservation binding |
| D4 Payment Core | pending | — | — | payment provider, pricing/payment snapshot, чеки и возвраты |
| D5 Settings/moderation/compliance | pending | — | — | standalone phone/email auth и verified backend email; затем schema review |
| D6 Selectel readiness/load | pending | — | — | backend staging fixture, live concurrency и Selectel production readiness |
| D7 Release candidate | pending | — | — | после D1–D6 |
| Mobile/store track | pending | — | — | developer account status и native decision |

Статусы: `pending`, `in_progress`, `blocked`, `done`, `reopened`.

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
  незавершённой работой D1.
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
- Следующий конкретный шаг: интегрировать closure commit; затем запускать только
  отдельно утверждённый этап из D2–D6/mobile.

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
```
