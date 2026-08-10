# «Просто Падел» — техническая спецификация и handoff

Актуальность: 10 августа 2026 года.

Исходный Git baseline при создании документа: `main = origin/main = 5e41ab70146a7ae555f6e8935fa426ab110a5c7c`.

Последний принятый runtime на Selectel test: `78a1cef68f74854a9d6e316ffd235ffbd42b38f8`.

Этот документ предназначен для разработчика, который впервые подключается к
проекту. Он описывает фактический код и инфраструктуру, а не только целевую
архитектуру. Операционный статус всегда следует перепроверять в
`docs/launch/WORKLOG.md`, а продуктовые решения — в
`docs/launch/MASTER_PLAN.md`.

## 1. Что это за продукт

«Просто Падел» — клубное приложение для одного падел-клуба. Текущий клиент —
Telegram Mini App (TMA). После стабилизации backend планируются самостоятельные
iOS- и Android-приложения.

Основные пользовательские сценарии:

- вход через Telegram;
- профиль игрока и рейтинг;
- публичная лента матчей;
- создание матча без забронированного корта;
- просмотр матча, вступление, выход, приглашения и лист ожидания;
- чат, расстановка и фиксация результата;
- частная бронь корта через YCLIENTS;
- отображение ручного переноса или удаления брони администратором клуба;
- связь подтверждённой брони корта с матчем.

Целевой первый пилот — 300–400 зарегистрированных пользователей. Это не означает
300–400 одновременных запросов, но проект должен переживать реальные пики без
двойной брони, потери платежа и исчерпания внешних лимитов.

Текущий статус launch-этапов:

| Этап | Статус | Результат |
|---|---|---|
| D1 Backend-only | `done` | Production runtime больше не зависит от Supabase; TMA auth и данные идут через backend |
| D2 YCLIENTS Reservation Core | `done` | Создание, чтение и точный refresh брони; перенос/удаление администратором отражаются в приложении |
| D3 Match ↔ Reservation | `done` | Явная связь матча с подтверждённой бронью и честный статус корта |
| D4 Payment Core | `pending` | Требуется полноценная интеграция ЮKassa, чеки, компенсации и возвраты |
| D5 Settings/compliance | `pending` | Верификация контактов, настройки, удаление аккаунта, moderation/compliance |
| D6 Selectel readiness/load | `pending` | Нагрузочные проверки и production-ready инфраструктура |
| D7 Release candidate | `pending` | Полный сквозной прогон и go/no-go |
| iOS/Android | `pending` | Native-проектов в репозитории пока нет |

Production deployment не выполнен. Сейчас существует только принятый Selectel
test-контур.

## 2. Источники истины

В проекте много исторических документов и legacy-кода. Использовать следующий
порядок доверия:

1. Фактический код и тесты на текущем `main`.
2. `docs/launch/WORKLOG.md` — применённые migration, deployment SHA и живые
   проверки.
3. `docs/launch/MASTER_PLAN.md` — утверждённые продуктовые и архитектурные
   решения.
4. Этот `SPEC.md` — обзор и карта проекта.
5. `TASK.md` — правила о текущем запросе, а не backlog.

`backend/README.md`, `PROJECT_CONTEXT.md`, `QA_CHECKLIST.md`, старые документы
`docs/supabase-*` и migration 000–014 содержат исторический контекст. Часть их
формулировок уже устарела. Например, backend README всё ещё описывает YCLIENTS
как неактивную заготовку, хотя D2 уже работает на Selectel test.

Локально могут присутствовать игнорируемые Git файлы: `.env`, `.env.local`,
`Procfile`, старый Telegram-бот в `src/*.js`, `mini-app/`, `knowledge/` и
сгенерированные каталоги. Они не являются частью репозитория и не должны
использоваться как источник архитектурных решений.

## 3. Архитектура верхнего уровня

```text
Telegram Mini App
        |
        | HTTPS, JSON, Bearer session
        v
Selectel edge / nginx
        |--------------------------|
        v                          v
React/Vite static frontend     NestJS/Fastify backend
                                   |
                    |--------------|--------------|
                    v              v              v
                PostgreSQL      YCLIENTS      Telegram Bot API
                    |
                    v
          S3-compatible photo storage

ЮKassa -> ещё не подключена; D4
```

