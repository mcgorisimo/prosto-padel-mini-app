# Padel Domain Model

Документ описывает отраслевую модель для универсальной платформы падел-клубов. Он не является миграцией БД и не описывает только текущую реализацию mini-app.

## Ключевые Правила Модели

- `CourtBooking` и `Match` - разные сущности. Бронь блокирует корт, матч управляет составом и результатом.
- Участники не должны храниться только внутри JSON матча. JSON может быть кэшем для UI, но источником истины должна быть отдельная сущность `MatchParticipant`.
- Диапазон уровня матча и фактический рейтинг игрока - разные значения. Диапазон допускает/предупреждает, рейтинг участвует в расчете.
- `username` не является постоянным идентификатором. Постоянный идентификатор - внутренний `user_id/profile_id`.
- Сервер считается источником истины для прав, состава, оплат, результата и рейтинга.

## Сущности

| Entity | Назначение | Ключевые поля | Статусы | Чтение / изменение | Связи | Приватные данные |
| --- | --- | --- | --- | --- | --- | --- |
| User | Учетная запись аутентификации. | id, auth_provider, email, phone, created_at, last_sign_in_at | active, disabled, deleted | Сам пользователь читает базовые данные; auth/admin изменяет. | PlayerProfile, Notification | email, phone, auth metadata |
| PlayerProfile | Игровой профиль в клубе. | id, user_id, club_id, first_name, last_name, username, photo_url, rating, is_verified, side_preference, role | active, hidden, banned | Публичные игровые поля читают authenticated; приватные поля - владелец/админ. Изменяет владелец ограниченно, админ - security fields. | User, Rating, MatchParticipant | phone, email, birthday, gender, role, internal notes |
| Club | Падел-клуб как tenant. | id, name, timezone, address, cancellation_policy, currency, settings | active, suspended | Публично читается; меняет club_admin/platform_admin. | Court, Coach, Tournament, Booking | billing, internal settings |
| Court | Игровой корт. | id, club_id, name, type, capacity, is_active, price_group | active, maintenance, inactive | Игроки читают доступные; админ меняет. | Club, CourtBooking, Match | internal maintenance notes |
| CourtBooking | Бронь корта. | id, club_id, court_id, owner_id, start_at, end_at, price, payment_status, match_id | draft, reserved, pending_payment, confirmed, cancelled, expired | Участники и админ читают; owner/admin меняют по правилам. | Court, Match, Payment | payer details, payment references |
| Match | Игра как спортивное событие. | id, club_id, booking_id, owner_id, mode, visibility, level_min, level_max, max_players, status, is_rating_match | draft, searching, confirmed, upcoming, started, awaiting_result, awaiting_confirmation, disputed, completed, cancelled | Публичные матчи читают игроки; приватные - участники/админ. Изменяет organizer/admin. | CourtBooking, MatchParticipant, Team, MatchResult | private invite metadata |
| MatchParticipant | Участие игрока в матче. | id, match_id, profile_id, slot_index, team_id, source, payment_status, joined_at | invited, requested, joined, confirmed, left, removed, no_show | Участники видят состав; organizer/admin меняют; player меняет только свое участие. | Match, PlayerProfile, Team, Payment | removal reason, payment refs |
| MatchInvitation | Приглашение или запрос участия. | id, match_id, inviter_id, invitee_id, method, token, expires_at | pending, accepted, declined, expired, cancelled | Участники приглашения и admin; изменяет invitee/organizer/admin. | Match, PlayerProfile, Notification | invite token, contact target |
| Team | Команда внутри матча. | id, match_id, team_number, participant_ids | draft, locked, completed | Участники/админ читают; organizer/admin формируют до результата. | Match, MatchParticipant, MatchResult | нет, кроме состава приватного матча |
| PlayerLevel | Уровень или диапазон допуска. | id, club_id, label, numeric_min, numeric_max, source | self_assessed, verified, expired | Публичная шкала читается всеми; verified уровень меняет admin/coach. | PlayerProfile, Match | assessment evidence |
| Rating | Текущий рейтинг игрока. | id, profile_id, club_id, value, verified, updated_at, source | provisional, verified, frozen | Игрок видит свой; публично можно показывать value/verified; меняет сервер/admin workflow. | PlayerProfile, RatingChange | evidence, moderation notes |
| Payment | Денежная операция. | id, club_id, payer_id, subject_type, subject_id, amount, currency, provider, provider_ref | not_required, unpaid, pending, partially_paid, paid, refunded, failed, disputed | Участник своей оплаты и admin; меняет payment backend/admin. | CourtBooking, MatchParticipant, Tournament | provider_ref, receipt, payer data |
| Training | Тренировка или заявка на нее. | id, club_id, coach_id, booking_id, format, capacity, starts_at, status | draft, requested, confirmed, completed, cancelled | Участники/coach/admin читают; coach/admin подтверждают. | Coach, CourtBooking, PlayerProfile | comments, contact data |
| Coach | Тренер клуба. | id, club_id, profile_id, name, specialties, schedule, active | active, inactive, unavailable | Публичный профиль читается игроками; admin/coach меняют. | Training, Club | payout, phone, internal notes |
| Tournament | Турнир или событие. | id, club_id, name, format, starts_at, registration_limit, fee | draft, registration_open, registration_closed, running, completed, cancelled | Игроки читают; organizer/admin меняют. | Match, Payment, PlayerProfile | seed notes, admin notes |
| MatchResult | Результат матча. | id, match_id, submitted_by, score, winner_team_id, status | draft, submitted, awaiting_confirmation, confirmed, disputed, void | Участники/админ читают; submitter/confirming team/admin меняют. | Match, Team, RatingChange | dispute comments |
| RatingChange | Изменение рейтинга после результата. | id, match_result_id, profile_id, before, delta, after, applied_at | pending, applied, reverted, void | Игрок видит свои; admin видит все; сервер применяет. | Rating, MatchResult | нет, кроме связки с приватным матчем |
| Notification | Сообщение пользователю. | id, user_id, channel, type, payload, sent_at, read_at | queued, sent, delivered, read, failed | Только получатель/admin; изменяет notification service. | User, Match, Payment, Training | payload может содержать приватные детали |

## Правила Доступа

- Гость видит только публичные клубные данные и public events.
- Игрок видит свои профили, свои брони, публичные матчи и приватные матчи, где он участник/приглашенный.
- Организатор управляет своим матчем, но не системными полями чужих профилей.
- Coach видит свои тренировки и назначенных игроков в рамках тренировки.
- Club admin видит и меняет клубные данные, матчи, расписание, роли, верификацию уровня.
- Platform admin управляет tenant-level настройками, если продукт масштабируется на несколько клубов.

## Данные, Которые Нельзя Держать Только В Клиенте

- Участники матча и индексы слотов.
- Статус оплаты и возврата.
- Подтверждение результата.
- Применение рейтинга.
- Право на админское действие.
- История критичных событий.
