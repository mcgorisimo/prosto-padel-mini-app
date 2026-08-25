DRAFT — НЕ ОПУБЛИКОВАНО — НЕ УТВЕРЖДЕНО ВЛАДЕЛЬЦЕМ — ТРЕБУЕТ ЮРИДИЧЕСКОЙ ПРОВЕРКИ

# Чек-лист данных и решений владельца

- Версия: `owner_input_checklist_v0.2`.
- Дата: `2026-08-25`.
- D5.3 preparation checkpoint: `done`.
- Legal candidate: `draft_not_published_not_legally_approved`.
- D5.3 overall: `not_done`; implementation/publication — отдельные будущие gates.
- Регистрационные реквизиты ООО получены от владельца: `2026-08-25`.
- Сверка с подписанной электронной выпиской ЕГРЮЛ до публикации: `pending`.
- Назначение: собрать только факты, необходимые для следующей редакции legal
  drafts. Этот файл не публикуется.

## Как заполнять

Допустимые статусы:

- `known` — факт уже подтверждён владельцем;
- `pending_26_aug` — исторический статус ожидания регистрационных данных;
  регистрационные строки ниже переведены в `known`;
- `requires_contract` — берётся из договора, оферты или приложения поставщика;
- `pending_owner_later` — владелец предоставит после checkpoint, но не в дату
  регистрации ООО;
- `owner_decision` — продуктовая граница, которую утверждает владелец;
- `legal_review` — итоговая классификация или формулировка требует проверки.

В колонке `Значение / ссылка на локальный источник` можно заполнить публичные
реквизиты прямо в этом локальном файле либо указать согласованный безопасный
источник. Передавать их в открытом чате необязательно.

**Никогда не добавлять сюда:** пароли, API tokens, merchant credentials, ключи,
сертификаты, доступы к банку/кабинетам, secret URLs или сканы документов.
Публичные ИНН/ОГРН/КПП и банковские реквизиты не являются credentials, но их
также можно передать безопасным согласованным способом.

## 1. ООО и адреса

| ID | Что нужно | Статус | Значение / ссылка на локальный источник | Где используется |
|---|---|---|---|---|
| `company.full_name` | Полное имя точно по ЕГРЮЛ | `known` | ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ПРОСТО ПАДЕЛ"; owner-supplied 2026-08-25, official extract check pending | Все документы, оператор ПД, продавец |
| `company.short_name` | Сокращённое имя точно по ЕГРЮЛ | `known` | ООО "ПРОСТО ПАДЕЛ"; owner-supplied 2026-08-25 | Заголовки и обращения |
| `company.inn` | ИНН | `known` | `7716262810`; формат и контрольная цифра PASS | Все документы и чеки |
| `company.kpp` | КПП | `known` | `771601001`; формат PASS, код инспекции `7716` совпадает с ИНН | Реквизиты компании |
| `company.ogrn` | ОГРН | `known` | `1267700285093`; формат и контрольная цифра PASS | Все документы |
| `company.legal_address` | Юридический адрес | `known` | 129323, Г.МОСКВА, ВН.ТЕР.Г. МУНИЦИПАЛЬНЫЙ ОКРУГ СВИБЛОВО, УЛ СНЕЖНАЯ, Д. 17, К. 1, ПОМЕЩ. 18П; owner-supplied 2026-08-25 | Оператор, продавец, обращения |
| `company.postal_address` | Физический почтовый адрес либо отметка «совпадает с юридическим» | `known` | Совпадает с юридическим: 129323, Г. МОСКВА, ВН.ТЕР.Г. МУНИЦИПАЛЬНЫЙ ОКРУГ СВИБЛОВО, УЛ. СНЕЖНАЯ, Д. 17, К. 1, ПОМЕЩ. 18П | Претензии и privacy requests |
| `club.official_address` | Полный официальный адрес клуба | `known` | Пятницкое шоссе 1с1, ТП Отрада; owner-supplied 2026-08-25 | Место оказания услуг; финальная адресная полнота проверяется до публикации |
| `company.public_bank_details` | Публичные банковские реквизиты для Terms, только если владелец утверждает их публикацию: расчётный счёт, банк, БИК, корреспондентский счёт | `owner_decision` | `{{PUBLIC_BANK_DETAILS_OR_NOT_PUBLISHED}}` | Реквизиты Terms; никаких доступов к счёту |

