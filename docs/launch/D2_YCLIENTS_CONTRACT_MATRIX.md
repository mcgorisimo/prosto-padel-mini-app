# D2 — YCLIENTS provider contract matrix

Дата проверки: 2026-08-06. Это read-only checkpoint перед persistence/runtime
wiring. Проверены только repository code/docs и актуальные официальные источники
YCLIENTS; API-вызовы, provider writes, env/secrets, schema и runtime не менялись.

## Baseline и обозначения

Уже подтверждены и повторно не проверялись: company `2079564`, server-side
credentials/права для текущего create slice, service/court/resource mapping,
availability, preflight, `POST book_record` и появление реальной брони в YCLIENTS.
Значения токенов и provider resource IDs не читались и не фиксировались.

- `confirmed` — официальный контракт достаточен для typed code-only реализации;
  live enablement всё равно проходит отдельный controlled test gate.
- `partial` — endpoint/часть shape подтверждены, но безопасная write/recovery
  семантика имеет точный внешний блокер.
- `unknown` — необходимое свойство в официальных источниках не заявлено.

Официальные источники:

- [YCLIENTS REST API](https://developers.yclients.com/ru/) — endpoints, auth,
  request/response schemas и общий лимит;
- [Доступ к API](https://support.yclients.com/67-68-199--dostup-k-api/) — User
  token и права системного пользователя;
- [Webhooks в YCLIENTS](https://support.yclients.com/67-69-993--webhooks-v-yclients/)
  — payload и delivery model.

## Repository inventory

| Контур | Факт | Gap перед wiring |
|---|---|---|
| `yclients-api.client.ts` | Реализованы company/services/resources/dates/times, preflight и create; create передаёт server-derived `api_id`, client snapshot и возвращает appointment/record/hash. `408/425/429/5xx`, transport timeout и невалидный success body дают `unknown_outcome` без retry. | Нет get/list/update/delete/reconciliation methods. |
| `yclients-booking.service.ts` | Preflight выполняется перед единственным create; исключение create становится `unknown_outcome`, повторный write не выполняется. | Нет local operation ledger в текущем runtime path. |
| `reservation-provider.port.ts` | Code-only command содержит operation/reservation/owner, request digest, `apiId`, client snapshot, target и текущий provider binding. Write и reconciliation разделены; unknown нельзя превратить в новый initial write. | Production adapter отсутствует. |
| `yclients.adapter.ts` | Заглушка, `isConfigured() === false`. | Нельзя использовать как provider adapter. |
| Webhook controller/service + migration 032 | Принимают только untrusted `record` signal, отбрасывают `data`, coalesce по company/record и ничего не меняют в reservation. Endpoint выключен. | Нет provider source verification и reconciliation worker; arrival event type нельзя считать текущим состоянием. |

## Contract matrix

| Operation | Endpoint / auth | Request и response IDs | Idempotency / search | Unknown outcome recovery | Rate / webhook notes | Status и exact blocker |
|---|---|---|---|---|---|---|
| Create booking | [`POST /api/v1/book_record/{company_id}`](https://developers.yclients.com/ru/#operation/Создать%20запись%20на%20сеанс); Partner Bearer | Request: `api_id`, per-appointment callback `id`, service, staff/resource, datetime, client. `201`: echoed appointment `id`, `record_id`, `record_hash`. | `api_id` документирован только как внешний ID. Idempotency key/header, uniqueness и duplicate-create result не заявлены. | При timeout `record_id/hash` отсутствуют. Blind create retry запрещён; нужен bounded lookup и однозначное совпадение либо `unknown`. | Общий provider limit действует и на preflight/create. | `confirmed` для уже проверенного create effect; recovery/idempotency — `unknown`: требуется YCLIENTS confirmation или controlled duplicate/timeout test. |
| Exact admin get | [`GET /api/v1/record/{company_id}/{record_id}`](https://developers.yclients.com/ru/#operation/Получить%20запись); Partner Bearer + User token/rights | Path: company + record. `200` data включает record/company/staff/services/client, `datetime`, `deleted`, `api_id`, `last_change_date`. | Точный lookup по provider record ID; не поиск по external reference. | Подходит для readback известного record после uncertain update; несовпадение остаётся `unknown`, write не повторяется. | Read должен использовать общий limiter и PII-safe parser/logging. | `confirmed` для code-only read method. До runtime нужен controlled read-only rights/shape smoke. |
| Online record get | [`GET /api/v1/book_record/{company_id}/{record_id}/{record_hash}`](https://developers.yclients.com/ru/#operation/Получить%20запись%20на%20сеанс); Partner Bearer, User token либо hash по описанию метода | Path: company, record, opaque hash. Response включает record, services/staff, `datetime`, `deleted`, `api_id`, `last_change_date`. | Точный lookup, не external-reference search. Raw hash нельзя логировать/индексировать; persistence 033 хранит только AEAD material + keyed digest. | Может быть fallback точечного readback, но требует decrypt hash на backend. | Не использовать там, где admin get по record ID достаточен. | `confirmed` shape; adapter должен предпочитать admin get и минимизировать decrypt/hash exposure. |
| Bounded record list / lookup candidate | [`GET /api/v1/records/{company_id}`](https://developers.yclients.com/ru/#operation/Получить%20список%20записей); Partner Bearer + User token/rights | Filters: page/count, staff/client, visit/create/change date ranges, `with_deleted`. Rows включают `id`, staff/services/client, `datetime`, `deleted`, `api_id`, `last_change_date`; meta содержит pagination. | Документированного `api_id` filter нет. Возможен только bounded scan с локальным exact compare; uniqueness не заявлена. | Кандидат для create reconciliation: narrow date/staff window + exact external reference/effect digest; 0 или >1 совпадений остаются `unknown`. | Scan обязан быть bounded, paginated и rate-limited. | `partial`: code-only bounded list/parser допустим; provider search/idempotency не подтверждены, controlled visibility/collision test обязателен до create reconciliation enablement. |
| Cross-resource reschedule | [`PUT /api/v1/record/{company_id}/{record_id}`](https://developers.yclients.com/ru/#operation/Изменить%20запись); Partner Bearer + User token/rights | Request допускает staff, services, client, `save_if_busy`, datetime, seance length и `api_id`; documented success `201` returns record data. | Idempotency key, expected version/ETag и conditional update не заявлены. `last_change_date` — response/read field, не precondition. | После timeout exact GET может подтвердить полный intended state; иначе `unknown`. Blind PUT retry запрещён. | `save_if_busy` должен быть false; provider limit общий. | `partial`: текущий domain command не несёт provider service price/seance-length snapshot. Нужны controlled test/YCLIENTS confirmation о full-vs-partial update, сохранении omitted client/service fields и смене staff/resource без потери данных. |
| Same-resource online reschedule | [`PUT /api/v1/book_record/{company_id}/{record_id}`](https://developers.yclients.com/ru/#operation/Перенести%20запись%20на%20сеанс); Partner Bearer | Request документирует только datetime/comment; `200` возвращает record data. | Нет idempotency/version contract. Метод не принимает новый staff/resource/service. | Exact GET readback по record ID/hash; несовпадение остаётся `unknown`. | Availability validation, busy error codes и consistency lag не описаны. | `partial`: shape достаточен только для same-resource time move; не покрывает текущий cross-court domain contract. Нужен controlled test до выбора этого path. |
| Admin cancel | [`DELETE /api/v1/record/{company_id}/{record_id}`](https://developers.yclients.com/ru/#operation/Удалить%20запись); Partner Bearer + User token/rights | Path: company + record; documented success `204 No Content`. | Repeat-delete/idempotent not-found semantics не заявлены. | Документация не гарантирует, что post-delete exact GET возвращает `deleted=true`; list имеет `with_deleted`, но read-after-delete SLA не указан. Слот остаётся held при `cancel_pending/unknown`. | Delete нельзя автоматически повторять после timeout. | `partial`: нужен controlled cancel test на disposable booking для first/repeat delete и canonical deleted readback либо письменное подтверждение YCLIENTS. |
| Hash-based user cancel alternative | [`DELETE /api/v1/user/records/{record_id}/{record_hash}`](https://developers.yclients.com/ru/#operation/Удалить%20запись%20пользователя); Partner Bearer + User token либо hash по описанию | Path: record + opaque hash; documented success `200`. | Repeat-delete и error semantics не заявлены. | Та же неопределённость post-delete readback; дополнительно требуется decrypt record hash. | Не передавать hash клиенту и не логировать. | `partial`; не выбирать вместо admin cancel без controlled rights/behavior comparison. |
| External `api_id` / provider idempotency | Create/record schemas выше | `api_id` передаётся при create/update и возвращается get/list. | Официальные docs не заявляют unique constraint, lookup filter, idempotent replay или conflict semantics. | Может быть только один из атрибутов bounded reconciliation match, не самостоятельное доказательство результата. | Не создавать DB uniqueness claim поверх provider semantics; migration 033 оставляет lookup non-unique. | `unknown`: требуется ответ владельца YCLIENTS/support либо controlled same-`api_id` test. |
| Timeout recovery | Exact get + bounded list выше | Known `record_id` позволяет exact readback; unknown create требует bounded candidates. | Локальная operation idempotency подтверждена, provider idempotency — нет. | Create: no blind retry. Reschedule: exact full-state readback. Cancel: deleted-state proof before slot release. Ambiguous/not visible => terminally not resolved, schedule reconcile with backoff/manual review. | Reads share provider quota; webhook не заменяет polling. | `partial`: reschedule readback реализуем code-only; create/cancel остаются blocked указанными search/delete semantics. |
| Record webhook signal | [Official webhook contract](https://support.yclients.com/67-69-993--webhooks-v-yclients/); provider sends HTTP POST to configured URL | `company_id`, `resource=record`, `resource_id`, `status=create|update|delete`, `data`. Event ID, provider timestamp и sequence/version не документированы. | Consumer idempotency рекомендована, но stable delivery ID отсутствует. Current inbox coalesces only a reconciliation signal; canonical state must come from authenticated GET. | Webhook is acceleration only. Provider sends once, does not retry, stores no delivery result and does not guarantee order/history. | Any HTTP response is considered delivered. Signature, shared secret, signed header, mTLS or official source-IP allowlist не описаны. | Payload/delivery `confirmed`; source verification and exact dedupe `unknown`. P0 gate: keep webhook disabled until YCLIENTS provides an authenticity contract; company ID alone is not authentication. |
| Global rate limit | [YCLIENTS REST API introduction](https://developers.yclients.com/ru/) | Per official portal: 200 requests/minute or 5 requests/second per IP. | Не относится к write idempotency. | Backoff/reconciliation scheduling must stay under both limits; uncertain writes are not retried merely because of 429/timeout. | `Retry-After`, quota headers и narrower per-company/application limits не документированы. | `confirmed` ceiling for adapter limiter; 429 header behavior remains `unknown`, so use conservative configurable throttling and jitter. |

## Implementation gate

Достаточно подтверждено для следующего **code-only, runtime-disabled** adapter
slice:

1. typed exact `GET record` и strict safe-field parser;
2. bounded/paginated `GET records` с date/staff/changed filters, без заявления
   provider lookup-by-`api_id`;
3. shared limiter ниже обоих официальных ceilings;
4. error model `rejected | unauthorized | rate_limited/unavailable | unknown`,
   без provider body/PII в logs/errors;
5. reconciliation orchestration: exact readback для known record, ambiguous scan
   остаётся `unknown`, никакого blind create/update/delete retry.

До write implementation/runtime enablement нужны отдельный controlled test plan
и disposable provider records либо письменный ответ владельца YCLIENTS:

- same `api_id` create: uniqueness, duplicate response и search/read visibility;
- admin reschedule: права, полный/частичный payload, сохранение omitted fields,
  service price/seance length и cross-resource effect;
- cancel: first/repeat response и доказуемый post-delete canonical state;
- webhook: поддерживаемая source verification. При её отсутствии webhook остаётся
  выключенным; polling/reconciliation обязателен.

Repository/provider wiring, controller/module changes и Selectel runtime rollout
до нового review не начинать.
