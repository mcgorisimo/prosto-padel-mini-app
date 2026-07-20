# Переносимый контракт бронирования CRM

## Назначение

Контракт изолирует доменную логику тренировок от конкретного поставщика CRM.
Реальная CRM ещё не выбрана, поэтому базовый интерфейс не предполагает
обязательное наличие:

- временной брони;
- отдельного подтверждения;
- provider idempotency;
- поиска по нашему номеру;
- webhook;
- версии записи;
- атомарного переноса.

Контракт предназначен для переносимого TypeScript/Node.js-модуля и стандартного
PostgreSQL. Он не зависит от Supabase Edge Functions, React, Vite или SDK
конкретной CRM.

На текущем этапе контракт применяется только к индивидуальным тренировкам.
Позже его можно использовать для обычных броней и матчей, но их реализация и
широкий рефакторинг текущего бронирования сейчас не входят в scope.

## Архитектурные границы

```text
Training application service
          │ normalized DTO
          ▼
    CrmBookingGateway
          │
          ▼
 Provider-specific adapter
          │ provider API
          ▼
          CRM
```

Приложение знает только нормализованные типы. URL, заголовки, токены, подписи,
нестандартные статусы и особенности API остаются внутри адаптера.

Токены CRM передаются адаптеру серверной конфигурацией или secret provider.
Они никогда не возвращаются из методов, не сохраняются в публичных payload и
не попадают в React/Vite bundle. То же правило действует для Telegram Bot API.

## Базовые типы

Документ фиксирует логический контракт. Конкретные имена файлов и реализация
будут утверждены отдельной задачей.

```ts
export type IsoDateTime = string; // ISO 8601 с timezone offset или Z
export type Money = {
  amountMinor: number;
  currency: string;
};

export type CrmOperationContext = {
  operationId: string;
  ourReservationRef: string;
  requestedAt: IsoDateTime;
  timeoutMs: number;
};

export type CrmProviderCapabilities = {
  supportsTemporaryReservation: boolean;
  requiresSeparateConfirmation: boolean;
  supportsIdempotencyKey: boolean;
  supportsLookupByOurReference: boolean;
  supportsWebhook: boolean;
  supportsRecordVersion: boolean;
  supportsAtomicReschedule: boolean;
};
```

`operationId` уникален для одного логического внешнего эффекта и не меняется
при безопасном retry. `ourReservationRef` — стабильный номер локальной заявки,
который адаптер передаёт CRM только если поставщик предоставляет подходящее
поле.

## Нормализованная бронь

```ts
export type NormalizedReservationStatus =
  | 'held'
  | 'pending_confirmation'
  | 'confirmed'
  | 'reschedule_pending'
  | 'cancel_pending'
  | 'cancelled'
  | 'rejected'
  | 'unknown';

export type CrmReservation = {
  externalId: string;
  ourReservationRef?: string;
  status: NormalizedReservationStatus;
  courtExternalId: string;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  version?: string;
  updatedAt?: IsoDateTime;
  courtPrice?: Money;
};
```

В доменный слой не передаются CRM credentials, внутренние HTTP-заголовки и
полный необработанный объект клиента. Ограниченный технический snapshot можно
хранить отдельно с закрытым доступом только для диагностики.

## Нормализованный результат

```ts
export type CrmSuccess<T> = {
  ok: true;
  value: T;
  providerRequestId?: string;
};

export type CrmErrorCode =
  | 'validation'
  | 'unavailable'
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'rate_limited'
  | 'conflict'
  | 'unsupported'
  | 'temporary_failure'
  | 'unknown_outcome';

export type CrmFailure = {
  ok: false;
  error: {
    code: CrmErrorCode;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    providerRequestId?: string;
    providerCode?: string;
  };
};

export type CrmResult<T> = CrmSuccess<T> | CrmFailure;
```

`unknown_outcome` принципиально отличается от явного отказа. Он означает, что
операция могла завершиться в CRM, но сервер не получил надёжный ответ. В таком
состоянии нельзя немедленно освобождать локальный слот или слепо создавать
бронь повторно.

## Интерфейс

