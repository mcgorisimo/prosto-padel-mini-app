# D1 — backend-only inventory и external access gate

Дата проверки: 2026-08-06. Ветка: `codex/week1-backend-only`.
Исходный commit: `f1abe74`.
Статус: `done`. Проверенный checkpoint:
`aa5cd86489f4d8a5cc757990212b3c2ced7630d8`.

Документ фиксирует проверенные по репозиторию факты и подтверждённые владельцем
продукта результаты реального test rollout. Значения секретов не приводятся.
Схема БД не изменялась, новые migration не создавались и не применялись.

## 1. External access gate

| Контур | Проверенный факт | Статус для D1 |
|---|---|---|
| YCLIENTS credentials/company | Company ID `2079564` подтверждён. Partner/User tokens и нужные для availability/preflight/create права проверены в test rollout через server-side secret-файлы; значения токенов не раскрываются и повторно не запрашиваются. | verified for create slice |
| YCLIENTS availability/create | Чтение услуг, кортов, дат и свободных слотов, а также preflight/create проверены на реальном test rollout. Бронь, созданная через Mini App, появилась в YCLIENTS; bearer boundary и write guard проверены. | verified for create slice |
| YCLIENTS resource mapping | Рабочее сопоставление service ↔ court/resource подтверждено test rollout. Числовые resource IDs не переносятся в launch-документы и не являются блокером create slice. | verified for create slice |
| YCLIENTS remaining contracts | В текущем backend нет подтверждённых provider get/lookup, reschedule и cancel; не подтверждены provider idempotency, reconciliation неизвестного исхода, webhook verification и rate limits. | transferred to D2 |
| Payment provider | Provider, sandbox, webhook verification и fiscal policy не зафиксированы; payment/refund/receipt runtime-модуля в backend нет. | transferred to D4 |
| Selectel PostgreSQL | Backend поддерживает `DATABASE_URL` и file-secret resolution, но фактические staging/production resource IDs, private network, pooler/SSL endpoints и доступы не зафиксированы. | transferred to D6 |
| Selectel S3 | Backend поддерживает S3-compatible profile photo storage, но фактические staging/production endpoint/bucket/access не зафиксированы. | transferred to D6 |
| Backend staging E2E | Нет утверждённого backend-only контракта deterministic seed/assert/cleanup. Supabase service-role fixture удалён из runnable test contour; замены для staging пока нет. | transferred to D6 |

YCLIENTS API и booking writes остаются fail-closed по умолчанию; контролируемый
test rollout подтвердил разрешённый create path. Webhook остаётся выключенным.
Детерминированный `api_id` текущего create нельзя считать доказательством
provider idempotency. В рамках этого анализа новые writes не выполнялись.

## 2. Runtime call → backend replacement → test

Статусы:

- `ready` — bearer backend endpoint и контрактные тесты существуют;
- `frontend gap` — replacement существует, но production frontend всё ещё
  выполняет или импортирует legacy-вызов;
- `backend gap` — необходимого backend-контракта нет;
- `external blocked` — реализация зависит от неподтверждённого внешнего контракта.

### Auth и profile

