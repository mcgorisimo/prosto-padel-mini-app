# 007 Atomic Court Booking

## Что делает комплект

Комплект добавляет серверную операцию `public.create_booking(jsonb)` и защиту
таблицы `public.matches` от двух активных записей одного корта с
пересекающимся временем.

Он не меняет frontend, цены, оплату, дизайн или существующие данные. SQL из
комплекта нельзя сначала запускать на production.

## Файлы

- `007_create_booking_atomic_PRECHECK.sql` — только читает каталоги и данные.
- `007_create_booking_atomic.sql` — устанавливает функцию и ограничение.
- `007_create_booking_atomic_POSTCHECK.sql` — проверяет каталоги и выполняет
  временные тестовые вставки внутри транзакции с обязательным `ROLLBACK`.
- `007_create_booking_atomic_ROLLBACK.sql` — удаляет только объекты миграции 007.

## Какие поля используются

Текущая таблица хранит расписание не в отдельной таблице бронирований:

- корт — `public.matches."courtId" text`;
- день — `public.matches."dateISO" date`;
- начало — `public.matches.time text` в формате `H:MM`/`HH:MM`;
- окончание — начало плюс `public.matches.duration numeric` часов;
- завершённые строки с `status = 'completed'` не блокируют время.

Интервалы сравниваются как `[начало, окончание)`. Поэтому бронь 07:00–08:00
не конфликтует с бронью, начинающейся ровно в 08:00.

## Как исключена гонка

`create_booking` выполняет короткую атомарную операцию:

1. получает пользователя через `auth.uid()`;
2. проверяет payload, дату, время, длительность, корт и рабочие часы;
3. запрещает время в прошлом в часовом поясе `Europe/Moscow`;
4. берёт `pg_advisory_xact_lock` для пары «корт + день»;
5. повторно ищет пересечение;
6. вставляет строку и возвращает её как `public.matches`.

Если два вызова приходят одновременно, второй ждёт первый, затем видит уже
созданную запись и получает:

- SQLSTATE: `23P01`;
- message: `BOOKING_SLOT_TAKEN`.

Любая необработанная ошибка отменяет весь вызов PostgreSQL. Частично созданной
строки не остаётся.

## Почему прямой INSERT не обходит защиту

Advisory lock действует для `create_booking`, но сам по себе требует, чтобы все
клиенты добровольно использовали ту же блокировку. Поэтому окончательная
гарантия реализована ограничением
`matches_no_active_court_overlap` (`EXCLUDE USING gist`) непосредственно на
`public.matches`.

Ограничение проверяется PostgreSQL для любого `INSERT`/`UPDATE`, включая:

- старый прямой INSERT текущего экрана бронирования;
- вызов `create_booking`;
- прямой INSERT открытого матча;
- административный или service-role INSERT.

Непересекающийся открытый матч с текущими значениями
`scenario='community'`, `status='searching'`, `type='match'` по-прежнему
создаётся. Миграция не меняет существующую INSERT policy и права на таблицу.
POSTCHECK отдельно проверяет успешную вставку такого матча и отказ для второй
пересекающейся вставки.

Для equality по `text` и `date` ограничение использует стандартное поставляемое
с PostgreSQL расширение `btree_gist`. Миграция устанавливает его, если оно ещё
не установлено.

## Формат create_booking

Сигнатура:

```sql
public.create_booking(p_booking jsonb) returns public.matches
```

JSON использует уже существующие frontend/табличные имена:

- `dateISO`, `date`, `time`, `duration`;
- `courtId`/`courtName`/`courtType` либо существующий вложенный объект `court`;
- `isPrivate`, `type`, `scenario`, `paymentStatus`;
- `isPrime`, `isRatingMatch` или `is_rating_match`;
- `ratingMin`, `ratingMax`, `description`.

Функция сама устанавливает `owner_id`, `participants` и организаторский слот
из текущего пользователя и `public.profiles`. Клиент не может назначить другого
владельца через payload.

## Зависимости от Supabase

PostgreSQL-часть — транзакция, range, exclusion constraint, advisory lock,
JSONB и `btree_gist` — не зависит от Supabase.

Изолированные Supabase-зависимости:

- одна строка получения пользователя: `auth.uid()`;
- роли `authenticated` и `anon` в `GRANT`/`REVOKE`;
- публикация функции из схемы `public` как RPC через PostgREST.

При переносе на другой PostgreSQL нужно заменить `auth.uid()` на функцию или
session setting российского backend и заменить названия ролей. Конкурентную
защиту и таблицу менять не требуется. Часовой пояс `Europe/Moscow` является
бизнес-настройкой клуба, а не зависимостью от Supabase.

## Ручное применение на staging

1. Откройте **staging**, не production, в Supabase SQL Editor.
2. Выполните целиком `007_create_booking_atomic_PRECHECK.sql`.
3. В единственном JSON-результате убедитесь, что
   `precheck.precheck_ok = true`.
4. Отдельно убедитесь, что:
   - `data_findings.invalid_active_time_count = 0`;
   - `data_findings.existing_overlap_pair_count = 0`;
   - `checks.no_conflicting_create_booking = true`;
   - `checks.no_conflicting_time_helper = true`;
   - `checks.no_conflicting_overlap_constraint = true`;
   - `platform.btree_gist_available = true`.
5. Сохраните JSON PRECHECK в заметки выкладки. Если любой пункт ложный, ничего
   не исправляйте этим комплектом и не запускайте основную миграцию.
6. В период низкой активности выполните целиком
   `007_create_booking_atomic.sql` одним запуском. Создание exclusion constraint
   кратковременно блокирует конкурентную запись в `public.matches`.
7. Выполните целиком `007_create_booking_atomic_POSTCHECK.sql`.
8. Убедитесь, что `postcheck.postcheck_ok = true`, а в `behavior` все пять
   boolean-полей равны `true`. POSTCHECK выбирает существующий профиль, создаёт
   тестовые строки на свободном корте в 2099 году и удаляет их финальным
   `ROLLBACK`.
9. Если `behavior.test_executed = false`, прочитайте `behavior.note`: обычно это
   означает, что на staging нет ни одного профиля для внешнего ключа. Добавлять
   данные этим SQL не нужно; остановите выкладку и повторите проверку в среде с
   тестовым пользователем.
10. Проверьте вручную на staging:
    - обычный непересекающийся открытый матч создаётся;
    - первая бронь создаётся;
    - вторая бронь того же корта с пересечением получает ошибку занятости;
    - соседний интервал, начинающийся ровно после окончания первого, создаётся.
11. Не применяйте комплект на production до отдельного согласования результатов
    staging. Frontend в этой задаче намеренно не переводится на RPC; его текущий
    прямой INSERT продолжит работать и уже будет защищён constraint.

## Отмена

На staging выполните `007_create_booking_atomic_ROLLBACK.sql` целиком. Он:

1. проверит маркеры владения объектами;
2. удалит `public.create_booking(jsonb)`;
3. удалит `matches_no_active_court_overlap`;
4. удалит вспомогательную функцию времени;
5. не изменит существующие строки.

`btree_gist` намеренно остаётся установленным: автоматическое удаление
расширения может сломать чужие индексы или constraints. Это безопасный
остаточный объект без данных. После rollback снова запустите PRECHECK: он должен
показать отсутствие объектов 007 и снова показать, что прямой INSERT не имеет
табличной защиты от пересечений.