```ts
export interface CrmBookingGateway {
  getCapabilities(): Promise<CrmProviderCapabilities>;

  getAvailability(
    request: GetAvailabilityRequest,
    context: CrmOperationContext,
  ): Promise<CrmResult<GetAvailabilityResponse>>;

  createReservation(
    request: CreateReservationRequest,
    context: CrmOperationContext,
  ): Promise<CrmResult<CreateReservationResponse>>;

  getReservation(
    request: GetReservationRequest,
    context: CrmOperationContext,
  ): Promise<CrmResult<GetReservationResponse>>;

  rescheduleReservation(
    request: RescheduleReservationRequest,
    context: CrmOperationContext,
  ): Promise<CrmResult<RescheduleReservationResponse>>;

  cancelReservation(
    request: CancelReservationRequest,
    context: CrmOperationContext,
  ): Promise<CrmResult<CancelReservationResponse>>;
}
```

Неожиданные исключения транспорта перехватываются на границе адаптера и
преобразуются в `temporary_failure` либо `unknown_outcome`. Доменный слой не
должен разбирать тексты HTTP-ошибок конкретной CRM.

## `getAvailability`

```ts
export type GetAvailabilityRequest = {
  courtExternalIds: string[];
  from: IsoDateTime;
  to: IsoDateTime;
  durationMinutes: 60 | 90;
};

export type AvailabilitySlot = {
  courtExternalId: string;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  available: boolean;
  courtPrice?: Money;
  version?: string;
};

export type GetAvailabilityResponse = {
  slots: AvailabilitySlot[];
  checkedAt: IsoDateTime;
};
```

Доступность информационная и не заменяет серверную локальную защиту от двух
заявок на один слот. Перед созданием CRM может повторно проверить доступность
или вернуть `unavailable`.

Если CRM не предоставляет endpoint доступности, адаптер возвращает
`unsupported`; application service может использовать локальную доступность,
но не должен считать её подтверждением CRM.

## `createReservation`

```ts
export type CreateReservationRequest = {
  courtExternalId: string;
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
  customer: {
    displayName: string;
    phone?: string;
  };
  purpose: 'individual_training';
  reservationMode: 'confirm' | 'hold_if_supported';
};

export type CreateReservationResponse = {
  reservation: CrmReservation;
  confirmed: boolean;
};
```

Для первого клиентского сценария успех разрешён только если:

- есть непустой `externalId`;
- нормализованный статус равен `confirmed`;
- `confirmed = true`;
- ответ сохранён локально.

Если поставщик требует отдельный create + confirm, адаптер выполняет оба
provider-specific шага внутри `createReservation`. Публичный контракт остаётся
единым. Если подтверждение не завершилось, метод не возвращает клиентский успех:
он возвращает `pending_confirmation` или `unknown_outcome` согласно фактам.

Если поставщик поддерживает временную бронь, режим `hold_if_supported` может
вернуть `held`. `held` никогда не считается подтверждённой бронью первого
сценария. Если hold отсутствует, capability имеет значение `false`, а адаптер не
эмулирует гарантию, которой CRM не предоставляет.

## `getReservation`

```ts
export type GetReservationRequest =
  | { externalId: string }
  | { ourReservationRef: string };

export type GetReservationResponse = {
  reservation: CrmReservation;
};
```

Поиск по `ourReservationRef` разрешён только при
`supportsLookupByOurReference = true`. Иначе для восстановления требуется
известный `externalId` либо другой документированный механизм поставщика.

Метод используется:

- после timeout с неизвестным результатом;
- при периодической синхронизации;
- для проверки webhook;
- перед опасным retry create/cancel/reschedule;
- для восстановления внешней брони, ответ которой не был сохранён локально.

`not_found` считается надёжным отсутствием только если адаптер способен
однозначно выполнить запрошенный тип поиска. Иначе нужен `unknown_outcome`.

## `rescheduleReservation`

```ts
export type RescheduleReservationRequest = {
  externalId: string;
  expectedVersion?: string;
  newCourtExternalId: string;
  newStartsAt: IsoDateTime;
  newEndsAt: IsoDateTime;
};

export type RescheduleReservationResponse = {
  reservation: CrmReservation;
  previousReservationStillActive: boolean;
};
```

Если `supportsAtomicReschedule = true`, адаптер использует атомарную операцию
поставщика.

Если атомарного переноса нет, application service не должен предполагать, что
последовательность «отменить старую → создать новую» безопасна. Адаптер обязан
явно вернуть, осталась ли старая бронь активной. До однозначного результата
локальная модель защищает старый слот и показывает «Переносим тренировку».

При version mismatch возвращается `conflict`; автоматическое перетирание более
новой версии CRM запрещено.

## `cancelReservation`

```ts
export type CancelReservationRequest = {
  externalId: string;
  expectedVersion?: string;
  reason: 'customer_request' | 'coach_unavailable' | 'admin_request';
};

export type CancelReservationResponse = {
  reservation: CrmReservation;
  cancelled: boolean;
};
```