| Legacy runtime call | Backend replacement | Проверка | Статус |
|---|---|---|---|
| `AuthGate`: `auth.getSession`, `onAuthStateChange` | Telegram `initData` → `POST /api/v1/auth/telegram/login`; restore → `POST /api/v1/auth/session/refresh`; principal → `GET /api/v1/auth/session/me` | `telegram-backend-login.spec.js`, `backend-session-lifecycle.spec.js`, backend controller specs | ready: backend profile/session — единственный production TMA gate |
| `AuthGate`: `auth.signOut` и fallback `App.handleLogout` | `POST /api/v1/auth/session/logout` | backend session lifecycle E2E/controller specs | ready: `AuthGate` передаёт только backend logout |
| `AuthGate`: email/password `signUp`, direct `profiles.insert`, `signInWithPassword` | Для TMA account/profile создаются Telegram login workflow. Standalone email/phone auth endpoint отсутствует. | Telegram login backend tests | legacy UI удалён из TMA; standalone/native auth передан D5/mobile |
| `profileApi.getMyProfile` | `GET /api/v1/profile/me` | backend session/profile E2E и controller specs | ready в production gate; legacy helper недостижим |
| `profileApi.updateMyProfile` | `PATCH /api/v1/profile/me` | backend session/profile E2E и controller specs | ready в production gate; legacy helper недостижим |
| `profileApi.getPublicPlayerProfiles` | `GET /api/v1/players/search` для поиска; match/invitation DTO уже содержат публичные projections | backend match lifecycle E2E, public profile controller specs | ready для match/invitation UI; bulk lookup по IDs для training consumers не зафиксирован |
| `profileApi.adminListProfiles` | `GET /api/v1/admin/players` | backend session lifecycle E2E, admin controller specs | ready; legacy helper недостижим |
| `profileApi.adminUpdateProfileSecurity` | `POST /api/v1/admin/players/:playerId/rating-state` | backend session lifecycle E2E, admin controller specs | ready; legacy helper недостижим |

### Matches, chat и rating

| Legacy runtime call | Backend replacement | Проверка | Статус |
|---|---|---|---|
| `matches.select` для feed/mine/detail | `GET /api/v1/matches`, `GET /api/v1/matches/mine`, `GET /api/v1/matches/:matchId` | `backend-match-lifecycle.spec.js`, match controller specs | D1 patch закрыл legacy read в backend mode; legacy branch остаётся в source |
| `matches.insert` | `POST /api/v1/matches` | backend match lifecycle E2E, match controller specs | ready для открытого матча; legacy fallback остаётся |
| `join_match`, `leave_match` RPC | `POST /api/v1/matches/:matchId/join|leave` | backend match lifecycle E2E, controller/service/repository specs | ready, legacy fallback остаётся |
| `matches.update(description)` | `PATCH /api/v1/matches/:matchId` | backend match lifecycle E2E, controller specs | ready |
| `matches.update` для result/confirm/dispute | `POST /api/v1/matches/:matchId/result/submit|confirm|dispute` | backend match lifecycle E2E, result controller/service specs | ready, legacy handlers остаются |
| direct slot/lineup updates | `GET /lineup`, `POST /lineup/assign|release`, join/leave | backend match lifecycle E2E, lineup specs | ready для self-service lineup; arbitrary owner removal не покрыт |
| `remove_match_participant` RPC | Отдельного bearer endpoint не найдено | legacy E2E only | transferred to D3: нужен owner participant removal contract |
| physical delete/cancel match | Отдельного cancel endpoint/state transition не найдено | legacy E2E only | transferred to D3; физическое удаление противоречит target lifecycle |
| private↔public conversion и training fields update | Отдельного backend contract не найдено | legacy E2E only | backend gap; training scope требует отдельного доменного решения |
| `messages.select/insert` | `GET|POST /api/v1/matches/:matchId/messages` | backend match lifecycle E2E, chat controller/service specs | ready, legacy fallback остаётся |
| Realtime channels `matches/messages` | Повторный bearer GET; server push/stream contract отсутствует | backend request tests | D1 patch закрыл matches channel в backend mode; chat background refresh не зафиксирован |

### Invitations, notifications и waitlist

| Legacy runtime call | Backend replacement | Проверка | Статус |
|---|---|---|---|
| incoming/outgoing/create/accept/decline/cancel invitation | `/api/v1/match-invitations*` и `/api/v1/matches/:matchId/invitations*` | backend match lifecycle E2E, invitation controller/service specs | ready, legacy module остаётся в bundle |
| notification feed/count/read | `GET /api/v1/match-notifications`, `POST /:notificationId/read` | backend match lifecycle E2E, notification specs | ready; frontend использует polling |
| waitlist state/join/leave | `GET /api/v1/matches/:matchId/waitlist`, `POST /join|leave` | backend match lifecycle E2E, waitlist specs | ready, legacy module остаётся в bundle |
| Realtime invitation/notification channels | Повторные bearer GET; отдельный client push contract отсутствует | notification polling E2E | frontend gap в legacy mode |

