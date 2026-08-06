# D2 — proposal хранения reservation и operation

Статус: `contract_approved`; migration 033 — `applied_verified` на Selectel test,
runtime к ней не подключён. Этот документ не разрешает повтор migration, новый
SQL, runtime wiring, provider writes или rollout. D2 остаётся `in_progress`.

Вне scope: payment-поля, match binding/lifecycle D3, webhook implementation,
секреты и реальные ID клиентов.

## 1. Предлагаемые сущности

### `court_reservations`

| Поле | Тип/правило |
|---|---|
| `reservation_id` | UUID PK |
| `owner_account_id` | UUID NOT NULL, FK account; часть ownership binding |
| `status` | `unbooked`, `pending_confirmation`, `confirmed`, `reschedule_pending`, `cancel_pending`, `cancelled`, `rejected`, `unknown` |
| `target_service_id`, `target_resource_id` | positive bigint, YCLIENTS service/resource snapshot |
| start/end datetime + canonical ISO text | ненулевой `[start, end)` interval; typed values совпадают с provider/digest text |
| `yclients_company_id` | positive bigint; tenant scope binding, без hardcode значения |
| `yclients_appointment_id`, `yclients_record_id` | nullable до подтверждения create/reconciliation |
| `yclients_record_hash_ciphertext`, nonce/tag/algorithm, encryption key version, `yclients_record_hash_digest`, digest key version | nullable AEAD binding + keyed lookup digest; raw hash не индексировать и не логировать |
| `yclients_client_id` | nullable до подтверждения provider client contract |
| `version` | positive bigint для optimistic concurrency |
| `created_at`, `updated_at`, `status_changed_at`, `terminal_at` | UTC timestamps; `terminal_at` nullable |

`confirmed` требует appointment/record binding. `cancelled` сохраняет binding для
аудита; физическое удаление reservation при отмене не предлагается.

### `reservation_operations`

| Поле | Тип/правило |
|---|---|
| `operation_id` | UUID PK |
| `reservation_id`, `owner_account_id`, `actor_account_id` | UUID NOT NULL; composite ownership FK к reservation, actor FK к account |
| `operation_type` | `create`, `reschedule`, `cancel` |
| `status` | `pending`, `unknown`, `confirmed`, `rejected`, `reconciled` |
| `idempotency_key` | UUID NOT NULL; уникален только внутри owner scope |
| `request_digest`, `request_digest_version` | lowercase SHA-256 canonical request representation; PII-компонентом служит keyed client snapshot digest |
| `yclients_company_id`, `external_api_id` | positive integers, только server-derived; не принимать из client body |
| target service/resource + start/end datetime/text | immutable operation interval snapshot; nullable только для cancel |
| `provider_appointment_id`, `provider_record_id`, provider record-hash ciphertext/nonce/tag/algorithm/key versions/digest | immutable binding snapshot для reschedule/cancel/reconciliation; nullable для create до provider result |
| `client_snapshot_digest` | keyed canonical digest отдельного encrypted snapshot; raw PII здесь нет |
| `previous_reservation_status` | состояние до start для безопасного reject/reconcile |
| `provider_attempt_started_at`, `provider_attempt_finished_at` | различают timeout до/после начала внешнего write |
| `unknown_at`, `terminal_at`, `reconciled_at` | nullable UTC timestamps |
| `reconciliation_outcome`, `rejection_reason`, `reconciliation_attempts`, `last_reconciliation_at` | безопасные коды/счётчики, без provider body и PII |
| `version`, `created_at`, `updated_at` | optimistic version + UTC timestamps |

Произвольный `request JSON` не хранить: поля внешнего эффекта фиксируются явно.
Canonical request digest покрывает owner/reservation/type, company/apiId, target,
client snapshot digest и provider binding для reschedule/cancel.

`previous_reservation_status` дополнительно связан DB CHECK с type: create —
только `unbooked`/`rejected`, reschedule/cancel — только `confirmed`.

### `reservation_slot_holds`

Единая allocation relation для interval concurrency:

- current reservation hold или `reschedule_target`, связанный FK с конкретной
  reschedule operation;
- company/service/resource и `[starts_at, ends_at)`;
- release/version/timestamps без физического DELETE;
- GiST exclusion запрещает пересечение active intervals разных reservations
  одного company/resource, но разрешает current+target одной reservation.
- INSERT guard сверяет current interval с reservation, target interval — с
  immutable reschedule operation; binding/interval после вставки неизменяемы.

При reschedule старый current hold и новый target hold существуют одновременно.
`unknown`, `cancel_pending` и `reschedule_pending` не освобождают current hold;
unknown reschedule не освобождает также target hold.

### `reservation_operation_client_snapshots`

One-to-one snapshot на operation:

- `operation_id` UUID PK/FK к operation;
- `owner_account_id` для account-scoped доступа;
- content `ciphertext`/nonce/tag/algorithm, keyed-digest/AAD versions;
- отдельный random DEK на snapshot; в БД только wrapped-DEK
  ciphertext/nonce/tag/algorithm/wrapping-key version;
