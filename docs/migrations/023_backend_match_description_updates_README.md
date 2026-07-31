# 023 — редактирование комментария backend-матча

Migration 023 не добавляет таблиц и не изменяет существующие строки. Она:

- разрешает immutable-команду `update_match_description` с результатом
  `match_description_updated`;
- выдаёт `backend_auth_app` только column-level `UPDATE(description)` для
  `backend_match.matches`;
- сохраняет table-level `UPDATE` отозванным.

Расписание, корт, длительность, цена и payment-поля не становятся
редактируемыми. Backend разрешает изменение комментария только владельцу
активного матча до его начала; текст ограничен 240 символами и проходит общую
модерацию.

## Ручное применение

1. Сделать и проверить backup test-базы.
2. Выполнить `023_backend_match_description_updates_PRECHECK.sql`.
3. Сохранить read-only PRECHECK evidence вне репозитория.
4. Выполнить `023_backend_match_description_updates.sql`.
5. Сразу выполнить `023_backend_match_description_updates_POSTCHECK.sql`.
6. Только после зелёного POSTCHECK разворачивать backend, затем frontend.

SQL не применяется автоматически из приложения или deployment-конфигурации.

## Rollback

Сначала остановить rollout writer. Rollback берёт таблицы в фиксированном
`ACCESS EXCLUSIVE` порядке и блокируется, если хотя бы одна команда
редактирования уже записана. После начала использования нужен fail-forward,
а не удаление истории команд.
