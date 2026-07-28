# 018 — редактируемые поля backend-профиля

## Назначение

Migration 018 расширяет приватную таблицу
`backend_auth.player_profile_details`, созданную migration 017:

- добавляет nullable `phone`;
- добавляет nullable `side_preference`;
- выдаёт `backend_auth_app` column-level `UPDATE` только для
  `first_name`, `last_name`, `phone`, `side_preference` и `updated_at`.

Миграция не переносит данные из Supabase и не меняет существующие строки.
`NULL` в `side_preference` обозначает, что backend-настройка ещё не была
сохранена. Первый успешный PATCH сохраняет выбранную сторону.

## Ограничения

Телефон хранится только в каноническом E.164-подобном формате: `+`, затем от
7 до 15 цифр, первая цифра не ноль. Пустое значение хранится как `NULL`.
`side_preference` принимает только `Left`, `Both` или `Right`.

Неизменяемые Telegram-поля `username`, `photo_url` и `language_code`, а также
`account_id` и `created_at`, не получают `UPDATE`.

Migration 018 не добавляет rating, verification, публичный player-profile API,
таблицы, индексы, triggers или новые роли. Она не меняет migrations 015–017.

## Ручной порядок применения

Команды не выполняются автоматически:

1. Сделать и проверить backup test-базы.
2. Выполнить
   `018_backend_auth_player_profile_editable_fields_PRECHECK.sql`.
3. Сохранить read-only PRECHECK evidence вне репозитория.
4. Выполнить `018_backend_auth_player_profile_editable_fields.sql`.
5. Сразу выполнить
   `018_backend_auth_player_profile_editable_fields_POSTCHECK.sql`.
6. Только после зелёного POSTCHECK разворачивать backend GET/PATCH.
7. Затем разворачивать frontend и вручную проверить чтение, изменение,
   очистку телефона и каждое значение стороны.

После проверки нужно убедиться, что:

- `PATCH /api/v1/profile/me` принимает только backend Bearer credential;
- GET возвращает сохранённые значения;
- Supabase rating/verification и остальные data flows продолжают работать;
- backend/PostgreSQL logs не содержат credential, phone или SQL details.

## Rollback

Сначала остановить rollout backend writer. Rollback возвращает relation к
канонической структуре migration 017 и снимает новые UPDATE grants.

Rollback fail-closed: если хотя бы одна строка содержит `phone` или
`side_preference`, он завершается ошибкой и ничего не удаляет. После начала
реального использования нужен отдельный data-preserving fail-forward шаг, а
не принудительное удаление колонок.