- optimistic version/timestamps и nullable `crypto_destroyed_at`.

Per-snapshot crypto erase удаляет только wrapped DEK и ставит
`crypto_destroyed_at`; trigger запрещает восстановление erased snapshot. Plain
DEK и wrapping key в БД не хранятся.

Raw phone/fullName/email не хранить в operation JSON, обычных колонках или
логах.

### `reservation_admin_read_audit_events`

Отдельный append-only ledger, потому что существующий auth audit привязан к
auth-specific event types/FK и не может быть расширен без изменения existing
table:

- event ID/order/type, `actor_account_id`, фиксированная роль `club_admin`;
- reservation+operation FK, timestamp, fixed non-PII purpose/endpoint codes;
- request/correlation UUID metadata без JSON, PII, ciphertext и ключей;
- application role имеет только INSERT по allowlist колонок; update/delete/
  truncate запрещены ACL и immutable triggers.

## 2. Constraints и indexes

- Composite ownership: UNIQUE `(reservation_id, owner_account_id)` и FK
  operation `(reservation_id, owner_account_id)` на reservation; snapshot
  `(operation_id, owner_account_id)` ссылается на operation с тем же owner.
- UNIQUE `(owner_account_id, idempotency_key)`; same key + same digest возвращает
  прежнюю operation только при совпадении reservation/type и разрешённом actor;
  другой digest или binding даёт conflict без provider call.
- Partial UNIQUE на `reservation_id` для active operation statuses
  `pending`/`unknown`.
- `reservation_slot_holds` имеет one-current-per-reservation,
  one-target-per-reschedule-operation и GiST interval-overlap exclusion.
- State/type CHECK constraints; positive service/resource/api/version; digest
  format/version; ненулевой target interval обязателен для create/reschedule;
  previous status ограничен operation type.
- Все state changes: row lock reservation + version compare/increment. Потерянное
  обновление отклоняется как transaction conflict.
- `unknown`, `cancel_pending`, `reschedule_pending`, `pending_confirmation` и
  `confirmed` считаются удерживающими слот. Освобождение — только допустимой
  terminal transaction; allocation query работает только через active holds.
- Partial UNIQUE provider binding: `(yclients_company_id, yclients_record_id)` и
  `(yclients_company_id, digest_key_version, yclients_record_hash_digest)`;
  appointment ID добавлять после подтверждения его scope. Raw record hash не
  индексировать.
- Admin lookup indexes: PK internal IDs, `(owner_account_id, reservation_id)`,
  `(yclients_company_id, yclients_record_id)`, record hash digest, appointment ID
  и nullable provider client ID, а также `(yclients_company_id, external_api_id)`.
  Доступ к lookup остаётся authorisation/audit gated.
- Уникальность `(yclients_company_id, external_api_id)` для create добавлять
  только после подтверждения семантики YCLIENTS idempotency/search.

### Approved cancellation/refund boundary

Единый контракт для частной брони корта, reservation матча и тренировки:

- customer-facing правило — отмена с возвратом за 24 часа до начала;
- внутренний grace period — refundable, если
  `startsAt - cancellationRequestedAt >= 23h30m`; ровно `23:30:00` считается
  refundable, меньше — late cancellation без refund;
- сравнение выполняется по UTC instants; пользователю время показывается в
  timezone клуба;
- cancellation reservation/provider record и payment refund — разные операции;
  late cancellation всё равно отменяет YCLIENTS record и освобождает корт только
  после canonical YCLIENTS cancel proof, но не запускает automatic refund;
- refund decision и исполнение относятся к D4 Payment Core и не выводятся из
  одного reservation status. D4 обязан хранить policy/version snapshot, чтобы
  изменение правила не меняло старые операции;
- существующие `paymentStatus`, `ownerPaid`, `holdAmount`, `prepay` не меняются.

Текущий checkpoint не добавляет cancellation policy fields, schema change или
payment implementation.

## 3. Privacy и security decision

Варианты:

1. Raw JSON/колонки — не рекомендуется: PII попадает в dump/query tooling.
2. DB-side encryption — допустимо, но повышает риск совместного хранения ключа и
   ciphertext и связывает runtime с DB extension/config.
3. **Рекомендуется для Selectel:** application-layer AEAD encrypted snapshot.
   Random DEK/nonce на snapshot; auth tag и wrapped-DEK ciphertext хранятся в БД.
   Plain DEK, wrapping key и HMAC key находятся вне PostgreSQL в server-side
   secret storage. AAD связывает owner/reservation/operation и request digest.

Для equality/audit использовать отдельный keyed HMAC canonical snapshot, а не
plain SHA PII. Одобренный persistence contract заменяет raw client components в
`request_digest` на `client_snapshot_digest`; конфликтная семантика same-key
сохраняется, offline enumeration phone/email усложняется.

