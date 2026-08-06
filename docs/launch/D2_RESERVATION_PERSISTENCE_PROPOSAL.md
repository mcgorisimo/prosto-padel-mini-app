# D2 — proposal хранения reservation и operation

Статус: `proposal_for_explicit_approval`. Это review-only документ: SQL,
schema/runtime, YCLIENTS wiring и реальные provider writes не меняются. D2
остаётся `in_progress`.

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
| `target_datetime`, `target_datetime_text` | `timestamptz` для запросов + проверенная canonical ISO строка для точного provider request/digest |
| `yclients_company_id` | positive bigint; tenant scope binding, без hardcode значения |
| `yclients_appointment_id`, `yclients_record_id` | nullable до подтверждения create/reconciliation |
| `yclients_record_hash_ciphertext`, `yclients_record_hash_encryption_key_version`, `yclients_record_hash_digest`, `yclients_record_hash_digest_key_version` | nullable encrypted opaque binding + keyed lookup digest; raw hash не индексировать и не логировать |
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
| `request_digest`, `request_digest_version` | lowercase SHA-256 canonical request representation; после privacy approval PII-компонентом служит keyed client snapshot digest |
| `yclients_company_id`, `external_api_id` | positive integers, только server-derived; не принимать из client body |
| `target_service_id`, `target_resource_id`, `target_datetime`, `target_datetime_text` | immutable operation snapshot; nullable только для cancel |
| `provider_appointment_id`, `provider_record_id`, `provider_record_hash_ciphertext`, `provider_record_hash_encryption_key_version`, `provider_record_hash_digest`, `provider_record_hash_digest_key_version` | immutable binding snapshot для reschedule/cancel/reconciliation; nullable для create до provider result |
| `client_snapshot_digest` | keyed canonical digest отдельного encrypted snapshot; raw PII здесь нет |
| `previous_reservation_status` | состояние до start для безопасного reject/reconcile |
| `provider_attempt_started_at`, `provider_attempt_finished_at` | различают timeout до/после начала внешнего write |
| `unknown_at`, `terminal_at`, `reconciled_at` | nullable UTC timestamps |
| `reconciliation_outcome`, `rejection_reason`, `reconciliation_attempts`, `last_reconciliation_at` | безопасные коды/счётчики, без provider body и PII |
| `created_at`, `updated_at` | UTC timestamps |

Произвольный `request JSON` не хранить: поля внешнего эффекта фиксируются явно.
Canonical request digest покрывает owner/reservation/type, company/apiId, target,
client snapshot digest и provider binding для reschedule/cancel.

### `reservation_operation_client_snapshots`

One-to-one snapshot на operation:

- `operation_id` UUID PK/FK к operation;
- `owner_account_id` для account-scoped доступа;
- `ciphertext`, `nonce`, `encryption_key_version`, `digest_key_version`,
  `algorithm_version`, `aad_version`;
- `created_at`, nullable `crypto_destroyed_at`.

Raw phone/fullName/email не хранить в operation JSON, обычных колонках или
логах. Exact persistence format требует privacy approval ниже.

## 2. Constraints и indexes

- Composite ownership: UNIQUE `(reservation_id, owner_account_id)` и FK
  operation `(reservation_id, owner_account_id)` на reservation; snapshot
  `(operation_id, owner_account_id)` ссылается на operation с тем же owner.
- UNIQUE `(owner_account_id, idempotency_key)`; same key + same digest возвращает
  прежнюю operation только при совпадении reservation/type и разрешённом actor;
  другой digest или binding даёт conflict без provider call.
- Partial UNIQUE на `reservation_id` для active operation statuses
  `pending`/`unknown`.
- State/type CHECK constraints; positive service/resource/api/version; digest
  format/version; target snapshot обязателен для create/reschedule.
- Все state changes: row lock reservation + version compare/increment. Потерянное
  обновление отклоняется как transaction conflict.
- `unknown`, `cancel_pending`, `reschedule_pending`, `pending_confirmation` и
  `confirmed` считаются удерживающими слот. Освобождение — только `cancelled` или
  окончательный create rejection; это проверяется transition service и
  allocation query, не UI.
- Partial UNIQUE provider binding: `(yclients_company_id, yclients_record_id)` и
  `(yclients_company_id, yclients_record_hash_digest)`; appointment ID добавлять
  после подтверждения его scope. Raw record hash не индексировать.
