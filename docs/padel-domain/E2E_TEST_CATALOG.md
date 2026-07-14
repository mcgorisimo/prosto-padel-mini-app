# E2E Test Catalog

Каталог преобразует сценарии P0/P1 из `PADEL_SCENARIO_MATRIX.md` в будущие Playwright-тесты. Это не тестовый код.

## Тестовые Аккаунты

| Account | Роль | Рейтинг | Verified | Назначение |
| --- | --- | --- | --- | --- |
| admin | club_admin | 4.0 | true | Управление игроками, матчами, спорными результатами. |
| organizer_rating_2_0 | player/organizer | 2.0 | true | Создание матчей и приглашение игроков. |
| player_rating_1_5 | player | 1.5 | true | Игрок ниже типового диапазона 2.5-4.4. |
| player_rating_3_0 | player | 3.0 | true | Игрок внутри типового диапазона. |
| player_rating_4_5 | player | 4.5 | true | Игрок выше типового диапазона. |
| unverified_player | player | 3.0 | false | Проверка verified restrictions. |
| coach | coach | 4.0 | true | Тренировки и coach visibility. |

## Наборы Тестов

### auth-profile

| Test ID | Scenario | Accounts | Seed | Steps | UI assertions | DB assertions | Reload | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-AUTH-001 | SC-001 | player_rating_3_0 | empty user/profile | sign up, fill profile | profile screen opens | profile row exists, role=user | profile persists | delete profile/user |
| E2E-AUTH-002 | SC-002 | player_rating_3_0 | existing profile | edit public fields | success toast, new name shown | only allowed fields changed | values persist | restore profile |
| E2E-AUTH-003 | SC-003 | unverified_player, admin | unverified profile | request verification | pending state visible | request/audit exists if modeled | pending persists | remove request |

### booking

| Test ID | Scenario | Accounts | Seed | Steps | UI assertions | DB assertions | Reload | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-BOOK-001 | SC-004 | organizer_rating_2_0 | free court | create public casual match from booking | match details open | booking/match row created | match visible in feed | delete match |
| E2E-BOOK-002 | SC-006 | organizer_rating_2_0 | free court | create private casual match | not in public feed | match private=true | organizer sees it | delete match |
| E2E-BOOK-003 | SC-036 | organizer_rating_2_0 | pending payment slot | create pending booking | payment pending shown | booking pending | pending persists | delete booking |
| E2E-BOOK-004 | SC-039 | organizer_rating_2_0 | occupied court | attempt same slot | unavailable shown | no extra match | no ghost after reload | delete seed |

### match-creation

| Test ID | Scenario | Accounts | Seed | Steps | UI assertions | DB assertions | Reload | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-MC-001 | SC-005 | organizer_rating_2_0 | verified organizer | create public rated match | rated badge visible | is_rating_match=true | rated persists | delete match |
| E2E-MC-002 | SC-007 | organizer_rating_2_0 | verified organizer | create private rated match | private + rated state | private/rated flags true | persists | delete match |

### match-joining

| Test ID | Scenario | Accounts | Seed | Steps | UI assertions | DB assertions | Reload | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-JOIN-001 | SC-008 | player_rating_3_0 | public casual 2.5-4.4 | self join | success state | participant added | slot persists | remove participant |
| E2E-JOIN-002 | SC-009 | player_rating_1_5 | public casual 2.5-4.4 | self join | level error | no participant | no slot | delete match |
| E2E-JOIN-003 | SC-010 | player_rating_4_5 | public casual 2.5-4.4 | self join | level error | no participant | no slot | delete match |
| E2E-JOIN-004 | SC-011 | player_rating_3_0 | public rated 2.5-4.4 | self join | success | participant added | persists | remove participant |
| E2E-JOIN-005 | SC-012 | unverified_player | public rated | self join | verified error | no participant | no slot | delete match |
| E2E-JOIN-006 | SC-013 | player_rating_3_0 | private match | self join | private error | no participant | no slot | delete match |
| E2E-JOIN-007 | SC-020 | player_rating_3_0 | one_left match | join last slot | full/upcoming state | status full/upcoming | persists | delete match |
| E2E-JOIN-008 | SC-021 | player_rating_3_0 | full match | try join | disabled/error | no change | full persists | delete match |

### invitations

| Test ID | Scenario | Accounts | Seed | Steps | UI assertions | DB assertions | Reload | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-INV-001 | SC-014 | organizer_rating_2_0, player_rating_3_0 | match any visibility | organizer adds within level | closes, player in slot | participant added | persists | remove participant |
| E2E-INV-002 | SC-015 | organizer_rating_2_0, player_rating_1_5 | match 2.5-4.4 | organizer adds below | warning then add | participant added after confirm | persists | remove participant |
| E2E-INV-003 | SC-016 | organizer_rating_2_0, player_rating_4_5 | match 2.5-4.4 | organizer adds above | warning then add | participant added after confirm | persists | remove participant |
| E2E-INV-004 | SC-017 | organizer_rating_2_0, player_rating_3_0 | rated match | organizer adds within | success no verified block | participant added | persists | remove participant |
| E2E-INV-005 | SC-018 | organizer_rating_2_0, player_rating_1_5 | rated match | organizer adds below | warning then add | participant rating unchanged | persists | remove participant |
| E2E-INV-006 | SC-019 | organizer_rating_2_0, player_rating_3_0 | already joined | add same user | duplicate message | no duplicate participant | one slot only | delete match |

