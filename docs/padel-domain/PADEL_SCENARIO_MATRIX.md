# Padel Scenario Matrix

Матрица описывает тестируемые отраслевые сценарии. Она не исправляет приложение и не является тестовым кодом.

## Полное Пространство Комбинаций

Размер полного декартова произведения измерений:

- actor: 6
- match mode: 2
- visibility: 2
- entry method: 4
- level: 5
- slots: 4
- booking: 4
- payment: 6
- match status: 10
- connection/error: 5

Итого: `6 * 2 * 2 * 4 * 5 * 4 * 4 * 6 * 10 * 5 = 460800` сырых комбинаций.

## Удаление Бессмысленных Вариантов

| Правило | Что убираем | Почему |
| --- | --- | --- |
| Guest не может organizer_add/club_admin_add | actor=guest с privileged entry methods | Нет прав и нет профиля участника. |
| Coach не управляет чужим матчем без роли admin/organizer | coach + organizer_add для чужого матча | Coach role относится к тренировкам. |
| Self-join не применим к private match | visibility=private + self_join | Приватный матч только по приглашению/ручному добавлению. |
| Full slot не может принять нового участника | slots=full + join/add | Нужно отказать, кроме сценария удаления/замены. |
| Completed/cancelled не принимают новых участников | status=completed/cancelled + entry | Спортивное событие закрыто. |
| Payment refunded без paid/partially_paid в истории | refunded + no previous payment | Refund имеет смысл только после оплаты. |
| Rating confirmation не применима к casual | mode=casual + awaiting_confirmation rating flow | Подтверждение результата может быть, но rating changes не применяются. |
| Booking cancelled не должен давать active match без явного override | booking=cancelled + upcoming/started | Корт недоступен. |
| Missing level не равен unverified | level=missing и level=unverified проверяются отдельно | Missing - нет данных; unverified - данные есть, но не подтверждены. |
| Double click не создает отдельный бизнес-сценарий | connection=double_click | Это вариант устойчивости для базового сценария. |

После pruning каталог ниже фиксирует 42 приоритетных сценария: P0=18, P1=17, P2=7.

## Каталог Сценариев