- Admin lookup indexes: PK internal IDs, `(owner_account_id, reservation_id)`,
  `(yclients_company_id, yclients_record_id)`, record hash digest, appointment ID
  и nullable provider client ID, а также `(yclients_company_id, external_api_id)`.
  Доступ к lookup остаётся authorisation/audit gated.
- Уникальность `(yclients_company_id, external_api_id)` для create добавлять
  только после подтверждения семантики YCLIENTS idempotency/search.

## 3. Privacy и security decision

Варианты:

1. Raw JSON/колонки — не рекомендуется: PII попадает в dump/query tooling.
2. DB-side encryption — допустимо, но повышает риск совместного хранения ключа и
   ciphertext и связывает runtime с DB extension/config.
3. **Рекомендуется для Selectel:** application-layer AEAD encrypted snapshot.
   Random nonce на snapshot; auth tag хранится с ciphertext; `key_version` и
   algorithm version — в БД. Ключи encryption/HMAC находятся вне PostgreSQL в
   server-side secret storage. AAD связывает owner/reservation/operation и
   request digest.

Для equality/audit использовать отдельный keyed HMAC canonical snapshot, а не
plain SHA PII. До persistence wiring нужно отдельно одобрить замену raw client
components в `request_digest` на `client_snapshot_digest`; конфликтная семантика
same-key сохраняется, offline enumeration phone/email усложняется.

Чтение decrypted snapshot разрешено только:

- provider executor при фактическом вызове;
- reconciliation worker, когда подтверждённый контракт требует client data;
- явно авторизованному admin flow со step-up и security audit, если владелец это
  отдельно одобрит. Обычный repository/admin lookup возвращает redacted metadata.

Logs/errors/traces не содержат PII, ciphertext, record hash, provider response
body или ключевые версии вместе с материалом ключа. Correlation использует
internal operation ID/request digest.

Retention, anonymization и delete-account требуют отдельных решений владельца:
срок не предлагается. Нужно выбрать, удалять ли snapshot криптографически,
анонимизировать после terminal/retention event и как обрабатывать активную либо
`unknown` reservation. До решения автоматический срок не кодировать.

## 4. Transaction contract и migration order

### Repository transactions

1. Start: проверить actor/owner, lock reservation row, lookup operation по
   `(owner, key)`, сравнить binding/digest, проверить отсутствие active operation.
2. В одной transaction вставить operation+encrypted snapshot и изменить
   reservation status/version. Provider call выполняется только после commit,
   без удержания DB lock.
3. Provider result: отдельная transaction locks reservation+operation. Confirmed
   сохраняет уникальный binding; rejected завершает operation; uncertain write
   атомарно переводит обе записи в `unknown`.
4. Reconciliation допускается только из `unknown`, атомарно записывает outcome,
   timestamps/binding/version. Повтор terminal result — idempotent no-op.
5. Cancel не освобождает слот до confirmed provider cancellation. Unique/binding
   conflict после внешнего успеха остаётся `unknown` для ручного reconcile, а не
   превращается в локальный rejection.

### Zero-downtime migration order после approval

1. Зафиксировать approved поля, privacy/key contract и YCLIENTS assumptions.
2. Подготовить отдельный SQL diff на review; до второго явного approval не
   применять его.
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

SQL в рамках этого proposal не создаётся.

## 5. Approval checklist

Владелец должен явно одобрить:

- [ ] три сущности, поля/statuses и composite owner scope;
- [ ] one-active-operation и slot-hold status set;
- [ ] canonical datetime: `timestamptz` + exact provider text;
- [ ] application-layer AEAD, отдельный keyed HMAC, AAD и key rotation/versioning;
- [ ] замену raw client fields в request digest на keyed client snapshot digest;
- [ ] кто может decrypt/read и нужен ли audited admin access;
- [ ] retention/anonymization/delete-account policy без предположенного срока;
- [ ] шифрование YCLIENTS record hash и nullable provider client ID;
- [ ] external `apiId` generation/uniqueness scope после provider confirmation;
- [ ] отсутствие backfill либо отдельный verified historical import;
- [ ] migration/rollback order и отдельное разрешение подготовить SQL.

После approval можно сразу подготовить SQL migration на отдельный review,
repository persistence/encryption contract tests и disabled-by-default adapter.

Всё ещё блокируются внешним контрактом YCLIENTS: get/lookup, reschedule, cancel,
provider idempotency/search, timeout reconciliation, webhook verification/dedupe/
order и rate limits. Webhook остаётся выключенным.
