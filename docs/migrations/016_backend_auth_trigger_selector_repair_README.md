# 016 — repair selector-логики общих trigger-функций

## Причина

В установленной test-базе сохранилась устаревшая версия
`backend_auth.assert_player_profile_consistency()`. Общий `CASE` одновременно
ссылался на `OLD.id`/`NEW.id` таблицы `accounts` и на
`OLD.account_id`/`NEW.account_id` таблицы `player_profiles`. Для trigger на
`accounts` PostgreSQL пытался разрешить отсутствующее поле `OLD.account_id` и
завершал транзакцию ошибкой:

```text
record "old" has no field "account_id"
```

Constraint trigger является `DEFERRABLE INITIALLY DEFERRED`, поэтому функция
выполняется при проверке отложенных ограничений во время `COMMIT`, а не
обязательно в момент исходного `INSERT` или `UPDATE`. Именно поэтому backend
успевал пройти Telegram verifier и workflow, но commit account-транзакции
падал.

Текущая migration 015 уже содержит безопасную selector-логику с отдельными
`IF`/`ELSIF` ветками для каждой таблицы и `TG_OP`. Migration 016 переносит в
установленную базу эти канонические определения без изменения бизнес-правил.

## Почему исправляются четыре функции

Commit `c407764` исправил один и тот же класс ошибки сразу в четырёх общих
trigger-функциях:

1. `backend_auth.assert_player_profile_consistency()`;
2. `backend_auth.assert_external_identity_aliases()`;
3. `backend_auth.assert_session_consistency()`;
4. `backend_auth.assert_otp_consistency()`.

Runtime drift подтверждён для первой функции. Остальные три заменяются
одновременно на их точные текущие определения из migration 015, чтобы не
оставить ту же скрытую ошибку в других deferred workflow.

Migration 016 выполняет только `CREATE OR REPLACE FUNCTION` для этих четырёх
функций и обновляет их комментарии-фингерпринты. Она не меняет таблицы,
колонки, данные, constraints, индексы, triggers, owners или ACL. Существующие
OID функций и девять trigger attachments сохраняются.

## Файлы

- `016_backend_auth_trigger_selector_repair_PRECHECK.sql` — read-only
  fail-closed проверка исходной структуры и снимок counts/owners/ACL/comments;
- `016_backend_auth_trigger_selector_repair.sql` — повторно применимый repair;
- `016_backend_auth_trigger_selector_repair_POSTCHECK.sql` — read-only
  проверка канонических тел, fingerprints и неизменности структуры;
- `016_backend_auth_trigger_selector_repair_ROLLBACK.sql` — безопасное
  fail-forward восстановление канонического состояния 015.

## Обязательный ручной порядок

Эти команды не запускаются автоматически. Первое применение разрешено только
на test-базе и только после отдельного одобрения deployment:

1. Сделать и проверить резервную копию test-базы штатным серверным процессом.
2. Вручную выполнить `016_backend_auth_trigger_selector_repair_PRECHECK.sql`.
3. Сохранить его единственный JSON-результат вне репозитория как
   операционный артефакт.
4. Если PRECHECK завершился без ошибки, вручную выполнить
   `016_backend_auth_trigger_selector_repair.sql`.
5. Сразу вручную выполнить
   `016_backend_auth_trigger_selector_repair_POSTCHECK.sql`.
6. Сравнить `catalog_counts`, `row_counts`, владельцев и ACL в результатах
   PRECHECK и POSTCHECK. Они должны совпасть. Comments закономерно меняются с
   прежнего маркера на `016_backend_auth_trigger_selector_repair:<md5>`.
7. Не переходить к production до успешной проверки на test-контуре.

Не следует повторно применять migration 015: repair предназначен именно для
уже установленной схемы.

PRECHECK и POSTCHECK открывают read-only transaction и завершают её
`ROLLBACK`. Они не являются backup и не заменяют проверку резервной копии.

## Проверка после применения

После успешного POSTCHECK:

1. Перезапуск backend для изменения PostgreSQL-функций не требуется.
2. Вручную открыть реальную Telegram Mini App и выполнить один login.
3. Проверить безопасный публичный результат login без вывода credential или
   `initData`.
4. Проверить PostgreSQL logs: не должно быть
   `record "old" has no field "account_id"` и ошибок четырёх repaired
   constraint-trigger functions.
5. Проверить backend logs: workflow не должен завершаться
   `stage=terminal_operation` /
   `checkpoint=transaction_commit_failed` из-за этой trigger-ошибки.
6. Убедиться, что последующие Supabase/UI сценарии остаются рабочими.

Зелёный `/api/v1/health` сам по себе не подтверждает PostgreSQL commit path.
Разрешением считать только успешный реальный Telegram login вместе с
POSTCHECK и проверкой PostgreSQL/backend logs.

Временная TypeScript-диагностика transaction/proof binding удаляется только
после успешного реального Telegram login и отдельного review. Migration 016 её
не изменяет.

## Безопасный rollback

Известную сломанную runtime-реализацию с общим `CASE` восстанавливать
запрещено. Поэтому rollback является fail-forward:

1. Остановить rollout и сохранить относящиеся к нему безопасные логи.
2. Вручную выполнить
   `016_backend_auth_trigger_selector_repair_ROLLBACK.sql`.
3. Rollback повторно устанавливает те же четыре безопасные канонические
   определения из текущей migration 015.
4. Он меняет только comments/fingerprints обратно на
   `015_backend_auth_foundation:<md5 фактического pg_get_functiondef>`.
5. После rollback повторно выполнить PRECHECK и независимо проверить, что
   владельцы, ACL, девять trigger attachments и counts не изменились.

Rollback не возвращает базу к заведомо аварийному коду и не меняет данные,
таблицы или triggers. Если PRECHECK, migration, POSTCHECK либо сравнение
снимков выявляет расхождение, deployment останавливается для отдельного
read-only расследования.