### Private booking / YCLIENTS

| Legacy runtime call | Backend replacement | Проверка | Статус |
|---|---|---|---|
| services/courts/dates/times | bearer `GET /api/v1/bookings/services/...` | `booking-availability-client.spec.js`, booking/YCLIENTS backend specs и реальный test rollout | provider path verified; server-side company/credentials/resource mapping подтверждены |
| `create_booking` RPC | bearer `POST /api/v1/bookings` вызывает YCLIENTS preflight/create | booking client/controller/service specs и реальный test rollout | provider create verified; D2 gap — нет local reservation/operation ledger и match binding |
| get/lookup/reschedule/cancel/reconcile booking | Канонического backend API и repository/state machine нет | отсутствует | transferred to D2: get/lookup, reschedule, cancel, provider idempotency, unknown-outcome reconciliation и webhook contract |

## 3. Production и dependency inventory

| Место | Факт | Требуемое действие |
|---|---|---|
| `package.json`, `package-lock.json` | SDK и transitive packages удалены; `npm ls @supabase/supabase-js --all` пуст; root dependencies lockfile совпадают с `package.json` | verified |
| production bundle | `@supabase/supabase-js` и `VITE_SUPABASE_*` отсутствуют после `npm.cmd run build` | verified |
| `src/components/AuthGate.jsx` | backend Telegram principal и привязанный к нему profile — единственный render gate; email/password legacy UI удалён; synthetic `session.user`/email не создаются | verified backend-only boundary |
| `src/lib/supabaseClient.js` | больше не читает env, не импортирует SDK и не создаёт network client; fail-closed boundary бросает ошибку для недостижимых legacy branches | удалить вместе с каждым legacy consumer после появления отсутствующих backend contracts |
| `src/App.jsx`, `profileApi.js`, `invitationApi.js`, `waitlistApi.js` | legacy branches остаются в source, но недостижимы через production `AuthGate`; backend E2E проверяет bearer paths и отсутствие legacy network calls | удалять по доменам, не подменяя отсутствующие endpoints |
| `infra/test/frontend/Dockerfile`, `infra/test/compose.yaml` | `VITE_SUPABASE_*` build args/validation удалены; backend login включён по умолчанию | verified |
| root `.env` | legacy локальные ключи не используются build/runtime кодом; test rollout использует server-side secret-файлы, а не root `.env` | не копировать секреты в repository/local launch docs |

## 4. E2E inventory

| Test/fixture | Текущая связь | Backend replacement / статус |
|---|---|---|
| `mini-app.spec.js`, `padel-domain.spec.js` | legacy Supabase mock suites удалены из default contour | покрываемые backend-контракты находятся в session/match/booking suites; неперенесённые продуктовые сценарии перечислены как gaps выше |
| `padel-domain.live.spec.js`, `helpers/stagingFixtures.js` | Supabase service-role fixture удалён | transferred to D6: backend-only staging seed/assert/cleanup и live concurrency |
| `telegram-backend-login.spec.js` | backend session открывает App без legacy session; disabled mode fail-closed | ready; backend login default-on |
| `backend-match-lifecycle.spec.js` | bearer contract/UI scenarios; negative legacy network guards и fail-closed branch assertions | ready |
| `backend-session-lifecycle.spec.js` | backend session/profile/admin suite | ready; backend auth default-on |
| `booking-availability-client.spec.js` | same-origin backend contract | ready |
| `scripts/e2e.cjs` | broken Supabase live-defaults path удалён; default запускает только backend-only specs | ready локально; отдельный staging command blocked контрактом fixture |