Frontend никогда не должен обращаться к PostgreSQL или YCLIENTS напрямую.
Внешние токены и ключи принадлежат только backend/runtime.

## 4. Технологический стек

### Frontend

| Область | Технология |
|---|---|
| UI | React 18.3, JavaScript/JSX |
| Сборка | Vite 5.4 |
| Стили | Tailwind CSS 3.4 + большой ручной `src/index.css` |
| Иконки | `lucide-react` |
| Навигация | Собственное состояние экранов/табов; React Router отсутствует |
| Данные | Собственные fetch-клиенты и React state; Redux/Zustand/React Query отсутствуют |
| TMA | Telegram WebApp API и Telegram SecureStorage |
| E2E | Playwright 1.61, WebKit, профиль iPhone 14 |

Frontend написан на JavaScript, не на TypeScript. API-ответы валидируются
вручную в собственных клиентах.

### Backend

| Область | Технология |
|---|---|
| Runtime | Node.js 20.11+ |
| Framework | NestJS 11 |
| HTTP | Fastify 5 через `@nestjs/platform-fastify` |
| Язык | TypeScript 5.9, `strict: true`, target ES2023 |
| Конфигурация | `@nestjs/config` + Joi, fail-closed validation |
| База | PostgreSQL, драйвер `pg`, ручной SQL без ORM |
| Файлы | AWS SDK S3 client + `sharp` для фото профиля |
| Тесты | Jest 30 + ts-jest |

### Инфраструктура

| Область | Реализация |
|---|---|
| Hosting | Selectel test VM; production ещё не подготовлен |
| Контейнеры | Docker Compose |
| Edge | nginx 1.27 alpine |
| Frontend container | multi-stage Node build → nginx static runtime |
| Backend container | multi-stage Node build; runtime запускается от пользователя `node` |
| Test database | PostgreSQL 14 container |
| Секреты | root-owned файлы, bind-mounted read-only в `/run/secrets` |
| Backup tooling | `pg_dump`/`pg_restore`, PRECHECK/POSTCHECK и PowerShell/bash wrappers |

### Внешние системы

- Telegram Mini App и Telegram Bot API.
- YCLIENTS REST API — CRM и источник истины о фактической брони корта.
- Selectel S3-compatible storage — адаптер фото реализован, реальные ресурсы
  и production-настройки не зафиксированы в Git.
- ЮKassa — выбранный платёжный провайдер, но backend-интеграции пока нет.
- Supabase — только legacy-следы в source/docs; SDK и runtime network path
  удалены.

## 5. Структура репозитория

```text
src/                       React/TMA frontend
  components/              экраны и UI-компоненты
  hooks/                   Telegram login и UI hooks
  lib/                     backend API clients, adapters, pricing/domain helpers

backend/
  src/auth/                Telegram login, sessions, profile/admin wiring
  src/matches/             матчи, чат, приглашения, waitlist, lineup, results
  src/bookings/            HTTP и orchestration броней
  src/reservations/        reservation domain/state machines/crypto
  src/integrations/        YCLIENTS, Telegram dispatcher, CRM boundary
  src/database/            pg repositories и transaction adapters
  src/profiles/            обработка/хранение фото
  src/config/              env и file-secret validation
  src/health/              liveness endpoint
  test/                    backend E2E и PostgreSQL auth integration

docs/migrations/           reviewable SQL, PRECHECK, POSTCHECK, rollback, runbooks
docs/launch/               MASTER_PLAN, WORKLOG и D1–D3 contracts
infra/test/                Docker Compose test-контур, nginx, backup/restore tools
tests/e2e/                 frontend Playwright contract/UI tests
scripts/e2e.cjs            владеет локальным Vite process для E2E
```

## 6. Frontend: как всё устроено

Точка входа — `src/main.jsx`. Она показывает `AuthGate`, а поверх него один раз
за сессию отображает splash screen.

`src/components/AuthGate.jsx` требует backend Telegram login. При открытии
обычной страницы вне Telegram пользователь видит честную границу «вход доступен
только внутри Mini App». Production не откатывается к старому email/password или
Supabase auth.