Одобренный access model для decrypted snapshot:

- provider executor при фактическом вызове;
- reconciliation worker, когда подтверждённый контракт требует client data;
- authenticated owner получает полные `fullName`, `phone` и `email` только для
  собственной reservation/operation после backend ownership check;
- authenticated `club_admin` после backend role/permission check получает полные
  `fullName`, `phone` и `email` в административном интерфейсе без маскирования и
  без отдельного ручного reveal шага;
- player и другие пользователи не получают client snapshot чужого owner.

Decrypt выполняется только backend. Каждый успешный admin read атомарно либо
надёжно fail-closed пишет security audit event: actor account ID,
operation/reservation ID, timestamp и purpose/endpoint, без копии PII. Если audit
event не записан, полный snapshot не возвращается.

Logs/errors/traces не содержат PII, ciphertext, record hash, provider response
body, encryption/HMAC keys или ключевые версии вместе с материалом ключа.
Correlation использует internal operation ID/request digest.

Retention, anonymization и delete-account требуют отдельных решений владельца:
срок не предлагается. Нужно выбрать, удалять ли snapshot криптографически,
анонимизировать после terminal/retention event и как обрабатывать активную либо
`unknown` reservation. До решения автоматический срок не кодировать.

## 4. Transaction contract и migration order

### Repository transactions

1. Start: проверить actor/owner, lock reservation row, lookup operation по
   `(owner, key)`, сравнить binding/digest, проверить отсутствие active operation.
2. В одной transaction вставить operation+encrypted snapshot, создать current
   либо reschedule-target hold и изменить reservation status/version. Provider
   call выполняется только после commit, без удержания DB lock.
3. Provider result: отдельная transaction locks reservation+operation. Confirmed
   сохраняет уникальный binding; rejected завершает operation; uncertain write
   атомарно переводит обе записи в `unknown`.
4. Reconciliation допускается только из `unknown`, атомарно записывает outcome,
   timestamps/binding/version. Повтор terminal result — idempotent no-op.
5. Cancel не освобождает слот до confirmed provider cancellation. Unique/binding
   conflict после внешнего успеха остаётся `unknown` для ручного reconcile, а не
   превращается в локальный rejection.
6. Reschedule start сохраняет current hold и добавляет target hold. Confirmed
   transaction заменяет оба на новый current hold; rejected освобождает только
   target; unknown сохраняет оба.

### Zero-downtime migration order

1. Зафиксировать approved поля, privacy/key contract и YCLIENTS assumptions.
2. Migration 033 была отдельно просмотрена, применена и проверена на Selectel
   test. Не повторять её; последующие additive schema changes требуют нового
   proposal, contract tests и явного approval.
3. Expand-only: создать новые таблицы/constraints/indexes без изменения текущих
   tables/endpoints. Existing runtime продолжает работать как раньше.
4. Backfill по умолчанию не нужен: локальной reservation persistence ещё нет.
   Если есть исторические YCLIENTS records, не синтезировать `confirmed`; импорт
   возможен только после verified get/lookup contract и отдельного плана.
5. После verified migration отдельно deploy repository/encryption adapter с
   writes disabled, затем controlled Selectel test enablement и smoke/reconcile.
6. Rollback до writes: убрать новый код, новые пустые tables можно удалить
   отдельной approved migration. После первых writes: rollback только app; данные
   и keys сохраняются, destructive down migration в тот же rollout запрещена.

Migration 033 имеет статус `applied_verified` на Selectel test; runtime остаётся
disconnected. В текущем checkpoint SQL/DB commands не выполняются.

## 5. Approval checklist

Владелец явно одобрил:

- [x] пять сущностей, поля/statuses и composite owner scope;
- [x] one-active-operation и slot-hold status set;
- [x] canonical datetime: `timestamptz` + exact provider text;
- [x] application-layer AEAD, отдельный keyed HMAC, AAD и key rotation/versioning;
- [x] замену raw client fields в request digest на keyed client snapshot digest;
- [x] access model: owner видит свои данные; `club_admin` после backend
  role/permission check видит полный snapshot без masking/reveal; чужой player
  доступа не имеет; каждый admin read создаёт audit event без PII — одобрено
  владельцем;
- [x] не кодировать retention/anonymization/delete-account срок до отдельного
  продуктового решения;
- [x] шифрование YCLIENTS record hash и nullable provider client ID;
- [x] external `apiId` только server-derived; uniqueness — только после provider
  confirmation;
- [x] отсутствие backfill либо отдельный verified historical import;
- [x] migration/rollback order и разрешение подготовить SQL только для review.

Checklist одобрен полностью как persistence/privacy contract. Это не является
разрешением повторить migration, подключить runtime или обновить сервер.

Всё ещё блокируются внешним контрактом YCLIENTS: get/lookup, reschedule, cancel,
provider idempotency/search, timeout reconciliation, webhook verification/dedupe/
order и rate limits. Webhook остаётся выключенным.