Backend contract suites уже покрывают session/profile, match lifecycle и
booking client. Они не заменяют отсутствующий staging seed/cleanup contract.
Локальный default contour проверен: 82 passed / 1 skipped; отключённый
backend-login mode и неверное feature setting проверены отдельными focused запусками:
каждый по 1 passed.

### 4.1. Соответствие удалённых сценариев

| Удалённый сценарий | Backend-only проверка | Статус/gap |
|---|---|---|
| authorized Home, вход/регистрация, запуск без Telegram | `telegram-backend-login.spec.js`, `backend-session-lifecycle.spec.js`, Telegram auth/session/profile backend specs | TMA покрыт; standalone email/phone auth не имеет утверждённого bearer-контракта |
| public match create → feed/detail → join/leave → reload | `backend-match-lifecycle.spec.js`: exact create/feed/detail/join/leave contracts, DTO mapping и Home UI; match controller/service/repository/state-machine specs | covered |
| join private match, join вне рейтинга, join без verification | `backend-match-lifecycle.spec.js`: bearer rejection mapping; match controller/repository/state-machine specs | covered без legacy fallback |
| manual organizer add, accept/decline/cancel invitation, reserved slot | `backend-match-lifecycle.spec.js`: player search/invitation contracts и accept UI; invitation repository/service specs | covered для invitation flow; arbitrary owner participant removal остаётся gap без bearer endpoint |
| match chat send/reload/scoping | `backend-match-lifecycle.spec.js`: paginated bearer chat contract и UI draft/send lifecycle; chat service/repository specs | covered |
| waitlist join/leave/FIFO promotion и notification read/open | `backend-match-lifecycle.spec.js`: waitlist/notification contracts и UI polling; waitlist/notification backend specs | covered в текущей automatic FIFO модели |
| profile own read/update, admin list/rating, public player search | `backend-session-lifecycle.spec.js`, `backend-match-lifecycle.spec.js`, profile/admin backend specs | covered; training consumer и standalone registration остаются contract gaps |
| booking availability/create, повторный submit, unknown outcome, смена duration/date | `booking-availability-client.spec.js`, booking controller/service/client specs | covered для существующего create contract; Moscow-midnight UI edges не перенесены как backend contract |
| pricing fallback/snapshot и match cancellation | backend DTO snapshot validation покрыта; канонического reservation/cancel match API нет | gap; не подменять legacy-полями и не реализовывать без утверждённых contracts |
| live composition persistence, concurrent last-slot join, live profile lockdown | Supabase service-role staging suite удалён | blocked до безопасного backend staging seed/assert/cleanup contract; repository lock tests не заменяют live concurrency E2E |

Дополнительный D1 regression подтверждает, что fail-closed legacy boundary
бросает ошибку до любого network request. Неверное значение backend-login
feature setting проверяется отдельным запуском и не открывает приложение.

Production auth review не выявил auth bypass, browser-storage fallback,
synthetic user/session/email или fallback к legacy auth/network. Backend Telegram
session principal и backend-owned profile остаются единственным TMA render gate.

## 5. Schema/contract review freeze

Ни одна из трёх новых migration-групп Дня 1 не одобрена:

1. `court binding/reservations` — create boundary подтверждён, поэтому минимальную
   структуру локального aggregate/operation ledger можно вынести на review.
   Get/lookup, reschedule, cancel, provider idempotency, unknown-outcome
   reconciliation, webhook verification и rate limits остаются за пределами
   подтверждённого контракта.
2. `payments/refunds/webhooks` — provider и fiscal policy не выбраны.
3. `settings/consents/moderation` — product/legal fields и retention contract
   не утверждены.

Существующие migrations `015`–`032` не являются одобрением новой reservation
схемы. Migration status текущего этапа: `structure proposed for review only`;
SQL-файл не создан, применять нечего.

## 6. Предлагаемая структура reservation migration

Только для последующего review, без SQL и без одобрения на применение:

1. `backend_match.court_bindings`: собственный стабильный `id`, provider,
   `company_id`, YCLIENTS `service_id` и `resource_id`, display snapshots,
   признак активности, version/timestamps; уникальность provider mapping.