Основной UI и orchestration сосредоточены в `src/App.jsx`:

- `activeTab`, `screen`, выбранный матч и бронь хранятся в React state;
- маршрутизация URL отсутствует;
- данные профиля, матчей, броней и уведомлений загружаются собственными
  callbacks;
- Home объединяет backend-owned матчи и persisted D2 reservations;
- match details периодически обновляют waitlist, lineup и result;
- уведомления polling-ятся каждые 5 секунд;
- при focus/visibilitychange повторно читаются профиль, матчи, брони и
  приглашения.

Ключевые frontend-файлы уже слишком велики:

- `src/lib/backendSessionClient.js` — около 3 485 строк;
- `src/App.jsx` — около 3 277 строк;
- `src/components/MatchDetailsScreen.jsx` — около 3 049 строк;
- `src/hooks/useTelegramBackendLogin.js` — около 2 374 строк;
- `src/components/BookingScreen.jsx` — около 1 391 строки;
- `src/index.css` — около 1 406 строк.

Это главный maintainability-долг frontend. Не следует переписывать `App.jsx`
целиком: выделять по одному домену за изменение с сохранением E2E-контрактов.

### Frontend auth

1. TMA передаёт подписанный Telegram `initData` в
   `POST /api/v1/auth/telegram/login`.
2. Backend проверяет подпись и свежесть, разрешает/создаёт account/profile и
   возвращает opaque session credential.
3. Credential передаётся только как точный `Authorization: Bearer ...`.
4. В TMA credential хранится через Telegram SecureStorage под ключом
   `prosto_padel_backend_session_v1`.
5. При повторном открытии выполняются refresh, `GET /auth/session/me` и загрузка
   backend-owned профиля.
6. Cookie/query-string credential намеренно не принимаются.

### Legacy frontend boundary

`src/lib/supabaseClient.js` — fail-closed заглушка. SDK
`@supabase/supabase-js` отсутствует в dependencies и production bundle. Однако
`App.jsx`, `profileApi.js`, `invitationApi.js`, `waitlistApi.js` и некоторые
компоненты всё ещё содержат недостижимые Supabase-era branches. Это не активная
интеграция, но это технический долг и источник сложности.

Не удалять legacy-ветки массово. Сначала должен существовать и быть покрыт
backend endpoint конкретного домена.

## 7. Backend: модули и подход

Глобальный API prefix — `/api/v1`.

`AppModule` подключает:

- `AppConfigModule`;
- `DatabaseModule`;
- `AuthModule`;
- `AccountsModule`;
- `BookingsModule`;
- `EventsModule`;
- `IntegrationsModule`;
- `HealthModule`.

Фактически `AuthModule` сейчас является большим composition root и кроме auth
подключает profile, matches, invitations, chat, waitlist, notifications, lineup,
results и moderation controllers/services. Это работает, но границы Nest-модулей
слабее доменных границ в исходниках.

Backend придерживается следующего шаблона:

```text
HTTP controller
  -> API/service validation
  -> pure types/state machine
  -> transaction port
  -> Postgres repository
  -> DB constraints / immutable command ledger
```

В чувствительных операциях используются:

- owner/account scope;
- idempotency/request keys и request digest;
- версии записей и optimistic conflict checks;
- PostgreSQL transactions и advisory locks;
- append-only команды/события/audit;
- fail-closed parsing внешних ответов;
- состояние `unknown`, если результат внешнего write нельзя доказать.

`PostgresTransactionRunner` выполняет явные `BEGIN/COMMIT/ROLLBACK`. ORM и
автоматического migration runner нет.

### Основные HTTP endpoints

Auth/profile:

- `POST /api/v1/auth/telegram/login`;
- `POST /api/v1/auth/session/refresh`;
- `POST /api/v1/auth/session/logout`;
- `GET /api/v1/auth/session/me`;
- `GET|PATCH /api/v1/profile/me`;
- `PUT|DELETE /api/v1/profile/me/photo`;
- `GET /api/v1/players/search`;
- admin players/rating endpoints.

Матчи:

- `POST|GET /api/v1/matches`;
- `GET /api/v1/matches/mine`;
- `GET|PATCH /api/v1/matches/:matchId`;
- `POST /api/v1/matches/:matchId/join`;
- `POST /api/v1/matches/:matchId/leave`;
- invitation, chat, waitlist, lineup и result endpoints;
- `POST /api/v1/matches/:matchId/reservation-link`.

Брони:

- `POST|GET /api/v1/bookings`;
- service/court/date/time availability endpoints;
- `GET /api/v1/bookings/requests/:requestKey`;
- `GET /api/v1/bookings/:reservationId`.

В приложении отсутствуют HTTP routes для YCLIENTS PUT/reschedule и
DELETE/cancel. Это утверждённое продуктовое решение, а не случайный пропуск:
перенос и отмену выполняет живой администратор клуба в YCLIENTS.

## 8. Доменная модель и обязательные инварианты

Три состояния независимы друг от друга:

```text
Match <-> MatchReservationLink <-> CourtReservation <-> YCLIENTS record
                                      |
                                      v
                              будущий PaymentOrder
```

Нельзя выводить факт брони или оплаты из одного поля матча.

### Match

Match отвечает за участие игроков, публичность и игровой lifecycle. Дата,
время и выбранный корт могут быть только планом.

`courtBookingStatus` имеет честную проекцию:

- `unbooked` — активной подтверждённой связи нет;
- `confirmed` — есть active link к D2 reservation с полным canonical YCLIENTS
  binding;
- при недоступном/неопределённом refresh последнее подтверждение может быть
  показано как stale, но не должно превращаться в новое доказательство.

`scenario`, `paymentStatus`, `ownerPaid`, `holdAmount`, `prepay`, выбранный court
и redirect браузера не являются доказательством брони или платежа.

### CourtReservation

YCLIENTS — источник истины о существовании и текущих параметрах брони.

- create выполняется server-side;
- blind retry внешнего write запрещён;
- exact GET/read reconciliation подтверждает результат;
- слот освобождается только после canonical proof удаления;
- перенос администратором меняет текущую дату/время/корт и D2 slot hold;
- удаление администратором переводит локальную бронь в cancelled и скрывает её
  из активных карточек;
- webhook выключен, поэтому актуализация происходит bounded read-only refresh;
- private reservations не попадают в публичную ленту матчей.

Клиентский snapshot для YCLIENTS содержит обязательные `fullName`, `phone` и
`email`. Имя и телефон берутся из backend-профиля, email вводится владельцем
брони. Сейчас это declared data, а не verified identity. Snapshot шифруется
AEAD; ключ передаётся backend через secret file.

По решению владельца сам пользователь и авторизованный `club_admin` видят
полные данные snapshot. Доступ администратора должен проверяться backend role и
создавать security audit event без PII.

### Match ↔ Reservation

Migration 034 добавляет:

- историю `match_reservation_links`;
- PII-free lifecycle events;
- per-recipient read state;
- частичные unique constraints: не более одной active reservation на match и
  одного active match на reservation;
- composite ownership constraints;
- deferred guards для атомарного move/cancel projection.

Только `backend_reservation.reservation_slot_holds` является DB-authority по
пересечению занятых кортов. Плановый корт матча не блокирует слот.

### Payment

ЮKassa выбрана, но payment domain/runtime отсутствует. Сейчас:

- `YOOKASSA_COURT_CHECKOUT_ENABLED = false`;
- создание матча без корта доступно;
- «Матч с кортом» и «Забронировать корт» видимы, но fail-closed;
- нажатие не создаёт YCLIENTS reservation;
- legacy payment fields не меняются и не являются источником истины.

Первый MVP: один плательщик — организатор, оплачивается полная стоимость корта.
Split payments отложены.

Утверждённая cancellation policy для будущего D4:

- пользовательское правило — отмена за 24 часа;
- внутренний refundable grace включает интервал до `23:30:00` включительно;
- при разнице меньше `23:30:00` возврата нет;
- сравниваются UTC instants;
- D4 обязан хранить snapshot версии policy и время запроса на отмену;
- фактическая отмена YCLIENTS всё равно выполняется администратором и требует
  canonical proof до освобождения слота/возврата.

## 9. PostgreSQL и migration