| ID | P | Начальные условия | Роль | Действие | UI | База | Reload | Второй пользователь | Решение | E2E |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SC-001 | P0 | guest без профиля | guest | регистрация | профиль создан, понятная обратная связь | User + PlayerProfile | пользователь залогинен | не влияет | разрешено | да |
| SC-002 | P0 | player с профилем | player | открыть/изменить публичные поля | сохранение без security fields | profile обновлен через safe API | значения сохраняются | не влияет | разрешено | да |
| SC-003 | P1 | player без verified rating | player | запросить подтверждение уровня | shown pending state | level/rating request | pending сохраняется | admin видит заявку | разрешено | да |
| SC-004 | P0 | свободный корт | player | создать public casual match | матч в ленте, 1 слот занят | booking reserved + match searching/open | матч виден | другой игрок видит | разрешено | да |
| SC-005 | P0 | свободный корт | player | создать public rated match | нужен verified или понятный отказ | match is_rating_match=true | флаг сохраняется | другой игрок видит требования | разрешено при verified | да |
| SC-006 | P0 | свободный корт | player | создать private casual match | не попадает в публичную ленту | booking reserved + match private | виден organizer | посторонний не видит | разрешено | да |
| SC-007 | P1 | свободный корт | player | создать private rated match | приватный рейтинг-матч создан | match private + rated | сохраняется | только invited видит | разрешено при правилах клуба | да |
| SC-008 | P0 | public casual, level within, slot empty | player | self_join | слот занят, success | MatchParticipant joined / participants updated | игрок остается в слоте | следующий видит меньше мест | разрешено | да |
| SC-009 | P0 | public casual, level below | player | self_join | отказ по уровню | без изменений | состав прежний | organizer может invite | запрещено | да |
| SC-010 | P0 | public casual, level above | player | self_join | отказ по уровню | без изменений | состав прежний | organizer может invite | запрещено | да |
| SC-011 | P0 | public rated, level within, verified | player | self_join | слот занят | participant joined | сохраняется | второй видит обновление | разрешено | да |
| SC-012 | P0 | public rated, unverified | player | self_join | отказ: нужен verified | без изменений | состав прежний | admin может verify | запрещено | да |
| SC-013 | P0 | private match, slot empty | player | self_join по ссылке/экрану | отказ: только приглашение | без изменений | состав прежний | organizer invite | запрещено | да |
| SC-014 | P0 | public/private casual, player within | organizer | organizer_add | добавляется сразу | participant joined | сохраняется | added player видит матч | разрешено | да |
| SC-015 | P0 | public/private casual, player below | organizer | organizer_add | предупреждение, confirm | participant joined после confirm | сохраняется | added player видит матч | разрешено после confirm | да |
| SC-016 | P0 | public/private casual, player above | organizer | organizer_add | предупреждение, confirm | participant joined после confirm | сохраняется | added player видит матч | разрешено после confirm | да |
| SC-017 | P0 | public/private rated, player within | organizer | organizer_add | добавляется сразу | participant joined с фактическим rating | сохраняется | player видит матч | разрешено | да |
| SC-018 | P0 | public/private rated, player below/above | organizer | organizer_add | предупреждение, confirm | participant joined, rating не меняется | сохраняется | player видит матч | разрешено после confirm | да |
| SC-019 | P0 | any match, player already joined | organizer/player | add/join same user | duplicate blocked | без изменений | один участник | второй запрос отказан | запрещено | да |
| SC-020 | P0 | one_left public match | player | self_join last slot | матч становится confirmed/upcoming | participants full, status updated | full persists | другой игрок видит full | разрешено | да |
| SC-021 | P0 | full match | player | self_join | кнопка disabled/отказ | без изменений | full persists | нет свободных мест | запрещено | да |
| SC-022 | P1 | participant in unpaid match | player | leave | слот освобожден | participant left/removed | слот свободен | другой может join | разрешено по policy | да |
| SC-023 | P1 | paid participant | organizer | remove participant | предупреждение refund required | no removal or refund flow | статус сохраняется | player notified | условно запрещено | да |
| SC-024 | P0 | organizer owns match | organizer | remove unpaid participant | confirm removal | participant removed | состав обновлен | removed player не участник | разрешено | да |
| SC-025 | P1 | club admin | club_admin | add participant | bypass organizer only rules with audit | participant joined, audit | сохраняется | organizer sees change | разрешено | да |
| SC-026 | P1 | club admin | club_admin | remove participant | confirm + refund guard | participant removed/refund required | сохраняется | player notified | разрешено по policy | да |
| SC-027 | P0 | two players join one slot concurrently | player/player | concurrent self_join | один успех, второй отказ | atomic single participant | no duplicate after reload | loser sees occupied | один разрешен | да |
| SC-028 | P0 | organizer double-click add | organizer | double_click organizer_add | один add, второй ignored | no duplicate | one participant | не влияет | один разрешен | да |
| SC-029 | P1 | network failure during add | organizer | organizer_add | error, no local false state | no partial save | reload original | retry possible | запрещено до success | да |
| SC-030 | P1 | refresh after optimistic UI | player | refresh | server state wins | no extra mutation | matches DB | second user consistent | сервер истина | да |
| SC-031 | P0 | rated match completed by one team | organizer/player | submit result | awaiting confirmation | MatchResult submitted | pending persists | other team can confirm | разрешено | да |
| SC-032 | P0 | rated result pending | opposing participant | confirm result | completed + rating changes | RatingChange applied once | rating persists | submitter sees complete | разрешено | да |
| SC-033 | P0 | rated result pending | opposing participant | dispute result | disputed state | no rating applied | disputed persists | admin can resolve | разрешено | да |
| SC-034 | P0 | rated result confirmed | same user/system | repeat confirm | no second rating change | idempotent rejection | rating unchanged | no effect | запрещено | да |
| SC-035 | P1 | casual match completed | organizer | submit result | completed without rating change | result saved, no RatingChange | history visible | participants see completed | разрешено | да |
| SC-036 | P1 | booking pending payment | organizer | create match | UI shows payment pending | booking pending, match not fully active | pending persists | players cannot assume court | условно разрешено | да |
| SC-037 | P1 | payment failed | payer | pay booking | failure visible | payment failed, booking not confirmed | failed persists | organizer sees unpaid | запрещено до retry | да |
| SC-038 | P1 | paid booking | organizer | cancel before cutoff | refund flow starts | booking cancelled/refund pending | cancelled persists | participants notified | разрешено по policy | да |
| SC-039 | P1 | no court available | player | create booking/match | slot unavailable | no booking/match | no ghost match | second user unaffected | запрещено | да |
| SC-040 | P1 | training slot available | player | request training | request pending | Training requested | pending persists | coach/admin can confirm | разрешено | да |
| SC-041 | P2 | tournament registration open | player | register tournament | registered/pending payment | TournamentParticipant | persists | admin sees entry | разрешено | нет |
| SC-042 | P2 | club admin dashboard | club_admin | manage courts/coaches/events | changes reflect club config | settings updated | persists | users see new config | разрешено | нет |

