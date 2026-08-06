# «Просто Падел» — мастер-план launch candidate

Дата фиксации: 2026-08-06. Рабочая неделя: 2026-08-07 — 2026-08-13.

Этот документ — единый источник целей и архитектурных решений для всех задач
Codex. Текущий фактический статус хранится в `WORKLOG.md`.

## 1. Цель недели

Подготовить проверенный launch candidate для пилота на 300–400
зарегистрированных пользователей:

1. Runtime полностью работает через backend и PostgreSQL в Selectel.
2. Матч, бронь корта и платёж имеют отдельные состояния и явные связи.
3. YCLIENTS является источником истины по доступности и факту брони корта.
4. Оплата, отмена, чек и возврат идемпотентны и восстанавливаются после timeout.
5. Главный пользовательский сценарий проверен E2E и конкурентными тестами.
6. Инфраструктура имеет health/readiness, мониторинг, backup/restore и runbook.
7. Продукт учитывает требования будущих iOS/Android-приложений.

Публикация в App Store и Google Play не входит в гарантируемый семидневный
срок: ревью магазинов и обязательное закрытое тестирование находятся вне
контроля команды. За неделю должны быть готовы архитектура, compliance-функции
и мобильный release plan.

## 2. Зафиксированные решения

- Целевая инфраструктура: только Selectel.
- Целевая БД: PostgreSQL в Selectel; frontend не обращается к БД напрямую.
- Supabase: legacy, подлежит удалению из runtime, auth, E2E и зависимостей.
- YCLIENTS: источник истины для availability/create/get/reschedule/cancel.
- Один матч не равен одной брони. Матч может временно существовать без корта.
- `scenario`, `paymentStatus`, `ownerPaid`, `holdAmount`, `prepay` не являются
  источником истины о реальной брони или платеже.
- Для первого платёжного MVP один плательщик — организатор, полная стоимость
  корта. Split payments отложены.
- Неизвестный результат внешнего write-запроса не считается отказом или
  успехом: состояние `unknown` разрешается reconciliation-процессом.
- Слот освобождается только после подтверждённой отмены YCLIENTS.
- Схема БД меняется только после отдельного просмотра и явного одобрения
  migration пользователем.

## 3. Целевая модель

```text
Account
  ├── ExternalIdentity (telegram / native auth)
  ├── Profile + contacts + consent versions
  └── NotificationPreferences

Match
  ├── Participants / waitlist / chat / invitations
  └── reservation_id ──> CourtReservation ──> YCLIENTS record
                              └── order_id ──> PaymentOrder ──> provider
```

Независимые состояния:

- Match: `draft`, `searching`, `confirmed`, `upcoming`, `completed`, `cancelled`.
- Reservation: `unbooked`, `pending_confirmation`, `confirmed`,
  `reschedule_pending`, `cancel_pending`, `cancelled`, `rejected`, `unknown`.
- Payment: `pending`, `authorized`, `paid`, `cancel_pending`, `cancelled`,
  `refund_pending`, `refunded`, `failed`, `unknown`.

Обязательные связи операции:

- собственные `match_id`, `reservation_id`, `order_id`, `operation_id`;
- ID записи и клиента YCLIENTS;
- ID платежа/возврата провайдера;
- idempotency key и digest неизменяемого запроса;
- snapshot цены, тарифа, чека и правил отмены;
- журнал входящих webhook и административных действий.

## 4. Definition of Done недели

### Deployment gate для каждого этапа

- Изменение runtime/frontend/backend/infra считается завершённым только после
  интеграции в `main`, test rollout точного commit и подтверждённых health,
  бизнес-smoke и проверки логов.
- Git commit/push/merge и deployment — разные обязательные статусы.
- Если deployment не требуется, в WORKLOG фиксируется `not_needed` с причиной.
- Если пользователь явно откладывает rollout, фиксируется
  `deployment_deferred_by_user`; этап не выдаётся за работающий на сервере.
- Production deployment всегда требует отдельной прямой команды владельца.

### Backend-only