Backend-owned схемы:

- `backend_auth` — accounts, profiles, external identities, sessions, auth/OTP
  operations, rating/admin grants, audit, Telegram destinations, photo state;
- `backend_match` — matches, participants, commands, invitations, chat,
  waitlist, lineup, results, notifications, Telegram outbox, webhook signals и
  match-reservation links;
- `backend_reservation` — reservations, operations, slot holds, encrypted
  snapshots и admin-read audit.

Исторические `public.*` таблицы и migration 000–014 относятся к legacy/Supabase
эпохе. Не создавать новые функции в `public` и не возвращать runtime туда.

Migration — обычные reviewed SQL-файлы. Для критических migration обычно есть:

- `<NNN>_*.sql`;
- `_PRECHECK.sql`;
- `_POSTCHECK.sql`;
- `_ROLLBACK.sql`;
- `_README.md`;
- статический contract spec в `backend/src/database`.

Migration нельзя применять автоматически «при старте». Порядок для Selectel:

1. review точного commit и SHA файлов;
2. отдельное разрешение владельца;
3. backup и проверка архива;
4. read-only PRECHECK;
5. один запуск с `ON_ERROR_STOP=1`;
6. read-only POSTCHECK;
7. STOP на любом расхождении;
8. rollback только по отдельному решению и после анализа текущего состояния.

На Selectel test migration 033 и 034 имеют статус `applied_verified`.
Production schema не подготовлена.

Runtime использует DB role `backend_auth_app` с ограниченными grant, а schema
владеет отдельная owner-role. Не запускать приложение от superuser/owner.

## 10. YCLIENTS integration

Реализовано:

- services/courts/dates/times availability;
- preflight и create;
- persisted local reservation и idempotency/operation ledger;
- exact GET и bounded list;
- чтение ручного переноса или удаления;
- четыре проверенных варианта переноса: время; дата; дата+время;
  дата+время+корт;
- encrypted provider/client snapshots;
- conservative rate limiter;
- no blind retries и unknown-outcome recovery.

Ограничения:

- `api_id` не считается гарантированным provider idempotency key;
- frontend не выполняет provider requests;
- app-originated PUT/DELETE отсутствуют;
- webhook route существует, но feature выключена: официальный контракт не даёт
  подпись/shared secret/mTLS или надёжный IP allowlist;
- webhook при включении может быть только сигналом ускорения, canonical state
  всё равно читается authenticated GET;
- лимитер находится в памяти одного backend-процесса, сериализует запросы,
  по умолчанию допускает 60 стартов/минуту и очередь всего из 8 запросов.

Последний пункт особенно важен для 300–400 пользователей: нельзя просто
масштабировать backend в несколько replicas, не пересмотрев глобальный лимит,
кэш availability и координацию запросов к одной YCLIENTS company.

## 11. Telegram notifications

Уведомления используют transactional outbox в PostgreSQL и встроенный в backend
`TelegramNotificationDispatcher`:

- worker стартует вместе с Nest application при включённом feature flag;
- claim имеет visibility lease;
- Telegram retry/backoff ограничен;
- отправленные/заброшенные сообщения фиксируются в outbox;
- недоступный destination может быть отключён.

Сейчас dispatcher живёт в web-процессе. Перед горизонтальным масштабированием
нужно решить, оставлять ли несколько lease-safe pollers или выделить отдельный
worker deployment.

## 12. Конфигурация и секреты

Не помещать секретные значения в Git, документацию, issue, чат или вывод
`docker compose config`.

Основные feature/config keys:

- `DATABASE_ENABLED`, database components/URL;
- `TELEGRAM_AUTH_ENABLED` и Telegram login secrets;
- `TELEGRAM_OUTBOUND_NOTIFICATIONS_ENABLED`;
- `YCLIENTS_API_ENABLED`;
- `YCLIENTS_BOOKING_WRITE_ENABLED`;
- `YCLIENTS_WEBHOOK_ENABLED` — должен оставаться `false` до нового контракта;
- `RESERVATION_SNAPSHOT_MASTER_KEY_BASE64_FILE`;
- `PROFILE_PHOTO_STORAGE_ENABLED` и S3 settings.

