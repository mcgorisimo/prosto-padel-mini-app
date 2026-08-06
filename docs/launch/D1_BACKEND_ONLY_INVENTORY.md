# D1 — backend-only inventory и external access gate

Дата проверки: 2026-08-06. Ветка: `codex/week1-backend-only`.
Исходный commit: `f1abe74`.

Документ фиксирует только проверенные по репозиторию факты. Значения секретов
не приводятся. Схема БД не изменялась, новые migration не создавались и не
применялись.

## 1. External access gate

| Контур | Проверенный факт | Статус для D1 |
|---|---|---|
| YCLIENTS credentials | В корневом `.env` ключи `YCLIENTS_COMPANY_ID`, `YCLIENTS_PARTNER_TOKEN` и `YCLIENTS_API_TOKEN` пусты; требуемый backend ключ `YCLIENTS_USER_TOKEN` отсутствует. В `backend/.env` фактической конфигурации нет. | blocked |
| YCLIENTS capabilities | В backend реализованы availability/preflight/create и приём webhook-сигнала. Provider-specific get/reschedule/cancel/idempotency/search/webhook verification contract не зафиксирован. `docs/architecture/crm-booking-contract.md` остаётся переносимым контрактом и прямо не подтверждает YCLIENTS API. | blocked |
| YCLIENTS test data | Test company/branch, service IDs, court/resource IDs и разрешение на безопасные тестовые записи в репозитории не зафиксированы. | blocked |
| Payment provider | Provider, sandbox, webhook verification и fiscal policy не зафиксированы; payment/refund/receipt runtime-модуля в backend нет. | blocked |
| Selectel PostgreSQL | Backend поддерживает `DATABASE_URL` и file-secret resolution, но фактические staging/production resource IDs, private network, pooler/SSL endpoints и доступы не зафиксированы. | blocked |
| Selectel S3 | Backend поддерживает S3-compatible profile photo storage, но фактические staging/production endpoint/bucket/access не зафиксированы. | blocked |
| Backend staging E2E | Нет утверждённого backend-only контракта deterministic seed/assert/cleanup. Supabase service-role fixture удалён из runnable test contour; замены для staging пока нет. | blocked |

Все YCLIENTS write-флаги в backend по умолчанию выключены. До подтверждения
контракта нельзя включать writes, считать create идемпотентным или проектировать
reservation migration.

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
| `AuthGate`: email/password `signUp`, direct `profiles.insert`, `signInWithPassword` | Для TMA account/profile создаются Telegram login workflow. Standalone email/phone auth endpoint отсутствует. | Telegram login backend tests | legacy UI удалён из TMA; standalone/native auth остаётся backend gap отдельного этапа |
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
| `remove_match_participant` RPC | Отдельного bearer endpoint не найдено | legacy E2E only | backend gap |
| physical delete/cancel match | Отдельного cancel endpoint/state transition не найдено | legacy E2E only | backend gap; физическое удаление противоречит target lifecycle |
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
| services/courts/dates/times | bearer `GET /api/v1/bookings/services/...` | `booking-availability-client.spec.js`, booking/YCLIENTS backend specs | ready при валидной server configuration |
| `create_booking` RPC | bearer `POST /api/v1/bookings` вызывает YCLIENTS preflight/create | booking client/controller/service specs | external blocked: возвращается только YCLIENTS `recordId`, нет local reservation/match binding |
| get/reschedule/cancel/reconcile booking | Канонического backend API и repository/state machine нет | отсутствует | external blocked; отложено `TASK.md` до точного YCLIENTS contract |

## 3. Production и dependency inventory

| Место | Факт | Требуемое действие |
|---|---|---|
| `package.json`, `package-lock.json` | SDK и transitive packages удалены; `npm ls @supabase/supabase-js --all` пуст; root dependencies lockfile совпадают с `package.json` | verified |
| production bundle | `@supabase/supabase-js` и `VITE_SUPABASE_*` отсутствуют после `npm.cmd run build` | verified |
| `src/components/AuthGate.jsx` | backend Telegram principal и привязанный к нему profile — единственный render gate; email/password legacy UI удалён; synthetic `session.user`/email не создаются | verified backend-only boundary |
| `src/lib/supabaseClient.js` | больше не читает env, не импортирует SDK и не создаёт network client; fail-closed boundary бросает ошибку для недостижимых legacy branches | удалить вместе с каждым legacy consumer после появления отсутствующих backend contracts |
| `src/App.jsx`, `profileApi.js`, `invitationApi.js`, `waitlistApi.js` | legacy branches остаются в source, но недостижимы через production `AuthGate`; backend E2E проверяет bearer paths и отсутствие legacy network calls | удалять по доменам, не подменяя отсутствующие endpoints |
| `infra/test/frontend/Dockerfile`, `infra/test/compose.yaml` | `VITE_SUPABASE_*` build args/validation удалены; backend login включён по умолчанию | verified |
| root `.env` | legacy локальные ключи не используются build/runtime кодом; YCLIENTS значения пусты | не редактировать локальный secret-файл автоматически |

## 4. E2E inventory

| Test/fixture | Текущая связь | Backend replacement / статус |
|---|---|---|
| `mini-app.spec.js`, `padel-domain.spec.js` | legacy Supabase mock suites удалены из default contour | покрываемые backend-контракты находятся в session/match/booking suites; неперенесённые продуктовые сценарии перечислены как gaps выше |
| `padel-domain.live.spec.js`, `helpers/stagingFixtures.js` | Supabase service-role fixture удалён | blocked до утверждения backend-only staging seed/assert/cleanup contract |
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

Ни одна из трёх новых migration-групп Дня 1 не готова к одобрению:

1. `court binding/reservations` — нет подтверждённых YCLIENTS get/reschedule/
   cancel/idempotency/reconcile contracts и локальной state machine.
2. `payments/refunds/webhooks` — provider и fiscal policy не выбраны.
3. `settings/consents/moderation` — product/legal fields и retention contract
   не утверждены.

Существующие migrations `015`–`032` не являются одобрением новых схем D1.
Migration status текущего этапа: `not proposed`; применять нечего.

## 6. Следующий implementation slice D1

1. Утвердить backend-only staging seed/assert/cleanup contract и вернуть
   отдельный staging E2E без service-role/provider SDK.
2. Удалять недостижимые legacy source branches по одному домену; для cancel
   match, owner participant removal, private↔public и training сначала утвердить
   отсутствующие bearer contracts.
3. Подтвердить YCLIENTS API/test IDs/credentials, payment provider и Selectel
   resources; после этого подготовить migration proposals только на review.
4. До отдельного явного одобрения migration схему не менять.