2. `backend_match.court_reservations`: собственный `reservation_id`, владелец
   (`account_id`), `court_binding_id`, начало/длительность, canonical status из
   `MASTER_PLAN.md`, nullable YCLIENTS `record_id`, защищённый opaque record hash,
   nullable client ID до подтверждённого lookup, version/timestamps. Для
   подтверждённой брони обязательны уникальный `(company_id, record_id)` и
   локальный binding. Связь с match добавляется отдельным D3 review, не этим slice.
3. `backend_match.reservation_operations`: `operation_id`, `reservation_id`,
   actor, immutable `request_key` и SHA-256 request digest, operation type/status,
   deterministic provider correlation ID, attempt/timestamps и безопасный result
   code. Повтор ключа с другим digest отклоняется; `unknown` не разрешает повторный
   provider write без reconciliation.
4. ACL/fingerprints/precheck/postcheck/rollback повторяют fail-closed pattern
   migrations `020` и `032`: app role получает только поколоночные права,
   `DELETE`/`TRUNCATE` отсутствуют. Webhook inbox `032` не подключается и endpoint
   не включается до отдельного verification-контракта.

В структуре нет payment-полей и секретов. Перед созданием любого migration-файла
нужно отдельное явное одобрение пользователя.

## 7. Минимальный первый D2 slice

Следующий безопасный slice — code-only reservation domain, не подключённый к
production controller и не выполняющий YCLIENTS writes:

1. Добавить `backend/src/reservations/reservation.types.ts`,
   `reservation.state-machine.ts`, `reservation.repository.ts` и
   `reservation-provider.ts` с состояниями create: `pending_confirmation`,
   `confirmed`, `rejected`, `unknown`.
2. Добавить `reservation.service.ts` и unit tests с in-memory repository/fake
   provider: same key + same digest возвращает прежний результат; same key +
   different digest отклоняется; timeout/5xx после dispatch фиксирует `unknown`
   и не повторяет write.
3. Не менять `bookings.controller.ts`, `bookings.module.ts`, текущий YCLIENTS
   adapter, frontend или runtime flags. PostgreSQL repository и wiring к
   подтверждённому create добавлять только после review и явного одобрения
   reservation migration.

Для полного D2 после одобрения понадобятся отдельные migration-файлы
`033_backend_reservation_core_{PRECHECK,POSTCHECK,ROLLBACK}.sql`, основной
`033_backend_reservation_core.sql` и README, PostgreSQL repository/module wiring,
а также изменения `bookings.controller.ts` и его tests. Get/admin lookup,
reschedule, cancel, reconciliation worker и webhook wiring не входят в первый
slice: соответствующие provider contracts действительно отсутствуют.

## 8. D1 closure и downstream handoff

Независимый read-only review checkpoint не выявил P0/P1. D1 закрыт: backend
Telegram session/profile — единственный production TMA gate, legacy data facade
fail-closed до сети, Supabase SDK/config/network markers отсутствуют, а критические
удалённые E2E-сценарии имеют backend-contract replacement.

Оставшиеся gaps не являются незавершённой работой D1:

- D2: local reservation binding, get/lookup, unknown outcome, provider/local
  idempotency, reschedule, cancel, reconciliation и webhook contract; сюда же
  переданы точные booking edge cases после утверждения canonical domain.
- D3: cancel match, owner participant removal и связь match ↔ reservation.
- D4: payment provider, pricing/payment snapshot, чеки и возвраты.
- D5/mobile: standalone phone/email auth и verified backend email. До этого
  production booking submit остаётся fail-closed с пустым email; synthetic email
  запрещён.
- D6: backend staging seed/assert/cleanup, live PostgreSQL persistence/security,
  concurrent last-slot join и Selectel production readiness.

Недостижимые legacy source branches удаляются в соответствующих этапах только
после появления bearer-контрактов. Схема не менялась; любая migration по-прежнему
требует отдельного явного одобрения.