В Selectel чувствительные значения передаются через `*_FILE` и read-only bind
mount. Direct value и file value одновременно запрещены. Loader валидирует
формат, затем удаляет secret-source variables из `process.env`.

`.env` и `.env.local` игнорируются Git. Не читать или печатать их без
необходимости. SSH private key/passphrase также никогда не передаются в чат;
используется локальный `ssh-agent`.

## 13. Текущая Selectel test-инфраструктура

Репозиторий содержит test Compose из четырёх runtime services:

- `postgres`;
- `backend`;
- `frontend`;
- `nginx`.

Есть отдельные profile services `db-tools` и `auth-integration-runner`.

Сети разделены на edge, internal и egress. PostgreSQL наружу не публикуется.
Внутренний nginx проксирует `/api/*` в backend и остальное во frontend. SPA
assets immutable, `index.html` no-cache. Есть базовые security headers.

Фактический rollout сейчас ручной:

1. commit интегрируется в `main` и push-ится;
2. сервер выполняет fetch;
3. проверяется точный target SHA и чистый checkout;
4. server checkout переводится в detached HEAD exact commit;
5. пересобираются только затронутые containers;
6. проверяются health/HTTP, бизнес-smoke, restart counts и bounded logs.

TLS/DNS/host provisioning, server compose overlays, registry и секреты не
описаны как полноценный IaC. Production окружение не создано/не зафиксировано.

Backup/restore scripts хорошо защищают test migration cycle, но backup на той же
VM не является disaster recovery. D6 должен доказать внешнюю копию и реальное
восстановление с обновлением endpoint/config.

## 14. Проверки и локальная разработка

Установка frontend:

```powershell
npm.cmd ci
npm.cmd run dev
```

Обязательные frontend gates:

```powershell
npm.cmd run test:e2e
npm.cmd run build
```

`test:e2e` сам запускает и останавливает принадлежащий ему Vite на
`127.0.0.1:5173`. Если порт занят, runner намеренно падает и не использует
чужой localhost. Playwright работает как iPhone 14 WebKit в `ru-RU` и
`Europe/Moscow`.

Backend:

```powershell
cd backend
npm.cmd ci
npm.cmd run typecheck
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd run build
```

Обычный backend может стартовать с `DATABASE_ENABLED=false`, но полноценные
auth/match/booking потоки требуют PostgreSQL и применённую схему.

PostgreSQL auth integration запускается отдельно через защищённый Docker
profile по инструкции `backend/test/auth-integration/README.md` и
`infra/test/README.md`. Никогда не направлять этот runner в production.

Frontend E2E в основном проверяет UI и backend contracts через route mocks. Это
не замена живому Selectel smoke, concurrency test или реальному provider test.

В проекте сейчас нет обязательных scripts для ESLint, Prettier, frontend unit
tests, dependency audit или CI pipeline.

## 15. Технический долг и риски

### P0 — блокирует платный запуск

1. **Payment Core отсутствует.** Нет PaymentOrder/attempt ledger, ЮKassa API,
   webhook inbox, canonical reconciliation, capture/cancel/refund orchestration,
   receipt/VAT snapshot и UI терминальных состояний.
2. **Production инфраструктуры нет.** Есть проверенный Selectel test, но нет
   утверждённого отдельного production environment и production rollout.
3. **Нет полного end-to-end платежного smoke.** Нужна цепочка ЮKassa → YCLIENTS
   create → match link, а также компенсации при timeout/failure.
4. **Store/compliance blockers.** Нет самостоятельного удаления аккаунта,
   завершённого UGC report/block flow, публичных policy/support URLs и
   standalone mobile auth.

### P1 — важно для 300–400 пользователей

1. **Частый frontend polling.** Notifications, waitlist, lineup и result могут
   опрашиваться каждые 5 секунд. Один активный экран создаёт несколько потоков
   запросов. Нужны измерение, backoff/jitter, visibility gate, объединение
   запросов и/или push/event strategy.
2. **YCLIENTS limiter process-local.** Очередь 8 и 1 запрос/сек по умолчанию
   легко насыщается массовым открытием booking screen. Нужны cache/coalescing,
   UX для saturation и стратегия нескольких replicas.