## 2. Официальные контакты

| ID | Что нужно | Статус | Значение / ссылка на локальный источник | Проверка до публикации |
|---|---|---|---|---|
| `contact.support_email` | Официальный support email | `known` | отсутствует; `info@prostopdl.ru` не использовать и не обещать для поддержки/отмены | Новый адрес — только отдельное owner decision |
| `contact.privacy_email` | Официальный privacy email | `known` | `info@prostopdl.ru`; mailbox работает; только privacy requests и отзыв согласия | Назначить внутренний routing без публикации PII |
| `contact.phone` | Официальный телефон поддержки | `pending_owner_later` | `{{SUPPORT_PHONE_PENDING}}` | Не считать рабочим до публикации точного номера |
| `contact.socials` | Точные официальные HTTPS-ссылки социальных сетей для поддержки/отмены | `pending_owner_later` | `{{OFFICIAL_SOCIAL_URLS_PENDING}}` | Утвердить платформы, ответственных и channel rules |

## 3. Сбербанк, online-ККТ и ОФД — только после договоров

| ID | Что нужно извлечь из договора/настроек без credentials | Статус | Значение / локальный источник | Где используется |
|---|---|---|---|---|
| `payment.sber_legal_entity` | Юридическое лицо Сбербанка — сторона договора эквайринга | `requires_contract` | `{{SBER_ACQUIRER_LEGAL_NAME}}` | Privacy recipients, Terms |
| `payment.sber_product` | Точное название продукта и схема расчёта/возврата | `requires_contract` | `{{SBER_ACQUIRING_PRODUCT}}` | Terms, Cancellation, data flow |
| `fiscal.physical_kkt` | Подтверждённый факт: физическая АТОЛ 55Ф в клубе; указать владельца ККТ и область применения | `owner_decision` | `АТОЛ 55Ф; {{PHYSICAL_KKT_OWNER_AND_SCOPE}}` | Не смешивать с online checkout |
| `fiscal.online_kkt` | Модель/оператор online-ККТ и кто формирует чек при online payment | `requires_contract` | `{{ONLINE_KKT_MODEL_AND_OPERATOR}}` | Privacy, Terms, чековый flow |
| `fiscal.ofd` | Юридическое лицо ОФД | `requires_contract` | `{{OFD_LEGAL_NAME}}` | Privacy recipient и fiscal retention |
| `fiscal.receipt_flow` | Какие contact/order/payment поля, кому и в каком направлении передаются; кто отправляет чек; где хранится receipt ID/status | `requires_contract` | `{{RECEIPT_DATA_FLOW_AND_STORAGE}}` | Data matrix, Privacy, store disclosures |

## 4. Telegram, YCLIENTS/YPLACES и Selectel