- В production bundle нет `@supabase/supabase-js` и `VITE_SUPABASE_*`.
- Все приватные экраны используют bearer-защищённый backend API.
- Все старые Supabase ветки удалены или недостижимы и покрыты backend E2E.
- Auth/session/profile/matches/chat/invitations/waitlist/notifications/bookings
  работают без Supabase.

### Матчи и бронь

- `social` не считается забронированным без подтверждённой reservation.
- Незабронированный матч явно маркирован и может безопасно получить бронь.
- Есть каноническое соответствие app court ↔ YCLIENTS resource/staff/service.
- Реализованы create/get/reschedule/cancel/reconcile и локальный CRM binding.
- Повтор команды с тем же ключом не создаёт вторую бронь.
- Timeout после внешнего write приводит в `unknown`, а не к слепому retry.
- Отмена матча не удаляет данные физически и уведомляет участников.

### Платежи

- Реализованы order, payment, refund, receipt и webhook ledger.
- Повтор webhook/команды безопасен.
- Успех UI показывается только по подтверждённому состоянию backend.
- Полные и частичные возвраты имеют отдельный статус и аудит.
- Тестовая оплата и возврат проходят в sandbox выбранного провайдера.

### Пользователь и store compliance

- Имя, подтверждённый телефон и нужный для чека email доступны backend.
- Хранятся версии согласий с офертой, privacy и правилами отмены.
- Есть настройки уведомлений и видимости.
- Есть удаление аккаунта в приложении и публичная web-страница запроса удаления.
- Для чата/описаний есть report user/content, block user и административная
  обработка жалоб.
- Опубликованы support contact, Privacy Policy, Terms и Cancellation Policy.

### Эксплуатация

- Selectel staging и production разделены.
- PostgreSQL доступен backend через private network и pooler/SSL.
- Секреты не входят в image, git, frontend env или логи.
- Readiness проверяет БД и критические зависимости; liveness остаётся дешёвым.
- Есть rate limits, request/operation correlation IDs, структурные логи и алерты.
- Выполнено тестовое восстановление БД и описан порядок смены endpoint после restore.
- Пройден нагрузочный сценарий: 400 аккаунтов, обычное чтение и как минимум
  10–20 одновременных попыток занять один слот/место без double booking.

## 5. План по дням

### День 1 — backend-only и архитектурный freeze

Результат дня: полный реестр legacy-вызовов и утверждённые контракты данных.

- Зафиксировать YCLIENTS, payment и Selectel credentials/capabilities.
- Сопоставить каждый Supabase runtime-вызов с существующим backend endpoint.
- Реализовать только отсутствующие backend endpoints, необходимые для удаления
  legacy-веток.
- Подготовить три отдельные migration на просмотр:
  court binding/reservations, payments/refunds/webhooks, settings/consents/moderation.
- Перевести E2E fixtures с Supabase на backend staging contract.
- К концу дня получить явное одобрение migration и платёжного порядка действий.

Acceptance:

- существует таблица «runtime call → backend replacement → тест»;
- ни один новый код не зависит от Supabase;
- schema/contract review завершён до применения migration.

### День 2 — YCLIENTS reservation core

Результат дня: backend хранит бронь и умеет восстановить её точный статус.

- Ввести канонический каталог услуг и кортов с YCLIENTS IDs.
- Добавить reservation repository, state machine и operation ledger.
- Реализовать create/get и reconciliation worker.
- Закрыть unknown outcome и повтор запроса с тем же ключом.
- Подключить webhook как сигнал, а не как единственный источник доставки.
- Добавить admin lookup по собственному и YCLIENTS ID.

Acceptance:

- double-submit не создаёт две записи;
- timeout тестируется отдельно до и после отправки провайдеру;
- подтверждённая бронь всегда имеет локальный binding.

### День 3 — матчи, корт, перенос и отмена

Результат дня: продукт больше не показывает ложную гарантию корта.

- Удалить вывод `scenario = booked`.
- Реализовать `searching/unbooked` и действие «забронировать корт».
- После подтверждения YCLIENTS связать match с reservation.
- Добавить reschedule/cancel match/reservation с правами owner/admin.
- Не освобождать слот при `cancel_pending/unknown`.
- Уведомлять участников об окончательном корте, времени, цене и отмене.

Acceptance:

- unbooked-матч никогда не выглядит оплаченным/забронированным;
- booked-матч невозможно получить без CRM confirmation;
- отмена и перенос идемпотентны.

### День 4 — Payment Core

Результат дня: тестовая оплата, отмена и возврат проходят end-to-end.

- Реализовать PaymentOrder, attempts, webhook inbox и refund ledger.
- Использовать idempotency key провайдера и собственный operation ID.
- Выбрать согласованную saga:
  authorization/hold → CRM confirmation → capture, либо
  CRM confirmation → payment deadline → confirmed cancel при неоплате.
- Добавить чековые позиции и контакты покупателя.
- Реализовать компенсации при отказе/unknown любого внешнего сервиса.

Acceptance:

- нет double charge при повторном нажатии/webhook;
- CRM failure не оставляет безымянный платёж;
- возврат виден пользователю и администратору до терминального результата.

### День 5 — профиль, настройки, безопасность и moderation

Результат дня: обязательные данные и store compliance доступны пользователю.

- Backend-owned email/phone verification и CRM client binding.
- Consent ledger и snapshot политики отмены в заказе.
- NotificationPreferences и privacy settings.
- Удаление аккаунта и отзыв активных сессий.
- Report/block/filter для chat и пользовательских описаний.
- Минимальный admin queue жалоб и журнал решений.
- Публичные страницы Privacy/Terms/Cancellation/Support/Delete Account.

Acceptance:

- пользователь может управлять данными и удалить аккаунт без обращения в чат;
- заблокированный пользователь не может продолжать прямое взаимодействие;
- жалоба обрабатывается с аудитом.

### День 6 — Selectel production readiness

Результат дня: воспроизводимый staging deployment и эксплуатационные проверки.

- Managed PostgreSQL, private network, SSL и transaction pooler.
- S3-compatible storage для фото, lifecycle/CORS/public delivery policy.
- Контейнер backend/frontend, secrets files, TLS, DNS и deploy/rollback runbook.
- Liveness/readiness, rate limiting, логирование, метрики и алерты.
- Backup/restore drill: восстановление создаёт новый cluster endpoint, поэтому
  runbook обязан включать обновление DATABASE_URL и проверку приложения.
- Нагрузочные и fault-injection тесты CRM/payment timeout.

Acceptance:

- новый staging разворачивается по инструкции;
- backup реально восстановлен и проверен;
- 400-user profile не создаёт double booking и не исчерпывает DB pool.

### День 7 — release candidate и запрет новых функций

Результат дня: один зафиксированный RC с доказательствами готовности.

- Полный backend typecheck/unit/e2e/build и frontend E2E/build.
- Ручной прогон на реальных мобильных устройствах.
- Прогон: регистрация → матч → присоединение → чат → бронь → оплата →
  отмена → возврат → уведомление.
- Проверка private booking вне публичной ленты.
- Проверка повторных webhook, сетевых timeout и восстановления worker.
- Security/config/secrets review и актуализация runbooks.
- Сформировать go/no-go: P0/P1 дефект блокирует пилот, P2 документируется.

## 6. Что нужно предоставить до конца Дня 1

Без этих данных семидневный срок превращается в best effort:

### YCLIENTS

- production/test company/branch IDs;
- application token, user token и права системного пользователя;
- IDs услуг и ресурсов-кортов;
- подтверждённые create/get/update/delete контракты;
- правила idempotency/search by external reference;
- webhook events, способ проверки источника, IP/rate limits;
- тестовая организация либо разрешение на безопасные тестовые записи.

### Платёжный провайдер

- выбранный провайдер и sandbox/production credentials;
- доступность двухстадийной оплаты по договору;
- webhook URL/secret or verification contract;
- настройки чеков, НДС, предмет/способ расчёта от бухгалтера;
- утверждённые сроки бесплатной отмены, удержания и частичных возвратов.

### Selectel

- проект и роли доступа;
- Managed PostgreSQL staging/production либо разрешение их создать;
- private network, DNS/domain и TLS ownership;
- S3 bucket/keys для фото;
- место хранения секретов и доступ к deployment host/registry;
- получатели эксплуатационных алертов.

### Product/legal/store

