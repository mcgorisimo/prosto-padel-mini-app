# 017 — backend-owned Telegram profile details

## Назначение

Migration 015 создала `backend_auth.player_profiles` как неизменяемую связь
`player account → player profile`. Таблица содержит только `account_id`, а trigger
`player_profiles_immutable_guard` запрещает её `UPDATE` и `DELETE`. Поэтому она не
подходит для изменяемых пользовательских данных.

Migration 017 создаёт отдельную приватную таблицу
`backend_auth.player_profile_details`. Она предназначена для первоначального
снимка полей, полученных только из успешно проверенного Telegram `initData`:

- `first_name`;
- `last_name`;
- `username`;
- `photo_url`;
- `language_code`.

В таблице также находятся backend `account_id` и целочисленные Unix timestamps
`created_at`/`updated_at`.

## Границы этого шага

Migration 017:

- не изменяет `backend_auth.player_profiles` и её triggers;
- не изменяет migration 015 или 016;
- не создаёт строки профилей и не выполняет backfill;
- не читает и не изменяет таблицы Supabase `public.profiles`;
- не пытается сопоставить Supabase `auth.uid()` с backend `account_id`;
- не добавляет телефон, рейтинг, verification, предпочитаемую сторону, дату
  рождения или gender;
- не создаёт HTTP endpoint и не меняет frontend;
- не предоставляет доступ ролям `anon`, `authenticated` или `service_role`.

Существующие backend-аккаунты намеренно остаются без строки details. После
отдельного backend rollout строка должна создаваться при следующем успешном
Telegram login. До этого protected profile endpoint обязан безопасно возвращать
состояние отсутствующего/неполного профиля, а не подставлять Supabase identity.

## Модель и права

`player_profile_details.account_id` является одновременно primary key и
non-deferrable foreign key на `backend_auth.player_profiles(account_id)`.
Primary key уже индексирует foreign key.

Поля соответствуют текущим пределам Telegram verifier:

- имя и фамилия — до 256 символов;
- username и language code — до 64 символов;
- photo URL — до 2048 символов и с проверенным `https:` scheme;
- optional пустые строки не сохраняются: вместо них используется `NULL`.

Время хранится в Unix epoch seconds, как и остальные объекты migration 015.

Владелец таблицы — `backend_auth_owner`. Роль `backend_auth_app` получает:

- table-level `SELECT`;
- только column-level `INSERT` для восьми объявленных колонок.

`UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` и table-level `INSERT`
не выдаются. Первый backend writer должен использовать verified Telegram proof и
семантику `INSERT ... ON CONFLICT DO NOTHING`: повторный login не должен
перезаписывать будущие пользовательские изменения. Политика редактирования
профиля и необходимые column-level `UPDATE` grants будут отдельным этапом.

Таблица находится в закрытой схеме `backend_auth`, не публикуется через Supabase
Data API и не использует Supabase JWT/RLS как authorization boundary. Доступ к
будущему HTTP endpoint должен определяться backend bearer principal.

## Файлы

- `017_backend_auth_player_profile_details_PRECHECK.sql` — read-only preflight
  структуры migration 015/016, ролей, ACL и immutable profile binding;
- `017_backend_auth_player_profile_details.sql` — создаёт одну пустую таблицу и
  минимальные grants;
- `017_backend_auth_player_profile_details_POSTCHECK.sql` — read-only проверяет
  колонки, constraints, owner, ACL, fingerprint и отсутствие backfill;
- `017_backend_auth_player_profile_details_ROLLBACK.sql` — удаляет таблицу только
  пока она пуста;
- `017_backend_auth_player_profile_details_README.md` — этот runbook.

## Ручной порядок применения

Команды не запускаются автоматически. Первое применение разрешается только на
test-базе после отдельного одобрения:

1. Сделать и проверить backup test-базы штатным серверным процессом.
2. Выполнить `017_backend_auth_player_profile_details_PRECHECK.sql` в read-only
   режиме.
3. Сохранить единственный JSON-результат PRECHECK вне репозитория.
4. При полностью зелёном PRECHECK выполнить
   `017_backend_auth_player_profile_details.sql`.
5. Сразу выполнить `017_backend_auth_player_profile_details_POSTCHECK.sql`.
6. Сравнить PRECHECK и POSTCHECK:
   - row counts четырнадцати существующих таблиц должны совпасть;
   - fingerprints четырнадцати существующих таблиц должны совпасть;
   - ожидаемое изменение catalog counts — одна таблица и восемь constraints;
   - `player_profile_details` должна быть пустой.
7. Не переходить к backend writer или production до отдельного review.

PRECHECK и POSTCHECK открывают read-only transaction и завершают её через
`ROLLBACK`. Они не заменяют backup.

## Проверка следующего backend rollout

После отдельной реализации writer и protected read endpoint:

1. Открыть реальную Telegram Mini App.
2. Выполнить один новый Telegram login.
3. Проверить, что создана одна details-строка для backend account.
4. Повторить login и подтвердить, что строка не перезаписана.
5. Проверить protected own-profile endpoint с действующим backend credential.
6. Убедиться, что endpoint не принимает account ID от клиента.
7. Проверить backend/PostgreSQL logs без `initData`, Telegram user ID,
   credential, digest и profile values.
8. Убедиться, что существующие Supabase screens продолжают работать.

Зелёный `/api/v1/health` не подтверждает путь записи или чтения
`player_profile_details`.

## Безопасный rollback

Rollback предназначен только для окна до появления первой строки:

1. Остановить rollout будущего backend writer.
2. Убедиться, что POSTCHECK всё ещё проходит и таблица пуста.
3. Выполнить `017_backend_auth_player_profile_details_ROLLBACK.sql`.
4. Повторить PRECHECK и проверить восстановление catalog counts migration 015/016.

Rollback fail-closed: если таблица содержит хотя бы одну строку, он завершится
ошибкой и не удалит данные. После начала profile persistence требуется новая
проверенная data-preserving migration, а не `DROP TABLE` или `CASCADE`.