| ID | Что нужно | Статус | Значение / локальный источник | Минимальный результат |
|---|---|---|---|---|
| `telegram.entity_flow` | Юрлицо/страны Telegram и фактические направления auth/initData, SecureStorage и Bot notifications | `legal_review` | `{{TELEGRAM_RECIPIENT_COUNTRY_AND_FLOW}}` | Recipient-by-recipient cross-border decision/notice status |
| `yclients.legal_entity_role` | Юридическое лицо по договору и роль: самостоятельный оператор, обработчик по поручению или иной статус | `requires_contract` | `{{YCLIENTS_LEGAL_ENTITY_AND_ROLE}}` | Privacy recipient и договорная ответственность |
| `yclients.transfer_categories` | Подтвердить фактический outbound набор. Код сейчас отправляет имя, телефон, email, `api_id`, service/resource и datetime | `requires_contract` | `{{YCLIENTS_TRANSFER_CATEGORY_APPROVAL}}` | Утверждённая field map без токенов и provider bodies |
| `yclients.resource_classification` | Уточнить, являются ли `resource`/`book_staff` только кортами либо также сотрудниками/тренерами; подтвердить показываемые staff fields, audience и retention | `requires_contract` | `{{YCLIENTS_RESOURCE_STAFF_CLASSIFICATION}}` | Privacy categories и catalog projection |
| `yclients.payment_fields` | Какие payment/price/refund поля реально появляются или передаются, источник истины и направление | `requires_contract` | `{{YCLIENTS_PAYMENT_FIELD_MAP}}` | Не обещать синхронизацию до contract/code review |
| `yplaces.relationship` | Является ли YPLACES тем же продуктом/юрлицом, брендом интерфейса или отдельным получателем | `requires_contract` | `{{YPLACES_RELATIONSHIP_TO_YCLIENTS}}` | Отдельный recipient только если это подтверждено |
| `yclients.cross_border` | Страна API/хранения, направления передачи и договорные меры | `requires_contract` | `{{YCLIENTS_CROSS_BORDER_FACTS}}` | Правовая оценка/уведомление остаются отдельным `legal_review` |
| `selectel.contract_entity` | Точное юридическое лицо Selectel по договору | `requires_contract` | `{{SELECTEL_LEGAL_ENTITY}}` | Privacy processor |
| `selectel.region_location` | Регион PostgreSQL, object storage и backups; подтверждение хранения в РФ | `requires_contract` | `{{SELECTEL_REGION_AND_DATA_LOCATION}}` | Localization statement с договорным evidence |
| `selectel.cross_border` | Есть ли иностранный доступ/subprocessor/support flow; если нет — документальное подтверждение | `requires_contract` | `{{SELECTEL_CROSS_BORDER_FACTS}}` | Recipient-by-recipient legal assessment остаётся `legal_review` |
| `selectel.ingress_logs` | Фактические fields/destination/recipients/rotation access/error logs и trusted-proxy/XFF boundary; подтвердить отсутствие credentials и PII в URL/query/logs | `requires_contract` | `{{SELECTEL_INGRESS_ACCESS_ERROR_LOG_FACTS}}` | Data matrix, security disclosure и deletion cycle |

## 5. Решения владельца

| ID | Решение простым языком | Статус | Ответ владельца | Что блокирует |
|---|---|---|---|---|
| `product.age_model` | Действующая модель несовершеннолетних | `known` | Регистрация/social functions — с согласием законного представителя; заказ/оплата — совершеннолетним либо с таким согласием; minor может быть участником; no mandatory 18+ checkbox; no age/parental verification or verified claim | Terms/Privacy/Consent; точная формулировка/evidence — legal review |
| `product.age_model_history_18_plus` | Предыдущее решение «самостоятельный аккаунт/Заказчик только 18+» | `known` | `superseded_by_owner_2026_08_23`; не применять как активную модель | История решения сохранена, не переносить в onboarding |
| `product.profile_visibility` | Видимость профиля после входа | `known` | Всем зарегистрированным: display name, выбранное фото, level/rating, public match history. Скрыты phone/email/private bookings/payments/service IDs. Current `/players/search` field projection и history не совпадают полностью | `publication_blocked`: legal basis/evidence + field/settings/code alignment |
| `retention.matrix` | Owner-approved retention policy candidate | `known` | Подробная category/trigger matrix зафиксирована ниже; сроки 1/3/5 лет и 30 дней не называются универсальными требованиями закона | Final legal review и runtime implementation |
| `deletion.model` | Owner-approved deletion/anonymization candidate | `known` | Немедленно скрыть профиль/revoke sessions; live PII без иного основания — удалить/обезличить ≤30 дней; public match/rating оставить только truly anonymized; backups ≤30 дней с deletion replay | Отдельный account-deletion/revoke/processor propagation slice |
| `cancellation.periods` | Сроки гарантированного полного возврата/переноса | `known` | 24 часа для корта/матча/тренировки; 48 часов для турнира | После срока сохраняется законный отказ с individual actual-expense calculation |
| `cancellation.expenses` | Утвердить, кто и какими документами считает индивидуальные фактические расходы конкретного заказа; как сообщается расчёт пользователю | `owner_decision` | `{{OWNER_ACTUAL_EXPENSE_METHOD_DECISION}}` | Late cancellation process |
| `documents.effective_dates` | Назначить версии и даты вступления Terms, Privacy, Cancellation и separate consent | `known` | Единая дата 26.08.2026; candidate versions: `terms-2026-08-26-v1`, `privacy-2026-08-26-v1`, `cancellation-2026-08-26-v1`, `personal-data-consent-2026-08-26-v1` | Consent UI и immutable evidence |
| `documents.public_urls` | Утвердить versioned HTTPS URLs, доступные без Telegram/auth | `known` | Selectel test candidate namespace: `https://test-app.prostopdl.ru/legal/`; production hostname остаётся отдельным gate | D5.1 onboarding; test rollout pending |