### privacy

| Test ID | Scenario | Accounts | Seed | Steps | UI assertions | DB assertions | Reload | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-PRIV-001 | SC-006/013 | organizer_rating_2_0, player_rating_3_0 | private match | nonparticipant opens feed | not visible | no unauthorized read in strict model | still hidden | delete match |

### rating

| Test ID | Scenario | Accounts | Seed | Steps | UI assertions | DB assertions | Reload | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-RATE-001 | SC-031 | two teams | rated full match | submit result | awaiting confirmation | result pending, no rating applied | pending persists | delete result |
| E2E-RATE-002 | SC-032 | opposing participant | pending result | confirm | completed, rating changed | RatingChange applied once | rating persists | restore ratings |
| E2E-RATE-003 | SC-033 | opposing participant | pending result | dispute | disputed shown | no rating applied | disputed persists | reset match |
| E2E-RATE-004 | SC-034 | same users | confirmed result | confirm again | rejected/no-op | no second change | unchanged | restore ratings |
| E2E-RATE-005 | SC-035 | casual full match | submit result | completed | no RatingChange | history visible | delete match |

### payments

| Test ID | Scenario | Accounts | Seed | Steps | UI assertions | DB assertions | Reload | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-PAY-001 | SC-037 | organizer_rating_2_0 | payment provider stub fail | pay | failed state | payment failed | persists | remove payment |
| E2E-PAY-002 | SC-038 | organizer_rating_2_0 | paid booking | cancel | refund pending | refund record | persists | reset booking |

### training

| Test ID | Scenario | Accounts | Seed | Steps | UI assertions | DB assertions | Reload | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-TRN-001 | SC-040 | player_rating_3_0, coach | free training slot | request training | pending coach/admin | training requested | pending persists | delete request |

### tournaments

| Test ID | Scenario | Accounts | Seed | Steps | UI assertions | DB assertions | Reload | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-TOUR-001 | SC-041 | player_rating_3_0 | registration open | register | registered/pending payment | tournament participant | persists | remove participant |

### permissions

| Test ID | Scenario | Accounts | Seed | Steps | UI assertions | DB assertions | Reload | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-PERM-001 | SC-024 | organizer_rating_2_0 | unpaid participant | remove player | confirm then removed | participant removed | removed persists | delete match |
| E2E-PERM-002 | SC-025 | admin | match exists | admin adds participant | participant added | audit/participant added | persists | remove participant |
| E2E-PERM-003 | SC-026 | admin | participant exists | admin removes participant | removed/refund guard | participant removed or refund required | persists | cleanup |
| E2E-PERM-004 | SC-023 | organizer_rating_2_0 | paid participant | remove | refund warning | no unsafe removal | unchanged | reset payment |

### concurrency

| Test ID | Scenario | Accounts | Seed | Steps | UI assertions | DB assertions | Reload | Cleanup |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E2E-CON-001 | SC-027 | player_rating_3_0, player_rating_4_5 | one empty slot | parallel join | one success, one fail | one participant in slot | one persists | delete match |
| E2E-CON-002 | SC-028 | organizer_rating_2_0 | target player not joined | double click add | one success | no duplicate | one persists | delete match |
| E2E-CON-003 | SC-029 | organizer_rating_2_0 | network mocked fail | add player | visible error | no partial save | original state | delete match |
| E2E-CON-004 | SC-030 | player_rating_3_0 | optimistic state | refresh | server state wins | DB unchanged | consistent | delete match |

## Gap-Анализ Текущего Mini-App Для E2E

### Реализовано И Готово К Первым E2E

- Auth/profile smoke.
- Создание public/private match.
- Self-join по уровню.
- Organizer add с предупреждением уровня.
- Duplicate user guard в UI.
- Submit/confirm/dispute result для рейтинговых матчей.

### Частично Реализовано

- Booking связан с `matches`, но нет отдельного `CourtBooking`.
- Payment отображается как статусы/UX, но без полноценной платежной таблицы.
- Training хранится в match details.
- Admin role есть, но permissions нужно закреплять сервером.

### Отсутствует Для Надежных E2E

- Нормализованные `MatchParticipant`, `Payment`, `Training`, `Tournament`.
- Atomic RPC join/leave/add/remove.
- Стабильные seed/cleanup fixtures.
- Server-side audit.

## Первый Набор Playwright-Тестов

Начать с набора `match-joining + invitations + concurrency`:

1. E2E-JOIN-001
2. E2E-JOIN-002
3. E2E-JOIN-006
4. E2E-INV-001
5. E2E-INV-002
6. E2E-INV-004
7. E2E-INV-006
8. E2E-CON-001
9. E2E-CON-002
10. E2E-CON-003

Причина: эти тесты закрывают самые частые реальные поломки MVP - состав матча, приватность, уровень, ручное приглашение, дубли и конкуренцию.
