# D2 — YCLIENTS controlled test plan

Статус: **plan only / not approved for execution**. План проверяет оставшиеся
provider write/recovery contracts из `D2_YCLIENTS_CONTRACT_MATRIX.md`. Он не
разрешает YCLIENTS/API/DB/server calls, runtime wiring или deployment.

## 1. Scope и prerequisites

Выполнение возможно только на Selectel test после отдельного approval владельца
для выбранной части плана. Production, webhook, migration 033 и runtime
containers не затрагиваются.

Перед первым provider request исполнитель обязан подтвердить:

1. exact Git commit и чистый checkout approved one-shot runner; runner не
   подключён к application runtime;
2. YCLIENTS company и Partner/User credentials берутся только из существующих
   root-readable server-side secret/config files; значения не печатаются, не
   передаются в argv и не попадают в artifacts;
3. отдельная disposable test identity (`fullName`, phone, email) выбрана из
   server-side secret/config; её PII не выводится в terminal, logs, screenshots,
   responses или WORKLOG;
4. два будущих непересекающихся слота `A` и `B` заранее согласованы как
   disposable: оба свободны, используют допустимые service/resource mappings,
   `A` — исходный ресурс, `B` — целевой cross-resource;
5. для basic run создан новый server-derived `api_id`, ранее не использованный;
6. SMS/email notifications выключены; webhook выключен; никакого клиента клуба
   и существующей записи нельзя использовать;
7. root-only audit directory подготовлен как
   `/root/prosto-padel-yclients-audit/basic-<UTC>-<commit-short>/`, directory mode
   `700`, files mode `600`.

Если любой prerequisite нельзя доказать без раскрытия секрета/PII, запуск
останавливается до provider calls.

## 2. Basic lifecycle — maximum 14 requests

Общий limiter: не чаще **1 provider request/second**. Ровно один request может
быть in flight. Автоматические retries запрещены. Лимит 14 — hard envelope и
для normal path, и для contingency: каждый номер шага выполняется не более
одного раза. Bounded list использует одну страницу (`page=1`, `count=50`) и
узкие date/staff(resource) filters; расширять окно или запрашивать следующую
страницу в этом run нельзя.

| № | Действие | Обязательное evidence/assertion | Stop condition |
|---|---|---|---|
| 1 | Availability read для `A` | `A` присутствует ровно один раз для approved service/resource/date. | Нет/несколько/неожиданный mapping. |
| 2 | Preflight `book_check` для `A` | `bookable`; request projection совпадает с alias `A`. | Любой иной outcome/body. |
| 3 | Availability read для `B` | `B` присутствует ровно один раз на целевом resource. | Нет/несколько/неожиданный mapping. |
| 4 | Preflight `book_check` для `B` | `bookable`; request projection совпадает с alias `B`. | Любой иной outcome/body. |
| 5 | Create ровно одной записи в `A` | `201`; один appointment result; получены positive record ID и opaque hash; callback ID совпал; `api_id` не раскрывается в summary. | Timeout/429/5xx/transport/invalid или ambiguous success body → `C5`; documented no-effect rejection → terminal STOP. |
| 6 | Exact admin `GET record` | Company/record, service/resource, datetime `A`, client identity и `api_id` совпадают in memory; evidence хранит только equality flags; `deleted=false`. | Missing/mismatch/duplicate/invalid body. |
| 7 | Один bounded `GET records` | Normal path: ровно одна строка с созданным record ID и `api_id` в узком окне `A`. `C5`: local candidate match по `api_id` + effect projection без record ID. Pagination не расширяется. | Normal: 0 или >1 match/target вне page 1 → STOP. `C5`: классификация из §2.1. |
| 8 | Admin full-payload cross-resource reschedule в `B` | Один `PUT record`, `save_if_busy=false`. Payload строится из canonical GET + approved config и сохраняет client, full service cost/discount, seance length, notifications-off, attendance и тот же `api_id`; меняются только approved resource/datetime. | Нельзя построить полный payload → STOP до write; timeout/429/5xx/transport/invalid или ambiguous success body → `C8`; documented no-effect rejection → terminal STOP. |
| 9 | Exact admin `GET record` | Normal path: тот же record ID, target service/resource/datetime `B`, client identity и `api_id` совпадают in memory; evidence хранит только equality flags; `deleted=false`; old `A` больше не effect state. `C8`: только классификация effect `A/B/ambiguous`. | Normal mismatch → terminal STOP. `C8` всегда завершается после классификации по §2.1. |
| 10 | Admin cancel | Один `DELETE record`; ожидается documented `204`. | Timeout/429/5xx/transport/invalid или ambiguous response → `C10`; documented no-effect rejection → terminal STOP. |
| 11 | Exact admin `GET record` after cancel | Зафиксировать фактическую семантику: canonical `deleted=true` либо стабильный provider not-found response. Ни один из вариантов сам по себе не освобождает слот: обязателен шаг 12. | Неклассифицируемый read фиксируется как `unknown`; в `C10` всё равно разрешён только шаг 12. |
| 12 | Один bounded list с `with_deleted=1` | Ровно одна canonical deleted row для record ID в узком окне `B`. Только после этого cancel proof PASS. | Нет строки, `deleted!=true` или несколько match. |
| 13 | Отдельный repeat-delete | Только после обычного documented `204` шага 10 и cancel proof шагов 11–12: один второй `DELETE` того же confirmed-deleted record; сохранить только status/error code class, без body/PII. Это test write, а не retry unknown request. | Timeout/429/5xx/transport/invalid или ambiguous response → `C13`. |
| 14 | Финальный bounded list с `with_deleted=1` | Record остаётся единственной deleted row; никаких новых записей/effects. | Любое расхождение. |

