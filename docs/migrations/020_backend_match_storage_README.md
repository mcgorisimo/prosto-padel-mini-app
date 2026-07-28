# 020 — приватное backend-хранилище матчей

## Цель

Migration 020 создаёт пустую storage-boundary для первого backend-owned match
aggregate. Это подготовительный шаг перед repository, state machine, Bearer API и
frontend feature flag.

Migration не переносит существующие матчи из Supabase. Сейчас нет доказанного
сопоставления между Supabase `auth.uid()` и
`backend_auth.player_profiles.account_id`; попытка связать записи по совпадающим
UUID, имени, телефону или Telegram username может присвоить матч чужому
backend-аккаунту.

Поэтому после применения:

- существующие Supabase match, invitation, waitlist, notification и chat flows
  продолжают работать как раньше;
- `backend_match` остаётся пустой;
- ни один frontend flow автоматически не переключается;
- dual-write не появляется.

## Создаваемые объекты

Создаётся одна закрытая схема:

`backend_match`

В ней создаются три таблицы.

### `backend_match.matches`

Таблица хранит корень match aggregate:

- backend-generated `id`;
- владельца `owner_account_id`, связанного только с
  `backend_auth.player_profiles(account_id)`;
- Unix epoch seconds для `created_at`, `updated_at`, `starts_at` и
  `terminal_at`;
- длительность только `60`, `90`, `120` или `150` минут;
- immutable court snapshot: `court_id`, `court_name`, `court_type`;
- формат `match/public/community|social` либо
  `private/private/private`;
- ограниченный lifecycle status;
- title/description;
- rating range только для публичного матча;
- `is_rating_match`;
- необязательный положительный `price_per_person_snapshot`;
- monotonic aggregate `version`.

`price_per_person_snapshot` — только снимок отображаемой цены. Migration не
создаёт и не изменяет `paymentStatus`, `ownerPaid`, `holdAmount`, prepay или
другие payment-поля.

Активные интервалы одного `court_id` защищены
`matches_no_active_court_overlap`. Constraint использует установленный
`btree_gist` и не позволяет двум активным public/private aggregates занимать
пересекающееся время. Migration не устанавливает и не перемещает extension.

### `backend_match.match_participants`

Владелец матча является неявным slot 1 и хранится только в `matches`. Таблица
участников содержит slots `2..4`, поэтому owner не дублируется в participant
JSON или массиве идентификаторов.

История выхода сохраняется:

- активный участник имеет `status = active` и `left_at is null`;
- `left`/`removed` требуют terminal `left_at`;
- partial unique indexes допускают только один активный account и один активный
  slot в конкретном матче;
- исторические строки не удаляются.

### `backend_match.match_commands`

Append-only таблица хранит минимальные idempotency bindings:

- backend-generated `command_id`;
- `match_id` и `actor_account_id`;
- последовательный `command_sequence`;
- только SHA-256 `request_digest` длиной 32 байта;
- allowlisted `create_match`, `join_match`, `leave_match`;
- применённый result, aggregate version и необязательный participant binding.

Plaintext credential, Telegram ID, Supabase user ID, request body и secret в
таблице отсутствуют. Повтор по `command_id` должен обрабатываться будущим
repository через сравнение неизменяемых bindings.

## Граница прав

Владелец схемы и таблиц — существующая NOLOGIN-роль
`backend_auth_owner`.

Runtime-роль `backend_auth_app` получает:

- только `USAGE` на схему;
- table-level `SELECT` на три таблицы;
- column-level `INSERT` на allowlisted persistence columns;
- column-level `UPDATE` только на lifecycle columns `matches` и
  `match_participants`.