## P2 Backlog Сценарии

P2 также включает расширения: waitlist, group training capacity, tournament seeding, advanced cancellation fees, membership discounts, multi-club account switching, coach payout reports.

## Gap-Анализ Текущего Mini-App

### Уже Реализовано

- Регистрация и логин через Supabase Auth.
- Профиль игрока, базовая самооценка уровня, отображение рейтинга.
- Создание public/private match и booking-like записей в `matches`.
- Лента публичных матчей.
- Самостоятельное присоединение с проверкой уровня.
- Ручное добавление игрока организатором через поиск публичного профиля.
- Чат матча через `messages`.
- Завершение матча, result submit, confirmation/dispute для рейтинговых сценариев.
- Админский экран игроков и обновление security-полей профиля через RPC.

### Частично Реализовано

- Booking: корт и матч связаны в одной записи `matches`, отдельной сущности брони нет.
- Payment: статусы и UI есть частично, реального платежного workflow и refund нет.
- Training: заявка/настройка тренировки есть, но без отдельной таблицы и полноценного coach workflow.
- Rating: формула есть, но участники и изменения рейтинга частично зависят от JSON матча.
- Invitations: есть ручное добавление и ссылка, но нет отдельного invitation state/accept.
- Privacy: приватные матчи скрываются из ленты, но права должны быть закреплены сервером.

### Отсутствует

- Отдельные `CourtBooking`, `MatchParticipant`, `MatchInvitation`, `Payment`, `Training`, `Tournament`.
- Atomic join/leave на сервере как единый источник истины.
- Полный refund flow.
- Турнирные сетки и регистрация.
- Аудит критичных действий.
- Role model для coach и tournament organizer.
- Notification pipeline.

### Ненадежно Тестировать Из-За Текущей Структуры БД

- Конкурентный join одного слота, если обновляется весь JSON `filledSlots`.
- Удаление оплатившего участника и refund.
- Идемпотентность применения рейтинга без серверного constraint/RPC.
- Разделение свободного корта и свободного места в матче.
- Историю состава, если участники живут только в snapshot JSON.

### Противоречия С Моделью

- `filledSlots` и `participants` в `matches` выполняют роль источника истины, хотя должны быть производными/нормализованными.
- Booking и Match смешаны в одной таблице/записи.
- Payment status не подкреплен отдельной платежной сущностью.
- Training хранится как details внутри match.
- Role/permission часть частично клиентская, должна проверяться сервером.
