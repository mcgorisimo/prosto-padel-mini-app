# 019 — базовое backend-состояние рейтинга игрока

## Продуктовое решение

Migration 019 создаёт новый backend-контур рейтинга с нейтральным начальным
состоянием:

- `rating = 3.00`;
- `is_verified = false`.

Существующие рейтинги и признаки подтверждения из Supabase намеренно не
переносятся. Сейчас отсутствует доказанное соответствие между Supabase
`auth.uid()` и backend `account_id`. Сопоставление по UUID, имени или username
может связать рейтинг с чужим аккаунтом и поэтому запрещено.

До отдельной индивидуальной миграции Supabase остаётся источником рейтинга для
существующего frontend, публичного поиска, матчей и административных экранов.
Появление строки в новой таблице само по себе не переключает источник данных.

## Что создаёт migration 019

Создаётся одна приватная таблица:

`backend_auth.player_rating_states`

Поля:

- `account_id` — primary key и non-deferrable foreign key на
  `backend_auth.player_profiles(account_id)`;
- `rating numeric(4,2) not null default 3.00`;
- `is_verified boolean not null default false`;
- `created_at` и `updated_at` — Unix epoch seconds в границах существующей
  backend-модели.

Рейтинг ограничен диапазоном `0.00..10.00`.

Для каждого уже существующего `backend_auth.player_profiles` migration создаёт
ровно одну строку с нейтральными значениями. `account_id` и timestamps берутся
только из `backend_auth.player_profiles` и `backend_auth.accounts`. Таблицы
Supabase не читаются и не изменяются.

## Граница прав

Владелец таблицы — `backend_auth_owner`.

Роль `backend_auth_app` получает:

- table-level `SELECT`;
- column-level `INSERT` только для `account_id`, `created_at` и `updated_at`.

Приложение не получает `INSERT` или `UPDATE` для `rating` и `is_verified`.
Значения новых строк поэтому формируются только database defaults. Table-level
`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` и `TRIGGER` не выдаются.

Таблица находится в закрытой схеме `backend_auth`. Она не публикуется через
Supabase Data API и не выдаёт доступ ролям `public`, `anon`, `authenticated` или
`service_role`. Будущий HTTP-доступ должен использовать backend Bearer
principal, а не Supabase JWT/RLS.

`is_verified` означает только подтверждение рейтинга игрока. Оно не является
признаком успешной Telegram identity verification.

## Что migration 019 не делает

Migration:

- не читает и не изменяет `public.profiles`;
- не копирует Supabase rating или verification;
- не сопоставляет Supabase user ID и backend account ID;
- не изменяет существующие таблицы, строки, constraints, indexes или triggers;
- не добавляет backend reader/writer, HTTP endpoint или audit event;
- не меняет frontend и отображаемый пользователю рейтинг;
- не переключает публичный поиск, приглашения, матчи или `AdminPlayersScreen`;
- не добавляет расчёт рейтинга или клиентские rating deltas;
- не изменяет migrations 015–018.

## Файлы

- `019_backend_auth_player_rating_state_PRECHECK.sql` — read-only проверяет
  PostgreSQL, роли, закрытую схему, canonical migrations 015/018, catalog counts
  и отсутствие целевой таблицы;
- `019_backend_auth_player_rating_state.sql` — создаёт одну таблицу, минимальные
  ACL и нейтральные строки для существующих backend player profiles;
- `019_backend_auth_player_rating_state_POSTCHECK.sql` — read-only проверяет
  точные колонки, defaults, constraints, indexes, ACL, fingerprint и все
  нейтральные строки;
- `019_backend_auth_player_rating_state_ROLLBACK.sql` — удаляет таблицу только
  пока в ней находится полный набор воспроизводимых нейтральных строк;
- `019_backend_auth_player_rating_state_README.md` — этот runbook.

## Ручной порядок применения

Команды не выполняются автоматически. Первое применение разрешается только к
test-базе после отдельного одобрения:

1. Сделать и проверить backup test-базы штатным серверным процессом.
2. Выполнить
   `019_backend_auth_player_rating_state_PRECHECK.sql`.
3. Сохранить единственный JSON-результат PRECHECK вне репозитория.
4. При полностью зелёном PRECHECK выполнить
   `019_backend_auth_player_rating_state.sql`.
5. Сразу выполнить
   `019_backend_auth_player_rating_state_POSTCHECK.sql`.
6. Сравнить PRECHECK и POSTCHECK:
   - row counts всех существующих таблиц должны совпасть;
   - fingerprints всех существующих таблиц должны совпасть;
   - ожидаемое изменение catalog counts — одна таблица и четыре constraints;
   - количество `player_rating_states` должно совпасть с количеством
     `player_profiles`;
   - каждая строка должна иметь `3.00`, `false` и timestamps соответствующего
     backend account.
7. Проверить PostgreSQL logs на ошибки.
8. Не разворачивать backend rating reader/writer и не переключать frontend в
   рамках применения этой migration.

PRECHECK и POSTCHECK используют read-only transaction и завершаются
`ROLLBACK`. Они не заменяют backup.

## Безопасный rollback

Rollback допустим до появления backend rating writer:

1. Убедиться, что POSTCHECK проходит.
2. Убедиться, что никакой backend rollout не использует новую таблицу.
3. Выполнить `019_backend_auth_player_rating_state_ROLLBACK.sql`.
4. Повторить PRECHECK и подтвердить восстановление catalog counts.

Rollback удаляет только воспроизводимые нейтральные строки. Он fail-closed и
отказывается работать, если:

- хотя бы один rating отличается от `3.00`;
- хотя бы один `is_verified` равен `true`;
- timestamps не совпадают с backend account;
- набор строк не совпадает с `backend_auth.player_profiles`;
- structure, owner или fingerprint таблицы изменились.

После начала реального rating writer или индивидуальной миграции Supabase
ratings нужен отдельный data-preserving fail-forward шаг. Возвращаться к
`DROP TABLE` после появления значимых rating values запрещено.

## Следующий отдельный этап

После проверки migration 019 можно отдельно реализовать:

1. атомарное создание нейтральной rating state при provisioning нового backend
   player account;
2. backend own-profile reader для rating и verification;
3. отдельный авторизованный writer и security audit taxonomy;
4. доказанное индивидуальное сопоставление Supabase и backend аккаунтов;
5. только затем перенос публичного поиска, матчей и административных экранов.