3. **PostgreSQL pool не настроен явно.** Используется `new Pool({connectionString})`
   с default `pg` параметрами. Нет зафиксированных max, idle/connection timeout,
   statement timeout, SSL/pooler contract и бюджета connections.
4. **Health — только liveness.** `/api/v1/health` не проверяет PostgreSQL,
   readiness, migration compatibility, outbox lag или внешние зависимости.
5. **Нагрузочный тест отсутствует.** Есть точечные concurrency tests auth и DB
   constraints, но нет k6/Artillery/autocannon профиля на 300–400 пользователей.
6. **Наблюдаемость минимальна.** Нет метрик, distributed tracing, correlation ID,
   Sentry/OpenTelemetry/Prometheus и формализованных alert thresholds.
7. **Deployment ручной.** Нет CI/CD, protected checks, автоматического image
   registry promotion и IaC. Ошибка оператора остаётся значимым риском.
8. **Generic HTTP rate limiting не видно.** Особенно проверить Telegram login,
   public search, chat/moderation и admin endpoints.

### P1/P2 — продуктовые пробелы

- backend match cancellation отсутствует;
- owner participant removal отсутствует в backend runtime;
- private ↔ public conversion отсутствует;
- training остаётся legacy/frontend-oriented и не имеет полноценного
  backend-owned runtime;
- phone/email verification и standalone auth отсутствуют;
- официальный контакт поддержки клуба отсутствует, поэтому UI показывает
  честный некликабельный текст;
- YCLIENTS webhook намеренно выключен;
- пользователь не может отменить/перенести бронь в приложении — это
  утверждённое решение, не восстанавливать такие кнопки без нового решения.

### P2 — maintainability

- frontend god-components и очень крупные API/auth clients;
- `AuthModule` является composition root почти всего backend;
- крупные raw-SQL repositories трудно ревьюить и профилировать;
- отсутствует OpenAPI/Swagger и сгенерированный typed client;
- отсутствуют lint/format gates;
- production build собирает один крупный JS chunk около 928 kB до gzip и
  предупреждает о необходимости code splitting;
- Vite сообщает об устаревшем CJS Node API в текущем toolchain;
- часть source-комментариев/старых docs имеет mojibake-кодировку;
- unreachable Supabase-era branches увеличивают bundle/source complexity;
- localStorage rating/test seed всё ещё существует рядом с backend truth;
- нет React Router и единой server-state/cache библиотеки;
- текущие manual API schemas дублируются между backend и frontend;
- старые README и PROJECT_CONTEXT расходятся с текущим runtime.

## 16. Что обязательно проверить перед пилотом на 300–400 пользователей

### Capacity

- определить ожидаемые concurrent active users и peak requests/sec;
- снять профиль Home, feed, match details и booking screen;
- измерить количество polling requests на одного активного пользователя;
- настроить DB pool/pooler и доказать отсутствие connection exhaustion;
- проверить last-slot join/waitlist/lineup под конкуренцией;
- проверить overlapping reservation/hold под конкуренцией;
- испытать YCLIENTS saturation, timeout и slow response;
- не выполнять provider blind retry;
- проверить несколько backend replicas или явно зафиксировать single-replica
  capacity/SPOF на первый пилот.

### Reliability

- readiness отдельно от liveness;
- structured logs и request/operation correlation ID;
- метрики HTTP latency/error, DB pool, YCLIENTS queue, outbox lag, payment
  unknown/refund pending;
- alert recipients и runbook;
- off-host backup и restore drill;
- rollback exact image/commit;
- deterministic staging seed/assert/cleanup contract.

### Security/compliance

- generic rate limit и abuse tests;
- CSP/HSTS и реальные outer-proxy headers;
- TLS/SSL и private network для PostgreSQL;
- secret rotation и least-privilege review;
- audit admin PII reads;
- retention/crypto erase policy;
- privacy, terms, cancellation, support и account deletion pages;
- report/block/moderation для UGC;
- dependency/security scan в CI.

## 17. D4: ближайший этап

Следующий разработчик, который начинает платежи, не должен просто открыть
ЮKassa redirect. Нужен полноценный backend-owned payment domain.

Обязательные решения до runtime write:

- sandbox/shop credentials и безопасное хранение;
- какие методы магазина поддерживают `capture=false` и срок hold;
- точная двухстадийная saga: authorize → YCLIENTS create → capture;
- компенсация cancel/refund при YCLIENTS failure/unknown;
- собственный order/operation ledger поверх 24-часового provider
  `Idempotence-Key`;
- webhook inbox: idempotent persistence, затем canonical GET status;
- receipt items, НДС, предмет/способ расчёта и buyer contact;
- full/partial refund contract;
- policy/version snapshot и `cancellationRequestedAt`;
- UI pending/authorized/paid/refund_pending/refunded/failed/unknown;
- reconciliation worker для зависших операций;
- отдельная migration review и отдельное разрешение на применение.

Redirect пользователя или success page никогда не являются доказательством
платежа.

## 18. Mobile/App Store/Google Play

В репозитории нет `ios/`, `android/` или Capacitor config. Текущий продукт — web
TMA.

Предварительно выбран путь React UI + Capacitor shell, но потребуется реальная
native value:

- самостоятельный вход без установленного Telegram;
- secure token storage;
- APNs/FCM push;
- universal/app links;
- native share/calendar;
- корректные offline/loading/error states;
- account deletion;
- UGC report/block/moderation;
- Privacy/Data Safety disclosures;
- store metadata, signing и beta tracks.

Не начинать мобильную обёртку раньше стабилизации D4–D6 API contracts, иначе
придётся поддерживать два нестабильных клиента.

## 19. Правила изменения проекта

- Selectel/PostgreSQL/backend — единственный целевой runtime.
- Не добавлять Supabase dependency, env или network call.
- Не менять `paymentStatus`, `ownerPaid`, `holdAmount`, `prepay` вне отдельно
  утверждённого payment slice.
- Не переписывать `App.jsx` целиком.
- Не менять дизайн без необходимости.
- Не добавлять app-originated YCLIENTS cancel/reschedule.
- Не повторять внешний write вслепую после timeout.
- Не освобождать слот без canonical YCLIENTS cancel proof.
- Не применять SQL без review, backup, PRECHECK и отдельного разрешения.
- Не печатать секреты, `.env`, PII snapshots или SSH private material.
- Делать маленькие изменения и сохранять owner/account scope.
- Для любого runtime изменения обязательны commit → `main` → Selectel test
  rollout → health → business smoke → logs.
- Production deployment выполняется только по прямому отдельному разрешению.

## 20. Definition of Done для изменения

Минимальный handoff должен содержать:

- точный scope и изменённые файлы;
- commit и состояние push/merge;
- frontend E2E/build;
- при backend diff: typecheck/unit/E2E/build;
- migration status: `not_needed`, `prepared_for_review`, `applied_verified` и
  т. п.;
- deployment impact;
- deployed environment и exact commit;
- какие containers изменились;
- HTTP/health, ручной бизнес-smoke и log audit;
- что осталось и какой следующий gate;
- подтверждение, что production не затронут, если его rollout не разрешался.

Git `done` не означает, что тот же commit работает на сервере.

## 21. Быстрый onboarding checklist

1. Прочитать `AGENTS.md`, `TASK.md`, `docs/launch/MASTER_PLAN.md` и последние
   записи `docs/launch/WORKLOG.md`.
2. Проверить `git status`, branch, `main`, `origin/main` и deployed test SHA.
3. Не открывать `.env` и secret-файлы без конкретной необходимости.
4. Выполнить `npm.cmd ci` в root и `backend`.
5. Запустить root E2E/build и backend gates.
6. Для локальной БД использовать только `infra/test` и его runbook.
7. Выбрать один ограниченный vertical slice и отдельную ветку `codex/*`.
8. До изменения payment, migration, provider write или production получить
   явное разрешение владельца.
9. После runtime diff не закрывать этап без Selectel test rollout.

Ключевая идея проекта: интерфейс может показывать только доказанное состояние.
Матч, бронь и платёж — разные сущности; YCLIENTS подтверждает корт, ЮKassa будет
подтверждать деньги, а PostgreSQL хранит локальную связь, историю и возможность
безопасного восстановления.