Runtime-роль не получает schema `CREATE`, table-level `INSERT`/`UPDATE`,
`DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, изменение immutable bindings или
изменение `match_commands`.

Схема не является Supabase Data API schema. Доступы `anon`, `authenticated`,
`service_role` и `PUBLIC` не выдаются. RLS не используется как замена backend
Bearer authorization: таблицы доступны только прямому backend database role, а
HTTP ownership/visibility должен проверять отдельный service/repository slice.

## Инварианты и конкурентность

Database-level ограничения обеспечивают:

- существование backend player owner/participant;
- корректные time, duration, format, rating, price и terminal states;
- отсутствие двух активных участников в одном slot;
- отсутствие двух активных строк одного participant в одном матче;
- отсутствие пересекающихся активных броней одного корта;
- 32-byte request digest;
- согласованность command type/result/participant binding;
- неизменяемый command ledger через отсутствие runtime `UPDATE`/`DELETE`.

Будущий repository всё равно обязан:

1. не принимать доверенные owner/account/version от клиента;
2. получать actor только из Bearer principal;
3. блокировать aggregate в постоянном порядке;
4. читать state, применять state machine и записывать match, participant и
   command в одной короткой transaction;
5. классифицировать exclusion, unique, serialization и connection errors без
   утечки SQL или identifiers;
6. не делать внешние вызовы, пока PostgreSQL row locks удерживаются.

Migration 020 не реализует эту application logic и сама по себе не разрешает
backend rollout.

## Что migration не делает

Migration:

- не читает и не изменяет `public.matches`, `public.profiles`,
  `public.match_invitations`, `public.match_waitlist`, `public.notifications`
  или `public.messages`;
- не выполняет backfill;
- не создаёт identity bridge между Supabase и backend;
- не меняет migrations 015–019;
- не изменяет существующие таблицы, строки, functions, triggers, constraints,
  indexes или ACL;
- не создаёт backend repository, HTTP endpoint, audit taxonomy, frontend client
  или feature flag;
- не переносит invitations, waitlist, notifications, chat, score, training,
  rating calculation или admin operations;
- не применяет SQL автоматически.

## Файлы

- `020_backend_match_storage_PRECHECK.sql` — read-only проверяет PostgreSQL,
  роли, canonical migrations 015/018/019, `btree_gist`, catalog counts,
  fingerprints и отсутствие целевой схемы;
- `020_backend_match_storage.sql` — транзакционно создаёт только схему, три
  пустые таблицы, их constraints/indexes, минимальные ACL и fingerprints;
- `020_backend_match_storage_POSTCHECK.sql` — read-only проверяет точные
  allowlists объектов, колонок, constraints, indexes, ACL, overlap constraint,
  пустоту таблиц и неизменность `backend_auth`;
- `020_backend_match_storage_ROLLBACK.sql` — fail-closed удаляет только пустой
  canonical комплект 020;
- `020_backend_match_storage_README.md` — этот runbook.

## Ручной порядок применения

Команды не выполняются автоматически. Первое применение разрешено только к
test-базе после отдельного одобрения:

1. Создать backup test-базы штатным серверным процессом.
2. Проверить backup и сохранить его идентификатор.
3. Выполнить `020_backend_match_storage_PRECHECK.sql`.
4. Сохранить единственный JSON-результат PRECHECK вне репозитория.
5. Только при полностью зелёном PRECHECK выполнить
   `020_backend_match_storage.sql`.
6. Сразу выполнить `020_backend_match_storage_POSTCHECK.sql`.
7. Сохранить JSON-результат POSTCHECK.
8. Сравнить PRECHECK и POSTCHECK:
   - все `backend_auth_row_counts` совпадают;
   - все `backend_auth_relation_fingerprints` совпадают;
   - `backend_auth_catalog_counts` не изменились;
   - появились только 3 таблицы, 36 constraints и 13 indexes
     `backend_match`;
   - все три `backend_match_row_counts` равны `0`.
9. Проверить PostgreSQL logs на migration errors.
10. Не разворачивать match writer/API/frontend в рамках применения migration.

PRECHECK и POSTCHECK используют read-only transaction и завершаются
`ROLLBACK`. Они не заменяют backup.

## Безопасный rollback

Rollback допустим только до появления первой backend-owned match row:

1. Убедиться, что backend match writer не развёрнут и feature flag отсутствует
   либо выключен.
2. Выполнить POSTCHECK.
3. Выполнить `020_backend_match_storage_ROLLBACK.sql`.
4. Повторить PRECHECK и подтвердить, что `backend_match` отсутствует, а
   `backend_auth` не изменился.

Rollback блокируется, если:

- любая из трёх таблиц содержит хотя бы одну строку;
- owner, schema marker, table fingerprint, число объектов, constraints или
  indexes отличаются;
- появились неожиданные functions или user triggers.

Rollback удаляет таблицы в порядке зависимостей и затем удаляет пустую схему без
`CASCADE`. После появления реальных match data нужен отдельный data-preserving
fail-forward шаг; удалять заполненное backend-хранилище запрещено.

## Следующий отдельный этап

После успешного test-применения migration 020 можно отдельно реализовать:

1. match types/state machine;
2. PostgreSQL repository для create/feed/detail/join/leave;
3. Bearer-protected provider-neutral API;
4. feature flag с default `false`;
5. test rollout и только затем frontend switch.

Invitations, waitlist, notifications, chat, result confirmation, rating
calculation и production rollout остаются отдельными этапами.