- юридическое имя продавца, ИНН/контакты поддержки;
- тексты или ответственное лицо за оферту, privacy и cancellation policy;
- Apple Developer и Google Play Console account type/status;
- bundle ID, Android application ID и право на бренд/логотип;
- минимум 12 Android-тестировщиков, если применяется правило нового personal account.

## 7. App Store и Google Play: учесть сейчас

Текущий репозиторий — web/TMA и не содержит iOS/Android-проекта. Рекомендуемый
путь после стабилизации backend: общий React UI + Capacitor shell, но не пустая
WebView-обёртка. Нативная версия должна иметь самостоятельную ценность:

- независимый от установленного Telegram запуск и auth;
- secure token storage;
- native push notifications;
- universal/app links на матч и бронь;
- native share и добавление матча в календарь;
- корректные offline/error/loading states;
- системные permission prompts только в момент использования.

Auth проектируется через adapters:

- Telegram Mini App: проверенный `initData`;
- standalone mobile: собственный phone/email OTP или иной утверждённый вход;
- Telegram account link используется для уведомлений, но не является
  обязательной зависимостью standalone-приложения;
- если в iOS остаётся сторонний/social login, заранее заложить эквивалентный
  privacy-preserving login согласно актуальному App Review Guideline 4.8.

Store blockers:

- Apple требует app-like функциональность, а не переупакованный сайт
  (Guideline 4.2).
- Chat и описания — UGC: нужны filter/report/block и контакт поддержки
  (Apple 1.2 и Google UGC policy).
- При создании аккаунта Apple и Google требуют путь удаления аккаунта; Google
  дополнительно требует публичную web-ссылку запроса удаления.
- Для App Store нужны Privacy Policy URL и заполненные App Privacy disclosures;
  для Google Play — Data Safety form.
- Аренда корта является физической услугой: разрешён внешний платёжный
  провайдер, Apple IAP/Google Play Billing для неё не используются.
- Для нового personal Google Play account после 2023-11-13 действует закрытый
  тест минимум с 12 участниками, непрерывно opted-in 14 дней, до production access.
- Перед сборкой проверить актуальный required target Android API, signing/AAB,
  iOS certificates/profiles, age rating, screenshots, review account и review notes.

Официальные источники:

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Apple App Privacy: https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/
- Google closed testing: https://support.google.com/googleplay/android-developer/answer/14151465
- Google account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Google UGC moderation: https://support.google.com/googleplay/android-developer/answer/12923286
- Google payments: https://support.google.com/googleplay/android-developer/answer/10281818
- Selectel PostgreSQL: https://docs.selectel.ru/en/managed-databases/postgresql/
- Selectel backups: https://docs.selectel.ru/en/managed-databases/postgresql/backups/

## 8. Организация нескольких задач Codex

Нужны отдельные задачи, но не семь независимых агентов, одновременно меняющих
один монолит. Рекомендуемая схема:

1. Один управляющий чат: план, приоритет, merge order, go/no-go.
2. Отдельный implementation chat на каждый дневной vertical slice.
3. Внутри implementation chat до трёх субагентов только на независимые
   проверки: исследование API, тест-дизайн, code/security review.
4. Один основной агент владеет изменениями этапа и интеграцией.
5. Этапы, затрагивающие `App.jsx`, auth, migrations или одни таблицы, идут
   последовательно. Policy/mobile assets и read-only review могут идти параллельно.
6. Каждый этап работает в `codex/week1-<scope>` и заканчивается тестами,
   записью в `WORKLOG.md`, commit, test rollout при runtime impact и handoff.

Каждый новый чат получает промт из `NEXT_CHAT_PROMPT.md`. Контекст сообщений
не считается источником истины: агент обязан перечитать документы и актуальный код.

## 9. После недельного RC

1. Собрать Capacitor prototype и проверить Guideline 4.2 на реальном UX.
2. Добавить native auth/push/deep links/secure storage/calendar/share.
3. Подготовить TestFlight и Google internal/closed tracks.
4. Провести реальный beta-пилот, устранить crash/ANR/payment/booking дефекты.
5. Завершить store metadata, privacy/data safety, screenshots и review account.
6. Подать iOS и Android; сроки ревью и Google closed-test считаются отдельно.
