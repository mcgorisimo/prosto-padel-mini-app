# 001_security_and_atomic_join

Этот файл описывает локальный черновик миграции `001_security_and_atomic_join.sql`.
SQL не выполнялся и не подключался к удаленной Supabase.

## Что закрывает миграция

- Запрещает обычному пользователю менять `role`, `rating`, `is_verified` в `profiles`.
- Оставляет публичный профиль только через `player_public_profiles`: `id`, `first_name`, `last_name`, `username`, `photo_url`, `rating`, `is_verified`, `side_preference`.
- Разводит публичное чтение профилей и полный профиль: полный собственный профиль читается через `get_my_profile()`, админское чтение - через `admin_get_profiles()`.
- Убирает опасную идею "участник матча может обновлять всю строку матча".
- Заменяет широкое чтение `matches`: приватные матчи и тренировки видят только владелец, участник или админ.
- Добавляет атомарный `join_open_match(p_match_id uuid)` с `SELECT ... FOR UPDATE`.
- Добавляет безопасный `leave_match(p_match_id uuid)`, где пользователь удаляет только свой `auth.uid()`.
- Отзывает `EXECUTE` у `public` и `anon` для существующего `confirm_rating_match_score`.

## Что останется рискованным

- `confirm_rating_match_score` все еще концептуально небезопасен: он принимает `p_rating_changes` от клиента. Его нужно заменить RPC, который сам считает рейтинг на сервере по сохраненному результату матча.
- `filledSlots` остается JSON/массивом клиентских объектов. Миграция намеренно не меняет его, чтобы не сломать данные. Каноническое поле для join/leave в этой версии - `participants`.
- Идеальная модель для матчей - отдельная таблица `match_participants`, а не массив `participants` в строке `matches`.
- Платежные поля нельзя надежно скрыть только RLS-политикой на строку. Для платежей нужны отдельная таблица, view или RPC с явной выдачей безопасных полей.
- Проверка уровня в `join_open_match` сравнивает `profiles.rating` с `matches.ratingMin/ratingMax`. Если `ratingMin/ratingMax` в базе означают индекс уровня `0..6`, фронт или RPC нужно привести к одной шкале до применения.

## Что сломается без изменений mini-app

- Прямые `select('*')` из `profiles` перестанут получать приватные поля.
- Прямые обновления `profiles.rating`, `profiles.is_verified`, `profiles.role` из админских экранов перестанут работать.
- Присоединение к матчу через прямой `update({ filledSlots, participants, status })` больше не подходит для обычного участника.
- Выход из матча через прямой `update()` должен быть заменен на `leave_match`.
- Клиентский вызов `confirm_rating_match_score` не должен оставаться пользовательским сценарием до появления серверного расчета рейтинга.

## Файлы mini-app, которые нужно изменить перед применением

- `mini-app/src/App.jsx`: загрузка профиля, загрузка матчей, join/leave, завершение рейтингового матча.
- `mini-app/src/components/PersonalInfoScreen.jsx`: заменить прямой update профиля на `update_my_profile()`.
- `mini-app/src/components/AdminPlayersScreen.jsx`: заменить прямое чтение `profiles` на `admin_get_profiles()`.
- `mini-app/src/components/AdminPlayerDetails.jsx`: заменить прямое обновление рейтинга/верификации на `admin_update_profile_security()`.
- `mini-app/src/components/AddPlayerModal.jsx`, `TrainingModal.jsx`, `MatchDetailsScreen.jsx`: читать игроков через `player_public_profiles` или отдельный безопасный RPC.

## Безопасный порядок применения

1. Сделать изменения mini-app для чтения публичных профилей через `player_public_profiles`.
2. Перевести собственный профиль на `get_my_profile()` и `update_my_profile()`.
3. Перевести админские экраны на `admin_get_profiles()` и `admin_update_profile_security()`.
4. Перевести join/leave матчей на `join_open_match()` и `leave_match()`.
5. Отдельно заменить рейтинговый RPC на серверный расчет результата.
6. Только после этого применить миграцию на staging-проекте Supabase.
7. Проверить базовые сценарии: регистрация, профиль, публичная лента, приватная бронь, join/leave, админский рейтинг.
8. После staging-проверки применить на production в окно низкой активности.

## Rollback без удаления данных

- Не удалять таблицы и не чистить пользовательские строки.
- Вернуть предыдущие RLS-политики и privileges из schema baseline или backup dump.
- Временно вернуть клиенту доступ только к тем колонкам, которые нужны для восстановления критических сценариев.
- Откатить вызовы mini-app на предыдущую версию только вместе с политиками, иначе фронт и RLS будут несовместимы.
- Новые функции и view можно оставить неиспользуемыми; они не меняют пользовательские данные сами по себе.

## Проверки миграции

- Нет `DROP TABLE`.
- Нет удаления строк из пользовательских таблиц.
- `join_open_match` и `leave_match` используют `SELECT ... FOR UPDATE`.
- User id берется из `auth.uid()`, а не из аргументов клиента.
- `role`, `rating`, `is_verified` защищены column privileges и trigger-guard.
- Private matches скрыты от посторонних RLS-политикой `matches_select_public_member_or_admin`.
- `confirm_rating_match_score` лишается доступа `public` и `anon`.

## Допущения

- `public.profiles.id` и `public.matches.id` имеют тип `uuid`.
- `public.matches.owner_id` имеет тип `uuid`.
- `public.matches.participants` имеет тип `text[]`.
- В `public.matches` существуют колонки `type`, `status`, `isPrivate`, `ratingMin`, `ratingMax`.
- В `public.profiles` существуют перечисленные поля профиля, включая `role`, `rating`, `is_verified`.
- Supabase/PostgreSQL поддерживает `security_invoker` для view.