Локальный слот освобождается только после `cancelled = true` и сохранения
результата. Timeout после запроса отмены приводит к `unknown_outcome` и
повторной проверке через `getReservation`, а не к немедленному освобождению.

Правило бесплатной отмены/переноса за 24 часа проверяет application service в
часовом поясе клуба до вызова адаптера. CRM может иметь дополнительные
ограничения; её явный отказ нормализуется в `validation`, `conflict` или
`forbidden`.

## Возможности поставщика

| Возможность | Как учитывается |
| --- | --- |
| Временная бронь | `supportsTemporaryReservation`; `held` не равен успеху |
| Отдельное подтверждение | `requiresSeparateConfirmation`; скрыто внутри `createReservation` |
| Защита от повторов | `supportsIdempotencyKey`; адаптер передаёт стабильный `operationId` |
| Поиск по нашему номеру | `supportsLookupByOurReference`; используется для reconciliation |
| Webhook | `supportsWebhook`; события нормализуются отдельной входной границей |
| Версия записи | `supportsRecordVersion`; передаётся как `version/expectedVersion` |
| Атомарный перенос | `supportsAtomicReschedule`; иначе возвращается состояние старой брони |

Capability нельзя вычислять по случайной ошибке во время операции. Адаптер
получает их из проверенной конфигурации и контрактных тестов поставщика.

## Повторы и поставщик без idempotency

Application service всегда создаёт стабильные:

- `clientRequestId` для клиентской заявки;
- `operationId` для конкретного внешнего эффекта;
- `ourReservationRef` для локальной заявки;
- outbox dedupe key.

Если CRM поддерживает idempotency, адаптер передаёт `operationId` штатным
механизмом поставщика.

Если idempotency нет, но есть поиск по нашему номеру, перед повторным create
адаптер или application service сначала выполняет поиск.

Если нет ни idempotency, ни надёжного поиска по нашей ссылке, неоднозначный
timeout нельзя автоматически повторять без риска дубля. Результат остаётся
`unknown_outcome` и требует provider-specific reconciliation или ручной
проверки. Контракт не обещает exactly-once там, где CRM не предоставляет
необходимых возможностей.

## Webhook и polling

Webhook не является обязательной частью базового интерфейса. Если он доступен,
provider adapter дополнительно нормализует подписанное входное событие:

```ts
export type NormalizedCrmEvent = {
  providerEventId: string;
  externalId: string;
  status: NormalizedReservationStatus;
  version?: string;
  occurredAt: IsoDateTime;
  reservation?: CrmReservation;
};
```

Входная серверная граница:

1. проверяет подпись и допустимое время события;
2. сохраняет provider event ID для дедупликации;
3. вызывает тот же нормализованный обработчик, что и polling;
4. не применяет устаревшую версию поверх новой;
5. переводит несовместимые изменения в `conflict`.

Если webhook отсутствует, периодический worker вызывает `getReservation` для
активных, неизвестных и изменяемых броней с backoff и учётом rate limit.

## Независимость от инфраструктуры

CRM gateway и application service являются обычными TypeScript-модулями. Они
получают зависимости через конструктор или factory:

- PostgreSQL repository/transaction manager;
- CRM gateway;
- clock;
- event queue/outbox repository;
- logger;
- secret provider.

Модуль можно запускать в отдельном Node.js-сервисе, serverless function,
контейнере или другой серверной среде. Supabase Edge Functions не являются
обязательной частью архитектуры.

Очередь восстанавливаемых событий хранится в стандартном PostgreSQL. Конкретный
worker может использовать блокировку строк и `SKIP LOCKED`, не привязывая
доменный контракт к Supabase API.

## Контрактные тесты будущего адаптера

Каждый реальный адаптер обязан пройти одинаковый набор тестов:

- подтверждённое создание возвращает внешний ID;
- занятый слот нормализуется как `unavailable`;
- повтор с тем же `operationId` не создаёт доказанный дубль либо возвращает
  `unknown_outcome`, если поставщик этого не гарантирует;
- timeout не преобразуется в явный отказ;
- `getReservation` различает `not_found` и неизвестный результат;
- версия защищает от перезаписи новых данных;
- перенос корректно сообщает судьбу старой брони;
- отмена считается завершённой только после подтверждения CRM;
- provider credentials никогда не попадают в DTO и логи;
- webhook, если заявлен, проверяет подпись и дедуплицируется.

Конкретная CRM и её адаптер будут выбраны и спроектированы отдельной задачей.
