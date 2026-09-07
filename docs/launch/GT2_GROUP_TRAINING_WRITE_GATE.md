# GT.2 — gate записи на групповую тренировку

Статус: **closed**. GT.1 выполняет только bounded read. Runtime provider writes,
оплата и списание абонемента здесь отсутствуют.

## Подтверждено для GT.1

- Единственный публикационный scope: YCLIENTS company `2079564`, group service
  `30920295` (`Групповая тренировка Новички D/D+`).
- `GET /api/v1/activity/{company_id}/search/` возвращает событие, вместимость,
  данные услуги и цену; TEST read показал `price_min = price_max = 2500`.
- `GET /api/v2/companies/{company_id}/activities/{activity_id}` возвращает
  `capacity` и `clients_count`. `clients_count` используется как занятые места;
  `records_count` не используется: одна запись события может включать несколько
  посетителей.
- Цена не входит в публичный GT.1 response. Для разового посещения ещё нужен
  отдельный server-owned quote contract с expiry и повторным authoritative read.

## Обязательные preconditions GT.2

1. Durable trusted binding `Telegram account -> YCLIENTS client`; phone/email не
   доказывают ownership. Backend сам выбирает client и membership IDs.
2. Подтверждённый provider write contract для записи в событие, включая
   idempotency, response IDs, read-after-write и unknown-outcome reconciliation.
3. Подтверждённый provider-side capacity test: два пользователя одновременно
   пытаются занять одно последнее место, успешна ровно одна запись.
4. Один локальный operation ledger; one-seat-per-account; per-event lock; exact
   YCLIENTS re-read сразу перед write и сразу после подтверждённого результата.
5. Для абонемента дополнительно lock по membership/account и authoritative
   `search_for_activity` / `check_for_activity` read. Два события при одном
   оставшемся посещении должны дать ровно одно подтверждённое списание.
6. Timeout после provider dispatch переводит операцию в `unknown`; повторный
   write запрещён до однозначного read reconciliation.
7. IDOR/RBAC negative tests: чужие client, membership, event и operation IDs не
   принимаются из frontend и не раскрываются в response/logs.
8. Разовое посещение получает цену только из свежего backend quote. Payment/YCLIENTS
   порядок, hold места, компенсация и срок quote утверждаются отдельно в D4.

## Controlled test matrix перед enablement

| Сценарий | Обязательный результат |
|---|---|
| Повтор одного idempotency key | Одна provider запись и один локальный operation |
| 2 аккаунта / 1 место | Один success, один capacity conflict после authoritative read |
| 1 абонемент / 1 посещение / 2 события | Одно подтверждённое использование, второе отклонено |
| Timeout до dispatch | Provider write count 0; безопасный retry того же operation |
| Timeout после dispatch | `unknown`; только read reconciliation, без blind retry |
| Чужой membership/client ID | 403/404 без признака существования и без PII |
| Изменение цены/вместимости администратором | Старый quote/seat proof отклонён |
| Payment success, YCLIENTS unknown | Не обещать место; выполнить утверждённую D4 compensation |

До прохождения матрицы действие записи отсутствует, а payment-поля
`paymentStatus`, `ownerPaid`, `holdAmount`, `prepay` не меняются.