Только normal path без uncertain write может получить Basic PASS: шаги 1–12 и
14 должны быть PASS, а шаг 13 — однозначно классифицирован. Repeat-delete может
вернуть success либо стабильный not-found/conflict: оба результата записываются
как observed contract, но не экстраполируются без exact evidence. Любая ветка
`C5/C8/C10/C13` завершает normal lifecycle и Basic PASS не выдаётся.
На normal path ручной read-only YCLIENTS UI checkpoint обязателен после шагов 7,
9, 12 и 14: соответственно запись видна в `A`, перенесена в `B`, удалена и
остаётся удалённой после repeat-delete. На contingency path UI фиксирует только
наблюдаемый результат разрешённого readback и не разрешает новый provider write.

### 2.1. Uncertain-write contingency branches

Uncertain write немедленно запрещает все последующие writes. Разрешены только
следующие заранее пронумерованные read-only requests в оставшемся hard budget:

- `C5` — шаг 6 пропускается, потому что canonical record ID отсутствует. Один
  bounded list шага 7 запрашивает узкое окно `A`, затем локально сравнивает
  `api_id` и effect projection. `0` или `>1` candidates = terminal `unknown`;
  ровно один = terminal `cleanup_required`. Cancel в этом run запрещён без
  нового approval. Maximum branch count: 6 requests.
- `C8` — выполнить только exact GET шага 9 по уже известному record ID и
  классифицировать effect как `A`, `B` или `ambiguous`. Затем шаги 10–14
  пропускаются; holds `A+B` сохраняются независимо от readback. Maximum: 9.
- `C10` — выполнить read-only шаги 11 и 12; шаг 12 выполняется даже при
  inconclusive шаге 11. Canonical deleted proof даёт
  `cancelled_confirmed_after_uncertain_response`, иначе результат `unknown`.
  Шаги 13–14 запрещены: repeat-delete допустим только после обычного documented
  `204` шага 10. Maximum: 12.
- `C13` — выполнить только финальный read-only шаг 14. Новых writes нет;
  неуспешный readback оставляет repeat-delete semantics `unknown`, не отменяя
  уже полученный до шага 13 canonical cancel proof. Maximum: 14.

Readback может закончиться `unknown` из-за недокументированной consistency. Это
безопасный terminal result, а не основание расширять page/window, повторять
read/write или переходить к следующему lifecycle write.

## 3. OPTIONAL high-risk same-`api_id` experiment

Эта часть **не входит** в basic approval и запускается в другой audit directory,
с новым run ID и отдельными свободными слотами `C/D` на одном approved disposable
resource/mapping, чтобы один узкий list охватывал оба времени. Нельзя
переиспользовать `A/B`, basic record или basic `api_id`.

Риск: YCLIENTS не документирует uniqueness/idempotency `api_id`; второй create
может создать вторую реальную запись. Эксперимент допускает максимум две
disposable записи и никогда не выполняется на занятых/клиентских слотах.

Budget: максимум **12 requests**, не чаще 1 request/second:

1. availability + preflight для `C` и `D` — 4 requests;
2. create `C` с новым experiment `api_id` — 1;
3. exact GET возвращённого record — 1;
4. create `D` с тем же `api_id` — ровно 1, без retry;
5. exact GET ID, возвращённого вторым outcome, если он есть — 1;
6. один bounded list для `C/D` и exact local comparison — 1;
7. cleanup cancel каждого однозначно найденного non-deleted record — максимум 2;
8. один final bounded list `with_deleted=1` — 1.

Возможные результаты: `provider_idempotent_same_record`,
`provider_rejected_duplicate`, `provider_created_duplicate` или `unknown`.
На normal path однозначно найденные IDs можно cancel ровно один раз в рамках
заранее одобренного cleanup budget. Если любой optional write uncertain, все
следующие writes пропускаются: после uncertain create допускается только один
уже запланированный bounded `C/D` list; после uncertain cleanup cancel — только
final bounded list, а второй cleanup cancel не выполняется. `0`, `>2` или
неоднозначные candidates остаются `unknown`; guess-based cancel запрещён, а
известные non-deleted records передаются в отдельный cleanup approval.

