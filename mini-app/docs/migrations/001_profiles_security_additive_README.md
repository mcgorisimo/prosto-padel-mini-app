# 001_profiles_security_additive

Локальный additive-этап защиты `public.profiles`.
SQL не выполнялся и не подключался к удаленной Supabase.

## Baseline-факты

Использован `mini-app/docs/supabase-schema-baseline.json`.

- `public.profiles` существует, владелец `postgres`, RLS включен, `rls_forced = false`.
- `profiles.id` имеет тип `uuid` и FK на `auth.users(id) ON DELETE CASCADE`.
- `profiles.rating` имеет тип `numeric(4,2)`, default `3.00`, CHECK `rating >= 0 AND rating <= 10`.
- `profiles.role` имеет тип `text`, default `'user'`, CHECK `role IN ('user', 'admin')`.
- `profiles.is_verified` имеет тип `boolean`, default `false`.
- Уже есть policies: `profiles_insert_own`, `profiles_select_authenticated`, `profiles_update_own_or_admin`.
- Уже есть `public.is_admin()` как `SECURITY DEFINER` с фиксированным `search_path`.
- Уже есть trigger `set_profiles_updated_at`.
- PostgreSQL version в `project_info` не указана.

## Что защищается сразу

- Обычный authenticated пользователь не может создать профиль с чужим `id`.
- Если текущий `AuthGate` передает `role` или `is_verified`, регистрация не падает: trigger принудительно сохраняет `role = 'user'` и `is_verified = false`.
- Пользователь не может назначить себе `admin` через INSERT.
- При UPDATE обычного пользователя защищенные поля возвращаются к старым значениям: `id`, `created_at`, `role`, `rating`, `is_verified`.
- Добавлен `get_my_profile()` для полного чтения только собственного профиля.
- Добавлен `update_my_profile(...)`, который не принимает user id и меняет только разрешенные поля.
- Добавлен `admin_update_profile_security(...)`, который проверяет администратора через базу и меняет только `role`, `rating`, `is_verified`.
- Добавлен `player_public_profiles` только с публичными полями игрока.

## Почему текущая регистрация продолжит работать

Текущий `AuthGate` вставляет `role`, `rating` и `is_verified` напрямую.
Новый INSERT-trigger не отклоняет сам факт передачи `role` и `is_verified`; он нормализует эти значения для обычного пользователя.

Рейтинг на этом этапе не переводится на новую шкалу и не меняет тип. Значение остается в `profiles.rating` и ограничивается существующим CHECK `0..10`.
Позже стоит разделить self-assessment при регистрации и подтвержденный клубом рейтинг.

## Почему UPDATE-trigger восстанавливает OLD-значения

Для меньшего риска текущего интерфейса trigger не падает, если обычный пользователь случайно отправил защищенные поля вместе с разрешенными.
Он молча сохраняет старые значения защищенных полей и позволяет обновить обычные поля профиля.

Админские изменения `role`, `rating`, `is_verified` должны идти через `admin_update_profile_security(...)`.

## Почему view без security_invoker

Baseline JSON не содержит версию PostgreSQL, поэтому нельзя подтверждать поддержку `security_invoker` для view.
Выбрана версия без version-specific options: обычный view с явным списком только публичных колонок.

Важно: обычный PostgreSQL view может работать с правами владельца и обходить RLS базовой таблицы.
В этом additive-этапе это считается безопасным только потому, что view содержит строго публичный набор колонок и не раскрывает приватные поля.

View не включает:

- `email`;
- `phone`;
- `birthday`;
- `gender`;
- `role`;
- `language`.

## Что намеренно не закрыто

- Existing policy `profiles_select_authenticated` пока остается, поэтому любой authenticated пользователь все еще может читать все строки `profiles` напрямую.
- Existing policy `profiles_update_own_or_admin` пока остается, но trigger защищает чувствительные поля от обычного пользователя.
- Direct admin update из текущего фронта для `rating/is_verified` должен быть переведен на RPC.
- Полная приватность чужих профилей будет закрыта только на следующем lockdown-этапе.

Это сделано намеренно, чтобы additive SQL не ломал текущий mini-app до миграции frontend на RPC/view.

## React-файлы для перевода

- `mini-app/src/App.jsx`: `fetchProfile` перевести на `get_my_profile()`.
- `mini-app/src/components/PersonalInfoScreen.jsx`: update профиля перевести на `update_my_profile(...)`.
- `mini-app/src/components/AdminPlayerDetails.jsx`: update `rating/is_verified` перевести на `admin_update_profile_security(...)`.
- `mini-app/src/components/AdminPlayersScreen.jsx`: админское чтение профилей перевести на отдельный admin RPC на следующем этапе.
- `mini-app/src/components/AddPlayerModal.jsx`: поиск игроков перевести на `player_public_profiles`.
- `mini-app/src/components/MatchDetailsScreen.jsx`: поиск игроков перевести на `player_public_profiles`.
- `mini-app/src/components/TrainingModal.jsx`: поиск по телефону нельзя переводить на public view; нужен отдельный admin/coach RPC.
- `mini-app/src/components/AuthGate.jsx`: после стабилизации можно убрать передачу `role` и `is_verified` из INSERT.

## Следующий lockdown SQL

После перевода frontend нужно подготовить второй SQL:

- убрать или заменить `profiles_select_authenticated`;
- ограничить прямой SELECT `profiles` до own/admin;
- выдать публичное чтение игроков только через `player_public_profiles`;
- закрыть прямой UPDATE защищенных полей для admin UI и оставить только RPC;
- добавить admin read RPC для списка игроков, если он нужен админке.

## Staging-проверка

1. Применить SQL только на staging Supabase.
2. Зарегистрировать нового пользователя через текущий `AuthGate`.
3. Проверить, что запись создана с `role = 'user'`, `is_verified = false`.
4. Попробовать обычным пользователем обновить `role`, `rating`, `is_verified`; значения должны остаться прежними.
5. Проверить `get_my_profile()` под обычным пользователем.
6. Проверить `update_my_profile(...)` под обычным пользователем.
7. Проверить `player_public_profiles`: приватных колонок быть не должно.
8. Проверить `admin_update_profile_security(...)` под admin.
9. Проверить, что нельзя снять `admin` у последнего администратора.
10. Проверить текущие базовые экраны mini-app.

## Rollback без удаления данных

- Отключить новые triggers `profiles_security_guard_insert` и `profiles_security_guard_update`.
- Временно отозвать execute у новых RPC, если они вызывают ошибки.
- Оставить view неиспользуемым или отозвать `select` у `authenticated`.
- Не удалять таблицу `profiles` и не чистить пользовательские строки.
- Старые policies не менялись этим SQL, поэтому основной rollback не требует восстановления RLS из backup.

## Порядок SQL-файлов

1. `001_profiles_security_additive_PRECHECK.sql` - read-only проверка текущей схемы.
2. `001_profiles_security_additive.sql` - additive migration на staging.
3. `001_profiles_security_additive_POSTCHECK.sql` - read-only проверка созданных объектов.
4. `001_profiles_security_additive_ROLLBACK.sql` - откат только новых объектов без удаления таблиц и пользовательских данных.