## 5.1. Owner-approved retention/deletion policy candidate

Каждый срок ниже — подтверждённая продуктовая граница владельца. Статутные
минимумы, legal holds, точные категории и основания исключений остаются в
`legal_review` и не расширяют хранение несвязанных данных.

| ID | Категория / trigger | Статус | Утверждённый candidate | Что ещё проверить |
|---|---|---|---|---|
| `retention.profile_inactivity` | Профиль/контакты и неактивность | `known` | Пока существует аккаунт; после 3 лет неактивности уведомить, затем через 30 дней без возврата удалить/обезличить | inactivity clock, delivery evidence, legal exceptions |
| `retention.account_deletion` | Запрос удаления | `known` | Скрыть профиль и revoke sessions немедленно; live PII без иного основания удалить/обезличить ≤30 дней | implementation, processor propagation, legal holds |
| `retention.public_sports_history` | Match/rating после удаления | `known` | Публично сохранять только действительно обезличенные records | anonymization test и срок обязательной domain history |
| `retention.chat` | Обычный chat / reported-disputed content | `known` | 1 год после матча / 3 года после закрытия complaint или dispute | case-close trigger, moderation legal hold |
| `retention.booking` | Operational booking history | `known` | 3 года после исполнения/отмены, затем обезличивание | contract/claim exceptions, YCLIENTS propagation |
| `retention.payment_fiscal` | Payment/fiscal/accounting evidence | `known` | Baseline не менее 5 лет после соответствующего отчётного года | Exact legal/D4 category mapping; не хранить весь профиль |
| `retention.consent` | Consent/policy evidence | `known` | 3 года после удаления аккаунта или отзыва соответствующего согласия | applicable trigger и lawful evidence fields |
| `retention.logs_audit` | Обычные logs / admin-security-moderation audit | `known` | 1 год / 3 года после события или закрытия case | fields, rotation, incident/legal-hold mapping |
| `retention.requests` | Privacy/support requests | `known` | 3 года после закрытия | support channel отсутствует; privacy mailbox работает |
| `retention.backups` | Backups | `known` | Максимум 30 дней, без ordinary access; deletion replay после restore обязателен | Selectel contract/runtime verification |

## 6. Финальная legal review перед публикацией

| ID | Что проверить | Статус | Результат |
|---|---|---|---|
| `review.legal_bases` | Одно точное основание для каждой цели/операции в data matrix; согласие не используется там, где нужна договорная или законная обработка | `legal_review` | `{{LEGAL_BASIS_REVIEW_RESULT}}` |
| `review.cross_border` | Каждый иностранный recipient, страна, направление, данные, цель, меры и применимый порядок уведомления | `legal_review` | `{{CROSS_BORDER_REVIEW_RESULT}}` |
| `review.profile_publication` | Соответствие фактического player search/match roster статье 10.1 и выбранной visibility model | `legal_review` | `{{PROFILE_PUBLICATION_REVIEW_RESULT}}` |
| `review.retention_deletion` | Законные минимумы/максимумы, уничтожение после цели, anonymization и backup propagation | `legal_review` | `{{RETENTION_DELETION_REVIEW_RESULT}}` |

После заполнения checklist не удаляется: он остаётся локальным evidence index.
Перед публикацией секреты и credentials всё равно проверяются отдельным
repository scan и никогда не переносятся в legal documents.