## 4. Global fail-closed rules

- Ошибка до write или на ordinary read останавливает normal lifecycle. После
  uncertain write normal lifecycle и все следующие writes останавливаются, но
  разрешены exact read-only branches `C5/C8/C10/C13` из §2.1 либо явно
  перечисленный optional readback из §3. Никаких иных requests.
- Timeout, `429`, `5xx`, transport error, invalid/ambiguous write response не
  повторяются и не заменяются другим endpoint. Readback не превращает исходный
  request в retry и выполняется только один раз в пределах исходного budget.
- Candidate count вне contract или исчерпание budget даёт terminal `unknown`.
  Для basic допустим ровно один match; optional допускает только 1–2 exact
  `C/D` matches и не допускает третью запись.
- После uncertain reschedule удерживаются `A` и `B`; после
  `cancel_pending/unknown` слот не считается свободным без canonical deleted
  proof.
- Нельзя расширять list window/page, включать webhook, менять env/runtime,
  применять migration или выполнять DB writes для «диагностики».
- Ручной YCLIENTS UI используется только для read-only проверки. Любой manual
  edit/delete/cleanup требует нового явного approval.

## 5. Evidence и cleanup

На каждом шаге сохраняются только allowlisted projections:

- UTC start/end, run ID, approved commit, step number, request count и duration;
- method + path template, slot alias, status/outcome class;
- provider record/resource/service IDs только в root-only `bindings.json`, без
  client fields и record hash; в WORKLOG используются aliases;
- response projection: record ID, service/resource IDs, datetime, `deleted`,
  `last_change_date`, match counts и in-memory equality flags для external
  reference/client snapshot; raw request/response, Authorization, cookies, PII,
  ordinary PII digests и record hash запрещены;
- manual UI checklist: record alias, expected resource/time/deleted state,
  UTC timestamp и `PASS/STOP`. Скриншот допускается только после crop/redaction,
  исключающих client name/phone/email и другие записи клуба.

Expected artifact layout:

```text
/root/prosto-padel-yclients-audit/<basic-or-optional>-<UTC>-<commit-short>/
  00-context.json
  01-request-budget.log
  steps/NN-<alias>.json
  bindings.json
  ui-verification.md
  summary.json
  checksums.sha256
```

Successful normal basic cleanup = documented `204` шага 10 и шаги 11–12 prove
deleted; repeat-delete не заменяет это доказательство. В `C5` единственный
candidate получает `cleanup_required`; в `C8` удерживаются `A+B`; в `C10` слот
освобождается только при canonical deleted proof, но repeat-delete всё равно
запрещён; `C13` не отменяет уже подтверждённую отмену. Optional normal cleanup =
каждый однозначно найденный record cancelled once и final list proves deleted.
После любого optional uncertain write cleanup writes прекращаются. При
unknown/leftover запись и слоты маркируются `cleanup_required`, владелец получает
aliases + root-only artifact path; автоматический или ручной write без нового
approval запрещён.

## 6. Required approvals

Перед basic lifecycle нужно отдельное решение владельца, явно разрешающее:

- controlled YCLIENTS test writes create → cross-resource full-payload
  reschedule → cancel → repeat-delete на disposable identity/slots;
- Selectel test only, exact approved commit, максимум 14 requests и audit path;
- read-only contingency `C5/C8/C10/C13` внутри тех же 14 requests, запрет
  последующих writes после uncertain outcome;
- риск одной leftover записи/двух held slots при unknown и отдельный cleanup gate.

Рекомендуемая формулировка: `Разрешаю выполнить basic D2 YCLIENTS controlled
lifecycle по утверждённому commit на Selectel test, максимум 14 requests, без
runtime/deploy.`

Optional experiment требует **второго независимого решения**, прямо содержащего
`same-api_id duplicate create`, риск двух записей, отдельные `C/D`, максимум 12
requests и cleanup известных records только на normal path. Uncertain optional
write прекращает cleanup writes и требует нового approval. Basic approval этот
эксперимент не разрешает.

## 7. Read-only P0/P1 plan review

- P0 controls: test-only identity/slots, no webhook/production, no
  secret/PII artifacts, duplicate risk isolated behind separate approval, no
  blind retry or automatic unknown cleanup.
- P1 controls: exact budgets, 1 req/sec serialization,
  `save_if_busy=false`, full effect-bearing reschedule payload, exact GET plus
  bounded list evidence, bounded read-only reconciliation after uncertain write,
  no subsequent writes и canonical cancel proof before slot release.
- Remaining accepted risk: provider behavior can remain `unknown`; the plan
  stops and preserves evidence instead of forcing a terminal answer.
